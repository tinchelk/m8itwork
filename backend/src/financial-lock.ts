import type { Prisma } from "@prisma/client";
import { reviewLock } from "./reviews/lock.js";

// One transaction fence for project mutation, review invalidation, financial
// ingestion and work gates. Take it before project row locks, never after them.
export const financialLock = (tx: Prisma.TransactionClient) => reviewLock(tx);

export async function unresolvedPayments(
  tx: Prisma.TransactionClient,
  proposalId: string,
) {
  const attempts = await tx.paymentAttempt.findMany({
    where: { milestone: { proposalId } },
    select: { id: true, stripePaymentIntentId: true },
  });
  return tx.paymentInbox.count({
    where: {
      processedAt: null,
      ignoredAt: null,
      OR: [
        { attemptId: { in: attempts.map((a) => a.id) } },
        {
          paymentIntentId: {
            in: attempts.flatMap((a) =>
              a.stripePaymentIntentId ? [a.stripePaymentIntentId] : [],
            ),
          },
        },
      ],
    },
  });
}
