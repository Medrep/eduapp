# Supplemental verification tools

These are source-level security and reproducibility tools recovered from the old evidence directory. Their historical outputs remain archived locally. Keep generated input, profiles and receipts out of Git.

## SQL and exact-limit inputs

`supabase/tests/schema-audit.sql` verifies RLS, denied browser privileges and private buckets. The existing backend suites and risk sampler use the genuine fixture and dedicated local Supabase stack; see `docs/verification/setup.md`.

```sh
mkdir -p .local-review/synthetic
python3 tests/verification/make-max-size-lessons.py fixtures/rocks-soil.html .local-review/synthetic
python3 tests/verification/make-max-image-lesson.py fixtures/rocks-soil.html .local-review/synthetic/exact-limit-image.html
cp tests/verification/measure-local-finalize.txt .local-review/measure-local-finalize.mjs
node .local-review/measure-local-finalize.mjs "$PWD" .local-review/synthetic/exact-limit-comment.html .local-review/synthetic/exact-limit-structural.html .local-review/synthetic/exact-limit-image.html
node supabase/tests/risk.mjs .local-review/synthetic/exact-limit-image.html
```

The sampler is an executable Node source template, retained verbatim. It creates disposable local test data and measures container counters, not hosted worker limits. Do not run against a non-disposable stack.

## Real browser crash during IndexedDB activation

The crash case deliberately terminates a disposable Chromium process between queued writes and transaction completion. It verifies the previous Blob/version survives and the partial successor is absent. It supplements the checked-in abort/quota cases.

In an isolated writable checkout, after building the shells, generate the diagnostic spec and config:

```sh
python3 tests/verification/make-crash-harness.py "$PWD" tests/verification/crash-case.fragment.txt
cp tests/verification/crash-config.txt playwright.crash.config.ts
pnpm test:browser -c playwright.crash.config.ts --grep 'browser-process crash' --project=chromium-desktop --project=chromium-android-tablet-portrait --project=chromium-android-tablet-landscape --reporter=list
```

These two generated source files are temporary; do not commit them. Use a separately authorized disposable copy when running outside an explicitly bounded workspace. `playwright.matrix.config.ts` also runs the normal suite on Chromium, Firefox and both tablet emulations. Keep temporary profile writes in an authorized directory through `TMPDIR`.
