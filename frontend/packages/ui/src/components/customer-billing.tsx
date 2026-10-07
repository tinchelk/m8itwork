"use client";

import { useEffect, useRef, useState } from "react";
import { api, displayDate, money } from "./workspace-types";
import { AccountGate, CustomerPage, useCustomerAccount } from "./customer-page";
import {
  billingLink,
  type BillingData,
  type BillingPayment,
} from "./billing-types";
import { SelectField } from "./form-controls";

const filters = [
  { value: "ALL", label: "All payments" },
  { value: "PAID", label: "Paid" },
  { value: "PENDING", label: "Pending" },
  { value: "REFUNDED", label: "Refunded" },
  { value: "FAILED", label: "Failed or expired" },
  { value: "DISPUTED", label: "Disputed" },
];
function paymentState(payment: BillingPayment) {
  if (payment.disputed) return { label: "Under dispute", style: "review" };
  if (payment.refundedCents > 0)
    return {
      label:
        payment.refundedCents >= payment.amountCents
          ? "Refunded"
          : "Partially refunded",
      style: "review",
    };
  if (payment.status === "PAID") return { label: "Paid", style: "paid" };
  if (payment.status === "FAILED") return { label: "Failed", style: "review" };
  if (payment.status === "EXPIRED") return { label: "Expired", style: "muted" };
  return {
    label: payment.status === "PROCESSING" ? "Processing" : "Awaiting payment",
    style: "pending",
  };
}
function PaymentDocuments({ payment }: { payment: BillingPayment }) {
  const receipt = billingLink(payment.receiptUrl),
    invoice = billingLink(payment.invoiceUrl),
    pdf = billingLink(payment.invoicePdf);
  return receipt || invoice || pdf ? (
    <div className="billing-documents">
      {receipt && (
        <a
          href={receipt}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Receipt for ${payment.label} — ${payment.project.name} (opens in new tab)`}
        >
          Receipt ↗
        </a>
      )}
      {invoice && (
        <a
          href={invoice}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Invoice for ${payment.label} — ${payment.project.name} (opens in new tab)`}
        >
          Invoice ↗
        </a>
      )}
      {pdf && (
        <a
          href={pdf}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Invoice PDF for ${payment.label} — ${payment.project.name} (opens in new tab)`}
        >
          PDF ↗
        </a>
      )}
    </div>
  ) : (
    <span className="billing-small">
      {payment.status === "PAID"
        ? "Documents processing"
        : "Available after payment"}
    </span>
  );
}
function BillingContent({
  onExpired,
}: {
  onExpired: (reason: unknown) => void;
}) {
  const [data, setData] = useState<BillingData | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [loadedFilter, setLoadedFilter] = useState("ALL");
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<{
    section: "history" | "due";
    message: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"history" | "due" | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const sequence = ++generation.current;
    api<BillingData>(`/v1/billing?status=${filter}`)
      .then((value) => {
        if (sequence === generation.current) {
          setData(value);
          setLoadedFilter(filter);
          setError(null);
        }
      })
      .catch((reason) => {
        if (sequence === generation.current) {
          onExpired(reason);
          setError(
            reason instanceof Error
              ? reason.message
              : "We couldn’t load your billing. Please try again.",
          );
        }
      })
      .finally(() => {
        if (sequence === generation.current) setLoading(false);
      });
    return () => {
      generation.current = sequence + 1;
    };
  }, [filter, revision, onExpired]);
  function refresh() {
    setMoreError(null);
    setLoading(true);
    setError(null);
    setRevision((value) => value + 1);
  }
  function changeFilter(value: string) {
    setMoreError(null);
    setFilter(value);
    setLoading(true);
    setError(null);
  }
  async function more(section: "history" | "due") {
    const cursor = section === "history" ? data?.next : data?.dueNext;
    if (!cursor || busy) return;
    const sequence = generation.current;
    setBusy(section);
    setMoreError(null);
    try {
      const result = await api<BillingData>(
        `/v1/billing?status=${filter}&${section === "history" ? "after" : "dueAfter"}=${encodeURIComponent(cursor)}`,
      );
      if (sequence === generation.current)
        setData((current) =>
          current
            ? section === "history"
              ? {
                  ...current,
                  history: [...current.history, ...result.history],
                  next: result.next,
                  totals: result.totals,
                }
              : {
                  ...current,
                  due: [...current.due, ...result.due],
                  dueNext: result.dueNext,
                }
            : current,
        );
    } catch (reason) {
      if (sequence === generation.current) {
        onExpired(reason);
        setMoreError({
          section,
          message:
            reason instanceof Error
              ? reason.message
              : "We couldn’t load more payments. Please retry.",
        });
      }
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <div className="customer-page-heading">
        <div>
          <p className="portal-kicker">PROJECT PAYMENTS</p>
          <h1>Billing</h1>
          <p>
            Agreed payments, receipts and invoices. Everything in one place.
          </p>
        </div>
        <a className="button outline" href="/account#payment-methods">
          Manage cards <span aria-hidden="true">↗</span>
        </a>
      </div>
      {error && (
        <div className="portal-error" role="alert">
          <p>{error}</p>
          <button
            className="portal-plain"
            onClick={refresh}
            disabled={loading || busy !== null}
          >
            Try again
          </button>
        </div>
      )}
      {data?.mode === "test" && (
        <p className="billing-test" role="note">
          New Checkout sessions use Stripe test mode — no real money is
          collected.
        </p>
      )}
      {loading && !data && !error ? (
        <section className="portal-card" role="status">
          Loading your billing…
        </section>
      ) : data ? (
        <>
          <div className="billing-summary" aria-label="Payment summary">
            {data.totals.length ? (
              data.totals.map((total) => (
                <section
                  className="portal-card billing-total"
                  key={`${total.mode}-${total.currency}`}
                >
                  <p className="portal-kicker">
                    {total.mode === "test" ? "TEST PAYMENTS" : "PAYMENTS MADE"}{" "}
                    · {total.currency.toUpperCase()}
                  </p>
                  <strong>
                    {money({
                      currency: total.currency,
                      amountCents: total.paidCents,
                    })}
                  </strong>
                  <p>
                    {money({
                      currency: total.currency,
                      amountCents: total.refundedCents,
                    })}{" "}
                    refunded
                  </p>
                </section>
              ))
            ) : (
              <section className="portal-card billing-total">
                <p className="portal-kicker">PAYMENTS MADE</p>
                <strong>No payments yet</strong>
                <p>
                  Your payment totals will appear here, grouped by currency.
                </p>
              </section>
            )}
            <section className="portal-card billing-summary-note">
              <span aria-hidden="true">↗</span>
              <div>
                <h2>Pay when we agree</h2>
                <p>
                  Starting a project is free. Review the scope, price and
                  payment stages in your project before paying.
                </p>
                <a href="/dashboard">Open your dashboard ↗</a>
              </div>
            </section>
          </div>
          <section
            className="portal-card billing-due"
            aria-labelledby="due-heading"
          >
            <div className="account-section-heading">
              <div>
                <p className="portal-kicker">NEXT STEPS</p>
                <h2 id="due-heading">Payments due</h2>
              </div>
              <button
                className="billing-text-button"
                onClick={refresh}
                disabled={loading || busy !== null}
              >
                {loading ? "Refreshing…" : "Refresh billing"}
              </button>
            </div>
            {!data.enabled && (
              <p className="portal-notice">
                Online payments are temporarily unavailable. Contact us in your
                project for billing help.
              </p>
            )}
            {data.due.length ? (
              <ul className="billing-due-list">
                {data.due.map((due) => (
                  <li key={due.id}>
                    <div>
                      <h3>{due.label}</h3>
                      <p>{due.project.name}</p>
                      {due.needsReview && (
                        <span className="billing-small">
                          A team check or earlier installment is needed.
                        </span>
                      )}
                      {!due.needsReview && due.processing && (
                        <span className="billing-status pending">
                          Confirmation pending
                        </span>
                      )}
                    </div>
                    <div className="billing-due-amount">
                      <strong>{money(due)}</strong>
                      <small className="billing-small">
                        Agreed installment
                      </small>
                    </div>
                    <a
                      className="button outline"
                      href={`/dashboard?project=${encodeURIComponent(due.project.id)}#payments`}
                    >
                      {due.needsReview
                        ? "Review in project"
                        : due.processing
                          ? "Check payment status"
                          : "View payment"}
                      <span aria-hidden="true">↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="billing-empty billing-empty-inline">
                <span className="billing-check" aria-hidden="true">
                  ✓
                </span>
                <div>
                  <h3>You’re all caught up</h3>
                  <p>
                    No released project payments are due. Your next agreed
                    installment will appear here when it’s ready.
                  </p>
                </div>
              </div>
            )}
            {moreError?.section === "due" && (
              <p className="portal-error" role="alert">
                {moreError.message} Use Load more payments due to retry.
              </p>
            )}
            {data.dueNext && (
              <button
                className="button outline"
                onClick={() => more("due")}
                disabled={busy !== null || loading}
              >
                {busy === "due" ? "Loading…" : "Load more payments due"}
              </button>
            )}
          </section>
          <section
            className="portal-card billing-history"
            aria-labelledby="history-heading"
          >
            <div className="account-section-heading">
              <div>
                <p className="portal-kicker">YOUR RECORDS</p>
                <h2 id="history-heading">Payment history</h2>
              </div>
              <div className="billing-filter">
                <label htmlFor="payment-status">Status</label>
                <SelectField
                  id="payment-status"
                  options={filters}
                  value={filter}
                  onValueChange={changeFilter}
                  disabled={busy !== null}
                />
              </div>
            </div>
            {loading || loadedFilter !== filter ? (
              <p role={loading ? "status" : undefined}>
                {loading
                  ? "Loading payments…"
                  : "This payment view couldn’t be loaded. Use Try again above to retry."}
              </p>
            ) : data.history.length ? (
              <div className="billing-table-wrap">
                <table className="billing-table">
                  <caption className="field-visually-hidden">
                    Your project payment history
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Payment</th>
                      <th scope="col">Date</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Status</th>
                      <th scope="col">Documents</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((payment) => {
                      const state = paymentState(payment);
                      return (
                        <tr key={payment.id}>
                          <td data-label="Payment">
                            <a
                              href={`/dashboard?project=${encodeURIComponent(payment.project.id)}#payments`}
                            >
                              {payment.label}
                            </a>
                            <small>{payment.project.name}</small>
                            {payment.mode === "test" && (
                              <span className="billing-mode">TEST</span>
                            )}
                          </td>
                          <td data-label="Date">
                            <time
                              dateTime={payment.paidAt || payment.createdAt}
                            >
                              {displayDate(payment.paidAt || payment.createdAt)}
                            </time>
                          </td>
                          <td data-label="Amount">
                            <strong>{money(payment)}</strong>
                            {payment.refundedCents > 0 && (
                              <small>
                                {money({
                                  ...payment,
                                  amountCents: payment.refundedCents,
                                })}{" "}
                                refunded
                              </small>
                            )}
                          </td>
                          <td data-label="Status">
                            <span className={`billing-status ${state.style}`}>
                              {state.label}
                            </span>
                          </td>
                          <td data-label="Documents">
                            <PaymentDocuments payment={payment} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="billing-empty">
                <div className="billing-card-symbol" aria-hidden="true">
                  ↗
                </div>
                <h3>
                  {filter === "ALL"
                    ? "Your first payment starts a record"
                    : "No payments match this status"}
                </h3>
                <p>
                  {filter === "ALL"
                    ? "Once you agree to a scope and make a project payment, its status and documents will appear here."
                    : "Try another status to see your payment history."}
                </p>
                {filter !== "ALL" && (
                  <button
                    className="button outline"
                    onClick={() => changeFilter("ALL")}
                  >
                    Show all payments
                  </button>
                )}
              </div>
            )}
            {moreError?.section === "history" && (
              <p className="portal-error" role="alert">
                {moreError.message} Use Load more payments to retry.
              </p>
            )}
            {!loading && loadedFilter === filter && data.next && (
              <button
                className="button outline"
                onClick={() => more("history")}
                disabled={busy !== null}
              >
                {busy === "history" ? "Loading…" : "Load more payments"}
              </button>
            )}
            <p className="billing-small">
              Receipts and invoices open securely with Stripe. Questions about a
              payment?{" "}
              <a href="mailto:hello@m8itwork.com">Contact billing support</a>.
            </p>
          </section>
        </>
      ) : null}
    </>
  );
}
export function CustomerBilling() {
  const customer = useCustomerAccount(),
    account = customer.auth?.account ?? null;
  return (
    <CustomerPage
      current="billing"
      account={account}
      busy={customer.busy}
      logout={customer.logout}
      error={customer.error}
    >
      {!customer.loaded || !account ? (
        <AccountGate
          current="billing"
          loaded={customer.loaded}
          account={account}
          error={customer.error}
          retry={customer.retry}
        />
      ) : (
        <BillingContent key={account.id} onExpired={customer.fail} />
      )}
    </CustomerPage>
  );
}
