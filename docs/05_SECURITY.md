# 05 — Security, privacy and realistic web trust boundary

## 1. Threat model

Assets: private lesson HTML, owner session/JWT, child device bearer token, family assignments, private Storage paths/signed URLs, app origin IndexedDB, backend signing/service-role secrets. Attacker models: untrusted/buggy AI-generated HTML; a malicious owner-uploaded lesson; an unauthenticated internet client; a revoked family/device; XSS in the trusted PWA/admin app; another browser tab; lost/compromised browser profile.

Trust zones:

1. **Admin origin** — trusted React/TS shell after Supabase owner auth. Must never run untrusted lesson HTML in its origin.
2. **Child PWA origin** — trusted React/TS shell, service worker and IndexedDB holding an opaque device token. Not equivalent to Android Keystore.
3. **Lesson iframe** — untrusted HTML and JavaScript with sandboxed **opaque origin**, unable to access parent DOM, cookies, IndexedDB, auth token or other lesson bytes.
4. **Supabase Edge Functions** — privileged server boundary; explicit owner/device checks for every route.
5. **PostgreSQL and private Storage** — RLS deny direct protected data and signed URLs generated only after server authorization.

### Security statement — NOT a native sandbox

The browser can isolate lesson JavaScript from the trusted app and block most remote resource/network APIs through CSP. It **cannot guarantee universal suppression of arbitrary frame-initiated navigation**. The contract therefore requires owner-only publishing, structural lint, strict iframe sandbox, per-viewer CSP, parent secrets inaccessible from the frame, and negative tests on each supported browser. Do not advertise a perfect offline-only network isolation guarantee for arbitrary malicious JS. No user data beyond the authored lesson should be visible to the iframe.

## 2. Required controls

**SEC-01 — Opaque-origin reader.** The trusted shell reads the currently authorized verified installed Blob. Only the inner iframe of a verified fixed wrapper receives the decoded HTML. Set exactly `sandbox="allow-scripts"` before assigning `srcdoc`. Omit same-origin, top navigation, popups, forms and downloads. Keep lesson HTML out of trusted DOM, wrapper markup and HTTP responses. No application↔lesson bridge. Verify denial of access to parent/top DOM, token, cookies, application storage, worker and other lesson data.

**SEC-02 — Inherited CSP and remote dependency contract.** The fixed passive wrapper delivers the exact resource policy in `02_ARCHITECTURE.md` §4 as HTTP CSP and early meta CSP. HTTP additionally enforces `frame-ancestors 'self'`. The inner document inherits resource restrictions. Observe denial of external script, style, image, media, fetch, XHR, WebSocket, workers, network frames and forms with browser and network evidence. A local descendant can remain opaque. The content contract still forbids authored frames and external navigation, and ADR-017's self-navigation limit remains in force.

**SEC-03 — Publication authorization.** Owner assigns family/explicit all. Every device catalog and signed URL request checks current server-side token, revoke status, enabled family, published status and active lesson version. 404/403 must not reveal other families' lesson details. No public buckets or direct listing.

**SEC-04 — Secrets and XSS.** Service-role, signing keys and pairing HMAC never in web assets. Admin Auth JWT only on separate admin origin. Device token in **trusted child-origin IndexedDB**, never inside lesson HTML/URL/iframe or logs; do not claim hardware encryption. Strict **shell** CSP with `script-src 'self'` (no inline, eval, or third-party scripts), `object-src 'none'`, `base-uri 'none'`, limited `connect-src` (approved Supabase API/Storage), `frame-src` restricted to the exact wrapper URL for that shell, `frame-ancestors 'none'`. Use per-origin HTTP security headers, HTTPS/HSTS, origin allowlisted CORS, dependency pinning and React escaped text. Check rendered deployed CSP in browser.

**SEC-05 — Safe admin preview.** A separate admin origin and store provide only validated preview bytes within their TTL. The trusted admin shell verifies the fixed passive preview wrapper and assigns exact decoded bytes only to the opaque inner iframe with `sandbox="allow-scripts"`. Recheck before mount and after suspension. Close or expiry removes the frame and bytes. The worker may cache the fixed public wrapper and serves no preview bytes, credentials or authenticated responses. Retain the authorized older-version flow for G4.

**SEC-06 — Pairing and revoke.** CSPRNG 10-character Crockford Base32 code, HMAC stored, 15-minute TTL, one use, atomic consume, ≤5 failed per issued code plus IP/global throttling. 256-bit opaque independent token, hash on server, current auth checked each request. Revoked device blocked server-side immediately; already downloaded offline material and existing short-lived signed URLs cannot be retroactively erased.

