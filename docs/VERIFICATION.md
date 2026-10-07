# Milestone 1 verification — October 6, 2026

Implementation reviews pass. At the user's request, the Milestone 1 implementation was committed as checkpoint `b5b5b17` before completing live GitHub setup. The entries below record that original local verification. Later production login/private scanning and remaining live gates are recorded at the end of this document. This checkpoint does not claim launch readiness.

## Verified implementation

- Backend lint, TypeScript check, and production build pass.
- 20 backend tests pass, including real PostgreSQL persistence, browser-session isolation, OAuth replay/state/PKCE, read-only permission validation, delayed callback cancellation after disconnect/new connect, and saved-inspection removal/submission behavior.
- Frontend lint, TypeScript check, and production build pass.
- 16 browser checks pass across desktop Chromium and an iPhone-sized Chromium viewport. They cover manual save/failure/retry, connected inspection attachment, removal/reload, changed-repository fallback, new-feature requests, visible partial samples, focused workflow validation, keyboard FAQ access, labels, and horizontal overflow.
- A live public scan of `expressjs/express` retrieved commit `7ef9844`, 214 sampled files, and an explicitly limited static inventory. No build/tests/source execution occurred.
- Original generated midnight workshop artwork loads, with teal headings/copper actions and a distinct visual system. The desktop screenshot is `docs/preview-desktop.jpg`. Native iOS Safari focus behavior has not been exercised; mobile controls use 16px text.
- The local operator setup utility was independently exercised with mocked conversion and rejected Host/method/state/replay requests. It preserves configuration, writes credentials atomically with mode 600, and does not print credentials. The real environment was not modified by those tests.

## Independent reviews

- Staff Engineer: no blocking code findings. Delayed OAuth reconnection and selection restoration findings resolved. Setup utility code gate passes.
- Senior Product Owner: finish/fix/extend scope, honest assessment estimates, custom-feature intake, and operator proposal/payment tracking accepted. Full milestone sign-off remains open until the required live private path passes.
- Senior Product Designer: final midnight design and experience gate passes. Partial sample visibility, focused workflow validation, and mobile form legibility findings resolved. No remaining designer findings or deferrals.

## Background clarity follow-up

- Regenerated the same midnight scene with clean contours as `midnight-workshop-crisp.png`. Native source remains 1536 × 1024; the tool did not deliver the requested larger resolution. This change is described as sharper detail and delivery, not as a 4K asset.
- Raised this image's optimized quality from 75 to 95 and changed its responsive sizing from `100vw` to `max(100vw, 150vh)`, matching the 3:2 source under `object-fit: cover`. Tall screens now select a larger source instead of stretching a width-only derivative. Removed header/content backdrop blur while keeping dark-panel opacity.
- Frontend lint/typecheck/production build and all 16 existing desktop/mobile browser tests passed again. Live checks at 1280 × 720 and 504 × 844, DPR 2, loaded the new q95 image; neither viewport overflowed horizontally. Header and content backdrop filters are `none`.
- Visual evidence: `docs/preview-desktop-crisp.png` and `docs/preview-tall-crisp.png`.
- A direct optimized-image response was 1536 × 1024 WebP, approximately 452 KiB at q95. Next.js keeps the native-resolution ceiling rather than physically upscaling the PNG.
- Fresh Staff Engineer, Product Owner, and Product Designer follow-up reviews all pass with no findings or new deferrals. Each verified the clearer artwork, honest native-resolution limitation, unchanged product flows, and readable panels. These visual gates do not close the required real private GitHub path.

## Required live closure

1. Register the read-only GitHub App using `npm --prefix backend run github:setup` and <http://localhost:3122>, then restart the API. Alternatively configure an existing App using `docs/GITHUB_SETUP.md`.
2. Authorize the App and install it on a selected private repository.
3. Inspect that private repository and verify its pinned commit and stack evidence.
4. Verify rejection of an unshared private repository, isolation between browser sessions, and loss of access after disconnect.
5. Record results, close the three review gates for the full milestone, and commit the live-verification follow-up.

