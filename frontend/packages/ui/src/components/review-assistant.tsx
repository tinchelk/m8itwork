"use client";
import { useEffect, useRef, useState } from "react";
import { API, api, displayDate, type Project } from "./workspace-types";
import type { Save } from "./workspace-forms";
export interface ReviewReport {
  summary: string;
  findings: { severity: string; detail: string; evidence: string[] }[];
  scope: string; acceptance: string; assumptions: string; questions: string[];
  effort: { minHours: number; maxHours: number; confidence: string };
}
interface ReviewJob {
  id: string; provider: string; status: string; commit: string; stale: boolean;
  createdAt: string; errorCode: string | null; result: ReviewReport | null;
  coverage: { readFiles: number; eligibleFiles: number; limitations: string[] } | null;
}
const failures: Record<string, string> = {
  QUOTA: "Subscription limit reached. The worker pauses this provider for 30 minutes. Retry after its allowance resets.",
  AUTH: "Sign the local worker back in to its subscription, then retry.",
  CONNECTION: "Ask the customer to reconnect GitHub in their dashboard, then retry.",
  SOURCE: "No eligible source was found. Review manually or arrange a fresh repository submission.",
  PROVIDER: "Check the local worker, then retry or review manually.",
  INVALID_REPORT: "The result failed validation. Retry or review manually.",
  NETWORK: "Connection interrupted. Check the local worker and retry.",
  TIMEOUT: "The review timed out. Retry or narrow the scope.",
};
export function reviewText(r: ReviewReport) {
  return [r.summary, ...r.findings.map(f => `${f.severity.toUpperCase()}: ${f.detail}\nEvidence: ${f.evidence.join(", ")}`), ...(r.questions.length ? ["Questions to resolve:", ...r.questions] : [])].join("\n\n");
}
export function ReviewAssistant({ project, save, busy, onApply }: { project: Project; save: Save; busy: boolean; onApply: (report: ReviewReport, target: "review" | "proposal") => void }) {
  const [jobs, setJobs] = useState<ReviewJob[]>([]), [online, setOnline] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [error, setError] = useState(""), [working, setWorking] = useState(false), [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("codex"), [rate, setRate] = useState(0), [buffer, setBuffer] = useState(20), [hours, setHours] = useState(6), [currency, setCurrency] = useState("USD");
  const queueId = useRef<string | null>(null);
  const [pendingQueue, setPendingQueue] = useState(false);
  const prefix = `/v1/operator/projects/${project.id}/review-jobs`;
  useEffect(() => {
    let ignore = false;
    async function load() {
      try { const data = await api<{ jobs: ReviewJob[]; onlineWorkers: number }>(prefix); if (!ignore) { setJobs(data.jobs); setOnline(data.onlineWorkers); if (queueId.current && data.jobs.some(j => j.id === queueId.current)) { queueId.current = null; setPendingQueue(false); } setError(""); } }
      catch (e) { if (!ignore) setError((e as Error).message); }
      finally { if (!ignore) setLoading(false); }
    }
    void load(); const timer = setInterval(() => void load(), 10_000);
    return () => { ignore = true; clearInterval(timer); };
  }, [prefix, project.version]);
  async function reload() { const data = await api<{ jobs: ReviewJob[]; onlineWorkers: number }>(prefix); setJobs(data.jobs); setOnline(data.onlineWorkers); if (queueId.current && data.jobs.some(j => j.id === queueId.current)) { queueId.current = null; setPendingQueue(false); } setError(""); }
  const active = jobs.find(j => ["QUEUED", "RUNNING"].includes(j.status)), latest = jobs[0], shown = jobs.find(j => j.id === selectedJobId) ?? latest, report = shown?.result;
  const multiplier = 1 + buffer / 100;
  const cost = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n * rate * multiplier);
  return <div className="review-assistant">
    <div className="portal-section-heading"><h3>Prepare a review</h3><span className="portal-muted">Private draft · human approval</span></div>
    <p>A local coding agent reviews a sample of the saved repository. No code or tests are run. Publish only after checking its evidence.</p>
    {!project.aiReviewConsentAt && <p className="portal-notice">The customer needs to allow AI-assisted review in their dashboard. You can continue reviewing manually below.</p>}
    {!project.repositoryUrl && <p className="portal-notice">A saved GitHub repository is needed for an AI review. You can review this project manually using the form below.</p>}
    <div className="review-controls">
      <label>Coding agent<select value={provider} onChange={e => setProvider(e.target.value)} disabled={busy || working || Boolean(active) || pendingQueue}><option value="codex">Codex subscription</option><option value="claude">Claude Code subscription</option></select></label>
      <button className="button" disabled={loading || busy || working || Boolean(active) || !project.aiReviewConsentAt || !project.repositoryUrl} onClick={async () => {
        setWorking(true); setError(""); queueId.current ??= crypto.randomUUID(); setPendingQueue(true);
        try { if (await save(prefix, { id: queueId.current, version: project.version, provider }, "Review queued. Results will stay private until you publish.")) { queueId.current = null; setPendingQueue(false); setSelectedJobId(null); await reload(); } }
        catch (e) { setError((e as Error).message); } finally { setWorking(false); }
      }}>{working ? "Saving…" : active ? "Review in progress" : pendingQueue ? "Retry queue request" : latest ? "Run a fresh review" : "Queue review"}</button>
    </div>
    <p className="portal-muted">{loading ? "Loading review status…" : online ? `${online} worker${online === 1 ? "" : "s"} online. The selected provider must be enabled on a worker.` : "Worker offline. Queued reviews wait until your machine reconnects. Open Worker setup on the project overview to pair it."}</p>
    {error && <p role="alert" className="portal-error">{error} <button className="portal-plain" onClick={() => void reload().catch(e => setError((e as Error).message))}>Try again</button></p>}
    {latest && <div role="status" className="review-job-status"><strong>{({ QUEUED: "Queued", RUNNING: "Reviewing source", SUCCEEDED: "Draft ready", FAILED: "Review stopped", CANCELLED: "Review cancelled" } as Record<string, string>)[latest.status]}</strong><span>{latest.provider} · commit {latest.commit.slice(0, 7)} · {displayDate(latest.createdAt)}</span></div>}
    {active && <button className="portal-plain" disabled={working} onClick={async () => { setWorking(true); try { await api(`${prefix}/${active.id}/cancel`, {}); await reload(); } catch (e) { setError((e as Error).message); } finally { setWorking(false); } }}>Cancel review</button>}
    {latest?.errorCode && <p className="portal-notice">{failures[latest.errorCode] ?? "Check the worker and retry, or review manually."}</p>}
    {jobs.length > 1 && <label className="review-history">Review history<select value={shown?.id ?? ""} onChange={e => setSelectedJobId(e.target.value)}>{jobs.map(j => <option key={j.id} value={j.id}>{displayDate(j.createdAt)} · {j.provider} · {j.status.toLowerCase()} · {j.commit.slice(0, 7)}</option>)}</select></label>}
    {report && <>
      {shown!.stale && <p className="portal-notice">Requests or repository evidence changed after this review was queued. Run a fresh review before using the draft.</p>}
      <details className="review-draft" open><summary>Draft findings & recommended scope</summary>
        <p className="portal-preserve">{report.summary}</p>
        {report.findings.map((f, i) => <div key={i} className="review-finding"><strong>{f.severity}</strong><p>{f.detail}</p><p className="portal-muted">Evidence: {f.evidence.join(", ")}</p></div>)}
        <h4>Recommended scope</h4><p className="portal-preserve">{report.scope}</p>
        <h4>Acceptance checks</h4><p className="portal-preserve">{report.acceptance}</p>
        <h4>Assumptions</h4><p className="portal-preserve">{report.assumptions}</p>
        {report.questions.length > 0 && <><h4>Questions to resolve</h4><ul>{report.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></>}
        <p><strong>{report.effort.minHours}–{report.effort.maxHours} engineering hours</strong> · {report.effort.confidence} confidence</p>
        <p className="portal-muted">{shown!.coverage?.readFiles} files sampled of {shown!.coverage?.eligibleFiles} eligible. {shown!.coverage?.limitations.join(" ")}</p>
      </details>
      <details className="review-calculator"><summary>Plan cost & working time</summary>
        <div className="portal-form-row"><label>Your hourly rate<input type="number" min="0" max="10000" value={rate} onChange={e => setRate(Math.max(0, Math.min(10000, Number(e.target.value))))} /></label><label>Currency<select value={currency} onChange={e => setCurrency(e.target.value)}>{["USD", "GBP", "EUR", "AUD", "CAD"].map(c => <option key={c}>{c}</option>)}</select></label></div>
        <div className="portal-form-row"><label>Uncertainty buffer (%)<input type="number" min="0" max="100" value={buffer} onChange={e => setBuffer(Math.max(0, Math.min(100, Number(e.target.value))))} /></label><label>Available hours per working day<input type="number" min="1" max="12" value={hours} onChange={e => setHours(Math.max(1, Math.min(12, Number(e.target.value))))} /></label></div>
        <p>{rate ? `${cost(report.effort.minHours)}–${cost(report.effort.maxHours)}` : "Enter your rate for a cost range"} · {Math.ceil(report.effort.minHours * multiplier / hours)}–{Math.ceil(report.effort.maxHours * multiplier / hours)} working days including buffer.</p>
        <p className="portal-muted">Planning range only. Choose the final price and calendar date in your proposal.</p>
      </details>
      <div className="review-controls"><button className="button outline" disabled={busy || shown!.stale} onClick={() => onApply(report, "review")}>Add to review draft</button><button className="button outline" disabled={busy || shown!.stale} onClick={() => onApply(report, "proposal")}>Add to scope draft</button></div>
      <p className="portal-muted">Adds to your editable form below. Nothing is sent to the customer until you publish.</p>
    </>}
  </div>;
}
interface Worker { id: string; name: string; lastSeenAt: string | null; revokedAt: string | null }
export function WorkerSetup() {
  const [workers, setWorkers] = useState<Worker[]>([]), [config, setConfig] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [now, setNow] = useState(0);
  async function load() { const result = await api<{ workers: Worker[] }>("/v1/operator/review-workers"); setWorkers(result.workers); setNow(Date.now()); }
  return <details className="portal-card worker-setup" onToggle={e => { if (e.currentTarget.open) void load().catch(e => setError((e as Error).message)); }}>
    <summary>Worker setup</summary>
    <p>Pair your machine once. It polls this service and uses your local Codex or Claude Code subscription. Your machine needs to be awake and the worker running.</p>
    {error && <p role="alert" className="portal-error">{error}</p>}
    <form className="portal-form" onSubmit={async e => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get("name")); setBusy(true); setError(""); try { const paired = await api<{ token: string }>("/v1/operator/review-workers", { name }); setConfig(JSON.stringify({ apiUrl: `${API.replace(/\/$/, "")}/`, token: paired.token, providers: ["codex"] }, null, 2)); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
      <label>Machine name<input name="name" required maxLength={80} placeholder="My Mac" /></label><button className="button" disabled={busy || Boolean(config)}>{busy ? "Pairing…" : "Create worker connection"}</button>
    </form>
    {config && <div className="worker-secret"><p>This connection key is shown once. Keep it private.</p><label>Private worker configuration<textarea readOnly value={config} rows={7} spellCheck={false} /></label><button className="portal-plain" onClick={() => setConfig("")}>Hide key</button><p>In the backend directory, run <code>npm run worker:configure</code>, paste this JSON, then press Ctrl+D. Run <code>npm run worker:doctor</code> and <code>npm run worker:run</code>. See <code>docs/REVIEW_WORKER.md</code> for Claude and automatic startup.</p></div>}
    <button className="portal-plain" disabled={busy} onClick={() => void load().then(() => setError("")).catch(e => setError((e as Error).message))}>Refresh worker status</button>
    <ul className="worker-list">{workers.map(w => <li key={w.id}><div><strong>{w.name}</strong><p className="portal-muted">{w.revokedAt ? "Revoked" : w.lastSeenAt && now - new Date(w.lastSeenAt).getTime() < 60_000 ? "Online" : "Offline / not started"}</p></div>{!w.revokedAt && <button className="portal-plain" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/v1/operator/review-workers/${w.id}/revoke`, {}); setConfig(""); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Revoke {w.name}</button>}</li>)}</ul>
  </details>;
}
export function AiReviewConsent({ project, save, busy }: { project: Project; save: Save; busy: boolean }) {
  return <details className="portal-card"><summary>AI-assisted review permission</summary><p>Our coding agent can review a sample of your source and requests using OpenAI or Anthropic. We check its draft before sharing a review or quote. <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy & access terms</a>.</p><p>{project.aiReviewConsentAt ? "You’ve allowed AI-assisted review. Withdrawing stops queued and running reviews; material already sent to a provider cannot be recalled." : "Allow this if you’d like us to prepare an AI-assisted review. You can also discuss the project with us in the conversation."}</p><button className="button outline" disabled={busy} onClick={() => void save(`/v1/projects/${project.id}/ai-review-consent`, { version: project.version, policy: "ai-review-v1", consent: !project.aiReviewConsentAt }, project.aiReviewConsentAt ? "AI review permission withdrawn." : "AI review permission saved.")}>{project.aiReviewConsentAt ? "Withdraw permission" : "Allow AI-assisted review"}</button></details>;
}
