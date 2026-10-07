# GitHub repository connection recovery

User outcome: a customer signed in with Google, email, or GitHub can share their selected private repositories without switching accounts. A connection refresh always explains the next action.

Problem: the customer repository button used the identity-linking OAuth flow. If the customer's GitHub identity already belonged to a separate m8itwork account, authorization failed. The form then showed an empty picker and a refresh button that returned no useful feedback.

Scope:

- Add an authenticated `repositories` GitHub OAuth purpose, separate from sign-in and identity linking. Fresh GitHub authorization grants read-only repository access to the current account session; it never changes Account identities, roles, projects, or ownership.
- Use this purpose for customer Connect/Reconnect GitHub links in new and existing projects. Preserve existing login/admin/workspace identity semantics for compatibility.
- Bind credentials to the exact current account session, recheck it and the OAuth attempt at callback commit, and reject expired, cancelled, overwritten, replayed, or switched-account attempts. Credential use must respect that session binding.
- Hide empty repository pickers, explain missing installation access, and give visible loading, error, and completed-refresh feedback. Preserve request drafts and the account-scoped return destination.
- If the m8itwork account session expires before or during repository OAuth, return to dashboard sign-in with clear guidance. Same-account email/Google/GitHub sign-in restores the account-scoped form/project. Signing in does not replay the failed repository-authorization attempt; connect GitHub explicitly if repository access is still missing. Existing GitHub sign-in can itself restore repository access.

Exclusions: account merging, moving an identity between accounts, changing operator allowlists, expanding App permissions or selected repositories, new credentials, new schema migrations, worker/provider changes, and automatic customer code edits.

Acceptance:

1. Email/Google customers can authorize GitHub even when its sign-in identity belongs to another account. Both account IDs, identities, operator status, and existing projects stay unchanged; the current account can select and inspect only freshly authorized repositories.
2. Repository OAuth requires sign-in, state/PKCE, an unexpired one-time attempt, and the same active account session. Logout, reset, account switch, disconnect, a newer attempt, and replay cannot restore credentials or publish an inspection under another owner.
3. Private credentials are not usable by an unrelated, expired, or missing account session. Existing anonymous intake and GitHub login still work; legacy identity linking still rejects collisions.
4. Disconnected customers see Connect GitHub and read-only access guidance, without an empty picker. Refresh shows an explicit result; zero shared repositories lead to choosing repositories in GitHub; provider errors offer recovery. Typed requests survive refresh and OAuth return on desktop and mobile.
5. The shared customer/admin builds remain valid, existing workflows pass, and the Staff Engineer, Product Owner, and Product Designer gates pass before a dedicated milestone commit and deployment.

Verification: real PostgreSQL integration tests for duplicate identity, session isolation, revoked/overlapping attempts and ownership; desktop/mobile browser tests for connection recovery, draft preservation, loading and error feedback; backend/frontend lint, typechecks, builds and regression suites. Record production deployment and read-only runtime checks separately from provider fixtures. A fresh customer authorization is still required to connect an account that previously failed.

Review and verification on October 7: all 132 backend tests pass against the dedicated PostgreSQL test database, including 17 connection tests. Staff independently repeated the final 17 tests. All 134 final desktop/mobile browser checks pass, including email/Google session recovery, existing-project feedback/return, and wrong-account draft isolation. Backend/frontend lint, typechecks, and backend/customer/admin production builds pass. Staff Engineer, Product Owner, and Product Designer gates pass. Designer findings about saved-project refresh and legacy draft return, and the Product/Staff finding about expired-account browser-start recovery, are resolved. The Product wording correction about GitHub login restoring repository access is included. The earlier fail-closed GitHub/reset lock-order deferral remains recorded in ACCOUNT_SIGNUP.md; this change introduces no new deferrals.

Rollout: deploy the API before both frontend apps so the new OAuth purpose is available when its links go live. No migration, provider credentials, App permissions, selected installations, worker image, or worker pairing changes are needed. A rollback must restore compatible frontend links before rolling back the API. Record exact commit, CI, deployment IDs, and live checks in DEPLOYMENT.md.
