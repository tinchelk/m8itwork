# Railway and Cloudflare deployment — October 6, 2026

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