The original milestone verification was local. Production deployment was subsequently performed October 6; see [DEPLOYMENT.md](DEPLOYMENT.md) for HTTPS/DNS, live rate-limit correction, intake persistence, backup/cleanup evidence and remaining GitHub/Stripe gates.

# Milestone 2 implementation verification — October 6, 2026

The customer workspace implementation and three independent code/product/design gates pass. These entries record local checks before deployment; [DEPLOYMENT.md](DEPLOYMENT.md) records the later public deployment, registered App, explicit operator allowlist, and passed login/private scan. Full milestone and launch sign-off remain open pending the live customer-project and second-account checks. The Milestone 1 checkpoint is `b5b5b17`; Milestone 2 is left uncommitted until the live gates close, unless the user requests another checkpoint.

## Verified implementation

- Backend lint, TypeScript check, and production build pass. All **33 backend tests** pass, using a dedicated real PostgreSQL database and mocked GitHub responses. The 13 workspace integration tests cover stable numeric identity, project ownership/operator isolation, idempotent project creation, private report ownership, PRD persistence, review/versioned quote/approval/build/verification, concurrent revisions, stale and expired-estimate approval, access constraints, reconnect identity mismatch, and OAuth/logout races.
- Account-switch regressions reject a previously scanned private report in another account's project and anonymous intake. Two completed login callbacks cannot leave an older browser-bound session valid after rotation/logout. Scans started before logout or account rotation return `CONNECTION_CHANGED`, store no report, and do not restore the connection. Already-issued bounded provider reads may finish; cancellation discards their results rather than aborting every network request.
- Additive migrations 003–005 apply to both local and test databases; generated Prisma client matches the schema. Inspection ownership is nullable for existing anonymous records, which cannot be attached to an authenticated workspace.
- Frontend lint, TypeScript check, and production build pass. All **30 browser checks** pass across desktop Chromium and an iPhone-sized Chromium viewport. After the draft hook lint correction, all 14 workspace checks passed again. The final screenshot-only fixture change passed both affected desktop/mobile checks.
- Customer forms preserve input after failed saves and reauthentication. Account/project keys prevent drafts restoring for a different identity; explicit sign-out clears them. Proposal revisions reset acknowledgment. Save/error feedback and the Review proposal destination are checked in the viewport.
- Operators publish a human review, immutable proposal, and ordered work updates. Development requires current approval; completion requires verification evidence. Active-work requests are visibly follow-on work, with the pilot operator procedure recorded in `docs/MILESTONE_2.md`.
- At the original local check, restarted frontend and API. Actual `/workspace` returned HTTP 200 and displayed the honest configuration-blocked sign-in state. `/v1/auth/session` reported `connectEnabled: false`; this was not a successful live login. The allowlist was empty then; the later production configuration explicitly includes operator GitHub ID `29710742`.

## Visual evidence

- `docs/preview-workspace-login.png`: actual production-build local sign-in screen, with GitHub setup still pending.
- `docs/preview-workspace.png`, `docs/preview-workspace-mobile.png`, and `docs/preview-workspace-mobile-proposal.png`: authenticated workspace using clearly synthetic browser-test data and mocked API/provider responses. The quoted $1,250 and date are fixture values, not a customer proposal.
- No native iOS Safari sign-in or mobile keyboard/device test has been performed.

## Independent reviews

- Staff Engineer: passes with no blocking code findings. Resolved overlapping-login revocation and same-browser private-inspection ownership findings. Independently reran all 33 backend tests. Its nonblocking intake-test validity note was corrected to use a valid Payments workflow, then all 13 workspace integration tests passed; cancellation wording now describes discarded results accurately.
- Product Owner: implementation passes with no blocking findings. Resolved expired-login PRD loss and retained acknowledgment on proposal revisions. Follow-on requests have a documented route; full in-flight contract changes and linked change orders remain deliberately outside scope.
- Product Designer: implementation passes with no remaining findings or deferrals. Resolved offscreen feedback, missing proposal jump action, and same-tab privacy navigation losing drafts.

