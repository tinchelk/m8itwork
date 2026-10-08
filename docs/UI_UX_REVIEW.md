# Customer and backoffice experience review

The customer app should feel like a clear place to request work and follow its progress. The backoffice should feel like a separate place to review requests and operate the service. This review covers both apps, including desktop and mobile navigation, authentication, intake, project progress, proposals, conversations, billing, delivery, account settings, workers, and operations.

## Current milestone

Outcome: remove customer and team interface mixing, make the sign-in choices consistent, and identify the remaining changes that will make the product easier to understand and operate.

In scope: the two reported navigation and sign-in defects; small verified consistency, recovery, and accessibility defects discovered in this review; a prioritized design handoff grounded in source and rendered interfaces.

Outside this milestone: a new visual identity, changes to agreed commercial terms or payment behavior, autonomous code editing, and unrequested live email, payment, or account actions. Broader project-page and backoffice redesign recommendations will be identified explicitly.

Acceptance:

- The customer app never advertises Backoffice, including for a team member using a customer account. The separate protected admin app remains available at its own origin.
- Google and GitHub sign-in use matching full-width buttons, spacing, focus, and touch targets without changing their authentication permissions.
- Customer account settings contain customer preferences. Team preferences belong in the admin app.
- Authentication retains validated customer return destinations across email and social sign-in, without arbitrary redirect support.
- Any additional defect fixed here has a focused behavioral regression check.
- Long conversation history has a named keyboard scrolling target and short incoming-message announcements. Returning to the customer overview restores visible focus.
- Request, conversation, delivery-item, and internal-note fields cannot accept new edits during a pending save that will clear the acknowledged draft.
- A deep review records actionable findings, affected locations, priorities, recommended changes, and remaining evidence limits.

Verification: production read-only visual review; local synthetic desktop and mobile journeys for stateful flows; proportionate automated browser checks, lint, type checks, and builds; independent Staff Engineer, Product Owner, and Designer reviews of the completed change.

## Review findings

Reviewed on 8 October 2026. The navy, teal, copper, and workshop illustration already provide a distinct visual identity. The primary problems are inconsistent application boundaries, crowded information hierarchy, and recovery or status wording that does not match the underlying state. Keep the visual identity; make the task hierarchy and feedback more precise.

### Fixed in this cleanup

- `workspace.tsx:506`, `customer-navigation.tsx:3`, `customer-page.tsx:125` — Customer Dashboard, Billing, and Account share the same customer-only navigation, identity ordering, active-page indicator, keyboard focus, and touch targets. Backoffice remains a separate protected app at `admin.m8itwork.com`.
- `customer-auth.tsx:230`, `portal.css:58` — Google and GitHub use matching full-width copper buttons with a 12px gap. Provider choices retain their original endpoints. The email divider disappears when no provider is available, and sign-in spacing no longer inherits oversized button margins.
- `notification-settings.tsx:20`, `workspace.tsx:1411` — Customer settings show project updates; team alerts are in the backoffice under Team email notifications. Updating either preference preserves the other.
- `customer-return.ts:4`, `customer-auth.tsx:117` — Email and social sign-in use the same validated destination builder. Project UUIDs, supported Checkout return markers, account/billing destinations, and start-project intent survive sign-in. Stored external or malformed destinations are ignored.
- `workspace.tsx:451`, `customer-dashboard.tsx:37` — Returning to the customer overview moves keyboard focus to its heading instead of leaving it in the mobile sidebar that disappears.
- `project-conversation.tsx:198`, `portal.css:316` — Conversation history has a named, focusable scrolling region and short polite incoming-message announcements. History retains list semantics; keyboard users can scroll and leave the region normally.
- `workspace-forms.tsx:405`, `project-conversation.tsx:305`, `project-delivery.tsx:146` — Request, message, delivery-item, and team-note controls lock during a save that will clear the submitted draft. Delayed responses cannot silently discard text typed after submission.
- `workspace.tsx:1055` — Repository disconnect is available under the project's GitHub connection settings, with its browser-session access impact explained. It no longer occupies global customer navigation. Account also provides connection settings before the first project exists, and makes other browser sessions’ retained access explicit.

### Remaining priority defects

P2 findings should be resolved before presenting the affected journeys as ready for paid customers. These were identified in the existing product and remain open; this cleanup does not change financial or delivery behavior.

