# m8itwork

Finish, fix, and extend apps started with AI. Milestone 1 is a service site, read-only GitHub connection, initial repository inventory, and durable project intake for launch help and custom development.

This uses the Next.js/Fastify/Prisma foundation and review workflow from `tinchelk/growth-ai` (`99324a4`), with its growth-marketing product removed. Next.js has been updated to a patched release. Consulting assessments and scoped project fees replace the former subscription/credit model; payment collection is future work.

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

Open <http://localhost:3120>. Public repository inspection and manual briefs work without provider credentials. An all-container development launch is also available with `make dev` (use `docker compose --env-file backend/.env --profile app up --build` to pass configured GitHub credentials).

## GitHub connection

See [docs/GITHUB_SETUP.md](docs/GITHUB_SETUP.md). Private access requires a registered GitHub App, its client ID/secret/slug, and a local encryption key. OAuth and API credentials never go into the browser or Git repository.

Private connection is required for launch. Run `npm --prefix backend run github:setup` to prepare the registration locally at <http://localhost:3122>; GitHub sign-in and registration approval are completed in your browser. The helper stores credentials directly in ignored `backend/.env`. Restart the API and perform the real private-repository checks in the setup guide. Current verification and remaining gates are recorded in [docs/VERIFICATION.md](docs/VERIFICATION.md).

The scanner reads a pinned commit's file tree and up to eight package manifests. It does not execute code, fetch submitted demo URLs, access secret files, or call an AI model. Reports show observed evidence, limitations, an approximate **human assessment allowance**, and checks required before a project estimate. A dependency declaration does not prove a workflow works. This is an inventory and triage starting point, not a full code review or security audit.

## Operator workflow

```sh
npm --prefix backend run leads
npm --prefix backend run lead:status -- <submission-uuid> CONTACTED
npm --prefix backend run cleanup
```

`leads` lists the latest 100 submissions through the operator's database connection. Check it daily during the pilot. Review those submissions and contact the builder about a paid assessment. Record progress with `lead:status`: `CONTACTED`, `ASSESSMENT_PROPOSED`, `ASSESSMENT_PAID`, `PROJECT_PROPOSED`, `PROJECT_PAID`, `COMPLETED`, or `DECLINED`. Mark a paid stage only after confirming the actual payment. Keep proposal details and invoices in your private business records; use the submission UUID to connect them. Track proposals and paid projects as the pilot's conversion outcomes, aiming for one paying client.

This pilot does not yet send acknowledgment emails or notifications automatically. Run cleanup daily to remove expired sessions, encrypted credentials, and unsubmitted inspections. Submitted briefs and summaries are retained separately; process deletion requests through the database. Keep database access restricted and back up submitted briefs.

## Verification

```sh
docker compose exec postgres createdb -U m8itwork m8itwork_test
DATABASE_URL=postgresql://m8itwork:m8itwork_local@localhost:55434/m8itwork_test npm --prefix backend run db:migrate
TEST_DATABASE_URL=postgresql://m8itwork:m8itwork_local@localhost:55434/m8itwork_test make verify
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run test:e2e
```

Integration tests require a dedicated `m8itwork_test` database and clean up only their own fixtures. Browser tests cover success/failure, inspection attachment, keyboard interaction, and narrow screens; GitHub provider responses are mocked there. Live private GitHub authorization must be verified after App registration. CI runs the database tests and browser checks.

## Deployment notes

Frontend and backend are independent apps with Dockerfiles. Build the frontend with the public API URL. Production requires HTTPS origins under the same site (for example `m8itwork.com` and `api.m8itwork.com`), durable PostgreSQL, GitHub production callback settings, backups, and a cleanup job. Do not use the local database password in production. Configure rate limiting/proxy IP handling for your hosting provider before accepting internet traffic; current limits are per API process. No deployment has been performed.

See [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md) and [docs/HANDOFF.md](docs/HANDOFF.md) for scope and acceptance criteria.
