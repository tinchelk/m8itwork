import { Prisma, type PrismaClient, type ReviewSession } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createProjectAccess, projectId } from "./project-access.js";
import {
  guardProposalRevision,
  milestoneSelect,
  paymentPlan,
  planSchema,
  requirePaymentGate,
} from "./payment-rules.js";
import { registerCollaboration } from "./collaboration.js";
import { registerPayments } from "./payments.js";
import type { registerBilling } from "./billing.js";
import type { PaymentProvider } from "./stripe-provider.js";
import { isAppOrigin, type Env } from "./config.js";
import { AppError } from "./shared/errors.js";
import { accountFromRequest } from "./accounts.js";
import { REVIEW_POLICY } from "./reviews/types.js";

const reference = z
  .union([
    z.literal(""),
    z
      .url()
      .max(500)
      .refine((value) => {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password
        );
      }),
  ])
  .optional();
const version = z.number().int().positive();
const stages = [
  "DRAFT",
  "IN_REVIEW",
  "AWAITING_APPROVAL",
  "APPROVED",
  "BUILDING",
  "VERIFYING",
  "COMPLETE",
] as const;
const include = {
  requests: { orderBy: { createdAt: "desc" as const }, take: 100 },
  proposals: {
    orderBy: { version: "desc" as const },
    take: 30,
    include: {
      milestones: {
        orderBy: { position: "asc" as const },
        select: milestoneSelect,
      },
    },
  },
  workItems: { orderBy: { createdAt: "asc" as const }, take: 100 },
  updates: { orderBy: { createdAt: "desc" as const }, take: 100 },
};
const unavailable = () =>
  new AppError(
    404,
    "PROJECT_UNAVAILABLE",
    "This project isn't available to your account.",
  );
const conflict = () =>
  new AppError(
    409,
    "PROJECT_CHANGED",
    "This project changed. Refresh it, check the latest details, and try again. Your input is still here.",
  );

