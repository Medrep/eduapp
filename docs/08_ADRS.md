# 08 — Architecture Decision Records (accepted SDD v2.0)

**Status as of 2026-11-19:** target architecture approved for implementation, browser viewer behavior requires empirical G1 proof. These ADRs **supersede** v1 Android/Capacitor decisions wherever incompatible.

### ADR-001 — PWA-first client instead of Android APK (SUPERSEDES v1 ADR-001)
**Decision:** one React + TypeScript + Vite PWA for Android Chrome and iPhone/iPad Safari Home Screen. No Capacitor/Kotlin/Swift in MVP. **Why:** family mainly uses Wi-Fi at home, no app-store distribution, ≈100 lessons expected soon, one UI can work across devices, simpler development than two native clients. **Tradeoff:** browser storage may be evicted; no Keystore; SW/iframe compatibility is browser-dependent. **Rejected:** Kotlin + Jetpack Compose (more platform-specific work), React + Capacitor (native bridge/platform integration without critical benefit), online-only website (offline is still P0).

### ADR-002 — Full authorized library offline-first (RETAINED)
**Decision:** download all authorized files, not user-selected on demand. **Why:** no child decisions needed before occasional offline use. **Tradeoff:** disk/bandwidth; numerical N/M readiness and partial availability. Re-download possible after browser eviction.

### ADR-003 — One self-contained immutable HTML file per version (RETAINED)
**Decision:** UTF-8 HTML with inline styles, inline JS and data-image/inline SVG. **Why:** matches existing study material, permits simple hashing, private delivery and offline rendering. No ZIP or separate assets in MVP.

### ADR-004 — Passive PWA wrapper and opaque lesson iframe (AMENDED)

**Decision:** the trusted child shell reads the authorized, verified installed Blob from IndexedDB. It verifies the exact versioned passive wrapper on the child origin, then mounts a nested iframe with exactly `sandbox="allow-scripts"` before assigning the losslessly decoded original HTML to `srcdoc`. The worker precaches only application assets, including the wrapper. Lesson bytes are never a navigation response. Direct same-origin lesson execution, a privileged bridge and globally relaxed shell CSP remain prohibited.

**Provenance:** Control Tower approved Option B on 2026-11-24 after *Moja Nauka S1/G1 — Final Architecture Validation and Decision Recommendation*, §§E–H (SHA-256 `b57fba1ae8de5e8952caedf5f0bfdcf79cf192d9e8bf078a50d362bd63b7a30a`). This bounded decision supersedes the dynamic virtual HTML mechanism in ADR-004, ADR-015 and ADR-018. It preserves ADR-017 and the physical-device G1 hard stop.

### ADR-005 — Dedicated Supabase backend (RETAINED)
**Decision:** Supabase Auth, Postgres, private Storage, Edge Functions in dedicated project. **Why:** few server components, private signed asset flow, shared back-office auth. **Tradeoff:** Edge CPU/memory and URL/CORS testing; paid uptime/backups as needed. No second custom API, Redis or queue.

### ADR-006 — Device pairing, no child login (REVISED FOR WEB)
**Decision:** 15-minute one-use pairing code yields 256-bit server-side opaque device token; stored in child PWA origin IndexedDB (script-readable by trusted shell) rather than Android Keystore. **Why:** no password for child and family-level access; browser PWA support. **Tradeoff:** token theft from trusted-origin XSS possible; strict shell CSP and origin separation essential. Distinct browser installs may require independent pairing.

### ADR-007 — Family-level authorization from start (RETAINED)
**Decision:** one owner, multiple families, family-targeted publish, default private `Dom`. **Why:** share with invited households without SaaS admin roles. **Tradeoff:** family filtering/rate limiting/tests.

### ADR-008 — Immutable server versions and IDB atomic per-lesson installation (REVISED)
**Decision:** client checks size/hash then writes Blob and installed pointer in single IDB transaction, separately storing fully authorized latest catalog. **Why:** safe update, immediate partial success and rollback. **Tradeoff:** IndexedDB quota/eviction and concurrent tab test requirements. No Android AtomicFile or per-version native paths.

