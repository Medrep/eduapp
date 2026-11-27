# Moja Nauka — Software Development Specification

**Document ID:** MN-SDD-001  
**Version:** 2.0.0 (PWA-first architecture freeze)  
**Decision date:** 2026-11-19  
**Primary targets:** installed Android Chrome PWA; iPad/iPhone Safari Home Screen Web App  
**Locale:** Polish (`pl-PL`)  
**Execution:** specification-driven development by an autonomous coding agent, gated by evidence

## 1. Product statement

A parent-managed family library of interactive, self-contained HTML study lessons. A single installable Progressive Web App (PWA) lets children browse subjects and interact with authorized lessons, including after a successful offline download. The parent uses a separate private web admin to upload, validate, preview, publish, replace and unpublish lessons. Server content updates need no app-store release. Content is one UTF-8 HTML file with embedded CSS/JavaScript/images per version.

**Primary use:** at home with Wi-Fi, occasionally offline. **Initial scale:** ~100 lessons; support a metadata catalog of 1,000 lessons. **No Apple App Store, Google Play or APK requirement.**

## 2. Architectural decision — approved for implementation, conditional release

- **Child client:** React + TypeScript + Vite PWA, Web App Manifest, Service Worker, IndexedDB (lessons/catalog), Cache Storage (versioned shell only).
- **Owner admin:** separate React + TypeScript + Vite SPA, hosted on **a separate origin** from the child PWA. Share schemas, NOT admin authentication state or UI authorization context.
- **Server:** dedicated Supabase project: Auth for sole owner, Postgres (RLS), private Storage, Edge Functions (two gateways for admin/device).
- **Viewer:** the trusted shell reads a verified, authorized installed lesson from IndexedDB and opens it in an opaque inner iframe under a Service Worker–precached passive wrapper. The iframe is configured with `sandbox="allow-scripts"` before its `srcdoc` receives exact decoded HTML. The trusted shell retains strict CSP. [Approved S1 amendment](docs/08_ADRS.md#adr-004--passive-pwa-wrapper-and-opaque-lesson-iframe-amended)
- **Sync:** full authorized family catalog; only modified HTML downloaded; SHA-256 + size verified before IndexedDB atomic installation; last working installed version survives unsuccessful updates.
- **Future:** the same PWA runs on supported Apple devices. Native applications are not planned. No Capacitor/Kotlin/Swift in MVP.

**Security caveat:** web platforms cannot guarantee all network activity from arbitrary hostile HTML is impossible (in particular frame-initiated navigation). Only owner-controlled, validated HTML is published; sandboxing prevents access to the PWA's credentials and data. The viewer threat model and residual risk are normative in `docs/05_SECURITY.md`. Do NOT copy claims of native-WebView-grade network denial from v1.

## 3. Release scope

**P0:** owner sign-in; subject/lesson CRUD; private family assignment (owner family default); upload and content-contract validation; isolated preview; immutable versioned publish/rollback/unpublish; family pairing and revoke; Polish PWA library and device disconnect/reset; verified complete-library download; offline PWA shell and interactive HTML; changed-version-only sync on startup/foreground/reconnect/manual; correct partial download/error states; safe cross-origin auth; CSP/sandbox viewer, negative tests; recovery after errors; testing on actual Android Chrome **and** iPad/iPhone Safari Home Screen; install and deployment documentation.

**P1 (not release-blocking):** title search, recent items, Wi-Fi-only preference, detailed progress bars and storage statistics, advanced device diagnostics, background-sync experimentation, update messages, polish dark mode. Basic numeric download readiness **is P0**.

**Out of scope:** native Android/iOS app; app stores; child account/profile/grades; cloud quiz scores; editing/generating HTML in app; telemetry/ads; payment/subscriptions; full multi-admin SaaS; ZIP/media-pack lessons; push notifications; scheduled guaranteed background sync; offline guarantees against browser data eviction; universal runtime prevention of a malicious lesson's own document navigation.

## 4. Traceable requirements

| ID | Requirement | Priority | Evidence |
|---|---|---|---|
| FR-001 | Owner-only web admin; no admin UI or session on child app origin | P0 | AT-11, SEC-04 |
| FR-002 | Subject/metadata CRUD and self-contained UTF-8 HTML upload ≤20 MiB | P0 | AT-12 |
| FR-003 | Sandbox admin preview of untrusted HTML | P0 | SEC-05 |
| FR-004 | Immutable versions; publish, replace, rollback, unpublish | P0 | AT-13 |
| FR-005 | Family-assigned content; owner family is private default | P0 | AT-14 |
| FR-006 | One-use pairing; no child's account/password | P0 | AT-01 |
| FR-007 | Polish Home/subjects/lesson list/reader/settings; responsive tablet/phone | P0 | AT-02 |
| FR-008 | Full authorized catalog saved; only missing/changed lesson bytes downloaded | P0 | AT-03 |
| FR-009 | Installed PWA shell and verified HTML work offline after restart/reboot | P0 | AT-04 |
| FR-010 | Interrupted/invalid download or storage error cannot replace good lesson | P0 | AT-05 |
| FR-011 | Published changes appear after authorized sync without client redeploy | P0 | AT-06 |
| FR-012 | Lesson executes JS in opaque-origin iframe without parent privilege | P0 | SEC-01, SEC-02 |
| FR-013 | Server-side family auth, private object storage, no public lesson listing | P0 | SEC-03, SEC-04 |
| FR-014 | Manual retry; honest `ready/downloading/failed/outdated` UX | P0 | AT-07 |
| FR-015 | Family/device pairing/revocation and explicit local disconnect/reset | P0 | AT-08, AT-09 |
| FR-016 | Browser may evict local data; app detects it and offers safe recovery | P0 | AT-15 |
| FR-017 | Existing verified content usable during backend outage | P0 | AT-10 |
| FR-018 | Verified lesson read from IndexedDB by the trusted shell and opened in an opaque inner iframe under a Service Worker–precached passive wrapper | P0 | AT-16, SEC-02 |
| NFR-001 | Legible Polish, ≥44×44 CSS px touch targets (48 preferred) | P0 | UX-01 |
| NFR-002 | No necessary remote lesson assets or imports | P0 | AT-12, SEC-02 |
| NFR-003 | Catalog/byte transactions and concurrency cannot create invalid active pointers | P0 | AT-05, AT-17 |
| NFR-004 | 100 real HTML lessons and 1,000 catalog entries tested; 20 MiB/file cap | P0 | PERF-01 |
| NFR-005 | No server secret in any web bundle; browser token risk documented | P0 | SEC-04 |
| NFR-006 | `Dostępne offline` only for a present, validated active local version | P0 | UX-02 |
| NFR-007 | Browser/standalone-PWA testing on Android Chrome and current iPadOS/iOS Safari | P0 | COMPAT-01 |

## 5. Normative documents and conflict rule

- `docs/01_PRODUCT.md` — user journeys and content constraints
- `docs/02_ARCHITECTURE.md` — PWA runtime, offline sync, passive-wrapper viewer
- `docs/03_DATA_API.md` — database, authorization, API and local schema
- `docs/04_UI_UX.md` — Polish screens, statuses, installation UX
- `docs/05_SECURITY.md` — trust model, CSP, residual risks
- `docs/06_TESTS_ACCEPTANCE.md` — acceptance and negative tests
- `docs/07_DELIVERY_PLAN.md` — gated development slices
- `docs/08_ADRS.md` — accepted decisions including superseded v1 choices
- `docs/09_CONTENT_CONTRACT.md` — future AI-generated HTML format
- `docs/10_OPERATIONS.md` — deployment, recovery, quotas, owner operations
- `docs/ARCHITECTURE_REVIEW.md` — source-to-v2 change log, sources, unresolved evidence

If wording conflicts, do not silently improvise. Prefer the more restrictive permission boundary, report a concrete decision request, and preserve offline data. `SPEC.md` defines scope; security document defines trust boundary; data/API document defines wire and persisted schemas.

## 6. Nonnegotiable development gates

**G0:** reproducible workspace, test harness, browser matrix and fixture verified on disk.  
**G1 BLOCKING:** supplied real fixture works offline from IndexedDB in the opaque iframe under the precached passive wrapper on Android Chrome and Safari Home Screen, and negative isolation tests demonstrate the bounded web security model. No backend build-out before this proof.  
**G2:** crash-safe local catalog/lesson installation with quota, multi-tab and eviction tests.  
**G3:** backend authorization, immutable storage/version transactions and upload limits.  
**G4:** admin→publish→pair→sync→offline full journey.  
**G5:** real-device testing, security regression, release and operation handoff.

**Release definition:** all P0 requirements have passing named evidence. A browser demo that opens the lesson only online, a fixture not tested on Safari, or a claim of universal network isolation without proof is NOT a release.
