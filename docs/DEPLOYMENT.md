# Railway and Cloudflare deployment — October 6, 2026

## Customer GitHub connection recovery — October 7, 2026

Reviewed milestone `3f1e5dd0cf919989c4f0e9a5abbab399df3cef08` separates customer repository authorization from sign-in identity linking. All 132 real-PostgreSQL tests and 134 desktop/mobile browser checks pass, with backend/frontend lint, typechecks, production builds, and all three independent review gates. Staff independently repeated the final 17 connection tests. See [GITHUB_CONNECTION_RECOVERY.md](GITHUB_CONNECTION_RECOVERY.md) for scope, acceptance, review findings and compatible rollback order. No migration or provider/worker configuration changes were required. Exact Git archives excluded ignored credentials and runtime files.

All three Railway deployments succeeded, with the API deployed before frontend links:

| Service | Deployment |
| --- | --- |
| API | `c3e347a5-326c-4491-a096-c1d236498e30` |
| Customer | `b7958f85-78ad-4016-9631-621bffa488ac` |
| Backoffice | `c20a70f2-b0b0-4cf6-b8d2-3c0ee070bba8` |

Live health/dashboard/backoffice return 200; signed-out project/operator APIs return 401. An unauthenticated repository-connect browser request redirects to `https://m8itwork.com/dashboard?github=signin-required` without starting GitHub authorization. The actual previously blocked Chrome customer session now shows the corrected repository-only Connect link and useful completed-refresh guidance, with no empty disconnected picker. Fresh authorization returned to the same customer dashboard as Tin Che, connected as `@tinchelk`, and listed only the already selected private `tinchelk/growth-ai` repository. That option was successfully selected. No installation permissions or repository selection were expanded, no customer request/project was submitted, and no code was executed. The live screenshot is stored only in ignored `backend/var/preview-github-recovery-production.jpg`.