export async function registerWorkspace(
  app: FastifyInstance,
  options: {
    prisma: PrismaClient;
    paymentProvider: PaymentProvider;
    billing?: Awaited<ReturnType<typeof registerBilling>>;
    env: Env;
    session: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<ReviewSession>;
  },
) {
  const { prisma, env, session } = options;
  app.addHook("onRequest", async (request) => {
    if (
      request.method === "POST" &&
      /^\/v1\/(projects|operator)\b/.test(request.url) &&
      !isAppOrigin(env, request.headers.origin)
    ) {
      throw new AppError(
        403,
        "ORIGIN_NOT_ALLOWED",
        "Request origin is not allowed.",
      );
    }
  });
  const access = createProjectAccess(prisma, env);
  const { actor, projectFor, touch, update } = access;
  const id = projectId;
  const listSelect = {
    id: true,
    name: true,
    stage: true,
    updatedAt: true,
    repositoryUrl: true,
    reviewSummary: true,
    customerLastMessageAt: true,
    teamLastMessageAt: true,
    customerReadAt: true,
    teamReadAt: true,
    currentProposalId: true,
  };
  app.get("/v1/projects", async (request) => {
    const account = await actor(request);
    return {
      projects: (
        await prisma.project.findMany({
          where: { accountId: account.id },
          select: {
            ...listSelect,
            proposals: {
              orderBy: { version: "desc" },
              take: 1,
              select: {
                id: true,
                amountCents: true,
                currency: true,
                approvedAt: true,
                milestones: { select: milestoneSelect, orderBy: { position: "asc" } },
              },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 100,
        })
      ).map((project) => ({
        ...project,
        billingMode: options.paymentProvider.mode,
      })),
    };
  });
  app.get("/v1/operator/projects", async (request) => {
    await actor(request, true);
    return {
      projects: (
        await prisma.project.findMany({
          select: {
            ...listSelect,
            account: { select: { githubLogin: true, displayName: true } },
            proposals: {
              orderBy: { version: "desc" },
              take: 1,
              select: {
                id: true,
                amountCents: true,
                currency: true,
                approvedAt: true,
                milestones: {
                  select: milestoneSelect,
                  orderBy: { position: "asc" },
                },
              },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 100,
        })
      ).map((project) => ({
        ...project,
        billingMode: options.paymentProvider.mode,
      })),
    };
  });
  for (const operator of [false, true]) {
    const prefix = operator ? "/v1/operator/projects" : "/v1/projects";
    app.get(`${prefix}/:id`, async (request) => {
      const account = await actor(request, operator);
      const project = await projectFor(account, id(request), operator);
      const detail = await prisma.project.findUniqueOrThrow({
        where: { id: project.id },
        include: {
          ...include,
          ...(operator
            ? { notes: { orderBy: { createdAt: "desc" as const }, take: 30 } }
            : {}),
        },
      });
      return {
        ...detail,
        billing: {
          enabled: options.paymentProvider.enabled,
          mode: options.paymentProvider.mode,
        },
      };
    });
  }
  app.post("/v1/projects", async (request, reply) => {
    const account = await actor(request);
    const legacyInput = z
      .object({
        id: z.uuid(),
        name: z.string().trim().min(1).max(120),
        contactEmail: z.email().max(254),
        platform: z.enum(["Lovable", "Base44", "Bolt", "Replit", "Other"]),
        demoUrl: reference,
        summary: z.string().trim().min(20).max(5000),
        accessNote: z.string().trim().max(1000).optional(),
        consent: z.literal(true),
      })
      .strict();
    const input = z.union([
      z.object({
        id: z.uuid(),
        inspectionId: z.uuid(),
        reviewConsent: z.literal(REVIEW_POLICY).optional(),
        summary: z.string().trim().min(10).max(5000),
        consent: z.literal(true),
      }).strict(),
      legacyInput,
    ]).parse(request.body);
    if ("inspectionId" in input) {
      const current = await session(request, reply);
      const project = await prisma.$transaction(async transaction => {
        // One request ID creates one project, including concurrent retries.
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.id}, 0))::text`;
        const active = await accountFromRequest(transaction, request);
        if (active?.id !== account.id)
          throw new AppError(401, "SIGN_IN_REQUIRED", "Sign in again to send your request. Your input is still here.");
        const existing = await transaction.project.findUnique({ where: { id: input.id } });
        if (existing && existing.accountId !== account.id) throw unavailable();
        const inspection = await transaction.inspection.findFirst({
          where: { id: input.inspectionId, sessionId: current.id, accountId: account.id },
        });
        if (!inspection)
          throw new AppError(400, "INSPECTION_UNAVAILABLE", "Check this repository in your current browser before sending it.");
        const report = z.object({ url: z.url(), repository: z.string(), commit: z.string() }).passthrough().parse(inspection.report);
        if (existing) {
          if (existing.summary !== input.summary || existing.repositoryUrl !== report.url)
            throw new AppError(409, "REQUEST_ALREADY_SAVED", "Your earlier request is already saved. Open it to add these changes in the conversation. Your edited input is still here.");
          return existing;
        }
        if (!current.githubLogin || !current.tokenEncrypted || !current.tokenExpiresAt || current.tokenExpiresAt <= new Date())
          throw new AppError(400, "GITHUB_CONNECTION_REQUIRED", "Reconnect GitHub, then send your request. Your input is still here.");
        const locked = await transaction.reviewSession.updateMany({
          where: {
            id: current.id,
            accountSessionId: current.accountSessionId,
            expiresAt: { gt: new Date() },
            tokenEncrypted: current.tokenEncrypted,
            tokenExpiresAt: { gt: new Date() },
            selectedInspectionId: input.inspectionId,
          },
          data: { selectedInspectionId: null },
        });
        if (locked.count !== 1)
          throw new AppError(409, "CONNECTION_CHANGED", "Your GitHub connection or repository selection changed. Refresh repositories and try again.");
        return transaction.project.create({
          data: {
            id: input.id,
            accountId: account.id,
            name: report.repository.split("/").at(-1)!.slice(0, 120),
            contactEmail: active.email ?? "",
            platform: "GitHub",
            summary: input.summary,
            ...(input.reviewConsent ? { aiReviewConsentAt: new Date(), aiReviewConsentVersion: REVIEW_POLICY } : {}),
            repositoryUrl: report.url,
            inspectionReport: inspection.report ?? Prisma.JsonNull,
            stage: "IN_REVIEW",
            updates: { create: {
              author: "CUSTOMER",
              title: "Request sent for review",
              detail: `${report.repository} shared for read-only review. We’ll review the request before proposing scope, delivery, and cost.`,
            } },
          },
        });
      });
      return reply.code(201).send({ id: project.id });
    }
    const project = await prisma.project.upsert({
      where: { id: input.id },
      update: {},
      create: {
        id: input.id,
        accountId: account.id,
        name: input.name,
        contactEmail: input.contactEmail.toLowerCase(),
        platform: input.platform,
        demoUrl: input.demoUrl || null,
        summary: input.summary,
        accessNote: input.accessNote || null,
        updates: {
          create: {
            author: "CUSTOMER",
            title: "Project started",
            detail:
              "Share a demo and requests, or connect a repository, then submit for our review.",
          },
        },
      },
    });
    if (project.accountId !== account.id) throw unavailable();
    return reply.code(201).send({ id: project.id });
  });
  app.post("/v1/projects/:id/repository", async (request, reply) => {
    const account = await actor(request);
    const input = z
      .object({ version, inspectionId: z.uuid() })
      .strict()
      .parse(request.body);
    const current = await session(request, reply);
    return prisma.$transaction(async (transaction) => {
      const project = await projectFor(
        account,
        id(request),
        false,
        transaction,
      );
      if (project.stage !== "DRAFT")
        throw new AppError(
          409,
          "REVIEW_STARTED",
          "Repository changes need a new review. Add a request so we can agree on the change.",
        );
      const inspection = await transaction.inspection.findFirst({
        where: {
          id: input.inspectionId,
          sessionId: current.id,
          accountId: account.id,
        },
      });
      if (!inspection)
        throw new AppError(
          400,
          "INSPECTION_UNAVAILABLE",
          "Inspect this repository in your current browser before linking it.",
        );
      const report = z
        .object({ url: z.url(), repository: z.string(), commit: z.string() })
        .passthrough()
        .parse(inspection.report);
      await touch(transaction, project, input.version, {
        repositoryUrl: report.url,
        inspectionReport: inspection.report ?? Prisma.JsonNull,
      });
      await update(
        transaction,
        project.id,
        "Repository linked",
        `${report.repository} · commit ${report.commit.slice(0, 7)}. Static inventory saved; workflows still need review.`,
        "CUSTOMER",
      );
      return { saved: true };
    });
  });
  app.post(
    "/v1/projects/:id/requests",
    { bodyLimit: 32_000 },
    async (request, reply) => {
      const account = await actor(request);
      const input = z
        .object({
          version,
          kind: z.enum(["ISSUE", "FEATURE", "SUGGESTION", "PRD", "QUESTION"]),
          title: z.string().trim().min(3).max(160),
          detail: z.string().trim().min(10).max(20_000),
          referenceUrl: reference,
        })
        .strict()
        .parse(request.body);
      const result = await prisma.$transaction(async (transaction) => {
        const project = await projectFor(
          account,
          id(request),
          false,
          transaction,
        );
        await touch(transaction, project, input.version);
        const item = await transaction.projectRequest.create({
          data: {
            projectId: project.id,
            kind: input.kind,
            title: input.title,
            detail: input.detail,
            referenceUrl: input.referenceUrl || null,
          },
        });
        await update(
          transaction,
          project.id,
          "Customer request added",
          input.title,
          "CUSTOMER",
        );
        return { id: item.id };
      });
      return reply.code(201).send(result);
    },
  );
  app.post("/v1/projects/:id/access", async (request) => {
    const account = await actor(request);
    const input = z
      .object({ version, accessNote: z.string().trim().min(10).max(1000) })
      .strict()
      .parse(request.body);
    return prisma.$transaction(async (transaction) => {
      const project = await projectFor(
        account,
        id(request),
        false,
        transaction,
      );
      if (project.stage !== "DRAFT") throw conflict();
      await touch(transaction, project, input.version, {
        accessNote: input.accessNote,
      });
      await update(
        transaction,
        project.id,
        "Access constraints shared",
        input.accessNote,
        "CUSTOMER",
      );
      return { saved: true };
    });
  });
  app.post("/v1/projects/:id/submit", async (request) => {
    const account = await actor(request);
    const input = z.object({ version }).strict().parse(request.body);
    return prisma.$transaction(async (transaction) => {
      const project = await projectFor(
        account,
        id(request),
        false,
        transaction,
      );
      if (project.stage !== "DRAFT") throw conflict();
      if (!project.repositoryUrl && !project.demoUrl && !project.accessNote)
        throw new AppError(
          400,
          "ACCESS_REQUIRED",
          "Share a demo, connect a repository, or tell us what access you can provide.",
        );
      await touch(transaction, project, input.version, { stage: "IN_REVIEW" });
      await update(
        transaction,
        project.id,
        "Ready for our review",
        "We'll review the app and requests before proposing scope, cost, and a delivery estimate.",
        "CUSTOMER",
      );
      return { submitted: true };
    });
  });
  app.post("/v1/operator/projects/:id/review", async (request) => {
    const account = await actor(request, true);
    const input = z
      .object({ version, summary: z.string().trim().min(20).max(5000) })
      .strict()
      .parse(request.body);
    return prisma.$transaction(async (transaction) => {
      const project = await projectFor(account, id(request), true, transaction);
      if (
        !["IN_REVIEW", "AWAITING_APPROVAL", "APPROVED"].includes(project.stage)
      )
        throw new AppError(
          409,
          "REVIEW_STAGE",
          "Publish the review after submission and before development begins.",
        );
      await touch(transaction, project, input.version, {
        reviewSummary: input.summary,
      });
      await update(transaction, project.id, "Our review", input.summary);
      return { saved: true };
    });
  });
  app.post("/v1/operator/projects/:id/proposals", async (request, reply) => {
    const account = await actor(request, true);
    const input = z
      .object({
        version,
        scope: z.string().trim().min(20).max(5000),
        acceptance: z.string().trim().min(20).max(3000),
        amountCents: z.number().int().min(100).max(100_000_000),
        paymentPlan: planSchema.optional(),
        currency: z.enum(["USD", "EUR", "GBP", "CAD", "AUD"]),
        deliveryDate: z.iso
          .date()
          .refine(
            (date) => date >= new Date().toISOString().slice(0, 10),
            "Use a current or future delivery estimate.",
          ),
        assumptions: z.string().trim().min(20).max(3000),
      })
      .strict()
      .parse(request.body);
    const installments = paymentPlan(input.paymentPlan, input.amountCents);
    const result = await prisma.$transaction(async (transaction) => {
      const project = await projectFor(account, id(request), true, transaction);
      if (
        !project.reviewSummary ||
        !["IN_REVIEW", "AWAITING_APPROVAL", "APPROVED"].includes(project.stage)
      )
        throw new AppError(
          409,
          "REVIEW_REQUIRED",
          "Publish our review before proposing scope, cost, and delivery. Active development needs a separately agreed change of scope.",
        );
      await touch(transaction, project, input.version, {
        stage: "AWAITING_APPROVAL",
      });
      await guardProposalRevision(transaction, project.currentProposalId);
      const latest = await transaction.proposal.findFirst({
        where: { projectId: project.id },
        orderBy: { version: "desc" },
      });
      const proposal = await transaction.proposal.create({
        data: {
          projectId: project.id,
          version: (latest?.version ?? 0) + 1,
          scope: input.scope,
          acceptance: input.acceptance,
          amountCents: input.amountCents,
          currency: input.currency,
          deliveryDate: new Date(`${input.deliveryDate}T00:00:00Z`),
          assumptions: input.assumptions,
          milestones: { create: installments },
        },
      });
      await transaction.project.update({
        where: { id: project.id },
        data: { currentProposalId: proposal.id },
      });
      await update(
        transaction,
        project.id,
        `Proposal v${proposal.version} ready`,
        "Review the scope, acceptance checks, estimated delivery, cost, and assumptions. A revised proposal needs fresh approval.",
      );
      return { id: proposal.id };
    });
    return reply.code(201).send(result);
  });
  app.post("/v1/projects/:id/approve", async (request) => {
    const account = await actor(request);
    const input = z
      .object({ version, proposalId: z.uuid(), consent: z.literal(true) })
      .strict()
      .parse(request.body);
    return prisma.$transaction(async (transaction) => {
      const project = await projectFor(
        account,
        id(request),
        false,
        transaction,
      );
      if (
        project.stage !== "AWAITING_APPROVAL" ||
        project.currentProposalId !== input.proposalId
      )
        throw conflict();
      const proposal = await transaction.proposal.findFirst({
        where: { id: input.proposalId, projectId: project.id },
      });
      if (!proposal) throw conflict();
      if (
        proposal.deliveryDate.toISOString().slice(0, 10) <
        new Date().toISOString().slice(0, 10)
      )
        throw new AppError(
          409,
          "ESTIMATE_EXPIRED",
          "This delivery estimate has passed. Ask the team for an updated proposal before approving.",
        );
      await touch(transaction, project, input.version, { stage: "APPROVED" });
      await transaction.proposal.update({
        where: { id: proposal.id },
        data: { approvedAt: new Date() },
      });
      await transaction.paymentMilestone.updateMany({
        where: { proposalId: proposal.id, position: 0, releasedAt: null },
        data: { releasedAt: new Date() },
      });
      await update(
        transaction,
        project.id,
        `Scope v${proposal.version} approved`,
        "Scope, estimate, and payment schedule confirmed. The first installment is due before work starts.",
        "CUSTOMER",
      );
      return { approved: true };
    });
  });
  app.post("/v1/operator/projects/:id/progress", async (request) => {
    const account = await actor(request, true);
    const input = z
      .object({
        version,
        stage: z.enum(stages),
        title: z.string().trim().min(3).max(160),
        detail: z.string().trim().min(10).max(5000),
        verificationSummary: z.string().trim().min(20).max(5000).optional(),
      })
      .strict()
      .parse(request.body);
    return prisma.$transaction(async (transaction) => {
      const project = await projectFor(account, id(request), true, transaction);
      const next: Record<string, string[]> = {
        DRAFT: [],
        IN_REVIEW: [],
        AWAITING_APPROVAL: [],
        APPROVED: ["BUILDING"],
        BUILDING: ["VERIFYING"],
        VERIFYING: ["BUILDING", "COMPLETE"],
        COMPLETE: [],
      };
      if (
        input.stage !== project.stage &&
        !next[project.stage]?.includes(input.stage)
      )
        throw new AppError(
          409,
          "STAGE_ORDER",
          "Follow the agreed scope, build, and verification steps in order.",
        );
      if (["BUILDING", "VERIFYING", "COMPLETE"].includes(input.stage)) {
        const proposal = project.currentProposalId
          ? await transaction.proposal.findUnique({
              where: { id: project.currentProposalId },
            })
          : null;
        if (!proposal?.approvedAt)
          throw new AppError(
            409,
            "APPROVAL_REQUIRED",
            "The current proposal must be approved before development starts.",
          );
      }
      if (["BUILDING", "VERIFYING", "COMPLETE"].includes(input.stage))
        await requirePaymentGate(
          transaction,
          project.currentProposalId!,
          input.stage === "BUILDING"
            ? "BEFORE_BUILD"
            : input.stage === "VERIFYING"
              ? "BEFORE_VERIFY"
              : "BEFORE_HANDOVER",
          options.paymentProvider.mode,
        );
      if (
        input.stage === "COMPLETE" &&
        (await transaction.workItem.count({
          where: { projectId: project.id, status: { not: "DONE" } },
        }))
      )
        throw new AppError(
          409,
          "WORK_INCOMPLETE",
          "Finish or resolve every delivery item before handover.",
        );
      if (
        input.stage === "COMPLETE" &&
        !input.verificationSummary &&
        !project.verificationSummary
      )
        throw new AppError(
          400,
          "VERIFICATION_REQUIRED",
          "Record the acceptance checks and handover evidence before completing the project.",
        );
      await touch(transaction, project, input.version, {
        stage: input.stage,
        ...(input.verificationSummary
          ? { verificationSummary: input.verificationSummary }
          : {}),
      });
      await update(transaction, project.id, input.title, input.detail);
      return { saved: true };
    });
  });
  await registerCollaboration(app, {
    prisma,
    access,
    paymentMode: () => options.paymentProvider.mode,
  });
  await registerPayments(app, {
    prisma,
    env,
    access,
    provider: options.paymentProvider,
    ...(options.billing ? { billing: options.billing } : {}),
  });
}
