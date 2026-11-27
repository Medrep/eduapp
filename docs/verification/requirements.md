# Requirements and observed evidence

Historical verification summary retained for context. Raw evidence remains in local archives; use the current source suites for reproduction. This summary does not assert a new run or close formal gates. See [current limitations](limitations.md).

## S0 / G0

| Requirement | Implementation or evidence location | Observed status |
| --- | --- | --- |
| Reproducible pinned workspace and runnable CI checks | [Workflow](../../.github/workflows/ci.yml), [toolchain](versions.md), [clean-copy output](build-tests.md) | PASS locally. Hosted workflow `NOT RUN`. |
| Separate child/admin origins, child manifest and SW skeleton | `apps/child`, `apps/admin`, `tests/browser/shells.spec.ts` | PASS in desktop and emulated smoke. Installed physical compatibility `NOT RUN`. |
| Shared packages, local Supabase scaffold and credential-free CI | `packages`, `supabase`, `.github/workflows/ci.yml` | Scaffolds present. Supabase runtime `NOT RUN`. |
| Exact original fixture identity | Byte count and SHA-256 (archived locally) | PASS. No viewer execution claimed. |
| Measurable G1 test approach and physical-device matrix | [Criteria, procedures and evidence plan](g1-test-plan.md) | Matrix and procedures recorded. Physical-device and operator confirmation is pending for G1. |

## Later gates

The [SDD traceability table](../../SPEC.md#4-traceable-requirements) and [acceptance specification](../06_TESTS_ACCEPTANCE.md) define the complete FR/NFR/AT/SEC/UX/COMPAT/PERF inventory. No complete P0 acceptance test has passed in S0. Product acceptance, physical viewer tests, backend, offline sync, integration and release checks `NOT RUN`.

## S1 / G1 — Option B

| Requirement | Observed result | Evidence |
| --- | --- | --- |
| AT-04 and COMPAT-01 | Complete virtual fixture interactions, exact offline reopen and successor-worker lifecycle passed. Both installed physical platforms remain NOT RUN. | [Viewer](g1-viewer.md) · [Lifecycle](offline-sync.md) |
| AT-16 | Exact build-owned wrappers, response and meta policies, lossless source, sandbox boundary and host/cache/mixed-worker denial passed in the local matrix. | [Viewer](g1-viewer.md) · Matrix (archived locally) |
| SEC-01, SEC-02, SEC-04 | Trusted shell and inner origin boundaries and local inert network/nav controls passed in the tested engines. Installed-device and deployed-host results remain pending. | [Security](security.md) |
| SEC-05, ADR-018 | Separate technical admin preview, lifecycle and TTL/close/restart passed locally. Full authorized admin integration remains G4. | [Security](security.md) |

## S2 / G2 — Android-first virtual verification

| Requirement | Implementation and observed check | Status |
| --- | --- | --- |
| AT-03 | `catalog-sync.ts` and `catalog.spec.ts`: partial 1/100, full and delta downloads, unchanged catalog and signed grant renewal | PASS locally |
| AT-04 / COMPAT-01 | `worker-lifecycle.spec.ts`: original catalog install and exact full interaction after successor worker activation and offline process restart | PASS on all four virtual profiles. Physical targets pending. |
| AT-05 | `catalog-store.ts`: atomic pointer plus Blob, verification before activation, quota, abort, transfer fault, tab closure and real process crash | PASS locally. Actual crash was exercised in desktop Chromium and both tablet emulations. |
| AT-07 / UX-02 | `main.tsx` and `use-library.ts`: truthful counts, verified past versions, recovery and persisted authorization warnings | PASS locally |
| AT-09 / AT-17 | IndexedDB revision, session generation and installation transactions: out-of-order response, reset, removed content and open-viewer retention races | PASS locally |
| AT-15 | Child worker cache and IndexedDB recovery, schema migration/version handling, corruption and optional storage APIs | PASS locally |
| AT-16 / SEC-01/02/05/07 | Approved wrapper and sandbox regressions, exact catalog-backed mount, integrity and local signed download validation, separate technical admin preview | PASS locally. Physical and hosted checks remain pending. |

Complete report (archived locally) · Raw matrix (archived locally) · [Exact remaining evidence](limitations.md)

## S3 / G3

| Requirement | Local proof | Formal status |
| --- | --- | --- |
| AT-08, AT-14, SEC-03 | Separate family catalogs and grants, private owner-family default, revocation and direct access denial | Local PASS. Deployed scenarios pending. |
| AT-11, SEC-04, SEC-06 | Active owner and live session checks, disabled public signup, opaque pairing, local CORS and rate controls, safe logs | Local PASS. Hosted Auth, trusted ingress and CORS pending. |
| AT-12, AT-13, SEC-07 | Verified original, three exact 20 MiB streams, bounded expiry, same-owner recovery, immutable publication and rollback | Local PASS. Hosted finalization and signed transfers pending. |

Execution report (archived locally) · [Backend results](backend.md)
