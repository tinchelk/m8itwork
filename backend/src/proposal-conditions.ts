import { z } from "zod";

export const defaultConditions = {
  responsibilities:
    "You provide authorized repository access, product decisions, and any required service accounts. We implement and verify the agreed scope and report blockers.",
  externalCosts:
    "Hosting, domains, third-party services and provider subscriptions are paid separately by you. Any additional development requires a separate agreement.",
  ownership:
    "Delivered project code and artifacts are handed over to you after the agreed payments. Existing third-party licenses continue to apply. Your accounts and repository remain yours.",
  cancellation:
    "Either party can request cancellation. We agree a written settlement for completed work, remaining payments and any refund before closing the project. Cancellation does not automatically issue a refund.",
  aftercareDays: 30,
  aftercare:
    "Report suspected failures of the agreed acceptance checks within the aftercare window. We assess each report and explain whether it is an included correction. New features and changed requirements are scoped separately.",
};
export const conditionsSchema = z
  .object({
    responsibilities: z.string().trim().min(20).max(2000),
    externalCosts: z.string().trim().min(20).max(2000),
    ownership: z.string().trim().min(20).max(2000),
    cancellation: z.string().trim().min(20).max(2000),
    aftercareDays: z.number().int().min(0).max(365),
    aftercare: z.string().trim().min(20).max(2000),
  })
  .strict();
