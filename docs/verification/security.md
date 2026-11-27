# S1 security verification — passive wrappers

Historical verification summary retained for context. Raw evidence remains in local archives; use the current source suites for reproduction. This summary does not assert a new run or close formal gates. See [current limitations](limitations.md).

| Requirement | Final candidate observations | Result and boundary |
| --- | --- | --- |
| SEC-04 | Both Vite preview shells allowed only their exact versioned wrapper URL in `frame-src` and retained strict script CSP. Workers served verified static assets. | PASS locally. Deployed test-host policy verification remains NOT RUN. |
| AT-16 | Both wrappers had expected HTTP and early meta policies and exact build content. Wrong built file, wrong version, missing policy, redirect, shell fallback or retired routes failed closed. A stale no-op controller remained unavailable even with a valid wrapper cached. | PASS in the local matrix. |
| SEC-01 | The exact decoded original went only into the inner iframe, with the sandbox configured before assignment. Actual inner origin was opaque. The sandbox exposed no trusted DOM, cookies, application storage, IndexedDB markers or trusted worker capabilities. | PASS in local Chromium, Firefox and WebKit. |
| SEC-02 | Inert loopback checks observed no ordinary resource or API traffic reaching the sink. Popup, form and top-frame navigation controls left the trusted shell intact. An inner `about:blank` replacement remained opaque and kept the trusted shell in place. | PASS for the observed controls. ADR-017's bounded self-navigation qualification still applies. |
| SEC-05 technical preview | The separate admin wrapper and temporary local IndexedDB survived offline reopen within TTL. Close, active expiry, startup cleanup and resumption eligibility behaved as expected. | PASS locally. Full G4 authorization and older-version private URL flow remain future work. |

The first review found that the shell needed to bind the wrapper to an actual compatible controller and the host needed an exact built-asset check before applying the wrapper CSP. The corrected build requires the wrapper-addressed worker URL, validates the preview host asset before delivery and tests the wait/failure lifecycle to a terminal result. Browser matrix (archived locally)

Both actual installed-device isolation and hosting-policy evidence are pending for G1. [Physical checklist](g1-test-plan.md) · Retired route findings (archived locally)

## S2 isolation and local device integrity

The catalog-installed child viewer still requires the compatible controlling worker, exact build-owned wrapper, approved headers and early meta policy, and the opaque inner frame before the verified bytes become active. The matrix rechecked missing and incompatible wrapper responses, obsolete worker failures, same-size corrupt bytes, scoped ordinary network/API denial and admin preview eligibility. The documented inner self-navigation residual risk remains. Browser matrix (archived locally)

The mock gateway enforces same-origin loopback access, one-use demo pairing, a hashed device token on authorized routes, and current lesson/version checks before granting a short-lived binary attachment. The trusted client rejects a grant outside its exact loopback content path before fetch, compares integrity metadata, verifies the stream, and excludes device credentials from binary fetches and viewer data. Retired viewer routes and static fixture paths do not expose active HTML. Integration log (archived locally) · Browser matrix (archived locally)

The local proof covers the approved scope. Real Supabase RLS, CORS, edge limits, hosted headers and physical browser isolation remain pending. [Limitations](limitations.md)

## S3 local backend controls

Local proofs cover active-owner and live-session enforcement, revoke and expiry, family-specific catalogs and downloads, denied protected-table and RPC grants, private signed transfers, fixed gateway CORS and credential-free structured evidence. The exact-size and expiry regressions showed verified immutable bytes and blocked stale sessions. Deployed RLS and authorization, platform CORS and trusted hosted peer selection remain open G3 checks. [Backend verification](backend.md)
