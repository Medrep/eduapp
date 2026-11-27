# Contributor and agent instructions

Read `SPEC.md`, `docs/08_ADRS.md`, `docs/02_ARCHITECTURE.md`, `docs/05_SECURITY.md`, `docs/03_DATA_API.md` and the acceptance and delivery contracts before changing behavior. Keep changes bounded. The Control Tower retains formal gate and release authority.

Preserve separate Child/Admin origins, strict shell CSP, exact passive wrappers, the opaque inner iframe with only `sandbox="allow-scripts"`, private Storage, owner/device authorization, SHA-256 checks and atomic lesson activation. Never execute lesson HTML in the trusted shell or Admin DOM. Self-frame navigation remains a documented residual risk. Browser tokens are not Keystore-encrypted. Retain all source tests and genuine fixtures.

The original `fixtures/rocks-soil.html` is included: 333,033 bytes, SHA-256 `7590b609c72a5e454887707ed16a5e3de6bec759ea1fc2e88247f9654265566c`. Preserve its bytes. Do not fabricate device or acceptance results. Run the relevant commands in `docs/verification/build-tests.md` and report PASS, FAIL or NOT RUN.

## Local evidence policy

Keep durable raw execution logs, screenshots, browser profiles, provider receipts and diagnostic captures in a separately authorized directory **outside the repository**, conventionally `../eduapp-local-evidence/<date>-<task>/`. Set `EDUAPP_EVIDENCE_DIR` to that absolute directory when a harness accepts an output path. This convention does not grant permission to write outside an explicitly bounded workspace.

If the session allows writes only inside the repository, use ignored `.local-review/` temporarily and direct `TMPDIR`, tool caches, logs and profiles there. Leave original archives untouched. Never stage local evidence or use `git add -f` to bypass the ignore policy. After a separately authorized archive transfer, retain only maintained commands, contracts, test sources, fixtures and non-sensitive integrity references in Git. Standard `test-results/`, `playwright-report/` and builds are ignored. `.gitignore` does not redact tracked text or history.

G3 is BLOCKED on trusted-client rate limiting, G4 is PENDING, physical Android is NOT RUN and iOS/iPadOS is DEFERRED. Do not promote any gate based on export checks. Pushes, deployment, provider configuration and production changes require separate authorization.
