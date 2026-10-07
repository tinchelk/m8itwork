"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Account, WorkspaceError } from "./workspace-types";
import { clearAccountDrafts } from "./workspace-drafts";

const key = "m8-account-close-receipt";
type Receipt = { accountId: string; requestId: string; expires: number };
function receipt() {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(key) || "null",
    ) as Receipt | null;
    if (value?.accountId && value.requestId && value.expires > Date.now())
      return value;
    sessionStorage.removeItem(key);
  } catch {
    /* Optional storage. */
  }
  return null;
}
function remember(value: Receipt) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* The mounted dialog retains its receipt. */
  }
}
function forget() {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Optional storage. */
  }
}
export function clearClosedAccountDrafts(accountId: string) {
  clearAccountDrafts(accountId);
  try {
    sessionStorage.removeItem(`m8-card-setup:${accountId}`);
    sessionStorage.removeItem("m8-customer-signin-return");
  } catch {}
}
export function useClosureRecovery(
  accountId: string | null,
  loaded: boolean,
  confirmed: boolean,
  onClosed: (id: string) => void,
) {
  const [checking, setChecking] = useState(false),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!loaded || confirmed) return;
    const saved = receipt();
    if (!saved || (accountId && accountId !== saved.accountId)) return;
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) {
        setChecking(true);
        setError(null);
      }
    });
    api<{ closed: boolean }>("/v1/auth/account/close/status", {
      accountId: saved.accountId,
      requestId: saved.requestId,
    })
      .then((result) => {
        if (ignore) return;
        if (result.closed) onClosed(saved.accountId);
        else
          setError(
            accountId
              ? "Your earlier closure isn’t confirmed. Check again, or open Close account to retry."
              : "Your earlier closure isn’t confirmed. Check again, or sign in to review your account.",
          );
      })
      .catch(() => {
        if (!ignore)
          setError(
            "We couldn’t check your earlier closure. Check again before starting another request.",
          );
      })
      .finally(() => {
        if (!ignore) setChecking(false);
      });
    return () => {
      ignore = true;
    };
  }, [accountId, loaded, confirmed, revision, onClosed]);
  return { checking, error, retry: () => setRevision((value) => value + 1) };
}
function CloseDialog({
  account,
  onClosed,
  onExpired,
  dismiss,
  onCheckLater,
}: {
  account: Account;
  onClosed: (id: string) => void;
  onExpired: (reason: unknown) => void;
  dismiss: () => void;
  onCheckLater: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const ticket = useRef<Receipt | null>(null);
  const [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    keep.current?.focus();
    return () => element?.close();
  }, []);
  async function check() {
    if (!ticket.current) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ closed: boolean }>(
        "/v1/auth/account/close/status",
        { accountId: account.id, requestId: ticket.current.requestId },
      );
      if (result.closed) onClosed(account.id);
      else {
        setUncertain(false);
        setError(
          "Closure isn’t confirmed. You can retry Close account, or keep your account open.",
        );
      }
    } catch {
      setError(
        "We couldn’t confirm closure. Check the result again; starting another request isn’t necessary.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (busy || confirmation !== "CLOSE") return;
    const saved = receipt();
    ticket.current ??=
      saved?.accountId === account.id
        ? saved
        : {
            accountId: account.id,
            requestId: crypto.randomUUID(),
            expires: Date.now() + 30 * 60_000,
          };
    remember(ticket.current);
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ closed: boolean; accountId: string }>(
        "/v1/auth/account/close",
        {
          accountId: account.id,
          requestId: ticket.current.requestId,
          confirmation,
        },
      );
      if (!result.closed || result.accountId !== account.id)
        throw new Error("Closure wasn’t confirmed.");
      onClosed(account.id);
    } catch (reason) {
      if (
        reason instanceof WorkspaceError &&
        [400, 401, 403, 409].includes(reason.status)
      ) {
        forget();
        ticket.current = null;
        onExpired(reason);
        setUncertain(false);
        setError(reason.message);
      } else {
        setUncertain(true);
        setError(
          "The connection was interrupted. Check the closure result before retrying. Leaving this dialog won’t cancel a submitted closure.",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="billing-dialog account-close-dialog"
      aria-labelledby="close-account-title"
      aria-describedby="close-account-description"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else {
          if (uncertain) onCheckLater();
          dismiss();
        }
      }}
    >
      <div className="account-close-header">
        <p className="portal-kicker">CLOSE ACCOUNT</p>
        <h2 id="close-account-title">Close your account?</h2>
        <p className="account-close-identity">
          {account.email ||
            account.displayName ||
            account.githubLogin ||
            "Your account"}
        </p>
      </div>
      <div id="close-account-description" className="account-close-body">
        <p>
          You’ll be signed out on every device. Repository access will be
          disconnected and unagreed requests withdrawn. You won’t be able to
          sign in again.
        </p>
        <p>
          Your GitHub repositories and saved Stripe cards remain. Remove cards
          in Payment methods first if needed. Payments aren’t refunded
          automatically.
        </p>
        <p>
          We retain project and billing records. Agreed work or unresolved
          payments need a team check first. For help with retained records,
          email <a href="mailto:hello@m8itwork.com">hello@m8itwork.com</a>.
        </p>
      </div>
      <form
        className="portal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (uncertain) void check();
          else void close();
        }}
      >
        <label htmlFor="close-account-confirmation">
          Type CLOSE to confirm
          <input
            name="confirmation"
            id="close-account-confirmation"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy || uncertain}
            aria-describedby="close-account-description"
          />
        </label>
        {error && (
          <p className="portal-error" role="alert">
            {error}
          </p>
        )}
        <div className="billing-actions">
          <button
            ref={keep}
            type="button"
            className="button outline"
            onClick={() => {
              if (uncertain) onCheckLater();
              dismiss();
            }}
            disabled={busy}
          >
            {uncertain ? "Check later" : "Keep account"}
          </button>
          <button
            type="submit"
            className="button account-close-button"
            disabled={busy || (!uncertain && confirmation !== "CLOSE")}
          >
            {busy
              ? "Checking…"
              : uncertain
                ? "Check closure result"
                : "Close account"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function AccountClose({
  account,
  onClosed,
  onExpired,
  onCheckLater,
}: {
  account: Account;
  onClosed: (id: string) => void;
  onExpired: (reason: unknown) => void;
  onCheckLater: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dismiss = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);
  return (
    <section
      id="close-account"
      className="portal-card account-section account-close-section"
      aria-labelledby="account-close-heading"
    >
      <p className="portal-kicker">ACCOUNT ACCESS</p>
      <div className="account-section-heading">
        <div>
          <h2 id="account-close-heading">Close account</h2>
          <p>Leave m8itwork and end access to this account.</p>
        </div>
        <button
          ref={trigger}
          className="button outline account-close-button"
          onClick={() => setOpen(true)}
        >
          Close account
        </button>
      </div>
      <p className="billing-small">
        You’ll review what happens and confirm before anything changes. Agreed
        work or pending payments need a team check first.
      </p>
      {open && (
        <CloseDialog
          account={account}
          onClosed={onClosed}
          onExpired={onExpired}
          onCheckLater={onCheckLater}
          dismiss={dismiss}
        />
      )}
    </section>
  );
}