**SEC-07 — Upload and integrity.** Validate bytes from private staged object on server (UTF-8, actual size ≤20 MiB, digest, self-contained contract). Immutable file paths, no overwrite. Child validates signed download host/protocol, exact hash/size and active authorized version before IDB atomic installation. No arbitrary URL fetcher or unauthorized viewer file path.

**SEC-08 — Privacy.** No child name, school, location, profile, cloud quiz score, analytics or marketing SDK. Device/family labels and optional local last-opened timestamp only. Document storage persistence limitations, how to reset, what admin sees, and family-level visibility.

**SEC-09 — Operations.** RLS and cross-family negative tests; request size limits; token-safe structured logs; Postgres metadata and Storage backup schedule; production/dev environment separation; dependency pinning; secure static asset headers; cleanup of stale uploads. Never automatically delete rollback-eligible server versions.

## 3. CSP inheritance and wrapper integrity

The shell remains strict and unframeable. The wrapper is a fixed passive asset on that shell's origin. Its header and early meta CSP provide the inheritance scope for the nested `srcdoc` document. The inner iframe's sandbox attribute provides the origin boundary. Check response and loaded wrapper identity, expected version, MIME, policy and fixed content before any assignment. Reject missing headers, missing or wrong meta policy, redirects, stale assets and SPA fallbacks. Retire former viewer routes with a fail-closed response at both worker and host. Test the actual wrapper responses and the approved sandbox on required devices.

The browser still may navigate its **own** iframe to another URL if code requests it; lack of uniform cross-browser `navigate-to` enforcement is why the publication contract bans external navigation and residual risk is documented. No server or PWA data outside the authored iframe document may be exposed to it.

## 4. Required negative fixtures/tests

1. Lesson attempts `parent.document`, `top.document`, app IndexedDB, `localStorage`, cookies, SW access and other lesson data; no privileged data/bytes accessible.
2. Lesson attempts `fetch`, XHR, WebSocket, `<script src=https:>`, `<img src=https:>`, CSS `@import`, `<iframe>`, Worker; blocked and logged in browser console/test capture.
3. Lesson attempts `location.href`, anchor click, `window.open`, form submit and data/intent/file URLs; document actual browser network/navigation behavior. Never claim full navigation isolation without evidence; parent must remain on trusted app screen, no sensitive data leak.
4. Admin preview attempts to steal JWT/cookies or navigate parent; blocked. Admin React never evaluates lesson HTML.
5. Family B token requests Family A only lesson/catalog/download URL; no metadata leak. Anonymous direct Postgres/Storage listing denied.
6. Revoked device token, expired/reused codes, concurrent pair code and brute-force attempts denied.
7. Tampered SHA, truncated signed Storage response, path traversal/UUID, stale signed URL, invalid wrapper and retired viewer paths rejected; last-known-good installed lesson preserved.
8. Exercise wrong wrapper URL or version, missing or changed policies, redirects, SPA fallback and mixed worker builds. Verify no lesson iframe is created. Verify the trusted read rejects unauthorized identifiers and cannot expose other lesson bytes.
9. Browser storage eviction and infected shell conditions handled honestly: loss of storage causes redownload; **trusted-shell XSS is a high-impact incident**, not something the iframe protects against.
10. Confirm CSP policies apply as intended after SW lifecycle upgrade and on Android Chrome/iOS Safari installed contexts.

## 5. Explicit residual risks and mitigations

| Risk | Limit | Mitigation |
|---|---|---|
| Browser evicts IndexedDB or Cache Storage | Offline files unavailable until redownload | Online recovery, persistence request, honest status |
| Malicious HTML initiates own navigation | Cannot uniformly prohibit across all browsers | Owner-only validation, iframe isolation, lint, review, test, no secrets in iframe |
| Trusted child shell XSS | JS-readable device bearer token may be stolen | Strict shell CSP, separate admin origin, no third-party scripts, code review, revoke |
| Offline device revoked by owner | Cannot remove already stored files remotely | State limitation, delete on next authorized sync/reset |
| Signed URL already issued | May remain valid until URL expiry | Short TTL, don't log URLs, per-request authorization |
| Browser clears stored token | Pairing lost | Owner generates a new code; device revoke as needed |
| Browser quirks/updates | Sandbox/CSP/SW behavior may change | G1/G5 physical-device matrix and periodic regression |

## 6. Authority and sign-off

The PWA trust model is **conditionally accepted** for a trusted single-owner content publisher and family use. If requirements later expand to content by untrusted third-party publishers or guaranteed zero outbound connection from arbitrary HTML, **PWA viewer is not approved for that threat model**; an ADR must re-evaluate isolation or product scope. The release must not bypass G1 security verification.
