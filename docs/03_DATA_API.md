# 03 — Server data model, API and browser-local contracts

**Wire version:** `/v1`, `schemaVersion: 1` for catalog. Lowercase UUIDs, UTC RFC3339, JSON `camelCase`, SQL `snake_case`. All inputs use runtime Zod validation (or a single equivalent contract framework) shared with clients; all permissions are checked server-side. Never infer authorization from family IDs in browser requests.

## 1. PostgreSQL model (preserved from SDD v1)

Migrations create strict FKs/CHECKs/unique indexes, RLS deny-by-default, and SQL functions for multi-statement atomic operations.

| Table | Core columns, constraints |
|---|---|
| `admin_users` | `user_id uuid PK FK auth.users`, `active boolean default false`, `created_at` — owner seeded manually, not by email alone |
| `families` | `id uuid PK`, `label text 1..80`, `enabled boolean default true`, timestamps; seed `Dom` |
| `subjects` | `id uuid PK`, unique `slug a-z0-9- (2..50)`, `name_pl 1..60`, `sort_order int`, `archived_at nullable` |
| `lessons` | `id`, `subject_id FK`, `title 1..120`, `description ≤500 nullable`, `grade 1..8 nullable`, `visibility selected\|all`, `status draft\|published\|unpublished`, `active_version_id nullable FK`, `published_at`, `deleted_at`, timestamps |
| `lesson_families` | composite PK `(lesson_id,family_id)`, both FKs; minimum one enabled family before publishing selected-visibility lesson |
| `lesson_versions` | `id`, `lesson_id FK`, `version_number`, `storage_path UNIQUE`, `sha256 char(64)`, `size_bytes 1..20971520`, `validation_state`, `validation_report jsonb`, `created_by FK`, timestamps; unique `(lesson_id,version_number)` |
| `pending_uploads` | `id`, `lesson_id`, `temp_storage_path UNIQUE`, `expected_sha256`, `expected_size_bytes`, `state issued\|uploaded\|finalized\|failed`, `expires_at`, `created_by`, timestamps |
| `devices` | `id`, `family_id FK`, `label 1..80`, `token_hash bytea UNIQUE`, `revoked_at`, `created_at`, `last_seen_at` |
| `pairing_codes` | `id`, `family_id`, `code_hash bytea UNIQUE`, `expires_at`, `consumed_at`, `attempts`, `created_by`, `created_at` |
| `catalog_revision` | single row monotonic `revision bigint`, `updated_at`; bumped within publication/subject/assignment transactions |

Seed subjects `przyroda`, `matematyka`, `jezyk-polski`, `historia`, `inne`. No child profile. All version file bytes, paths, SHA and size are immutable after validation. An active published lesson MUST have a valid active version belonging to that lesson. Check using constraints plus SQL transaction (and trigger if needed); never rely on a frontend check.

### Transaction design

Implement **server-side SQL RPC** (one DB transaction per call) for:

1. `consume_pairing_code`: verify HMAC code, TTL, attempts, family enabled; lock row / atomically mark consumed and insert device with hashed fresh token. Prevent duplicate pairing under concurrent submissions. Never store plaintext code or token.
2. `publish_lesson_version`: owner entitlement, valid immutable version ownership, family assignments, optimistic `expectedUpdatedAt` (required in request), status, `active_version_id`, `published_at`, and revision increment atomically. Republish older version by pointer change, not byte overwrite.
3. `unpublish_lesson` and `patch_lesson_permissions`: status/assignments and catalog revision increment atomically.
4. `get_authorized_catalog` or equivalent consistent SQL snapshot: one consistent transaction snapshot of published visible content and current revision for the authenticated device; no cross-transaction mixed versions.

Owner authorization must be enforced **before** invoking service-role SQL functions. RLS alone does not protect service-role operations. Direct browser calls to these functions as anonymous or normal user are denied.

Recommended indexes: `lessons(subject_id,status,updated_at)`, `lesson_families(family_id,lesson_id)`, `lesson_versions(lesson_id,version_number)`, `devices(token_hash,revoked_at)`, expiry indexes. Add only based on query plans.

## 2. Storage, filenames and upload lifecycle

Private buckets `lesson-bundles`, `lesson-staging` (or one with strictly separated prefixes after an ADR). Immutable final path `lessons/{lessonUuid}/versions/{versionUuid}.html`; temp path `uploads/{uploadUuid}.html`. Never overwrite a validated version. No public listing and no public download URL.

Admin `upload-init` issues a scoped, expiring *private signed upload URL*. Browser uploads directly to Storage. `upload-finalize` independently verifies object size, digest, UTF-8, structural HTML and self-contained contract, then stores immutable version and registers metadata idempotently by `uploadId`. Test worst-case 20 MiB with current Supabase Edge limits; if it exceeds CPU/memory, do not bypass validation or reduce size silently. Instead document a tested bounded alternative as an ADR (e.g. streamed/chunked verifier or separate validated finalize path). Pending stages expire and cleanup safely; never delete an active/rollback eligible version.

