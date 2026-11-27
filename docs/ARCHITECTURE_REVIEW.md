# Architecture review and decision log — Moja Nauka v2.0

**Review date:** 2026-11-19  
**Input baseline:** uploaded `SPEC(1).md` v1.0.0 and nine accompanying documents `01_PRODUCT.md` to `09_CONTENT_CONTRACT.md`.  
**Result:** PWA-first target architecture **approved for development**, NOT certified as implemented or verified on devices. G1 physical-device viewer proof remains release-blocking.

## 1. Rationale

Original v1 targeted Android/Capacitor with a privileged React WebView plus Kotlin secure offline plugin and separate Kotlin WebView viewer. Under updated product assumptions, app-store distribution is not planned, most use is at home with Wi-Fi, up to ~100 lessons expected soon, occasional offline access remains required, and iOS should work without a separate binary. A single installable PWA reduces native-specific boundaries, Kotlin/Capacitor bridge, APK signing and the need for two mobile clients.

The backend, versioned private HTML storage, no child profiles, family assignments and single-owner admin remain good design and were retained. We deliberately accept browser-owned storage eviction and the web iframe navigation limitation; we do not silently pretend they are equivalent to Android sandbox/Keystore controls.

## 2. High-impact v1 → v2 changes

| Area | v1 | v2 |
|---|---|---|
| Client | React/Vite/Capacitor Android APK | React/Vite PWA on Android/iOS |
| Native viewer | Kotlin ViewerActivity / isolated WebView | Opaque-origin iframe with SW-served HTML response CSP |
| Files | Android private files, AtomicFile | IndexedDB Blob + installed pointer in one transaction |
| Credential at rest | Android Keystore encrypted | JS-readable child-origin IndexedDB (risk explicitly documented) |
| Offline shell | Android binary | versioned Service Worker Cache Storage |
| Sync | Native plugin + JS coordinator | TS coordinator, Web Crypto, IDB, browser fetch |
| Distribution | Signed APK | HTTPS deployment, Home Screen install |
| iOS | Future native port | Same PWA, physical Safari compatibility gate |
| Network protection | Native WebView interception + CSP | CSP/sandbox, owner-only content; iframe self-navigation residual risk |
| Admin preview | iframe / optional isolated preview | Dedicated admin SW local preview route, opaque iframe |
| Update transaction | Batch catalog commit ambiguity | Immediate per-lesson atomic installation, separate authorized catalog |
| Device reset | Previously P1 conflict | P0, required for browser identity recovery |
| Recent | Previously P0/P1 conflict | P1 consistently |
| PWA storage eviction | Not applicable to native private files | P0 recovery and tests |

## 3. Architectural findings resolved in v2

1. **srcdoc CSP inheritance:** iframe `srcdoc`/blob policies can inherit strict app CSP and block inline quiz JS. Solution: SW synthetic viewer response with own CSP header; empirical G1 in Chrome/Safari.
2. **Partial sync:** a batch-wide commit can delay usable files. Solution: independent atomic IDB commit per installed lesson; immediately usable while remaining queue runs.
3. **Browser token security:** cannot claim Android Keystore. Solution: explicit JS-accessible token in child-origin IDB, separate admin origin, CSP and no untrusted lesson same-origin.
4. **Multi-tab stale updates:** revision checked transactionally; download activation rechecks current authorized target.
5. **Signed URLs / revoke:** current server authorization for *new* URL, existing signed URLs may survive to expiry; offline bytes cannot be remotely erased.
6. **Supabase Edge finalize limits:** 20 MiB validation must be tested with real deployed runtime; code must not bypass checks if CPU/memory limit hit.
7. **Admin preview:** same trust boundaries as child reader but separate origin and local preview SW route to avoid token-bearing HTML URL or trusted DOM injection.
8. **Browser eviction:** offline readiness describes *currently present data*, not guaranteed permanence; re-pair/redownload recovery.

## 4. Open *verification* items, not unresolved architecture choices

- Original `fixtures/rocks-soil.html` was **not included** among uploaded specification files. Need exact 333,033-byte file and SHA-256 match before G1. No visual/functional compatibility was verified during this documentation review.
- Browser behavior of SW-synthetic navigation response headers, opaque-origin iframe, whole lesson and self-navigation must be tested on real Android Chrome and Safari Home Screen.
- Browser Storage CORS for signed Supabase downloads and signed uploads must be tested in an actual staging deployment.
- Worst-case 20 MiB server-side finalize under current Edge Function limits needs evidence or a new ADR-backed approach.
- Hosting provider, exact domain names, account secrets and physical target device models are configuration inputs to the implementation agent.
- All P0 acceptance tests are currently **NOT RUN**; architecture approval is not release approval.

## 5. Source references used in architecture review (checked 2026-11-19)

- MDN, Storage quotas and eviction: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- WebKit, Updates to Storage Policy: https://webkit.org/blog/14403/updates-to-storage-policy/
- MDN, Using Service Workers: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
- MDN, iframe `srcdoc` and sandbox: https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/srcdoc
- W3C, Content Security Policy 3 and CSP inheritance: https://www.w3.org/TR/CSP3/
- MDN, CSP sandbox: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox
- Supabase, Edge Functions limits: https://supabase.com/docs/guides/functions/limits
- Supabase, Storage serving and signed URL behavior: https://supabase.com/docs/guides/storage/serving/downloads
- Apple Support, Turn a website into an app in Safari: https://support.apple.com/en-az/guide/iphone/iphea86e5236/26/ios/26

The links explain external platform behavior. The actual input source decisions are traced to the uploaded v1 docs; they are not claims that platform/device tests were performed.

## 6. Approval statement

**Approved:** target technical stack, backend model, offline store boundaries, security model with explicit limitations, planned test gates and development sequence.  
**Condition:** G1 must independently validate the browser viewer/fixture before committing to a full implementation. Failure triggers a new ADR; the agent must not silently fall back to online HTML, loosen shell CSP, or abandon offline requirements.
