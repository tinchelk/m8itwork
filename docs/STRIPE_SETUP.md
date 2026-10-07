# Stripe payment setup and live verification

The implementation uses one-time hosted card Checkout. Do not configure keys in frontend environment variables or commit them. No actual payment was taken during implementation; integration/browser fixtures do not verify a real Stripe round trip.

## Configure the pilot sandbox

1. Finish GitHub App sign-in/private access using `GITHUB_SETUP.md`. Configure the trusted operator’s numeric ID in `OPERATOR_GITHUB_IDS`, then restart the API. Confirm that a customer cannot access the separate `admin.m8itwork.com` backoffice or access another project.
2. In a Stripe sandbox, obtain the server secret key (`sk_test_…`). Install/sign into the Stripe CLI locally, and forward events to the API:

   ```sh
   stripe listen --forward-to localhost:3121/v1/stripe/webhook
   ```

3. Put `STRIPE_SECRET_KEY` and the listener’s `STRIPE_WEBHOOK_SECRET` (`whsec_…`) in ignored `backend/.env`, then restart the API. Both are required. The frontend must display **Stripe test mode — no real money is collected**. Listener secrets can change when restarting; update/restart accordingly. The webhook path accepts the original JSON body with `Stripe-Signature` verification; authenticated project routes enforce the frontend Origin.
4. Create a synthetic customer project, submit it, publish a human review and a deposit/final proposal from the separate backoffice, then approve the current proposal from `/dashboard` in the customer app. Only the first installment is requested initially.
5. Open Checkout with the customer’s Pay button and use a Stripe documented test card. Confirm a real Checkout session in Stripe, a delivered signed event, exactly one recorded payment/timeline entry, and building unlocked. Save nonsecret session/event IDs and results in `VERIFICATION.md`. A return URL alone never marks paid; returned Checkout triggers authoritative synchronization, and processing remains pending until Stripe reports paid.
6. Complete tracked work with evidence, enter verification, request the final installment, pay in the sandbox, and record final verification/handover. Verify both the customer and admin views after reload.
7. Exercise cancellation/expiry/retry, replay of an existing signed event, and a sandbox refund or dispute. No duplicate charge or timeline entry should appear. A refunded/disputed balance must block further stage advancement. Payment refresh retrieves current refunds and disputes, recovering missed payment/dispute webhook reconciliation.

See the current [Stripe testing documentation](https://docs.stripe.com/testing), [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), and [webhook documentation](https://docs.stripe.com/webhooks). No automatic refund, dispute response, or off-session charge is implemented.

## Recovery and changes

- Checkout creation keeps one idempotency key and stable parameters per attempt. Stripe’s default 24-hour session expiry is used. Creation with no recovered session older than 23 hours is blocked for operator reconciliation before Stripe idempotency-key retention can become ambiguous.
- If a response is lost, retry the same installment; the existing session is reused. If that cannot recover the session, use **Recover an unfinished Checkout** in the admin payment plan, with the existing `cs_…` session ID from Stripe. The server verifies its attempt metadata, amount, currency, mode, and session mapping. Check Stripe before starting any replacement charge.
- **Expire pending Checkout** checks Stripe, expires an open unpaid session, and retrieves its final status before allowing proposal revision. Completed/paid/uncertain attempts keep the proposal locked. Paid scope requires a separately agreed follow-on project.
- Do not change origins, project payment data, or credentials while Checkout creation is unresolved. Resolve/expire those sessions first.
- Test and live use separate databases and credentials. The server additionally requires matching PaymentAttempt modes for delivery and earlier-installment gates; a test payment cannot satisfy live work gates. A mismatched existing ledger shows team-review guidance. Do not collect a live replacement payment against a sandbox-approved project: create a new real agreement in the live database.

## Production gate

Configure HTTPS frontend/API origins, production GitHub callbacks, trusted operator IDs, durable PostgreSQL/backups, cleanup, proxy/rate limits, and live Stripe server credentials. Register an HTTPS Stripe webhook endpoint at `/v1/stripe/webhook` and use its signing secret. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, and `charge.dispute.closed`.

Verify sandbox behavior first, then obtain explicit authorization before any real financial verification. Monitor failed webhook delivery and retry it in Stripe; operators can use Check payment status to reconcile the current session. This app does not run a background settlement worker. No production deployment or live-money closure is claimed by this document.

Customer Checkout success/cancel returns now use `/dashboard` with the project/payment query parameters. The backoffice has its own frontend origin: `ADMIN_ORIGIN` on the API and `NEXT_PUBLIC_ADMIN_ORIGIN` on both frontend builds. Keep the two exact origins configured; they do not grant operator access without the server allowlist.