Downloads use URLs signed after live device authentication and lesson/version family checks; expire in approximately 5–15 min. Browser `fetch` must be allowed by Storage CORS, validated in G3. A previously issued signed URL is a temporary bearer artifact and may remain usable until expiration despite later device revoke.

## 3. Authentication and browser-origin model

### Admin

Admin browser calls Supabase Auth; JWT sent to Edge `admin-api`; function validates JWT signature/claims **and** `admin_users.active=true`. No open signup or admin self-grant. Hosted `admin` UI is on an origin **different from** the child PWA origin, to avoid shared storage and reduce XSS blast radius.

### Child PWA

`POST /device/v1/pair` accepts owner-issued code; server returns independent random **32-byte opaque token** once. The client stores it in child origin IndexedDB (`identity.deviceToken`), uses `Authorization: Bearer <token>` when contacting device API. Server stores an HMAC/SHA-256 hash of token (server-side pepper where designed), never plaintext. All calls check token hash, revoke state and enabled family. Child never receives admin JWT, service-role key or direct DB access.

**Platform security difference from Android v1:** browser IndexedDB token is script-readable by the trusted same-origin PWA. It is **not** hardware-encrypted or protected from an XSS in the trusted application origin. Mitigate with a strict app CSP, no inline scripts or dynamic HTML insertion in trusted shell, no third-party scripts, isolated viewer and no telemetry. Never claim secure enclave/Keystore equivalence. No token in logs, query strings, `postMessage`, SW caches or iframe document.

Rate limit codes: 10 random Crockford Base32 chars displayed `XXXXX-XXXXX`, 15-min TTL, single-use, at most 5 failed attempts per code **plus** IP/global rate limiting. Hash pairing code with keyed HMAC-SHA256. Device token generated separately. Error messages generic. CORS explicit allowlists for child/admin origins and request headers including `Authorization`; never rely on CORS as authentication.

Supabase RLS: enabled on all application tables and private Storage; direct `anon` and ordinary `authenticated` grants denied for protected records. Service-role secret only in Edge Functions. Device-api uses custom opaque token validation; if platform gateway JWT validation is disabled for that function, every endpoint (except pairing) MUST enforce device authentication itself.

## 4. Errors and request invariants

All API errors:

```json
{"error":{"code":"SNAKE_CASE","message":"safe human-readable message","requestId":"uuid"}}
```

Status mapping: 400 schema/validation, 401 absent/invalid token, 403 revoked/denied, 404 not found/not authorized without leaking cross-family metadata, 409 revision/conflict, 413 too large, 422 invalid/offline-incompatible HTML, 429 pairing throttle, 500/503 service error. Sanitize logs. `expectedUpdatedAt` is **mandatory** for publish/update operations that change an existing published version; stale request gets 409.

## 5. Admin API (`admin-api` gateway)

All routes require active owner auth. JSON except signed Storage upload action. Preserve path `/admin/v1/` after gateway routing (document exact deployed external prefix at setup).

| Method / route | Request | Success |
|---|---|---|
| GET `/admin/v1/subjects` | — | `{subjects:[{id,slug,namePl,sortOrder}]}` |
| POST `/admin/v1/subjects` | `{namePl,slug,sortOrder}` | `201 {subject}` |
| PATCH `/admin/v1/subjects/:id` | subset `namePl,sortOrder,archived` | `{subject}` |
| GET `/admin/v1/lessons` | optional `subjectId,status,q` | `{lessons:[LessonAdmin]}` |
| POST `/admin/v1/lessons` | `{title,description?,grade?,subjectId,visibility, familyIds}` | `201 {lesson}` draft |
| PATCH `/admin/v1/lessons/:id` | editable metadata/visibility/familyIds, optimistic update token | `{lesson}` |
| POST `/admin/v1/lessons/:id/upload-init` | `{filename,sha256,sizeBytes,contentType:'text/html'}` | `{uploadId,uploadUrl,expiresAt}` |
| POST `/admin/v1/lessons/:id/upload-finalize` | `{uploadId}` | `{version:{id,versionNumber,sha256,sizeBytes,validationReport}}` |
| POST `/admin/v1/lessons/:id/publish` | `{versionId,expectedUpdatedAt}` | `{lesson}`; DB transaction |
| POST `/admin/v1/lessons/:id/unpublish` | `{expectedUpdatedAt}` | `{lesson}` |
| GET `/admin/v1/lessons/:id/versions` | — | `{versions:[...]}` |
| POST `/admin/v1/lessons/:id/versions/:versionId/download-url` | — | `{signedUrl,expiresAt,sha256,sizeBytes}`; owner only, needed for previewing old versions |
| GET `/admin/v1/families` | — | `{families:[...]}` |
| POST `/admin/v1/families` | `{label}` | `201 {family}` |
| POST `/admin/v1/families/:id/pairing-codes` | `{}` | `{code,expiresAt}` plaintext once |
| GET `/admin/v1/devices` | — | `{devices:[{id,familyId,label,lastSeenAt,revokedAt}]}` |
| POST `/admin/v1/devices/:id/revoke` | — | `{device}` |

