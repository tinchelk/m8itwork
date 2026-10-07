# Styled web form controls

User outcome: every visible customer and backoffice field belongs to the midnight workshop UI. Opening a repository or other selector must not open an operating-system menu.

Scope: shared accessible dropdowns for every existing select; repository identity and visibility styling; a matching calendar for proposal delivery dates; consistent text, numeric, password, URL and checkbox styling. Preserve field names, FormData, defaults, disabled/required behavior, form reset, short-lived account-scoped drafts, and existing API payloads.

Exclusions: backend/auth/payment changes, extra intake questions, new project workflows, custom browser/password-manager behavior, and worker changes. Semantic HTML input behavior remains; OS dropdown/date/checkbox/number appearance is replaced by web styling.

Acceptance:

1. Customer repository menus and all request, payment, stage, delivery, queue and agent selectors use the same navy/teal web UI, including their open menus. Long values wrap in menus and fit narrow viewports.
2. Labels, keyboard arrows, typeahead, Enter/Space, Escape, focus return, outside dismissal, scrolling, disabled fields and required validation work. Menus are not clipped by cards.
3. Submissions, draft restoration after refresh/navigation/OAuth, account isolation and successful form reset preserve current behavior. A pasted repository link and selected repository stay mutually exclusive.
4. The delivery date calendar is styled, keyboard usable, and submits/restores an ISO date. Past and invalid dates cannot be submitted. Consent checkboxes retain semantic/keyboard behavior and use a styled check mark.
5. Text/number fields share borders, spacing, focus/error/disabled states and mobile-readable sizing. No visible native selects, date popups or numeric spinner chrome remain across either app. Lint prevents new native select/date call sites.

Verification: browser tests for the custom-control interactions, validation, drafts, reset and actual submitted values, plus the existing frontend regression suite, lint, typecheck and both production builds. Capture desktop/mobile examples and obtain independent Staff Engineer, Product Owner and Product Designer review before the milestone commit and rollout.


Final verification — October 7, 2026:

- All 148 desktop/mobile browser checks passed, including 14 shared-field checks. The delivery calendar checks were repeated after waiting for its loaded grid before capturing the visual evidence; both passed.
- Frontend lint/typecheck and both customer/admin production builds passed. Dependency audit reported zero vulnerabilities; `git diff --check` passed and source scans found no remaining JSX select/option or native date input call sites.
- Required-value focus, keyboard/typeahead, menu dismissal, long-name scrolling, mobile 16px sizing, consent labels, invalid/past dates, original payloads, successful resets and account-scoped draft restoration are covered. A withheld calendar-body test confirms the synchronous date field restores and submits while the optional calendar is still loading.
- Staff Engineer: PASS, no blocking findings or deferrals. Independently repeated 12 focused desktop/mobile checks and the cold-calendar probe. The initial overly broad probe matched a required Turbopack startup stub; the corrected probe withholds only the calendar body and passes.
- Senior Product Owner: PASS, acceptable for the milestone, no blocking findings or deferrals. Existing intake requirements and customer/operator behavior remain intact.
- Senior Product Designer: PASS, milestone-ready with no remaining or deferred findings. The small invalid-border specificity finding was fixed and its pink border is asserted by the browser test; the keyboard focus outline remains visible.

Desktop/mobile menu and calendar screenshots are stored under ignored `backend/var/preview-styled-*`. Production rollout evidence is recorded in DEPLOYMENT.md after the exact-commit frontend uploads. No backend migration or worker update is required.
