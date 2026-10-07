"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  api,
  type Account,
  type Auth,
  WorkspaceError,
} from "./workspace-types";
import { clearAccountDrafts } from "./workspace-drafts";
import { WorkshopBackdrop } from "./workshop-backdrop";

export function useCustomerAccount() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let ignore = false;
    api<Auth>("/v1/auth/session")
      .then((value) => {
        if (!ignore) {
          setAuth(value);
          setError(null);
        }
      })
      .catch(() => {
        if (!ignore)
          setError("We couldn’t load your account. Please try again.");
      })
      .finally(() => {
        if (!ignore) setLoaded(true);
      });
    return () => {
      ignore = true;
    };
  }, [revision]);
  const expire = useCallback(() => {
    setAuth((current) => (current ? { ...current, account: null } : null));
    setError("Your session expired. Sign in again to continue.");
  }, []);
  const fail = useCallback(
    (reason: unknown) => {
      if (reason instanceof WorkspaceError && reason.status === 401) expire();
    },
    [expire],
  );
  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await api("/v1/auth/logout", {});
      if (auth?.account) clearAccountDrafts(auth.account.id);
      setAuth((current) => (current ? { ...current, account: null } : null));
    } catch {
      setError("Sign out wasn’t completed. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return {
    auth,
    loaded,
    error,
    busy,
    logout,
    fail,
    retry: () => {
      setLoaded(false);
      setRevision((value) => value + 1);
    },
  };
}
export function CustomerPage({
  current,
  account,
  busy,
  logout,
  children,
  error,
}: {
  current: "account" | "billing";
  account: Account | null;
  busy: boolean;
  logout: () => void;
  children: ReactNode;
  error?: string | null;
}) {
  return (
    <div className="workshop-shell portal-shell">
      <WorkshopBackdrop />
      <a className="skip-link" href="#customer-main">
        Skip to {current}
      </a>
      <header className="portal-header">
        <a
          className="wordmark"
          href="/dashboard"
          aria-label="m8itwork dashboard"
        >
          <span className="logo-mark">m8</span>itwork
          <span className="logo-dot">.</span>
        </a>
        <span className="portal-header-label">CUSTOMER DASHBOARD</span>
        <nav aria-label="Customer navigation">
          <a className="portal-account-link" href="/dashboard">
            Dashboard
          </a>
          {account ? (
            <>
              <a
                className="portal-account-link"
                href="/billing"
                aria-current={current === "billing" ? "page" : undefined}
              >
                Billing
              </a>
              <a
                className="portal-account-link"
                href="/account"
                aria-current={current === "account" ? "page" : undefined}
              >
                Account
              </a>
              <span className="portal-user">
                {account.displayName || account.githubLogin || "Your account"}
              </span>
              <button className="portal-plain" onClick={logout} disabled={busy}>
                {busy ? "Signing out…" : "Sign out"}
              </button>
            </>
          ) : (
            <a className="portal-account-link" href="/login">
              Sign in
            </a>
          )}
        </nav>
      </header>
      <main id="customer-main" className="customer-page">
        {account && error && (
          <p className="portal-error" role="alert">
            {error}
          </p>
        )}
        {children}
      </main>
      <footer className="customer-footer">
        <span>m8itwork · Built with AI. Taken further.</span>
        <a href="mailto:hello@m8itwork.com">Contact support</a>
        <a href="/privacy">Privacy & access</a>
      </footer>
    </div>
  );
}
export function AccountGate({
  loaded,
  account,
  error,
  retry,
  current = "account",
}: {
  loaded: boolean;
  account: Account | null;
  error: string | null;
  retry: () => void;
  current?: "account" | "billing";
}) {
  if (!loaded)
    return (
      <section className="portal-card" role="status">
        Opening your account…
      </section>
    );
  if (error && !account)
    return (
      <section className="portal-card">
        <h1>
          {error.startsWith("Your session")
            ? "Sign in to continue"
            : "We couldn’t open your account"}
        </h1>
        <p role="alert">{error}</p>
        {error.startsWith("Your session") ? (
          <a className="button" href={`/login?return=${current}`}>
            Sign in
          </a>
        ) : (
          <button className="button" onClick={retry}>
            Try again
          </button>
        )}
      </section>
    );
  return (
    <section className="portal-card">
      <h1>Welcome back</h1>
      <p>Sign in to manage your account and billing.</p>
      <a className="button" href={`/login?return=${current}`}>
        Sign in to your account
      </a>
    </section>
  );
}
