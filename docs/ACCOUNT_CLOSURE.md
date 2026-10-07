# Close a customer account

User outcome: a customer can explicitly close their own account from Account settings, understand what happens, and receive an authoritative result.

Scope: a styled account section and confirmation dialog; typed CLOSE confirmation; an exact-customer-origin, authenticated, account-bound closure; all-device sign-out and retirement of this service's repository/OAuth credentials and recovery links; withdrawal of unagreed requests and cancellation of queued/running reviews. Project and financial history remain available to the team. Closing does not delete a GitHub repository, uninstall the GitHub App, refund a payment or automatically remove cards held by Stripe. Customers can remove saved cards before closing and contact support about retained records.

Approved/in-progress work, pending payment attempts, disputes and operator/worker ownership require a team check before closure. Closed identities cannot silently reopen through signup, recovery, Google or GitHub. Data-erasure and operator-account closure are separate support requests.

Acceptance:

1. Account has a clearly secondary Close account action in the established web style. The dialog identifies the account, explains effects/retention, requires typed CLOSE, supports keyboard/cancel/focus return, and shows errors beside the action.
2. Only the signed-in account can close itself. A stale dialog cannot close another signed-in account; foreign origins and invalid confirmations fail without changing records.
3. Closure is atomic with session/recovery/repository retirement and request/review withdrawal. Project creation and sign-in serialize with closure. Closed projects cannot receive new operator work; payment webhook reconciliation of historical records remains allowed.
4. A bounded, hashed, random receipt confirms a committed closure after a lost response or reload. Status recovery is read-only and cannot close an account. A query string or expired session does not establish success.
5. Meaningful PostgreSQL tests cover ownership, credentials, blockers, concurrency and recovery. Desktop/mobile tests cover confirm, cancel, failure, blocked states, interrupted responses and reload. Lint/types/build and independent Staff/Product/Designer gates precede commit and deployment.

Operations: deploy migration 014/API first, then both web apps. Before migration, create and verify a Railway Postgres backup. Once any closure exists, an API rollback must retain closed-account auth/mutation fences; prefer a forward fix. A pre-closure API ignores closedAt and is unsafe to restore without first disabling authentication/customer writes. Keep the additive migration. Historical Stripe webhook reconciliation remains active.

Verification and review — October 7, 2026:

- All 165 real-PostgreSQL backend tests and all 198 desktop/mobile browser checks pass without retries. Closure adds 14 domain/concurrency tests, two identity/auth tests, one retained webhook test and 20 browser checks. Backend/frontend lint and typechecks, backend build and both production frontend builds pass.
- Staff Engineer gate passes. An independently reproduced message/closure race was fixed by locking the project before checking closure for messages and notes. Staff's independent 51-test focused suite and closure-wins database probe pass; the committed regression separately verifies message-wins serialization. Closed credentials, worker cancellation and historical webhook reconciliation were checked. No closure engineering findings are deferred.
- Senior Product Owner gate passes. Interrupted dismissal uses Check later, checks authoritative status and does not imply cancellation; known rejections clear the old receipt. Closed history hides payment controls and retains the agreed terms. No product findings are deferred.
- Senior Product Designer gate passes. Desktop/mobile captures show the heading, account identity and safely focused Keep action together, with the dialog body scrollable. No design findings are deferred.
- Production verification will open and cancel the confirmation only. It must never submit Close account on the user's real account or perform a card/payment action as a probe.

Production rollout: milestone `d6a492aa783cbbafa978a7fbff07a1ef4680726c` is deployed successfully to API, customer and backoffice. Migration 014 applied after listed backup `6eed045e-8800-4fdb-8e20-b7dd9e9c73a0`. Code CI [37663800197](https://github.com/tinchelk/m8itwork/actions/runs/37663800197) passes all 165 backend and 198 browser checks without retries, plus seven native Linux worker-container checks. Real signed-in Account verification opened/cancelled the dialog with correct focus and disabled unconfirmed submit; the actual account was left open. Deployment IDs and runtime boundaries are recorded in [DEPLOYMENT.md](DEPLOYMENT.md).