## Required live closure for customer workspaces

1. Complete or recover GitHub App registration/configuration. If a previously opened registration outlives the temporary setup utility, check GitHub for an existing App before starting again; use `docs/GITHUB_SETUP.md` to configure that App rather than creating a duplicate.
2. Verify real GitHub sign-in, persistence after reload, sign-out denial, and identity-preserving repository reconnection. Configure the explicitly trusted operator's numeric GitHub ID in `OPERATOR_GITHUB_IDS` and restart the API.
3. Install the App on a selected private test repository. Link its pinned inventory to the customer's project, save a representative PRD, and submit for review. Verify unshared-repository rejection and that another signed-in account cannot retrieve/link that private evidence.
4. Publish a human review and proposal from the operator view; approve as the customer, publish build/verification updates, and confirm the customer's returning workspace and final handover. A revised proposal must require fresh approval.
5. Record live evidence, close the full milestone gates, and commit the milestone. No production deployment is included in Milestone 2. Payment collection is added and verified separately under Milestone 3 below.

# Milestone 3 implementation verification — October 6, 2026

The admin/conversation/agreement/payment/delivery implementation and all three independent implementation reviews pass. These entries record original local verification before the later [production deployment](DEPLOYMENT.md), passed GitHub login/private scan, and operator configuration. Full milestone/launch sign-off remains open for the live customer-project/second-account checks and a real Stripe sandbox Checkout/webhook round trip. No actual charge occurred. Milestone 2/3 changes remain uncommitted until those live gates close, unless the user requests a checkpoint.

## Verified implementation

- Backend lint, typecheck, production build, and **51 tests** pass. The dedicated real PostgreSQL suite includes tenant/operator isolation, private notes, owned/idempotent conversations and pagination, valid immutable payment schedules, current customer approval, upfront and three-installment delivery, payment-stage ordering, verified checklist work, and complete handover.
- Stripe provider responses are fixtures; webhook signatures use the real Stripe SDK and original raw body. Tests reject forged signatures, wrong mode, changed browser amounts, mismatched session metadata/amount/currency, unsigned return claims, and premature work. Duplicate events have one financial/timeline effect. Concurrent Checkout and uncertain creation reuse the same attempt; expired sessions/recovery/revisions are tested.
- Real SDK adapter contract tests compare identical Checkout creation parameters/idempotency keys across a lost response and clock change. Creation uses Stripe’s default 24-hour expiry. Paid session retrieval queries current disputes. Refunds are monotonic; active holds win across supplied sources, and clearing uses the earliest provider-observation timestamp fenced against the last committed attempt update. Signed-webhook tests reject conflicting or stale clearing after a newer hold.
- Test-mode balances cannot satisfy live delivery/task/later-installment gates, even after a credential-mode change. Customer payment payloads expose safe attempt mode/status fields without Checkout session/payment-intent identifiers or card data. The payment UI shows mismatches for team review. Separate test/live databases remain the documented deployment procedure.
- Additive migration 006 applies locally and in the test database. Existing proposals receive a single upfront installment; no historical payment is invented. No applied migration was rewritten.
- Frontend lint, typecheck, production build, and **44 browser checks** pass across desktop Chromium and a 390px mobile viewport. Final affected desktop/mobile checks also pass after the payment-mode predicate, return-copy, and fixture correction. Coverage includes customer→admin→review→deposit/final proposal→customer approval→deposit→building→evidenced Done task→verification→requested final installment→final payment→handover.
- Browser tests additionally exercise delayed Checkout confirmation, cancellation, no Pay while processing, mismatched test/live funds, failed saves, ambiguous message response with an edited retry, retained 51→52-message history, and incoming-message acknowledgment only after the row heading is visible in the viewport and internal list. These are mocked API/provider journeys, not actual GitHub/Stripe transactions.
- UI includes a payment-driven next action, visible save/error feedback, one-hour account/project-bound drafts, mobile navigation, protected admin queue, shared team unread marker, and private notes excluded from customer responses. Messages poll every 15 seconds while the page is open; no email notification or background settlement worker is implied.

