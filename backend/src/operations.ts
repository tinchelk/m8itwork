import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createProjectAccess } from "./project-access.js";
import { financialLock } from "./financial-lock.js";
import type { Env } from "./config.js";
import { AppError } from "./shared/errors.js";
import { enqueueOperators } from "./notifications.js";
import { providerStatusSchema } from "./reviews/types.js";
export async function registerOperations(
  app: FastifyInstance,
  prisma: PrismaClient,
  env: Env,
  payments: {
    processInbox: (id: string) => Promise<void>;
    processPending: () => Promise<void>;
  },
  notifications: { process: () => Promise<void> },
) {
  const { actor } = createProjectAccess(prisma, env);
  app.get("/v1/operator/operations", async (request) => {
    await actor(request, true);
    const [paymentEvents, emailEvents, workers, failedJobs] = await Promise.all(
      [
        prisma.paymentInbox.findMany({
          where: { processedAt: null, ignoredAt: null },
          select: {
            id: true,
            type: true,
            createdAt: true,
            lastError: true,
            attempts: true,
            attempt: {
              select: {
                milestone: {
                  select: { proposal: { select: { projectId: true } } },
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
          take: 50,
        }),
        prisma.notificationOutbox.findMany({
          where: {
            sentAt: null,
            OR: [{ skippedAt: null }, { lastError: "DELIVERY_UNCERTAIN" }],
          },
          select: {
            id: true,
            projectId: true,
            kind: true,
            createdAt: true,
            attempts: true,
            lastError: true,
            skippedAt: true,
          },
          orderBy: { createdAt: "asc" },
          take: 50,
        }),
        prisma.reviewWorker.findMany({
          where: { revokedAt: null },
          select: {
            id: true,
            name: true,
            lastSeenAt: true,
            providerStatus: true,
          },
          take: 30,
        }),
        prisma.reviewJob.findMany({
          where: {
            OR: [
              { status: "FAILED" },
              { status: "RUNNING", leaseExpiresAt: { lt: new Date() } },
              {
                status: "QUEUED",
                createdAt: { lt: new Date(Date.now() - 15 * 60_000) },
              },
            ],
          },
          select: {
            id: true,
            projectId: true,
            provider: true,
            status: true,
            errorCode: true,
            createdAt: true,
          },
          take: 30,
          orderBy: { createdAt: "desc" },
        }),
      ],
    );
    return {
      paymentEvents,
      emailEvents,
      workers: workers.map((w) => ({
        ...w,
        offline: !w.lastSeenAt || Date.now() - w.lastSeenAt.getTime() > 60_000,
      })),
      failedJobs,
      processing:
        "Events retry every minute; expired credentials are cleared hourly.",
    };
  });
  app.post("/v1/operator/operations/payments/retry", async (request) => {
    await actor(request, true);
    const { id } = z
      .object({ id: z.string().regex(/^evt_[A-Za-z0-9_-]{1,200}$/) })
      .strict()
      .parse(request.body);
    await prisma.paymentInbox.updateMany({
      where: { id, processedAt: null, ignoredAt: null },
      data: { nextAttemptAt: new Date() },
    });
    await payments.processInbox(id);
    return { checked: true };
  });
  app.post("/v1/operator/operations/email/retry", async (request) => {
    await actor(request, true);
    const { id } = z
      .object({ id: z.string().min(1).max(200) })
      .strict()
      .parse(request.body);
    await prisma.$transaction(async (tx) => {
      await financialLock(tx);
      const row = await tx.notificationOutbox.findUnique({ where: { id } });
      if (
        !row ||
        row.sentAt ||
        row.skippedAt ||
        (row.firstAttemptAt &&
          Date.now() - row.firstAttemptAt.getTime() >= 23 * 3600_000)
      )
        throw new AppError(
          409,
          "EMAIL_RETRY_UNSAFE",
          "This delivery is complete or its retry window expired. Check the provider delivery log before sending a new update.",
        );
      await tx.notificationOutbox.update({
        where: { id },
        data: { nextAttemptAt: new Date() },
      });
    });
    await notifications.process();
    return { checked: true };
  });
  async function alerts() {
    const now = Date.now();
    const issues: { id: string; code: string; projectId: string | null }[] = [];
    const events = await prisma.paymentInbox.findMany({
      where: {
        processedAt: null,
        ignoredAt: null,
        createdAt: { lt: new Date(now - 5 * 60_000) },
      },
      select: {
        id: true,
        attempt: {
          select: {
            milestone: {
              select: { proposal: { select: { projectId: true } } },
            },
          },
        },
      },
    });
    for (const e of events)
      issues.push({
        id: `payment:${e.id}`,
        code: "PAYMENT_RECONCILIATION",
        projectId: e.attempt?.milestone.proposal.projectId ?? null,
      });
    const emails = await prisma.notificationOutbox.findMany({
      where: {
        sentAt: null,
        kind: { not: { startsWith: "OPERATOR_" } },
        OR: [
          {
            skippedAt: null,
            attempts: { gte: 3 },
            lastError: "EMAIL_UNAVAILABLE",
          },
          { lastError: "DELIVERY_UNCERTAIN" },
        ],
      },
      select: { id: true, projectId: true },
    });
    for (const e of emails)
      issues.push({
        id: `email:${e.id}`,
        code: "EMAIL_DELIVERY",
        projectId: e.projectId,
      });
    const workers = await prisma.reviewWorker.findMany({
      where: { revokedAt: null },
    });
    for (const w of workers) {
      if (
        (!w.lastSeenAt && now - w.createdAt.getTime() > 60_000) ||
        (w.lastSeenAt && now - w.lastSeenAt.getTime() > 60_000)
      )
        issues.push({
          id: `worker:${w.id}`,
          code: "WORKER_OFFLINE",
          projectId: null,
        });
      else {
        const statuses = z
          .array(providerStatusSchema)
          .safeParse(w.providerStatus);
        if (
          statuses.success &&
          statuses.data.some(
            (s) =>
              s.state === "NEEDS_LOGIN" ||
              s.state === "ERROR" ||
              (s.state === "LIMITED" &&
                (!s.retryAt || Date.parse(s.retryAt) <= now)),
          )
        )
          issues.push({
            id: `worker:${w.id}`,
            code: "WORKER_AUTH_OR_ERROR",
            projectId: null,
          });
      }
    }
    const jobs = await prisma.reviewJob.findMany({
      where: {
        OR: [
          { status: "FAILED" },
          { status: "QUEUED", createdAt: { lt: new Date(now - 15 * 60_000) } },
          { status: "RUNNING", leaseExpiresAt: { lt: new Date() } },
        ],
      },
      select: { id: true, projectId: true },
    });
    for (const j of jobs)
      issues.push({
        id: `job:${j.id}`,
        code: "REVIEW_JOB_ATTENTION",
        projectId: j.projectId,
      });
    await prisma.$transaction(async (tx) => {
      await financialLock(tx);
      await tx.healthAlert.updateMany({
        where: { resolvedAt: null, id: { notIn: issues.map((i) => i.id) } },
        data: { resolvedAt: new Date() },
      });
      for (const issue of issues) {
        const existing = await tx.healthAlert.findUnique({
          where: { id: issue.id },
        });
        if (existing && !existing.resolvedAt && existing.code === issue.code)
          continue;
        const openedAt = new Date();
        await tx.healthAlert.upsert({
          where: { id: issue.id },
          update: { code: issue.code, openedAt, resolvedAt: null },
          create: { id: issue.id, code: issue.code, openedAt },
        });
        await enqueueOperators(
          tx,
          env,
          "OPERATOR_ALERT",
          `alert:${issue.id}:${openedAt.getTime()}`,
          issue.projectId,
        );
      }
    });
  }
  return { alerts };
}
