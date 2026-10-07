# Customer dashboard and operator backoffice

October 6, 2026 clarification: customers sign in to their dashboard. Admin means the operator's separate backoffice for handling customer requests, rather than a mode inside the customer's workspace.

Outcome: the customer app at `m8itwork.com/dashboard` lands on the customer's project overview with status, messages, and a clear next action. The independently built admin app at `admin.m8itwork.com` lands on the operator queue with customer conversations, review, scope/cost/ETA, payment schedules, work, and handover tools. This restores the donor's `frontend/apps/customer`, `frontend/apps/admin`, and shared `frontend/packages/ui` structure; the current reviewed service workflow replaces Growth AI's marketing domain.

Acceptance:

- Customer sign-in and repository reconnection return to `/dashboard`. Existing `/workspace` links preserve their project/payment query parameters when redirected to `/dashboard`.
- The customer dashboard shows only owned projects. New customers see an honest empty state and Start a project; project creation is explicit. Existing customers choose a project or follow a project-specific link.
- Customer navigation has no team-mode switch. Only an explicitly allowlisted operator sees a Backoffice link. The dashboard remains a customer view even for that operator.
- The separate admin app has backoffice sign-in copy and returns there after operator sign-in. The customer app's old `/admin` redirects to it, preserving project parameters. A customer visiting it sees an access-denied message and dashboard link; backend operator authorization remains enforced regardless of the selected login flow.
- Customer and admin builds share UI source, but have separate Next.js entry points, runtime ports, Docker build targets, and Railway services. The API permits exactly their configured origins with credentials; only the numeric operator allowlist grants access to operator endpoints.
- Backoffice retains the reviewed project queue and work tools. This change adds no role-granting form, new repository permission, or payment action.

Verification: affected authentication/redirect integration tests, dashboard/empty-state/customer-denial/operator flows on desktop and mobile, lint/typecheck/build, live production dashboard/backoffice after deployment, and three independent reviews. Full Stripe and second-customer live acceptance remain separate gates.

Local verification: backend lint/typecheck and 56 tests pass; frontend lint/typecheck and both production builds pass; all 54 desktop/mobile browser checks pass across the two apps. Coverage includes separate destinations, operator non-escalation, exact admin origin writes, query-preserving legacy links, explicit creation, honest list failure/retry, requested final payment/pending confirmation, and cleared message badges after returning to the dashboard. Dashboard payment metadata uses account-filtered proposals and the existing safe milestone/attempt-mode/status projection; no provider identifiers or team notes are added.

Visual evidence: `preview-dashboard-{empty,projects}-{desktop,mobile}.png` and `preview-dashboard-project-card-mobile.png` are synthetic browser-test data, including a sample final payment; no actual proposal or payment is represented. Actual authenticated production screenshots stay only in ignored `backend/var/preview-production-{dashboard,backoffice}-split.jpg`.

Review fixes: unknown project lists show a retry card rather than a first-project empty state; returning to the overview refreshes message/status summaries and clears project notices; requested payments and payment holds/pending confirmation override generic stage copy. Dashboard and payment-table readiness share refund, raw overpayment, dispute, and latest-attempt mode checks. Repeated project navigation is hidden on the mobile customer overview while retained on detail pages.

All three independent implementation gates pass with no remaining findings/deferrals. Staff independently repeated 56 backend tests, 12 affected desktop/mobile checks, both Node22 Docker targets including UID1000/assets/images/login/redirect runtime, and verified safe list metadata plus payment hold probes. Product Owner independently checked failure recovery, badges, role separation, customer denial and next actions. Designer inspected synthetic desktop/mobile screenshots and the final compact overview/card wrapping. Final affected local checks pass after fixes; full mock installment delivery remains green. Production split verification passes below.

## Deployment

The new admin service is `b3d4dca9-76a2-4453-a004-86a69069e7cd`, in the existing new m8itwork Railway project `1e29ee87-902c-4320-9089-863284aaf971`. Its custom domain `admin.m8itwork.com` routes via proxied Cloudflare CNAME to `v7qsiehk.up.railway.app`, with Railway verification TXT at `_railway-verify.admin`; ownership/TLS passed. Mail and other records were preserved.

API `ADMIN_ORIGIN=https://admin.m8itwork.com`; customer/frontend build URLs are `NEXT_PUBLIC_API_URL=https://api.m8itwork.com`, `NEXT_PUBLIC_CUSTOMER_ORIGIN=https://m8itwork.com`, and `NEXT_PUBLIC_ADMIN_ORIGIN=https://admin.m8itwork.com`. Frontend services build from the same context using `APP=customer` on web and `APP=admin` on admin, with separate standalone containers. No extra credentials or schema migration were introduced.

Successful deployments: admin `d6079e32-aaf0-490b-95c1-f778b3ff106e`; customer `1034588a-a98a-4056-91b8-783437baaa43`; API `e5149acd-aa48-408d-b7cf-9fb81e84b560`. Coordinate API and customer/admin rollback because old APIs do not accept the separate admin origin; keep the numeric operator allowlist and existing encryption key stable.

Live HTTPS verification passed on October 6, 2026:

- Dashboard and backoffice return 200 with distinct titles, and API health returns 200. Existing `/workspace?project=redirect-fixture&payment=cancelled` returns 307 to `/dashboard` with both parameters; customer `/admin?project=redirect-fixture` returns 307 to the separate admin origin with that parameter.
- Real GitHub sign-in from each app returns to its intended origin and page: customer `/dashboard?github=connected`, backoffice `/?github=connected`. Both show the expected account; the allowlisted operator's dashboard remains the customer overview while the admin app shows the customer-request queue. Sign-out hides protected content and exposes the correct app's sign-in screen.
- Exact admin-origin credentialed CORS and POST preflight pass. Untrusted origins receive no allow-origin header; untrusted POST returns 403. Anonymous customer and operator project APIs both return 401.
- The live queues are empty because no customer project has been submitted. No production project, proposal, payment, or additional repository permission was created for this split check. Full second-customer/project and Stripe sandbox acceptance remain open as documented in `VERIFICATION.md`.
