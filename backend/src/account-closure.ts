import { retireIdentities } from "./identity-fences.js";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ACCOUNT_COOKIE, accountFromRequest, isOperator } from "./accounts.js";
import { lockAccount, revokeAccount } from "./customer-auth.js";
import type { Env } from "./config.js";
import { hash } from "./crypto.js";
import { AppError } from "./shared/errors.js";
import { reviewLock } from "./reviews/lock.js";
import { unresolvedPayments } from "./financial-lock.js";

const receiptInput = z
  .object({ accountId: z.uuid(), requestId: z.uuid() })
  .strict();
const receiptKey = (id: string) => hash(`account-close:${id}`);
export async function registerAccountClosure(
  app: FastifyInstance,
  prisma: PrismaClient,
  env: Env,
) {
  const origin = (value: string | undefined) => {
    if (value !== env.FRONTEND_ORIGIN)
      throw new AppError(
        403,
        "ORIGIN_NOT_ALLOWED",
        "Request origin is not allowed.",
      );
  };
  app.post("/v1/auth/account/close/status", async (request, reply) => {
    origin(request.headers.origin);
    const input = receiptInput.parse(request.body);
    const receipt = await prisma.accountClosure.findFirst({
      where: {
        id: receiptKey(input.requestId),
        accountId: input.accountId,
        expiresAt: { gt: new Date() },
        account: { closedAt: { not: null } },
      },
    });
    if (receipt && !(await accountFromRequest(prisma, request))) {
      reply.clearCookie(ACCOUNT_COOKIE, { path: "/" });
      reply.clearCookie("m8_review_session", { path: "/" });
    }
    return { closed: Boolean(receipt) };
  });
  app.post("/v1/auth/account/close", async (request, reply) => {
    origin(request.headers.origin);
    const input = receiptInput
      .extend({ confirmation: z.literal("CLOSE") })
      .parse(request.body);
    const actor = await accountFromRequest(prisma, request);
    if (actor && actor.id !== input.accountId)
      throw new AppError(
        409,
        "ACCOUNT_CHANGED",
        "Your signed-in account changed. Refresh Account before closing it.",
      );
    await prisma.$transaction(
      async (tx) => {
        await lockAccount(tx, input.accountId);
        const receipt = await tx.accountClosure.findFirst({
          where: {
            id: receiptKey(input.requestId),
            accountId: input.accountId,
            expiresAt: { gt: new Date() },
            account: { closedAt: { not: null } },
          },
        });
        if (receipt) return;
        const account = await accountFromRequest(tx, request);
        if (!account || account.id !== input.accountId)
          throw new AppError(
            401,
            "SIGN_IN_REQUIRED",
            "Sign in again before closing your account.",
          );
        if (
          isOperator(account, env) ||
          (await tx.reviewWorker.count({
            where: { operatorId: account.id, revokedAt: null },
          }))
        )
          throw new AppError(
            409,
            "ACCOUNT_TEAM_CHECK",
            "This account manages team access or workers. Contact hello@m8itwork.com to transfer them before closing it.",
          );
        // Match project mutation row locks; creation also takes the account lock.
        await reviewLock(tx);
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "accountId" = ${account.id}::uuid ORDER BY "id" FOR UPDATE`;
        const agreed = await tx.project.count({
          where: {
            accountId: account.id,
            OR: [
              { stage: { in: ["APPROVED", "BUILDING", "VERIFYING"] } },
              {
                stage: { notIn: ["COMPLETE", "CANCELLED"] },
                proposals: { some: { approvedAt: { not: null } } },
              },
            ],
          },
        });
        // Structured agreements distinguish verification from publication. Legacy
        // COMPLETE records without structured terms retain their previous semantics.
        const preparing = await tx.project.findMany({
          where: {
            accountId: account.id,
            stage: "COMPLETE",
            handover: { is: null },
          },
          select: {
            currentProposalId: true,
            proposals: {
              select: { id: true, approvedAt: true, conditions: true },
            },
          },
        });
        if (
          preparing.some((p) => {
            const quote = p.proposals.find((q) => q.id === p.currentProposalId);
            return (
              quote?.approvedAt &&
              typeof (quote.conditions as { responsibilities?: unknown } | null)
                ?.responsibilities === "string"
            );
          })
        )
          throw new AppError(
            409,
            "ACCOUNT_HANDOVER_PENDING",
            "The team is preparing your agreed handover. Wait for the artifacts and operating instructions to be published before closing your account.",
          );
        const pending = await tx.paymentAttempt.count({
          where: {
            milestone: { proposal: { project: { accountId: account.id } } },
            OR: [
              { status: { in: ["CREATING", "OPEN", "PROCESSING"] } },
              { disputed: true },
            ],
          },
        });
        const proposals = await tx.proposal.findMany({
          where: { project: { accountId: account.id } },
          select: { id: true },
        });
        const inbox = (
          await Promise.all(proposals.map((p) => unresolvedPayments(tx, p.id)))
        ).reduce((a, b) => a + b, 0);
        if (agreed || pending || inbox)
          throw new AppError(
            409,
            "ACCOUNT_ACTIVE_WORK",
            "You have agreed work or a payment that needs attention. Contact hello@m8itwork.com to settle it before closing your account.",
          );
        const now = new Date();
        await tx.reviewJob.updateMany({
          where: {
            project: { accountId: account.id },
            status: { in: ["QUEUED", "RUNNING"] },
          },
          data: {
            status: "CANCELLED",
            completedAt: now,
            leaseExpiresAt: null,
            errorCode: "ACCOUNT_CLOSED",
          },
        });
        await tx.project.updateMany({
          where: { accountId: account.id },
          data: {
            aiReviewConsentAt: null,
            aiReviewConsentVersion: null,
            version: { increment: 1 },
          },
        });
        await tx.project.updateMany({
          where: {
            accountId: account.id,
            stage: { in: ["DRAFT", "IN_REVIEW", "AWAITING_APPROVAL"] },
          },
          data: { stage: "CLOSED" },
        });
        await retireIdentities(tx, account);
        await tx.account.update({
          where: { id: account.id },
          data: { closedAt: now, passwordHash: null },
        });
        await revokeAccount(tx, account.id);
        await tx.accountClosure.create({
          data: {
            id: receiptKey(input.requestId),
            accountId: account.id,
            expiresAt: new Date(now.getTime() + 30 * 60_000),
          },
        });
      },
      { timeout: 20_000 },
    );
    reply.clearCookie(ACCOUNT_COOKIE, { path: "/" });
    reply.clearCookie("m8_review_session", { path: "/" });
    return { closed: true, accountId: input.accountId };
  });
}
