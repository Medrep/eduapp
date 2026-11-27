# 06 — Acceptance tests and evidence requirements

**Evidence policy:** all mandatory tests have stable IDs and reproducible output. Browser behavior must be observed, not inferred from source. Emulated mobile viewports are NOT a substitute for actual Android Chrome and Safari Home Screen tests. Do not report G1 passed until the original fixture is present and its hash checked.

**Android-first S2 verification, owner decision of 2026-11-25.** Use automated and virtual evidence to continue S2 under the [bounded delivery exception](07_DELIVERY_PLAN.md). Execute desktop Chromium, desktop Firefox and emulated Android tablet checks. Record unperformed physical Android checks as NOT RUN and iOS-specific checks as DEFERRED. Previous virtual iOS results remain historical. Formal G1 and G2 acceptance remains pending and no deferred case counts as passing.

## A. Functional P0 acceptance

**AT-01 — Pair and persistence.** Unpaired child PWA receives 15-minute one-use code from owner admin; pair once online; token stored in child-origin IndexedDB; one code cannot create second device, even concurrently. App reload stays paired while storage remains. Without network first pairing explains limitation. On Safari Home Screen pairing context is tested separately from Safari tab.

**AT-02 — Polish library.** Paired child sees only authorized subjects/lessons, counts, title and optional grade. Open subject → lesson → back returns to same scroll position. 360 CSS px and tablet portrait/landscape have no horizontal overflow, tap targets ≥44 CSS px, semantically accessible.

**AT-03 — Full and delta sync.** Publish 2 fixtures, pair, complete 2/2. Repeat sync: no HTML redownload. Update 1 lesson: only one version redownloaded. Seed 100 files; the first successfully installed files are usable before N/N finishes.

**AT-04 — True offline user journey.** After complete successful sync, Android Chrome installed PWA and iPad/iPhone Safari Home Screen Web App each reopen without internet, after app termination and device reboot. Shell, text, embedded JPEGs, interactive controls, quiz feedback and back navigation work entirely offline. Traverse all 12 fixture sections, decode all nine JPEGs, start and complete six photo questions and 15 quiz questions, and verify final-slide wraparound. Observe keyboard, pointer and touch navigation. Verify no required external lesson assets. If a browser clears data, this is covered by AT-15, not a false pass.

**AT-05 — Atomic updates, integrity.** Given installed v1, simulate interrupted v2 fetch, wrong hash, truncated size, 503, QuotaExceededError, tab kill before IDB transaction, browser crash during transaction, and malformed catalog. v1 remains openable for still-authorized lesson; no pointer without bytes. Next clean sync installs v2. Successful v3 of another lesson is usable while v2 elsewhere remains failed.

**AT-06 — No PWA redeploy for content.** With unchanged client JS/SW version, admin publishes a new HTML. Next successful authorized sync sees and downloads it. Offline works without store/app build or shell redeploy.

**AT-07 — State honesty.** UI exposes `Dostępne offline: N / M` only for exact installed desired versions, distinguishes usable old version from latest, shows pending/error/retry/expired auth/quota/SW-not-ready states. No endless spinners or raw errors.

**AT-08 — Family isolation.** Family A, B and shared lesson. Pair separate browsers. A sees A+shared, B sees B+shared. Cross-family catalog and signed URL requests denied without title/hash leakage; assignment removal hides item after successful new catalog and blocks future signed URL.

**AT-09 — Device disconnect/reset (P0).** Reset removes token, catalog, local lesson bytes for current browser context; returns to pairing. If other tabs block DB deletion, UI explains and retries; no deletion of unrelated origin data. Owner revoke denies new device API requests.

**AT-10 — Backend unavailable.** After sync, block Supabase DNS/API or return 503; local shell and installed lessons continue, no empty library overwrite. Invalid token response preserves offline bytes but stops further downloads.

**AT-11 — Owner auth / cross-origin.** Unknown Supabase Auth user cannot administer. Admin logout closes owner operations. Admin JWT is not sent to child origin; child token never enables owner action. Browser client bundles contain no privileged secrets. Test CORS allowlists.

**AT-12 — Upload validator.** Original fixture `rocks-soil.html` (333,033 bytes, SHA-256 `7590b609c72a5e454887707ed16a5e3de6bec759ea1fc2e88247f9654265566c`) validates and previews. Reject incorrect extension/type, non-UTF8, empty, >20 MiB, wrong digest, external script/link/img, worker/iframe/import/remote dependency. Confirm actual **20 MiB end-to-end finalize** meets deployed Edge memory/CPU limits, not just local mock.

**AT-13 — Publication/version rollback.** Draft invisible; publish v1 then install; upload v2 unpublished leaves v1; publish v2; republish v1; unpublish removes after successful authorized snapshot. Concurrent stale `expectedUpdatedAt` yields 409. No bytes overwritten; family assignment change increments revision atomically.

**AT-14 — Private owner-family default.** New lesson defaults to selected owner family `Dom`; invited family sees neither title nor download URL until explicitly assigned or `all` selected.

**AT-15 — Browser storage eviction/recovery.** Delete/evict IDB and/or shell cache (including independent cases), reopen while online/offline. Never show phantom `Dostępna offline`. Provide safe re-pair/redownload; unsupported `persist()` or denied grant does not block normal app, and no permanence guarantee is claimed.

**AT-16 — Verified passive wrapper and opaque viewer.** Observe exact wrapper URL, static bytes and build version, HTTP MIME/CSP/frame-ancestors/nosniff/no-referrer and early meta resource policy. Confirm lossless byte-to-source assignment after setting the exact sandbox, opaque origin, authored script execution and strict shell CSP. Reject wrong wrapper, redirects, stale/mixed versions, missing policies, SPA fallbacks and missing, corrupt or unauthorized local content before mounting. Retired viewer paths never deliver bytes. Confirm on both installed target platforms.

