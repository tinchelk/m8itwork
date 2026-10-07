"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./workspace-types";
import { billingLink, type CardPage, type SavedCard } from "./billing-types";

function CardIcon() {
  return (
    <svg
      width="30"
      height="24"
      viewBox="0 0 30 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="1" y="2" width="28" height="20" rx="4" />
      <path d="M1 9h28M6 16h6" />
    </svg>
  );
}
function setupRequest(accountId: string) {
  const key = `m8-card-setup:${accountId}`;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null") as {
      id?: string;
      expires?: number;
    } | null;
    if (saved?.id && (saved.expires ?? 0) > Date.now()) return saved.id;
  } catch {
    /* Storage is optional. */
  }
  const id = crypto.randomUUID();
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ id, expires: Date.now() + 3600_000 }),
    );
  } catch {
    /* In-memory request ID remains usable. */
  }
  return id;
}
function RemovalDialog({
  card,
  busy,
  error,
  remove,
  close,
}: {
  card: SavedCard;
  busy: boolean;
  error: string | null;
  remove: () => void;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="billing-dialog"
      aria-labelledby="remove-card-title"
      aria-describedby="remove-card-description"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else close();
      }}
    >
      <div className="billing-card-symbol">
        <CardIcon />
      </div>
      <h2 id="remove-card-title">Remove this card?</h2>
      <p id="remove-card-description">
        {card.brand.toUpperCase()} ending in {card.last4} will be removed from
        your saved payment methods. Existing payments and receipts stay in
        Billing.
      </p>
      {error && (
        <p className="portal-error" role="alert">
          {error}
        </p>
      )}
      <div className="billing-actions">
        <button className="button outline" onClick={close} disabled={busy}>
          Keep card
        </button>
        <button className="button" onClick={remove} disabled={busy}>
          {busy ? "Removing…" : "Remove card"}
        </button>
      </div>
    </dialog>
  );
}
export function AccountCards({
  accountId,
  onExpired,
}: {
  accountId: string;
  onExpired: (reason: unknown) => void;
}) {
  const [data, setData] = useState<CardPage | null>(null),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<SavedCard | null>(null);
  const [revision, setRevision] = useState(0);
  const [verificationRevision, setVerificationRevision] = useState(0);
  const [checking, setChecking] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);
  const requestId = useRef<string | null>(null),
    addButton = useRef<HTMLButtonElement>(null);
  const removeTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!confirm && (notice || error))
      feedback.current?.scrollIntoView({ block: "nearest" });
  }, [confirm, notice, error]);
  const failed = useCallback(
    (reason: unknown) => {
      onExpired(reason);
      setError(
        reason instanceof Error
          ? reason.message
          : "We couldn’t load your payment methods. Please try again.",
      );
    },
    [onExpired],
  );
  useEffect(() => {
    let ignore = false;
    api<CardPage>("/v1/billing/cards")
      .then((value) => {
        if (!ignore) {
          setData(value);
        }
      })
      .catch((reason) => {
        if (!ignore) failed(reason);
      });
    return () => {
      ignore = true;
    };
  }, [revision, failed]);
  useEffect(() => {
    let ignore = false;
    const params = new URLSearchParams(window.location.search),
      returned = params.get("card"),
      sessionId = params.get("session_id");
    const clearReturn = () => {
      params.delete("card");
      params.delete("session_id");
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`,
      );
    };
    if (returned === "cancelled") {
      Promise.resolve().then(() => {
        if (ignore) return;
        clearReturn();
        setNotice(
          "Card setup was cancelled. Your existing payment methods are unchanged.",
        );
        requestId.current = null;
        try {
          sessionStorage.removeItem(`m8-card-setup:${accountId}`);
        } catch {}
      });
    }
    if (returned === "returned" && sessionId) {
      Promise.resolve().then(() => {
        if (!ignore) setChecking(true);
      });
      api<{ saved: boolean }>("/v1/billing/cards/verify", { sessionId })
        .then((result) => {
          if (!ignore) {
            setError(null);
            setNotice(
              result.saved
                ? "Stripe completed card setup. Your current saved cards are shown below."
                : "Stripe hasn’t finished saving this card. Use Check card setup to try again.",
            );
            setRevision((value) => value + 1);
            if (result.saved) {
              clearReturn();
              requestId.current = null;
              try {
                sessionStorage.removeItem(`m8-card-setup:${accountId}`);
              } catch {}
            }
          }
        })
        .catch((reason) => {
          if (!ignore) failed(reason);
        })
        .finally(() => {
          if (!ignore) setChecking(false);
        });
    } else if (returned === "returned")
      Promise.resolve().then(() => {
        if (!ignore)
          setError(
            "We couldn’t confirm card setup. Refresh your payment methods to check the result.",
          );
      });
    return () => {
      ignore = true;
    };
  }, [accountId, failed, verificationRevision]);
  async function add() {
    setBusy(true);
    setError(null);
    setNotice(null);
    requestId.current ??= setupRequest(accountId);
    try {
      let result = await api<{ url?: string; finished?: boolean }>(
        "/v1/billing/cards/setup",
        {
          requestId: requestId.current,
        },
      );
      if (result.finished) {
        try {
          sessionStorage.removeItem(`m8-card-setup:${accountId}`);
        } catch {}
        requestId.current = setupRequest(accountId);
        result = await api<{ url?: string; finished?: boolean }>(
          "/v1/billing/cards/setup",
          { requestId: requestId.current },
        );
      }
      const url = billingLink(result.url);
      if (!url || new URL(url).hostname !== "checkout.stripe.com")
        throw new Error("We couldn’t open the secure card page. Please retry.");
      window.location.assign(url);
    } catch (reason) {
      failed(reason);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/v1/billing/cards/${confirm.id}/remove`, {});
      const page = await api<CardPage>("/v1/billing/cards");
      setData(page);
      setNotice(`Card ending in ${confirm.last4} was removed.`);
      setConfirm(null);
      requestAnimationFrame(() => addButton.current?.focus());
    } catch (reason) {
      failed(reason);
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    if (!data?.next) return;
    setBusy(true);
    setError(null);
    try {
      const page = await api<CardPage>(
        `/v1/billing/cards?after=${encodeURIComponent(data.next)}`,
      );
      setData({ ...page, cards: [...data.cards, ...page.cards] });
    } catch (reason) {
      failed(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="payment-methods"
      className="portal-card account-section"
      aria-labelledby="cards-heading"
    >
      <div className="account-section-heading">
        <div>
          <p className="portal-kicker">PAYMENT METHODS</p>
          <h2 id="cards-heading">Your saved cards</h2>
        </div>
        <button
          ref={addButton}
          className="button"
          disabled={!data?.enabled || busy || checking}
          onClick={add}
        >
          {busy && !confirm ? "Working…" : "Add card"}
          <span aria-hidden="true">＋</span>
        </button>
      </div>
      <p>
        Save a card for your next agreed project payment. Card details are
        entered securely with Stripe; adding a card doesn’t make a payment.
      </p>
      <div ref={feedback}>
        {error && !confirm && (
          <div className="portal-error" role="alert">
            <p>{error}</p>
            <button
              className="portal-plain"
              onClick={() => {
                setError(null);
                setRevision((value) => value + 1);
                setVerificationRevision((value) => value + 1);
              }}
              disabled={busy}
            >
              Refresh payment methods
            </button>
          </div>
        )}
        {notice && (
          <p className="portal-notice" role="status">
            {notice}
            {notice.startsWith("Stripe hasn’t") && (
              <button
                className="billing-text-button"
                onClick={() => {
                  setError(null);
                  setChecking(true);
                  setVerificationRevision((value) => value + 1);
                }}
                disabled={busy || checking}
              >
                {checking ? "Checking card setup…" : "Check card setup"}
              </button>
            )}
          </p>
        )}
        {checking && (
          <p className="billing-small" aria-live="polite">
            Checking the result securely with Stripe…
          </p>
        )}
      </div>
      {!data && !error ? (
        <p role="status">Loading your payment methods…</p>
      ) : data && !data.enabled ? (
        <div className="billing-empty">
          <CardIcon />
          <h3>Payment methods are currently unavailable</h3>
          <p>
            Your project agreements and payment history remain available.{" "}
            <a href="mailto:hello@m8itwork.com">Contact billing support</a> for
            help.
          </p>
        </div>
      ) : data && !data.cards.length ? (
        <div className="billing-empty">
          <CardIcon />
          <h3>No saved cards yet</h3>
          <p>
            Add a card now, or enter your payment details when a project
            installment is due.
          </p>
        </div>
      ) : data ? (
        <ul className="saved-card-list">
          {data.cards.map((card) => {
            const now = new Date(),
              expired =
                card.expYear < now.getFullYear() ||
                (card.expYear === now.getFullYear() &&
                  card.expMonth < now.getMonth() + 1);
            return (
              <li key={card.id}>
                <div className="saved-card-brand">
                  <CardIcon />
                  <div>
                    <strong>
                      {card.brand.toUpperCase()} <span>•••• {card.last4}</span>
                    </strong>
                    <p>
                      {expired ? "Expired" : "Expires"}{" "}
                      {String(card.expMonth).padStart(2, "0")}/{card.expYear}
                    </p>
                  </div>
                </div>
                <button
                  className="billing-text-button"
                  onClick={(event) => {
                    removeTrigger.current = event.currentTarget;
                    setError(null);
                    setConfirm(card);
                  }}
                  disabled={busy}
                  aria-label={`Remove ${card.brand} ending in ${card.last4}`}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {data?.next && (
        <button className="button outline" onClick={more} disabled={busy}>
          Load more cards
        </button>
      )}
      {data?.mode === "test" && (
        <p className="billing-test" role="note">
          Stripe test mode — no real money is collected.
        </p>
      )}
      <p className="billing-small">
        Review payment history and receipts in <a href="/billing">Billing</a>.
      </p>
      {confirm && (
        <RemovalDialog
          card={confirm}
          busy={busy}
          error={error}
          remove={remove}
          close={() => {
            if (!busy) {
              setConfirm(null);
              setError(null);
              requestAnimationFrame(() => removeTrigger.current?.focus());
            }
          }}
        />
      )}
    </section>
  );
}
