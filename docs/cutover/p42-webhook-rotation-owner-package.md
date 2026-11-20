# Webhook-secret rotation: status, today's re-validation, and the smallest owner execution package

Written 2026-11-20 (UTC), P42 builder R. **Nothing in this package was run against a host.** Every command below was run for real only against the two-host SIMULATION of the test suite (`bash infra/stack-tests/test_p38_rotation.sh`: **1069 passed, 0 failed**; throwaway canary secrets; transcripts in the evidence folder `cp-dark/p42/R-activation/logs/rotation-transcript.txt`) or, for the local-only commands, directly. The full procedure and its design are in `docs/cutover/p38-webhook-rotation.md` (sections 3-9 and 12); this file is the short owner-facing version with today's pins.

## 0. What is and is NOT authorized today

| | Status |
|---|---|
| The exposed secret `AICC_ENTITLEMENT_WEBHOOK_SECRET` (printed in an earlier execution transcript, 2026-11-15) | still LIVE on both hosts: **never rotated** |
| The rotation tool (Mac orchestrator, Control Plane host tool, API host tool, probe, outbox snapshot, retired registry) | built, security-reviewed twice, tested; merged into this branch (section 1) |
| **Live rotation** | **NOT authorized. NOT executed.** Nothing in this package, in the repository or in any test authorizes it. Engineering will not run any step of it. |
| What the owner authorizes by giving the approval sentence (section 9) | exactly one `run` of the orchestrator in one deploy window, then `finalize`, with the rollback rules of section 6. Nothing else. |
| Not authorized by that sentence | a Backend code change or deploy, a dual-secret period, deleting any old secret or backup, touching `nourishvik-care`, any other secret, DNS, the Plugin, opening public signup |

## 1. Ancestry result: was the rotation tool already in the current line?

**No.** `feat/p38-webhook-rotation` (head `88b99b8`, remote `avivg7/ai-commerce-copilot-site`) is an ancestor of neither `feat/p41-site-journey` (`4963a48`) nor `feat/p41-release-tools`; its merge-base with them is `9d6290e` (the P38 Brevo line). It touches only `infra/` and `docs/`: `host/aicc-rotate-webhook-secret`, `host/aicc-rotate-webhook-secret-api`, `host/outbox-snapshot.php`, `host/webhook-probe.php`, `rotate-webhook-secret.sh`, `retired-webhook-fingerprints.txt`, `install-stack.sh` (+4 lines), `docs/cutover/p38-webhook-rotation.md`, `lint.py`, `run-all.sh`, `test_lint.sh`, `test_p38_rotation.sh`. It is now merged into **`feat/p42-site-readiness`** (merge commit `658f184`, worktree `ai_copilot_site-worktrees/p42-activation`); the only two conflicts (`infra/stack-tests/lint.py` exemption list and `run-all.sh` suite list) were resolved by union, no behaviour change. The tool is on no deployed host yet (the P38 host update copied six files only).

Tests after the merge (this branch): `test_p38_rotation.sh` **1069 passed / 0 failed**; `lint.sh` 694 checks, 0 problems, shellcheck clean; `test_p42_activation.sh` 62; `test_p42_turnstile_key.sh` 274; `test_p37_wpconfig.sh`, `test_p41_lineage.sh`, `test_verify_published*.sh` are re-run and listed in the hand-back.

## 2. Re-validation against today's reality

