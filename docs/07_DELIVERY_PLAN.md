# 07 — Agent execution slices and release gates

**Execution rule:** vertical slices, measurable exit tests, deterministic status reports. Do **NOT** implement the entire backend/admin before validating the actual fixture in an isolated offline PWA viewer. Each gate requires documented evidence; do not silently skip a blocked gate.

**Control Tower decision, 2026-11-25 — Android-first / virtual-first development.** The S1 Option B baseline `42d2a0e3cef3c5c80c53d2d3f119a8194687a9eb` is TECHNICALLY VERIFIED / PROVISIONAL. The owner authorizes S2 implementation and virtual verification while formal G1 acceptance is PENDING. This is a bounded exception to the sequential development stop at G1. Android is the primary development target. Physical Android is NOT RUN pending device access. iOS-specific work is DEFERRED, with no physical iOS run or compatibility claim. Existing functional, isolation and physical acceptance criteria remain in force. S2 local evidence supports a technical recommendation only. S2 commit authority, formal gate decisions and progression to S3 remain with the Control Tower. S1 approval and evidence (archived locally)

## S0 — Workspace/bootstrap (G0)

- Create pnpm workspace (`apps/child`, `apps/admin`, shared contracts, content lint, Supabase functions/migrations); pin runtime/package versions in lockfile.
- Set up Vite React TypeScript, child manifest+SW skeleton, admin shell, unit runner, Playwright/appropriate browser tests, local Supabase env templates, CI no prod credentials.
- Locate original `fixtures/rocks-soil.html`, verify exact 333,033 bytes and specified SHA. If absent, mark G0/G1 **BLOCKED**; do not fabricate the original.
- Document available actual Android/iOS test devices and browser versions; choose hosting origins/config strategy.
- Define test plan and threat model, confirm browser SW/IDB/CSP strategy before coding it.
- **Exit G0:** clean build, tests runnable, fixture verified, measurable G1 test matrix. No security unknowns concealed.

## S1 — PWA isolated lesson viewer proof (G1)

- Build the minimal child shell and worker with a fixed versioned passive wrapper precached as an application asset. Read the original authorized verified Blob from IndexedDB and mount its exact decoded source only in the opaque inner iframe after setting `sandbox="allow-scripts"`. Retire dynamic viewer responses.
- Implement technical preview of the same original on the separate admin origin with its corresponding wrapper and temporary local store. Verify expiry and close cleanup. Full admin integration remains G4.
- In Chromium, Firefox and WebKit, verify exact source, all 12 sections, nine JPEGs, six photo questions, 15 quiz questions and keyboard, pointer and emulated touch navigation. Exercise isolation, wrong wrapper and policy handling, redirects, fallback, offline browser restart and worker mixed-version behavior.
- Verify real airplane/offline, restart, SW activation/update, response policy and isolation on actual installed Android Chrome and Safari Home Screen. Document ordinary resource and API denials, observed self-navigation, and actual network and browser console evidence.
- **Exit G1:** documented fixture fidelity, offline behavior, isolation and technical admin-preview proof with physical target evidence. Preserve ADR-017's self-navigation qualification. If a required browser fails, STOP for a Control Tower architecture decision before changing the approved design.

## S2 — Local catalog and robust sync core with mocked server (G2)

- Implement IDB stores with typed migration, credentials, authorized snapshot, Blob+installed-version pointers, transaction-safe activation.
- Mock pairing, full catalog, staged changed files and offline UI; initial/foreground/reconnect/manual sync with concurrency 2, bounded backoff, SHA-256 verification.
- Prove partial success (1/100 ready before 100/100), v1 retained when v2 fails, stale multitab writes rejected, quota error aborts, storage eviction recovery, active viewer/GC safe.
- Add visibility and status UI, reset/unpair and SW shell precache lifecycle.
- **Exit G2:** AT-03/04/05/07/09/15/16/17 pass against mock and actual devices for browser-specific features. During Android-first development, verify the feasible subset on desktop Chromium, desktop Firefox and Android tablet emulation. List actual-device cases as NOT RUN or DEFERRED and leave formal G2 acceptance pending.

## S3 — Supabase backend and security (G3)

- Build clean migrations, seeded owner family/subjects, deny-by-default RLS/private Storage, owner registration by secure CLI, Edge gateway routes, token hashing/rate limiting, SQL transactional pair/publish/revision/catalog snapshot.
- Implement signed staged upload/finalize, immutable object validation/rollback, family-granted manifest and download-url, positive/negative contract tests.
- Measure actual max-20-MiB finalize against Supabase CPU/memory/runtime limits and browser CORS signed-download/upload access on deployed test project. Resolve via ADR if needed; no silent bypass.
- **Exit G3:** AT-08/11/12/13/14 and SEC-03/04/06/07 pass in isolated test deployment.

## S4 — Admin and end-to-end integration (G4)

- Build owner login, subject/lesson editor, upload/status/report, safe admin preview, publish/unpublish/rollback, family/pairing code and device revoke.
- Replace mocks with real device API and private Storage; complete child pairing, full catalog sync, partial download handling, reauthorization and error states.
- Check origin split, CSP on admin and PWA, browser CORS, no same-origin admin assets accidentally exposed to lesson.
- **Exit G4:** upload the original real HTML → preview/publish → pair a tablet → download → offline full lesson → publish v2 → safe delta sync and rollback, without shell update.

## S5 — Hardening and release (G5)

- Polish UX, accessibility, orientation, install instructions, quota/persistence descriptions, 100/1,000 item tests, SW upgrades, storage eviction and two-tab race regressions.
- Run all AT/SEC tests on physical Android Chrome and Apple Safari Home Screen Web App; document navigation residual risk without claiming a native sandbox.
- Prepare deployment/runbooks, owner seed, environment backups, headers, browser installation, release/rollback commands and evidence.
- **Exit G5:** every P0 pass with evidence; all known unsupported behaviors/limitations explicitly disclosed. No App Store/APK work.

## Required agent handoff artifacts

- `docs/verification/requirements.md` — requirement → implementation → test → observed result.
- `docs/verification/architecture-as-built.md` — exact components, schema changes and deviations.
- `docs/verification/setup.md` — origins, environment setup, Supabase migrations, RLS, buckets and owner seed.
- `docs/verification/g1-viewer.md` — physical test/browser proof and screenshots.
- `docs/verification/offline-sync.md` — crash/quota/eviction/rollback and multi-tab race results.
- `docs/verification/security.md` — CSP/sandbox network traces, security negatives and residual risks.
- `docs/verification/release.md` — deploy, rollback, backup, recover and user install instructions.
- `docs/verification/limitations.md` — unfulfilled tests, constraints and next ADRs.

## Uncertainty rules

- Freeze architecture at v2.0. Use small new ADR only for changes that affect viewer isolation, server auth, offline persistence, file format, owner visibility, hosting origin split or release platforms.
- If P1 feature threatens P0, skip P1. No promised periodic background polling or unsupported data persistence guarantees.
- Do not upgrade entire stack mid-slice without compatibility/security reason and reproducible test.
- No work in unrelated production Supabase projects.
