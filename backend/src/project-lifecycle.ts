import { Prisma, type PrismaClient, type ReviewSession } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "./config.js";
import { accountFromRequest } from "./accounts.js";
import { projectId, type ProjectAccess } from "./project-access.js";
import { guardProposalRevision, requirePaymentGate } from "./payment-rules.js";
import { unresolvedPayments } from "./financial-lock.js";
import type { PaymentProvider } from "./stripe-provider.js";
import type { registerPayments } from "./payments.js";
import { AppError } from "./shared/errors.js";

const version = z.number().int().positive();
const reason = z.string().trim().min(10).max(3000);
const terminal = ["WITHDRAWN", "DECLINED", "CANCELLED", "CLOSED"];
const artifact = z
  .object({
    label: z.string().trim().min(2).max(100),
    url: z
      .url()
      .max(500)
      .refine((v) => {
        const u = new URL(v);
        return (
          ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
        );
      }),
  })
  .strict();
export async function registerProjectLifecycle(
  app: FastifyInstance,
  options: {
    prisma: PrismaClient;
    env: Env;
    access: ProjectAccess;
    provider: PaymentProvider;
    reconcile: Awaited<ReturnType<typeof registerPayments>>["reconcile"];
    session: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<ReviewSession>;
  },
) {
  const { prisma, access, provider, reconcile, session } = options;
  const { actor, projectFor, touch, update } = access;
  for (const { team, action } of [
    { team: false, action: "cancel" },
    { team: true, action: "decline" },
    { team: true, action: "cancel" },
  ]) {
    app.post(
      `${team ? "/v1/operator/projects" : "/v1/projects"}/:id/${action}`,
      async (request) => {
        const account = await actor(request, team),
          input = z.object({ version, reason }).strict().parse(request.body);
        return prisma.$transaction(async (tx) => {
          const project = await projectFor(
            account,
            projectId(request),
            team,
            tx,
          );
          if (
            terminal.includes(project.stage) &&
            project.closedReason === input.reason
          )
            return { saved: true };
          if (terminal.includes(project.stage) || project.stage === "COMPLETE")
            throw new AppError(
              409,
              "PROJECT_TERMINAL",
              "This project is already closed or delivered.",
            );
          const agreed = await tx.proposal.count({
            where: { projectId: project.id, approvedAt: { not: null } },
          });
          if (agreed) {
            if (action === "decline")
              throw new AppError(
                409,
                "SETTLEMENT_REQUIRED",
                "Agree a cancellation settlement for work that has already been approved.",
              );
            if (
              project.cancellationRequestedAt &&
              project.cancellationReason === input.reason
            )
              return { saved: true };
            await touch(tx, project, input.version, {
              cancellationRequestedAt: new Date(),
              cancellationReason: input.reason,
              resumeProposedAt: null,
              settlementSummary: null,
              settlementRetainedCents: null,
              settlementProposedAt: null,
              settlementAcceptedAt: null,
              aiReviewConsentAt: null,
              aiReviewConsentVersion: null,
            });
            await tx.reviewJob.updateMany({
              where: {
                projectId: project.id,
                status: { in: ["QUEUED", "RUNNING"] },
              },
              data: {
                status: "CANCELLED",
                completedAt: new Date(),
                leaseExpiresAt: null,
              },
            });
            await update(
              tx,
              project.id,
              "Cancellation requested",
              "Contact the team to agree completed work, remaining payments and any refund. New payment collection is paused; no refund is issued automatically.",
              team ? "TEAM" : "CUSTOMER",
            );
          } else {
            await guardProposalRevision(tx, project.currentProposalId);
            await touch(tx, project, input.version, {
              stage: team ? "DECLINED" : "WITHDRAWN",
              closedReason: input.reason,
              aiReviewConsentAt: null,
              aiReviewConsentVersion: null,
            });
            await tx.reviewJob.updateMany({
              where: {
                projectId: project.id,
                status: { in: ["QUEUED", "RUNNING"] },
              },
              data: {
                status: "CANCELLED",
                completedAt: new Date(),
                leaseExpiresAt: null,
              },
            });
            await update(
              tx,
              project.id,
              team ? "Request declined" : "Request withdrawn",
              input.reason,
              team ? "TEAM" : "CUSTOMER",
            );
          }
          return { saved: true };
        });
      },
    );
  }
  app.post(
    "/v1/operator/projects/:id/cancellation/resume/propose",
    async (request) => {
      const account = await actor(request, true),
        input = z.object({ version }).strict().parse(request.body);
      return prisma.$transaction(async (tx) => {
        const project = await projectFor(account, projectId(request), true, tx);
        if (
          !project.cancellationRequestedAt ||
          terminal.includes(project.stage)
        )
          throw new AppError(
            409,
            "CANCELLATION_REQUIRED",
            "This project has no pending cancellation.",
          );
        if (project.resumeProposedAt) return { saved: true };
        await touch(tx, project, input.version, {
          resumeProposedAt: new Date(),
        });
        await update(
          tx,
          project.id,
          "Continue the original agreement?",
          "The team offers to withdraw this cancellation and continue the existing approved scope, price and payment schedule. Customer confirmation is required. Financial holds still apply.",
        );
        return { saved: true };
      });
    },
  );
  app.post("/v1/projects/:id/cancellation/resume/accept", async (request) => {
    const account = await actor(request),
      input = z
        .object({ version, consent: z.literal(true) })
        .strict()
        .parse(request.body);
    return prisma.$transaction(async (tx) => {
      const project = await projectFor(account, projectId(request), false, tx);
      if (
        !project.cancellationRequestedAt &&
        project.version === input.version + 1 &&
        (await tx.projectUpdate.findFirst({
          where: { projectId: project.id, title: "Original agreement resumed" },
        }))
      )
        return { saved: true };
      if (!project.resumeProposedAt || terminal.includes(project.stage))
        throw new AppError(
          409,
          "RESUME_AGREEMENT_REQUIRED",
          "The team must offer to resume the original agreement first.",
        );
      await touch(tx, project, input.version, {
        cancellationRequestedAt: null,
        cancellationReason: null,
        resumeProposedAt: null,
        settlementSummary: null,
        settlementRetainedCents: null,
        settlementProposedAt: null,
        settlementAcceptedAt: null,
      });
      await update(
        tx,
        project.id,
        "Original agreement resumed",
        "The customer and team agreed to continue the original approved scope, price and payment schedule. Previous settlement offers are retired. Financial holds and AI-review consent still apply.",
        "CUSTOMER",
      );
      return { saved: true };
    });
  });
  app.post("/v1/operator/projects/:id/settlement/propose", async (request) => {
    const account = await actor(request, true),
      input = z
        .object({
          version,
          summary: reason,
          retainedCents: z.number().int().min(0).max(600_000_000),
        })
        .strict()
        .parse(request.body);
    return prisma.$transaction(async (tx) => {
      const project = await projectFor(account, projectId(request), true, tx);
      if (!project.cancellationRequestedAt || terminal.includes(project.stage))
        throw new AppError(
          409,
          "SETTLEMENT_REQUEST_REQUIRED",
          "Record a cancellation request before proposing its settlement.",
        );
      if (
        project.settlementSummary === input.summary &&
        project.settlementRetainedCents === input.retainedCents
      )
        return { saved: true };
      await touch(tx, project, input.version, {
        settlementSummary: input.summary,
        settlementRetainedCents: input.retainedCents,
        settlementProposedAt: new Date(),
        settlementAcceptedAt: null,
        resumeProposedAt: null,
      });
      await update(
        tx,
        project.id,
        "Cancellation settlement proposed",
        input.summary,
      );
      return { saved: true };
    });
  });
  app.post("/v1/projects/:id/settlement/accept", async (request) => {
    const account = await actor(request),
      input = z
        .object({ version, consent: z.literal(true) })
        .strict()
        .parse(request.body);
    return prisma.$transaction(async (tx) => {
      const project = await projectFor(account, projectId(request), false, tx);
      if (project.settlementAcceptedAt) return { saved: true };
      if (!project.settlementProposedAt || terminal.includes(project.stage))
        throw new AppError(
          409,
          "SETTLEMENT_REQUIRED",
          "Review the current cancellation settlement first.",
        );
      await touch(tx, project, input.version, {
        settlementAcceptedAt: new Date(),
      });
      await update(
        tx,
        project.id,
        "Cancellation settlement accepted",
        "The customer agreed the written cancellation settlement. The team will resolve and verify payments before closing it.",
        "CUSTOMER",
      );
      return { saved: true };
    });
  });
  app.post("/v1/operator/projects/:id/settle", async (request) => {
    const account = await actor(request, true),
      input = z
        .object({
          version,
          summary: reason,
          retainedCents: z.number().int().min(0).max(600_000_000),
          consent: z.literal(true),
        })
        .strict()
        .parse(request.body);
    const project = await projectFor(account, projectId(request), true);
    if (
      project.stage === "CANCELLED" &&
      project.settlementSummary === input.summary
    )
      return { saved: true };
    if (
      !project.cancellationRequestedAt ||
      terminal.includes(project.stage) ||
      project.version !== input.version
    )
      throw new AppError(
        409,
        "SETTLEMENT_REQUEST_REQUIRED",
        "Refresh this project and record the customer's cancellation request first.",
      );
    if (
      !project.settlementAcceptedAt ||
      project.settlementSummary !== input.summary ||
      project.settlementRetainedCents !== input.retainedCents
    )
      throw new AppError(
        409,
        "SETTLEMENT_AGREEMENT_REQUIRED",
        "The customer must accept these exact settlement terms before final closure.",
      );
    const attempts = await prisma.paymentAttempt.findMany({
      where: { milestone: { proposal: { projectId: project.id } } },
    });
    let expectedVersion = input.version;
    for (const attempt of attempts) {
      if (!attempt.stripeSessionId || attempt.mode !== provider.mode)
        throw new AppError(
          409,
          "SETTLEMENT_PAYMENT_PENDING",
          "Reconcile every payment in its original mode before settlement.",
        );
      const checkout = await provider.retrieve(attempt.stripeSessionId);
      // Unpaid collection must be expired explicitly in payment management.
      if (
        checkout.status === "open" ||
        (checkout.status === "complete" && !checkout.paid)
      )
        throw new AppError(
          409,
          "SETTLEMENT_PAYMENT_PENDING",
          "Expire open Checkout sessions and resolve processing payments before settlement.",
        );
      await reconcile(checkout, attempt);
      expectedVersion++;
    }
    return prisma.$transaction(async (tx) => {
      const fresh = await projectFor(account, project.id, true, tx);
      if (fresh.version !== expectedVersion)
        throw new AppError(
          409,
          "PROJECT_CHANGED",
          "This project changed during settlement. Refresh and review its current finances.",
        );
      const proposalIds = await tx.proposal.findMany({
        where: { projectId: project.id },
        select: { id: true },
      });
      const unresolved = (
        await Promise.all(proposalIds.map((p) => unresolvedPayments(tx, p.id)))
      ).reduce((a, b) => a + b, 0);
      const finances = await tx.paymentAttempt.findMany({
        where: { milestone: { proposal: { projectId: project.id } } },
      });
      if (
        unresolved ||
        finances.some(
          (a) =>
            a.disputed || ["CREATING", "OPEN", "PROCESSING"].includes(a.status),
        )
      )
        throw new AppError(
          409,
          "SETTLEMENT_PAYMENT_PENDING",
          "Payment notifications, open sessions or disputes still need resolution.",
        );
      const net = finances
        .filter((a) => a.status === "PAID")
        .reduce((sum, a) => sum + a.amountCents - a.refundedCents, 0);
      if (net !== input.retainedCents)
        throw new AppError(
          409,
          "SETTLEMENT_AMOUNT_CHANGED",
          "The retained amount must match the reconciled payments after any Stripe refunds. No refund is issued here.",
        );
      await touch(tx, fresh, expectedVersion, {
        stage: "CANCELLED",
        settlementSummary: input.summary,
        settledAt: new Date(),
        aiReviewConsentAt: null,
        aiReviewConsentVersion: null,
      });
      await tx.reviewJob.updateMany({
        where: { projectId: fresh.id, status: { in: ["QUEUED", "RUNNING"] } },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
          leaseExpiresAt: null,
        },
      });
      await update(tx, fresh.id, "Cancellation settled", input.summary);
      return { saved: true };
    });
  });
  app.post("/v1/projects/:id/repository/refresh", async (request, reply) => {
    const account = await actor(request),
      input = z
        .object({ version, inspectionId: z.uuid(), consent: z.literal(true) })
        .strict()
        .parse(request.body);
    const connection = await session(request, reply);
    return prisma.$transaction(async (tx) => {
      const project = await projectFor(account, projectId(request), false, tx);
      if ((await accountFromRequest(tx, request))?.id !== account.id)
        throw new AppError(
          401,
          "SIGN_IN_REQUIRED",
          "Sign in again to refresh this repository.",
        );
      if (
        !["DRAFT", "IN_REVIEW", "AWAITING_APPROVAL"].includes(project.stage) ||
        (await tx.proposal.count({
          where: { projectId: project.id, approvedAt: { not: null } },
        }))
      )
        throw new AppError(
          409,
          "AGREED_BASELINE",
          "Approved scope keeps its agreed baseline. Share later changes as a follow-on request.",
        );
      if (project.version !== input.version)
        throw new AppError(
          409,
          "PROJECT_CHANGED",
          "Refresh this project before changing its baseline.",
        );
      const inspection = await tx.inspection.findFirst({
        where: {
          id: input.inspectionId,
          sessionId: connection.id,
          accountId: account.id,
        },
      });
      const report = z
        .object({ url: z.url(), commit: z.string().regex(/^[a-f0-9]{40}$/) })
        .passthrough()
        .safeParse(inspection?.report);
      if (!report.success || report.data.url !== project.repositoryUrl)
        throw new AppError(
          400,
          "SAME_REPOSITORY_REQUIRED",
          "Inspect the same repository in this browser before refreshing it.",
        );
      const live = await tx.reviewSession.updateMany({
        where: {
          id: connection.id,
          accountSessionId: connection.accountSessionId,
          expiresAt: { gt: new Date() },
          tokenEncrypted: connection.tokenEncrypted,
          tokenExpiresAt: { gt: new Date() },
          selectedInspectionId: input.inspectionId,
        },
        data: { selectedInspectionId: null },
      });
      if (
        !connection.tokenEncrypted ||
        !connection.githubLogin ||
        live.count !== 1
      )
        throw new AppError(
          409,
          "CONNECTION_CHANGED",
          "Reconnect GitHub and inspect this repository again.",
        );
      const old = z
        .object({ commit: z.string() })
        .passthrough()
        .safeParse(project.inspectionReport);
      if (old.success && old.data.commit === report.data.commit)
        return { saved: true, unchanged: true };
      await guardProposalRevision(tx, project.currentProposalId);
      if (old.success)
        await tx.repositoryRevision.upsert({
          where: {
            projectId_commit: {
              projectId: project.id,
              commit: old.data.commit,
            },
          },
          update: {},
          create: {
            projectId: project.id,
            commit: old.data.commit,
            report: project.inspectionReport!,
            reviewSummary: project.reviewSummary,
          },
        });
      await touch(tx, project, input.version, {
        inspectionReport: inspection!.report ?? Prisma.JsonNull,
        reviewSummary: null,
        currentProposalId: null,
        stage: "IN_REVIEW",
      });
      await tx.reviewJob.updateMany({
        where: { projectId: project.id, status: { in: ["QUEUED", "RUNNING"] } },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
          leaseExpiresAt: null,
        },
      });
      await update(
        tx,
        project.id,
        "Repository baseline refreshed",
        `Commit ${report.data.commit.slice(0, 7)} is ready for a fresh review. Earlier evidence and proposals remain in history.`,
        "CUSTOMER",
      );
      return { saved: true, unchanged: false };
    });
  });
  app.post(
    "/v1/operator/projects/:id/requests/:requestId/triage",
    async (request) => {
      const account = await actor(request, true),
        { requestId } = z
          .object({ requestId: z.uuid() })
          .passthrough()
          .parse(request.params);
      const input = z
        .object({
          version,
          status: z.enum([
            "INCLUDED_CORRECTION",
            "CORRECTION_IN_PROGRESS",
            "CORRECTION_RESOLVED",
            "FOLLOW_ON",
            "ANSWERED",
            "DECLINED",
          ]),
          reason,
        })
        .strict()
        .parse(request.body);
      return prisma.$transaction(async (tx) => {
        const project = await projectFor(account, projectId(request), true, tx),
          item = await tx.projectRequest.findFirst({
            where: { id: requestId, projectId: project.id },
          });
        if (!item)
          throw new AppError(
            404,
            "REQUEST_UNAVAILABLE",
            "This request is unavailable.",
          );
        if (item.status === input.status && item.triageReason === input.reason)
          return { saved: true };
        if (
          input.status.includes("CORRECTION") &&
          (!item.aftercareEligible || item.purpose !== "DEFECT")
        )
          throw new AppError(
            409,
            "CORRECTION_REVIEW",
            "Included aftercare requires a timely report against agreed checks. Use a separately agreed follow-on for other work.",
          );
        if (
          ["CORRECTION_IN_PROGRESS", "CORRECTION_RESOLVED"].includes(
            input.status,
          ) &&
          ![
            "INCLUDED_CORRECTION",
            "CORRECTION_IN_PROGRESS",
            "CORRECTION_RESOLVED",
          ].includes(item.status)
        )
          throw new AppError(
            409,
            "CORRECTION_REVIEW",
            "Assess this as an included correction before recording its work or verification result.",
          );
        await touch(tx, project, input.version);
        await tx.projectRequest.update({
          where: { id: item.id },
          data: {
            status: input.status,
            triageReason: input.reason,
            triagedAt: new Date(),
          },
        });
        await update(
          tx,
          project.id,
          "Request reviewed",
          `${item.title} · ${input.status.replaceAll("_", " ").toLowerCase()}: ${input.reason}`,
        );
        return { saved: true };
      });
    },
  );
  app.post("/v1/operator/projects/:id/handover", async (request) => {
    const account = await actor(request, true),
      input = z
        .object({
          version,
          summary: reason,
          artifacts: z.array(artifact).min(1).max(10),
          checks: reason,
          instructions: reason,
          limitations: reason,
          deployment: reason,
        })
        .strict()
        .parse(request.body);
    return prisma.$transaction(async (tx) => {
      const project = await projectFor(account, projectId(request), true, tx);
      if (project.stage !== "COMPLETE" || !project.currentProposalId)
        throw new AppError(
          409,
          "HANDOVER_STAGE",
          "Complete the agreed work and verification before publishing its handover.",
        );
      const published = await tx.handover.findUnique({
        where: { projectId: project.id },
      });
      if (
        published &&
        [
          "summary",
          "checks",
          "instructions",
          "limitations",
          "deployment",
        ].every(
          (key) => published[key as "summary"] === input[key as "summary"],
        ) &&
        JSON.stringify(published.artifacts) === JSON.stringify(input.artifacts)
      )
        return { saved: true };
      if (published)
        throw new AppError(
          409,
          "HANDOVER_PUBLISHED",
          "A published handover is retained. Add corrections in the conversation.",
        );
      await requirePaymentGate(
        tx,
        project.currentProposalId,
        "BEFORE_HANDOVER",
        provider.mode,
      );
      if (await unresolvedPayments(tx, project.currentProposalId))
        throw new AppError(
          409,
          "PAYMENT_RECONCILIATION_PENDING",
          "Reconcile payments before handover.",
        );
      await touch(tx, project, input.version);
      await tx.handover.create({
        data: {
          projectId: project.id,
          proposalId: project.currentProposalId,
          summary: input.summary,
          artifacts: input.artifacts,
          checks: input.checks,
          instructions: input.instructions,
          limitations: input.limitations,
          deployment: input.deployment,
        },
      });
      await update(
        tx,
        project.id,
        "Handover ready",
        "Review the delivered artifacts, actual check results, operating instructions and limitations. Confirm acceptance or report a failure of an agreed check.",
      );
      return { saved: true };
    });
  });
  app.post("/v1/projects/:id/accept", async (request) => {
    const account = await actor(request),
      input = z
        .object({ version, consent: z.literal(true) })
        .strict()
        .parse(request.body);
    return prisma.$transaction(async (tx) => {
      const project = await projectFor(account, projectId(request), false, tx);
      if (project.acceptedAt) return { saved: true };
      if (
        project.stage !== "COMPLETE" ||
        !(await tx.handover.findUnique({ where: { projectId: project.id } }))
      )
        throw new AppError(
          409,
          "HANDOVER_REQUIRED",
          "Review a published handover before accepting delivery.",
        );
      await touch(tx, project, input.version, { acceptedAt: new Date() });
      await update(
        tx,
        project.id,
        "Delivery accepted",
        "The customer confirmed delivery. Included aftercare still follows the agreed proposal conditions.",
        "CUSTOMER",
      );
      return { saved: true };
    });
  });
}
