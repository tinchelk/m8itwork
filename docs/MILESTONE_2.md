# Milestone 2 — customer workspace

User outcome: a customer signs in, starts a project, shares its private GitHub repository and goals, then returns to see our review, proposed scope/cost/delivery estimate, and delivery updates.

## Scope and decisions

- Start with GitHub sign-in through the existing read-only App. Persist account ownership using GitHub's numeric user ID, with separate expiring account sessions. Repository access expires independently of the workspace login; reconnecting must use the same GitHub identity.
- Each account owns its projects. Customers see only their own requests, reports, proposals, and updates. Operators are explicitly allowlisted by GitHub numeric ID in server configuration.
- Projects progress through draft → review → proposal → scope approved → building → verification → complete. Progress means recorded work and updates, not an invented completion percentage.
- Customers can share bugs, feature requests, suggestions, questions, or PRD text. Reference links are saved without being fetched. File uploads, chat, and automatic notifications are outside this milestone.
- Linking an inspection copies its static evidence into the owned project. A repository or an explanation of access constraints is needed before submitting for review. Private repository support remains a required live acceptance path.
- Operators publish their review, then an immutable versioned proposal with scope, acceptance checks, amount/currency, tentative delivery date, and assumptions. The static scan never invents a development quote or ETA.
- Customers may approve the current proposal or add a request for changes. Scope approval does not collect payment; contracts/invoices remain arranged separately. Revising the proposal requires new approval. New customer requests do not automatically expand approved scope.
- Operators publish work updates and verification evidence. Building requires an approved proposal; completion requires a recorded verification summary.

## Acceptance and verification

- Login uses one-time state/PKCE and an opaque HttpOnly cookie, without tokens in the browser. Logout revokes both request-cookie and browser-bound account sessions, cancels OAuth completion, and prevents further repository reads using that connection. Results of already-started bounded provider reads are discarded if the account or connection changes. Stable identity is independent of GitHub username or contact email.
- Customer project/request drafts are saved in per-tab browser storage for one hour, keyed to the authenticated account and project. They survive reauthentication only for the same identity. Successful saves and explicit sign-out clear them; approval checkboxes are never restored.
- Customer and operator authorization checks run on every API operation. Test unauthenticated access, cross-account project/report access, operator escalation, reconnect identity mismatch, stale proposal approval, and logout/callback races.
- PostgreSQL persists projects, requests, immutable proposals, approvals, and updates. Transactions prevent stale proposals or concurrent edits from bypassing approval.
- Loading, empty, failed, blocked configuration, expired connection, and successful save states are explicit. Failed requests preserve input. Account failures never display another account's content.
- Responsive midnight workspace shows one next action, review/proposal status, and an update history. Keyboard use and labels remain usable; ETA/cost stay pending until our review.
- Run backend tests with the dedicated test database, frontend browser tests, lint/typecheck/build, and runtime visual checks. Obtain independent Staff Engineer, Product Owner, and Product Designer reviews before reporting the feature complete.
- Live sign-in/private access still depends on the registered GitHub App. Keep provider-mocked verification distinct from real provider verification.

## Pilot procedure for additional work

After building starts, new requests are follow-on work. The operator acknowledges them in a progress update, explains whether they affect the current delivery, and asks the customer to start a separate project for a new review/proposal/approval. The original project's approved scope and recorded ETA remain intact; any proposed change to that delivery is discussed explicitly. In-flight contract changes and linked change-order records are outside this milestone.

Latest customer entry point: `/dashboard`, showing owned projects before explicit creation or selection. The operator backoffice is a separate frontend app, not a mode within this dashboard. See `DASHBOARD_BACKOFFICE.md`.
