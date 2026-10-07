"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, type Account } from "./workspace-types";
function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
function readContact() {
  return (
    new URLSearchParams(window.location.hash.slice(1)).get("contact") ?? ""
  );
}
interface Preferences {
  enabled: boolean;
  email: string | null;
  verified: boolean;
  projectUpdates: boolean;
  operatorAlerts?: boolean | null;
}
export function NotificationSettings({
  account,
  onExpired,
}: {
  account: Account;
  onExpired: (reason: unknown) => void;
}) {
  const [prefs, setPrefs] = useState<Preferences | null>(null),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  async function load() {
    setPrefs(await api<Preferences>("/v1/auth/notifications"));
  }
  useEffect(() => {
    let ignore = false;
    void api<Preferences>("/v1/auth/notifications")
      .then((value) => {
        if (!ignore) setPrefs(value);
      })
      .catch((reason) => {
        if (!ignore) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Email preferences could not be loaded.",
          );
          onExpired(reason);
        }
      });
    return () => {
      ignore = true;
    };
  }, [account.id, onExpired]);
  async function save(path: string, body: unknown, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(path, body);
      setNotice(message);
      await load();
      return true;
    } catch (reason) {
      onExpired(reason);
      setError(reason instanceof Error ? reason.message : "Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function preference(
    key: "projectUpdates" | "operatorAlerts",
    checked: boolean,
    message: string,
  ) {
    if (!prefs || busy) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: checked });
    if (!(await save("/v1/auth/notifications", { [key]: checked }, message)))
      setPrefs(previous);
  }
  const token = useSyncExternalStore(subscribe, readContact, () => "");
  return (
    <section id="notifications" className="portal-card account-section">
      <p className="portal-kicker">PROJECT UPDATES</p>
      <h2>Email notifications</h2>
      <p>
        Receive request acknowledgments, team replies, proposals, payment
        updates and handovers. Emails link to your dashboard; private project
        details stay here.
      </p>
      {error && (
        <p className="portal-error" role="alert">
          {error}
          <button
            className="portal-plain"
            onClick={() =>
              void load()
                .then(() => setError(null))
                .catch((reason) => setError(String(reason)))
            }
          >
            Retry preferences
          </button>
        </p>
      )}
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      {token && (
        <form
          className="portal-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await save(
                "/v1/auth/notifications/verify",
                { token },
                "Notification email verified.",
              )
            ) {
              window.history.replaceState(null, "", window.location.pathname);
              window.dispatchEvent(new Event("hashchange"));
            }
          }}
        >
          <p>
            Confirm this notification email for the account signed in here. It
            does not change sign-in or password recovery.
          </p>
          <button className="button" disabled={busy}>
            Verify notification email
          </button>
        </form>
      )}
      {prefs ? (
        <>
          {!prefs.enabled && (
            <p className="portal-notice">
              Email delivery is unavailable. Your preference is saved, but
              updates stay in your dashboard until delivery resumes.
            </p>
          )}
          <p>
            {prefs.verified
              ? `Verified destination: ${prefs.email}`
              : "Add a verified email to get project updates. You can continue using the dashboard without email."}
          </p>
          <label className="portal-check">
            <input
              type="checkbox"
              checked={prefs.projectUpdates}
              disabled={busy}
              onChange={(event) =>
                void preference(
                  "projectUpdates",
                  event.target.checked,
                  event.target.checked
                    ? "Project emails enabled."
                    : "Project emails paused. Security and requested account emails still apply.",
                )
              }
            />
            <span>Email me project updates</span>
          </label>
          {prefs.operatorAlerts != null && (
            <label className="portal-check">
              <input
                type="checkbox"
                checked={prefs.operatorAlerts}
                disabled={busy}
                onChange={(event) =>
                  void preference(
                    "operatorAlerts",
                    event.target.checked,
                    event.target.checked
                      ? "Backoffice alerts enabled."
                      : "Backoffice emails paused. Check Operations for outstanding issues.",
                  )
                }
              />
              <span>Email me customer requests and operational alerts</span>
            </label>
          )}
          {prefs.enabled && (
            <form
              className="portal-form"
              onSubmit={async (event) => {
                event.preventDefault();
                await save(
                  "/v1/auth/notifications/contact",
                  { email: new FormData(event.currentTarget).get("email") },
                  "Check that inbox for a verification link. Sign in to this same account to confirm it.",
                );
              }}
            >
              <label>
                Notification email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  required
                  maxLength={254}
                  defaultValue={prefs.email ?? ""}
                />
              </label>
              <button className="button outline" disabled={busy}>
                {busy ? "Saving…" : "Verify a notification email"}
              </button>
            </form>
          )}
          <p className="portal-muted">
            This address is separate from your sign-in identity. Signing out
            does not stop project emails. Close the account or turn off updates
            to stop them.
          </p>
        </>
      ) : (
        !error && <p role="status">Loading preferences…</p>
      )}
    </section>
  );
}
