# Verification limitations and open gates

This source cleanup changes no accepted S5 application behavior, security architecture or formal gate status.

| Item | Status | Required follow-up |
| --- | --- | --- |
| G3 trusted-client rate limiting | BLOCKED | Verify a provider-trusted client identity at hosted ingress and its rate-limit isolation before formal acceptance. |
| G4 deployed integration | PENDING | Obtain separately authorized deployed owner-to-child, policy and rollback evidence. |
| Physical Android installed PWA | NOT RUN | Execute the [physical plan](g1-test-plan.md) and [Android checklist](android-physical-checklist.md), including offline termination/reboot and full fixture interaction. |
| iOS/iPadOS Home Screen application | DEFERRED | No physical compatibility claim; preserve the device plan and accepted specification. |
| Android-only release scope | PROPOSED, unapproved | The [draft ADR](android-first-release-adr-draft.md) does not amend accepted scope. |
| Hosted CI and release acceptance for this export | NOT RUN | A local build/test or clean root commit does not approve deployment or formal gates. |

The inner frame's bounded self-navigation risk remains documented in ADR-017. Shell recovery requires network access if the browser removes its worker and cache; storage persistence estimates are advisory. Historical WebKit cache-retirement observations remain in the local archive and are not new physical evidence.

The Control Tower retains gate, push and release authority. No provider or production changes form part of source cleanup.
