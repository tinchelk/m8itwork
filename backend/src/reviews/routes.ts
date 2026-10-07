import { Prisma, type PrismaClient, type ReviewWorker } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { isOperator } from "../accounts.js";
import type { Env } from "../config.js";
import { decrypt, hash, secret } from "../crypto.js";
import type { GitHubClient } from "../github/client.js";
import { createProjectAccess, projectId } from "../project-access.js";
import { AppError } from "../shared/errors.js";
import { sourceSnapshot } from "./source.js";
import { REVIEW_POLICY, failureCodes, inputDigest, providers, reportSchema, type RequestSnapshot } from "./types.js";

const leaseMs = 120_000;
const leaseLost = () => new AppError(409, "LEASE_LOST", "This review attempt is no longer active.");
const reviewLock = (tx: Prisma.TransactionClient) => tx.$queryRaw`SELECT pg_advisory_xact_lock(814721)::text`;
async function snapshot(tx: Prisma.TransactionClient, id: string): Promise<RequestSnapshot> {
  const project = await tx.project.findUniqueOrThrow({ where: { id }, include: { requests: { orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100 } } });
  return { summary: project.summary, requests: project.requests.map(({ id, kind, title, detail }) => ({ id, kind, title, detail })) };
}
function bounded(input: RequestSnapshot): RequestSnapshot {
  return { summary: input.summary, requests: input.requests.slice(0, 20).map(r => ({ ...r, detail: r.detail.slice(0, 2000) })) };
}
const workerSelect = { id: true, name: true, createdAt: true, lastSeenAt: true, revokedAt: true } as const;
export async function pairWorker(prisma: PrismaClient, env: Env, githubId: string, name: string) {
  const operator = await prisma.account.findUnique({ where: { githubId } });
  if (!operator || !isOperator(operator, env)) throw new AppError(403, "OPERATOR_REQUIRED", "Only the project team can pair a worker.");
  const token = secret();
  const worker = await prisma.reviewWorker.create({ data: { name: z.string().trim().min(1).max(80).parse(name), tokenHash: hash(token), operatorId: operator.id }, select: workerSelect });
  return { worker, token };
}
export async function registerReviews(app: FastifyInstance, { prisma, env, github }: { prisma: PrismaClient; env: Env; github: GitHubClient }) {
  const { actor, projectFor, touch } = createProjectAccess(prisma, env);
  async function worker(request: FastifyRequest): Promise<ReviewWorker> {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? "");
    const found = match?.[1] ? await prisma.reviewWorker.findUnique({ where: { tokenHash: hash(match[1]) }, include: { operator: true } }) : null;
    if (!found || found.revokedAt || !isOperator(found.operator, env)) throw new AppError(401, "WORKER_REQUIRED", "Pair this worker again in the backoffice.");
    return found;
  }
  const params = (request: FastifyRequest) => z.object({ id: z.uuid() }).parse(request.params).id;
  const attempt = z.object({ attemptId: z.uuid() }).strict();
  async function active(tx: Prisma.TransactionClient, id: string, workerId: string, attemptId: string) {
    const job = await tx.reviewJob.findUnique({ where: { id }, include: { project: true, worker: { include: { operator: true } } } });
    if (!job || job.status !== "RUNNING" || job.workerId !== workerId || job.attemptId !== attemptId || !job.leaseExpiresAt || job.leaseExpiresAt <= new Date() || !job.startedAt || Date.now() - job.startedAt.getTime() > 10 * 60_000 || job.worker?.revokedAt || !job.worker || !isOperator(job.worker.operator, env) || !job.project.aiReviewConsentAt || job.project.aiReviewConsentVersion !== REVIEW_POLICY) throw leaseLost();
    const inspected = z.object({ commit: z.string() }).passthrough().safeParse(job.project.inspectionReport);
    if (job.project.repositoryUrl !== job.repositoryUrl || !inspected.success || inspected.data.commit !== job.commit) throw leaseLost();
    if (job.sourceSessionId) {
      const connection = await tx.reviewSession.findUnique({ where: { id: job.sourceSessionId } });
      const login = connection?.accountSessionId && await tx.accountSession.findFirst({ where: { id: connection.accountSessionId, accountId: job.project.accountId, expiresAt: { gt: new Date() } } });
      if (!connection?.tokenEncrypted || !login || connection.expiresAt <= new Date() || !connection.tokenExpiresAt || connection.tokenExpiresAt <= new Date() || hash(connection.tokenEncrypted) !== job.sourceConnectionHash) throw leaseLost();
    }
    return job;
  }
  app.get("/v1/operator/review-workers", async request => {
    await actor(request, true);
    return { workers: await prisma.reviewWorker.findMany({ select: workerSelect, orderBy: { createdAt: "desc" }, take: 30 }) };
  });
  app.post("/v1/operator/review-workers", async request => {
    const account = await actor(request, true);
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).strict().parse(request.body);
    return pairWorker(prisma, env, account.githubId!, name);
  });
  app.post("/v1/operator/review-workers/:id/revoke", async request => {
    await actor(request, true);
    return prisma.$transaction(async tx => {
      await reviewLock(tx);
      await tx.reviewWorker.updateMany({ where: { id: params(request) }, data: { revokedAt: new Date() } });
      await tx.reviewJob.updateMany({ where: { workerId: params(request), status: "RUNNING" }, data: { status: "CANCELLED", completedAt: new Date(), leaseExpiresAt: null } });
      return { saved: true };
    });
  });
  app.post("/v1/projects/:id/ai-review-consent", async request => {
    const account = await actor(request);
    const input = z.object({ version: z.number().int().positive(), consent: z.boolean(), policy: z.literal(REVIEW_POLICY) }).strict().parse(request.body);
    return prisma.$transaction(async tx => {
      await reviewLock(tx);
      const project = await projectFor(account, projectId(request), false, tx);
      await touch(tx, project, input.version, { aiReviewConsentAt: input.consent ? new Date() : null, aiReviewConsentVersion: input.consent ? REVIEW_POLICY : null });
      if (!input.consent) await tx.reviewJob.updateMany({ where: { projectId: project.id, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED", completedAt: new Date(), leaseExpiresAt: null } });
      return { saved: true };
    });
  });
  app.get("/v1/operator/projects/:id/review-jobs", async request => {
    const account = await actor(request, true);
    const project = await projectFor(account, projectId(request), true);
    const inspection = z.object({ commit: z.string() }).passthrough().safeParse(project.inspectionReport);
    const digest = inputDigest(await snapshot(prisma, project.id), project.repositoryUrl, inspection.success ? inspection.data.commit : null);
    const jobs = await prisma.reviewJob.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" }, take: 10 });
    return { jobs: jobs.map(job => ({ id: job.id, provider: job.provider, status: job.status, commit: job.commit, createdAt: job.createdAt, completedAt: job.completedAt, errorCode: job.errorCode, result: job.result, coverage: job.coverage, stale: job.inputDigest !== digest })), onlineWorkers: await prisma.reviewWorker.count({ where: { revokedAt: null, lastSeenAt: { gt: new Date(Date.now() - 60_000) } } }) };
  });
  app.post("/v1/operator/projects/:id/review-jobs", async request => {
    const account = await actor(request, true);
    const input = z.object({ id: z.uuid(), version: z.number().int().positive(), provider: providers }).strict().parse(request.body);
    return prisma.$transaction(async tx => {
      await reviewLock(tx);
      const project = await projectFor(account, projectId(request), true, tx);
      const existing = await tx.reviewJob.findUnique({ where: { id: input.id } });
      if (existing) {
        if (existing.projectId !== project.id || existing.provider !== input.provider) throw new AppError(409, "JOB_CONFLICT", "Start a new review request.");
        return { id: existing.id };
      }
      if (!project.aiReviewConsentAt || project.aiReviewConsentVersion !== REVIEW_POLICY) throw new AppError(409, "AI_CONSENT_REQUIRED", "The customer must allow AI-assisted review in their dashboard first.");
      const commit = z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/) }).passthrough().safeParse(project.inspectionReport);
      if (!project.repositoryUrl || !commit.success) throw new AppError(409, "REPOSITORY_REQUIRED", "Connect and inspect a repository first.");
      if (await tx.reviewJob.count({ where: { projectId: project.id, status: { in: ["QUEUED", "RUNNING"] } } })) throw new AppError(409, "REVIEW_ACTIVE", "This project already has a queued or running review.");
      await touch(tx, project, input.version);
      const full = await snapshot(tx, project.id);
      await tx.reviewJob.create({ data: { id: input.id, projectId: project.id, provider: input.provider, commit: commit.data.commit, repositoryUrl: project.repositoryUrl, inputDigest: inputDigest(full, project.repositoryUrl, commit.data.commit), requestSnapshot: bounded(full) } });
      return { id: input.id };
    });
  });
  app.post("/v1/operator/projects/:id/review-jobs/:jobId/cancel", async request => {
    const account = await actor(request, true);
    await projectFor(account, projectId(request), true);
    const jobId = z.object({ jobId: z.uuid() }).passthrough().parse(request.params).jobId;
    return prisma.$transaction(async tx => {
      await reviewLock(tx);
      await tx.reviewJob.updateMany({ where: { id: jobId, projectId: projectId(request), status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "CANCELLED", leaseExpiresAt: null, completedAt: new Date() } });
      return { saved: true };
    });
  });
  app.post("/v1/review-worker/claim", async request => {
    const owner = await worker(request);
    const input = z.object({ attemptId: z.uuid(), providers: z.array(providers).min(1).max(2) }).strict().parse(request.body);
    return prisma.$transaction(async tx => {
      await reviewLock(tx);
      const valid = await tx.reviewWorker.updateMany({ where: { id: owner.id, revokedAt: null }, data: { lastSeenAt: new Date() } });
      if (!valid.count) throw leaseLost();
      await tx.reviewJob.updateMany({ where: { status: "RUNNING", OR: [{ leaseExpiresAt: { lte: new Date() } }, { startedAt: { lte: new Date(Date.now() - 10 * 60_000) } }], attempts: { lt: 3 } }, data: { status: "QUEUED", leaseExpiresAt: null, workerId: null, attemptId: null, evidencePaths: Prisma.JsonNull, coverage: Prisma.JsonNull, sourceSessionId: null, sourceConnectionHash: null } });
      await tx.reviewJob.updateMany({ where: { status: "RUNNING", OR: [{ leaseExpiresAt: { lte: new Date() } }, { startedAt: { lte: new Date(Date.now() - 10 * 60_000) } }], attempts: { gte: 3 } }, data: { status: "FAILED", errorCode: "TIMEOUT", completedAt: new Date(), leaseExpiresAt: null } });
      const repeat = await tx.reviewJob.findUnique({ where: { attemptId: input.attemptId } });
      if (repeat) {
        if (repeat.workerId !== owner.id) throw leaseLost();
        if (repeat.status !== "RUNNING") return { job: null };
        await active(tx, repeat.id, owner.id, input.attemptId);
        return { job: { id: repeat.id, provider: repeat.provider, attemptId: input.attemptId } };
      }
      if (await tx.reviewJob.count({ where: { workerId: owner.id, status: "RUNNING" } })) return { job: null };
      const job = await tx.reviewJob.findFirst({ where: { status: "QUEUED", provider: { in: input.providers }, project: { aiReviewConsentAt: { not: null }, aiReviewConsentVersion: REVIEW_POLICY } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      if (!job) return { job: null };
      await tx.reviewJob.update({ where: { id: job.id }, data: { status: "RUNNING", workerId: owner.id, attemptId: input.attemptId, attempts: { increment: 1 }, startedAt: new Date(), leaseExpiresAt: new Date(Date.now() + leaseMs), errorCode: null } });
      return { job: { id: job.id, provider: job.provider, attemptId: input.attemptId } };
    });
  });
  app.post("/v1/review-worker/jobs/:id/heartbeat", async request => {
    const owner = await worker(request), input = attempt.parse(request.body);
    return prisma.$transaction(async tx => {
      await reviewLock(tx);
      await active(tx, params(request), owner.id, input.attemptId);
      await tx.reviewJob.update({ where: { id: params(request) }, data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } });
      await tx.reviewWorker.update({ where: { id: owner.id }, data: { lastSeenAt: new Date() } });
      return { saved: true };
    });
  });
  app.post("/v1/review-worker/jobs/:id/context", async request => {
    const owner = await worker(request), input = attempt.parse(request.body);
    const job = await prisma.$transaction(tx => active(tx, params(request), owner.id, input.attemptId));
    const sessions = await prisma.accountSession.findMany({ where: { accountId: job.project.accountId, expiresAt: { gt: new Date() } }, select: { id: true } });
    const connection = await prisma.reviewSession.findFirst({ where: { accountSessionId: { in: sessions.map(s => s.id) }, expiresAt: { gt: new Date() }, tokenExpiresAt: { gt: new Date() }, tokenEncrypted: { not: null } }, orderBy: { createdAt: "desc" } });
    if (!connection?.tokenEncrypted || !job.project.repositoryUrl) throw new AppError(409, "GITHUB_CONNECTION_REQUIRED", "The customer needs to reconnect GitHub.");
    await prisma.$transaction(async tx => {
      await reviewLock(tx);
      await active(tx, job.id, owner.id, input.attemptId);
      await tx.reviewJob.update({ where: { id: job.id }, data: { sourceSessionId: connection.id, sourceConnectionHash: hash(connection.tokenEncrypted!) } });
    });
    const source = await sourceSnapshot(github, job.repositoryUrl, job.commit, decrypt(connection.tokenEncrypted, env.TOKEN_ENCRYPTION_KEY), () => prisma.$transaction(tx => active(tx, job.id, owner.id, input.attemptId)));
    source.coverage.limitations.push("Customer requests are limited to the latest 20 entries, shortened to 2,000 characters each.");
    await prisma.$transaction(async tx => {
      await reviewLock(tx);
      await active(tx, job.id, owner.id, input.attemptId);
      // Check that the same connection is still live after source retrieval.
      const live = await tx.reviewSession.findFirst({ where: { id: connection.id, tokenEncrypted: connection.tokenEncrypted, expiresAt: { gt: new Date() }, tokenExpiresAt: { gt: new Date() }, accountSessionId: connection.accountSessionId } });
      const login = connection.accountSessionId && await tx.accountSession.findFirst({ where: { id: connection.accountSessionId, accountId: job.project.accountId, expiresAt: { gt: new Date() } } });
      if (!live || !login) throw leaseLost();
      await tx.reviewJob.update({ where: { id: job.id }, data: { sourceSessionId: connection.id, sourceConnectionHash: hash(connection.tokenEncrypted!), evidencePaths: source.files.map(f => f.path), coverage: source.coverage } });
    });
    return { source, request: job.requestSnapshot };
  });
  app.post("/v1/review-worker/jobs/:id/complete", { bodyLimit: 512_000 }, async request => {
    const owner = await worker(request);
    const input = z.object({ attemptId: z.uuid(), report: reportSchema }).strict().parse(request.body);
    return prisma.$transaction(async tx => {
      await reviewLock(tx);
      const prior = await tx.reviewJob.findUnique({ where: { id: params(request) } });
      if (prior?.status === "SUCCEEDED" && prior.workerId === owner.id && prior.attemptId === input.attemptId) return { saved: true };
      const job = await active(tx, params(request), owner.id, input.attemptId);
      const paths = z.array(z.string()).parse(job.evidencePaths);
      if (!paths.length || input.report.findings.some(f => !f.evidence.length || f.evidence.some(p => !paths.includes(p)))) throw new AppError(400, "INVALID_EVIDENCE", "Findings must cite files provided in this review.");
      await tx.reviewJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", result: input.report, completedAt: new Date(), leaseExpiresAt: null } });
      return { saved: true };
    });
  });
  app.post("/v1/review-worker/jobs/:id/fail", async request => {
    const owner = await worker(request);
    const input = z.object({ attemptId: z.uuid(), code: failureCodes }).strict().parse(request.body);
    return prisma.$transaction(async tx => {
      await reviewLock(tx);
      await active(tx, params(request), owner.id, input.attemptId);
      await tx.reviewJob.update({ where: { id: params(request) }, data: { status: "FAILED", errorCode: input.code, completedAt: new Date(), leaseExpiresAt: null } });
      return { saved: true };
    });
  });
}
