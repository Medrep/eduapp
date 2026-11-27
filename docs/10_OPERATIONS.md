# 10 — Environments, deployment, recovery and operator runbook

This file is normative for implementation/release. Provider-specific URLs and credentials must be supplied by the operator; no fabricated production configuration.

## 1. Environments and origin separation

- At minimum: **local/dev**, **staging/test**, **production** Supabase resources. Use a dedicated Moja Nauka project; do not reuse unrelated services' privileged keys.
- Production static child PWA and owner admin must be on separate HTTPS **origins** (e.g. `app.<owned-domain>` and `admin.<owned-domain>` only as example labels; configure actual hostnames at deployment).
- Child Service Worker scope must not cover the admin origin. Admin preview SW scope limited to the admin origin, its handler to a fixed preview route, no cross-user caching.
- Configure explicit CORS allowlists for two origins; never use `*` with credentials/authorization. Test `Authorization` preflight, private Storage direct staged upload and signed download `fetch` from browser.
- HSTS/HTTPS, `X-Content-Type-Options`, strict shell CSP, Referrer-Policy, safe iframe/permissions policy, clickjacking defense, immutable hashed assets. Do not attach permissive lesson CSP globally to app/admin shell.
- Ensure SPA route fallback does **not** override the service-worker-only virtual lesson path on uncontrolled clients. An offline unready SW should show a clear error rather than fetch remote content.

## 2. PWA shell deployment

1. Install reproducible pinned dependencies, typecheck/test/build both React apps.
2. Generate `manifest.webmanifest`, icons, stable `start_url`, `scope` and versioned precache asset manifest for child shell. No remote font/assets.
3. Serve `sw.js` with update-appropriate caching policy so new releases can be discovered; hashed JS/CSS with immutable caching. Do not delete old shell assets before a new SW is ready.
4. Verify child PWA install on Android Chrome and Safari Home Screen on an actual Apple device. Safari instructions must be user-visible; there is no universal install prompt.
5. Verify headers on **actual deployed URLs**, not only Vite dev server; confirm viewer virtual response CSP from Service Worker.
6. Rollback shell by redeploying prior known-good assets and SW; preserve IndexedDB and support migration compatibility.

## 3. Supabase operator setup

- Create separate project/env, enable Auth only for owner, manually mark designated `admin_users.active=true` through controlled migration/CLI; never authorize by email string alone.
- Run SQL migrations, seed `Dom` and subjects, check FK/immutable constraints and RLS negative tests.
- Create private `lesson-bundles` and `lesson-staging` buckets. Enforce size limits and no public listing. Configure upload and signed URL expiry/cleanup.
- Deploy `admin-api` and `device-api` functions with scoped secrets, custom opaque-token verification and rate limiting; no service-role key shipped client-side.
- Confirm actual Edge runtime limits and **20 MiB finalize** with fixture + synthetic max size; if it fails, do not weaken validator. Change through ADR and rerun tests.
- Configure backups for Postgres metadata and protected Storage; periodically test restoration and retention of rollback-eligible versions.

## 4. Routine owner operations

**Publish:** sign in on admin origin → create metadata → ensure family `Dom` selected unless intentional sharing → upload single HTML → validation → sandbox preview → publish → verify device next sync.

**Update:** upload new version to existing lesson → preview → publish with optimistic revision → next sync installs only changed bytes; previous installed local version remains accessible if new download fails.

**Rollback:** choose prior validated immutable version → `Opublikuj tę wersję` → a new catalog revision makes devices reconcile; do not overwrite old Storage object.

**Unpublish / revoke:** changes deny future authorized manifest or signed URL; already cached offline content may survive until device reconnects and syncs, and previously signed URLs can work until expiry. Explain these limits to owner.

**Pair new device:** generate code in admin (single use, 15 min), enter on child PWA in each independent browser/installed context. A separate Safari tab and Home Screen context may require separate pairings.

**Reset local library:** settings action deletes child-origin credential/authorized catalog/lesson Blobs after confirmation. Other tabs may need closing. Reset cannot affect other devices, another origin, or a separate browser context.

## 5. Storage, quota and recovery

Browser quota and storage retention are not guarantees. App should request `navigator.storage.persist()` where supported, observe `navigator.storage.estimate()` only as estimate, check key records/verified Blobs before claiming offline readiness. If a device/browser clears data, owner can generate new pairing code and the PWA redownloads from server when online. No data entered by children should be lost because the product stores no cloud scores or user-created content.

For quota failures, abort new version transaction, retain old installed, surface `Brak miejsca`; allow system cleanup or reset, then retry. Do not auto-delete active verified lessons to make space. Cleanup obsolete stored versions safely and only following successful current catalog validation.

## 6. Incident and outage behavior

- **Supabase down:** synced catalog and lessons continue offline, owner cannot publish and new devices cannot pair until service restored. No empty catalog overwrites offline state.
- **Bad lesson published:** owner unpublishes, devices hide it next authorized sync; disconnected devices retain bytes until sync; consider emergency owner communication. Validate server and content lint before publication.
- **Child bearer token compromised:** revoke device server-side and issue fresh pairing. Trusted-shell XSS requires security incident response and shell patch; token is not hardware isolated.
- **Service Worker bug:** rollback shell, test old/new SW and prevent silent content deletion; if SW cannot serve virtual lesson route, show truthful error.
- **Loss of signing keys:** rotate in backend, update Edge secrets and assess signed URL windows; never reveal service-role secrets in frontend.
- **RLS or cross-family leak:** disable relevant endpoints, investigate, rotate tokens/URLs as appropriate; do not claim previously issued signed URLs individually revocable.

## 7. Monitoring and budget discipline

Minimum logs: request ID, endpoint, status, safe error code, duration, upload size bucket, anonymous high-level rate limits; **never log raw pairing codes, tokens, signed URLs, HTML content or child identifiers beyond necessary device ID**. No third-party tracking SDK. Capture aggregate operational errors if needed without child analytics.

Avoid a second backend/cron platform solely for minor cleanup; start with supported Supabase scheduled features or operator-run documented cleanup and escalate if operational evidence requires it. Keep lesson storage usage observable via Supabase billing/Storage and manual management.

## 8. Release checklist

- [ ] Actual fixture present, hash matched and all interactive elements tested on both physical target platforms.
- [ ] G0–G5 pass and recorded in `docs/verification/`.
- [ ] Child/admin hosted on different HTTPS origins; CSP, security headers and CORS inspected in deployed browsers.
- [ ] Offline app shell, SW virtual viewer, IDB recovery, quota and multi-tab sync tests green.
- [ ] RLS cross-family/auth negative tests green; no privileged secret in bundles.
- [ ] Browser storage eviction, token security and iframe navigation limitations disclosed.
- [ ] Owner instructions for pair/update/revoke/rollback and backup/recovery written.
- [ ] Rollback of SW/static assets and Supabase schema rehearsed.