| Priority | Location | Finding | Recommended change and acceptance |
| --- | --- | --- | --- |
| P2 | `account-cards.tsx:249`, `account-cards.tsx:427` | A card removal can succeed while its response or subsequent refresh fails. The remaining dialog still offers Keep card, then dismisses without reconciling card status. | Once removal is attempted, use neutral Close and check status. Reconcile the authoritative list after dismissal. Verify a committed removal followed by a lost response and by a failed list refresh. |
| P2 | `workspace.tsx:118`, `customer-dashboard.tsx:50`, `workspace-types.ts:18` | Complete means verification finished, but the overview counts it as completed before handover publication or customer acceptance; the operator banner still asks to prepare handover after acceptance. | Project list responses should include safe handover/acceptance metadata. Share presentation for verification finished, handover ready, and delivery accepted. Give a ready handover a primary review action. Verify all three states in overview and detail. |
| P2 | `workspace.tsx:917`, `project-completion.tsx:680`, `backend/src/workspace.ts:420` | Accepted-delivery copy says aftercare remains available even when the agreed window is zero or has ended. | Derive the deadline from the approved terms and handover publication time. Show active, ended, absent, or unknown terms accurately. Preserve a route to human assessment and additional work without automatic charges. Verify zero-day and expired windows as well as active aftercare. |
| P2 | `review-assistant.tsx:200` | Successful worker polling does not clear earlier load errors; readiness time advances only on successful loads, so a failed connection can leave Online/Ready frozen beside an error. | Separate action and load errors. Age freshness independently and label cached/unavailable status. Verify successful polling recovery and outage beyond the heartbeat threshold. |
| P2 | `review-assistant.tsx:200`, `operations-panel.tsx:44` | Worker setup and Operations catch expired-session errors locally while retaining cached controls, without the surrounding backoffice sign-in recovery. | Propagate authorization expiry to a common sign-in state, suspend privileged actions and polling, and retain recoverable intent. Verify expiry during polling and an action, then sign-in recovery. |
| P2 | `workspace-forms.tsx:535`, `review-assistant.tsx:192`, `review-comparison.tsx:61` | AI draft-import actions remain enabled in BUILDING/VERIFYING/COMPLETE, where the forced Progress editor cannot accept the import. | Gate imports by available editors and explain the restriction. Follow-up conversations may remain available. Verify both standalone and comparison actions in active delivery; do not silently alter the agreed scope. |
| P2 | `customer-billing.tsx:111`, `customer-billing.tsx:377` | A failed history filter sends recovery to the top of a long mobile page with Use Try again above. | Put error and retry beside Payment history. Mark which data is stale and preserve the prior view. Verify failed-filter recovery without scrolling to the top. |
| P2 | `portal.css:94`, `workspace.tsx:1008` | Mobile CSS moves the entire finance/timeline column before conversation while DOM and keyboard order start with conversation. Future payment placeholders can precede the current review task. | Use a stage-aware DOM order shared by visual and keyboard flow. Promote the relevant proposal or payment individually, keep conversation readily available, and collapse secondary history. Verify IN_REVIEW, AWAITING_APPROVAL, BUILDING, and handover on mobile and with a keyboard. |
| P2 | `review-assistant.tsx:211` | Revoke immediately invalidates the worker connection, including machines with active jobs, without confirmation or undo. | Confirm the named machine, active-job impact, and required re-pairing with safe initial focus. Verify cancel and confirm with synthetic workers. |

### Design consistency follow-ups

| Priority | Location | Finding | Recommended change |
| --- | --- | --- | --- |
| P3 | `customer-dashboard.tsx:60`, `workspace.tsx:913` | The overview distinguishes payment processing, team review, and configuration problems; the detail banner reduces them to needs your attention. | Share one payment presentation so the next action stays consistent when entering a project. |
| P3 | `workspace.tsx:970`, `workspace.tsx:1263`, `project-completion.tsx:672` | Important Requests, Review, and Handover destinations are missing from section navigation. Aftercare instructions refer to a distant section without linking to it. | Add deliberate section anchors and a contextual Report a problem action in handover. Put routine project-management options in a secondary disclosure. |
| P3 | `portal.css:1120`, `workspace.tsx:723` | Mobile project views spend substantial space on header, sidebar, switcher, toolbar, and stepper before the actual task. | Retain the new compact header; replace the project sidebar with a compact back link/switcher and a current-stage summary. Put the current next action in the first screen. |
| P3 | `workspace-forms.tsx:600`, `review-assistant.tsx:177` | Retained agent history precedes publishing controls and opens by default, making the operator's current editor harder to find. | Keep the active run visible, collapse completed history, and give review/publishing controls a persistent entry point. |
| P3 | `account-settings.tsx:169`, `account-settings.tsx:211` | Account navigation lists security before notifications, while the content renders them in the reverse order. | Match section navigation, visual order, and reading order. |
| P3 | `frontend/apps/customer/src/app/page.tsx:39`, `page.tsx:66` | Primary Show us your app links land on the overview; a lower CTA explicitly opens intake. | Send project-start CTAs consistently to `/dashboard?start=1`, retaining the dashboard link for returning users. |
| P3 | `workspace-forms.tsx:405`, `workspace.tsx:1287`, `workspace.tsx:1387` | Follow-up requests ask overlapping purpose/type classifications and display raw codes; the operator timeline calls customer-authored updates You. | Use human labels and correct attribution. Reduce overlapping classification choices while keeping agreed-check failures explicit. |
| P3 | `customer-auth.tsx:108`, `customer-auth.tsx:318` | Password mismatch is a global alert without association to Confirm password or field focus. | Add field-level error description, invalid state, and focus while retaining the clear global summary. |
| P3 | `portal.css:947` | Timeline metadata uses 10px type, and explanatory copy is frequently repeated in large notice panels. | Use a readable utility-text scale and concise contextual help. Keep detailed terms in the relevant disclosure instead of repeating them around every action. |

