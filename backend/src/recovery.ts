import { retireIdentities } from "./identity-fences.js";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Checkout, PaymentProvider } from "./stripe-provider.js";
import { revokeAccount } from "./customer-auth.js";
import { financialLock } from "./financial-lock.js";
import { z } from "zod";

export const closureFencesSchema = z
  .object({
    provider: z
      .object({
        accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
        mode: z.enum(["test", "live"]),
      })
      .strict(),
    capturedAt: z.iso.datetime(),
    identities: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-f0-9]{64}$/),
            accountId: z.uuid(),
          })
          .strict(),
      )
      .default([]),
    accounts: z.array(
      z
        .object({
          id: z.uuid(),
          closedAt: z.iso.datetime(),
          email: z.string().nullable(),
          githubId: z.string().nullable(),
          googleId: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export async function restoreClosureFences(
  prisma: PrismaClient,
  input: Pick<z.infer<typeof closureFencesSchema>, "accounts" | "identities">,
) {
  // Run only with all APIs/workers stopped or in recovery mode. Reset all restored
  // sessions, tokens and AI leases, even for accounts absent from the newest fences.
  await prisma.$transaction(
    async (tx) => {
      await financialLock(tx);
      for (const account of input.accounts) {
        const previous = await tx.account.findUnique({
          where: { id: account.id },
        });
        if (previous) await retireIdentities(tx, previous);
        await tx.account.upsert({
          where: { id: account.id },
          update: {
            closedAt: new Date(account.closedAt),
            passwordHash: null,
            email: account.email,
            githubId: account.githubId,
            googleId: account.googleId,
          },
          create: {
            id: account.id,
            closedAt: new Date(account.closedAt),
            email: account.email,
            githubId: account.githubId,
            googleId: account.googleId,
          },
        });
        await retireIdentities(tx, account);
        await revokeAccount(tx, account.id);
      }
      for (const identity of input.identities)
        await tx.closedIdentity.upsert({
          where: { id: identity.id },
          update: {},
          create: identity,
        });
      await tx.accountSession.deleteMany();
      await tx.accountToken.deleteMany();
      await tx.notificationToken.deleteMany();
      await tx.reviewSession.deleteMany();
      await tx.reviewWorker.updateMany({
        data: { revokedAt: new Date(), loginRequest: Prisma.DbNull },
      });
      await tx.reviewJob.updateMany({
        where: { status: { in: ["QUEUED", "RUNNING"] } },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
          leaseExpiresAt: null,
        },
      });
      await tx.project.updateMany({
        data: {
          aiReviewConsentAt: null,
          aiReviewConsentVersion: null,
          version: { increment: 1 },
        },
      });
      await tx.project.updateMany({
        where: {
          account: { closedAt: { not: null } },
          stage: { in: ["DRAFT", "IN_REVIEW", "AWAITING_APPROVAL"] },
        },
        data: { stage: "CLOSED" },
      });
      await tx.notificationOutbox.updateMany({
        where: { sentAt: null },
        data: {
          skippedAt: new Date(),
          leaseUntil: null,
          verificationUrlEncrypted: null,
          lastError: "RECOVERY_SUPPRESSED",
        },
      });
    },
    { timeout: 30_000 },
  );
}
export async function reconcileRecovery(options: {
  prisma: PrismaClient;
  provider: PaymentProvider;
  discover: () => AsyncIterable<{ id: string; attemptId: string }>;
  reconcile: (
    checkout: Checkout,
    attempt: Awaited<
      ReturnType<PrismaClient["paymentAttempt"]["findUniqueOrThrow"]>
    >,
  ) => Promise<unknown>;
}) {
  const { prisma, provider, discover, reconcile } = options;
  const unknown = new Set<string>(),
    blocked = new Set<string>();
  // Discovery is essential: restored inbox rows cannot reveal already-acknowledged
  // payments whose attempt mapping was created after the backup snapshot.
  for await (const session of discover()) {
    if (!session.attemptId) continue;
    const attempt = await prisma.paymentAttempt.findUnique({
      where: { id: session.attemptId },
    });
    if (!attempt) {
      unknown.add(session.id);
      continue;
    }
    if (attempt.stripeSessionId && attempt.stripeSessionId !== session.id) {
      blocked.add(attempt.id);
      continue;
    }
    if (!attempt.stripeSessionId) {
      const checkout = await provider.retrieve(session.id);
      if (
        checkout.attemptId !== attempt.id ||
        checkout.amountCents !== attempt.amountCents ||
        checkout.currency.toLowerCase() !== attempt.currency.toLowerCase() ||
        checkout.live !== (attempt.mode === "live") ||
        attempt.mode !== provider.mode
      ) {
        blocked.add(attempt.id);
        continue;
      }
      await prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { stripeSessionId: session.id },
      });
    }
  }
  let reconciled = 0;
  for (const attempt of await prisma.paymentAttempt.findMany()) {
    if (
      blocked.has(attempt.id) ||
      !attempt.stripeSessionId ||
      attempt.mode !== provider.mode
    ) {
      blocked.add(attempt.id);
      continue;
    }
    try {
      await reconcile(
        await provider.retrieve(attempt.stripeSessionId),
        attempt,
      );
      reconciled++;
    } catch {
      blocked.add(attempt.id);
    }
  }
  const pendingEvents = await prisma.paymentInbox.count({
    where: { processedAt: null, ignoredAt: null },
  });
  return {
    safeToReopen:
      unknown.size === 0 && blocked.size === 0 && pendingEvents === 0,
    reconciled,
    unknownSessions: [...unknown],
    blockedAttempts: [...blocked],
    pendingEvents,
  };
}

export function verifyRecoveryMerchant(
  expected: { accountId: string; mode: string },
  configuredAccount: string,
  actual: { accountId: string; mode: string },
) {
  if (
    !configuredAccount ||
    configuredAccount !== expected.accountId ||
    actual.accountId !== expected.accountId ||
    actual.mode !== expected.mode
  )
    throw new Error("RECOVERY_MERCHANT_MISMATCH");
}
