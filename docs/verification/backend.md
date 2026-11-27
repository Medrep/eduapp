# S3 backend verification

Historical verification summary retained for context. Raw evidence remains in local archives; use the current source suites for reproduction. This summary does not assert a new run or close formal gates. See [current limitations](limitations.md).

## Backend and access controls

Three migrations implement the ten protected application tables, seed data, role restrictions and transaction routines. Browser roles cannot directly read or mutate protected data or invoke privileged RPCs. The private `lesson-staging` and `lesson-bundles` buckets cap objects at 20 MiB. Final paths bind a single lesson and immutable version ID. Family assignments, publication and catalog revisions update transactionally. Rollback selects an existing immutable version.

| Gateway | Local prefix | Interface |
| --- | --- | --- |
| Owner | `/functions/v1/admin-api/admin/v1/` | Auth signature and live session plus an active owner row. Subjects, lesson metadata, assignments, uploads, versions, owner download, publish, unpublish, families, pairing codes and device revocation. |
| Device | `/functions/v1/device-api/device/v1/` | Time-limited single-use pairing, independent opaque tokens, full authorized family catalog and grants for the current authorized version. The gateway checks current authorization again after the asynchronous signing call. |

The upload-init response includes `expiresAt`, bounded by the provider signature and the application deadline. Finalization reserves verified bytes transactionally before the permanent write. Expiry before reservation denies activation and leaves no permanent object. A reserved write can complete after the original expiry. The same owner can finish a retained reservation under a fresh session after logout. An unfinished or unpublished version cannot appear in device catalogs or receive a device download grant. Cleanup keeps unfinished validated reservations for authorized recovery, clears eligible stages after signature expiry and grace, and never selects immutable bundles. Race and cleanup proof (archived locally)

## Local execution and limits

The stock CLI gateway initially answered Functions preflight itself. The tracked local overlay leaves the Functions handlers in control of their exact origin allowlists. Both browsers exercised that behavior through local Kong. Stock Storage responses for credentialless signed transfers use the provider wildcard. The verified local Kong peer signal is specific to the dedicated local stack. Other ingress uses the transport peer until a trusted hosted client-IP source is verified, so clients behind a shared proxy may share a rate bucket. Initial provider observation (archived locally) · Overlay (archived locally) · Local peer proof (archived locally)

The first exact-size attempt exposed a CSS false positive and then HTTP 546 from the local Edge memory limit. The corrected streaming HTML validator kept the structural, resource and inline-script checks and passed the final samples. Initial worker failure (archived locally) · Final measurements (archived locally)

| Exact 20 MiB input | Signed PUT | Finalization wall time | Container CPU delta | Cumulative container memory peak |
| --- | ---: | ---: | ---: | ---: |
| `exact-limit-comment.html` | 150 ms | 219 ms | 187.6 ms | 250,339,328 bytes |
| `exact-limit-structural.html` | 147 ms | 252 ms | 216.8 ms | 270,213,120 bytes |
| `exact-limit-image.html` | 148 ms | 252 ms | 206.9 ms | 296,206,336 bytes |

Each case returned HTTP 200 for upload-init, signed PUT, finalization and signed GET. Repeating the exact-limit image retained one immutable version. Raw measurements (archived locally) · Exact-limit retry (archived locally)

The CPU deltas and cumulative peaks above describe the whole local Edge container. They are not measurements of one hosted worker or proof for every permitted lesson shape. [Supabase hosted Edge limits](https://supabase.com/docs/guides/functions/limits)

Gateway logs use generated request IDs, fixed endpoint names, safe error codes, elapsed time and coarse upload-size buckets. The durable evidence excludes an early diagnostic that displayed disposable CLI credentials. The final evidence was checked for credential-shaped values, and the dedicated stack and its test data were removed after verification. Log verification (archived locally) · Local cleanup (archived locally)

## Hosted G3 prerequisites

Obtain Control Tower authorization for an isolated hosted Supabase test project, its exact project reference, least-privilege operator access, and distinct approved HTTPS child and admin origins. The operator supplies signing and service configuration server-side. Use the exact reviewed migrations and gateways in that environment after authorization.

Record the deployed worker’s actual memory, CPU and wall time for finalizing the original and a valid 20 MiB lesson. Verify real signed uploads and downloads from the approved browser origins, explicit preflights and denied origins, live owner and device authorization, trusted client-IP handling, RLS and cross-family ACLs, immutable publication and rollback, and safe logs. These are open hosted G3 checks. [Hosted Edge limits](https://supabase.com/docs/guides/functions/limits) · [Official signed upload guidance](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