## Independent reviews

- Staff Engineer: no blocking code findings remain; independently reran all 51 backend tests. Fixed unstable Checkout retry parameters, missing authoritative dispute refresh, clearing-race behavior, and test/live provenance.
- Product Owner: implementation accepted; independently verified eight focused desktop/mobile recovery/return/history checks. Fixed loaded-history loss, edited-draft conflicts after a lost response, Checkout return/processing states, and privacy/operational documentation. The lower-priority no-payment return-copy edge is also corrected to require an authoritative paid record for success text.
- Product Designer: implementation accepted with no remaining actionable findings. Fixed payment action hierarchy, oversized mobile admin navigation, unread acknowledgment of unseen messages, and send feedback placement. The screenshot fixture’s omitted billingMode was corrected; completed queue cards now assert zero outstanding.
- No code/product/design findings were consciously deferred. Live provider verification is a separate incomplete acceptance gate.

## Visual evidence and runtime

- `preview-delivery-customer.png` / `preview-delivery-customer-mobile.png`: synthetic authenticated customer workflow after completion. Values/dates are browser-test fixtures.
- `preview-delivery-admin.png` / `preview-delivery-admin-mobile.png`: synthetic authenticated admin queue; both agreed installments are recorded paid and the queue shows zero outstanding. No real money was collected.
- Restarted the production frontend and local API. Actual `/admin` and `/workspace` render successfully; API health is OK and `/v1/auth/session` reports `connectEnabled: false, account: null`.
- `preview-admin-login.png`: actual local production admin sign-in state, still blocked by missing GitHub setup. This does not prove operator login or live Stripe collection.
- Native iOS Safari and real mobile keyboard input have not been exercised. Deployed HTTPS was verified in the later [deployment checks](DEPLOYMENT.md); real provider authorization/payment verification remains open.

## Required live closure

1. Recover/configure the read-only GitHub App; check for an App created from the previously opened manifest before starting a duplicate registration. Verify sign-in, selected private repository access, unshared repository rejection, disconnect, and second-account isolation using `GITHUB_SETUP.md`.
2. Add the explicitly trusted operator’s numeric GitHub ID in `OPERATOR_GITHUB_IDS`, restart the API, and verify admin access as that account while a customer remains denied.
3. Configure Stripe server/signed-webhook sandbox credentials, restart the API, and perform the real customer/admin deposit/final journey in `STRIPE_SETUP.md`. Record nonsecret session/event evidence, duplicate-delivery results, cancellation/expiry/retry, and refund/dispute holds.
4. Record live results, close full milestone reviews, and create the dedicated milestone commit. Production deployment and real-money collection require their own authorized closure.

## Later production deployment and GitHub checks — October 6, 2026

The separate Railway project, dedicated PostgreSQL, Cloudflare HTTPS/DNS/www redirect, intake persistence, rate-limit spoof resistance, and daily volume backups pass. Backend checks now include 54 passing tests. All three independent deployment reviews pass with no blocking findings or new deferrals. [DEPLOYMENT.md](DEPLOYMENT.md) records the resources and operational evidence.

After explicit user approval, the registered m8itwork App was authorized and installed with read-only Contents/Metadata access on **only the selected private repository**. Real sign-in and reload persistence, private inspection pinned to independently verified HEAD with matching stack, disconnect denial, same-identity reconnect, operator desk access, and sign-out denial passed in the production browser. Private screenshots stay in ignored backend/var; tracked evidence excludes private source and file paths.

