"use client";
import { useEffect, useState } from "react";
import { API, api, type Auth } from "./workspace-types";
import { WorkshopBackdrop } from "./workshop-backdrop";
export function AccountSettings() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let ignore = false; api<Auth>("/v1/auth/session").then(result => { if (!ignore) {
      setAuth(result);
      const resultCode = new URLSearchParams(window.location.search).get("google");
      if (resultCode === "connected") setNotice("Google is connected. Your projects stay in this account.");
      if (resultCode === "link-mismatch") setError("Choose the same Google email as your m8itwork account, then try Connect Google again.");
      if (resultCode === "link-unavailable") setError("That Google identity or email is connected to another m8itwork account. Use your existing connected identity, or sign in to the account that owns it.");
      if (resultCode === "error") setError("Google connection wasn’t completed. Please try Connect Google again.");
      if (resultCode === "verify-email") setError("This Google identity cannot add an email to your existing account. Choose a Gmail or Google Workspace identity, or contact hello@m8itwork.com for help keeping your projects together.");
      if (resultCode === "recovery-conflict") setError("Your Google email changed and couldn’t be added to this account. Your projects stay here; recovery to the old email is disabled. Contact hello@m8itwork.com for help.");
    } }).catch(() => { if (!ignore) setError("We couldn’t load your account. Please reload and try again."); }).finally(() => { if (!ignore) setLoaded(true); }); return () => { ignore = true; }; }, []);
  async function password() {
    setBusy(true); setNotice(null); setError(null);
    try { const result = await api<{ message: string }>("/v1/auth/password-reset/request", { email: auth?.account?.email }); setNotice(result.message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="workshop-shell portal-shell"><WorkshopBackdrop /><header className="portal-header"><a className="wordmark" href="/">m8itwork<span className="logo-dot">.</span></a><span className="portal-header-label">YOUR ACCOUNT</span><nav aria-label="Account navigation"><a className="portal-account-link" href="/dashboard">Your dashboard</a></nav></header><main className="auth-page"><section className="portal-card customer-auth"><h1>Account settings</h1>{error && <p className="portal-error" role="alert">{error}</p>}{notice && <p className="portal-notice" role="status">{notice}</p>}{!loaded ? <p>Opening your account…</p> : !auth?.account ? <p><a className="button" href="/login">Sign in to your account</a></p> : <>
    <h2>{auth.account.displayName || auth.account.githubLogin || "Your account"}</h2><p>{auth.account.email || "No account email connected yet."}</p><p>GitHub identity: {auth.account.githubLogin ? `@${auth.account.githubLogin}` : "Not connected"}. Repository access is managed separately inside your project.</p>
    <h2>Sign-in methods</h2>{auth.account.googleConnected ? <p>Google is connected. You can use it to sign in.</p> : auth.googleEnabled ? <><p>Connect Google while signed in to keep your existing projects. Use the same email as this account.</p><a className="button auth-social" href={`${API}/v1/auth/google/connect?flow=link`}>Connect Google <span aria-hidden="true">↗</span></a></> : <p>Google sign-in is being set up.</p>}
    {auth.account.email && auth.emailEnabled ? <><p>Use an email link to set or change your password. Completing a reset signs out your other sessions.</p><button className="button" disabled={busy} onClick={password}>{busy ? "Working…" : "Send password reset email"}</button></> : !auth.account.email ? auth.account.googleConnected ? <p>Email password recovery is disabled. Continue signing in with your connected Google account. To add a recovery email while keeping your projects, contact <a href="mailto:hello@m8itwork.com">hello@m8itwork.com</a>.</p> : <p>Connect a Gmail or Google Workspace identity to add a verified email and enable password recovery. For another email provider, contact <a href="mailto:hello@m8itwork.com">hello@m8itwork.com</a> for help keeping your projects together.</p> : null}
  </>}</section></main></div>;
}
