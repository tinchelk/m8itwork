"use client";
import { useEffect, useRef, useState } from "react";
import {
  api,
  money,
  type Project,
  type PaymentMilestone,
} from "./workspace-types";
import type { Save } from "./workspace-forms";

const emptyMilestones: PaymentMilestone[] = [];
export const paymentGateLabels = {
  BEFORE_BUILD: "Before building starts",
  BEFORE_VERIFY: "Before verification",
  BEFORE_HANDOVER: "Before final handover",
};
export const isPaid = (m: PaymentMilestone, mode?: string) =>
  !m.disputed &&
  m.paidCents - m.refundedCents === m.amountCents &&
  mode !== "unconfigured" &&
  Boolean(m.attempts?.some((attempt) => attempt.status === "PAID")) &&
  Boolean(
    m.attempts
      ?.filter((attempt) => attempt.status === "PAID")
      .every((attempt) => !mode || attempt.mode === mode),
  );
export const paymentNeedsReview = (m: PaymentMilestone, mode?: string) =>
  Boolean(
    m.disputed || m.refundedCents || m.paidCents > m.amountCents ||
    (m.attempts?.[0] && m.attempts[0].mode !== mode),
  );
export const requestedPayment = (project: Project) => {
  const proposal = project.proposals.find(
    (p) => p.id === project.currentProposalId,
  );
  if (!proposal?.approvedAt) return undefined;
  return proposal.milestones?.find(
    (m) => m.releasedAt && !isPaid(m, project.billing?.mode),
  );
};
export function ProjectPayments({
  project,
  team,
  save,
  refresh,
  onError,
  returnStatus,
  saving,
}: {
  project: Project;
  team: boolean;
  save: Save;
  refresh: () => Promise<void>;
  onError: (reason: unknown) => void;
  returnStatus?: "returned" | "cancelled" | null;
  saving: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const proposal = project.proposals.find(
    (p) => p.id === project.currentProposalId,
  );
  const milestones = proposal?.milestones ?? emptyMilestones;
  const prefix = `${team ? "/v1/operator/projects" : "/v1/projects"}/${project.id}/payments`;
  const checkedReturn = useRef(false);
  const callbacks = useRef({ refresh, onError });
  useEffect(() => {
    callbacks.current = { refresh, onError };
  }, [refresh, onError]);
  useEffect(() => {
    if (
      checkedReturn.current ||
      team ||
      returnStatus !== "returned" ||
      !project.billing?.enabled
    )
      return;
    checkedReturn.current = true;
    const pending = milestones.find(
      (m) => m.releasedAt && !isPaid(m, project.billing?.mode),
    );
    if (!pending) return;
    void api(`${prefix}/${pending.id}/sync`, {})
      .then(() => callbacks.current.refresh())
      .catch((reason) => callbacks.current.onError(reason));
  }, [team, returnStatus, project.billing, milestones, prefix]);
  return (
    <section id="payments" className="portal-card portal-payments">
      <p className="portal-kicker">AGREED WORK, CLEAR PAYMENTS</p>
      <h2>Payment plan</h2>
      {returnStatus && (
        <p role="status" className="portal-notice">
          {returnStatus === "cancelled"
            ? "Checkout was closed. Your agreement is saved; check payment status before trying again."
            : milestones.some(
                  (m) => m.releasedAt && !isPaid(m, project.billing?.mode),
                )
              ? "Welcome back. Payment confirmation is pending; we’re checking Stripe. Use Check payment status for the latest result."
              : milestones.some((m) => isPaid(m, project.billing?.mode))
                ? "Stripe has confirmed the recorded payments. Thank you."
                : "No confirmed payment is recorded. Check the payment plan or speak with the team."}
        </p>
      )}
      {!proposal ? (
        <p className="portal-empty">
          Your scope and payment schedule follow our review. No payment is due
          yet.
        </p>
      ) : (
        <>
          <p className="portal-muted">
            {proposal.approvedAt ? "Approved" : "Proposed"} total:{" "}
            <strong>{money(proposal)}</strong> ·{" "}
            {milestones.length === 1
              ? "Full payment upfront"
              : `${milestones.length} agreed installments`}
            . Only requested installments can be paid.
          </p>
          {project.billing?.mode === "test" && (
            <p className="portal-notice">
              Stripe test mode — no real money is collected.
            </p>
          )}
          {!project.billing?.enabled && (
            <p className="portal-notice">
              Payment collection is being set up.{" "}
              {team
                ? "Configure the Stripe server key and signed webhook before collecting payment."
                : "Your agreement is saved. Speak with the team here about the next step."}
            </p>
          )}
          {notice && (
            <p className="portal-notice" role="status">
              {notice}
            </p>
          )}
          <ol className="payment-installments">
            {milestones.map((milestone, index) => {
              const attempt = milestone.attempts?.[0];
              const modeMismatch =
                attempt && attempt.mode !== project.billing?.mode;
              const processing = attempt?.status === "PROCESSING";
              const status = modeMismatch
                ? "Different payment mode · team review required"
                : milestone.disputed
                  ? "Disputed · team review"
                  : milestone.refundedCents
                    ? "Refund recorded · team review"
                    : milestone.paidCents > milestone.amountCents
                      ? "Overpaid · team review"
                      : isPaid(milestone, project.billing?.mode)
                        ? "Paid"
                        : processing
                          ? "Confirmation pending · check status"
                          : milestone.releasedAt
                            ? "Payment requested"
                            : "Not due yet";
              const ready = Boolean(
                proposal.approvedAt &&
                  milestone.releasedAt &&
                  !isPaid(milestone, project.billing?.mode) &&
                  !paymentNeedsReview(milestone, project.billing?.mode) &&
                  !processing &&
                  !milestone.paidCents &&
                  milestones
                    .slice(0, index)
                    .every((m) => isPaid(m, project.billing?.mode)),
              );
              return (
                <li key={milestone.id}>
                  <div className="installment-heading">
                    <div>
                      <span className="portal-kicker">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h3>{milestone.label}</h3>
                      <p className="portal-muted">
                        {paymentGateLabels[milestone.dueWhen]}
                      </p>
                    </div>
                    <strong>
                      {money({
                        amountCents: milestone.amountCents,
                        currency: proposal.currency,
                      })}
                    </strong>
                  </div>
                  <span
                    className={`payment-status ${isPaid(milestone, project.billing?.mode) ? "payment-paid" : ""}`}
                  >
                    {status}
                  </span>
                  <div className="payment-actions">
                    {!team && ready && (
                      <button
                        className="button"
                        disabled={busy || saving || !project.billing?.enabled}
                        onClick={async () => {
                          setBusy(true);
                          setNotice(null);
                          try {
                            const result = await api<{
                              url?: string;
                              paid?: boolean;
                            }>(`${prefix}/${milestone.id}/checkout`, {});
                            if (result.url) window.location.assign(result.url);
                            else {
                              setNotice(
                                "Stripe confirmed this payment. Updating your project…",
                              );
                              await refresh();
                            }
                          } catch (reason) {
                            onError(reason);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {busy
                          ? "Opening Checkout…"
                          : `Pay ${milestone.label} with Stripe`}{" "}
                        <span aria-hidden="true">↗</span>
                      </button>
                    )}
                    {proposal.approvedAt &&
                      milestone.releasedAt &&
                      project.billing?.enabled && (
                        <button
                          className="portal-plain"
                          disabled={busy || saving || Boolean(modeMismatch)}
                          onClick={() =>
                            void save(
                              `${prefix}/${milestone.id}/sync`,
                              {},
                              "Payment status checked with Stripe.",
                            )
                          }
                        >
                          Check payment status
                        </button>
                      )}
                    {team &&
                      proposal.approvedAt &&
                      !milestone.releasedAt &&
                      milestones
                        .slice(0, index)
                        .every((m) => isPaid(m, project.billing?.mode)) &&
                      {
                        BEFORE_BUILD: ["APPROVED", "BUILDING"],
                        BEFORE_VERIFY: ["BUILDING"],
                        BEFORE_HANDOVER: ["VERIFYING"],
                      }[milestone.dueWhen].includes(project.stage) && (
                        <button
                          className="button"
                          disabled={busy || saving}
                          onClick={() =>
                            void save(
                              `${prefix}/${milestone.id}/request`,
                              { version: project.version },
                              "Installment requested in the customer's workspace.",
                            )
                          }
                        >
                          Request {milestone.label}
                        </button>
                      )}
                    {team &&
                      milestone.releasedAt &&
                      !milestone.paidCents &&
                      project.billing?.enabled && (
                        <button
                          className="portal-plain"
                          disabled={busy || saving || Boolean(modeMismatch)}
                          onClick={() =>
                            void save(
                              `${prefix}/${milestone.id}/expire`,
                              {},
                              "Pending Checkout expired. Unpaid scope can be revised.",
                            )
                          }
                        >
                          Expire pending Checkout
                        </button>
                      )}
                  </div>
                  {team && project.billing?.enabled && (
                    <details>
                      <summary>Recover an unfinished Checkout</summary>
                      <form
                        className="portal-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const form = e.currentTarget;
                          void save(
                            `${prefix}/${milestone.id}/recover`,
                            { sessionId: new FormData(form).get("sessionId") },
                            "Checkout recovered from Stripe.",
                          ).then((ok) => {
                            if (ok) form.reset();
                          });
                        }}
                      >
                        <label>
                          Stripe Checkout session ID
                          <input
                            name="sessionId"
                            pattern="cs_(test_|live_)?[A-Za-z0-9_]{8,200}"
                            required
                            placeholder="cs_test_…"
                          />
                        </label>
                        <p className="portal-muted">
                          Use the existing session from the Stripe Dashboard.
                          The server verifies the installment, amount, and
                          payment mode.
                        </p>
                        <button className="button">Recover Checkout</button>
                      </form>
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
          {!proposal.approvedAt && (
            <p className="portal-muted">
              Approve this proposal’s scope, cost, and schedule before any
              payment is requested.
            </p>
          )}
        </>
      )}
      <p className="portal-muted">
        Stripe handles card details. Returning from Checkout does not confirm
        payment; the server checks Stripe. Refunds or disputes need a team
        review before delivery advances.
      </p>
    </section>
  );
}