| What the tool assumes | Today | Verified how |
|---|---|---|
| The Control Plane signs every delivery with `hash_hmac('sha256', "aicc-entitlement-webhook-v1\n" . $timestamp . "\n" . $body, $secret)`, headers `X-AICC-Webhook-Timestamp` / `X-AICC-Webhook-Signature`, **at attempt time** (nothing is stored signed) | the same in the **deployed** CP release `20261119T224150Z-90da3713` (source `635ad8c`): `class-aicc-lm-entitlement-dispatcher.php` is byte-identical to the version the tool was reviewed against (`65d46c0`); `attempt_delivery()` calls `time()` and `sign()` per attempt | read from git (`git show 635ad8c:...`, `git diff 65d46c0 635ad8c -- <file>` empty) |
| The Backend verifies the signature **before** it parses the payload: bad signature `401 webhook_signature_invalid`, good signature with an unparseable payload `400 webhook_payload_malformed`; replay window 300 s | `app/routers/entitlement_webhook.py` of `feat/p37-backend-integrated` = Backend `32db289ea861100c1a4e92697779bfe8532b6160` (image `aicc-backend:launch-p37-32db289`, unchanged): `_verify_signature()` runs first, then `EntitlementChangedPayload.model_validate_json` | read from the Backend worktree; route `/v1/internal/entitlement/webhook`, the path `webhook-probe.php` posts to |
| `AICC_LM_Entitlement_Dispatcher::sign` exists and the outbox is the table `{prefix}aicc_lm_entitlement_outbox` (columns `event_id`, `attempts`, `delivered_at`), `MAX_ATTEMPTS` 8, back-off `30 s * 2^attempts` (cap 1 h), `reconcile_exhausted()` on the 5-minute cron | unchanged in `635ad8c` (`aicc-mail health` still prints `license_outbox.{available,pending,exhausted,oldest_pending_age_seconds}`) | read from git |
| CP host: `/etc/aicc/secrets/entitlement-webhook.secret` (root 0600, 64 hex) rendered into `wp-config.php` by `aicc-render-wp-config`; API host: `/etc/aicc/backend.env` one line `ENTITLEMENT_WEBHOOK_SECRET=<64 hex>`, `aicc-backend.service` restarts the container from `--env-file` | the renderer and the Backend setting name (`entitlement_webhook_secret`) are unchanged | read from the renderer and `app/config.py`; the real host files were not read |
| The render reproduces the live wp-config byte for byte (a promote must change only the secret) | the live render is the P38 render + the five pinned P35 facts + `AICC_LEGAL_SUPPORT_EMAIL`: pinned by the committed fixture/golden `p42-live` | `test_p42_activation.sh` L; the host's own `--compare` is the gate (step 3 below) |
| Deploy windows: UTC minutes 18-26 and 48-56 of any hour, never UTC hours 02 and 03 (= never 02:00-04:00 UTC); the apply step needs at least 356 s left in the window (`60 + health timeout 90 + 20 + 90 + 63 + 33`), promote and finalize at least 60 s | in the tool, unchanged | `rotate-webhook-secret.sh` source (`WINDOW_MIN_LEFT`, `window_gate`, `window_recheck`); section D of the suite (window cases) |
| The probes: `probe-new` must be **400** `webhook_payload_malformed` (the Backend accepts the new signature), `probe-old` must be **401** `webhook_signature_invalid` (it rejects the old one) | unchanged; a `401` for `probe-new` or a `400` for `probe-old` is a failure, a transport error is never a pass | `webhook-probe.php`, the Backend router above, suite sections B/M |
| Pins in the older owner checklist (CP release `20261117T140823Z-42f047ea`, Backend started `2026-11-14T16:19:24Z`) | **stale for the CP**: the live CP release is now `20261119T224150Z-90da3713`. The Backend image is unchanged (`launch-p37-32db289`; its start time was not re-read here: the tool prints `HEALTH ... build=... mode=...` and `BASELINE` in `plan`, compare with `32db289` / `enforced`). `first-store-preflight-p35.sh` carries its own hard-coded pins (CP release, Backend start time, database name): **do not pass it as `--preflight-cmd` unless the coordinator has refreshed those pins** | evidence folder `cp-dark/p35/first-store-preflight-p35.sh` read |
| Host tools installed | believed **not installed** (the P38 host update predates the rotation tool; the API tool is uploaded by `run`) | section 3: `status` on the CP host answers either way |

Two facts that matter for "what is in flight": the CP signs at attempt time, so **no event is ever stored with a signature**; an attempt made while the hosts disagree is answered `401`, counted as one failed attempt and retried later with the then-current secret. Entitlement lives in the Backend database, so a merchant's existing licence and the enforcement mode are not touched by a rotation at all.

## 3. Before the window: tooling and gates (coordinator or owner, no production change)

