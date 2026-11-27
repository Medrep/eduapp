# 02 — Architecture, offline persistence, viewer and synchronization

## 1. Boundaries and topology

```text
 admin.<owned-domain> (React + Vite SPA)              app.<owned-domain> (React + Vite PWA)
    | Supabase owner JWT                                 | opaque device token (IndexedDB)
    v                                                    v
 Supabase Edge Function: admin-api                 Supabase Edge Function: device-api
                  \                                      /
                   \                                    /
                    --> PostgreSQL / private Storage <--
                         Supabase Auth (admin only)

 app origin, offline:
  IndexedDB (authorized catalog + verified HTML + token) --> trusted React shell
  Service Worker precache --> fixed passive wrapper (versioned URL, header + meta CSP)
  Trusted shell verifies the wrapper --> opaque inner iframe (allow-scripts, srcdoc)
  Cache Storage: versioned shell and wrapper assets only
```

The admin and child app **MUST be different origins**. They may share monorepo schemas but never share authentication UI/session state. Server authorization is mandatory on every device API call; no device direct Postgres/Storage listing. All app shell and viewer routes use HTTPS; SW works on secure contexts.

## 2. Monorepo layout (normative intent)

```text
apps/child/             React, TypeScript, Vite PWA, service worker, viewer, IDB, sync
apps/admin/             React, TypeScript, Vite, Supabase Auth admin UI
packages/contracts/     Zod runtime schemas, inferred TS types, wire error codes
packages/content-lint/  Offline lesson structural validation (server and local test)
supabase/migrations/    SQL migrations and transaction functions
supabase/functions/     admin-api, device-api and shared authorization helpers
fixtures/               original real HTML + explicit malicious test fixtures
scripts/                test, migrate, build, CSP checks, reproducibility
 docs/verification/     implementation-generated evidence only
```

Pick **pnpm** with an exact lockfile and record Node runtime; Vite PWA integration may use a mature plugin, but do not install a separate framework merely for offline support. No Next.js, Capacitor, Kotlin, Redis, separate FastAPI server, message broker or Docker-based platform in MVP.

## 3. Storage split and browser limits

| Storage | Contents | Source of truth | Eviction |
|---|---|---|---|
| Supabase Postgres | published metadata, assignments, revisions, tokens (hashed) | authoritative server | operator backups |
| Supabase Private Storage | immutable version HTML and pending uploads | authoritative server | operator backups |
| Child IndexedDB | device token, last authorized catalog, installed version records, verified HTML bytes | trusted local offline snapshot only | **browser may clear** |
| Child Cache Storage | versioned app shell/assets and offline navigation fallback | reproducible build assets | **browser may clear** |
| Memory | in-progress downloads, hashes, transient URL state | nonauthoritative | always ephemeral |

Do **not** use browser localStorage for credentials or large binaries. IndexedDB token is **not encrypted by hardware Keystore**; it is protected only by browser origin isolation and the device's security model. This is a conscious tradeoff. Call `navigator.storage.persist()` when supported, and use `navigator.storage.estimate()` for advisory space/status; neither guarantees bytes will persist.

### IndexedDB v1 — logical schema

Database `mojanauka-child-v1` with stores:

- `identity`: singleton key `identity`, value `{schemaVersion:1, deviceId, familyId, familyLabel, deviceToken, pairedAt}`.
- `authorizedCatalog`: singleton key `current`, exact validated server snapshot plus `{receivedAt,lastSuccessfulSyncAt}`. This *determines what is visible*; it is never replaced by network errors or unsupported schemas.
- `lessonBytes`: key `[lessonId,versionId]`, `{lessonId,versionId,sha256,sizeBytes,blob: Blob,verifiedAt}`. `blob` contains the exact UTF-8 HTML bytes; no base64 conversion.
- `installations`: key `lessonId`, `{lessonId, installedVersionId,sha256,sizeBytes, installedAt, lastOpenedAt?}`. For new pending lessons, no installations record; for updates, may reference a previous version.
- `syncMeta`: singleton, `{lastAttemptAt, lastErrorCode?, storagePersistenceGranted?: boolean}`. Per-item transient progress is UI state and not an authorization source.

