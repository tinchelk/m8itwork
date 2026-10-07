"use client";
import { useEffect, useRef, useState } from "react";
import { API, api, WorkspaceError } from "./workspace-types";
export interface WorkerLoginState { id: string; status: string; expiresAt: string; url?: string; code?: string }
export interface LoginWorker { id: string; lastSeenAt: string | null; revokedAt: string | null; remoteLogin?: boolean; loginRequest?: WorkerLoginState | null; jobs?: { id: string }[] }
const active = (s: string) => ["QUEUED", "PREPARING", "WAITING"].includes(s);
export function WorkerLogin({ worker }: { worker: LoginWorker }) {
  const [local, setLocal] = useState<WorkerLoginState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [retry, setRetry] = useState(false), [accessLost, setAccessLost] = useState(0);
  const requestId = useRef<string | null>(null);
  const newest = local && (!worker.loginRequest || Date.parse(local.expiresAt) >= Date.parse(worker.loginRequest.expiresAt)) ? local : worker.loginRequest;
  const login = accessLost ? null : newest;
  const expired = Boolean(login && Date.parse(login.expiresAt) <= now && active(login.status));
  const running = Boolean(login && active(login.status) && !expired);
  const online = Boolean(!worker.revokedAt && worker.lastSeenAt && now - Date.parse(worker.lastSeenAt) < 60_000);
  useEffect(() => { const tick = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tick); }, []);
  useEffect(() => {
    if (!running) return;
    let ignore = false;

    const poll = setInterval(() => {
      void api<{ workers: (LoginWorker & { loginRequest: WorkerLoginState | null })[] }>("/v1/operator/review-workers").then(result => {
        const found = result.workers.find(w => w.id === worker.id);
        if (!ignore && found) { setLocal(found.revokedAt ? { id: login!.id, expiresAt: login!.expiresAt, status: "CANCELLED" } : found.loginRequest); setError(""); }
      }).catch(e => { if (!ignore) { setError((e as Error).message); if (e instanceof WorkspaceError && [401, 403].includes(e.status)) setAccessLost(e.status); } });
    }, 3000);
    return () => { ignore = true; clearInterval(poll); };
  }, [running, worker.id, login]);
  if (worker.revokedAt) return null;
  const waiting = Boolean(running && login?.status === "WAITING" && login.url === "https://auth.openai.com/codex/device" && /^[A-Z0-9]{4}-[A-Z0-9]{5}$/.test(login.code ?? ""));
  return <div className="worker-login">
    {running && <p role="status">{waiting ? "Finish Codex sign-in in your browser." : login?.status === "QUEUED" ? "Reconnect requested. Waiting for the worker…" : "The worker is preparing the sign-in link…"}</p>}
    {waiting && <><p>Only continue if you requested this reconnect. Sign in with the subscription account this worker should use.</p><p>One-time code: <strong className="worker-login-code">{login!.code}</strong></p><a className="button" href="https://auth.openai.com/codex/device" target="_blank" rel="noopener noreferrer">Open Codex sign-in ↗</a><p className="portal-muted">Link opens in a new tab. This request expires in {Math.max(1, Math.ceil((Date.parse(login!.expiresAt) - now) / 60_000))} minute(s). Keep backoffice open to confirm completion.</p></>}
    {running && !online && <p className="portal-notice">Worker offline. Start it on its host; this request will expire if it cannot reconnect.</p>}
    {running ? <button type="button" className="portal-plain" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/v1/operator/review-workers/${worker.id}/login/cancel`, { requestId: login!.id }); setLocal({ ...login!, status: "CANCELLED", url: undefined, code: undefined }); requestId.current = null; setRetry(false); setError(""); } catch (e) { if (e instanceof WorkspaceError && [401, 403].includes(e.status)) setAccessLost(e.status); setError((e as Error).message); } finally { setBusy(false); } }}>Cancel reconnect</button> : <>
      {login && <p role="status">{expired || login.status === "EXPIRED" ? "Sign-in expired. Request a fresh link below." : login.status === "SUCCEEDED" ? "Codex sign-in completed. Subscription verified." : login.status === "CANCELLED" ? "Reconnect cancelled." : login.status === "FAILED" ? "Sign-in did not complete. Check that device-code login is enabled in ChatGPT Settings → Security, then retry. You can also use the host login command." : ""}</p>}
      <button type="button" className="button outline" disabled={busy || Boolean(accessLost) || !online || !worker.remoteLogin || Boolean(worker.jobs?.length)} onClick={async () => { setBusy(true); setError(""); requestId.current ??= crypto.randomUUID(); try { const result = await api<{ login: WorkerLoginState }>(`/v1/operator/review-workers/${worker.id}/login`, { requestId: requestId.current }); setLocal(result.login); setNow(Date.now()); requestId.current = null; setRetry(false); } catch (e) { setRetry(true); if (e instanceof WorkspaceError && [401, 403].includes(e.status)) setAccessLost(e.status); setError((e as Error).message); } finally { setBusy(false); } }}>{busy ? "Requesting…" : retry ? "Retry reconnect request" : "Reconnect Codex"}</button>
      {!worker.remoteLogin && <p className="portal-muted">Update and start the Docker worker to enable browser reconnect.</p>}
      {worker.remoteLogin && !online && <p className="portal-muted">Start the worker on its host before reconnecting here.</p>}
      {Boolean(worker.jobs?.length) && <p className="portal-muted">Reconnect is available after the current review finishes.</p>}
    </>}
    {accessLost === 401 && <p>Your backoffice session needs sign-in. <a href={`${API}/v1/github/connect?flow=admin`}>Sign in to backoffice ↗</a> to resume the current reconnect request.</p>}
    {accessLost === 403 && <p>Backoffice access is no longer available for this account.</p>}
    {error && <p role="alert" className="portal-error">{error}</p>}
  </div>;
}
