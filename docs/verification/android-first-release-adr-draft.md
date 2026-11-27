# Draft ADR — Android-first initial release scope

**Status — PROPOSED. Approval and implementation of the scope change are pending.**

The accepted SDD treats both an installed Android Chrome PWA and Apple
Safari Home Screen Web App as P0 physical targets. The Control Tower's
conditional S5 decision permits virtual development while device evidence is
missing. G1–G5 formal acceptance and release remain separate decisions.

## Proposed decision

For an initial Android-only release, designate the current physical Android
Chrome installed PWA as the sole supported release platform. Require its
existing installed-device acceptance evidence, including offline reboot,
worker lifecycle, storage recovery, isolation and the genuine deployed
integration. Publish Apple Safari Home Screen as deferred and unverified.
Keep the browser-neutral passive wrapper architecture and retain the
Apple test plan for a later scope extension.

Require provider-backed closure of the G3 trusted-client issue, deployed
G4 acceptance, all non-Apple P0 checks, and formal release approval.
Maintain the same separate origins, private Storage, authorization,
integrity, sandbox, CSP, rate limits and owner publication boundaries.

## Minimum approved edits if adopted

- Add this release decision to `docs/08_ADRS.md` and record its bounded
  relationship to ADR-001, ADR-012 and ADR-014. Preserve ADR-004, ADR-015,
  ADR-017 and ADR-018.
- Align `SPEC.md` primary targets, release P0, NFR-007, COMPAT-01 references
  and the G1/G5 release wording. Qualify the affected G1/G2 compatibility
  obligations and original fixture tests in `docs/06_TESTS_ACCEPTANCE.md`
  and `docs/07_DELIVERY_PLAN.md`. Retain Android evidence thresholds.
- Align deployment/release checklists and supported-platform statements in
  `docs/10_OPERATIONS.md` and the release handoff. Keep Apple instructions
  clearly labeled as unverified future-platform guidance where retained.
- In verification records, retain all existing results and record Apple
  physical runs as DEFERRED. Never turn deferred runs into passing evidence.

Release for both platforms remains an alternative after independent physical
Apple evidence. A new authorization must resolve the target scope before
any actual release. This draft changes no accepted specification or ADR.
