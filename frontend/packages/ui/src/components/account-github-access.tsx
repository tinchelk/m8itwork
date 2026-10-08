"use client";
import { useEffect, useState } from "react";
import { api, type Connection } from "./workspace-types";

export function AccountGitHubAccess({ accountId, onExpired }: {
  accountId: string;
  onExpired: (reason: unknown) => void;
}) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let ignore = false;
    void api<Connection>("/v1/session").then(result => {
      if (!ignore) setConnection(result);
    }).catch(reason => {
      if (!ignore) {
        setError(reason instanceof Error ? reason.message : "Repository connection could not be loaded.");
        onExpired(reason);
      }
    });
    return () => { ignore = true; };
  }, [accountId, onExpired]);
  async function refresh() {
    setBusy(true);
    try {
      setConnection(await api<Connection>("/v1/session"));
      setError(null);
      setNotice(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Repository connection could not be checked.");
      onExpired(reason);
    } finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api("/v1/github/disconnect", {});
      setConnection(current => current ? { ...current, githubLogin: null, repositories: [], connectionError: null } : current);
      setNotice("GitHub repository access disconnected in this browser. Your sign-in and project history are retained.");
    } catch (reason) {
      setError("The disconnect result could not be confirmed. Refresh repository status to check current access.");
      onExpired(reason);
    } finally { setBusy(false); }
  }
  return (
    <details className="repository-refresh">
      <summary>GitHub connection settings</summary>
      <p className="portal-muted">Repository access is separate from GitHub sign-in. Disconnecting here removes repository access in this browser; other browser sessions keep their access.</p>
      {!connection && !error && <p role="status">Checking repository connection…</p>}
      {error && <p className="portal-error" role="alert">{error}</p>}
      {notice && <p className="portal-notice" role="status">{notice}</p>}
      {connection?.connectionError && <p className="portal-error" role="alert">{connection.connectionError}</p>}
      {connection?.githubLogin ? (
        <>
          <p>{connection.connectionError ? "Saved GitHub authorization" : "Connected"} as @{connection.githubLogin}.</p>
          <button className="portal-plain" onClick={disconnect} disabled={busy}>{busy ? "Working…" : "Disconnect GitHub"}</button>
        </>
      ) : connection ? <p>Repository access is not connected in this browser.</p> : null}
      <div className="portal-connection-actions">
        <button className="portal-plain" onClick={refresh} disabled={busy}>Refresh repository status</button>
        <a href="/dashboard?start=1">Connect a repository</a>
      </div>
    </details>
  );
}
