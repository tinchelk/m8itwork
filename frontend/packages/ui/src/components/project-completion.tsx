"use client";
import { useEffect, useRef, useState } from "react";
import { SelectField } from "./form-controls";
import {
  api,
  displayDate,
  money,
  type Inventory,
  type Project,
} from "./workspace-types";
import { useFormDraft } from "./workspace-drafts";
import type { Save } from "./workspace-forms";

export const isTerminal = (stage: string) =>
  ["WITHDRAWN", "DECLINED", "CANCELLED", "CLOSED"].includes(stage);
export function ProjectLifecycle({
  project,
  team,
  busy,
  save,
  refresh,
}: {
  project: Project;
  team: boolean;
  busy: boolean;
  save: Save;
  refresh: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    keep = useRef<HTMLButtonElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const agreed = project.proposals.some((p) => p.approvedAt),
    closed = isTerminal(project.stage);
  useEffect(() => {
    const element = dialog.current;
    if (confirm) {
      element?.showModal();
      keep.current?.focus();
    }
    return () => {
      element?.close();
    };
  }, [confirm]);
  function dismiss(checkResult = Boolean(dialogError)) {
    setConfirm(false);
    const focus = () =>
      requestAnimationFrame(() =>
        (trigger.current ?? heading.current)?.focus(),
      );
    if (checkResult) void refresh().finally(focus);
    else focus();
  }
  const prefix = `${team ? "/v1/operator/projects" : "/v1/projects"}/${project.id}`;
  return (
    <section className="portal-card project-lifecycle">
      <h2 ref={heading} tabIndex={-1}>
        {closed
          ? "Project closed"
          : project.cancellationRequestedAt
            ? "Cancellation"
            : "Project options"}
      </h2>
      {closed ? (
        <>
          {project.settledAt ? (
            <SettlementRecord project={project} />
          ) : (
            <p className="portal-preserve">{project.closedReason}</p>
          )}
          <p className="portal-muted">
            Your history is retained. Future installments are no longer
            collected. Start a new project for further work.
          </p>
        </>
      ) : project.cancellationRequestedAt ? (
        <>
          <p className="portal-notice">
            Cancellation requested. New collection and delivery progression are
            paused. No refund is issued automatically.
          </p>
          <p className="portal-preserve">{project.cancellationReason}</p>
          {project.settlementProposedAt && (
            <>
              <h3>Proposed settlement</h3>
              <p className="portal-preserve">{project.settlementSummary}</p>
              <p>
                Amount retained after refunds:{" "}
                <strong>
                  {money({
                    amountCents: project.settlementRetainedCents ?? 0,
                    currency:
                      project.proposals.find((p) => p.approvedAt)?.currency ??
                      "USD",
                  })}
                </strong>
              </p>
              <p className="portal-muted">
                The remaining agreed installments will stop being collected
                after settlement. The team must verify any Stripe refunds and
                resolve pending payments or disputes first.
              </p>
              {project.settlementAcceptedAt ? (
                <p role="status">
                  Customer accepted these settlement terms. Financial
                  verification and final closure are pending.
                </p>
              ) : (
                !team && (
                  <form
                    key={`${project.settlementProposedAt}:${project.settlementSummary}:${project.settlementRetainedCents}`}
                    className="portal-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save(
                        `${prefix}/settlement/accept`,
                        { version: project.version, consent: true },
                        "Settlement terms accepted. The team will verify payments before final closure.",
                      );
                    }}
                  >
                    <label className="portal-check">
                      <input type="checkbox" required />
                      <span>
                        I agree to this written settlement and retained amount.
                      </span>
                    </label>
                    <button className="button" disabled={busy}>
                      Agree cancellation settlement
                    </button>
                  </form>
                )
              )}
            </>
          )}
          {team && (
            <form
              className="portal-form"
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                void save(
                  `${prefix}/settlement/propose`,
                  {
                    version: project.version,
                    summary: values.get("summary"),
                    retainedCents: Math.round(
                      Number(values.get("retained")) * 100,
                    ),
                  },
                  "Settlement proposed for customer agreement.",
                );
              }}
            >
              <label>
                Completed work, refunds & cancelled installments
                <textarea
                  name="summary"
                  required
                  minLength={10}
                  maxLength={3000}
                  rows={4}
                  defaultValue={project.settlementSummary ?? ""}
                />
              </label>
              <label>
                Amount retained after refunds
                <input
                  name="retained"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={6000000}
                  step="0.01"
                  required
                  defaultValue={(project.settlementRetainedCents ?? 0) / 100}
                />
              </label>
              <button className="button outline" disabled={busy}>
                Propose settlement
              </button>
            </form>
          )}
          {team && !project.resumeProposedAt && (
            <button
              className="button outline"
              disabled={busy}
              onClick={() =>
                void save(
                  `${prefix}/cancellation/resume/propose`,
                  { version: project.version },
                  "Continuation offered for customer confirmation.",
                )
              }
            >
              Offer to continue the original agreement
            </button>
          )}
          {project.resumeProposedAt && (
            <div className="portal-notice">
              <h3>Continue the original agreement</h3>
              <p>
                The team offers to resume the existing approved scope, price and
                payment schedule. Confirming retires settlement offers;
                financial holds remain.
              </p>
              {!team ? (
                <form
                  key={project.resumeProposedAt}
                  className="portal-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save(
                      `${prefix}/cancellation/resume/accept`,
                      { version: project.version, consent: true },
                      "Original agreement resumed.",
                    );
                  }}
                >
                  <label className="portal-check">
                    <input required type="checkbox" />
                    <span>
                      I agree to withdraw this cancellation and continue the
                      original agreement.
                    </span>
                  </label>
                  <button className="button" disabled={busy}>
                    Continue agreed work
                  </button>
                </form>
              ) : (
                <p>Customer confirmation is pending.</p>
              )}
            </div>
          )}
          {team && project.settlementAcceptedAt && (
            <form
              className="portal-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save(
                  `${prefix}/settle`,
                  {
                    version: project.version,
                    summary: project.settlementSummary,
                    retainedCents: project.settlementRetainedCents,
                    consent: true,
                  },
                  "Cancellation settled. No future collection is due.",
                );
              }}
            >
              <label className="portal-check">
                <input required type="checkbox" />
                <span>
                  Customer agreement is recorded. Reconcile Stripe and close
                  this cancellation with the exact agreed retained amount. No
                  refund is issued here.
                </span>
              </label>
              <button className="button" disabled={busy}>
                Verify finances & settle cancellation
              </button>
            </form>
          )}
        </>
      ) : project.stage !== "COMPLETE" ? (
        <>
          <p className="portal-muted">
            {agreed
              ? "Request cancellation to agree a written settlement with the team."
              : team
                ? "If this request is not a fit, explain why and close it without payment."
                : "Withdraw this unagreed request. Your project history and account stay available."}
          </p>
          <button
            ref={trigger}
            className="button outline"
            disabled={busy}
            onClick={() => {
              setDialogError(null);
              setConfirm(true);
            }}
          >
            {agreed
              ? "Request cancellation"
              : team
                ? "Decline request"
                : "Withdraw request"}
          </button>
        </>
      ) : (
        <p className="portal-muted">
          Delivery and aftercare follow the agreed proposal. Use the
          conversation for questions.
        </p>
      )}
      {confirm && (
        <dialog
          ref={dialog}
          className="billing-dialog"
          aria-labelledby="close-project-title"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) dismiss();
          }}
        >
          <h2 id="close-project-title">
            {agreed
              ? "Request cancellation?"
              : team
                ? "Decline this request?"
                : "Withdraw this request?"}
          </h2>
          <p>
            {agreed
              ? "Work and new payment collection pause while you agree a settlement. No refund is automatic."
              : "This closes the request and retains its history."}
          </p>
          <form
            className="portal-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const reason = new FormData(event.currentTarget).get("reason");
              setDialogError(null);
              if (
                await save(
                  `${prefix}/${team && !agreed ? "decline" : "cancel"}`,
                  { version: project.version, reason },
                  agreed ? "Cancellation requested." : "Request closed.",
                  (error) =>
                    setDialogError(
                      error instanceof Error
                        ? error.message
                        : "The result could not be confirmed. Your reason is still here.",
                    ),
                )
              )
                dismiss(false);
            }}
          >
            {dialogError && (
              <p role="alert" className="portal-error">
                {dialogError} Close and refresh to check whether your request
                was saved before retrying. Closing this dialog does not undo a
                submitted request.
              </p>
            )}
            <label>
              Reason
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={3000}
                rows={3}
              />
            </label>
            <div className="billing-actions">
              <button
                ref={keep}
                type="button"
                className="button outline"
                disabled={busy}
                onClick={() => dismiss()}
              >
                {dialogError ? "Close & check result" : "Keep project"}
              </button>
              <button className="button" disabled={busy}>
                {busy ? "Saving…" : "Confirm request"}
              </button>
            </div>
            <button
              type="button"
              className="portal-plain"
              disabled={busy}
              onClick={() => {
                dismiss(true);
              }}
            >
              Close & refresh project
            </button>
            <p className="portal-muted">
              If the connection fails, refresh the project to check the result
              before trying again.
            </p>
          </form>
        </dialog>
      )}
    </section>
  );
}
export function SettlementRecord({ project }: { project: Project }) {
  if (!project.settledAt) return null;
  return (
    <div className="settlement-record">
      <h3>Settlement confirmed</h3>
      <p className="portal-preserve">{project.settlementSummary}</p>
      <p>
        Amount retained after refunds:{" "}
        <strong>
          {money({
            amountCents: project.settlementRetainedCents ?? 0,
            currency:
              project.proposals.find((p) => p.approvedAt)?.currency ?? "USD",
          })}
        </strong>
      </p>
      <p className="portal-muted">
        Confirmed {displayDate(project.settledAt)}. Future installments are no
        longer collected.
      </p>
    </div>
  );
}
export function RepositoryRefresh({
  project,
  busy,
  save,
}: {
  project: Project;
  busy: boolean;
  save: Save;
}) {
  const [candidate, setCandidate] = useState<
      (Inventory & { id: string }) | null
    >(null),
    [checking, setChecking] = useState(false),
    [error, setError] = useState<string | null>(null);
  const eligible =
    ["DRAFT", "IN_REVIEW", "AWAITING_APPROVAL"].includes(project.stage) &&
    !project.proposals.some((p) => p.approvedAt);
  return (
    <div className="repository-refresh">
      {eligible && project.repositoryUrl && (
        <>
          <h3>Refresh the saved commit</h3>
          <p className="portal-muted">
            Check the latest commit in the same repository. A changed commit
            starts a fresh review and retires the current proposal; earlier
            evidence stays in history.
          </p>
          <button
            className="button outline"
            disabled={busy || checking}
            onClick={async () => {
              setChecking(true);
              setCandidate(null);
              setError(null);
              try {
                setCandidate(
                  await api<Inventory & { id: string }>("/v1/github/inspect", {
                    repositoryUrl: project.repositoryUrl,
                  }),
                );
              } catch (reason) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Reconnect GitHub and try again.",
                );
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking
              ? "Checking latest commit…"
              : "Check latest repository commit"}
          </button>
          {error && (
            <p className="portal-error" role="alert">
              {error}
            </p>
          )}
          {candidate && (
            <form
              className="portal-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (
                  await save(
                    `/v1/projects/${project.id}/repository/refresh`,
                    {
                      version: project.version,
                      inspectionId: candidate.id,
                      consent: true,
                    },
                    candidate.commit === project.inspectionReport?.commit
                      ? "The saved commit is already current."
                      : "Repository baseline refreshed. A fresh review is pending.",
                  )
                )
                  setCandidate(null);
              }}
            >
              <p>
                Saved:{" "}
                <code>{project.inspectionReport?.commit.slice(0, 7)}</code> →
                Latest: <code>{candidate.commit.slice(0, 7)}</code>
              </p>
              {candidate.commit !== project.inspectionReport?.commit && (
                <label className="portal-check">
                  <input type="checkbox" required />
                  <span>
                    Use this new commit for a fresh review and retire the
                    current proposal.
                  </span>
                </label>
              )}
              <button
                className="button"
                disabled={busy || checking || Boolean(error)}
              >
                {candidate.commit === project.inspectionReport?.commit
                  ? "Confirm current commit"
                  : "Refresh baseline"}
              </button>
            </form>
          )}
        </>
      )}
      {Boolean(project.revisions?.length) && (
        <details>
          <summary>Earlier repository evidence</summary>
          {project.revisions?.map((r) => (
            <div className="portal-old-proposal" key={r.id}>
              <strong>Historical commit {r.commit.slice(0, 7)}</strong>
              <p>
                {displayDate(r.createdAt)} · {r.report.stack.join(" · ")}
              </p>
              {r.reviewSummary && (
                <p className="portal-preserve">{r.reviewSummary}</p>
              )}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
export function RequestTriage({
  item,
  project,
  busy,
  save,
}: {
  item: Project["requests"][number];
  project: Project;
  busy: boolean;
  save: Save;
}) {
  return (
    <form
      className="portal-form"
      onSubmit={(event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        void save(
          `/v1/operator/projects/${project.id}/requests/${item.id}/triage`,
          { ...values, version: project.version },
          "Request assessment published.",
        );
      }}
    >
      <label>
        Assessment
        <SelectField
          name="status"
          aria-label={`Assessment for ${item.title}`}
          defaultValue={
            item.status === "PENDING"
              ? "FOLLOW_ON"
              : (item.status ?? "FOLLOW_ON")
          }
          options={[
            ...(item.purpose === "DEFECT" && item.aftercareEligible
              ? [
                  {
                    value: "INCLUDED_CORRECTION",
                    label: "Included correction to an agreed check",
                  },
                  ...([
                    "INCLUDED_CORRECTION",
                    "CORRECTION_IN_PROGRESS",
                    "CORRECTION_RESOLVED",
                  ].includes(item.status ?? "")
                    ? [
                        {
                          value: "CORRECTION_IN_PROGRESS",
                          label: "Correction in progress",
                        },
                        {
                          value: "CORRECTION_RESOLVED",
                          label: "Correction verified and resolved",
                        },
                      ]
                    : []),
                ]
              : []),
            { value: "FOLLOW_ON", label: "Separate follow-on scope" },
            { value: "ANSWERED", label: "Answered / clarification" },
            { value: "DECLINED", label: "Declined" },
          ]}
        />
      </label>
      <label>
        Explanation visible to the customer
        <textarea
          name="reason"
          minLength={10}
          maxLength={3000}
          required
          rows={3}
          defaultValue={item.triageReason ?? ""}
        />
      </label>
      <button className="button outline" disabled={busy}>
        Publish assessment
      </button>
    </form>
  );
}
export function ProjectHandover({
  project,
  accountId,
  team,
  busy,
  save,
  readOnly = false,
}: {
  project: Project;
  accountId: string;
  team: boolean;
  busy: boolean;
  save: Save;
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null),
    draft = useFormDraft(ref, accountId, `handover:${project.id}`);
  const h = project.handover;
  if (project.stage !== "COMPLETE" && !h) return null;
  return (
    <section id="handover" className="portal-card project-handover">
      <p className="portal-kicker">DELIVERY & AFTERCARE</p>
      <h2>{project.acceptedAt ? "Delivery accepted" : "Your handover"}</h2>
      {h ? (
        <>
          <p className="portal-preserve">{h.summary}</p>
          <ul>
            {h.artifacts.map((a) => (
              <li key={a.url}>
                <a href={a.url} target="_blank" rel="noopener noreferrer">
                  {a.label} ↗
                </a>
              </li>
            ))}
          </ul>
          {[
            ["Actual verification results", h.checks],
            ["Operating instructions", h.instructions],
            ["Known limitations", h.limitations],
            ["Deployment & access", h.deployment],
          ].map(([label, text]) => (
            <div key={label}>
              <h3>{label}</h3>
              <p className="portal-preserve">{text}</p>
            </div>
          ))}
          <p className="portal-muted">
            Published {displayDate(h.publishedAt)}. Aftercare follows the agreed
            proposal. Report suspected failures of its checks under Issues,
            ideas & requirements.
          </p>
          {project.acceptedAt && (
            <p className="portal-notice">
              Customer accepted delivery {displayDate(project.acceptedAt)}.
              Agreed aftercare remains applicable.
            </p>
          )}
          {!readOnly && !team && !project.acceptedAt && (
            <form
              className="portal-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save(
                  `/v1/projects/${project.id}/accept`,
                  { version: project.version, consent: true },
                  "Delivery accepted. Included aftercare still applies.",
                );
              }}
            >
              <label className="portal-check">
                <input required type="checkbox" />
                <span>
                  I reviewed the artifacts and check results and accept this
                  delivery. This does not waive agreed aftercare.
                </span>
              </label>
              <button className="button" disabled={busy}>
                Accept delivery
              </button>
            </form>
          )}
        </>
      ) : team && !readOnly ? (
        <form
          ref={ref}
          className="portal-form"
          onInput={draft.capture}
          onChange={draft.capture}
          onSubmit={async (event) => {
            event.preventDefault();
            draft.capture();
            const values = Object.fromEntries(
              new FormData(event.currentTarget),
            );
            if (
              await save(
                `/v1/operator/projects/${project.id}/handover`,
                {
                  version: project.version,
                  summary: values.summary,
                  checks: values.checks,
                  instructions: values.instructions,
                  limitations: values.limitations,
                  deployment: values.deployment,
                  artifacts: [
                    { label: values.artifactLabel, url: values.artifactUrl },
                  ],
                },
                "Handover published for customer review.",
              )
            )
              draft.clear();
          }}
        >
          <p>
            The handover is retained when published. Include only actual results
            and accessible artifacts.
          </p>
          {[
            ["summary", "What was delivered"],
            ["checks", "Checks performed and actual results"],
            ["instructions", "Operating instructions"],
            [
              "limitations",
              "Known limitations (write No known limitations if none found)",
            ],
            [
              "deployment",
              "Deployment and access (state clearly if deployment is excluded)",
            ],
          ].map(([name, label]) => (
            <label key={name}>
              {label}
              <textarea
                name={name}
                required
                minLength={10}
                maxLength={3000}
                rows={3}
              />
            </label>
          ))}
          <label>
            Artifact label
            <input
              name="artifactLabel"
              required
              minLength={2}
              maxLength={100}
              placeholder="Change / pull request / delivered artifact"
            />
          </label>
          <label>
            Artifact or change link
            <input name="artifactUrl" type="url" required maxLength={500} />
          </label>
          <button className="button" disabled={busy}>
            Publish handover
          </button>
        </form>
      ) : (
        <p className="portal-notice">
          {readOnly
            ? "No structured handover was recorded for this earlier project. See the retained delivery evidence below, or contact hello@m8itwork.com for support."
            : "Verification is recorded. The team is preparing your artifacts and operating instructions; customer acceptance is still pending."}
        </p>
      )}
    </section>
  );
}