### ADR-009 — No quiz-result integration in MVP (RETAINED)
**Decision:** HTML quiz stays inside iframe; no lesson-to-host JS message bridge or score sync. **Why:** reduced threat surface and complexity. Future event API requires separate review.

### ADR-010 — Foreground sync, no guaranteed background polling (RETAINED)
**Decision:** first pair, app launch/visible, online event and manual sync; background task optional later. **Why:** browser lifecycle unreliable for guaranteed periodic sync.

### ADR-011 — Separate admin and child origins (STRENGTHENED)
**Decision:** separate React admin and PWA deployments on distinct HTTPS origins; backend contracts shared. **Why:** separate owner JWT from child token, isolate admin UI from embedded lesson and SW scope. Avoid overengineering permissions; one owner only.

### ADR-012 — Web shipping, no stores or APK (SUPERSEDES v1 shipping)
**Decision:** reproducible HTTPS static deployments, SW update control and PWA Home Screen installation. No Google Play/App Store/TestFlight distribution. **Why:** simplest install/updates for small number of families. **Tradeoff:** Safari Home Screen instructions, no native file persistence guarantee.

### ADR-013 — Dedicated project/environment (RETAINED)
**Decision:** dedicated Supabase project and isolated dev/test, not piggybacked on unrelated production apps. **Why:** RLS/blast radius, rollback, migration safety.

### ADR-014 — Browser storage is best-effort (NEW)
**Decision:** IndexedDB is local working copy, Supabase remains authority; request persistent storage where available and provide recovery after eviction. **Why:** browsers may clear origin data under pressure or user choice. **Tradeoff:** previously downloaded offline readiness can be lost without warning; honest UI mandatory.

### ADR-015 — Strict shell CSP and inherited wrapper policy (AMENDED)

**Decision:** each shell retains strict script CSP and can frame only its exact versioned wrapper URL. The fixed, passive wrapper delivers the tested resource policy through HTTP CSP and an early meta CSP. HTTP also sets `frame-ancestors 'self'`. The inner `srcdoc` inherits the resource policy and its iframe sandbox supplies opacity. Verify wrapper URL, version, static bytes and expected policies before mounting. Only the wrapper policy permits authored inline JS/CSS and embedded data assets. Fail closed on unexpected delivery or policy and confirm behavior at G1. [Approval provenance](#adr-004--passive-pwa-wrapper-and-opaque-lesson-iframe-amended)

### ADR-016 — Single full manifest and atomic per-lesson progress (NEW)
**Decision:** always send authenticated full 200 catalog with monotonically increasing revision (no ETag/304 for MVP); commit authorized catalog independently from each verified installation. **Why:** small metadata, easy removal semantics, partial usable progress and simple concurrency correctness. **Tradeoff:** slightly more metadata traffic, acceptable for ~100 lessons.

### ADR-017 — Owner-controlled lesson publication threat model (NEW)
**Decision:** only owner can publish HTML, static validation rejects remote dependencies/navigation patterns, viewer sandbox isolates parent data, but arbitrary hostile JavaScript is **not guaranteed incapable of self-navigation** on all browsers. **Why:** accurate web platform limitations. **Tradeoff:** PWA unacceptable if later product requires multi-publisher hostile-content network isolation; revisit architecture via ADR before expansion.

### ADR-018 — Browser-local admin preview with passive wrapper (AMENDED)

**Decision:** the separate admin origin uses its own fixed wrapper and opaque inner iframe. Validated preview bytes and expiry are held in temporary admin IndexedDB, with eligibility rechecked before mounting and after suspension. Close and expiry remove the frame and bytes. The worker may cache the fixed public wrapper. It serves no preview bytes, credentials or authenticated responses. G1 requires technical preview proof. G4 retains server validation, the authorized older-version download and full admin integration. [Approval provenance](#adr-004--passive-pwa-wrapper-and-opaque-lesson-iframe-amended)
