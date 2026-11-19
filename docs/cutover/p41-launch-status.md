# P41 launch status (engineering milestone deployed 2026-11-19, public launch NOT opened)

## Deployed identities (verified on the host, 2026-11-19 22:50 UTC)
| Part | Release id | Source commit | Notes |
|---|---|---|---|
| Site | `20261119T220531Z-8db27c52` | `a3a792f` (branch `feat/p41-site-journey`) | contains the owner commit `2a6a2cb` and the Codex commit `cd52993`; differs from the previous release `20261119T122316Z-6efd45ae` by ONE code change (the header island: `open = view === "open" && !closedByClock`), proven by a normalised diff of all 431 files |
| Control Plane | `20261119T224150Z-90da3713` | `635ad8c` (branch `feat/p41-cp-journey`) | contains the owner commit `43d2cab` and the Codex commit `9a5b6c3`; database schema version 10 (additive, unchanged) |

Branch heads after deployment: Site `feat/p41-site-journey` = the msgid snapshot commit `fe99033` (snapshot only, not part of any export) plus later docs; Control Plane = `635ad8c`.

## Required ancestors (a later release MUST descend from these; the drivers in the evidence folder refuse otherwise)
* Site: `cd52993bcac803b9ce996aeb28db4da907a27026`
* Control Plane: `9a5b6c34959e3cc072bfa40d0678773774def30d`
Check: `git merge-base --is-ancestor <sha> HEAD`. Never build from a stale P40/P41 worktree.

## What is live
Signup status `mode: "off"`, `/start/` and `/request-access/` 404, Commerce closed. Cards link to `/get-started/` ("See how it works"), the planned price sits unstruck above FREE. NO strike is visible: neither renderer emits strike markup without its approval reference.

## Remaining approvals (owner-only; none can be done by engineering)
1. Strike clearance reference (counsel; Israel + one EU/UK reading; documented intent and a real purchase path after the offer): Site build `AICC_EA_STRIKE_COUNSEL_APPROVED` with `NEXT_PUBLIC_AICC_EA_STRIKE=on`; Control Plane `AICC_PRICING_STRIKE_APPROVAL` (+ `AICC_PRICING_STRIKE_PREVIEW=true`). The strike still renders only while sign-up is `open`.
2. Opening trial issuance: Turnstile widget and secret, owner facts (notify, trusted proxy, milestone sync), legal review, Plugin 1.1.2 signed offline and published (`p41-plugin-publication.md`), explicit authorization; runbook `p41-activation-runbook.md`.
