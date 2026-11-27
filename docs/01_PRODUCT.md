# 01 — Product, personas and workflows

## 1. Principles and expected use

A child can open one distraction-free Polish library of interactive educational HTML lessons. A parent can upload and publish a new self-contained HTML file in under a minute (exclusive of preparing the file). Most sessions occur at home with Wi-Fi, but **every verified downloaded lesson must work without Wi-Fi** while local browser storage remains available. A full-library download avoids per-lesson preparation for a trip.

Principles: PWA-first; family-owned content; no child accounts; all assigned lessons downloaded opportunistically; only validated complete HTML is offline-ready; clear offline status; incremental updates; simple owner admin; invited family support without SaaS roles; no stores or native app.

## 2. Personas

- **Owner/admin:** one adult controlling upload, subjects, versioning, family access, pairing codes and device revoke from a *separate admin origin*. Sole content publisher in MVP.
- **Child:** uses the child PWA in a regular browser or installed Home Screen app; sees authorized lessons, no admin routes and no personal sign-in.
- **Invited family:** one or more browsers/tablets/phones associated with an explicitly assigned family; no admin privileges in MVP.

Never collect a child's name, birthday, school or grades as profile data. `grade` labels lesson level, not the learner.

## 3. Canonical journeys

### UJ-01 — First launch and pairing

1. Family opens HTTPS child PWA URL; browser presents installation guidance appropriate to Android or iOS (installation not required for online use).
2. Owner generates a single-use code for a chosen family, valid 15 minutes.
3. Child/parent enters 10-character displayed code and optional device label. Connection is required only for first pairing and future content sync.
4. Device gateway consumes code atomically and issues a 256-bit opaque token. The **browser** stores it in the child origin's IndexedDB; unlike v1 Android, PWA offers **no hardware-backed credential storage guarantee**. Do not imply it does.
5. PWA registers/activates its Service Worker, requests a full authorized manifest, and downloads authorized HTML into IndexedDB. Display completed count. Ready status appears per successfully verified lesson.
6. A standalone installed Web App can have a browser storage context distinct from a Safari tab: treat each context as independently paired if necessary; verify behavior on iOS target device.

### UJ-02 — Daily use / offline

1. PWA starts from versioned local shell without waiting for API; after browser-origin data loss, it can only recover online.
2. Show locally saved, authorized subject/lesson catalog with clear installed version status.
3. Tap an installed lesson; open isolated sandboxed iframe backed by the Service Worker virtual local URL. The HTML's embedded images, diagrams, navigation and quiz work offline.
4. Back/close returns to same list position. While connected, a foreground sync is nonblocking.
5. A noninstalled lesson is visible in the authorized catalog with `Wymaga pobrania` or `Pobieranie`; tapping cannot open unverified HTML.

### UJ-03 — Upload and publish

1. Owner signs in on the separate admin origin using Supabase Auth.
2. Create lesson metadata: title, subject, optional grade and description. Visibility defaults to owner family only.
3. Upload a single UTF-8 HTML ≤20 MiB through a private signed staged upload. Backend finalization checks actual bytes, SHA-256 and offline content contract. Test the 20 MiB path against Edge Function limits; G3 must demonstrate it works or adopt an ADR-backed bounded alternative.
4. Preview in opaque-origin sandbox; owner explicitly publishes a valid immutable version.
5. At next successful authorized sync, devices fetch updated catalog and only missing/changed HTML. The PWA application shell is not redeployed.

### UJ-04 — Update, rollback and partial availability

1. New version is uploaded and validated while old published version remains active.
2. Publishing atomically changes DB active version and increments catalog revision.
3. PWA keeps old locally installed version openable during failed or ongoing update; `Aktualizacja oczekuje` is visible.
4. Each new lesson version is activated in the *same IndexedDB transaction* that stores its verified bytes and installed pointer; individual successful files become usable immediately without waiting for the entire sync queue.
5. Owner can republish a previously retained server version; clients download/reuse it as necessary.

### UJ-05 — Unpublish, revoke and reset

- On an authenticated, fully validated new manifest, an unpublished or no-longer-authorized lesson disappears from the visible library. Obsolete bytes are deleted by safe cleanup. Failed/unauthorized sync is not grounds for deleting last-known-good catalog.
- Revoked token cannot access future catalog or signed URLs. **Previously downloaded offline content cannot be remotely erased from a disconnected browser.** Preexisting signed URLs can remain usable until expiration.
- `Odłącz urządzenie i usuń pobrane lekcje` requires confirmation and clears that browser's child-origin credential, catalog and lesson bytes (handling open-tab blockers). It does not erase a different browser or standalone installation's data.

### UJ-06 — Browser storage cleared / quota exceeded

- The platform may evict IndexedDB/Cache Storage data; no irreversible business state resides only in the browser. After eviction PWA must not misrepresent missing bytes as offline-ready. Re-pairing/redownloading is possible online.
- The client uses `navigator.storage.persist()` where available and reports whether persistence was granted, without representing this as a guarantee.
- Insufficient space or `QuotaExceededError` cannot remove previously valid installed version due to a failed new transaction.

## 4. Content definition

One **UTF-8 self-contained HTML5 document** per immutable lesson version. Inline CSS/JS, inline SVG and embedded `data:` images only; no imports, external fonts, images, APIs, workers, service workers, iframes, `eval`, navigation or browser storage. No ZIP directories, separate videos/fonts or conversion of PDFs/PPTX in MVP. The host treats lesson HTML as opaque data and does not extract score results.

**Regression reference:** `fixtures/rocks-soil.html` was cited in v1 at 333,033 bytes, SHA-256 `7590b609c72a5e454887707ed16a5e3de6bec759ea1fc2e88247f9654265566c`. It must be provided before G1; its functionality cannot be inferred from a hash alone.

## 5. Subjects and ordering

Initial subjects: `Przyroda`, `Matematyka`, `Język polski`, `Historia`, `Inne`; owner can create/rename/reorder/archive subjects. Hide subjects with zero visible lessons in child catalog. Latest publication first within subject. `lastOpenedAt` and recent list are P1.

Publishing defaults to selected families with owner `Dom` preselected; explicit `all` requires clear confirmation. Families have no author role in MVP.

## 6. Quality, environments and non-goals

- Target primary: Android tablets around 7–13 inches, Chrome installed PWA; secondary: iPad/iPhone Safari Home Screen Web App and regular desktop browser.
- Minimum responsive width: 360 CSS px. Touch targets ≥44×44 CSS px; prefer 48×48.
- 100 real lesson files and 1,000 manifest entries in performance tests; typical ≤2 MiB/lesson, hard cap 20 MiB.
- No tracking/ads/remote fonts. No push, audio/video input, camera or location permission.
- Fully offline viewing is only promised for **verified locally installed lessons and a present PWA shell**; browser data eviction, user clearing site data or changing installation contexts can require internet and re-pairing.
- iOS uses the same PWA, not a new Swift application. Direct ChatGPT publishing and quiz scores may be reconsidered only through future ADRs.
