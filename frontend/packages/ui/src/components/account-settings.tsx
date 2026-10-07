"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { API, api } from "./workspace-types";
import { AccountGate, CustomerPage, useCustomerAccount } from "./customer-page";
import { AccountCards } from "./account-cards";
import { NotificationSettings } from "./notification-settings";
import {
  AccountClose,
  clearClosedAccountDrafts,
  useClosureRecovery,
} from "./account-close";

export function AccountSettings() {
  const customer = useCustomerAccount();
  const clearCustomer = customer.clear;
  const [closed, setClosed] = useState(false);
  const onClosed = useCallback(
    (id: string) => {
      clearClosedAccountDrafts(id);
      setClosed(true);
      clearCustomer();
    },
    [clearCustomer],
  );
  const recovery = useClosureRecovery(
    customer.auth?.account?.id ?? null,
    customer.loaded,
    closed,
    onClosed,
  );
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{
    error: boolean;
    message: string;
  } | null>(null);
  const passwordFeedbackRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (passwordFeedback)
      passwordFeedbackRef.current?.scrollIntoView({ block: "nearest" });
  }, [passwordFeedback]);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("google");
    Promise.resolve().then(() => {
      if (code === "connected")
        setNotice("Google is connected. Your projects stay in this account.");
      if (code === "link-mismatch")
        setError(
          "Choose the same Google email as your m8itwork account, then try Connect Google again.",
        );
      if (code === "link-unavailable")
        setError(
          "That Google identity or email is connected to another m8itwork account. Use your existing connected identity, or sign in to the account that owns it.",
        );
      if (code === "error")
        setError(
          "Google connection wasn’t completed. Please try Connect Google again.",
        );
      if (code === "verify-email")
        setError(
          "This Google identity cannot add an email to your existing account. Choose a Gmail or Google Workspace identity, or contact hello@m8itwork.com for help keeping your projects together.",
        );
      if (code === "recovery-conflict")
        setError(
          "Your Google email changed and couldn’t be added to this account. Your projects stay here; recovery to the old email is disabled. Contact hello@m8itwork.com for help.",
        );
    });
  }, []);
  async function password() {
    setBusy(true);
    setPasswordFeedback(null);
    try {
      const result = await api<{ message: string }>(
        "/v1/auth/password-reset/request",
        { email: customer.auth?.account?.email },
      );
      setPasswordFeedback({ error: false, message: result.message });
    } catch (reason) {
      customer.fail(reason);
      setPasswordFeedback({
        error: true,
        message: reason instanceof Error ? reason.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }
  const account = customer.auth?.account ?? null;
  return (
    <CustomerPage
      current="account"
      account={account}
      busy={customer.busy}
      logout={customer.logout}
      error={customer.error}
    >
      {closed ? (
        <section className="portal-card account-closed" role="status">
          <p className="portal-kicker">ACCOUNT CLOSED</p>
          <h1>Your account is closed.</h1>
          <p>
            You’re signed out on every device. Repository access is disconnected
            and unagreed requests are withdrawn.
          </p>
          <p>
            Project and billing records stay with our team. For help with those
            records or returning to m8itwork, contact{" "}
            <a href="mailto:hello@m8itwork.com">hello@m8itwork.com</a>.
          </p>
          <a className="button outline" href="/">
            Back to m8itwork <span aria-hidden="true">↗</span>
          </a>
        </section>
      ) : !account && (recovery.checking || recovery.error) ? (
        <section className="portal-card">
          <h1>Check account closure</h1>
          {recovery.checking ? (
            <p role="status">Checking your earlier request…</p>
          ) : (
            <>
              <p className="portal-error" role="alert">
                {recovery.error}
              </p>
              <div className="billing-actions">
                <button className="button outline" onClick={recovery.retry}>
                  Check closure result
                </button>
                <a className="button outline" href="/login?return=account">
                  Sign in
                </a>
              </div>
            </>
          )}
        </section>
      ) : !customer.loaded || !account ? (
        <AccountGate
          loaded={customer.loaded}
          account={account}
          error={customer.error}
          retry={customer.retry}
        />
      ) : (
        <>
          <div className="customer-page-heading">
            <div>
              <p className="portal-kicker">YOUR ACCOUNT</p>
              <h1>Account settings</h1>
              <p>Your details, saved cards and sign-in preferences.</p>
            </div>
            <a className="button outline" href="/billing">
              View billing <span aria-hidden="true">↗</span>
            </a>
          </div>
          {error && (
            <p className="portal-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="portal-notice" role="status">
              {notice}
            </p>
          )}
          <div className="customer-settings-layout">
            <aside className="account-sidebar" aria-label="Account sections">
              <a href="#account-details">Account details</a>
              <a href="#payment-methods">Payment methods</a>
              <a href="#sign-in-methods">Sign-in & security</a>
              <a href="#notifications">Email notifications</a>
              <a href="#close-account">Close account</a>
              <div className="account-support">
                <p>Need a hand?</p>
                <a href="mailto:hello@m8itwork.com">hello@m8itwork.com</a>
              </div>
            </aside>
            <div className="account-sections">
              <section
                id="account-details"
                className="portal-card account-section"
              >
                <p className="portal-kicker">ACCOUNT DETAILS</p>
                <h2>
                  {account.displayName || account.githubLogin || "Your account"}
                </h2>
                <dl className="account-details">
                  <div>
                    <dt>Email address</dt>
                    <dd>
                      {account.email || "No account email connected yet."}
                    </dd>
                  </div>
                  <div>
                    <dt>GitHub sign-in</dt>
                    <dd>
                      {account.githubLogin
                        ? `@${account.githubLogin}`
                        : "Not connected"}
                    </dd>
                  </div>
                </dl>
                <p className="billing-small">
                  Repository access is managed separately inside your projects.
                </p>
              </section>
              <AccountCards
                key={account.id}
                accountId={account.id}
                onExpired={customer.fail}
              />
              <NotificationSettings
                key={`notifications:${account.id}`}
                account={account}
                onExpired={customer.fail}
              />
              <section
                id="sign-in-methods"
                className="portal-card account-section"
              >
                <p className="portal-kicker">SIGN-IN & SECURITY</p>
                <h2>Sign-in methods</h2>
                <div className="account-method">
                  <div>
                    <h3>Google</h3>
                    <p>
                      {account.googleConnected
                        ? "Google is connected. You can use it to sign in."
                        : customer.auth?.googleEnabled
                          ? "Connect Google while signed in to keep your existing projects. Use the same email as this account."
                          : "Google sign-in is currently unavailable."}
                    </p>
                  </div>
                  {!account.googleConnected && customer.auth?.googleEnabled && (
                    <a
                      className="button outline"
                      href={`${API}/v1/auth/google/connect?flow=link`}
                    >
                      Connect Google <span aria-hidden="true">↗</span>
                    </a>
                  )}
                  {account.googleConnected && (
                    <span className="billing-status paid">Connected</span>
                  )}
                </div>
                <div className="account-method">
                  <div>
                    <h3>Password & recovery</h3>
                    {account.email && customer.auth?.emailEnabled ? (
                      <p>
                        Use an email link to set or change your password.
                        Completing a reset signs out your other sessions.
                      </p>
                    ) : !account.email ? (
                      account.googleConnected ? (
                        <p>
                          Email password recovery is disabled. Continue signing
                          in with your connected Google account. To add a
                          recovery email while keeping your projects, contact{" "}
                          <a href="mailto:hello@m8itwork.com">
                            hello@m8itwork.com
                          </a>
                          .
                        </p>
                      ) : (
                        <p>
                          Connect a Gmail or Google Workspace identity to add a
                          verified email and enable password recovery. For
                          another email provider, contact{" "}
                          <a href="mailto:hello@m8itwork.com">
                            hello@m8itwork.com
                          </a>{" "}
                          for help keeping your projects together.
                        </p>
                      )
                    ) : (
                      <p>
                        Contact{" "}
                        <a href="mailto:hello@m8itwork.com">
                          hello@m8itwork.com
                        </a>{" "}
                        for help with password recovery.
                      </p>
                    )}
                    {passwordFeedback && (
                      <p
                        ref={passwordFeedbackRef}
                        className={
                          passwordFeedback.error
                            ? "portal-error"
                            : "portal-notice"
                        }
                        role={passwordFeedback.error ? "alert" : "status"}
                      >
                        {passwordFeedback.message}
                      </p>
                    )}
                  </div>
                  {account.email && customer.auth?.emailEnabled && (
                    <button
                      className="button outline"
                      disabled={busy}
                      onClick={password}
                    >
                      {busy ? "Sending…" : "Send password reset email"}
                    </button>
                  )}
                </div>
              </section>
              {(recovery.error || recovery.checking) && (
                <div className="portal-card">
                  {recovery.error ? (
                    <p className="portal-error" role="alert">
                      {recovery.error}
                    </p>
                  ) : (
                    <p role="status">Checking your earlier closure request…</p>
                  )}
                  <button
                    className="button outline"
                    onClick={recovery.retry}
                    disabled={recovery.checking}
                  >
                    {recovery.checking ? "Checking…" : "Check closure result"}
                  </button>
                </div>
              )}
              <AccountClose
                key={`close:${account.id}`}
                account={account}
                onClosed={onClosed}
                onExpired={customer.fail}
                onCheckLater={recovery.retry}
              />
            </div>
          </div>
        </>
      )}
    </CustomerPage>
  );
}
