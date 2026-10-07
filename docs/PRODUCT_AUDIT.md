# m8itwork product readiness audit

m8itwork has a coherent foundation for a manually operated service that finishes, fixes, and extends existing apps. It is not ready for a paid pilot sign-off: the audit found a payment event race, several reproducible recovery and navigation defects, and missing workflows for cancellation, updated repository reviews, and customer follow-up. The next milestone should complete these journeys before expanding the feature set.

Audit date: October 7, 2026. Application revision: `433e3ec`, including the account closure implementation at `d6a492a`. This audit records findings; it does not change or deploy application behavior.

## Feature coverage

| Area | Implemented | Remaining completion work |
| --- | --- | --- |
| Website and intake | Original workshop theme, finish/fix/extend positioning, repository plus request intake, private GitHub App access | Clear acknowledgment and response expectations; resolve documentation that still describes the old demo-first intake |
| Customer identity | Email signup and verification, password recovery, Google and GitHub sign-in, customer dashboard, account settings and closure | Complete real email verification/reset and a second-customer isolation check; improve signed-in auth pages and route consistency |
| Repository review | Read-only inspection, pinned commit, bounded source sample, human review publication | Allow an explicitly approved new repository snapshot for an existing project; retain the previous evidence |
| Agent operations | Docker worker, scoped pairing, polling and leases, provider status, private review sessions, follow-up prompts, Codex device login, handoffs and comparison grouping | Real Claude authentication/comparison is deferred by user choice; complete a human remote-login round trip on a fresh host before promising that installation path |
| Scope and agreement | Versioned proposals, acceptance checks, cost, estimated date, assumptions, human publication and customer approval | Explicit decline, withdrawal and cancellation/settlement; explain defect repair and aftercare separately from new paid scope |
| Payments | Stripe-hosted card setup/removal, upfront or staged Checkout, account-wide Billing, receipts/invoices, payment gates and refund/dispute reconciliation | Fix the event race below; complete the actual sandbox deposit/final/webhook journey; activate the merchant and dedicated live configuration before real charges |
| Delivery | Operator work items, checks/evidence links, progress, verification and handover summary | Define customer acceptance and aftercare; make the completed journey visually complete |
| Communication | Per-project conversation, private team notes, unread indicators and polling | Notifications outside the open dashboard, reliable conversation recovery, response ownership |
| Operations | Separate Railway customer/admin/API services, tenant checks, origin controls, Docker isolation, migration backups and rollback notes | Verify restore/recovery, establish failure alerts and routine cleanup, consolidate current readiness evidence |

Private agent reviews are preliminary planning support. They sample source and do not execute customer code or tests. Development, publication, pricing and delivery remain human decisions. Automated code editing, more providers and subscriptions are not prerequisites for the first paying client.

## Confirmed defects

P1 is a release blocker for payment collection. P2 findings affect ordinary customer or operator journeys and should be resolved in the completion milestone. P3 items are consistency polish or defensive hardening.

### A1 P1 Refund events can be lost before the payment is linked

[payments.ts:576](/Users/tinche/Documents/ChatGPT/m8itwork/backend/src/payments.ts:576) resolves refunds and disputes only through the saved payment-intent ID. When that mapping does not exist yet, the handler returns success without retaining the relevant event.

