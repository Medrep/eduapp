# Pinned toolchain and verification environments

| Component | Source of truth |
| --- | --- |
| Node | `.node-version` and `package.json`: 24.22.3 |
| pnpm | `package.json`: 11.25.0 |
| Browser harness | Locked `@playwright/test`: 1.64.0; install its matching browsers |
| Workspace dependencies | `pnpm-lock.yaml` and each package manifest |
| Edge dependencies | Each gateway's `deno.json` and `deno.lock` |
| Local backend verification baseline | Supabase CLI 3.4.0, Docker, PostgreSQL 17.12, Edge Runtime v1.79.5 / Deno 2.1.4 |

Record actual OS, runtime, browser version and candidate revision with every run. Desktop and tablet emulation do not establish installed-device compatibility. Physical Android is NOT RUN and iOS/iPadOS is DEFERRED.
