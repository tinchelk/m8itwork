# m8itwork

Finish, fix, and extend apps started with AI. The service site and customer dashboard and operator backoffice cover read-only private repository intake, human review, agreed scope and estimates, conversations, Stripe payments, delivery tracking, and verification/handover.

This uses the Next.js/Fastify/Prisma foundation and review workflow from `tinchelk/growth-ai` (`99324a4`), with its growth-marketing product removed. Next.js has been updated to a patched release. Consulting assessments and scoped project fees replace the former subscription/credit model; project payments use one-time Stripe Checkout, upfront or in agreed installments. The app is deployed on Railway. Real GitHub login, selected private scanning, disconnect/reconnect, and operator access pass; the full customer-project and Stripe sandbox journeys remain open. No live payment has occurred.

## Run locally

Use Node 20.19+ (`nvm use`) and Docker Compose. Chat Florist uses nearby ports, so this app uses **3120** (site), **3121** (API), and **55434** (PostgreSQL).

```sh
make install
docker compose up -d postgres
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
npm --prefix backend run db:migrate
```

In separate terminals:

```sh
npm --prefix backend run dev
```

```sh
npm --prefix frontend run dev
```

Open <http://localhost:3120>. New projects need a signed-in account and a configured read-only GitHub connection. Select a repository and describe what you want next; the app checks the repository and sends the request directly for review. An all-container development launch is also available with `make dev` (use `docker compose --env-file backend/.env --profile app up --build` to pass configured backend provider credentials). Email signup uses `RESEND_API_KEY` and `EMAIL_FROM`; Google uses a dedicated `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and a callback matching the environment's `PUBLIC_API_URL`. Provider secrets are passed only to the backend. See [account setup and verification](docs/ACCOUNT_SIGNUP.md).

## GitHub connection

See [docs/GITHUB_SETUP.md](docs/GITHUB_SETUP.md). Private access requires a registered GitHub App, its client ID/secret/slug, and a local encryption key. OAuth and API credentials never go into the browser or Git repository.

Private connection is required for launch. The production App **m8itwork** is registered and configured; reuse it. For another environment, the setup guide describes registration and secure configuration. The helper stores credentials directly in ignored `backend/.env`. Current verification and remaining gates are recorded in [docs/VERIFICATION.md](docs/VERIFICATION.md).

The scanner reads a pinned commit's file tree and up to eight package manifests. It does not execute code, fetch submitted demo URLs, access secret files, or call an AI model. Reports show observed evidence, limitations, an approximate **human assessment allowance**, and checks required before a project estimate. A dependency declaration does not prove a workflow works. This is an inventory and triage starting point, not a full code review or security audit.

## Operator workflow

```sh
npm --prefix backend run leads
npm --prefix backend run lead:status -- <submission-uuid> CONTACTED
npm --prefix backend run cleanup
```

`leads` lists the latest 100 submissions through the operator's database connection. Check it daily during the pilot. Review those submissions and contact the builder about a paid assessment. Record progress with `lead:status`: `CONTACTED`, `ASSESSMENT_PROPOSED`, `ASSESSMENT_PAID`, `PROJECT_PROPOSED`, `PROJECT_PAID`, `COMPLETED`, or `DECLINED`. Mark a paid stage only after confirming the actual payment. Keep proposal details and invoices in your private business records; use the submission UUID to connect them. Track proposals and paid projects as the pilot's conversion outcomes, aiming for one paying client.

Resend delivers account verification and password-recovery emails when configured. This milestone implements durable project notifications and minute-by-minute retries, plus hourly credential cleanup within the backend. These changes are locally verified; the deployment record states which revision is running. Submitted briefs and summaries are retained separately; process deletion requests through the database. Keep database access restricted and back up submitted briefs.

## Verification

```sh
docker compose exec postgres createdb -U m8itwork m8itwork_test
DATABASE_URL=postgresql://m8itwork:m8itwork_local@localhost:55434/m8itwork_test npm --prefix backend run db:migrate
TEST_DATABASE_URL=postgresql://m8itwork:m8itwork_local@localhost:55434/m8itwork_test make verify
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run test:e2e
```