A deterministic probe on dedicated PostgreSQL paused the original Checkout completion after retrieving a paid provider snapshot but before saving its payment-intent mapping. A signed full-refund event arrived during that pause and received HTTP 200 without being recorded. Resuming the older snapshot left the attempt paid with zero recorded refund; advancing the project to Building returned HTTP 200. This is a reproduced application race, not an observed production transaction. Stripe explicitly allows events to arrive out of order. [Stripe event delivery guidance](https://docs.stripe.com/webhooks#event-ordering).

Durably retain relevant unresolved events, resolve their application identity and reconcile them after mapping. Add the exact mapping race for refunds and disputes, including replay, to the regression suite. Work gates must remain closed until the current financial state is known.

### A2 P2 A lost response can create duplicate customer requests

[RequestForm:201](/Users/tinche/Documents/ChatGPT/m8itwork/frontend/packages/ui/src/components/workspace-forms.tsx:201) sends a project version without a stable request ID. [workspace.ts:391](/Users/tinche/Documents/ChatGPT/m8itwork/backend/src/workspace.ts:391) creates a new request each time a valid version is submitted.

The database probe confirmed this sequence: first submission commits; retry with the old version is rejected; Refresh obtains the new version; resending the retained form creates a second request and timeline entry. Use a caller-generated UUID with an exact-payload idempotency check, as messages and delivery items already do. Keep uncertain-save feedback and edited retries distinct.

### A3 P2 Browser history skips the project overview

[workspace.tsx:127](/Users/tinche/Documents/ChatGPT/m8itwork/frontend/packages/ui/src/components/workspace.tsx:127) replaces browser history when selecting a project and does not restore project selection from Back/Forward. Desktop and mobile probes confirmed homepage → dashboard → project → Back returns to the homepage.

Use routable project links and history entries for navigation, including Back/Forward restoration and opening another tab. Keep history replacement for removing completed callback parameters.

### A4 P2 Primary link buttons lose readable text on hover

[portal.css:63](/Users/tinche/Documents/ChatGPT/m8itwork/frontend/packages/ui/src/styles/portal.css:63) gives every hovered anchor mint text, overriding the dark text of copper primary buttons. Runtime captures confirmed this on Continue with Google and Review proposal. Settled hover contrast is approximately 1.3:1.

Preserve dark text with one shared primary-anchor rule and verify default, hover, focus and disabled states across auth, project and billing actions.

### A5 P2 Conversation recovery leaves stale failure feedback

[project-conversation.tsx:47](/Users/tinche/Documents/ChatGPT/m8itwork/frontend/packages/ui/src/components/project-conversation.tsx:47) routes a failed initial load to the parent error while continuing to show Loading conversation. A successful Refresh later displays recovered messages alongside the old failure. Both states were reproduced on desktop and mobile.

Give conversation loading, failure, retry and refresh their own state. Clear the conversation's error after success while preserving unrelated failures and escalating authentication expiry.

### A6 P2 The operator stage menu offers rejected transitions

[workspace-forms.tsx:597](/Users/tinche/Documents/ChatGPT/m8itwork/frontend/packages/ui/src/components/workspace-forms.tsx:597) exposes all stage labels, including Closed, while [workspace.ts:612](/Users/tinche/Documents/ChatGPT/m8itwork/backend/src/workspace.ts:612) excludes Closed and restricts progression. The runtime menu confirms the invalid option.

Offer the current stage and valid next stages, explain payment/approval/work-item blocks, and keep cancellation in a dedicated workflow. Preserve server enforcement.

## Essential missing workflows

### B1 Withdraw decline and settle projects

There is no supported terminal path for a bad-fit submission or abandoned agreement. [Progress transitions](/Users/tinche/Documents/ChatGPT/m8itwork/backend/src/workspace.ts:621) advance through building and verification; account closure instead tells customers with agreed work to contact support. [Closure checks](/Users/tinche/Documents/ChatGPT/m8itwork/backend/src/account-closure.ts:89) keep an approved unfinished project blocked, including historical approval retained after an unpaid proposal revision.

Add customer withdrawal before agreement and an explicit operator decline/cancellation process. Approved work needs recorded settlement, conclusive payment state and preserved agreement history. Refund decisions remain deliberate financial actions. Support must be able to resolve a cancellation without editing the database or falsely marking work complete.

### B2 Review updated code on an existing project

[workspace.ts:331](/Users/tinche/Documents/ChatGPT/m8itwork/backend/src/workspace.ts:331) accepts a repository snapshot only while the project is Draft. New intake starts in Review, so an existing project cannot update its saved commit. Adding a request, as the error suggests, does not update the worker's source baseline.

Add an explicit refresh/re-review action that inspects a new commit, shows what baseline will change and preserves earlier reports. Distinguish clarification against the original commit from a new review against updated source. Proposal changes still require human review and agreement.

### B3 Notify customers and operators outside the dashboard

[Conversation polling](/Users/tinche/Documents/ChatGPT/m8itwork/frontend/packages/ui/src/components/project-conversation.tsx:303) works only while the page is open and explicitly has no email notifications. [Account email](/Users/tinche/Documents/ChatGPT/m8itwork/backend/src/account-email.ts:22) currently covers verification/reset only. A customer can miss the review or proposal unless they return voluntarily.

Provide request acknowledgment, new-message, proposal-ready and handover notifications with account preferences, deduplication and delivery/retry status. Give the operator actionable alerts for new requests and failed or stalled workers. GitHub-only accounts need a verified notification destination or an explicit alternative. Show a realistic response window and the next expected action after submission.

### B4 Distinguish agreed-work defects from new scope

[RequestForm:256](/Users/tinche/Documents/ChatGPT/m8itwork/frontend/packages/ui/src/components/workspace-forms.tsx:256) describes requests during Building, Verifying and Complete as separately scoped follow-on work. An agreed acceptance check failing is different from a new feature.

Record whether a request reports an agreed-work defect, asks for clarification or adds scope. Define acceptance, handover contents, included defect handling and the aftercare window in the proposal and delivery process. A reusable proposal template should also explain external costs, customer access/responsibilities, cancellation and ownership of the delivered work. Handover should contain accessible change/deployment links, verification results, operating instructions and known limitations. A customer should understand how to raise a failed check without assuming another project charge. Manual customer acceptance recorded in the conversation can support the pilot; a dedicated sign-off screen can follow later.

## Consistency and later improvements

| Priority | Finding | Change |
| --- | --- | --- |
| P3 | [Standalone auth](/Users/tinche/Documents/ChatGPT/m8itwork/frontend/packages/ui/src/components/customer-auth.tsx:75) shows full login to a signed-in customer, lacks an h1/skip link, and changes form mode without updating its URL | Add account-aware continuation, proper page semantics and route navigation |
| P3 | [Dashboard logo](/Users/tinche/Documents/ChatGPT/m8itwork/frontend/packages/ui/src/components/workspace.tsx:396) goes to the website while Account/Billing logos go to Dashboard | Share the customer shell, destination and active navigation treatment |
| P3 | [Privacy copy](/Users/tinche/Documents/ChatGPT/m8itwork/frontend/apps/customer/src/app/privacy/page.tsx:150) mixes old 24-hour and current one-hour draft retention and returns to a public brief section | Clarify legacy/current retention and use accurate return navigation |
| P3 | [Complete stage](/Users/tinche/Documents/ChatGPT/m8itwork/frontend/packages/ui/src/components/workspace.tsx:1048) still presents Build & verify as active | Mark the journey finished with handover state |
| P3 | [Operator next actions](/Users/tinche/Documents/ChatGPT/m8itwork/frontend/packages/ui/src/components/workspace.tsx:679) reuse customer instructions; operator forms always open on review, including delivery stages | Derive the action and wording from both role and project stage |
| P3 | [Operator payment summary](/Users/tinche/Documents/ChatGPT/m8itwork/frontend/packages/ui/src/components/admin-overview.tsx:90) uses a weaker predicate than customer payment warnings | Share financial display rules and label paid, held and future installments distinctly |

The payment-summary discrepancy was reproduced with constructed overpayment/refund data whose net equals the installment amount. Engineering inspection found that particular amount cannot arise through the current validated Checkout/replacement flow. It is defensive consistency work, not evidence of a current financial corruption path. The independently reproduced lost-refund race in A1 is a release blocker.

Mobile project pages can be easier to scan by prioritizing the current stage and collapsing secondary history/forms. The existing proposal/payment anchors provide a workable next action, so this is polish. Search by verified email, queue ownership, pagination beyond 100 projects, attachments, profile editing, customer organizations, richer analytics and operator roles can follow demand. The current Codex review path can support the pilot while Claude remains deferred. Automated customer-code edits need a separate design and permission model.

## Launch acceptance and operations

The live Account and Billing screens still identify Stripe test mode. Card setup open/cancel has been verified; completed card save/removal and the real Stripe deposit/final/webhook/delivery round trip remain separate checks. The [deployment record](/Users/tinche/Documents/ChatGPT/m8itwork/docs/DEPLOYMENT.md:216) also requires merchant activation and dedicated live configuration before collecting customer money.

Complete one controlled customer journey through email signup/verification or Google sign-in, selected private repository access, request, review, approved proposal, staged sandbox payments, actual webhook reconciliation, delivery evidence and handover. Repeat access checks with a separate customer and an unshared repository. Confirm Google publication/branding and real reset-email delivery separately from a connected-account flag. The worker's remote login on a fresh host and authenticated Claude comparison remain distinct from local cached Codex readiness.

[Operations notes](/Users/tinche/Documents/ChatGPT/m8itwork/docs/DEPLOYMENT.md:69) still describe manual cleanup and [unverified restore recovery](/Users/tinche/Documents/ChatGPT/m8itwork/docs/DEPLOYMENT.md:80). Establish who reviews the queue, handles provider/payment failures, performs cleanup and responds to customers. Verify restoring a backup in an isolated environment and document recovery without reopening closed accounts. Before reopening payments after a restore, reconcile provider transactions that occurred after the snapshot; Stripe can retain a charge whose application mapping was lost in the restore. Keep an actionable alert path for API failure, pending financial reconciliation and stale worker heartbeats; a status page alone requires someone to notice it.

## Completion sequence

1. **Correctness:** fix A1, A2 and A6, with meaningful regressions; add withdrawal/decline and settlement so normal support requests have a resolution.
2. **Customer continuity:** fix history, hover and conversation recovery; add refreshed review baselines, notifications and clear acknowledgment/response expectations.
3. **Commercial delivery:** define defect handling, acceptance and handover, then complete the controlled real-provider sandbox journey and recovery checks.
4. **Paid pilot:** activate live collection only after the above gates pass. Operate one real scoped engagement, measuring submission-to-review, proposal acceptance, payment confirmation and successful delivery.
5. **Polish and expansion:** consolidate shells/copy and prioritize later features using the first customer experience.

Completion means a customer can submit a repository, understand and approve the work, pay, follow progress, receive verified delivery, get a response to a defect, and leave or cancel through supported paths. The operator must be able to handle failures and settle exceptions without database surgery.

## Verification and review outcome

The independent engineering audit reran all 165 backend tests on dedicated PostgreSQL successfully and added deterministic probes for refund ordering, request retries, blocked repository refresh and terminal-project handling. All synthetic database records were cleaned. Production dependency audits reported zero known vulnerabilities for backend, frontend and worker dependencies at audit time.

The complete existing browser suite passed all 198 desktop/mobile checks without retries in a fresh run. Eight additional desktop/mobile diagnostic checks reproduced the navigation, hover, signed-in-auth, invalid-stage and conversation-recovery findings. Those temporary diagnostic probes intentionally observed existing defects; they are not proof of fixes. Passing the existing suites does not close the newly identified gaps.

Read-only production checks confirmed API health, a running Docker worker, authenticated Account/Billing, visible sandbox labeling and a 390px Account layout without horizontal overflow or visible native select/date controls. Operator and populated project states use synthetic browser fixtures. No production customer request, message, agreement, payment, provider permission or account was changed.

Staff Engineer, Senior Product Owner and Senior Product Designer reviewed the whole product independently. Their outcome is to hold a paid-pilot/customer-ready claim until the applicable defects, essential operating workflows and live acceptance gates are closed. Earlier feature-specific review passes remain evidence for their narrower milestones.

The engineering review found no new authentication bypass, tenant-isolation failure or credential exposure. This scope does not replace the remaining real second-account/private-access checks or a full security assessment.

Audit captures are local and ignored under `backend/var/audit-*.png`; project/auth captures are synthetic and live Account/Billing captures remain private. Native iOS Safari, real mobile keyboards and a production financial transaction are not covered by the Chromium fixture results.

## Completion implementation — October 7, 2026

The original audit above describes revision `433e3ec`; its source line references and observed defects are historical. The user authorized the completion implementation and senior engineering preference. This record distinguishes implemented local behavior from deployment and external provider acceptance.

| Finding | Implemented resolution |
| --- | --- |
| A1 | Signed relevant Stripe events are durably ingested before acknowledgment. Unmapped/reordered refunds and disputes retry; current SDK reconciliation preserves financial holds and cannot unlock work from an older paid snapshot. |
| A2 | Added requests use caller-owned operation IDs, exact retry acknowledgment and conflict checks. Draft/reload/reauthentication recovery prevents duplicate requests and preserves edited intentions. |
| A3–A6 | Semantic project links support Back/Forward and new tabs; filled-action hover contrast is corrected; conversation failures/retries clear locally; operator menus offer valid stage transitions and refreshed forms follow the current stage. |
| B1 | Customer withdrawal/operator decline, agreed cancellation pause, written settlement/customer acceptance, conclusive financial settlement and both-party resumption are supported. Historical scope/finances remain; no automatic refund or fake completion. |
| B2 | An eligible customer can inspect and explicitly refresh the same repository baseline. Commit history/reviews remain; stale jobs/proposals retire; agreed scope stays immutable. |
| B3 | Transactional notification outbox, verified destinations independent of sign-in, project/operator preferences, stable delivery idempotency, bounded retries and actionable Operations incidents are implemented. Verification intent survives sign-in without exposing tokens in API queries. |
| B4 | Defect/clarification/addition purpose, human aftercare triage, versioned commercial conditions, actual artifact/check/instruction/deployment handover and separate customer acceptance are implemented. New structured completed agreements require handover publication before account closure. |
| P3 consistency | Customer navigation/auth routes, h1/skip semantics, completed journey, role-aware next actions, mobile commercial hierarchy, common financial summaries, checkbox/dialog styling and accurate privacy retention are corrected. Closed-account support history includes conditions, handover/acceptance and settlement amounts. |
| Operations | Minute event/alert processing, hourly cleanup, protected recovery controls, account/financial fences, encrypted logical backup and isolated restoration/provider discovery are implemented and tested. Tin owns the pilot review/response queue, with a configurable two-working-day initial response aim. |

All applicable Staff Engineer, Senior Product Owner and Senior Product Designer review findings were addressed; final gate results and exact regression counts are recorded in [LAUNCH_COMPLETION.md](LAUNCH_COMPLETION.md). The actual encrypted PostgreSQL restore/provider-discovery drill passed as documented in [OPERATIONS_RECOVERY.md](OPERATIONS_RECOVERY.md). No production database was replaced and no money was charged.

The future features listed in the original audit remain demand-led: automated customer-code edits, subscriptions, organizations, attachments, broader roles and analytics are outside this completion milestone. Claude authentication/comparison remains deliberately deferred until the user obtains its subscription.

### Remaining external acceptance and operating gates

These are not satisfied by fixtures, configured keys, cached authentication or the local implementation:

- Actual verification/reset email receipt and link completion using a separate controlled account. A request to send test emails to the owner's Gmail alias remains awaiting explicit approval; the owner's existing password/account is untouched.
- Google branding/publication and a fresh human sign-in; a separate real customer with denial of an unshared private repository.
- Completed sandbox saved-card add/remove, deposit and final payment with actual provider webhook reconciliation, delivery and handover. No live payment is authorized by passing this milestone.
- Fresh human remote worker device login; Claude subscription acceptance remains deferred by user choice.
- Independent encrypted backup scheduling, storage retention/recovery-point objective and an external outage alert destination/provider. The implemented in-process alerts cannot report an API outage while that API is stopped.
- Merchant activation and dedicated live configuration before collecting customer money.

The implementation milestone does not claim paid-pilot readiness or that these changes are already deployed. Current deployed revision and eventual rollout evidence belong in [DEPLOYMENT.md](DEPLOYMENT.md).
