"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { API, api, type Auth } from "./workspace-types";
import { WorkshopBackdrop } from "./workshop-backdrop";
import {
  notificationReturnFragment,
  rememberCustomerReturn,
  requestedCustomerReturn,
} from "./customer-return";

export type AuthMode = "login" | "signup" | "forgot" | "verify" | "reset";
const titles: Record<AuthMode, string> = {
  login: "Welcome back.",
  signup: "Start your next chapter.",
  forgot: "Get back into your account.",
  verify: "Confirm your email.",
  reset: "Choose a new password.",
};
function subscribeHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
function readToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
}

export function CustomerAuthPanel({
  initialMode = "login",
  config,
  primaryHeading = false,
}: {
  initialMode?: AuthMode;
  config?: Auth | null;
  primaryHeading?: boolean;
}) {
  const mode = initialMode;
  const [fetchedOptions, setOptions] = useState<Auth | null>(null);
  const options = config === undefined ? fetchedOptions : config;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [consent, setConsent] = useState(false);
  const query = useSyncExternalStore(
    subscribeHash,
    () => window.location.search,
    () => "",
  );
  const contact = useSyncExternalStore(
    subscribeHash,
    notificationReturnFragment,
    () => "",
  );
  const authLink = (path: string) => {
    const params = new URLSearchParams(query),
      kept = new URLSearchParams();
    for (const key of ["return", "project", "payment"]) {
      const value = params.get(key);
      if (value && (key !== "return" || ["account", "billing"].includes(value)))
        kept.set(key, value);
    }
    return (
      path +
      (kept.size ? `?${kept}` : "") +
      (kept.get("return") === "account" ? contact : "")
    );
  };
  const token = useSyncExternalStore(subscribeHash, readToken, () => null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState(false);
  const [verified, setVerified] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message || error)
      feedback.current?.scrollIntoView({ block: "nearest" });
  }, [message, error]);
  useEffect(() => {
    if (config !== undefined) return;
    let ignore = false;
    api<Auth>("/v1/auth/session")
      .then((result) => {
        if (!ignore) setOptions(result);
      })
      .catch(() => {
        if (!ignore) setConfigError(true);
      });
    return () => {
      ignore = true;
    };
  }, [config]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if ((mode === "verify" || mode === "reset") && !token) {
      setError("Open the link from your email, or request another link.");
      return;
    }
    if (mode === "reset" && password !== confirm) {
      setError("The passwords don’t match.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await api("/v1/auth/login", { email, password });
        setPassword("");
        window.location.assign(requestedCustomerReturn() || "/dashboard");
      } else if (mode === "signup") {
        const result = await api<{ message: string }>("/v1/auth/register", {
          email,
          password,
          displayName: name,
          consent,
        });
        setPassword("");
        setMessage(result.message);
      } else if (mode === "forgot") {
        const result = await api<{ message: string }>(
          "/v1/auth/password-reset/request",
          { email },
        );
        setMessage(result.message);
      } else if (mode === "verify") {
        await api("/v1/auth/email-verification/confirm", { token });
        window.history.replaceState(null, "", window.location.pathname);
        setVerified(true);
        setMessage("Email verified. You can now sign in.");
      } else {
        await api("/v1/auth/password-reset/confirm", { token, password });
        window.history.replaceState(null, "", window.location.pathname);
        setVerified(true);
        setPassword("");
        setConfirm("");
        setMessage("Password updated. Sign in with your new password.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ message: string }>(
        "/v1/auth/email-verification/request",
        { email, password },
      );
      setMessage(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const tokenMode = mode === "verify" || mode === "reset";
  const waitingForOptions = !tokenMode && !options;
  const emailDisabled =
    mode !== "login" && !tokenMode && !options?.emailEnabled;
  if (options?.account && !tokenMode)
    return (
      <section className="portal-card portal-signin">
        {primaryHeading ? <h1>You’re signed in.</h1> : <h2>You’re signed in.</h2>}
        <p>Your projects and account are ready.</p>
        <a className="button" href={requestedCustomerReturn() || "/dashboard"}>
          {new URLSearchParams(query).get("return") === "account"
            ? "Open your account"
            : new URLSearchParams(query).get("return") === "billing"
              ? "Open billing"
              : "Open your dashboard"} <span aria-hidden="true">↗</span>
        </a>
      </section>
    );
  return (
    <section
      className="portal-card portal-signin customer-auth"
      aria-labelledby="auth-title"
    >
      <p className="portal-kicker">YOUR M8ITWORK ACCOUNT</p>
      {primaryHeading ? (
        <h1 id="auth-title">{titles[mode]}</h1>
      ) : (
        <h2 id="auth-title">{titles[mode]}</h2>
      )}
      <p>
        {mode === "signup"
          ? "Create your account, then connect GitHub and tell us what you want next."
          : mode === "login"
            ? "Sign in with email, Google, or GitHub. Connect a repository when starting a project."
            : mode === "forgot"
              ? "We’ll email you a link to choose a new password."
              : mode === "verify"
                ? "Use the confirmation link from your account email."
                : "Use at least 12 characters. Your other sessions will be signed out."}
      </p>
      <div ref={feedback}>
        {message && (
          <p className="portal-notice" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="portal-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {configError && (
        <p className="portal-error" role="alert">
          We couldn’t load sign-in options.{" "}
          <button
            type="button"
            className="portal-plain"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </p>
      )}
      {!tokenMode && mode !== "forgot" && !(mode === "signup" && message) && (
        <>
          <div className="auth-providers">
          {options?.googleEnabled && (
            <a
              className="button auth-social"
              onClick={rememberCustomerReturn}
              href={`${API}/v1/auth/google/connect?flow=login`}
            >
              Continue with Google <span aria-hidden="true">↗</span>
            </a>
          )}
          {options?.connectEnabled && (
            <a
              className="button auth-social"
              onClick={rememberCustomerReturn}
              href={`${API}/v1/github/connect?flow=login`}
            >
              Continue with GitHub <span aria-hidden="true">↗</span>
            </a>
          )}
          </div>
          {(options?.googleEnabled || options?.connectEnabled) && <div className="auth-divider">
            <span>or use email</span>
          </div>}
        </>
      )}
      {!verified && !(mode === "signup" && message) && (
        <form onSubmit={submit} className="auth-form">
          {mode === "signup" && (
            <label>
              Your name
              <input
                name="name"
                autoComplete="name"
                maxLength={100}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy || waitingForOptions}
              />
            </label>
          )}
          {!tokenMode && (
            <label>
              Email address
              <input
                name="email"
                type="email"
                inputMode="email"
                spellCheck={false}
                autoComplete="email"
                maxLength={254}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy || waitingForOptions}
              />
            </label>
          )}
          {(mode === "signup" || mode === "login" || mode === "reset") && (
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={mode === "login" ? 1 : 12}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy || waitingForOptions}
              />
            </label>
          )}
          {(mode === "signup" || mode === "reset") && (
            <p className="auth-hint">
              At least 12 characters. A few memorable words work well.
            </p>
          )}
          {mode === "reset" && (
            <label>
              Confirm password
              <input
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                disabled={busy || waitingForOptions}
              />
            </label>
          )}
          {mode === "signup" && (
            <label className="auth-consent">
              <input
                type="checkbox"
                checked={consent}
                required
                onChange={(event) => setConsent(event.target.checked)}
                disabled={busy || waitingForOptions}
              />
              <span>
                I’ve read the{" "}
                <a href="/privacy" target="_blank" rel="noopener noreferrer">
                  privacy & access terms
                </a>
                . Creating an account does not grant repository access.
              </span>
            </label>
          )}
          {tokenMode && token !== null && !token && (
            <p className="portal-error" role="alert">
              Open the link from your email. If it expired, request another
              below.
            </p>
          )}
          {emailDisabled && options && (
            <p className="portal-muted">
              Email verification is being set up. Please try again later.
            </p>
          )}
          <button
            className="button"
            type="submit"
            disabled={
              busy ||
              waitingForOptions ||
              emailDisabled ||
              (tokenMode && !token)
            }
          >
            {busy
              ? "Working…"
              : mode === "signup"
                ? "Create account"
                : mode === "login"
                  ? "Sign in"
                  : mode === "forgot"
                    ? "Send reset link"
                    : mode === "verify"
                      ? "Verify email"
                      : "Update password"}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
      )}
      <div className="auth-links">
        {mode === "login" && (
          <>
            <a href={authLink("/signup")}>Create an account</a>
            <a href={authLink("/forgot-password")}>Forgot password?</a>
          </>
        )}
        {mode !== "login" && <a href={authLink("/login")}>Back to sign in</a>}
        {mode === "reset" && !verified && (
          <a href={authLink("/forgot-password")}>Request a new reset link</a>
        )}
        {mode === "verify" && !verified && (
          <a href={authLink("/login")}>
            Sign in & request another verification email
          </a>
        )}
      </div>
      {mode === "login" && email && options?.emailEnabled && (
        <>
          <button
            type="button"
            className="portal-plain auth-resend"
            onClick={resend}
            disabled={busy || !password}
          >
            Resend verification email
          </button>
          <p className="auth-hint">
            Enter the password from your signup to resend verification, or use
            Forgot password.
          </p>
        </>
      )}
      <p className="portal-muted">
        Starting a project is free. Paid work is scoped and agreed with you
        first.
      </p>
    </section>
  );
}

export function CustomerAuthPage({ mode }: { mode: AuthMode }) {
  return (
    <div className="workshop-shell portal-shell">
      <WorkshopBackdrop />
      <a className="skip-link" href="#auth-main">
        Skip to account
      </a>
      <header className="portal-header">
        <a className="wordmark" href="/dashboard">
          m8itwork<span className="logo-dot">.</span>
        </a>
        <span className="portal-header-label">CUSTOMER ACCOUNT</span>
        <nav aria-label="Account navigation">
          <a className="portal-account-link" href="/dashboard">
            Your dashboard
          </a>
        </nav>
      </header>
      <main id="auth-main" className="auth-page">
        <CustomerAuthPanel initialMode={mode} primaryHeading />
      </main>
    </div>
  );
}
