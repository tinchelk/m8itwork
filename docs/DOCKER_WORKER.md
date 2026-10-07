# Docker review worker

User outcome: run the existing m8itwork subscription review worker on a dedicated Docker machine, independently of the Mac, website, API and database. The container polls the existing Railway HTTPS queue and returns private review/estimate drafts for the operator to edit and publish.

Scope: a worker-only image built from this repository, pinned Codex/Claude CLI packages, a standalone Compose file, persistent private pairing/login storage, headless subscription login and verification commands, exclusive container locking, graceful shutdown and restart recovery. Existing queue authorization, leases, source limits, consent, draft validation and publication gates remain authoritative. No inbound ports, Docker socket, host home directory or backend `.env` are mounted.

Latest user requirement: report provider sign-in/allowance/errors and in-progress activity to the backoffice, retain operator prompts and visible agent replies/decision summaries, and let the operator send follow-up review instructions remotely. The first remote conversation remains within read-only review/estimation as confirmed by the user; editing customer code is out of scope. Provider transcripts are filtered: hidden reasoning, credentials and unrestricted terminal execution are outside this view. Customer publication stays explicit. This adds an operator-only workflow, so the designer review gate applies as well.

Acceptance:

- Build and run on Linux ARM64 and AMD64 using Docker Engine/Compose. Run as UID 1000 with a read-only root filesystem, dropped capabilities and a private persistent home volume.
- Pair each machine through backoffice Worker setup. Keep the bearer key and provider login state out of build inputs, images, environment variables, source control and logs.
- Authenticate through supported CLI subscription login; verify it before polling. Synthetic smoke uses fabricated source only. No API billing fallback.
- Keep login state across container recreation; prevent duplicate containers on one volume; recover from killed containers despite PID reuse; stop active child processes on shutdown.
- Validate the actual image and Compose settings, provider binaries, setup failures, restart/locking/shutdown and a synthetic queue-to-result run. Report provider readiness while idle as well as running. Keep activity, prompts and follow-up replies operator-only and bind them to the project/commit/consent/attempt. Remote requests survive transport retries without duplicate runs; stale evidence and expired/revoked access block continuation. Independent engineering/product/designer review precedes the milestone commit.

## Using Codex and Claude on one project

Choose a coding agent for each review or follow-up in backoffice. The next turn can use a different provider: the project, repository commit, customer requests, saved operator prompt and latest three validated reply summaries form a shared review context. The server keeps the complete paginated history; the model receives only that bounded context. Each turn runs independently, so native CLI chat IDs are not required and hidden model reasoning is not transferred. One review is active per project and one per worker; there is no automatic provider switch or API fallback.

`backend/src/worker/provider.ts` defines the small CLI adapter contract: subscription verification, safe invocation arguments, visible-message handling and structured report extraction. The Node worker owns queue transport and leases; the API owns access, consent and publication; adapters share the validated report schema. Adding another tool means implementing and testing an adapter and enabling its provider on the API/worker, rather than changing the project workflow. Both installed tools need their own subscription login on the host. Claude currently exposes its final structured reply here; Codex also streams bounded visible messages. Shell execution, customer code changes and autonomous PRs remain outside this milestone.

The worker reports provider readiness while idle, with progress during an active review. Sign-in problems require completing the CLI device/browser login; backoffice provides the host command but does not collect passwords or provider tokens. Quota failures persist a 30-minute cooldown across container recreation. Saved conversations and prompts are private to the team; only an explicitly published review/proposal reaches the customer.

## Setup on the new host

Install Docker Engine and Docker Compose v2+, then clone this repository and use its reviewed worker revision. Commands below run from the repository root. The host needs outbound HTTPS access to `api.m8itwork.com` and the selected AI provider. Docker manages the Node runtime and CLI installation.

```sh
docker compose -f compose.worker.yml build
docker compose -f compose.worker.yml run --rm worker versions
```

