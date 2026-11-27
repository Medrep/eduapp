# Reproducible workspace checks

Use the pinned [toolchain](versions.md), a frozen lockfile and the genuine fixture. Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm exec playwright install --only-shell chromium
pnpm test:browser --workers=2 --reporter=list
pnpm exec playwright test -c tests/s5/ux.config.ts --workers=2 --reporter=list
```

For the four-profile Chromium/Firefox/tablet matrix, install Firefox and run `pnpm test:browser -c playwright.matrix.config.ts --reporter=list`. Tablet presets are emulation. Physical-device results require the [device plan](g1-test-plan.md).

[Performance](performance.md), [backend setup](setup.md#local-supabase-verification), [SQL audit and crash verification](../../tests/verification/README.md) cover the supplemental checks. Backend and S4 journeys require a dedicated disposable local Supabase stack; never aim them at production. The existing source tests are retained without weakening assertions.

The [CI workflow](../../.github/workflows/ci.yml) runs the workspace checks and Chromium. Local raw results belong in the external evidence directory, or ignored `.local-review/` under a restricted workspace. This page supplies commands; it does not claim a new passing run or release acceptance.
