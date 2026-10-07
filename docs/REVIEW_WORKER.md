# Local review worker

The current runtime is the Docker worker on this Mac; its predecessor native Tin-Mac LaunchAgent is stopped/disabled and its pairing revoked. Use [DOCKER_WORKER.md](DOCKER_WORKER.md) for current setup and [REMOTE_WORKER_LOGIN.md](REMOTE_WORKER_LOGIN.md) for backoffice Codex reconnect. Native Mac instructions below remain an alternative requiring a fresh pairing.

Outcome: the operator queues a repository review in the backoffice, a local worker uses an existing Codex/Claude Code subscription to prepare a grounded review and effort range, and the operator edits/publishes the review and proposal through the existing agreement flow.

Scope: operator-only job queue and private draft results; revocable worker pairing credentials; one claimed job per worker, fenced leases/heartbeats, bounded retries/cancellation; read-only source snapshots pinned to the intake commit; explicit customer AI-processing consent; Codex and Claude CLI adapters without API billing fallback; editable review/scope drafts and an operator-rate cost/working-day calculator. Railway holds job state; the worker makes outbound requests and requires no inbound public port. An asleep/offline worker leaves jobs queued.

Exclusions: autonomous development, executing repository code/dependencies/tests, automatic publication or binding quotes, scraping demo links, sharing provider login credentials with Railway, and hosting a subscription proxy for customers. Customer intake keeps its two visible inputs. Old projects require explicit AI-review permission; new submissions identify OpenAI/Anthropic processing in the notice and record the notice version.

Acceptance:

- Only an allowlisted operator can pair/revoke workers, queue/cancel reviews, or read draft findings. Customers can authorize/withdraw AI review only on their own projects.
- Jobs bind to the project, saved commit, request snapshot, and consent version. Source is fetched only using a live connection belonging to that customer. No provider/GitHub credential is delivered with source. Revoked consent/access, missing connections, stale request evidence and invalid output have honest recovery.
- Read a bounded selection of code, skip sensitive/configuration/instruction files, redact recognizable credentials, report omissions, and never execute source. Model tools, project hooks, skills, plugins and external integrations are disabled in the review invocation. Source instructions are untrusted context.
- Worker tokens are hashed on Railway and stored privately on the local machine. Worker endpoints have job-scoped lease fencing, bounded payloads and no arbitrary repository URL or operator-account impersonation.
- Heartbeats and expiry permit recovery after interruption; stale attempts cannot overwrite another attempt's result. Duplicate successful uploads have one result. Subscription/auth limits pause the provider; failures never switch to billable API credentials.
- Reports contain findings with evidence paths, scope, acceptance checks, questions, assumptions, confidence and an engineering-hour range. Rates/buffer/availability are operator choices; final cost/date and publication remain explicit human actions.
- Run meaningful PostgreSQL isolation/lease/consent/concurrency tests, source filter and CLI adapter tests, desktop/mobile queue/draft/recovery checks, production builds, a synthetic subscription smoke test, and three independent feature reviews before the milestone commit.

