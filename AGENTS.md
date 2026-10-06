# m8itwork agent workflow (inherited from Growth AI)

These instructions apply to the entire repository.

## Required fresh-eyes feature review

Every feature must receive three independent reviews before it is reported complete:

1. A **Staff Engineer reviewer**.
2. A **Senior Product Owner reviewer**.
3. A **Senior Product Designer reviewer**.

The reviewers must be fresh-eyes reviewers: they must not be the agent that implemented the feature. Use separate sub-agents for the two roles whenever agent delegation is available.

### Feature workflow

1. Read `docs/PRODUCT_DIRECTION.md`, the original requirements in `docs/HANDOFF.md`, and the current implementation documents relevant to the feature. Newer product-direction decisions take precedence when they conflict with the handoff.
2. Define the user outcome, in-scope behavior, exclusions, acceptance criteria, and verification approach before implementation.
3. Implement the feature and run proportionate automated and runtime verification.
4. Ask a fresh Staff Engineer reviewer to inspect the completed change without editing it.
5. Ask a separate fresh Senior Product Owner reviewer to inspect the completed change without editing it.
6. Ask a separate fresh Senior Product Designer reviewer to inspect the completed change without editing it when the feature includes a user-facing experience, workflow, UI copy, or visual system change. For backend-only work, record why the designer gate is not applicable.
7. Triage the applicable reviews, fix valid findings, and rerun affected verification.
8. Request another review when a fix materially changes the architecture, user flow, or acceptance criteria.
9. Report both review outcomes and any consciously deferred findings in the final handoff.
10. At a milestone boundary, create a milestone commit only after both review gates and final verification pass.

### Staff Engineer MVP review charter

Review the implementation for:

- correctness and failure modes;
- architecture and repository boundaries;
- MVP-critical security, privacy, authentication, authorization, and tenant isolation;
- API and data-model compatibility;
- migrations and rollback risk;
- concurrency, idempotency, and background-job behavior;
- MVP-critical observability and operational readiness;
- test quality and missing edge cases;
- maintainability and unnecessary complexity;
- frontend accessibility where applicable.

Findings should be evidence-based, ranked by severity, and include a concrete recommendation. Block release for correctness, data loss, privacy/credential exposure, broken authorization or tenant isolation, unsafe payment/external-action behavior, migration failure, or an acceptance-path failure. Defer non-blocking scalability tuning, broad performance optimization, and defense-in-depth hardening to the post-MVP backlog, with rationale. Never defer a finding that makes the MVP unsafe for its intended users. The reviewer should explicitly state when no blocking findings remain.

### Senior Product Owner review charter

Review the feature for:

- alignment with `docs/HANDOFF.md` and the current milestone;
- clarity of the user problem and intended business outcome;
- suitability for people finishing existing AI-built apps;
- accurate claims about repository inspection and preliminary estimates;
- completeness of the end-to-end user journey;
- one-next-action product principle;
- understandable language for non-marketing and non-technical users;
- acceptance-criteria coverage;
- empty, loading, error, blocked, and success states;
- measurement of business outcomes rather than activity alone;
- scope discipline and accidental future-milestone work;
- documentation and release-readiness gaps.

Findings should be ranked by impact on user value and acceptance. The reviewer should explicitly state whether the feature is acceptable for its milestone.

### Senior Product Designer review charter

Review user-facing work for:

- clarity of the primary user task and one-next-action hierarchy;
- modern, coherent visual and interaction design appropriate to the current product direction;
- cross-industry language and avoidance of design-partner-specific assumptions;
- understandable information architecture, labels, empty/loading/error/success states, and feedback;
- responsive behavior, keyboard flow, semantic structure, color contrast, reduced motion, and other practical accessibility basics;
- consistency with the shared UI system and avoidance of misleading visual claims.

Findings should be evidence-based, ranked by user impact, and include a concrete recommendation. The designer should explicitly state whether the experience is ready for its milestone. A backend-only feature may mark this gate not applicable with a concise rationale.

### Review independence

- Reviewers provide findings; they do not edit the implementation unless explicitly reassigned after their review.
- Do not prime reviewers to approve the work or omit known concerns.
- Give reviewers the feature brief, acceptance criteria, changed files, and verification results.
- Resolve blocking and high-severity findings before completion. Clearly document any lower-severity deferrals with rationale.

### What counts as a feature

This workflow applies to new or materially changed user behavior, API behavior, domain models, integrations, background workflows, authorization rules, and product flows. Pure formatting, typo-only documentation edits, and non-behavioral mechanical maintenance do not require the two-review gate unless they are part of a feature.

### Milestone commits

- Finish every milestone with a dedicated Git commit so reviewers can inspect a stable revision.
- Do not create the milestone commit until the Staff Engineer, Senior Product Owner, and applicable Senior Product Designer gates pass and final verification is green.
- Keep the commit scoped to that milestone and use a message such as `feat: complete milestone 2 business onboarding`.
- Report the commit hash in the milestone handoff.
- Do not amend, squash, rebase, or otherwise rewrite a reviewed milestone commit unless the user explicitly requests it.
