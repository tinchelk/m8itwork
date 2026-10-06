# Milestone 1 verification — October 6, 2026

Implementation reviews pass. At the user's request, the current Milestone 1 implementation is being committed as a checkpoint before completing the live GitHub setup. Full milestone/launch sign-off remains open: a real private repository connection is a required acceptance path and has not yet been verified. This checkpoint does not claim launch readiness.

## Verified implementation

- Backend lint, TypeScript check, and production build pass.
- 20 backend tests pass, including real PostgreSQL persistence, browser-session isolation, OAuth replay/state/PKCE, read-only permission validation, delayed callback cancellation after disconnect/new connect, and saved-inspection removal/submission behavior.
- Frontend lint, TypeScript check, and production build pass.
- 16 browser checks pass across desktop Chromium and an iPhone-sized Chromium viewport. They cover manual save/failure/retry, connected inspection attachment, removal/reload, changed-repository fallback, new-feature requests, visible partial samples, focused workflow validation, keyboard FAQ access, labels, and horizontal overflow.
- A live public scan of `expressjs/express` retrieved commit `7ef9844`, 214 sampled files, and an explicitly limited static inventory. No build/tests/source execution occurred.
- Original generated midnight workshop artwork loads, with teal headings/copper actions and a distinct visual system. The desktop screenshot is `docs/preview-desktop.jpg`. Native iOS Safari focus behavior has not been exercised; mobile controls use 16px text.
- The local operator setup utility was independently exercised with mocked conversion and rejected Host/method/state/replay requests. It preserves configuration, writes credentials atomically with mode 600, and does not print credentials. The real environment was not modified by those tests.

## Independent reviews

- Staff Engineer: no blocking code findings. Delayed OAuth reconnection and selection restoration findings resolved. Setup utility code gate passes.
- Senior Product Owner: finish/fix/extend scope, honest assessment estimates, custom-feature intake, and operator proposal/payment tracking accepted. Full milestone sign-off remains open until the required live private path passes.
- Senior Product Designer: final midnight design and experience gate passes. Partial sample visibility, focused workflow validation, and mobile form legibility findings resolved. No remaining designer findings or deferrals.

## Background clarity follow-up

- Regenerated the same midnight scene with clean contours as `midnight-workshop-crisp.png`. Native source remains 1536 × 1024; the tool did not deliver the requested larger resolution. This change is described as sharper detail and delivery, not as a 4K asset.
- Raised this image's optimized quality from 75 to 95 and changed its responsive sizing from `100vw` to `max(100vw, 150vh)`, matching the 3:2 source under `object-fit: cover`. Tall screens now select a larger source instead of stretching a width-only derivative. Removed header/content backdrop blur while keeping dark-panel opacity.
- Frontend lint/typecheck/production build and all 16 existing desktop/mobile browser tests passed again. Live checks at 1280 × 720 and 504 × 844, DPR 2, loaded the new q95 image; neither viewport overflowed horizontally. Header and content backdrop filters are `none`.
- Visual evidence: `docs/preview-desktop-crisp.png` and `docs/preview-tall-crisp.png`.
- A direct optimized-image response was 1536 × 1024 WebP, approximately 452 KiB at q95. Next.js keeps the native-resolution ceiling rather than physically upscaling the PNG.
- Fresh Staff Engineer, Product Owner, and Product Designer follow-up reviews all pass with no findings or new deferrals. Each verified the clearer artwork, honest native-resolution limitation, unchanged product flows, and readable panels. These visual gates do not close the required real private GitHub path.

## Required live closure

1. Register the read-only GitHub App using `npm --prefix backend run github:setup` and <http://localhost:3122>, then restart the API. Alternatively configure an existing App using `docs/GITHUB_SETUP.md`.
2. Authorize the App and install it on a selected private repository.
3. Inspect that private repository and verify its pinned commit and stack evidence.
4. Verify rejection of an unshared private repository, isolation between browser sessions, and loss of access after disconnect.
5. Record results, close the three review gates for the full milestone, and commit the live-verification follow-up.

No deployment has been performed. Production HTTPS/origins, proxy/rate-limit configuration, durable database/backups, cleanup, and production GitHub callbacks remain documented deployment work.
