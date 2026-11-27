# 04 — Polish UI / UX specification

## 1. Visual and device intent

A calm, clear child-friendly but not infantile learning library. White/cream surfaces, restrained colors per subject, legible system fonts, large tactile controls, no mascot or gamification. Tablet-first 7–13 inch landscape/portrait, also 360 CSS px phones and desktop browsers. Touch targets ≥44×44 CSS px (48 preferred). Use semantic accessibility roles, keyboard navigation, visible focus, reduced-motion preference, appropriate text resizing and contrast. PWA shell contains no remote font/icon dependency.

**Install is optional:** app works in a browser while online; clearly offer `Dodaj do ekranu głównego` instructions for Android Chrome and Safari (no invented universal install prompt). Never block library use solely because the browser declined installation.

## 2. Child screens

### M01 — Welcome / pairing

- Header `Moja Nauka`; subtitle `Twoje lekcje w jednym miejscu — także bez internetu.`
- Code input `XXXXX-XXXXX`, trim/uppercase; CTA `Połącz urządzenie`; optional `Nazwa urządzenia` default `Mój tablet`.
- Invalid code `Nieprawidłowy lub wygasły kod. Poproś o nowy.`; offline `Do pierwszego połączenia potrzebny jest internet.`
- Explain that in Safari and installed Home Screen app, pairing may need to be repeated depending on storage separation; do not overexplain on main screen.

### M02 — Download and sync

- `Pobieranie lekcji`, `Pobrano 7 z 12`, `Dostępne offline: 7 z 12` (actual verified desired versions).
- `Synchronizuj teraz`, `Spróbuj ponownie`, meaningful failed item count; `Wszystkie lekcje są dostępne offline` only for N/M fully current with present bytes and offline shell ready.
- Partially installed library is immediately usable. Older verified version displays `Dostępna offline — starsza wersja` / `Aktualizacja oczekuje`, not generic `Aktualne`.

### M03 — Home / subjects

- Title `Moja Nauka`; greeting `Czego dziś się uczymy?`.
- Subjects `Przyroda`, etc. with authorized lesson count; hide empty. Responsive cards (2 columns when roomy, 3–4 wide), no horizontal overflow. Small sync status `Offline`, `Synchronizacja`, `Aktualne` only when truthful.
- P1 `Ostatnio otwierane`; do not render inert recent section for P0.

### M04 — Lesson listing

- Header subject and back; metadata `Klasa 4`, short description; newest publication first.
- Per lesson statuses `Dostępna offline`, `Pobieranie`, `Wymaga pobrania`, `Błąd pobierania`, `Aktualizacja oczekuje`.
- Installed (even older) lesson opens immediately via sandboxed offline viewer. Missing bytes never render from remote Storage URL as a fallback.

### M05 — Lesson viewer

- Trusted outer header: lesson title, `Wróć do biblioteki`/close; route returns to previous scroll position. HTML appears **only** inside `iframe sandbox="allow-scripts"` with SW virtual local URL and dedicated CSP.
- The lesson controls its own scrolling, diagrams, navigation and quiz. iOS Safari back/gesture handling tested; never give lesson direct PWA access. An iframe failure renders `Nie udało się otworzyć lekcji`, action `Wróć do biblioteki`.

### M06 — Settings, installation and reset

- `Ostatnia synchronizacja`, `Lekcje dostępne offline: N / M`, `Synchronizuj teraz`, `Nazwa urządzenia`, abbreviated `Identyfikator urządzenia`, `O aplikacji`, app version.
- `Odłącz urządzenie i usuń pobrane lekcje` is **P0** with destructive confirmation. Show guidance if another tab blocks IndexedDB deletion.
- Display storage usage and persistent-storage grant status only when reliably available (detailed display is P1). Installation/help provides platform-specific Home Screen instructions, and explains browser storage is not permanent.

### M07 — Empty and failure states

| Scenario | Polish text |
|---|---|
| Paired, no lessons | `Nie ma jeszcze lekcji. Poproś opiekuna o dodanie pierwszej.` |
| Offline before first pairing | `Do pierwszego połączenia potrzebny jest internet.` |
| Offline, paired but no verified files | `Brak pobranych lekcji. Połącz się z internetem, aby je pobrać.` |
| Backend unavailable; installed files present | `Nie udało się sprawdzić aktualizacji. Korzystasz z pobranych lekcji.` |
| Storage full | `Brak miejsca na nowe lekcje. Zwolnij miejsce i spróbuj ponownie.` |
| Browser removed stored data | `Zapisane lekcje nie są już dostępne. Połącz urządzenie ponownie i pobierz je.` |
| Server revoked/invalid token | `Nie można teraz synchronizować. Pobrane lekcje pozostają dostępne offline.` |
| SW not active / shell not ready | `Przygotowywanie trybu offline. Otwórz aplikację ponownie po zakończeniu.` |
| New schema unsupported | `Zaktualizuj aplikację, aby pobierać nowe lekcje.` |

No unbounded spinners, raw stack traces or false offline-ready messages.

## 3. Admin screens (separate origin)

### A01 — Sign in

Supabase Auth owner email/password or supported passwordless method, with explicit active `admin_users` permission; no public registration. `Brak uprawnień` when logged in but not granted owner role.

### A02 — Library dashboard

Navigation `Lekcje`, `Przedmioty`, `Rodziny i urządzenia`, `Wyloguj`. Lesson table/cards with title, subject, optional grade, state `Szkic` / `Opublikowana` / `Ukryta`, active version, family assignment and publish date. Buttons for create, edit, new version, preview, publish/unpublish.

### A03 — Create/edit/upload

Fields `Tytuł`, `Przedmiot`, optional `Opis`, `Klasa`. `Udostępnij` defaults `Wybrane rodziny` with `Dom` selected, explicit `Wszystkie rodziny`. Upload only one HTML, show filename, bytes, SHA validation, validation issues; `Zapisz szkic`, `Podgląd`, `Opublikuj` disabled until valid version. Direct signed staged upload progress and bounded errors.

### A04 — Versions and preview

Version history with published indicator and checksums (details). `Opublikuj tę wersję` for rollback after confirmation. Preview is sandboxed, opaque-origin and CSP-isolated; label that browser preview and actual installed PWA may differ, with real compatibility assured only by G1/G5 tests. Never inject untrusted HTML with React `dangerouslySetInnerHTML`.

### A05 — Families and devices

Family `Dom` seeded. `Dodaj rodzinę`, one-use 15-minute code, device list with family/last seen, `Unieważnij dostęp`. Revocation confirmation must say downloaded offline lessons on disconnected devices cannot be remotely deleted and a previously issued signed URL may remain usable until expiry.

## 4. PWA-specific UX acceptance

- Android: install prompt/instructions if browser supports it, but child can use app before installing.
- iPad/iPhone: correct Safari `Udostępnij` → `Do ekranu początkowego` guidance. Installation does not imply guaranteed persistence.
- Standalone Home Screen state and Safari tab may not share all locally stored state; verify the actual device behavior; do not claim they do.
- Offline PWA shell appears after reload/device reboot if cached. If storage was evicted, show a clear online recovery path rather than stale placeholders.
- On an authorized manifest update that removes content, remove it from visible library immediately, even while old bytes await cleanup.
- No colors-only state indicators. Polish diacritics correct. Screen-reader names and ≥1.3× font scaling work.
