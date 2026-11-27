# G1 physical-device test plan

Prepared during S0 and updated for the authorized S1 passive-wrapper correction. Physical-device tests are `NOT RUN`. This plan uses the accepted [architecture](../02_ARCHITECTURE.md), [threat model](../05_SECURITY.md), [acceptance tests](../06_TESTS_ACCEPTANCE.md), and [delivery plan](../07_DELIVERY_PLAN.md).

## Device matrix

| Required environment | Physical device model and availability | OS version/build | Browser version/build | Test and evidence operator | Test status |
| --- | --- | --- | --- | --- | --- |
| Android Chrome installed child PWA | Samsung tablet, approximately 10 inches, planned. Exact model TBD. | Recent Android planned. Exact version and build TBD. | Chrome version and build TBD. | TBD | `NOT RUN` |
| iPhone or iPad Safari Home Screen Web App | No physical device confirmed. | TBD | TBD | TBD | `NOT RUN` |

The Control Tower authorized S1 development and virtual verification. Physical device and operator confirmation is pending for G1. Acceptance requires observed results on both installed physical platforms.

Browser automation and emulated profiles provide supplemental evidence for the wrapper candidate. G1 requires the physical-device procedure below. [Build and browser evidence](build-tests.md)

Small viewport, portrait/landscape, throttled/offline network, two browser contexts and cleared/full storage remain in the full [compatibility matrix](../06_TESTS_ACCEPTANCE.md#c-compatibility-matrix-mandatory). Record whether the Apple browser tab and Home Screen app share the relevant state. Attach physical-device sign-off under the operator's name.

## Preconditions and origins

1. Use the authorized S1 candidate from accepted G0. Record the candidate revision, SW version, test timestamp and actual origins. The Control Tower assigned technical admin-preview proof to G1 and full admin integration to G4, as recorded in the accepted checkpoint (archived locally).
2. Use distinct child and admin origins in all environments. Local desktop harness origins can differ by port. For installed device testing, use an authorized HTTPS test origin reachable by each physical device with a device-trusted certificate. Configure each test host to reserve the exact versioned wrapper and retired viewer namespaces ahead of redirects and SPA fallback. Verify the deployed wrapper’s required header and meta policies. Hosting provider, private test endpoints and access are operator inputs.
3. Use a disposable test browser context and candidate-only data. Before seeding, run `wc -c < fixtures/rocks-soil.html` and `shasum -a 256 fixtures/rocks-soil.html`. Require exactly 333,033 bytes and SHA-256 `7590b609c72a5e454887707ed16a5e3de6bec759ea1fc2e88247f9654265566c`. Record the command output. Preserve the original bytes. Keep diagnostic fixtures separate.
4. Prepare browser inspection or equivalent capture for SW control, response headers, console and network traces. Use only isolated test accounts and controlled diagnostic endpoints. Exclude all credentials, signed URLs, private content bytes and personal data from evidence.

## Local proof setup

1. Build the production-style shells with the pinned workspace toolchain and `pnpm build`. Use the built shells for offline lifecycle checks. Vite development mode serves source and lacks the production precache.
2. For desktop inspection, run `pnpm preview:child` and `pnpm preview:admin` on the separate loopback origins listed in [setup](setup.md). For physical devices, make the same built candidate available on the separately authorized HTTPS test origins above.
3. In a fresh test context, wait for each shell to be controlled by its own worker. For the desktop Child file-import proof only, build without backend variables and open `http://127.0.0.1:4173/#s1-proof`, then select the verified original through the file input. The normal Child library uses pairing and catalog sync; use that journey for installed-device acceptance. On Admin, an unconfigured backend on a loopback hostname shows the technical preview directly at `/`; use authenticated owner preview for deployed integration. Record response headers and behavior at each origin.
4. For a worker update, stage the approved successor test build on the same child test origin. Record the old and new worker identities, the waiting and activation sequence, and successful offline reopening with the preserved lesson. If retaining test state fails, capture the observed phase and stop at that check.

## Threat model and proof strategy

Treat all uploaded lesson HTML as untrusted. Protect the trusted shell, child credentials and data in IndexedDB, owner session and preview data on the admin origin, and other locally stored lessons. Authorized test data represents these assets in the harness. Keep the trusted shell policy strict. Have each worker serve only its approved fixed public wrapper asset. Verify that the trusted read checks authorization, installed version and exact bytes before assigning the original decoded source only to the opaque inner iframe. The wrapper supplies the inherited policy. The child shell cache contains its versioned assets and wrapper. IndexedDB holds installed lesson data. Test app storage loss independently of network loss.

Capture the actual wrapper response and early meta policies and run the interaction and privilege checks together on each physical browser. A viewer can pass one and fail the other. The accepted residual risk is self-frame navigation from deliberately malicious authored HTML. Record the observed behavior and verify containment of trusted data.

## Operator checklist for each physical device

| Check | Procedure and pass condition | Acceptance reference |
| --- | --- | --- |
| Install and control | Open the test URL online. Install via Chrome or Safari Add to Home Screen, reopen in standalone mode and verify SW controller, scope and installed shell. Record OS, browser/installation context, SW ID and screenshots. Check unready behavior from a fresh context and record any IndexedDB partitioning. | COMPAT-01 |
| Verified fixture and passive wrapper | Load the verified original into child IndexedDB. Capture the exact versioned wrapper response, MIME, `nosniff`, `no-referrer`, HTTP CSP and early meta policy. Confirm strict shell CSP, exact source and that the inner `srcdoc` executes in an opaque iframe configured with only `allow-scripts`. Verify that stale, missing or wrong wrappers, redirects, SPA fallbacks and unauthorized/corrupt bytes do not mount lesson content. | AT-16, SEC-01, SEC-02 |
| Complete lesson | Confirm all 12 sections, nine decoded JPEGs, six photo questions, 15 quiz questions, diagrams, feedback, keyboard/pointer/touch input, final-slide wraparound and trusted-shell back navigation. Cover portrait and landscape and record section-by-section results. | AT-04, COMPAT-01 |
| Genuine offline and lifecycle | Enable airplane mode and verify Wi-Fi stays off. Reopen the installed app, navigate the full lesson, terminate and restart the app, then reboot and repeat offline. Restore access to exercise SW update and activation and verify offline use again. Record each phase and check retained IndexedDB, shell assets and version transitions. | AT-04, AT-16, COMPAT-01 |
| Privilege boundary | Run the project's purpose-built isolation tests in the disposable environment. Verify denied access to parent DOM, child credentials, local browser storage, host APIs, admin context and other lessons. Keep the trusted parent screen and its data in place. | SEC-01 |
| Resource and navigation behavior | Record browser/network observations for blocked remote resource and API requests. Exercise the specified navigation, popup and form checks with controlled destinations. Document the browser's observed self-frame navigation behavior, with no exposure of parent privileges or other lesson bytes. | SEC-02 |

Repeat the applicable shell and response-policy checks after SW activation and update. Full release-level AT-04 includes the real sync journey. This S1 proof covers the local seed, installed viewer and offline portions. For G1's SEC-05 technical proof, observe the admin worker's separate origin, restrictive wrapper response and distinct origin, fixture interaction, denied privileged access, close deletion and expiry on both target device browsers. Full admin integration and older-version private URL flow are G4 work.

## Results and stop conditions

For each check, record `PASS`, `FAIL`, `NOT RUN` or `INCONCLUSIVE`, device, candidate revision, timestamp and relative links to screenshots or video, wrapper response headers and meta policy, sanitized console/network traces and notes. Write observed G1 results to `docs/verification/g1-viewer.md` and link security evidence from `docs/verification/security.md`. Record detail for any divergence across the two physical platforms.

Block G1 if the original fixture is unverified, either required physical run is missing or inconclusive, the viewer fails an interaction or offline lifecycle case, or the isolation and response policy do not hold. Record the known self-frame navigation residual risk. Stop at any behavior that would require changing the accepted security or target-platform decisions and send the finding to the Control Tower.