**AT-17 — Two-tab sync races.** Two tabs fetch revisions R and R+1 in opposite completion order. R cannot overwrite current catalog R+1. A stale download cannot install unauthorized/obsolete target after a new manifest removes or replaces it. IDB transaction replay and app reload prove no invalid pointer.

## B. Security acceptance

- **SEC-01:** malicious HTML cannot read parent DOM/token/IDB/admin origin/other lesson content, nor call privileged host APIs.
- **SEC-02:** external fetch/XHR/WebSocket/resources blocked by viewer CSP; malicious self-frame navigation tests record exactly what browsers permit. **Do not claim every possible navigation is blocked**; requirement is no parent privilege/secrets/data leak, and owner content contract forbids navigation.
- **SEC-03:** private storage listing and signed URL cross-family deny tests; revoked token denied for new requests.
- **SEC-04:** CSP deployed on shell and admin, no hidden inline/third-party scripts, no credentials in HTML or logs, RLS deny direct reads. Acknowledge token in browser IDB is script-readable by trusted origin.
- **SEC-05:** the separate admin origin's fixed preview wrapper and opaque inner iframe enforce the same integrity, response policy and denial checks. Observe exact validated file rendering, no owner storage or top navigation, close, stored expiry and active expiry after resumption at G1. At G4, retain server validation and tests of the older-version private URL and full admin workflow.
- **SEC-06:** TTL, one-use, concurrent pair and rate limit behavior.
- **SEC-07:** hash, size, signed URL/host, path and version checks; immutable version enforcement.

## C. Compatibility matrix (mandatory)

| Environment | Minimum evidence |
|---|---|
| Android device, current Chrome, installed PWA | G1 viewer complete, G5 pairing/sync/offline/reboot/security/landscape |
| iPad or iPhone, current Safari, installed Home Screen Web App | G1 viewer complete, G5 install/offline/reboot/storage behavior/viewport |
| Desktop Chrome + Firefox | Admin CRUD, preview, child fallback layout, security smoke |
| Small viewport ~360 CSS px | Polish layout, font scaling, no horizontal overflow |
| Browser throttled/503/network down | Retry, partial sync, last known good |
| Two tabs/browser contexts | Stale revision, reset blocking, SW upgrade |
| Browser storage cleared/full | AT-15, AT-05 |

Do not make a universal 'iOS supported' claim from a desktop Safari emulator alone. If no physical Apple test device is available, **G5 is blocked** unless target support is formally downgraded by a new ADR.

## D. Performance and coverage

**PERF-01:** seed 100 actual HTML lesson Blobs cloned from verified fixture under distinct IDs, and 1,000 metadata-only lessons. Measure: shell startup to local Home, first/complete download, offline open latency, viewer memory, IndexedDB/storage footprint and scrolling. No fabricated thresholds; record observed device/browser and bottlenecks. Prevent JS from holding 100 × 20 MiB in memory.

Automation:

- Unit: catalog diff/status reducer, URL/UUID path validator, safe version pointer, retry, checksum, quota error mapping, content lint, Polish text map.
- Integration: IDB transactions including injected abort/quota, SW response/CSP, two-tab races, migrations and storage loss.
- SQL: migrations clean DB, FK/unique, immutable version trigger, permission assignment/revision, atomic pair, cross-family deny.
- Edge Functions: admin JWT+active row, device token, URL generation, 20 MiB upload finalize, CORS/preflight, error schemas.
- Browser E2E: owner upload → publish → pair → download → offline fixture quiz → v2 rollback; malicious fixtures on Chrome/Safari.

## D2. Additional named acceptance gates

**UX-01 — Language, touch and accessibility.** All child/owner labels are Polish with correct diacritics. Check ≥44×44 CSS px targets, keyboard focus, screen-reader accessible labels, 1.3× font scaling, orientation and 360 CSS px widths. Color alone must never express availability.

**UX-02 — Offline readiness semantics.** A card is `Dostępna offline` only if a verified installed Blob exists under the authorized lesson's active pointer. An older installed version displays explicit update-pending state, and a brand-new lesson never displays ready before transaction commit. Test invalid IDB pointer and storage eviction.

**COMPAT-01 — Target browser/installation matrix.** Validate current physical Android Chrome installed PWA and a physical iOS/iPadOS Safari Home Screen Web App. Record OS/browser version, install process, SW scope, CSP headers, IndexedDB availability, suspend/reboot/reopen, and unexpected storage partitioning. No inferred support from desktop emulation.

## E. Release evidence required in `docs/verification/`

1. `versions.md`: Node, package versions, browsers, OS/device model, Supabase CLI/runtime and deploy target.
2. `build-tests.md`: install, lint, typecheck, unit, browser E2E and clean reproducible build commands.
3. `backend.md`: migrations, RLS negative cases, token/family/pair authorization and upload performance results.
4. `g1-viewer.md`: fixture hash, screenshots/video or equivalent inspection, wrapper response headers and meta policy, sandbox/opaque-origin results, offline and negative tests on **both** mobile platforms.
5. `offline-sync.md`: interrupted, quota, eviction, two-tab, SW update and restart results.
6. `security.md`: actual response headers, network traces, CSP errors, documented navigation residual risk and no-privileged-data exposure proof.
7. `release.md`: child/admin URLs/config, deployment/rollback instructions and owner onboarding; known limitations.
8. `requirements.md`: each FR/NFR/AT/SEC → implementation path → test → PASS/FAIL/NOT RUN with links.

**Every failed, skipped or unrun mandatory P0 must be a release blocker.** No unsupported claim of device test, secure isolation or completed product.
