# Two Vercel applications from one monorepo

The intended GitHub source is `Medrep/eduapp`, branch `main`. After separately authorized connection, create two Vercel projects from that repository:

| Project | Root Directory | Configuration | Output |
| --- | --- | --- | --- |
| Child | `apps/child` | `apps/child/vercel.json` | `dist` |
| Admin | `apps/admin` | `apps/admin/vercel.json` | `dist` |

Enable access to workspace files outside each Root Directory. The checked-in install command resolves the monorepo root, pins pnpm 11.25.0 and uses the frozen lockfile. Build runs in the selected application. Keep Node aligned with `.node-version`. Each project can later deploy automatically from GitHub `main`; connection and deployment are separate operator actions.

Set `VITE_SUPABASE_URL` on both applications and `VITE_SUPABASE_PUBLISHABLE_KEY` on Admin using only the backend's public browser configuration. Configure server-only credentials through the Supabase environment. Do not commit local `.vercel` metadata or `.env` files.

The retained route tables preserve strict shell CSP, exact immutable wrapper paths, no-cache worker and shell responses, and explicit retired-route denials. They currently bind the existing staging Child/Admin origins and public Supabase URL. They are suitable for those approved origins. A new domain requires a separate coordinated update of exact CSP frame origins, backend CORS and frontend configuration, followed by route/browser verification; arbitrary preview URLs are not automatically supported by the current exact-origin policy.

`tests/s5/check-staging-bundles.ts` verifies both roles locally using loopback TLS with the approved hostnames. `scripts/build-vercel-staging.ts` retains the staging build-output generator. The accepted 13-asset reference is `s5-assets.json`; reproducing compiled hashes requires the same public frontend configuration as the original S5 build. Backend-free mock builds intentionally have different bundle hashes.

This cleanup does not connect GitHub, change provider settings, push source or deploy either project. G3 is BLOCKED and G4 is PENDING.
