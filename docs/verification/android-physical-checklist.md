# Android physical acceptance checklist

**Status — NOT RUN.** Planned device is a Samsung tablet of approximately
10 inches. Record exact model, Android build, Chrome version, orientation,
tester, date, build SHA, child/admin URLs and worker scope at execution.
Use a disposable family, pairing code and browser profile. Preserve redactable
screenshots and selected response/request evidence without any credentials,
pairing codes, signed URLs or private lesson content outside the test fixture.

| Area | Required physical observations | Status |
| --- | --- | --- |
| Install and pairing | Install Chrome PWA, launch from Home Screen, verify standalone display and root scope. Pair with a single-use code, reopen, verify persistent context and truthful first-run offline message. | NOT RUN |
| Original lesson | Match exact 333,033 bytes and SHA-256. Open in the passive wrapper and opaque iframe. Traverse 12 sections, verify nine JPEGs, six photo questions, 15 quiz questions and wraparound. Exercise touch, keyboard and pointer where supported. | NOT RUN |
| True offline | Complete sync, enable airplane mode with Wi-Fi off, close the installed app, restart the process and then reboot the tablet. Verify Polish Home, catalog, full lesson and recovery/back navigation in both orientations. | NOT RUN |
| Worker and deployment | Record active/waiting worker, online update and offline reopen, old cache retirement and loss/recovery of shell cache. Inspect both stable HTTPS origins and exact wrapper/worker policies after separately approved deployment. | NOT RUN |
| Sync and storage | Verify initial/delta/retry, 503 and interrupted update preserve prior verified bytes. Check readiness, quota, IndexedDB eviction, reset, re-pairing and tabs racing stale revisions on the disposable profile. | NOT RUN |
| Device authorization | Pair own test family, verify assigned content and scoped downloads, revoke, observe new request denial and continuing availability of previously downloaded authorized content until normal recovery or sync. | NOT RUN |
| Sandbox and privacy | Run the approved negative fixtures. Observe opaque origin, parent storage/token denial, ordinary resource/API denial and actor navigation limits. Confirm there is no privilege leak and distinguish frame self-navigation from escape. | NOT RUN |
| Polish UX and accessibility | Exercises at 360 CSS px or nearest phone-like viewport and real tablet portrait/landscape. Verify 1.3× text scale, readable focus, screen reader names, keyboard order, ≥44×44 CSS px targets and truthful state feedback. | NOT RUN |

Owner and Reviewer should attach observations to AT-01/02/03/04/05/07/08/09/10/15/16/17,
SEC-01/02/03/05/06/07, UX-01/02 and COMPAT-01 as applicable. Emulation
is supporting evidence for conditional development. Physical Apple Home
Screen verification remains **DEFERRED** under current authority. Formal
gate decisions belong to the Control Tower.
