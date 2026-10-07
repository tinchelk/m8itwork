# Milestone 3 — agreement, payment, conversation, delivery

User outcome: the team manages a customer from submitted brief through conversation, human review, mutually agreed scope/payment schedule, confirmed payment, tracked work, verification, and handover. The customer returns to the same project for every step.

## Scope

- A protected `/admin` project queue and project detail reuse the customer record. Numeric GitHub-ID operator allowlisting remains server-only. No shared password or public admin bypass.
- An account/project-owned conversation supports idempotent messages, older-message pagination, refresh/polling, unread counts, and short-lived drafts. Messages stay in the app; email, attachments, and external notifications are excluded.
- Immutable proposals include one to six payment installments, with labels, amounts, and gates before build, verification, or handover. They sum exactly to the proposal total and require fresh customer approval on revision. The team agrees by publishing; the customer agrees by approving.
- First payment is requested on approval; the team releases later installments after the preceding one is paid and the appropriate work stage is reached. Payment uses Stripe-hosted, one-time card Checkout. No subscription, automatic off-session collection, platform fee, or stored card data.
- Server-derived amounts and Stripe idempotency keys prevent browser price changes and duplicate Checkout creation. Signed raw-body webhooks plus authoritative provider retrieval confirm payment; the return URL alone never marks paid. Duplicate events, failed/expired Checkout, retries, refunds, authoritative dispute refresh, and snapshot-fenced clearing are handled without inventing payment success.
- Pending Checkout must be expired before an unpaid proposal can be revised. Paid proposals remain immutable; additional paid scope uses a separately agreed project. No automatic refund or other financial action is performed by the implementation.
- Customer-visible work items track to-do, doing, blocked, and done, with verification/handover evidence. Payment gates require confirmed attempts in the configured payment mode and protect starting work, entering verification, and completion. Test balances cannot satisfy live delivery. Completion also requires all work items done and a verification summary.
- Private team notes are scoped to operator-only endpoints and never included in customer responses.

## Acceptance

- Verify login/role/tenant boundaries on admin, conversation, notes, work items, and checkout. Clients cannot impersonate the team, mark payments paid, or change approved amounts.
- Proposals reject invalid schedules. Revisions invalidate consent and cannot race Checkout reservation or paid work. Duplicate messages and Checkout retries remain idempotent.
- Payment gates stay closed on an unpaid, refunded, disputed, mismatched, forged, stale, or wrong-mode provider event. Replayed events create no duplicate financial/timeline effects.
- Customer and admin can converse, review a quote, approve, pay first installment, follow work, request later payment, verify, pay final installment, and receive handover using the same project.
- Mobile/desktop flows have clear next actions, visible feedback, recovery from errors, and honest provider configuration states. No real charge is made during development verification.
- Run dedicated PostgreSQL integration tests, browser workflow tests, lint/typecheck/build and visual checks, then the independent Staff Engineer/Product Owner/Designer reviews required by AGENTS.md.
- Real GitHub App login/private access, explicit operator configuration, and a Stripe sandbox payment/webhook round trip remain live acceptance gates. Production money collection additionally requires live credentials/webhook setup and deployment; fixtures must be labeled.

## Provider references

Implementation follows [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), [webhook verification](https://docs.stripe.com/webhooks), and [Checkout expiration](https://docs.stripe.com/api/checkout/sessions/expire). Runtime payment secrets remain server-only and ignored by Git.

Operational configuration and sandbox recovery are documented in [STRIPE_SETUP.md](STRIPE_SETUP.md). Implementation verification/review results and remaining live gates are in [VERIFICATION.md](VERIFICATION.md).

Latest backoffice architecture: `frontend/apps/admin` serves the dedicated operator app at `admin.m8itwork.com` (local 3123); customer `/admin` redirects there. `frontend/apps/customer` serves the website and `/dashboard` (local 3120). Both share the API and UI source, with separate builds/deployments and unchanged server operator allowlisting. See `DASHBOARD_BACKOFFICE.md`.