```bash
SITE=~/self_projects/ai_copilot_site-worktrees/p42-activation      # branch feat/p42-site-readiness (contains 88b99b8)
cd "$SITE" && git status --short && git merge-base --is-ancestor 88b99b8 HEAD && echo "rotation tool is in this checkout"
bash infra/stack-tests/test_p38_rotation.sh | tail -1               # ~15 min: 1069 passed, 0 failed
bash infra/provision/rotate-webhook-secret.sh retired-list          # local, no connection: the off-host retired lists (today: none, the repo file lists none)
```

Install the three CP-host files **one by one with a hash** (the bundle push mirrors with `--delete` and would roll forward unrelated tooling; the P38 update did the same targeted copy). Owner or coordinator, CP host only; the API tool needs no manual install:

```bash
pssh() { ssh -i ~/.ssh/aicc_cp_prod_operator -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$HOME/.ssh/known_hosts_aicc_prod" aicc@157.230.110.211 "$@"; }
SCP() { scp -i ~/.ssh/aicc_cp_prod_operator -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$HOME/.ssh/known_hosts_aicc_prod" "$@"; }
pssh 'mkdir -p -m 700 ~/p42-incoming'
for f in aicc-rotate-webhook-secret webhook-probe.php outbox-snapshot.php; do SCP infra/provision/host/$f aicc@157.230.110.211:p42-incoming/; done
for f in aicc-rotate-webhook-secret webhook-probe.php outbox-snapshot.php; do shasum -a 256 infra/provision/host/$f; pssh "sha256sum ~/p42-incoming/$f"; done      # each pair must be equal
pssh 'sudo install -o root -g root -m 0755 ~/p42-incoming/aicc-rotate-webhook-secret /usr/local/sbin/aicc-rotate-webhook-secret'
pssh 'sudo install -o root -g root -m 0644 ~/p42-incoming/webhook-probe.php /usr/local/lib/aicc/webhook-probe.php'
pssh 'sudo install -o root -g root -m 0644 ~/p42-incoming/outbox-snapshot.php /usr/local/lib/aicc/outbox-snapshot.php'
pssh 'sudo aicc-rotate-webhook-secret status --expect-stage-id 3e897286ce82e55f4d866acf0d526a5f'     # prints the host's rotation state: no rotation yet
```

Rollback of the tooling: `pssh 'sudo rm -f /usr/local/sbin/aicc-rotate-webhook-secret /usr/local/lib/aicc/webhook-probe.php /usr/local/lib/aicc/outbox-snapshot.php'` (inert files; nothing else changed).

Mac prerequisites the tool checks (refuses before any connection otherwise): `~/.ssh/aicc_cp_prod_operator` (mode 0600), `~/.ssh/aicc_digitalocean_prod` (the API operator identity, mode 0600), the pinned host keys for **both** `157.230.110.211` and `139.59.157.231` in `~/.ssh/known_hosts_aicc_prod` (or `--api-known-hosts FILE`), no tracing, no history. Pass `--api-hostname <real name>` if the Droplet's host name is not `api.copilt.org` (`plan` says so).

**Order against the activation (important):** do the rotation BEFORE opening public signup and never in the same hour as an activation render/reload (`docs/cutover/p42-activation-steps.md`): a rotation re-renders wp-config and reloads PHP-FPM, and trial issuance creates entitlement events. With signup closed the outbox is nearly empty (the baseline of `plan` shows how many events are pending).

## 4. The procedure (Mac, from `$SITE`; every command except `retired-list` needs `--confirm-production`)

