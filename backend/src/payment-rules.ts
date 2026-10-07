import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError } from "./shared/errors.js";

export const paymentGates = [
  "BEFORE_BUILD",
  "BEFORE_VERIFY",
  "BEFORE_HANDOVER",
] as const;
export const planSchema = z
  .array(
    z
      .object({
        label: z.string().trim().min(2).max(80),
        amountCents: z.number().int().min(100).max(100_000_000),
        dueWhen: z.enum(paymentGates),
      })
      .strict(),
  )
  .min(1)
  .max(6);
export const milestoneSelect = {
  id: true,
  position: true,
  label: true,
  amountCents: true,
  dueWhen: true,
  releasedAt: true,
  paidAt: true,
  paidCents: true,
  refundedCents: true,
  disputed: true,
  attempts: {
    orderBy: { createdAt: "desc" },
    select: { mode: true, status: true },
  },
} satisfies Prisma.PaymentMilestoneSelect;
export function paymentPlan(
  input: z.infer<typeof planSchema> | undefined,
  total: number,
) {
  const plan = planSchema.parse(
    input ?? [
      { label: "Project payment", amountCents: total, dueWhen: "BEFORE_BUILD" },
    ],
  );
  if (
    plan.reduce((sum, row) => sum + row.amountCents, 0) !== total ||
    plan[0]!.dueWhen !== "BEFORE_BUILD" ||
    plan.some(
      (row, index) =>
        index > 0 &&
        paymentGates.indexOf(row.dueWhen) <
          paymentGates.indexOf(plan[index - 1]!.dueWhen),
    )
  )
    throw new AppError(
      400,
      "INVALID_PAYMENT_PLAN",
      "Installments must total the project cost, start before building, and follow delivery order.",
    );
  return plan.map((row, position) => ({ ...row, position }));
}
export function paid(row: {
  paidCents: number;
  refundedCents: number;
  amountCents: number;
  disputed: boolean;
}) {
  return !row.disputed && row.paidCents - row.refundedCents === row.amountCents;
}
export function paidInMode(
  row: Parameters<typeof paid>[0] & {
    attempts: { mode: string; status: string }[];
  },
  mode: string,
) {
  const confirmed = row.attempts.filter((attempt) => attempt.status === "PAID");
  return (
    mode !== "unconfigured" &&
    confirmed.length > 0 &&
    confirmed.every((attempt) => attempt.mode === mode) &&
    paid(row)
  );
}
export async function requirePaymentGate(
  tx: Prisma.TransactionClient,
  proposalId: string,
  gate: (typeof paymentGates)[number],
  mode: string,
) {
  const rows = await tx.paymentMilestone.findMany({
    where: { proposalId },
    include: { attempts: true },
  });
  const level = paymentGates.indexOf(gate);
  if (
    !rows.length ||
    rows.some(
      (row) =>
        paymentGates.indexOf(row.dueWhen as typeof gate) <= level &&
        !paidInMode(row, mode),
    )
  )
    throw new AppError(
      409,
      "PAYMENT_REQUIRED",
      "The agreed payment for this stage must be confirmed before work advances. Check the payment plan.",
    );
}
export async function guardProposalRevision(
  tx: Prisma.TransactionClient,
  proposalId: string | null,
) {
  if (
    proposalId &&
    (await tx.paymentAttempt.count({
      where: {
        milestone: { proposalId },
        status: { notIn: ["EXPIRED", "FAILED"] },
      },
    }))
  )
    throw new AppError(
      409,
      "PAYMENT_PLAN_LOCKED",
      "Expire pending Checkout before revising an unpaid proposal. Paid scope needs a separately agreed follow-on project.",
    );
}
