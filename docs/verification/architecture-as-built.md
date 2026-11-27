# Architecture as built

The pnpm workspace contains two independent React/TypeScript/Vite applications, shared contracts and content-lint packages, and Supabase migrations and Edge gateways. Architecture decisions remain in [ADRs](../08_ADRS.md); trust boundaries remain in the [security contract](../05_SECURITY.md).

Child pairs through the device gateway, stores an authorized catalog in IndexedDB, and downloads at most two lessons concurrently per active tab. It verifies size and SHA-256 before committing each Blob and installation pointer in one transaction. Revision and pairing-generation checks reject stale work. A still-authorized earlier version remains usable during a failed update. Public shell assets are cached separately by the Service Worker.

Admin authenticates owners on its own origin and supports lesson editing, upload, preview, publication, rollback, family assignment, pairing and revocation. Its temporary origin-local preview store has a ten-minute TTL and eligibility checks on resumption.

Each application build emits an exact content-addressed passive wrapper. The strict shell CSP permits only that wrapper. The worker and preview host verify its bytes and policies. The trusted client validates the controller, wrapper and authorized lesson before assigning decoded HTML to an opaque inner iframe configured with only `allow-scripts`. Workers never serve active lesson HTML. Retired dynamic viewer namespaces fail closed at host and worker.

The Supabase backend uses private staging and immutable lesson buckets, deny-by-default browser grants, owner/device authorization and transactional publication/catalog operations. See [backend](backend.md) and the retained SQL and HTTP suites. Loopback Vite serves a local mock for credential-free Child verification. Production frontend builds use explicitly supplied public backend configuration.

See [Vercel setup](vercel.md), [checks](build-tests.md), [offline lifecycle](offline-sync.md) and [limitations](limitations.md). Local verification does not establish physical compatibility or close G3/G4.