| # | When | Command | Expected | Changes production? |
|---|---|---|---|---|
| 1 | any time | `infra/provision/rotate-webhook-secret.sh plan --confirm-production` | `Control Plane identity verified: production, www.copilt.org, stage id 3e897286...`; `API host identity verified: api.copilt.org, aicc-backend active, /health ok`; every `ok:` line of both preflights (live secret file valid, rendered config defines the live secret, **a render reproduces the live wp-config byte for byte**, outbox `pending=<n> exhausted=0`, `HEALTH status=ok build=<32db289...> mode=enforced`, bystander `nourishvik-care` running); `PREFLIGHT OK` twice; the 10 steps; `Deploy window right now: OPEN/CLOSED (...)`; `PLAN OK ... Nothing was changed.` | **no** (read-only; the API tool runs from stdin) |
| 2 | inside a window, in its **first 3 minutes** (:18-:20 or :48-:50 UTC; never 02:xx/03:xx) | `infra/provision/rotate-webhook-secret.sh run --confirm-production` | `new rotation id: <ID>` (write it down); phases 1-10; `fingerprints equal: <16 hex>`; `applied: ...`; `probe-new: PASS status=400 error=webhook_payload_malformed` and `probe-old: PASS status=401 error=webhook_signature_invalid` (on both hosts); `measured mismatch window ... about N s`; `drain: state=ok new_pending=0 exhausted=0`; `bystander ... unchanged`; `READY TO FINALIZE: id <ID>` | **yes**: the Backend restarts once (seconds); the CP secret + rendered config change; PHP-FPM reloads gracefully |
| 3 | right after | `infra/provision/rotate-webhook-secret.sh verify --confirm-production` | `VERIFY OK: same secret on both hosts, neither retired, the Backend accepts the Control Plane's signature. The exposed secret is rotated ONLY because this check passed after the cutover.` | no |
| 4 | an open window with at least 60 s left (the drain wait may use the first one up: then the NEXT window) | `infra/provision/rotate-webhook-secret.sh finalize --confirm-production --id <ID>` | a dry run on both hosts, then `RETIRED FINGERPRINT written to the off-host list ...` and the **exact line to commit**: `<fp16> <UTC time> <ID>`; `finalized:` on both hosts; `VERIFY OK` | yes (writes the retired registry; renames the old CP secret to `.retired-<ID>`, deletes nothing) |
| 5 | right after | commit that exact line to `infra/provision/retired-webhook-fingerprints.txt` | a commit; fingerprints only | no |
| 6 | from the checkout that has it | `infra/provision/rotate-webhook-secret.sh verify --confirm-production` | `VERIFY OK` and `off-host retired list: no live fingerprint is listed` | no |

`resume` is always safe and idempotent after any interruption (`status --confirm-production --id <ID>` first when unsure). `run` twice is a no-op (`NO-OP: rotation <ID> reached phase ...`).

## 5. The non-mutating probes (what the 400 and the 401 mean)

`webhook-probe.php` (run by `aicc-wp eval-file` as the PHP user on the CP host) and the API tool post the body `{"probe":"aicc-webhook-rotation"}`, signed with a secret, to `https://api.copilt.org/v1/internal/entitlement/webhook`. The Backend checks the signature **first**: a body that is valid JSON but not an entitlement event is a `400 webhook_payload_malformed` **if the signature is right** and a `401 webhook_signature_invalid` otherwise. So: **new secret signed -> 400** (the Backend holds the new secret), **old secret signed -> 401** (the Backend no longer accepts the exposed secret). The probe never reaches the database and prints only the status and a plain error code, never a secret or a signature. Anything else (a transport error, a `200`, a `503 entitlement_webhook_not_configured`) is a FAIL, never a pass.

## 6. The safe rollback ladder, and how the tool enforces "never reactivate the exposed secret"

The Backend holds ONE secret (no previous slot), so the two hosts cannot change at the same instant; every step inspects the real files and the order is **Backend first, then the Control Plane**.