### Recommended project layout

Each project should begin with its name, current state, one primary next action, and a short explanation of who acts next. A compact section navigation should cover Overview, Conversation, Requests, Scope and payments, and Delivery. Show the relevant section first in both the DOM and mobile layout:

- During review: review status and questions, then conversation and the customer's requested outcomes.
- When a proposal is ready: scope, assumptions, delivery estimate, cost, and approval. Conversation remains one click away.
- During building: delivery progress, the next milestone, and conversation. Payment collection appears when the agreed installment is actually actionable.
- At handover: artifacts, actual verification results, operating instructions, acceptance, and the precise aftercare window.

The backoffice overview should put customer requests first, with a compact worker-health summary. Pairing instructions, completed agent history, team notifications, and service recovery belong in secondary panels. This preserves operational access without making it compete with reviewing a customer request.

## Verification and limits

The review combines current source, a read-only production inspection of the public landing/sign-in and expired-session surfaces, and synthetic rendered customer/admin journeys on desktop and mobile. An existing signed-in production dashboard showed the reported operator link; refreshed account/admin sessions were signed out. Project, commercial, and worker failure findings are source-backed and checked against local synthetic captures, not reproduced against live customers or payment providers.

Local verification: all 244 desktop/mobile browser checks passed without retries in the broad run. After independent-review fixes, all 152 affected desktop/mobile checks passed without retries, including provider appearance/focus, email and both social return flows, separate team preferences, keyboard conversation history, overview focus, four deliberately delayed save scenarios, consistent active navigation across all three customer routes, and disconnect both before a first project and inside an existing project. Lint, both application type checks, and both production builds passed. Provider callbacks in these checks are fixtures; they do not establish new live Google, GitHub, email, card, or subscription acceptance. This review does not change the separate operating acceptance dependencies in `docs/OPERATING_ACCEPTANCE.md`.

The design review also used the current [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) for interaction, focus, form, and responsive checks. Automated browser assertions do not establish screen-reader output or universal perceptual contrast; those remain targeted manual checks for the subsequent design pass.

Independent Staff Engineer, Product Owner, and Designer gates passed for this cleanup. Their review fixes are implemented: Account provides disconnect before the first project, disconnect wording reflects browser-session scope, the mobile navigation retains its semantic box, logout feedback tracks only logout, and repository warnings/notices clear when their state becomes obsolete. The last feedback change also passed all 24 focused desktop/mobile checks without retries. No scoped review findings are deferred. The larger findings above remain open and prevent claiming the corresponding journeys or the entire product are ready for paid launch.

The source-only reviewers inspected the implementation and regression definitions; the Designer also inspected refreshed synthetic mobile captures. They did not independently run providers or production mutations.

## Production rollout

Reviewed application commit `dba9b6710cc303be59fbc5fdc4ab4410bfe04a74` is pushed and deployed from exact `frontend` Git archives, excluding ignored credentials and runtime files. Railway customer deployment `b2485cc4-0dbf-40d7-8ad0-98644b633856` and backoffice deployment `245879ea-0573-4a6e-b1c0-f37eb5a9ea74` both report SUCCESS. API, schema, worker, and provider configuration are unchanged.

[Code CI 37789152166](https://github.com/tinchelk/m8itwork/actions/runs/37789152166) passed 183 backend tests, all 250 desktop/mobile browser checks without retries, seven worker-container checks, 14 operations checks, lint, types, and both production builds.

Dashboard, sign-in, Account, Billing, and backoffice return HTTPS 200 with certificate validation. In the authenticated production browser, all three customer pages show the shared navigation with the correct active page and no Backoffice link. Account exposes repository connection settings before any project exists and shows only customer email preferences. The separate authenticated backoffice shows its team notification panel. Production Google and GitHub buttons have matching computed dimensions, color, and radius. Routine GitHub sign-in using the existing grant successfully returns to Billing when started there; the browser was then returned to the customer dashboard and separate backoffice.

Production captures are retained only in ignored `backend/var/ux-cleanup-{dashboard,sign-in,backoffice}-production.png`. The production browser remained at its normal desktop size; mobile evidence comes from the automated rendered journeys. No project, message, notification preference, card, payment, repository authorization, or account-closure mutation was submitted for rollout verification. Existing provider and operating acceptance dependencies remain open.