In [backoffice](https://admin.m8itwork.com), open **Worker setup** and create a connection named for this machine. Run:

```sh
docker compose -f compose.worker.yml run --rm -T worker configure
```

Paste its private JSON, then press Ctrl+D on Unix terminals to finish stdin. The key is stored at `/home/node/.m8itwork/worker.json` with mode 600 inside the volume. Never put it in a command argument or Compose environment. Use the default `codex`/`claude` executable names; Mac-specific binary paths do not work in the Linux image. For Windows terminals, pipe a private JSON file into this command using your shell's stdin support, then remove that temporary file securely. Do not commit it.

Sign in with Codex using device login:

```sh
docker compose -f compose.worker.yml run --rm -it worker login-codex
```

Open the displayed verification URL on your own computer and enter the one-time code. Device login must be enabled in the account/workspace settings. It stores a file-backed CLI login in the persistent volume. See [official OpenAI authentication documentation](https://learn.chatgpt.com/docs/auth). If device login is unavailable, use the documented secure cached-login transfer from a trusted machine; do not bake credentials into an image.

Claude is optional and installed in the image:

```sh
docker compose -f compose.worker.yml run --rm -it worker login-claude
```

Complete the CLI's browser authorization using a Claude subscription account. To enable Claude jobs, include `"claude"` in the pairing JSON's `providers` array when configuring the worker. Both enabled providers must pass the doctor. Authentication is through the provider CLI, not extracted OAuth tokens. See [Claude authentication](https://code.claude.com/docs/en/authentication) and [installation](https://code.claude.com/docs/en/setup).

Verify the enabled subscriptions and run a synthetic review (this consumes subscription allowance):

```sh
docker compose -f compose.worker.yml run --rm worker doctor
docker compose -f compose.worker.yml run --rm worker smoke codex
docker compose -f compose.worker.yml up -d
docker compose -f compose.worker.yml logs --tail=30 worker
```

Then check **Worker setup → Refresh worker status** in the backoffice. An online worker can claim a review with customer AI permission and a live repository connection. Findings remain private until the operator edits and publishes them.

## Operate and move the worker

Pause with `docker compose -f compose.worker.yml stop`; resume with `docker compose -f compose.worker.yml up -d`. Stop the service before configure/login/doctor/smoke commands: these share the same exclusive volume lock. A second container exits with code 75 while that lock is held. Every Docker machine gets its own volume and pairing connection; do not share one home volume across hosts. Stop/revoke the previous host during a move, after verifying the replacement host's login. The existing Mac LaunchAgent can be stopped using the command in [REVIEW_WORKER.md](REVIEW_WORKER.md).

The named `m8itwork-review_worker_home` volume survives ordinary `down`, rebuild and recreation. It contains subscription credentials and the pairing key; restrict Docker-host access accordingly. `down -v` deletes this volume and requires pairing/login again. Container logs contain only generic status and job IDs. Source samples and provider transcripts are not logged. Pattern-based source redaction remains a best-effort filter, not a guarantee.

The restart policy retries unexpected failures up to five times and leaves graceful revocation stopped. After restarting the Docker daemon or rebooting the host, run `up -d` again (or configure your host's startup service to do so). This policy intentionally avoids restarting a revoked worker indefinitely. Railway holds durable job state; offline hosts leave jobs queued and active leases expire for recovery.

For updates, stop the service, check out the reviewed revision, build, run doctor/smoke and start it again. CLI versions are pinned in `worker/package-lock.json`; update them only after checking adapter flags and rerunning verification. There is no automatic image publication or registry credential requirement. The operator status and conversation views require the accompanying API/frontend release and additive migration 010. Back up the production database before that release. Existing workers remain queue-compatible; upgrade them to report provider readiness and activity. The website does not receive provider login credentials.

## Verification record

Verified October 7, 2026:

- Actual Linux ARM64 image `3e41e8d8865e` and Linux AMD64 image `2534f314c7cc` build and run; the x86 image was exercised through Docker emulation on this ARM Mac. Both pinned provider binaries run in each image. Six image-level tests pass on each architecture: non-root/runtime boundaries, persistent private configuration, real fresh-home Codex and Claude sign-in-needed reporting plus synthetic queue/activity/result, provider-error/quota cooldown persistence, exclusive locking/SIGKILL recovery, and active provider cancellation on Docker stop. CI also builds/tests the x86 image on Linux.
- A real synthetic Codex subscription review inside Docker returned a validated report (one finding, 4–12 engineering hours, low confidence); fabricated source only, no customer repository or publication. Its temporary login volume was removed. Claude installation, unauthenticated status and adapter boundaries are verified; an authenticated Claude model run is not claimed.
- All 106 backend tests pass against dedicated PostgreSQL, including private access, event bounds/redaction/fencing, paginated/scoped retrieval, exact retry identity, Codex-to-Claude follow-up context, and stale queued/running continuation. Additive migration 010 applies locally. All 92 desktop/mobile checks pass, including frozen retry across initial/lookup failures and 401, same-account recovery versus another account, out-of-page acknowledgement, cached-running history refresh, 20-turn navigation, sticky-notice clearance and mobile input sizing. Backend/frontend lint, typecheck and production builds pass.
- Staff Engineer, Product Owner and Product Designer gates pass with no blocking findings or new deferrals. Engineering independently repeated 17 PostgreSQL/worker tests and six ARM64 container checks and found zero worker production dependency vulnerabilities. The reviewers' recovery, Claude status, cached history, timestamp and reply-navigation findings were resolved and verified.
- Production backup `40f2ecc8-fa25-4de2-8909-7b38e5846c5b` (m8itwork-before-worker-operations-010) is confirmed before migration 010. Service rollout evidence is recorded separately in [DEPLOYMENT.md](DEPLOYMENT.md) after deploying the reviewed commit. Existing native workers remain compatible but do not report the new telemetry until upgraded.

The target Docker machine has not been supplied, so new-host installation, subscription login and cutover are outstanding. The existing Tin-Mac worker remains running during preparation; this verification did not claim a production customer job. Each new host gets its own pairing connection and private volume. Existing paid-pilot/Stripe and other account-provider acceptance gates remain open.