| Rung | Situation | What happens | You run |
|---|---|---|---|
| 0. Abort BEFORE any change | `plan` FAILs; the preflight refuses (identity, modes, `ENTITLEMENT_WEBHOOK_SECRET` line count, a render that would change more than the secret, outbox exhausted or at 6+ attempts, bystander unhealthy, outside the window or too little window left) | nothing was generated, installed or changed; the message names the cause | fix the cause, `plan`, `run` |
| 1. Failure before the Backend changes | prepare or stage fails | only an unused prepared/staged new secret exists (kept) | `resume --id <ID>` or `rollback --id <ID>` |
| 2. **Roll Backend only** | the Backend restart, its health wait or the local probe fails during `apply` | the tool itself restores the Backend env copy, restarts, waits for `/health`, confirms the OLD secret is accepted again, then fails loudly. The **Control Plane was never touched**, so deliveries keep working throughout. The exposed secret is therefore live again only transiently and only because nothing new is verified yet | fix the cause, `resume --id <ID>` (retry); `rollback --id <ID>` only if you give up |
| 3. **Roll CP only** | render, reload or the fingerprint check fails during `promote` | the tool restores the CP's `.prev` secret, re-renders, reloads and keeps the new one as `.next-<ID>`. The Backend is already on the NEW secret, so deliveries get 401 and WAIT in the outbox until the retry: this state is a mismatch, not a rollback | `resume --id <ID>` (re-promote, the normal way forward); `rollback --id <ID>` only if you give up |
| 4. Full rollback (a pause, never a fix) | any time **before** `finalize` | restores the OLD (EXPOSED) secret on both hosts, CP first, then the Backend; ends with, in capitals, that the exposed secret is back in service and the rotation must be re-run; `verify` then fails `ROLLED_BACK_EXPOSED_SECRET_IN_SERVICE` | `rollback --confirm-production --id <ID>` |
| 5. After `finalize` | the old secret is retired | `rollback` is **refused** (it reads both hosts' journals, both registries and the off-host list first, even half-finished finalizes); the old secret's fingerprint is on three lists: each host's `/etc/aicc/webhook-secret-retired.fp` and the off-host list `~/.aicc-rotation/retired-fingerprints` + the committed `retired-webhook-fingerprints.txt` | none; to reinstate it deliberately (not recommended) `rollback --id <ID> --i-reinstate-a-retired-secret`, which loudly warns, keeps the new secret as `.next-<ID>`, removes nothing from any list, and leaves `verify` failing |

**The rule and how it is enforced.** The exposed secret may be in service only (a) before the rotation, (b) transiently inside rungs 2-4 of an unfinished rotation, never as a final state. Enforcement: `verify`, `run`, `status` fail `RETIRED_SECRET_IN_USE` when a LIVE fingerprint appears in any retired list (also after a restore of old backups that wiped the host registries, thanks to the off-host list and the committed file); a rotation whose new secret is itself retired is refused; `rollback` after `finalize`, or one that would restore a retired secret, is refused unless the explicit flag is given; `finalize` is a separate command that runs a dry run on both hosts before it writes anything. The tool **never deletes** a backup, an old secret or an env copy (those files contain the exposed secret: restore nothing from them without running `verify` afterwards).

## 7. Merchants, events in flight, and how to prove nobody lost an entitlement

* **What a merchant or the Plugin sees:** nothing. The Backend container restarts once (seconds, `/health` returns); licences and the enforcement mode live in the Backend database and are untouched. Only the delivery of NEW entitlement events waits.
* **During the window** (typically seconds; the script prints what it measured, an upper bound that includes the Backend health wait): a delivery attempt is answered `401`, recorded as one failed attempt on that outbox row and retried later (`30 s * 2^attempts`, cap 1 h, 8 attempts, then the 5-minute reconciliation re-queues an exhausted row). Because signatures are made at attempt time, the retry is signed with the new secret. The Backend applies each `event_id` once and only a strictly higher `sequence` per activation, so a repeated delivery is a no-op.
* **The tool's proof (evidence, not a mathematical proof):** before anything changes the CP tool lists the outbox rows not yet delivered (ids and attempt counters only; the snapshot fails closed); after the cutover every event still pending must have been pending BEFORE, nothing may be exhausted, within `--drain-timeout` (600 s). `READY TO FINALIZE` is withheld otherwise, and `finalize` re-checks. An exhausted row that cannot be re-queued blocks the start and `finalize` until the owner decides (`ack-exhausted --confirm-production --event-ids <ids>`, journalled; rows are never touched).
* **Your own evidence, read-only, before and after (paste the numbers):**

```bash
pssh 'sudo aicc-wp aicc-mail health' | jq .license_outbox        # pending / exhausted / oldest_pending_age_seconds: after the rotation pending back to the baseline, exhausted 0
pssh 'sudo aicc-wp eval '"'"'global $wpdb; echo (int) $wpdb->get_var("SELECT COUNT(*) FROM " . AICC_LM_Activator::outbox_table() . " WHERE delivered_at IS NULL"), " undelivered\n";'"'"''   # the same count, straight from the table
```

  On the API host, if you want the Backend side: the number of `store_entitlements` rows and their status distribution before and after must be identical for entitlements that did not change (the coordinator's `first-store-preflight-p35.sh` prints such a `rows` line, after its pins are refreshed). Today the signup is closed and commerce is closed, so very few events exist.
* **Residual risks stated plainly:** (1) an event whose delivery fails 8 times because of an unrelated problem during the same hour; (2) an entitlement whose own expiry falls inside the window and that is meant to be extended by an event waiting in the outbox (none expected today: the trial end is 2026-12-31T22:00:00Z); (3) the simulation's dispatcher is a MODEL of the real outbox: the real timing, the real `systemctl restart` and the real sudoers are verified only in the owner's run (`plan` first).

## 8. Failure handling (one line each; the full table is section 6 of `p38-webhook-rotation.md`)

| If you see | Meaning | You do |
|---|---|---|
| `REFUSED` / `FAIL` in `plan` or the preflight | nothing changed | fix the named cause; `plan` again |
| `FAILED in phase: window` | too little window left before `apply` (or the window closed before `finalize`); nothing live changed | the printed command (`resume --id <ID>` or `finalize --id <ID>`) in the next window |
| `FAILED in phase: apply` | the Backend env was restored by the tool (CP untouched) | fix the cause, `resume --id <ID>` or `rollback --id <ID>` |
| `FAILED in phase: promote` | the CP's old secret was restored; the Backend is on the new one (deliveries queue) | `resume --id <ID>` (preferred) or `rollback --id <ID>` |
| `FAILED in phase: probes` | both hosts hold the new secret but it is not verified | `rollback --id <ID>`, then investigate |
| `drain: state=exhausted` / timeout | cutover verified; events queued or gave up | wait and `resume --id <ID>`; exhausted rows: section 6b of the long document |
| `CRITICAL`, `STATE UNKNOWN`, `BYSTANDER CHANGED`, `BACKEND BUILD/MODE CHANGED`, `RETIRED_SECRET_IN_USE`, `FINGERPRINT_MISMATCH` | stop and paste the block (it contains no secret) | `status --confirm-production --id <ID>`; do not retry blindly |

## 9. The approval sentence

The owner sends this (changing wording is fine) BEFORE step 2 of section 4. It authorizes exactly one rotation by `infra/provision/rotate-webhook-secret.sh` and nothing else:

> "I approve rotating AICC_ENTITLEMENT_WEBHOOK_SECRET with infra/provision/rotate-webhook-secret.sh from branch feat/p42-site-readiness on the Control Plane 157.230.110.211 (release 20261119T224150Z-90da3713) and the API host 139.59.157.231 (Backend image aicc-backend:launch-p37-32db289) in the next deploy window, outside UTC hours 02 and 03: one aicc-backend restart, entitlement deliveries answered 401 and retried by the outbox for a short, measured time (not atomic), nourishvik-care read only, nothing deleted, the old secret kept as a retired backup, rollback puts the exposed secret back and is a pause only. I will run finalize after reading the run output and commit the retired fingerprint line. Public signup stays closed until this is finalized."

## 10. What could not be verified, and deviations

* No production access: the host files, the sudoers rules, `systemctl restart` timing, the real API host name, `nourishvik-care`'s healthcheck, the real outbox and cron timing were not observed (section 10 of `p38-webhook-rotation.md` lists the assumptions; `plan` exercises most of them read-only before anything changes).
* The Backend's start time and the live Backend image were not re-read today; the pins here come from the coordinator's notes (`launch-p37-32db289`, commit `32db289`). The CP release pin comes from the coordinator's launch-status (`20261119T224150Z-90da3713`).
* The section 12 checklist of the long document still names the old CP release; use this file's pins. A note is added there.
* The three-file targeted install of section 3 was written for this package and tested nowhere (plain `scp`, `sha256sum`, `install`).
* The simulation and its transcripts use canary secrets, a fake Backend and fake sudo: they prove the tool's logic and hygiene, not the production environment.
