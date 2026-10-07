import type { Proposal } from "./workspace-types";
export const conditionLabels: Record<string, string> = {
  responsibilities: "Responsibilities",
  externalCosts: "External costs & additional work",
  ownership: "Ownership & access",
  cancellation: "Cancellation",
  aftercare: "Included aftercare",
};
export const proposalConditionDefaults = {
  responsibilities:
    "You provide authorized repository access, product decisions, and any required service accounts. We implement and verify the agreed scope and report blockers.",
  externalCosts:
    "Hosting, domains, third-party services and provider subscriptions are paid separately by you. Any additional development requires a separate agreement.",
  ownership:
    "Delivered project code and artifacts are handed over to you after the agreed payments. Existing third-party licenses continue to apply. Your accounts and repository remain yours.",
  cancellation:
    "Either party can request cancellation. We agree a written settlement for completed work, remaining payments and any refund before closing the project. Cancellation does not automatically issue a refund.",
  aftercare:
    "Report suspected failures of the agreed acceptance checks within the aftercare window. We assess each report and explain whether it is an included correction. New features and changed requirements are scoped separately.",
};
export const stageTransitions: Record<string, string[]> = {
  APPROVED: ["BUILDING"],
  BUILDING: ["VERIFYING"],
  VERIFYING: ["BUILDING", "COMPLETE"],
};
export function ProposalConditions({ proposal }: { proposal: Proposal }) {
  const c = proposal.conditions;
  if (!c?.responsibilities)
    return (
      <p className="portal-muted">
        Conditions for this earlier proposal are retained in its assumptions.
      </p>
    );
  return (
    <details className="proposal-conditions">
      <summary>Responsibilities, ownership & aftercare</summary>
      {Object.keys(conditionLabels).map((key) => (
        <div key={key}>
          <h3>{conditionLabels[key]}</h3>
          <p className="portal-preserve">
            {c[key as keyof typeof proposalConditionDefaults]}
          </p>
        </div>
      ))}
      <p>
        Aftercare reports: {c.aftercareDays} calendar days from the published
        handover. Reports are reviewed against this proposal’s acceptance
        checks.
      </p>
    </details>
  );
}
