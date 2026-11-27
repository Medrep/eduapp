# Local development and verification setup

Use Node from `.node-version` and pnpm from `package.json`. Install with `pnpm install --frozen-lockfile`; the [check guide](build-tests.md) lists lint, typecheck, tests and builds.

Child uses `http://127.0.0.1:4173`; Admin uses `http://127.0.0.1:4174`. Preview servers use the same ports. Build first for Service Worker and offline checks. The development server serves source and does not reproduce the production precache.

## Credential-free Child mock

Build without backend environment variables, run `pnpm preview:child`, and enter `ABCDE-FG234`. The loopback-only mock seeds the original fixture and a second lesson. Codes are single-use per server process, followed by `ABCDE-FG235` through `ABCDE-FG239`. Restarting clears in-memory grants. Use **Ustawienia i pomoc** to remove old pairing before repeating. Mock grants are confined to the exact loopback content path.

## Public frontend configuration

`VITE_SUPABASE_URL` selects the backend. Admin also needs `VITE_SUPABASE_PUBLISHABLE_KEY`, containing a public publishable or legacy anonymous key. These are browser configuration, never service credentials. Keep actual local values in ignored environment files or process environment. Never place service-role keys, device peppers or pairing HMAC secrets in Vite variables.

Use distinct HTTPS Child/Admin origins for installed-device tests. The CSP and worker configuration must agree with the selected origins; see [Vercel setup](vercel.md).

## Local Supabase verification

The retained `supabase/config.toml`, migrations, gateways and `.env.example` configure the dedicated `moja-nauka-local` stack (API 54321, database 54322). Use the baseline toolchain in [versions](versions.md), Docker and a separately authorized disposable stack. Do not reset or reuse another project's database. CLI status/start logs can contain local credentials; keep them in the private local evidence directory.

Start that disposable stack with `supabase start`, apply migrations with `supabase db reset --no-seed`, and apply `bash supabase/configure-local-edge-cors.sh` for the local Functions CORS overlay. Create an ignored functions environment file using `supabase/.env.example` with fresh random HMAC/pepper values and the exact loopback origins. Serve with `supabase functions serve --env-file <private-functions-env>` and retain its output privately. Public signup is disabled; `supabase/register-local-owner.sh` registers an existing local Auth UUID.

Run suites sequentially:

```sh
docker exec -i supabase_db_moja-nauka-local psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/schema-audit.sql
docker exec -i supabase_db_moja-nauka-local psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/schema.sql
node --test supabase/tests/backend.test.mjs
node --test supabase/tests/peer.test.mjs
MOJA_S3_BROWSER=chromium node --test supabase/tests/browser.test.mjs
node supabase/tests/risk.mjs
node tests/s4/run.mjs local chromium
```

The [supplemental tools](../../tests/verification/README.md) generate exact 20 MiB inputs and measure local finalization. `supabase/tests/logs.mjs` checks a privately captured Edge log. Use only the dedicated disposable test data. Local container metrics are not hosted worker limits; G3 remains blocked on trusted ingress evidence.
