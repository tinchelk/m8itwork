# Repository and request intake

Latest user direction: starting a project asks for only a connected GitHub repository and what the customer wants to fix, add, or take forward. This replaces demo-first/manual onboarding for new projects; existing accounts and projects remain available.

Outcome: a signed-in customer connects the read-only GitHub App, selects a repository, writes their request, and sends it straight to the operator's review queue in one submission.

In scope: two visible inputs; account-scoped draft recovery across GitHub authorization; loading, missing installation, connection failure and save failure recovery; automatic static inspection; server-derived project name and account contact; atomic project creation in IN_REVIEW; existing backoffice conversation and proposal workflow. An unavailable email is stored as an empty contact string and omitted from Stripe's email prefill, allowing Checkout to collect it later.

Excluded: additional project name, contact, builder/platform, demo, access-note and workflow questions; a separate inspection button or second submission; new OAuth permissions; autonomous source changes; automatically fetching demo URLs. Legacy API payloads and existing draft projects remain supported.

Acceptance:

- New-project UI shows repository selection and one request textarea. No additional customer information or checkbox is required; a concise submission/access notice links to existing privacy terms.
- GitHub-only and email/Google customers use the same flow. Email/Google signup does not itself connect GitHub. Connection chooses selected repositories with existing read-only permissions.
- Returning from GitHub resumes this account's new-project form and request; another account cannot recover it. Unavailable or expired access asks for reconnection and does not create a project.
- Submission inspects the selected repository, then creates one owned project and its review-queue entry atomically. Project name comes from the verified repository, contact from the authenticated account, platform is recorded as GitHub. No contact address is invented.
- Errors retain repository selection and request; retrying a successful request whose response was lost does not create duplicate projects. Foreign or cleared inspections cannot be attached.
- Customer sees review underway, with the original request and repository; backoffice sees the same request and can reply. No binding ETA/cost or started development is implied.
- Public website leads to the same dashboard flow; the old long manual brief is removed from the website.

Verification: real PostgreSQL integration checks for automatic metadata, atomic state, idempotency and inspection ownership/liveness; desktop/mobile browser checks for the two-input flow, connector return, retry, missing access, and operator visibility; lint/typecheck/build; independent Staff Engineer, Product Owner and Product Designer reviews. Live provider authorization/Stripe checks remain separate from fixture verification.

## Final implementation verification — October 6, 2026

`make verify` passed backend/frontend lint, type checks, production builds and all **89 real-PostgreSQL backend tests**. The complete frontend suite passed **66 desktop/mobile checks**. Coverage includes automatic review submission and backoffice visibility, account-bound connection return, expired/revoked credentials, missing installation, retained inputs, concurrent unchanged retries, and an edited retry after a lost response. The latter preserves the edit and links to the saved request rather than silently losing changes. Repository selection and the truncated-list fallback cannot disagree.

All three independent gates pass. Staff Engineer independently passed 24 PostgreSQL/Stripe adapter tests and four desktop/mobile recovery checks, with no blocking code findings. Product Owner accepts the flow for this milestone. Product Designer accepts desktop/mobile layout, input/error focus, and repo-choice clarity with no remaining findings. No new findings are consciously deferred. Existing live-provider, second-customer and Stripe acceptance gates remain separate; no live customer request or payment was created by these fixture checks.

`preview-simple-project-desktop.png` and `preview-simple-project-mobile.png` are synthetic browser-test evidence. They contain fixture accounts and repositories, not actual customer data. Deployment uses source archived from the milestone commit and coordinates API, customer and backoffice revisions. No schema migration is required; rollback uses the prior compatible application revisions.

## Production verification

Implementation checkpoint `84fdfd0dcd542482122d45eab52a724275bf5ac3` passed GitHub CI run `37566042281`. Its archived source deployed successfully to the API (`e64cc4fa-6fd6-4050-98bd-8e8fdb15cf0d`), customer (`1d1ef2fe-b0c4-4ced-b7ad-20d98ee1e5b3`) and admin (`221b2aac-e7a8-4195-925d-31461702713c`) Railway services. Public HTTPS pages and API health pass; signed-out customer/operator endpoints return 401 and a foreign-origin write returns 403.

The authenticated production dashboard visibly shows only GitHub repository and the request textarea; the website links to `/dashboard?start=1`. No real project was submitted for this read-only check. The live screenshot remains ignored under `backend/var/preview-production-simple-intake.png`.

A final scoped stylesheet correction gives Connect/Reconnect GitHub readable light text over its teal background. The designer re-review passes at 8.72:1 normal and 6.60:1 hover contrast, preserving focus styling. Frontend lint, types, both builds and six affected desktop/mobile connection-recovery checks pass after this correction. The final frontend release revision is recorded in the release handoff; backend source is unchanged from `84fdfd0`.
