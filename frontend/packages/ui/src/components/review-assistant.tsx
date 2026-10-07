"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { API, api, WorkspaceError, type Project } from "./workspace-types";
import type { Save } from "./workspace-forms";
import { useFormDraft } from "./workspace-drafts";
import { readReviewSession, reviewSessionKey, writeReviewSession, type ReviewQueueRequest, type ReviewSession } from "./review-session";
import { WorkerLogin, type WorkerLoginState } from "./worker-login";
const displayTime = (value: string) => new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
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
  instructions?: string | null;
  activity?: { id: string; kind: string; text: string; at: string }[] | null;
  activityOmitted?: number;
  inputDigest?: string;
}
interface Worker { remoteLogin?: boolean; loginRequest?: WorkerLoginState | null; id: string; name: string; lastSeenAt: string | null; revokedAt: string | null; statusAt?: string | null; providerStatus?: { provider: string; state: string; retryAt?: string }[] | null; jobs?: { id: string; projectId: string; provider: string }[] }
interface ReviewPage { jobs: ReviewJob[]; onlineWorkers: number; workers?: Worker[]; nextCursor?: string | null; evidenceDigest?: string }
async function fetchReviewPage(prefix: string, saved: ReviewSession | null) {
  const data = await api<ReviewPage>(prefix);
  const active = data.jobs.find(j => ["QUEUED", "RUNNING"].includes(j.status));
  if (saved) {
    let added = false;
    for (const id of new Set([saved.pending?.id, saved.parentJobId].filter((id): id is string => Boolean(id)))) {
      if (!data.jobs.some(j => j.id === id)) {
        try { const older = await api<{ job: ReviewJob }>(`${prefix}/${id}`); data.jobs.push(older.job); added = true; }
        catch (e) { if (!(e instanceof WorkspaceError && e.status === 404)) throw e; }
      }
    }
    if (added) data.jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }
  return { data, active };
}
const providerLabels: Record<string, string> = { READY: "Ready", BUSY: "Working", NEEDS_LOGIN: "Sign-in needed", LIMITED: "Subscription limit reached", ERROR: "Provider error" };
function ProviderStatus({ worker, now }: { worker: Worker; now: number }) {
  const fresh = !worker.revokedAt && Boolean(worker.lastSeenAt && now - new Date(worker.lastSeenAt).getTime() < 60_000 && worker.statusAt && now - new Date(worker.statusAt).getTime() < 120_000);
  return <div className="worker-provider-status">
    {!worker.providerStatus?.length ? <p className="portal-muted">Provider status not reported yet. Start the current Docker worker to report readiness.</p> : worker.providerStatus.map(p => <div key={p.provider}><strong>{p.provider}</strong><span className={`provider-state ${fresh ? p.state.toLowerCase() : "stale"}`}>{fresh ? providerLabels[p.state] ?? "Unknown status" : "Status stale / offline"}</span>{fresh && p.retryAt && <p className="portal-muted">Next check after {displayTime(p.retryAt)}.</p>}{fresh && p.state === "NEEDS_LOGIN" && (p.provider !== "codex" || !worker.remoteLogin) && <p>On the worker host, stop the container and run <code>docker compose -f compose.worker.yml run --rm -it worker login-{p.provider}</code>, then run doctor and start it again. Device/browser sign-in can be completed from your own computer.</p>}{fresh && p.state === "ERROR" && <p className="portal-muted">Check the latest review failure and worker logs, then run the subscription doctor on its host.</p>}</div>)}
    {worker.providerStatus?.some(p => p.provider === "codex") && <WorkerLogin worker={worker} />}
  </div>;
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
export function ReviewAssistant({ accountId, project, save, busy, onApply }: { accountId: string; project: Project; save: Save; busy: boolean; onApply: (report: ReviewReport, target: "review" | "proposal") => void }) {
  const [jobs, setJobs] = useState<ReviewJob[]>([]), [online, setOnline] = useState(0);
  const [active, setActive] = useState<ReviewJob | undefined>();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [error, setError] = useState(""), [working, setWorking] = useState(false), [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("codex"), [rate, setRate] = useState(0), [buffer, setBuffer] = useState(20), [hours, setHours] = useState(6), [currency, setCurrency] = useState("USD");
  const queueId = useRef<string | null>(null);
  const [pendingQueue, setPendingQueue] = useState(false);
  const [workers, setWorkers] = useState<Worker[]>([]), [nextCursor, setNextCursor] = useState<string | null>(null), [olderCursor, setOlderCursor] = useState<string | null>(null), [olderLoaded, setOlderLoaded] = useState(false), [loadingOlder, setLoadingOlder] = useState(false), [statusNow, setStatusNow] = useState(0), [evidenceDigest, setEvidenceDigest] = useState("");
  const [parentJobId, setParentJobId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null), questionRef = useRef<HTMLTextAreaElement>(null);
  const draft = useFormDraft(formRef, accountId, `review-chat:${project.id}`);
  const pendingBody = useRef<ReviewQueueRequest | null>(null), restored = useRef(false);
  const sessionKey = reviewSessionKey(accountId, project.id);
  const reportRef = useRef<HTMLHeadingElement>(null), reportDisclosure = useRef<HTMLDetailsElement>(null), openRequested = useRef(false);
  const clearDraft = draft.clear;
  const acknowledgeQueue = useCallback(() => {
    const confirmedProvider = pendingBody.current?.provider ?? "codex";
    writeReviewSession(sessionKey, { provider: confirmedProvider, parentJobId: null, pending: null });
    queueId.current = null; pendingBody.current = null; setPendingQueue(false);
    setSelectedJobId(null); setParentJobId(null);
    if (questionRef.current) questionRef.current.value = "";
    clearDraft();
  }, [clearDraft, sessionKey]);
  const prefix = `/v1/operator/projects/${project.id}/review-jobs`;
  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        // Restore local identity/context independently of network availability.
        await Promise.resolve();
        if (!restored.current && !ignore) {
            restored.current = true;
            const saved = readReviewSession(sessionKey);
            if (saved) { setProvider(saved.provider); setParentJobId(saved.parentJobId); pendingBody.current = saved.pending; queueId.current = saved.pending?.id ?? null; setPendingQueue(Boolean(saved.pending)); }
        }
        const { data, active } = await fetchReviewPage(prefix, readReviewSession(sessionKey));
        if (!ignore) { setActive(active); setJobs(current => [...data.jobs, ...current.filter(j => !data.jobs.some(fresh => fresh.id === j.id))]); setOnline(data.onlineWorkers); setWorkers(data.workers ?? []); setStatusNow(Date.now()); setEvidenceDigest(data.evidenceDigest ?? ""); setNextCursor(data.nextCursor ?? null); if (queueId.current && data.jobs.some(j => j.id === queueId.current)) { acknowledgeQueue(); } setError(""); setLoading(false); }
      }
      catch (e) { if (!ignore) { setError((e as Error).message); setLoading(true); } }
    }
    void load(); const timer = setInterval(() => void load(), 10_000);
    return () => { ignore = true; clearInterval(timer); };
  }, [prefix, project.version, acknowledgeQueue, sessionKey]);
  useEffect(() => {
    if (!openRequested.current || !reportRef.current) return;
    openRequested.current = false; if (reportDisclosure.current) reportDisclosure.current.open = true; reportRef.current.focus(); reportRef.current.scrollIntoView({ block: "start", behavior: "instant" });
  }, [selectedJobId]);
  async function reload() { const { data, active } = await fetchReviewPage(prefix, readReviewSession(sessionKey)); setActive(active); setJobs(current => [...data.jobs, ...current.filter(j => !data.jobs.some(fresh => fresh.id === j.id))]); setOnline(data.onlineWorkers); setWorkers(data.workers ?? []); setStatusNow(Date.now()); setEvidenceDigest(data.evidenceDigest ?? ""); setNextCursor(data.nextCursor ?? null); if (queueId.current && data.jobs.some(j => j.id === queueId.current)) { acknowledgeQueue(); } setError(""); setLoading(false); }
  const history = jobs.map(j => ({ ...j, stale: j.stale || Boolean(evidenceDigest && j.inputDigest && j.inputDigest !== evidenceDigest) }));
  const latest = history[0], shown = history.find(j => j.id === selectedJobId) ?? latest, report = shown?.result;
  const followUp = history.find(j => j.id === parentJobId), staleFollowUp = Boolean(parentJobId && (!followUp || followUp.stale));
  const multiplier = 1 + buffer / 100;
  const cost = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n * rate * multiplier);
  return <div className="review-assistant">
    <div className="portal-section-heading"><h3>Prepare a review</h3><span className="portal-muted">Private draft · human approval</span></div>
    <p>A local coding agent reviews a sample of the saved repository. No code or tests are run. Publish only after checking its evidence.</p>
    {!project.aiReviewConsentAt && <p className="portal-notice">The customer needs to allow AI-assisted review in their dashboard. You can continue reviewing manually below.</p>}
    {!project.repositoryUrl && <p className="portal-notice">A saved GitHub repository is needed for an AI review. You can review this project manually using the form below.</p>}
    <form ref={formRef} onInput={draft.capture} onChange={draft.capture} onSubmit={async e => {
      e.preventDefault(); setWorking(true); setError(""); draft.capture(); queueId.current ??= crypto.randomUUID(); setPendingQueue(true);
      pendingBody.current ??= { id: queueId.current, version: project.version, provider, instructions: questionRef.current?.value.trim() ?? "", ...(parentJobId ? { parentJobId } : {}) };
      writeReviewSession(sessionKey, { provider, parentJobId, pending: pendingBody.current });
      try { if (await save(prefix, pendingBody.current, "Review queued. Results will stay private until you publish.", reason => { if (reason instanceof WorkspaceError && [400, 409, 413, 422].includes(reason.status)) { queueId.current = null; pendingBody.current = null; setPendingQueue(false); writeReviewSession(sessionKey, { provider, parentJobId, pending: null }); } })) { acknowledgeQueue(); await reload(); } }
      catch (e) { setError((e as Error).message); } finally { setWorking(false); }
    }}>
    <label className="agent-question">Follow-up question or review instructions{parentJobId ? "" : " (optional)"}<textarea ref={questionRef} name="instructions" maxLength={3000} required={Boolean(parentJobId)} disabled={loading || busy || working || Boolean(active) || pendingQueue} rows={3} placeholder="What should the agent investigate or clarify? Leave out credentials." /></label>
    {parentJobId && <p className="portal-notice">Continuing from the selected reply at {followUp ? displayTime(followUp.createdAt) : "an earlier review"}. {loading ? "Restoring the saved conversation. Retry status if it is unavailable." : staleFollowUp ? "The evidence changed. Start a fresh review." : "The latest three reply summaries are carried into the next turn."} <button type="button" className="portal-plain" disabled={working || pendingQueue} onClick={() => { setParentJobId(null); writeReviewSession(sessionKey, { provider, parentJobId: null, pending: null }); }}>Start a fresh review</button></p>}
    <div className="review-controls">
      <label>Coding agent<select value={provider} onChange={e => { setProvider(e.target.value); writeReviewSession(sessionKey, { provider: e.target.value, parentJobId, pending: pendingBody.current }); }} disabled={busy || working || Boolean(active) || pendingQueue}><option value="codex">Codex subscription</option><option value="claude">Claude Code subscription</option></select></label>
      <button className="button" disabled={loading || busy || working || Boolean(active) || (staleFollowUp && !pendingQueue) || !project.aiReviewConsentAt || !project.repositoryUrl}>{working ? "Saving…" : pendingQueue ? "Retry queue request" : active ? "Review in progress" : parentJobId ? "Send follow-up" : latest ? "Run a fresh review" : "Queue review"}</button>
    </div>
    </form>
    <p className="portal-muted">{loading ? "Loading review status…" : online ? `${online} worker${online === 1 ? "" : "s"} online. The selected provider must be enabled on a worker.` : "Worker offline. Queued reviews wait until your machine reconnects. Open Worker setup on the project overview to pair it."}</p>
    {workers.length > 0 && <details className="review-provider-panel" open={workers.some(w => w.providerStatus?.some(p => ["NEEDS_LOGIN", "LIMITED", "ERROR"].includes(p.state)))}><summary>Provider readiness</summary>{workers.map(w => <div key={w.id}><strong>{w.name}</strong><ProviderStatus worker={w} now={statusNow} /></div>)}</details>}
    {error && <p role="alert" className="portal-error">{error} <button className="portal-plain" onClick={() => void reload().catch(e => setError((e as Error).message))}>Try again</button></p>}
    {latest && <div role="status" className="review-job-status"><strong>{({ QUEUED: "Queued", RUNNING: "Reviewing source", SUCCEEDED: "Draft ready", FAILED: "Review stopped", CANCELLED: "Review cancelled" } as Record<string, string>)[latest.status]}</strong><span>{latest.provider} · commit {latest.commit.slice(0, 7)} · {displayTime(latest.createdAt)}</span></div>}
    {active && history.find(j => j.id === active.id)?.stale && <p className="portal-notice">Requests or repository evidence changed. This reply would be out of date. Cancel the review; the worker also stops stale follow-ups when it next checks access.</p>}
    {active && <button className="portal-plain" disabled={working} onClick={async () => { setWorking(true); try { await api(`${prefix}/${active.id}/cancel`, {}); await reload(); } catch (e) { setError((e as Error).message); } finally { setWorking(false); } }}>Cancel review</button>}
    {latest?.errorCode && <p className="portal-notice">{failures[latest.errorCode] ?? "Check the worker and retry, or review manually."}</p>}
    {history.length > 1 && <label className="review-history">Review history<select value={shown?.id ?? ""} onChange={e => setSelectedJobId(e.target.value)}>{history.map(j => <option key={j.id} value={j.id}>{displayTime(j.createdAt)} · {j.provider} · {j.status.toLowerCase()} · {j.commit.slice(0, 7)}</option>)}</select></label>}
    {shown && <details className="review-activity" open={shown.status === "RUNNING"}><summary>Activity for selected review</summary>{shown.activity?.length ? <ol>{shown.activity.map(e => <li key={e.id}><strong>{e.kind === "MESSAGE" ? "Agent message" : e.kind.toLowerCase()}</strong><time dateTime={e.at}>{displayTime(e.at)}</time><p className="portal-preserve">{e.text}</p></li>)}</ol> : <p className="portal-muted">Activity will appear when the current Docker worker starts this review. Earlier workers did not report activity.</p>}{Boolean(shown.activityOmitted) && <p className="portal-muted">{shown.activityOmitted} older activity entries omitted. The saved prompt and validated reply remain in the conversation.</p>}</details>}
    {history.length > 0 && <details className="agent-conversation" open><summary>Private agent conversation</summary><p className="portal-muted">Saved prompts, validated replies and decision summaries. Each turn uses a fresh read-only source sample. Visible activity is bounded; credentials and internal reasoning are excluded.</p><ol>{[...history].reverse().map(j => <li key={j.id}><p className="portal-muted">{displayTime(j.createdAt)} · {j.provider} · {j.status.toLowerCase()} · commit {j.commit.slice(0, 7)}</p><strong>You</strong><p className="portal-preserve">{j.instructions || "Review the customer’s request and recommend scope and effort."}</p><strong>Agent reply</strong><p className="portal-preserve">{j.result?.summary ?? (j.errorCode ? failures[j.errorCode] ?? "Review stopped." : j.status === "CANCELLED" ? "Review cancelled." : "Waiting for the worker’s reply.")}</p>{j.result && <button className="portal-plain" onClick={() => { if (selectedJobId === j.id) { if (reportDisclosure.current) reportDisclosure.current.open = true; reportRef.current?.focus(); reportRef.current?.scrollIntoView({ block: "start", behavior: "instant" }); } else { openRequested.current = true; setSelectedJobId(j.id); } }}>Open full reply from {displayTime(j.createdAt)}</button>}</li>)}</ol></details>}
    {(olderLoaded ? olderCursor : nextCursor) && <button className="portal-plain" disabled={loadingOlder} onClick={async () => { const cursor = olderLoaded ? olderCursor : nextCursor; if (!cursor) return; setLoadingOlder(true); try { const page = await api<ReviewPage>(`${prefix}?cursor=${cursor}`); setJobs(current => [...current.map(old => page.jobs.find(fresh => fresh.id === old.id) ?? old), ...page.jobs.filter(j => !current.some(old => old.id === j.id))]); setOlderCursor(page.nextCursor ?? null); setOlderLoaded(true); } catch (e) { setError((e as Error).message); } finally { setLoadingOlder(false); } }}>{loadingOlder ? "Loading…" : "Load older reviews"}</button>}
    {report && <>
      {shown!.stale && <p className="portal-notice">Requests or repository evidence changed after this review was queued. Run a fresh review before using the draft.</p>}
      <h4 className="review-report-heading" tabIndex={-1} ref={reportRef}>Full reply · {displayTime(shown!.createdAt)}</h4>
      <details ref={reportDisclosure} className="review-draft" open><summary>Draft findings & recommended scope</summary>
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
      <div className="review-controls"><button className="button outline" disabled={busy || shown!.stale || Boolean(active) || pendingQueue} onClick={() => { setParentJobId(shown!.id); writeReviewSession(sessionKey, { provider, parentJobId: shown!.id, pending: null }); questionRef.current?.focus(); }}>Ask a follow-up</button><button className="button outline" disabled={busy || shown!.stale} onClick={() => onApply(report, "review")}>Add to review draft</button><button className="button outline" disabled={busy || shown!.stale} onClick={() => onApply(report, "proposal")}>Add to scope draft</button></div>
      <p className="portal-muted">Adds to your editable form below. Nothing is sent to the customer until you publish.</p>
    </>}
  </div>;
}
export function WorkerSetup() {
  const [workers, setWorkers] = useState<Worker[]>([]), [config, setConfig] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [now, setNow] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const load = useCallback(async () => { const result = await api<{ workers: Worker[] }>("/v1/operator/review-workers"); setWorkers(result.workers); setNow(Date.now()); }, []);
  useEffect(() => { if (!expanded) return; const timer = setInterval(() => void load().catch(e => setError((e as Error).message)), 10_000); return () => clearInterval(timer); }, [expanded, load]);
  return <details className="portal-card worker-setup" onToggle={e => { setExpanded(e.currentTarget.open); if (e.currentTarget.open) void load().catch(e => setError((e as Error).message)); }}>
    <summary>Worker setup</summary>
    <p>Pair your Docker host once. It polls this service and uses its Codex or Claude Code subscription login. Check provider readiness here; open a project for its private conversation and activity.</p>
    {error && <p role="alert" className="portal-error">{error}</p>}
    <form className="portal-form" onSubmit={async e => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get("name")); setBusy(true); setError(""); try { const paired = await api<{ token: string }>("/v1/operator/review-workers", { name }); setConfig(JSON.stringify({ apiUrl: `${API.replace(/\/$/, "")}/`, token: paired.token, providers: ["codex"] }, null, 2)); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
      <label>Machine name<input name="name" required maxLength={80} placeholder="Review server" /></label><button className="button" disabled={busy || Boolean(config)}>{busy ? "Pairing…" : "Create worker connection"}</button>
    </form>
    {config && <div className="worker-secret"><p>This connection key is shown once. Keep it private.</p><label>Private worker configuration<textarea readOnly value={config} rows={7} spellCheck={false} /></label><button className="portal-plain" onClick={() => setConfig("")}>Hide key</button><p>On the worker host, run <code>docker compose -f compose.worker.yml run --rm -T worker configure</code>, paste this JSON, then finish stdin. Sign in with <code>docker compose -f compose.worker.yml run --rm -it worker login-codex</code>, run <code>docker compose -f compose.worker.yml run --rm worker doctor</code> and start with <code>docker compose -f compose.worker.yml up -d</code>. See <code>docs/DOCKER_WORKER.md</code> for the complete commands and Claude setup.</p></div>}
    <button className="portal-plain" disabled={busy} onClick={() => void load().then(() => setError("")).catch(e => setError((e as Error).message))}>Refresh worker status</button>
    <ul className="worker-list">{workers.map(w => <li key={w.id}><div><strong>{w.name}</strong><p className="portal-muted">{w.revokedAt ? "Revoked" : w.lastSeenAt && now - new Date(w.lastSeenAt).getTime() < 60_000 ? "Online" : "Offline / not started"}</p><ProviderStatus worker={w} now={now} />{w.jobs?.map(j => <p key={j.id}><a href={`/?project=${j.projectId}`}>Open the project {j.provider} is reviewing</a></p>)}</div>{!w.revokedAt && <button className="portal-plain" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/v1/operator/review-workers/${w.id}/revoke`, {}); setConfig(""); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Revoke {w.name}</button>}</li>)}</ul>
  </details>;
}
export function AiReviewConsent({ project, save, busy }: { project: Project; save: Save; busy: boolean }) {
  return <details className="portal-card"><summary>AI-assisted review permission</summary><p>Our coding agent can review a sample of your source and requests using OpenAI or Anthropic. We check its draft before sharing a review or quote. <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy & access terms</a>.</p><p>{project.aiReviewConsentAt ? "You’ve allowed AI-assisted review. Withdrawing stops queued and running reviews; material already sent to a provider cannot be recalled." : "Allow this if you’d like us to prepare an AI-assisted review. You can also discuss the project with us in the conversation."}</p><button className="button outline" disabled={busy} onClick={() => void save(`/v1/projects/${project.id}/ai-review-consent`, { version: project.version, policy: "ai-review-v1", consent: !project.aiReviewConsentAt }, project.aiReviewConsentAt ? "AI review permission withdrawn." : "AI review permission saved.")}>{project.aiReviewConsentAt ? "Withdraw permission" : "Allow AI-assisted review"}</button></details>;
}
