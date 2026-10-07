# Launch completion milestone

## Outcome and scope

Complete the implementation work in `PRODUCT_AUDIT.md`: safe financial reconciliation and retry recovery; consistent customer/operator navigation and states; withdrawal/decline/settlement; versioned repository refresh; durable project notifications and notification preferences; defect triage, proposal conditions and useful handover; operational alerts, cleanup and recovery tooling. Preserve the two-input intake and human approval of work, price and publication.

The user explicitly authorized this milestone on October 7, 2026. Apply senior engineering judgment and the repository's three independent review gates. Later expansion ideas (autonomous code edits, subscriptions, organizations and broader analytics) remain distinct from completion work. Claude subscription authentication remains dependent on the user obtaining its subscription.

## Acceptance criteria

- Early, duplicate and reordered refund/dispute events are durable and cannot incorrectly unlock paid work. Unresolved financial events hold work until reconciled.
- Added requests acknowledge exact retries, reject edited retries under the same operation ID and survive reload/account reauthentication without duplicates or cross-account leakage.
- Browser Back/Forward and open-in-new-tab restore the correct project/overview; customer headers, auth routes, primary actions, completed stages and conversation recovery are coherent and keyboard usable on desktop/mobile.
- Customer withdrawal and operator decline are available before agreement. Agreed cancellation is an explicit, audited settlement with conclusive financial state; account closure can complete after settlement, without fake completion or database edits. No automatic refund is performed.
- Customers can explicitly refresh an eligible project's same-repository baseline. History is retained; old reviews/jobs/proposals cannot be imported or approved as current after the refresh. Agreed scope remains immutable.
- A transactional outbox records request acknowledgment, relevant replies/proposals/payment-action/handover events, deduplicates delivery and exposes retry failures to operators. Account preferences and verified notification destinations are respected. Closed accounts stop nonfinancial mail.
- Requests distinguish failures of agreed checks from additions. Operator triage, structured proposal conditions and handover evidence explain responsibility, costs, ownership, cancellation, acceptance and included aftercare.
- Operator operations show actionable unresolved financial events, failed/stale workers and failed notification delivery. Routine processing/cleanup is scheduled within the backend; recovery tooling supports an isolated restore and provider reconciliation before writes reopen.
- Regression tests use dedicated PostgreSQL and synthetic fixtures. Lint, types, builds, backend/browser/container checks and independent Staff/Product/Designer reviews pass before the milestone commit.
- Real-provider acceptance has explicit nonsecret evidence: selected private access and second identity denial; actual email verification/reset; Google publication/branding; sandbox card/payment/webhook/handover; fresh worker remote login. Merchant activation/live credentials, human account actions and Claude subscription are reported separately if they need user action.

## Implementation order

1. Financial event durability, request idempotency and domain lifecycle foundations.
2. Repository revisions, customer/operator lifecycle UI, defect triage and handover conditions.
3. Durable notifications, preferences, response expectations and operator operations.
4. Navigation/auth/visual consistency, mobile hierarchy and accessibility.
5. Recovery/provider acceptance, full verification, independent reviews and milestone commit.

## Progress

Implementation and final verification are recorded below. See PRODUCT_AUDIT.md for the original audit and the explicit external acceptance/operating gates. This milestone is distinct from paid-pilot sign-off.

## Final verification and independent review

- **183 tests across 18 backend files pass** on dedicated PostgreSQL, without file-level parallelism. Coverage includes refund/mapping ordering, pending SDK snapshots, requests/tenant idempotency, cancellation/settlement/resumption, aftercare/handover, account closure, slow-email/closure fencing, incident deduplication and isolated recovery identity/merchant boundaries. Explicit concurrency tests remain concurrent within their files.
- **226 desktop/mobile browser checks pass without retries.** New checks cover history/new tabs, conversation failure, lost request replies/reload, committed withdrawal with lost replies and both dismissal paths, repository recheck failure, historical/closed agreements, handover acceptance, settlement acknowledgment, notification preference/verification return and operational errors.
- Backend and both web apps pass lint, typechecks and production builds. `git diff --check` passes. Production dependency audits report zero known vulnerabilities for backend, frontend and worker at verification time.
- The standalone Docker worker build succeeds; **all seven container checks pass**, including non-root/read-only isolation, private pairing, queue/provider failures, process locking/shutdown and synthetic remote reconnect. Its existing image remains the same because this milestone does not change worker runtime source. Cached subscription state and synthetic reconnect checks do not establish fresh human-provider login acceptance.
- The actual encrypted PostgreSQL isolated restore drill passes, preserving post-snapshot closure fences and business history, revoking stale credentials, and discovering a real uncharged post-snapshot sandbox Checkout whose missing mapping correctly blocks reopening. See OPERATIONS_RECOVERY.md. The production database was untouched.
- Independent **Staff Engineer, Senior Product Owner and Senior Product Designer gates pass** for this implementation milestone. All valid findings were fixed and rechecked; no implementation/design review finding is consciously deferred. Reviewer acceptance remains scoped to locally verified implementation, not external paid-pilot approval.

## Deployment and remaining acceptance

The source changes are ready for the reviewed milestone commit. They have not been deployed in this work session. Six additive migrations (015–020) must precede the web rollout, with a verified production backup. Once new closure/identity fences exist, retain them in any rollback; prefer a forward fix. Do not restore an older API that ignores the security fences.

The original audit's external provider and operating gates remain open as listed in PRODUCT_AUDIT.md: approved real-email receipt/link completion, Google publication, second real customer/private denial, full sandbox saved-card/staged payment/webhook/handover, fresh human worker login, independent backup scheduling/outage alerts and merchant live activation. They require the owner/provider identity or an operating destination. The user's existing account/password and production data were left intact. This is an implementation completion milestone; it does not claim the paid pilot is ready.