Provider references checked October 6, 2026: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex authentication](https://learn.chatgpt.com/docs/auth), [Claude programmatic runs](https://code.claude.com/docs/en/headless), and [Claude subscription usage](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan). Use the supported CLI authentication; do not extract OAuth tokens or bypass provider usage limits.

## Operator workflow

1. Open a customer project in the backoffice. New requests carry AI-review permission; older projects show a permission blocker until the customer allows it in their dashboard.
2. Pick a coding agent and queue the review. Offline machines leave the review queued. Only a worker configured for that provider claims it. Cancel stops the attempt at its next heartbeat (normally within 20 seconds).
3. Check the private findings, evidence paths, saved commit and sampling limitations. Resolve questions in the customer conversation. Changed requests or repository evidence mark the draft stale and disables importing it.
4. Add findings to the editable review form, edit and publish. Add scope, checks and assumptions to the proposal form. Imports append and preserve existing drafts; imports exceeding field limits leave the form unchanged. Choose the final price, calendar delivery date and payment schedule yourself. Publication remains a separate action.
5. Existing customer agreement, Stripe payment gates, progress and handover follow the published proposal. This worker does not change code, open PRs or collect payment.

## Local setup

For a dedicated machine, use the [Docker worker package](DOCKER_WORKER.md). It bundles Node and the pinned provider CLIs and keeps private state in a persistent volume. The native setup below remains available for development; the Mac installation record is historical provisioning information.

Requirements: Node 20.19+, installed Codex CLI 0.160.1+ or Claude Code 2.1.290+, a supported subscription login, and this backend’s npm dependencies. Provider flag changes should be verified with the synthetic smoke script before updating a worker. Codex is the default; Claude is optional.

On the backoffice overview, open **Worker setup**, create a named connection, and copy its private JSON. In `backend/`, run `npm run worker:configure`, paste the JSON into stdin, then press Ctrl+D. The configuration is written to `~/.m8itwork/worker.json` with mode 600; never commit it or put the connection key in shell arguments/history. Set `codexPath` or `claudePath` in that private file if the binary is not on PATH. Add `"claude"` to `providers` only after `claude auth login` with your subscription. Codex uses `codex login` with ChatGPT. `npm run worker:doctor` verifies subscription auth; `npm run worker:run` starts polling. Ctrl+C stops the worker. Revoke the connection in the backoffice to disable it remotely. One process lock prevents accidentally starting two workers using the same local configuration.

The Mac must stay awake and connected. For automatic startup, use a macOS LaunchAgent with absolute Node/script paths, working directory outside customer repositories, and `KeepAlive`; stdout/stderr should go to a private directory. Build the backend first and run `node /absolute/path/backend/dist/worker/main.js run`. Never include service/provider secrets in a LaunchAgent. Pause with `launchctl bootout gui/$(id -u) /path/to/agent.plist`; revocation in the backoffice remains available if the machine cannot be reached. Automatic startup does not bypass subscription quotas.

## Runtime and recovery

The worker polls every 20 seconds, claims one job and heartbeats every 20 seconds. A lease lasts 120 seconds; attempts have a ten-minute hard limit, and expired attempts can be reclaimed up to three times. Upload retries use the same attempt ID; the server accepts one successful result. Processing is at-least-once after a crash, so subscription usage can be consumed twice, but stale results cannot overwrite the active attempt. Source and evidence are fetched afresh on recovery.

Quota/auth failures fail the job and pause that provider locally for 30 minutes. They never switch to API billing. Fix authentication or wait for the allowance reset, then queue a fresh review. Failed/cancelled jobs remain in private history. Disconnecting the source connection or withdrawing consent fences heartbeat/completion; content already transmitted cannot be recalled. Failed transport or worker shutdown lets the lease expire safely. Only generic error codes and job IDs are logged; raw provider transcripts/source are not uploaded or printed. The Docker operations release stores bounded, filtered visible messages and progress privately in backoffice, alongside saved prompts and validated reports; hidden reasoning is excluded. Temporary schema/output files are removed after invocation; no customer repository is cloned or unpacked.

A source context contains up to 40 files, 12 KB per file, 180 KB total; eligible files larger than 64 KB are skipped. The tree is bounded to 3,000 entries. Only the latest 20 requests are included, with 2,000 characters per request. Sampling/shortening is disclosed in coverage. Instruction, dot/config, secret-like, dependency/build/data/log and lock files are excluded. Pattern redaction is a best-effort filter, not a guarantee that all sensitive source is removed. The server uses a live GitHub connection belonging to the customer; expired connections require reconnecting. It does not give the worker a GitHub token or provider login.

The child process receives only a small OS environment allowlist; API keys, provider routing overrides and worker tokens are removed. Codex ignores user configuration/rules and disables shell execution, apps, hooks/plugins, browser/computer tools, skills, agents and web search, in a read-only ephemeral invocation with no project instructions. Claude uses safe/restricted mode with an empty tool list and no MCP, customizations or session persistence; `--bare` is intentionally avoided because it requires API authentication. Provider-generated findings must cite exact paths actually sampled and pass the same schema in the worker and server.

## Verification and deployment

Use the dedicated `m8itwork_test` PostgreSQL database. Run backend tests, lint/typecheck/build, frontend desktop/mobile Playwright checks, lint/typecheck/build, and `npx tsx scripts/review-smoke.ts` for Codex (or append `claude` once authenticated). Append a binary path after the provider argument if its executable is not on PATH. The smoke script contains only synthetic code; it does not read customer repositories. A provider’s account being unauthenticated is an operational blocker for that provider, not a reason to use API billing.

Migration 009 is additive. Back up production before deploying it. Roll back application code while leaving the additive tables/columns in place; do not drop queued reviews or consent records. Deploy exact committed source archives, excluding `.env`, worker configuration and `backend/var`. Scope operator worker pairing to the allowlisted GitHub ID; the standalone `pair-worker` script prints its token only to the provisioning pipe. Railway never receives CLI subscription credentials.

Verification on October 6: 101 backend tests pass against the dedicated PostgreSQL database; 78 desktop/mobile browser checks pass, including private queue/draft imports, unchanged final price, permission withdrawal, submitted-project reconnection, stale guards and previous-draft recovery after quota failure. A real synthetic Codex subscription review and a complete local API→queue→worker→private-result smoke passed; no customer code was used or report published. Claude adapter boundaries are tested, but this machine is not authenticated to Claude, so only Codex is enabled for initial operation. All nine migrations apply in order to an empty test database. Staff Engineer, Product Owner and Product Designer gates all pass with no blocking findings or new deferrals. Backend/frontend lint, typecheck and production builds pass. The independent engineer repeated 8 PostgreSQL queue tests and 4 source/CLI/shutdown boundary tests. The portability note was resolved by accepting a CLI binary argument in the synthetic scripts. Production rollout uses manual backup `f3e7cd81-d4e1-47a7-99ff-8acd93d6a53a` before additive migration 009.

## Installed Mac worker — October 6, 2026

The production connection is **Tin-Mac**, paired to the existing allowlisted operator. Railway confirmed a recent worker heartbeat, no pending jobs, and applied migration `202610060009_review_worker` after deployment. Its private configuration is `~/.m8itwork/worker.json` (mode 600, parent directory 700), with only Codex enabled. The subscription authentication doctor passes with the same minimal environment used by the background process. No production customer-source review was queued during provisioning.

The LaunchAgent is `~/Library/LaunchAgents/com.m8itwork.review-worker.plist`. It runs at login, restarts after unexpected failures, and stays stopped after graceful revocation. Its working directory is `~/.m8itwork`; private logs are in `~/.m8itwork/logs`. The installed runtime is a standalone copy of the reviewed worker modules and Zod in `~/.m8itwork/runtime-f4b2401`, with the full commit recorded in `version.json`. Node and Codex have absolute executable paths. The repository checkout is not required while it runs. Initial startup from the Documents checkout stalled; moving the runtime outside Documents resolved startup without changing macOS permissions.

Check or pause the worker from a local terminal:

```sh
launchctl print gui/$(id -u)/com.m8itwork.review-worker
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.m8itwork.review-worker.plist
```

Resume after a local pause:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.m8itwork.review-worker.plist
```

Revocation in **Worker setup** disables the credential; resuming the LaunchAgent does not restore a revoked connection. Pair a new connection instead. The Mac must remain logged in, awake and connected; sleep leaves jobs queued or lets an active lease expire for recovery. No keep-awake setting was changed.

For a worker upgrade, pause the agent, build and verify the reviewed backend revision, copy its `dist/worker`, `dist/reviews/types.js`, `dist/reviews/redaction.js`, `dist/crypto.js` and `node_modules/zod` into a new private runtime directory, and add a private `package.json` with `"type": "module"`. Record the source commit in `version.json`, update the LaunchAgent script path, run the authentication doctor and synthetic subscription smoke, then resume. Keep the private configuration out of the runtime/source archive. Moving or updating Node/Codex also requires updating their configured absolute paths. See [DEPLOYMENT.md](DEPLOYMENT.md) for the service deployment and CI evidence.