All IDs are strict UUIDs. Never derive arbitrary paths/URLs from lesson metadata. On startup, read identity/catalog/installed records and show only catalog-authorized lessons. Verify the exact `lessonBytes` key before displaying ready. Before mounting, the trusted shell checks current authorization, installed pointer, version and size, then verifies the exact Blob digest. Missing, corrupt, stale or unauthorized data yields a shell-visible unavailable state with no remote lesson fallback.

### Atomicity invariants

- `lessonBytes.put(verifiedBlob)` and `installations.put(pointer)` run in **one readwrite IDB transaction**. If quota/aborted/crash, neither an invalid pointer nor a partial active file is committed.
- `authorizedCatalog` is committed separately, as soon as a **complete, validated, successfully authenticated** response arrives. This permits immediate removal of revoked visibility and display of newly published, not-yet-downloaded lessons.
- Each completed lesson download is committed immediately, independently of other items in queue; **do not wait for N/N completion**.
- Older installed version stays openable for authorized lessons while the new version is missing/failed; status is `update_pending`, never falsely `ready_for_latest`.
- A stale concurrent manifest result with `revision < current.revision` cannot overwrite current. For equal revision and same family, response is idempotent. IDB transaction checks the currently stored revision at write time.
- Before committing a downloaded version, re-read current catalog in the same installation transaction: lesson must still be authorized and requested `versionId` must still match desired version. Otherwise discard it.
- Reset/re-pair across different families requires full local wipe and new identity. Never merge catalogs between families.

## 4. Service Worker and passive wrapper

1. Precache versioned shell JS/CSS/icons, offline navigation fallback, web manifest assets and the fixed versioned passive viewer wrapper. Cache no lessons, authenticated Supabase responses or signed Storage URLs.
2. Serve a verified child shell offline. Preserve the old functional shell and wrapper until the next asset set is ready. Preserve IndexedDB across cache retirement. Cold offline startup, an uncontrolled shell and mixed shell/wrapper versions require a clear unavailable state.
3. Each shell allows framing only its exact same-origin wrapper URL for the build and sets `frame-ancestors 'none'` for shell documents. Reserve the exact wrapper path at the host before redirect and SPA rewrite rules. Reserve and reject the retired dynamic lesson and preview namespaces before those rules. Workers serve only fixed wrapper assets and never return lesson or preview bytes as navigation responses.