Integration tests require a dedicated `m8itwork_test` database and clean up only their own fixtures. Browser tests cover success/failure, inspection attachment, keyboard interaction, and narrow screens; GitHub provider responses are mocked there. Separate real GitHub verification and remaining acceptance checks are recorded in the verification/deployment documents. CI runs the database tests and browser checks.

## Deployment notes

The frontend contains independently built `apps/customer` and `apps/admin` Next.js workspaces, with shared source in `packages/ui`. Docker selects `APP=customer` or `APP=admin` on Node22. The API is a separate service. Deployments use the committed implementation checkpoint in this repository; the exact revision and Railway deployment IDs are recorded in the release handoff. The separate m8itwork Railway project has dedicated PostgreSQL at [m8itwork.com](https://m8itwork.com) and [api.m8itwork.com](https://api.m8itwork.com/health). Cloudflare preserves HTTPS and redirects www to the apex. Daily Railway volume backups are enabled. The launch-completion backend schedules event processing and credential cleanup; independent encrypted logical backup scheduling and external outage monitoring still need an operating host/destination. Railway-specific IP handling was verified against forged headers; general API limits are per process and account endpoints also use durable PostgreSQL identity/network throttles. See [deployment evidence and operations](docs/DEPLOYMENT.md), including the passed real GitHub login/private scan and remaining customer-project/Stripe checks.

See [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md) and [docs/HANDOFF.md](docs/HANDOFF.md) for scope and acceptance criteria.

## Customer dashboard

The customer dashboard is at <http://localhost:3120/dashboard> (production <https://m8itwork.com/dashboard>). Customers sign in with verified email/password, Google, or their existing GitHub identity, then start owned projects and add bugs, features, suggestions, PRD text, or questions. New projects require only a connected GitHub repository and the customer’s request; the repository name and account contact are filled automatically. See [simple project intake](docs/SIMPLE_PROJECT_INTAKE.md). After submission, the team publishes a human review and a versioned proposal with scope, acceptance checks, cost/currency, estimated delivery date, and assumptions. The customer approves the current version before building; revised proposals require new approval. The workspace shows progress updates and verification/handover evidence. Milestone 3 adds payments and the admin desk described below. Estimates remain human proposals, with explicit assumptions.

Set `OPERATOR_GITHUB_IDS` in the server environment to the comma-separated numeric GitHub IDs of explicitly trusted project-team operators, then restart the API. Usernames and contact emails never grant operator access. Signed-in operators see a Backoffice link to the separate admin app; the customer dashboard never switches to a team mode. The allowlist is empty by default; no customer can assign their own role.

Account sessions last up to 30 days and are independent of the 24-hour inspection session/eight-hour repository token. Logout revokes the browser-bound account session and cancels pending OAuth. Saved project summaries persist after inspection-session cleanup. No anonymous submission is claimed merely because its contact email matches an account; the existing quick brief continues to use email follow-up.

Customer project/request/conversation and operator form drafts use per-tab storage for one hour, bound to the signed-in account and project, to survive reauthentication. Successful saves and explicit sign-out clear drafts; approval acknowledgments are never restored. Requests distinguish additions, clarifications and reported failures of agreed checks. The team assesses included corrections against the proposal’s aftercare terms; additions need separately agreed scope.

See [docs/MILESTONE_2.md](docs/MILESTONE_2.md) for acceptance and exclusions. Live GitHub sign-in/private scanning now pass; project/PRD/proposal and second-account verification remain open. Mocked provider tests do not close those remaining gates.


## Backoffice, agreement, and delivery

Open the separate admin app at <http://localhost:3123> (production <https://admin.m8itwork.com>) after configuring an explicitly trusted numeric GitHub ID. The queue shows submitted projects, shared team unread status, and outstanding agreed payments. Team members reply in the project conversation, keep private team notes, publish reviews, and propose upfront, deposit/final, three-stage, or custom schedules (one to six installments totaling the scope).

Publishing a proposal records the team’s agreement; customer approval records theirs. Approval requests the first installment. Stripe confirmation unlocks building; the team requests later installments at their agreed stages. Delivery items need recorded checks before Done, and completion requires all items done, all due payments confirmed, and verification/handover evidence. Refunds, disputes, overpayments, and differing payment modes block advancement and need team review. A paid scope is revised through a separately agreed follow-on project.

Messages poll while the workspace is visible; incoming messages are marked read when their headings are visible. The team read marker is shared by operators. Durable project emails deliver acknowledgments, replies, proposals, payment updates and handovers to a verified destination. Customers manage preferences or a separate notification email in Account; private details remain behind sign-in. Operators receive customer-request and service alerts, controlled separately. Unsaved drafts last one hour in the current tab; explicit sign-out clears them.

See [docs/STRIPE_SETUP.md](docs/STRIPE_SETUP.md) for server-only configuration and sandbox verification, and [docs/MILESTONE_3.md](docs/MILESTONE_3.md) for the implementation scope. Expire pending Checkout before revising an unpaid proposal. An uncertain session is recovered by its existing Stripe session ID, rather than by creating another charge. Never treat the Checkout return URL, a fixture, or test-mode balance as real payment.

Run customer development with `npm --prefix frontend run dev:customer` and the backoffice with `npm --prefix frontend run dev:admin`. Configure backend `ADMIN_ORIGIN` and frontend `NEXT_PUBLIC_CUSTOMER_ORIGIN`/`NEXT_PUBLIC_ADMIN_ORIGIN` alongside the API URL. Existing `/workspace` and customer-site `/admin` links redirect to their new destinations and preserve project/payment parameters. See [dashboard/backoffice acceptance](docs/DASHBOARD_BACKOFFICE.md).

The backoffice can queue a private AI-assisted repository review for a local subscription worker. See [Local review worker](docs/REVIEW_WORKER.md) for pairing, Codex/Claude setup, consent, source limits, recovery, and the human review/estimate workflow. Subscription logins stay on the operator’s machine; the service does not execute customer code or publish generated reports automatically.

## Docker review worker

Run the worker on a dedicated Docker host using `compose.worker.yml`. It builds the Node worker and pinned Codex/Claude CLIs from this repo, keeps pairing/login state in a private persistent volume, and connects outbound to the existing Railway queue. Follow [Docker worker setup](docs/DOCKER_WORKER.md) to pair, sign in and verify the subscription, then run `docker compose -f compose.worker.yml up -d`. The Docker host requires neither the API/database nor the Mac checkout. Stop the worker before setup commands or moving to another host.

## Launch completion and operating procedures

Unagreed requests can be withdrawn or declined with a retained reason. Either party can request cancellation of agreed work; new collection and delivery pause until an exact written settlement is accepted and Stripe finances are conclusively verified. Refunds remain explicit Stripe actions. The team can offer to resume the original agreement, requiring customer confirmation. Saved scope, price and financial holds remain authoritative.

Before scope approval, the customer can explicitly refresh the same repository to a new inspected commit. Earlier evidence and proposals stay in history; active old reviews are cancelled and cannot become current. Proposals record responsibilities, external costs, ownership, cancellation and an editable aftercare window. Completed work receives actual artifact links, checks, operating instructions, limitations and deployment notes; customer acceptance is recorded separately.

Backend maintenance retries durable financial/email events every minute and clears expired credentials hourly. The backoffice Operations panel exposes unresolved events, safe retry actions and worker/provider attention. Review the customer queue and Operations each working day; the configurable response aim defaults to two working days for the initial fit review, distinct from a quoted delivery date.

See [launch completion evidence](docs/LAUNCH_COMPLETION.md) and [recovery and acceptance runbook](docs/OPERATIONS_RECOVERY.md). Fixture success does not establish provider publication, merchant activation or a paid-pilot launch.
