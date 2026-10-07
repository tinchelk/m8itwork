"use client";
import { useCallback, useEffect, useState } from "react";
import { api, displayDate } from "./workspace-types";
interface Operations {
  paymentEvents: {
    id: string;
    type: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
    attempt: { milestone: { proposal: { projectId: string } } } | null;
  }[];
  emailEvents: {
    id: string;
    projectId: string | null;
    kind: string;
    attempts: number;
    lastError: string | null;
    skippedAt: string | null;
    createdAt: string;
  }[];
  workers: {
    id: string;
    name: string;
    lastSeenAt: string | null;
    offline: boolean;
    providerStatus: unknown;
  }[];
  failedJobs: {
    id: string;
    projectId: string;
    provider: string;
    status: string;
    errorCode: string | null;
  }[];
  processing: string;
}
export function OperationsPanel() {
  const [actionError, setActionError] = useState<string | null>(null);
  const [state, setState] = useState<Operations | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setState(await api<Operations>("/v1/operator/operations"));
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Operations could not be loaded.",
      );
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [load]);
  async function retry(kind: "email" | "payments", id: string) {
    setBusy(true);
    setNotice(null);
    setActionError(null);
    try {
      await api(`/v1/operator/operations/${kind}/retry`, { id });
      setNotice("Recovery checked. Review the current status below.");
      await load();
    } catch (reason) {
      setActionError(
        reason instanceof Error
          ? reason.message
          : "Recovery could not be checked.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="portal-card operations-panel">
      <div className="portal-section-heading">
        <div>
          <p className="portal-kicker">OPERATIONS</p>
          <h2>Service health & recovery</h2>
        </div>
        <button
          className="portal-plain"
          disabled={busy}
          onClick={() => void load()}
        >
          Refresh operations
        </button>
      </div>
      {error && (
        <p className="portal-error" role="alert">
          {error}
        </p>
      )}
      {actionError && (
        <p role="alert" className="portal-error">
          {actionError}
        </p>
      )}
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      {!state ? (
        <p role="status">
          {error
            ? "Retry to view current service status."
            : "Loading operations…"}
        </p>
      ) : (
        <>
          <p className="portal-muted">
            {state.processing} Check this panel each working day. It refreshes
            every 30 seconds while visible.
          </p>
          <div className="portal-form-row">
            <div>
              <h3>Payment notifications</h3>
              {state.paymentEvents.length ? (
                <ul>
                  {state.paymentEvents.map((row) => (
                    <li key={row.id}>
                      <strong>{row.type}</strong>
                      <p>
                        {row.lastError || "Reconciliation pending"} ·{" "}
                        {row.attempts} attempts · {displayDate(row.createdAt)}
                      </p>
                      <p className="portal-muted">
                        Stripe event reference: <code>{row.id}</code>
                      </p>
                      {row.attempt && (
                        <a
                          href={`/?project=${row.attempt.milestone.proposal.projectId}`}
                        >
                          Open project ↗
                        </a>
                      )}
                      <button
                        className="portal-plain"
                        disabled={busy}
                        onClick={() => void retry("payments", row.id)}
                      >
                        Retry reconciliation
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No unresolved payment events.</p>
              )}
            </div>
            <div>
              <h3>Email delivery</h3>
              {state.emailEvents.length ? (
                <ul>
                  {state.emailEvents.map((row) => (
                    <li key={row.id}>
                      <strong>
                        {row.kind.replaceAll("_", " ").toLowerCase()}
                      </strong>
                      <p>
                        {row.lastError === "CONTACT_REQUIRED"
                          ? "Ask the customer to verify a notification email in Account. Updates remain in their dashboard."
                          : row.lastError || "Delivery queued"}{" "}
                        · {row.attempts} attempts
                      </p>
                      {row.projectId && (
                        <a href={`/?project=${row.projectId}`}>
                          Open project ↗
                        </a>
                      )}
                      {!row.skippedAt &&
                        row.lastError !== "CONTACT_REQUIRED" && (
                          <button
                            className="portal-plain"
                            disabled={busy}
                            onClick={() => void retry("email", row.id)}
                          >
                            Retry email delivery
                          </button>
                        )}
                      {row.lastError === "DELIVERY_UNCERTAIN" && (
                        <p>
                          Check Resend delivery history before sending a new
                          update.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No pending or failed delivery.</p>
              )}
            </div>
          </div>
          <h3>Worker attention</h3>
          {state.workers
            .filter((w) => w.offline)
            .map((w) => (
              <p key={w.id} className="portal-notice">
                {w.name}: offline. Start its Docker host or revoke the worker if
                retired.
              </p>
            ))}
          {state.workers
            .filter((w) => !w.offline)
            .map((w) => (
              <p key={w.id}>
                {w.name}:{" "}
                {Array.isArray(w.providerStatus)
                  ? w.providerStatus
                      .filter(
                        (
                          s: unknown,
                        ): s is { provider: string; state: string } =>
                          Boolean(
                            s &&
                              typeof s === "object" &&
                              "provider" in s &&
                              "state" in s &&
                              ["codex", "claude"].includes(
                                String(s.provider),
                              ) &&
                              [
                                "READY",
                                "BUSY",
                                "NEEDS_LOGIN",
                                "LIMITED",
                                "ERROR",
                              ].includes(String(s.state)),
                          ),
                      )
                      .map(
                        (s) =>
                          `${s.provider}: ${s.state === "NEEDS_LOGIN" ? "sign-in required — open Worker setup" : s.state.toLowerCase()}`,
                      )
                      .join(" · ")
                  : "Check Worker setup for provider status."}
              </p>
            ))}
          {state.failedJobs.map((job) => (
            <p key={job.id} className="portal-notice">
              {job.provider}: {job.errorCode || job.status.toLowerCase()} ·{" "}
              <a href={`/?project=${job.projectId}`}>
                Review the job and retry ↗
              </a>
            </p>
          ))}
        </>
      )}
    </section>
  );
}