The wrapper is an immutable, build-owned UTF-8 HTML asset with fixed metadata and style and no executable code or lesson interpolation. Return `Content-Type: text/html; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and the enforced CSP below, plus `frame-ancestors 'self'` in the HTTP header. A fixed early meta policy repeats the resource directives. The two application shells retain `script-src 'self'` without inline or eval allowances.

```text
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data:; font-src data:; media-src data:; connect-src 'none';
worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none';
base-uri 'none'
```

Verify the exact static asset, response status, URL, MIME and headers, build/version marker and policy metadata before mounting. Reject redirects, fallback documents, missing policies and mixed versions. Confirm the loaded wrapper is the same verified wrapper before assigning lesson content.

## 5. Iframe isolation and hard limits

The trusted shell losslessly decodes the authorized verified UTF-8 Blob and assigns it only to the nested iframe's `srcdoc`. Create the inner iframe with exactly `sandbox="allow-scripts"` before assignment, no `allow-same-origin` or navigation, popup, form or download grants. Set no-referrer and deny feature permissions. Keep lesson bytes out of wrapper markup, URLs, application DOM and messages. Tear down the frame and release decoded source references on close, replacement or a failed mount.

The inner iframe inherits the wrapper resource policy and has an opaque origin. It cannot read application or wrapper DOM, IndexedDB, tokens or owner auth. Verify that ordinary remote resources and network APIs are blocked. A locally created descendant can remain opaque. Authored frames remain prohibited. ADR-017's bounded self-navigation qualification remains in effect. G1 must observe navigation behavior and stop for data exposure or isolation failure.

## 5A. Admin preview on its separate origin

After server `upload-finalize`, write only the validated HTML bytes to admin IndexedDB (`mojanauka-admin-preview-v1`, `previewBytes[previewUuid]`) for at most ten minutes. For an older version, obtain the owner-authorized short-lived private download, verify exact bytes and write the same temporary store. The trusted admin shell checks eligibility before mounting and on return from suspension. Close or expiry tears down the frame and removes the preview bytes. The same verified-wrapper and opaque inner-frame contract applies. Keep admin storage separate from the child's catalog and IndexedDB.

The separately scoped admin worker may precache the fixed public admin wrapper for technical preview. It serves no preview bytes, credentials or authenticated responses. G1 demonstrates the technical preview. Owner auth, server finalization, older-version private fetch and full admin integration are G4 work. The technical proof does not establish offline authenticated admin support.

## 6. Sync algorithm (authoritative)

1. Triggers: after pairing; foreground load, visible tab return, `online` event, manual `Synchronizuj`. Debounce and single-flight within a context. **No guaranteed background sync**; user must open app for updates.
2. Always start UI from last authorized IndexedDB snapshot, without waiting for network. If absent, show unpaired/no-data status.
3. Request full family-filtered `GET /device/v1/catalog` with opaque token. Always use 200 + full snapshot for MVP. Reject invalid schema, unsupported major, inconsistent UUID/hash/size, or family mismatch. Never clear catalog on 401/403, timeout, 500 or malformed payload.
4. In an IDB readwrite transaction, compare revision to saved revision; commit only if same family and fresh/equal. Immediately hide records removed by new authorized snapshot. On token 401/403 mark sync unavailable, retain offline files and prompt parent; server access remains revoked.
5. Compute required `(lessonId,versionId,sha256)` entries absent from `lessonBytes` / `installations`. Enqueue with max **2** concurrent downloads, with bounded retries. Do not download unchanged versions.
6. For each item, POST download-url with token, confirm returned version/hash/size matches catalog, fetch signed HTTPS Storage URL using browser `fetch` (CORS must work), enforce max size **while reading stream**, verify status, length and SHA-256 using Web Crypto before IDB write. Signed URL expires: obtain a fresh URL and retry. Drop token/signed URL from logs.
7. Commit this verified version Blob and installed pointer *together* in one IDB transaction after rechecking authorized current catalog entry; update UI success immediately. A failed new version leaves a previously installed version untouched. Do not buffer an entire library in JS memory.
8. Cleanup obsolete/orphan versions only after successful new catalog/installation and when no open viewer needs them. Keep the current installed version (and optionally one prior version if quota allows) for authorized lessons; deletion may be conservative.
9. `allDownloaded` means every current authorized desired version is present and verified; a previous version usable during update does **not** count as updated. Report `N/M` and current per-lesson status.
10. For overlapping tabs/standalone contexts, the revision and installed-version checks inside IDB transactions are **the correctness mechanism**. BroadcastChannel may update UI but must never be the sole lock. Do not assume `navigator.locks` works everywhere.

## 7. Recovery and failure modes

| Condition | Behavior |
|---|---|
| Internet unavailable after full sync | Shell, catalog, and all installed HTML work offline if browser storage retained |
| First run offline / SW not controlled | Explicit first-connection/SW-ready message; no false offline readiness |
| Partial initial sync | Show immediately installed items, remaining marked pending |
| Broken v2 / wrong digest / interrupted response | Keep v1 installed; retry v2 |
| QuotaExceededError / browser eviction | Preserve transaction atomicity; refresh local readiness; show re-download/re-pair instructions |
| Catalog response 401/403 | No new downloads, prior offline content remains; no claim of continued server authorization |
| New valid catalog removes assignment | Hide item immediately; safe cleanup later |
| Signed URL expires | Reauthorize download and retry; never persist URL |
| 1,000 catalog entries | Render responsive list; measure rather than prematurely add virtualization |
| Unsupported DB schema version | Stop migration and preserve accessible data when possible; display upgrade/recovery route |
| SW update breaks the shell/wrapper version binding | G1/G5 regression; don't activate destructive update silently |

## 8. Deployment

Child PWA and admin are immutable HTTPS static builds on **separate origins**; PWA origin SW scope limited to child site. The backend is a dedicated Supabase project/environment with separate dev/test from production. CI should validate both deployed origins' security headers and CORS. Neither client may contain Supabase service role key or pairing HMAC secret.

Host choice and exact domain names are **deployment configuration**, not architecture justification. Document confirmed CDN behaviors (SPA fallback, `sw.js` no-cache validation, response headers, CSP, `manifest.webmanifest`, icon caching, preview isolation) before release. See `10_OPERATIONS.md`.
