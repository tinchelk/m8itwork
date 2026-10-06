# Milestone 1 brief

User outcome: a builder understands the finish/fix/extend offer, connects or links their GitHub repository, receives a grounded initial inventory, and submits broken workflows or desired features for a scoped assessment.

## Acceptance criteria

- Responsive, keyboard-usable site explains assessment → scope → build → verify/handover, with a single primary intake action. The offer includes custom features and integrations; extending or moving platform-dependent parts requires an assessment first.
- Public GitHub repository links work without credentials. Private access uses a configured read-only GitHub App with OAuth state, PKCE, encrypted tokens, and expiring browser sessions.
- Repository inspection pins one commit, bounds requests/files, excludes secrets and customer data, and never executes source or fetches arbitrary submitted URLs.
- Reports expose evidence, limitations, assessment-effort range, and the checks needed to estimate development. Missing evidence is never represented as proof of a broken workflow.
- Removing an inspection, switching repositories, or submitting a brief clears the saved selection; reload or connection refresh does not silently attach an old project.
- Manual and inspected intakes persist in PostgreSQL. An inspection belongs to the submitting browser session; unrelated sessions cannot attach it.
- Success follows a confirmed database write; errors preserve entered information. Operators can list submissions through a local authenticated database connection.
- Unit/integration tests cover connector authorization, evidence limitations, and durable intake. Build/lint/typecheck and browser verification pass.
- Independent Staff Engineer, Product Owner, and Product Designer reviews pass before the milestone commit.

## Reuse decision

Donor: private `tinchelk/growth-ai`, commit `99324a4`. Reused Next.js/React and Fastify/Prisma versions, TypeScript/ESLint settings, error conventions, separate frontend/backend boundary, and independent review workflow. Growth-marketing domain models, AI browser workers, and usage-credit billing are outside this service's pilot scope.