The earlier numbered live-closure lists describe the full acceptance scope. Registration, selected private scanning, login, disconnect/reconnect, and operator sign-in are now complete. Still open: live private inventory attached to an owned project with representative PRD/review/proposal, unshared-repository denial with a connected account, second-customer identity isolation/operator denial, confirmation of provider token-expiry settings, and the real Stripe sandbox payment/delivery round trip. Implementation tests cover these flows but do not substitute for that live evidence. Stripe remains disabled; no real payment was taken and no full Milestone 2/3 commit has been created.

## Customer dashboard and separate backoffice — October 6, 2026

The customer app now lands on `/dashboard`; the independently built admin app runs at `admin.m8itwork.com`. Growth AI's two-app structure is restored with shared UI and API. This feature passes backend lint/typecheck and all **56 tests**, frontend lint/typecheck and both production builds, and all **54 desktop/mobile browser checks**. Staff Engineer, Product Owner, and Product Designer reviews pass with no remaining findings or deferrals. Focused checks were repeated after the final payment-hold and mobile layout fixes.

All three Railway deployments succeeded. Live HTTPS checks passed for both pages and API health, query-preserving legacy redirects, anonymous customer/operator API denial, exact admin-origin credentialed CORS/preflight, and foreign-origin write denial. Real GitHub sign-out/sign-in from both apps returns to each intended destination. The allowlisted operator's customer dashboard stays a customer overview; the separate admin app loads the protected request queue. Actual authenticated screenshots stay in ignored `backend/var/preview-production-{dashboard,backoffice}-split.jpg`; tracked desktop/mobile dashboard screenshots are explicitly synthetic fixtures.

See [DASHBOARD_BACKOFFICE.md](DASHBOARD_BACKOFFICE.md) for acceptance, review evidence, resource IDs, and coordinated rollback. No production customer project/proposal or payment was created for this check. The full live project, second-customer, and Stripe sandbox gates above remain open.

## Authorized implementation checkpoint — October 6, 2026

The user requested a commit and deployment of the reviewed work, including the customer dashboard, separate backoffice, project conversation/agreement/delivery implementation, verified email/password and Google account flows, deployment setup, and the standalone Google brand icon. This is an implementation checkpoint; it does not claim full Milestone 2/3 or paid-pilot acceptance. Historical entries above describe their original checks and uncommitted state.

Final pre-commit verification passed: `make verify` completed backend/frontend lint, type checks, production builds and all **82 real-PostgreSQL backend tests**; the complete frontend suite passed **68 desktop/mobile checks**. Auth coverage includes challenge-bound signup credentials, one-time verification/reset, session rotation and cancellation, optional GitHub/demo-first entry, Google mailbox authority and identity linking, recovery-address changes, and tenant isolation. Independent Staff Engineer, Product Owner and Product Designer gates pass for the implementations and icon; the final checkpoint packaging/handoff review found no remaining blocker after the corrections below.

Packaging corrections: local backend Docker builds exclude ignored private `var` material; Docker Compose forwards Google/Resend configuration only to the backend. Parsed Compose configuration confirms these variables never enter frontend environment/build args. Git ignores credential files, private runtime evidence, dependencies, generated builds and browser traces; actual backend secret values were scanned across commit candidates with no matches. The icon exports are square 120px/512px PNGs under 1MB; their prompt and master are saved under `assets/branding`. Website favicons are unchanged, and a generated logo does not establish Google approval.

Auth and packaging behavior is described in [ACCOUNT_SIGNUP.md](ACCOUNT_SIGNUP.md). The nonblocking GitHub/reset lock-order deadlock remains consciously deferred: an independent probe failed closed, with reset succeeding and sessions revoked. All three reviews keep live provider acceptance separate from fixtures. Real email delivery/verification/reset and Google authorization/publication status remain unverified; full customer-project/second-customer acceptance and Stripe sandbox Checkout/webhooks remain open. Stripe is disabled and no real money has been collected.

Deployment uses source archived from the new checkpoint commit, with that revision attached to each API/customer/admin Railway deployment. The final release handoff records the exact hash and successful deployment IDs. Deployment rollback uses a prior compatible app revision; no destructive database migration is needed for this checkpoint.