GitHub temporarily returned server errors for pushes, a Git object API request, and its own authorization page. Its public status API listed no unresolved incident at the time. A later ordinary push and authorization refresh succeeded; the reviewed commit was published unchanged. The unsuccessful alternate object-publication attempt did not update the branch. [GitHub CI run 37642602120](https://github.com/tinchelk/m8itwork/actions/runs/37642602120) completed successfully: both verification (including the browser suite) and the Linux worker-container job passed. Other previously recorded paid-pilot/provider acceptance gates remain unchanged.

User outcome: serve m8itwork over HTTPS on m8itwork.com, with api.m8itwork.com for its authenticated API, so GitHub App callbacks can use public URLs. The user explicitly requested a new Railway project in the workspace used by chat-florist. That existing project provides configuration references; its services and data stay separate.

## Scope and acceptance

- A new m8itwork Railway project with frontend, API, and dedicated PostgreSQL. No Chat Florist database, tokens, billing keys, customer data, or service changes are copied.
- Build the current reviewed source with separate frontend/backend Docker contexts. Apply additive Prisma migrations in the new database. Keep secrets out of build archives, logs, Git, and browser bundles.
- Route the apex and www domain to the frontend, and api subdomain to the backend through Cloudflare DNS. Use HTTPS and a canonical www→apex redirect preserving paths/query strings. Preserve unrelated mail/TXT/domain records.
- Configure exact production frontend/API origins, secure account cookies, a trusted operator ID, and a bounded proxy configuration for per-client API rate limiting.
- Verify build/health, deployed page/assets, customer/admin access denial when signed out, origin checks, HTTPS/DNS/redirects, and honest provider-setup states. Record Railway/DNS evidence and independent engineering/product/design review results.
- Submit a synthetic anonymous brief over the deployed HTTPS API and confirm its record in the new database through the operator leads tool. Document the interim manual leads review, expired-session cleanup, and backups/restore procedure.
- GitHub App registration, real private access and Stripe sandbox verification continue after public URL setup. Deployment alone does not close those provider acceptance gates. No live payment is taken.

## Operational approach

Keep the existing Cloudflare proxy enabled. Railway terminates HTTPS at the origin. The API uses Railway's edge-provided X-Real-IP and accepts CF-Connecting-IP only when that peer matches current official Cloudflare CIDRs. X-Forwarded-For is ignored: live verification showed Railway preserves user-supplied values there. Leave proxy trust disabled for local/direct deployments; this configuration is specifically for Railway's HTTP edge. Railway custom-domain CNAME/TXT targets are taken from its current service/domain responses. Test/live financial records use separate databases. This initial deployment keeps payment disabled until its own sandbox/live verification is complete. See [Railway header specifications](https://docs.railway.com/networking/public-networking/specs-and-limits) and [Cloudflare headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

Cloudflare ranges: [official IPv4](https://www.cloudflare.com/ips-v4), [official IPv6](https://www.cloudflare.com/ips-v6), refreshed October 6, 2026. Refresh the deployment variable when Cloudflare changes its ranges. Domain records originally targeted the old Growth AI tunnel; only the apex/API records were replaced, with verification TXT plus www added. Mail records and the tunnel itself were preserved.

## Verification and resource identifiers

Deployed October 6, 2026 from the local working tree based on checkpoint `b5b5b17`, including the uncommitted workspace/delivery implementation. Upload each app with `railway up ./backend --path-as-root --service api` or `./frontend --service web`, explicitly selecting this project and production. There is no GitHub automatic-deploy source yet. Node 22.23.3 was verified inside the running services; both Docker builds and health checks passed.

| Resource | Identifier |
| --- | --- |
| Workspace (same as Chat Florist) | `7d8c8721-8734-4639-9d9e-917cdc78251d` |
| New m8itwork project | `1e29ee87-902c-4320-9089-863284aaf971` |
| Production environment | `6c952032-7617-48dd-b743-98b89b10d479` |
| Web service / successful deployment | `246a03ea-e491-482e-bbd1-07d888ea6c15` / `86cf01bb-0c03-40d6-b259-5390f2478e39` |
| API service / successful corrected deployment | `75230e5e-c48a-4312-b365-c0fcd852042d` / `a347b345-6a85-4f5f-bc06-92319b93ce53` |
| Successful GitHub-configured API redeploy | `becb5501-6c95-47c3-a65e-17465f5a6360` |
| Dedicated Postgres / volume | `c79b8b31-f6f3-4c2d-8ac4-aac3292221e7` / `5d6d6de3-2ae9-4cbb-9fb3-83acbd776100` |
| Cloudflare account | `0b8ad18e534f30cb089d6abbb0bdd8af` |
| Cloudflare canonical redirect | `19e53111fcc845ebaeadbe77920773c9` |

Updated existing proxied CNAMEs: apex → `k82lpuyx.up.railway.app`, api → `jjkzlf0s.up.railway.app`. Added Railway TXT verification at `_railway-verify` and `_railway-verify.api`, with the exact values returned by Railway; both domain ownership checks passed. Added proxied www CNAME → apex. Mail MX/DKIM/SPF and the old tunnel were preserved. Cloudflare was configured through the signed-in dashboard because the existing CLI token is scoped to another zone.

Verified public behavior:

- `https://m8itwork.com` renders the reviewed workshop artwork/assets. The initial `/workspace` and `/admin` checks showed the honest configuration-blocked state before GitHub was configured. Screenshots: `preview-production-site.jpg` and `preview-production-workspace.jpg`. Real sign-in and operator verification followed below.
- API `/health` returns 200 with a database query. The initial anonymous account session reported GitHub disabled; the later configured deployment reports `connectEnabled: true`. Signed-out customer `/v1/projects` and operator `/v1/operator/projects` return 401; foreign-origin POST returns 403. Review cookie has HttpOnly, Secure, SameSite=Lax and a 24-hour maximum age. Account-cookie attributes and session rotation are covered by integration tests.
- HTTP and HTTPS www `/workspace?review=1&ref=deploy` return 308 to the HTTPS apex with path/query intact. HTTP apex redirects to HTTPS.
- HTTPS synthetic intake `c7a0c77d-3cf2-4954-856a-9aee997b2e7d` was accepted with 201, persisted as NEW in the dedicated production DB, and retrieved by the deployed `leads` tool. Its name/email clearly identify a disposable deployment fixture; no real customer or payment is involved.
- Public inspection of `octocat/Hello-World` succeeded, pinning `7fd1a60b01f91b314f59955a4e4d4e80d8edf11d` and accurately reporting no detected package stack plus static-inspection limitations.
- The first X-Forwarded-For trust implementation failed live (125 rotating forged values returned 200), so it was replaced before sign-off. Corrected direct Railway requests rotating X-Real-IP, X-Forwarded-For and CF-Connecting-IP returned 120×200 then 5×429. Through Cloudflare, rotating forwarded prefixes returned 119×200 and 6×429 after a normal request. Cloudflare itself rejects caller-supplied CF-Connecting-IP with 403/error1000 ([documented behavior](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1000/)); normal requests work. No public debug endpoint or request-header logging was added.
- Backend lint/typecheck/build and all 54 tests pass with a dedicated local test DB. Runtime Node22 builds/health pass. Prior 44 desktop/mobile UI checks remain valid for the unchanged frontend.

All three independent deployment gates passed: Staff Engineer, Product Owner, and Product Designer, with no blocking findings or new deferrals. The engineer independently repeated all 54 tests and confirmed live health/config; the designer independently checked the live artwork, page/asset rendering, lack of horizontal overflow and query-preserving canonical redirect. Reviewer documentation mismatches were corrected. The actual API server process runs as UID1000; Railway's operator SSH shell itself runs as root.

## Pilot operations and recovery

Use the new project IDs explicitly. Operator GitHub login is configured for the customer-project desk. Anonymous quick briefs still use the separate authenticated Railway leads CLI; review these daily. Lead output contains customer briefs; keep it in the operator terminal and private records, never paste production output into chat. Manual cleanup is available and was successfully exercised. Automated notifications and scheduled cleanup are not enabled yet.

```sh
railway ssh --project 1e29ee87-902c-4320-9089-863284aaf971 --environment production --service api npm run leads
railway ssh --project 1e29ee87-902c-4320-9089-863284aaf971 --environment production --service api npm run cleanup
```

For a lead status change, append `-- <submission-uuid> CONTACTED` to `npm run lead:status` through the same SSH command. Mark a paid status only after an actual verified payment. Session expiry is enforced during access independently of cleanup; cleanup removes expired credentials/sessions and retains submitted briefs.

Daily volume backups are enabled (schedule `7fd1ed58-29f1-4e16-b742-bd772d577885`, retention six days). Initial backup `9e523a9d-2a99-4504-9fb6-79f6a2b3474a` was created after the fixture persisted and appears in the backup list. Before subsequent DB migrations, create an additional manual backup through the Postgres Backups tab or the public API `volumeInstanceBackupCreate`; CLI 5.63.4 has no backup command. Additive migrations applied in the new database; no other project database was accessed.

For recovery, pause customer writes/payments, locate the desired snapshot in this Postgres service's Backups tab, review the staged restored volume and deploy only after confirming the intended snapshot. Railway retains the previous unmounted volume, but restores remove newer backups; take a current logical dump first. A restore drill, an off-provider logical backup, and PITR are not yet configured/verified. See [Railway recovery guidance](https://docs.railway.com/guides/postgres-backups-restores). Deployment rollback uses a previous successful service deployment with compatible additive schema; never run a destructive down-migration on customer data.

Customer email/Google auth was deployed after manual backup `ebe22151-597c-44fb-a55f-d84725704b68` on October 6. Additive migrations 007 and 008 applied successfully. Scoped implementation reviews and production health/access checks pass; dedicated credentials are backend-only Railway variables. See `ACCOUNT_SIGNUP.md` for deployment IDs and the outstanding real-provider acceptance checks. Railway build logs announce config-as-code deprecation on December 1, 2026; migration to the supported infrastructure configuration is operational follow-up, outside this auth change.

## Real GitHub verification and remaining live gates

GitHub accepted the corrected manifest using public homepage/setup/API callback plus local development callback, with webhook configuration omitted. Registration completed through the local callback as **m8itwork**, App ID `5215361`, owned by `tinchelk`. A real public API lookup verified the saved client ID matches and permissions are Contents/Metadata read-only, with no events. Credentials were saved only in ignored backend/.env and transferred to this API through CLI stdin. The GitHub-configured redeploy succeeded and returned `/health` 200 and `/v1/auth/session` with `connectEnabled: true`. See `GITHUB_SETUP.md`; reuse this App rather than registering another.

The production operator allowlist is the verified numeric GitHub ID `29710742`; encryption is configured through secret stdin. The actual Continue with GitHub link reached GitHub's **Authorize m8itwork** screen for `tinchelk`, with state/PKCE and the exact public callback. After the user's explicit action-time approval, authorization and installation `168628564` were completed for **only `tinchelk/growth-ai`**, with Contents/Metadata read-only access.

Real production checks passed:

- Sign-in returned to the HTTPS customer workspace as the expected account, exposing its Admin desk link. The actual authenticated `/admin` loaded the empty project queue, and remained accessible after reload.
- The repository picker listed only the selected private repository. Static inspection completed with 379 sampled files, pinned to the current main-branch HEAD verified independently with the GitHub CLI, and detected Next.js, React, Fastify, and TypeScript. The report clearly distinguishes its 1–2 working-day assessment allowance from a development ETA. No source was executed or code changed.
- Disconnect removed the connection. A new inspection of that same private repository was rejected with the expected repository-not-found/not-shared message. The previously saved report can remain until removed; disconnect removes credentials rather than deleting historical evidence.
- Reconnection restored the same GitHub identity and the single selected repository without expanding permissions. Operator sign-out hid the protected desk and presented sign-in; routine sign-in returned to the customer workspace.
- Private verification screenshots are stored only under ignored `backend/var/preview-production-{private,admin,disconnect,signed-out}.jpg`. Private file paths, source, tokens, and session cookie values are excluded from tracked evidence.

This closes registration, real login, selected private scanning, disconnect/reconnect, and operator sign-in checks. Full customer-project/PRD/proposal verification, a real second customer identity and unshared-repository denial, provider token-expiry settings confirmation, and the Stripe sandbox Checkout/webhook journey remain open. Stripe remains disabled. Do not declare the paid pilot launch-ready, collect real payments, or create a full milestone commit from these deployment checks alone.

## Separate customer app and backoffice — October 6, 2026

The current customer destination is [m8itwork.com/dashboard](https://m8itwork.com/dashboard). The backoffice is a separate Next.js app and Railway service at [admin.m8itwork.com](https://admin.m8itwork.com), sharing the API and reviewed UI source. Legacy customer `/workspace` and `/admin` links redirect with project/payment query parameters preserved. The original single-app checks above are historical.

Both frontend services build from `frontend` using `APP=customer` or `APP=admin`. The API now requires `ADMIN_ORIGIN=https://admin.m8itwork.com` alongside its existing customer origin. The existing numeric operator allowlist remains the authority; choosing the admin login flow grants no role. All three updated services deployed successfully, and real GitHub sign-in returns to the correct app. The new proxied admin CNAME targets `v7qsiehk.up.railway.app`; Railway ownership/TLS passed. Existing mail and other domain records were preserved.

[DASHBOARD_BACKOFFICE.md](DASHBOARD_BACKOFFICE.md) records the current deployment IDs, independent review results, rollback coordination, and live dashboard/backoffice/CORS/authentication checks. Full paid-pilot acceptance gates remain open.

## Local subscription review worker rollout — October 6, 2026

Reviewed milestone `f4b2401bcaa0daf3cbaaa1c36b8422795e484234` was committed and pushed after all three independent review gates, 101 backend tests, 78 desktop/mobile checks and both production builds passed. [GitHub CI run 37570065996](https://github.com/tinchelk/m8itwork/actions/runs/37570065996) also completed successfully. Each Railway upload used an exact Git archive of this revision, with ignored configuration and runtime files excluded.

Before additive migration 009, manual Postgres backup `f3e7cd81-d4e1-47a7-99ff-8acd93d6a53a` ("Before local review worker migration009") was created and confirmed in the backup list. All three service deployments succeeded:

| Service | Deployment |
| --- | --- |
| API | `dbf39878-67ec-4749-b03f-6b7a2b164c5f` |
| Customer app | `dba073b2-893f-422f-a97f-c9e30bdfdba2` |
| Backoffice | `9e64ccf2-5b3c-4b9e-943f-875d8ff2e4d4` |

Post-deployment checks confirmed API health 200, dashboard/backoffice HTTP 200, signed-out operator routes 401, unpaired worker claims 401 and foreign-origin worker requests 403. The deployed privacy page contains the AI-review/provider disclosure. A read-only database query confirmed `202610060009_review_worker` is finished and the paired **Tin-Mac** worker is online. No production customer code was processed or draft published during this rollout. Local synthetic Codex and complete queue-to-result subscription smokes passed separately.

The worker uses a private standalone runtime outside the Documents checkout and starts through a macOS LaunchAgent. Its pairing key is stored only in the private local configuration; Railway stores its hash. Codex subscription login remains on the Mac. Claude is implemented but not authenticated/enabled on this machine. [REVIEW_WORKER.md](REVIEW_WORKER.md) records the operator workflow, startup/pause/revocation and upgrade procedure. Existing real-provider and Stripe acceptance gates remain open; this rollout does not change payment readiness.

## Docker worker and remote review operations — October 7, 2026

Reviewed milestone `0fc33f67048ad2292e4a6ac1bc05e284f1ff9ea8` passed all three independent reviews, 106 real-PostgreSQL backend tests, 92 desktop/mobile checks and both image architectures. [CI run 37627137218](https://github.com/tinchelk/m8itwork/actions/runs/37627137218) passed verify and native Linux Docker jobs. Exact Git archives excluded ignored secrets. Confirmed pre-010 backup: `40f2ecc8-fa25-4de2-8909-7b38e5846c5b`. All three service deployments succeeded:

| Service | Deployment |
| --- | --- |
| API | `fc906124-834c-40e7-a51f-98850631a602` |
| Customer app | `a71b9c0e-9c65-4917-bc6f-319e447d4312` |
| Backoffice | `5c35f853-77a8-4fe0-aa09-4d530e3a98ad` |

The first customer upload was interrupted and its failed deployment `7abfc657-68ac-475c-9aad-09ba87ad3d8f` was replaced by the successful exact-archive retry above. A separate Tin-Mac Docker pairing `81142787-5301-40bc-9036-4a2c64d4f4f9` was configured privately in named volume `m8itwork-review_worker_home`; only cached Codex auth was transferred, and the container doctor passed. Railway reports Codex READY. The previous native Tin-Mac LaunchAgent was stopped/disabled and its pairing revoked after verifying no active jobs. No customer job was fabricated, source processed or result published for these checks. Claude subscription login remains unverified.

Remote Codex reconnect adds migration 011; backup `b55131b1-d0e1-4134-9045-be2c07808f55` is confirmed before its release. Its reviewed brief, verification and rollout/rollback order are in [REMOTE_WORKER_LOGIN.md](REMOTE_WORKER_LOGIN.md). This does not close outstanding live-payment or provider acceptance gates.

## Remote Codex reconnect rollout — October 7, 2026

Reviewed milestone `66ac55dcefd30a5c025726c31bbec3aa33d765b8` passed Staff Engineer, Product Owner and Product Designer gates with no new deferrals. [CI run 37631024574](https://github.com/tinchelk/m8itwork/actions/runs/37631024574) succeeded, including all 100 desktop/mobile browser checks and seven native Linux Docker checks. Local real-PostgreSQL verification passed all 112 backend tests; final lint/types and backend/customer/admin builds pass. Production backup `b55131b1-d0e1-4134-9045-be2c07808f55` was confirmed before migration 011. Exact Git archives excluded ignored secrets. Deployments all succeeded:

| Service | Deployment |
| --- | --- |
| API | `d91e4ebc-8f18-48fa-9444-ceb2b583af02` |
| Backoffice | `937537eb-6ea6-4fff-ac1c-bd2398e2a23a` |
| Customer app | `2b04417f-a8d5-46dd-9756-e9ababdf528c` |

Migration `202610070011_worker_login` finished at 13:46:10 UTC. API/backoffice were deployed before upgrading Docker to exact-archive image `9f985978858490d9bc593a2b243461a3078b17ff448f925f1a9daa7f02126ffe`, tagged `m8itwork-review-worker:66ac55d` and `:local`. The volume survived recreation, the Codex doctor passed, and the live container is running as node with a read-only root filesystem. A read-only Railway query confirmed Tin-Mac Docker is fresh, Codex READY and `remoteLogin=true`, with zero running reviews. API/dashboard/backoffice return HTTP 200; anonymous worker and operator login requests return 401 with the proper origin, and missing-origin operator writes return 403. No customer source or fabricated production review was processed/published for these checks.

Actual device-prompt parsing and cancellation were verified privately against the pinned CLI in an ephemeral container. Subscription readiness on the live Docker worker is verified using the cached login transfer. A human completion of the new backoffice device-login flow is not claimed. On another host, start a paired worker and use its backoffice Reconnect Codex action for the initial sign-in. Claude still requires its own subscription login on the host. Retain additive migration 011 on rollback and coordinate the API/worker revision as described in [REMOTE_WORKER_LOGIN.md](REMOTE_WORKER_LOGIN.md).

## Agent handoffs and independent proposal comparisons — October 7, 2026

Reviewed milestone `cb9d88a1dd311fec873298b393b6072ac3ddc8e3` is live. API, backoffice and customer builds were uploaded from the exact Git archive `/private/tmp/m8-comparison-release-0z6w094e`, without local environment files. This adds private Codex→Claude and Claude→Codex continuations and **Codex + Claude · compare**, with independent pinned inputs, grouped partial results, shared preliminary planning settings and explicit editable-draft append. Publication, final price and delivery date remain operator decisions. See [PROPOSAL_COMPARISON.md](PROPOSAL_COMPARISON.md) and [DOCKER_WORKER.md](DOCKER_WORKER.md).

| Resource | Verified release identifier |
| --- | --- |
| API deployment | `c92d3e68-ba01-4ec9-8621-79482ec0277f` — SUCCESS |
| Backoffice deployment | `1aac91aa-032b-401d-aa4e-b4cbd04bfb1f` — SUCCESS |
| Customer deployment | `66430312-d8d0-449b-84f0-00cfead24329` — SUCCESS |
| Database backup before migration 012 | `eb4a505c-9732-4d32-b079-1b0737bc161e` — m8itwork-before-review-comparison-012 |
| Migration 012 completion | `2026-10-07T14:28:27.201Z` |
| Code CI run | [37636699136](https://github.com/tinchelk/m8itwork/actions/runs/37636699136) — SUCCESS |

Local verification: all 115 backend tests on dedicated PostgreSQL and all 114 desktop/mobile checks pass. Final affected comparison/failure checks, lint, types and production builds pass after review corrections. Code CI verifies 115 backend tests, all 114 browser checks and seven native Linux container checks; its existing mobile full-delivery journey exceeded the 30-second test budget once and passed the configured retry (113 first-pass checks plus one retry). That timing observation does not claim real payment or provider acceptance. All three independent feature review gates pass, with the draft-append wording and partial-failure wording corrected and no remaining review findings; the Staff reviewer independently repeated all 19 private queue integration tests.

Public runtime checks: homepage, customer dashboard, backoffice and API health return HTTPS 200. Current public backoffice assets include comparison, explicit handoff, additive draft and corrected partial-failure controls. Signed-out comparison read/create/cancel and worker claim return 401; foreign-origin comparison POST returns 403. Production confirms migration 012 and the replacement `ReviewJob_active_project_provider` index. No synthetic customer project or comparison was written to production.

The existing Tin-Mac Docker worker (`81142787-5301-40bc-9036-4a2c64d4f4f9`) remains running on image `9f9859788584`, reports a fresh Codex READY heartbeat and remote reconnect enabled, and has no running jobs. This release does not change its image, private volume, pairing key or Codex-only provider configuration. Worker transport is unchanged. Claude subscription/login setup and an authenticated Claude proposal/comparison are deferred by the user's explicit choice; queued Claude work waits for an enabled authenticated worker. Existing real-provider and paid-pilot acceptance gates remain separate.

For code rollback, leave migration 012 and comparison data in place. Prior API versions still enforce their single-active-run checks, and prior workers understand individual jobs. Do not restore the old one-active-job index while a comparison has two active members; use unfinished-only cancellation when needed. No destructive down-migration is part of service rollback.