After finalize, validated bytes from the local uploaded File are stored for **10 minutes** in an admin-origin temporary IndexedDB preview store. For an existing version after reload, the owner requests the dedicated private download-URL endpoint and verifies the fetched bytes by digest/size before writing the same preview store. The trusted admin shell rechecks eligibility before mounting and on return from suspension. It reads the local Blob and assigns the exact decoded HTML only to a sandboxed opaque inner iframe under the verified fixed passive wrapper. Preview bytes are removed on close or expiry. No credentials or preview bytes enter a URL or worker navigation response. See `02_ARCHITECTURE.md` §5A. G1 demonstrates the technical preview and G4 retains the full authorized flow.

## 6. Device API (`device-api` gateway)

### `POST /device/v1/pair` (public, strongly rate-limited)

Request:

```json
{"pairingCode":"ABCDE-FG234","deviceLabel":"Mój tablet"}
```

Response:

```json
{"deviceId":"uuid","familyId":"uuid","familyLabel":"Dom","deviceToken":"256-bit-opaque-token","serverTime":"2026-11-19T18:00:00Z"}
```

Pair atomically creates a single device and consumes the code. PWA context identity is a device record for auth purposes; a user may pair separately in a Safari tab and installed PWA if contexts do not share storage.

### `GET /device/v1/catalog` (device bearer required)

Always return a **fully family-filtered 200 snapshot** for MVP. Do NOT use HTTP 304; response is small and independent of browser cache state.

```json
{
  "schemaVersion":1,
  "revision":42,
  "generatedAt":"2026-11-19T18:00:00Z",
  "family":{"id":"uuid","label":"Dom"},
  "subjects":[{"id":"uuid","slug":"przyroda","namePl":"Przyroda","sortOrder":1}],
  "lessons":[{
    "id":"uuid","subjectId":"uuid","title":"Skały i gleba",
    "description":"Interaktywna lekcja","grade":4,
    "publishedAt":"2026-11-19T18:00:00Z",
    "version":{"id":"uuid","number":1,"sha256":"64_lowercase_hex_characters","sizeBytes":333033}
  }]
}
```

Only currently published nondeleted lessons with `visibility='all'` or authorized assigned family. Filter subjects as appropriate. Do not expose Storage paths/signed URLs/other families. A successful **validated** 200 is authoritative for visibility, even if downloads later fail. A timeout/500/401 is not an empty catalog.

### `POST /device/v1/download-url` (device bearer required)

Request `{ "lessonId":"uuid", "versionId":"uuid" }`.

Response `{ "signedUrl":"https://...", "expiresAt":"RFC3339", "sha256":"64_lowercase_hex", "sizeBytes":333033 }`.

Recheck device token, family, publication, active version, and hash/size every call. Do not issue for stale/unauthorized version. Client then fetches private object using signed HTTPS URL and browser CORS. Client compares server response with its currently desired catalog entry before installing.

### `POST /device/v1/ping` (P1 optional)

Can update last seen, but a successful catalog request can do this without a separate endpoint.

## 7. Runtime TypeScript types (schematic)

```ts
type UUID = string;
type VersionDescriptor = {
  id: UUID; number: number; sha256: string; sizeBytes: number;
};
type LessonSummary = {
  id: UUID; subjectId: UUID; title: string; description: string | null;
  grade: number | null; publishedAt: string; version: VersionDescriptor;
};
type RemoteCatalog = {
  schemaVersion: 1; revision: number; generatedAt: string;
  family: { id: UUID; label: string };
  subjects: Array<{id: UUID; slug: string; namePl: string; sortOrder: number}>;
  lessons: LessonSummary[];
};
type InstalledVersion = {
  lessonId: UUID; installedVersionId: UUID; sha256: string;
  sizeBytes: number; installedAt: string; lastOpenedAt?: string;
};
type OfflineStatus =
  | 'ready_latest' | 'ready_old_version' | 'downloading'
  | 'not_downloaded' | 'failed' | 'storage_missing';
```

`ready_latest` demands installed version ID/hash/size equal to remote desired version AND available verified HTML bytes. `ready_old_version` is openable but **not** counted in all-current downloaded N/M. Clients must validate runtime shapes of remote and persisted records, not trust TypeScript at runtime.

## 8. Local IDB concurrency / integrity contract

- `authorizedCatalog` and `lessonBytes`/`installations` stores specified in `02_ARCHITECTURE.md` are normative.
- Local desired snapshot commit and per-lesson verified installation are separate transactions. Store verified byte Blob **and** installed pointer atomically after re-reading current authorization in same transaction.
- This avoids loss of v1 after v2 download failure and permits immediate partial availability on 1/100 downloads.
- Concurrent tab stale results: compare stored revisions transactionally and refuse older. After permission removal, no in-flight download may reactivate an excluded item.
- Cleanup never runs before successful commit and cannot delete a currently open viewer's bytes. Reset clears the browser origin's child identity/content only; if blocked by another tab, explain and retry.
- On browser data eviction a new pairing may be needed; never silently reuse identity from another origin.
