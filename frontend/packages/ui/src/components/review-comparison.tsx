"use client";
import { useEffect, useState } from "react";
import { api } from "./workspace-types";
import { failures, type ReviewJob, type ReviewReport } from "./review-assistant";

type Worker = { revokedAt: string | null; lastSeenAt: string | null; statusAt?: string | null; providerStatus?: { provider: string; state: string }[] | null };
type Props = {
  url: string; refresh: number; evidenceDigest: string; unavailable: boolean; active: boolean;
  workers: Worker[]; now: number; rate: number; buffer: number; hours: number; currency: string;
  onApply: (report: ReviewReport, target: "review" | "proposal") => void;
  onContinue: (job: ReviewJob, provider: string) => void;
};
const states: Record<string, string> = { QUEUED: "Waiting for worker", RUNNING: "Reviewing source", SUCCEEDED: "Proposal ready", FAILED: "Review stopped", CANCELLED: "Cancelled" };
export function ReviewComparison({ url, refresh, evidenceDigest, unavailable, active, workers, now, rate, buffer, hours, currency, onApply, onContinue }: Props) {
  const [jobs, setJobs] = useState<ReviewJob[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const data = await api<{ jobs: ReviewJob[] }>(url);
        if (data.jobs.length !== 2 || !["codex", "claude"].every(p => data.jobs.some(j => j.provider === p))) throw new Error("Comparison replies are unavailable. Retry status.");
        if (!ignore) { setJobs(data.jobs); setError(""); setLoading(false); }
      } catch (e) { if (!ignore) { setError((e as Error).message); setLoading(true); } }
    }
    void load(); const timer = setInterval(() => void load(), 10_000);
    return () => { ignore = true; clearInterval(timer); };
  }, [url, refresh, retry]);
  const multiplier = 1 + buffer / 100;
  const cost = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n * rate * multiplier);
  return <section className="review-comparison" aria-label="Proposal comparison">
    <h4>Compare proposals</h4>
    <p className="portal-muted">Independent replies to the same saved commit and request. Compare the scope and assumptions as well as the hours. Shared cost settings above apply to both.</p>
    {error && <p role="alert" className="portal-error">{error} <button className="portal-plain" onClick={() => setRetry(n => n + 1)}>Retry comparison status</button></p>}
    {!jobs.length && !error && <p role="status">Loading comparison…</p>}
    <div className="comparison-grid">{["codex", "claude"].map(provider => {
      const job = jobs.find(j => j.provider === provider), report = job?.status === "SUCCEEDED" ? job.result : null;
      const stale = Boolean(job?.stale || (evidenceDigest && job?.inputDigest && job.inputDigest !== evidenceDigest));
      const name = provider === "codex" ? "Codex" : "Claude";
      const ready = workers.some(w => !w.revokedAt && w.lastSeenAt && now - new Date(w.lastSeenAt).getTime() < 60_000 && w.statusAt && now - new Date(w.statusAt).getTime() < 120_000 && w.providerStatus?.some(p => p.provider === provider && ["READY", "BUSY"].includes(p.state)));
      const blocked = loading || unavailable || stale;
      return <article key={provider} className="comparison-card" aria-label={`${name} proposal`}>
        <div className="comparison-title"><h5>{name}</h5><span role="status">{job ? states[job.status] ?? "Unknown status" : "Loading"}</span></div>
        {job && <p className="portal-muted">Commit {job.commit.slice(0, 7)}</p>}
        {job?.status === "QUEUED" && <p>{ready ? "Waiting for a free worker. One worker runs one agent at a time." : `${name} needs an online worker with its own subscription login. Enable ${provider} in the worker configuration and sign in on the worker host; see Worker setup. This proposal will wait until it is ready.`}</p>}
        {job?.status === "RUNNING" && <p>Review is in progress. Open this agent’s review in history for its saved activity.</p>}
        {job?.errorCode && <p className="portal-notice">{failures[job.errorCode] ?? "Check this provider on the worker host."} Any completed proposal remains available.</p>}
        {job?.status === "CANCELLED" && <p>The unfinished proposal was cancelled. Completed replies remain available.</p>}
        {stale && <p className="portal-notice">The requests or repository evidence changed. Run a fresh review before using this proposal.</p>}
        {report && <>
          <p className="portal-preserve">{report.summary}</p>
          <p className="comparison-effort"><strong>{report.effort.minHours}–{report.effort.maxHours} engineering hours</strong><span>{report.effort.confidence} confidence</span></p>
          <p>{rate ? `${cost(report.effort.minHours)}–${cost(report.effort.maxHours)}` : "Enter your hourly rate above for a cost range."}<br />{Math.ceil(report.effort.minHours * multiplier / hours)}–{Math.ceil(report.effort.maxHours * multiplier / hours)} working days including buffer.</p>
          <h6>Recommended scope</h6><p className="portal-preserve">{report.scope}</p>
          <details><summary>Evidence, acceptance & assumptions</summary>
            {report.findings.map((f, i) => <div className="review-finding" key={i}><strong>{f.severity}</strong><p>{f.detail}</p><p className="portal-muted">Evidence: {f.evidence.join(", ")}</p></div>)}
            <h6>Acceptance checks</h6><p className="portal-preserve">{report.acceptance}</p>
            <h6>Assumptions</h6><p className="portal-preserve">{report.assumptions}</p>
            {report.questions.length > 0 && <><h6>Questions to resolve</h6><ul>{report.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></>}
            <p className="portal-muted">{job?.coverage?.readFiles} files sampled of {job?.coverage?.eligibleFiles} eligible. {job?.coverage?.limitations.join(" ")}</p>
          </details>
          <div className="review-controls"><button className="button outline" disabled={blocked} onClick={() => onApply(report, "proposal")}>Add {name} scope to draft</button><button className="portal-plain" disabled={blocked || active} onClick={() => onContinue(job!, provider === "codex" ? "claude" : "codex")}>Continue with {provider === "codex" ? "Claude" : "Codex"}</button></div>
        </>}
      </article>;
    })}</div>
    <p className="portal-muted">Adds scope, acceptance checks and assumptions to your editable proposal, preserving any existing draft. Review the combined text before publishing. These are preliminary planning ranges; nothing is published or charged here.</p>
  </section>;
}
