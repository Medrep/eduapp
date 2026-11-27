# EduApp / Moja Nauka

A pnpm monorepo with a child offline lesson PWA, a separate owner Admin application, shared TypeScript packages, and a Supabase backend. Both applications use React and Vite. Untrusted lesson HTML runs inside an opaque sandboxed iframe through a verified passive wrapper.

Use Node from `.node-version` and pnpm from `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm exec playwright install --only-shell chromium
pnpm test:browser --workers=2
```

`pnpm preview:child` serves `http://127.0.0.1:4173`; `pnpm preview:admin` serves `http://127.0.0.1:4174`. The local Child mock accepts the single-use demo code `ABCDE-FG234`; restart the preview and clear pairing to repeat. Production builds use public Supabase configuration as described in [setup](docs/verification/setup.md).

- `apps/child` and `apps/admin`: independent Vercel applications in one GitHub repository.
- `packages`: shared contracts and lesson validation helpers.
- `supabase`: migrations, Edge gateways, local tooling and backend tests.
- `tests`, `fixtures`, `scripts`: reproducible checks and the owner-approved original lesson fixture.
- [SPEC](SPEC.md), [ADRs](docs/08_ADRS.md), and [security contract](docs/05_SECURITY.md): maintained product and architecture requirements.
- [Verification guide](docs/verification/README.md), [contributor instructions](AGENT_HANDOFF.md), and [Vercel setup](docs/verification/vercel.md).

This source export does not approve release gates. G3 remains **BLOCKED** on trusted-client rate limiting; G4 is **PENDING**. Physical Android tests are **NOT RUN**; iOS/iPadOS work is **DEFERRED**. Detailed historical execution evidence remains in local archives outside the publication tree.
