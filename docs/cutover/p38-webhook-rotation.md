# Rotating `AICC_ENTITLEMENT_WEBHOOK_SECRET` (Control Plane and Backend): a bounded maintenance procedure, NOT atomic

Written 2026-11-17 (UTC). **Nothing in this file has been run against a host.** It describes `infra/provision/rotate-webhook-secret.sh` (Mac), `infra/provision/host/aicc-rotate-webhook-secret` (Control Plane host), `infra/provision/host/aicc-rotate-webhook-secret-api` (API host) and `infra/provision/host/webhook-probe.php`, proved by `infra/stack-tests/test_p38_rotation.sh` against a local simulation of both hosts (two scratch directories, a fake `ssh`, the real wp-config renderer, php, and a fake Backend that verifies the HMAC exactly like `app/routers/entitlement_webhook.py`): no network, no real host, no real secret.

## 1. What this is and why

The webhook secret is the HMAC key the Control Plane signs every entitlement event with (`AICC_LM_Entitlement_Dispatcher::sign()`, headers `X-AICC-Webhook-Timestamp` / `X-AICC-Webhook-Signature`) and the Backend verifies (`POST https://api.copilt.org/v1/internal/entitlement/webhook`). It is the **same 64-hex value on two hosts**, and the current value **was exposed in an assistant transcript**, so it must be replaced by a value nobody but the two hosts has ever seen.

| Where | File | Rendered / read as |
|---|---|---|
| Control Plane host `157.230.110.211` | `/etc/aicc/secrets/entitlement-webhook.secret` (root 0600, 64 bytes, no newline) | `aicc-render-wp-config` renders `define( 'AICC_ENTITLEMENT_WEBHOOK_SECRET', '...' )` into `/srv/aicc/shared/wp-config.php` (0640 root:aicc-cp); `php8.3-fpm` is reloaded |
| API host `139.59.157.231` | `/etc/aicc/backend.env` (640 root:aicc), exactly one line `ENTITLEMENT_WEBHOOK_SECRET=<64 hex>` among other secrets that are never touched | `aicc-backend.service` runs `docker run --rm --name aicc-backend --network host --env-file /etc/aicc/backend.env <image>`: only a **restart** re-reads the file |

## 2. What is and is not guaranteed (read this first)

* **It is not atomic.** The Backend holds ONE secret (no "previous" slot; adding one needs a Backend code change and an image deploy, which this procedure does not do). So the two hosts cannot change at the same instant. Between the Backend restart and the Control Plane promote (target: well under 60 s; the script prints what it measured) **every delivery from the Control Plane is answered `401 webhook_signature_invalid`**.
* **Events survive that window, and the script proves it instead of claiming it.** The Control Plane outbox is durable: 8 attempts with exponential backoff from 60 s to 1 h, a requeue reconciliation, `delivered_at` only after a 2xx; a 401 is a failed attempt, never a drop. On the Backend `event_id` is the primary key (a repeated delivery is a no-op) and only a strictly higher `sequence` changes an entitlement, so retries are idempotent and cannot reorder. After the cutover the script requires **`exhausted == 0`** and **`pending` back at or below the baseline** (taken before anything changed), polling for up to 10 minutes (`--drain-timeout`, `--no-wait-drain` skips it and says so).
* **What the merchant and the Plugin see:** a Backend restart of a few seconds (the container restarts; `/health` returns after a moment). Entitlement enforcement and every existing licence are untouched: they live in the Backend database, not in the secret. Only the **delivery of new entitlement events** waits during the window and then catches up.
* **The exposed secret is rotated only when `verify` passes after the cutover**, and it is **retired** (its fingerprint recorded on both hosts so a backup restore cannot silently bring it back) only by the separate, explicit `finalize`.
* **The tool never deletes anything.** Every old secret, every env copy, every staged secret is kept (owner rule: complete historical backups are kept). That is also why section 8 exists.

## 3. Architecture and order

```
Mac (owner)                        Control Plane host (CP)                         API host (Backend)
rotate-webhook-secret.sh   --ssh-->  aicc-rotate-webhook-secret (root)   --ssh-->   aicc-rotate-webhook-secret-api (root)
  (orchestrator, no secret)           prepare / emit-next / promote                   stage / apply / probe
  CP key  aicc_cp_prod_operator       probe-new (PHP, aicc-cp) / probe-old            installed by `install-api-tool`
  API key aicc_digitalocean_prod      finalize / rollback / status                    (sha256 verified before and after)
                  \_____ emit-next | stage: the secret exists on the Mac only inside this pipe ____/
```

**Order: Backend first, then the Control Plane.** A failed Backend restart then leaves the Control Plane untouched (recovery is one host: the tool restores the env copy and restarts by itself). The other order would leave the Control Plane signing with a secret the Backend does not know, for as long as the Backend change takes.

Fingerprint everywhere = first 16 hex of SHA-256(`aicc-webhook-secret-fingerprint-v1\n` + secret). It is the only thing ever printed about a secret; it cannot be used to reconstruct one.

**Probes that never touch the database.** The Backend checks the signature **before** it parses the payload. A request whose body is valid JSON without the required fields (`{"probe":"aicc-webhook-rotation"}`), signed with secret S, returns `400 webhook_payload_malformed` if S is the Backend's secret and `401 webhook_signature_invalid` otherwise. `probe-new` on the Control Plane runs `webhook-probe.php` as `aicc-cp` through `aicc-wp eval-file` (the RUNNING constant, signed by `AICC_LM_Entitlement_Dispatcher::sign`, sent with `wp_safe_remote_post`: exactly the production code path and the production allow-list); `probe-old` signs with the previous secret in memory (root, python) and must get 401; the API host repeats both locally against `127.0.0.1:8000`, independent of the Control Plane.

## 4. The commands (Mac, from the Site checkout; every one needs `--confirm-production`)

```bash
infra/provision/rotate-webhook-secret.sh plan     --confirm-production     # read-only, any time: both identities, every preflight, the exact steps; generates and changes NOTHING
infra/provision/rotate-webhook-secret.sh run      --confirm-production     # inside a deploy window: the rotation; stops at READY TO FINALIZE
infra/provision/rotate-webhook-secret.sh finalize --confirm-production --id <ID>   # the separate, explicit retirement of the old secret
infra/provision/rotate-webhook-secret.sh verify   --confirm-production     # read-only, any time (and after ANY backup restore)
```

Others: `status [--id ID]`, `resume [--id ID]`, `rollback [--id ID]` (before `finalize` only), `install-api-tool`, `run --finalize` (rotation and finalize in one go). Options: `--no-wait-drain`, `--drain-timeout SEC` (600), `--poll-interval SEC` (15), `--health-timeout SEC` (90), `--preflight-cmd EXECUTABLE` (an external **read-only** check, for example the launch preflight, run before and after), `--api-hostname NAME` (default `api.copilt.org`: **confirm it, see 10**), `--bystander NAME` (`nourishvik-care`), `--cp-key` / `--api-key` / `--known-hosts` / `--api-known-hosts`, `--force-new-rotation`, `--emergency-outside-window` (resume / rollback only), `--i-reinstate-a-retired-secret`.

**Gates the script applies before it changes anything:** no tracing (`set -x`, `BASH_XTRACEFD`, `SHELLOPTS`, a custom `PS4`), `umask 077`, no history, no core dump; operator keys present with mode 0600; the pinned host keys (`~/.ssh/known_hosts_aicc_prod`, `StrictHostKeyChecking=yes`, no trust on first use) with an entry for **both** addresses; ssh isolated from your config (`-F /dev/null`, `IdentitiesOnly`, `BatchMode`, no tty, no forwarding, no proxy); **host identity of both hosts**: Control Plane = `AICC_ENV=production`, `www.copilt.org`, stage id `3e897286...`; API host = `hostname`, an active `aicc-backend` unit, a Backend `/health` with `status ok`, `database connected`, a 40-hex `build`, an `entitlement_mode`; **deploy windows**: UTC minutes 18-26 and 48-56 of any hour, never UTC hours 02 and 03 (mutating commands only; `plan`, `status`, `verify` run any time); `--ignore-window` and every other address / identity override exist only for the test harness.

**A second run changes nothing:** `run` after a success prints `NO-OP: rotation <ID> reached phase ... (less than 24 h ago)`; `--force-new-rotation` rotates again on purpose. An unfinished rotation blocks a new one (`resume` or `rollback` it).

## 5. What each phase does, where, how long, and what is visible

| # | Phase | Host and change | Time | Visible to merchants / Plugin |
|---|---|---|---|---|
| 1 | preflight (both) | none (the API tool of this checkout runs from stdin; with `run` the baseline is journalled) | seconds | nothing |
| 2 | install-api-tool | API: `/usr/local/sbin/aicc-rotate-webhook-secret-api` root:root 0755, sha256 checked before the move and after | seconds | nothing |
| 3 | baseline | none: outbox `pending` / `exhausted`, Backend `build` + `entitlement_mode`, bystander `StartedAt`, optional `--preflight-cmd` | seconds | nothing |
| 4 | prepare | CP: new 64-hex secret generated ON the host (`secrets.token_hex(32)`), `entitlement-webhook.secret.next-<ID>` (root 0600, O_EXCL temp + fsync + rename); live secret unchanged | seconds | nothing |
| 5 | transfer + stage | `ssh CP emit-next \| ssh API stage` (the Mac only forwards the bytes); API: `/etc/aicc/webhook-rotation/<ID>/next.secret` (0600); the two fingerprints are compared | seconds | nothing |
| 6 | apply | API: complete copy `/etc/aicc/backend.env.pre-webhook-rotation-<ID>` (`cp -p`), ONLY the one line replaced (the rest asserted byte-identical), `systemctl restart aicc-backend`, wait up to 90 s for `/health` ok with the SAME build and mode, local probe | restart a few seconds | **the Backend restarts**; the window opens: Control Plane deliveries get 401 and wait |
| 7 | promote | CP: old kept as `.prev-<ID>`, new renamed over live, `aicc-render-wp-config --env production --confirm-production`, `php8.3-fpm` reload (one retry), the rendered constant's fingerprint compared; **the window closes** | seconds | php-fpm graceful reload |
| 8 | probes | none: CP `probe-new` (400), CP `probe-old` (401), API `probe-old` (401), API `probe-new` (400) | seconds | nothing |
| 9 | drain | none: outbox `exhausted == 0` and `pending <=` baseline | up to `--drain-timeout` | queued events are delivered |
| 10 | observe | none: bystander container unchanged, Backend build and mode unchanged | seconds | nothing |
| - | **READY TO FINALIZE** | the old secret is **not** retired yet; look, then `finalize` | | |
| fin | finalize (separate) | both hosts: the OLD fingerprint appended to `/etc/aicc/webhook-secret-retired.fp` (0600, `<fp16> <UTC> <id>`); CP: `.prev-<ID>` renamed to `.retired-<ID>` (kept); API: the env copy kept; then `verify` | seconds | nothing |

The bystander container `nourishvik-care` shares the API host. The tool only **reads** it (`docker inspect`): it refuses to start when it is not healthy, records its `StartedAt` before and compares after. If something else restarts it during the run (an unattended libc6 upgrade restarted a container on this host on 2026-11-14) the script reports `BYSTANDER CHANGED` and withholds `READY TO FINALIZE`; the rotation itself is then complete and you decide.

## 6. When something fails: every message says the phase, whether anything live changed, and the exact next command

Every step inspects the actual files and does nothing that is already done, so **`resume` is always safe**; a process killed at any point leaves the old file or the new file, never a partial one (the tests kill it with `-9` at every stage of every write).

| Failed in | What may have changed | The tool does by itself | You run |
|---|---|---|---|
| preflight / baseline | nothing | refuses | fix the cause, `plan`, `run` |
| prepare / stage | nothing live (a prepared or staged secret exists, unused; kept) | refuses | `resume --id <ID>` (or `rollback`) |
| apply: restart fails, health fails, probe fails | the Backend env, briefly | **restores the env copy, restarts, waits for health, confirms the old secret is accepted**, then fails loudly; the Control Plane was never touched | `resume --id <ID>` after the cause is fixed, or `rollback` |
| apply: the restore ALSO fails (`CRITICAL ... STATE UNKNOWN`) | the env file is the old one if the restore wrote it; the Backend may not be running | prints the exact manual commands (`cp -p` the copy back, `systemctl restart aicc-backend`) | follow them, then `rollback --id <ID>` |
| apply: connection or tool died (exit 137, 255) | **unknown**: the env may hold the new secret | nothing | `status --id <ID>`, then `resume` (it detects whether the Backend already runs the new secret) |
| promote: render, reload or fingerprint check fails | the CP live file, briefly | **restores `.prev`, re-renders, reloads**, keeps the new secret as `.next-<ID>`; the Backend is already on the NEW secret, so deliveries wait | `resume --id <ID>` (retry) or `rollback --id <ID>` |
| promote: the restore ALSO fails | unknown CP state | prints `CRITICAL`, `STATE UNKNOWN` and the `.prev` path | `status --id <ID>`, fix, `rollback --id <ID>` |
| promote: connection or tool died | the CP file may be new while the rendered config is still old (`CONFIG_MISMATCH`) | nothing | `resume --id <ID>` re-renders and reloads |
| probes | both hosts hold the new secret but it is not verified (or the Backend still accepts the old one) | refuses to continue; `finalize` refuses | investigate, `rollback --id <ID>` |
| drain | cutover verified; events are queued (not lost) | refuses `READY` | wait, `resume --id <ID>` re-checks the drain; exhausted events: do not finalize until understood |
| observe | rotation complete; the bystander or the build changed | withholds `READY` | read, decide, `finalize` |

`rollback` (before `finalize` only) restores the **OLD secret on both hosts** (Control Plane first, then the Backend): the Control Plane `.prev` file, re-render and reload; the Backend env copy and restart with a health wait; then both probes and the drain. It ends with, in capitals, that **the OLD secret, which is the EXPOSED one, is back in service and the rotation must be re-run**. `verify` after a rollback fails `ROLLED_BACK_EXPOSED_SECRET_IN_SERVICE`. After `finalize`, `rollback` is refused: see 8.

Outside a deploy window a half-rotated state should not wait for the next window: `resume` / `rollback` accept `--emergency-outside-window` (loud; the identity gates still apply). `run` and `finalize` never do.

## 7. Secret hygiene

* The new secret is generated on the Control Plane host and written to `/etc/aicc/secrets/` (root 0600) and, after the transfer, to the API host's root-only files, the env file and `/etc/aicc/webhook-rotation/<ID>/next.secret`. **Nowhere else.** Not in an argument, an environment variable, a log, the journal, the registry, the audit line, a Git file, a terminal, a temp file outside those names.
* **It passes through the Mac only inside one pipeline** (`ssh CP 'sudo ... emit-next --id X' | ssh API 'sudo ... stage --id X'`, `set -o pipefail`, both exit codes read from `PIPESTATUS`): kernel pipe buffers, never a variable or a file of the script. After it, the script compares **fingerprints** returned by each host. `emit-next` refuses to write to a terminal; `stage` refuses to read from one.
* State journal `/var/lib/aicc/webhook-rotation/<ID>.state` (0600, one phase line with a UTC time, fingerprints only); audit line per change `logger -t aicc-webhook-rotate` (action, id, phase, fingerprint **prefixes** of 8 hex); `flock` on `/var/lib/aicc/webhook-rotation/.lock` (a second concurrent run is refused at once).
* The tests hunt two canary secrets through every captured output, log, journal, temp tree and (on a pseudo terminal, sampling every few milliseconds) the argument list **and environment** of every process of a complete rotation.

## 8. The backup-restore boundary (read before restoring ANYTHING)

The tool keeps every old secret **on purpose**: the old Control Plane secret (`.prev-<ID>`, then `.retired-<ID>`), the env copy `backend.env.pre-webhook-rotation-<ID>`, and every older backup of `/etc/aicc/secrets`, `/etc/aicc/backend.env` and the rendered `wp-config.php` taken by the backup jobs before this rotation. **All of those contain the retired (exposed) secret.** Consequences:

1. **After ANY restore of those files, run `rotate-webhook-secret.sh verify --confirm-production`.** It fails loudly with `RETIRED_SECRET_IN_USE` when the live secret of either host (file, rendered config or Backend env) has a fingerprint in the retired registry. (`status` fails the same way.) The registry itself is on both hosts (`/etc/aicc/webhook-secret-retired.fp`) and is **not** restored by restoring the old files; a restore of an older `/etc/aicc` could remove it from one host, which is why both keep it and why `verify` reads both.
2. A restore that brings the retired secret back is **not a recovery of the rotation**: the exposed secret is live again. The only way out is **a new rotation** (`run`, then `finalize`). `verify` keeps failing until then.
3. Restoring a pre-rotation state on **one host only** gives a fingerprint mismatch (`FINGERPRINT_MISMATCH`, and `CONFIG_MISMATCH` when only the secret file came back and the rendered config did not), which `verify` and `status` also flag. Deliveries then get 401 and queue: the situation of section 2 without an end.
4. Rolling back a **finalized** rotation is refused (`rollback` says why). A manual decision to reinstate the retired secret exists: `rollback --id <ID> --i-reinstate-a-retired-secret`. It restores the retired secret on both hosts with a loud warning, journals `reinstated`, **removes nothing from the registry**, and `verify` keeps failing `RETIRED_SECRET_IN_USE` until a new rotation.
5. The two pre-rotation copies and `.retired-<ID>` stay readable only by root (`0600` / `0640 root:aicc`). If you ever decide to delete them, that is a deliberate manual act outside this tool.

## 9. What this procedure does NOT do

* No Backend code change and no dual-secret acceptance (a `previous` slot would remove the window; it needs a Backend change and an image deploy: a separate decision).
* No deletion of any backup, copy, staged or retired secret.
* No other secret: `ACTIVATION_PROOF_SECRET_CURRENT`, `ACTIVATION_PROOF_KID_CURRENT`, `INTERNAL_JOBS_BEARER_TOKEN`, `DATABASE_URL` and every other line of `backend.env` are byte-for-byte unchanged (asserted before the rename, after it and in the tests); the Control Plane's other secrets and every other constant of `wp-config.php` are unchanged (the preflight refuses when a render would change anything but the secret).
* No change to the Plugin, the licences, the entitlement mode, the bystander container, DNS or any other host.
* It does not prove the **running php-fpm workers** hold the new constant: the probe runs in a fresh `wp` CLI process after the reload. The reload is a graceful `systemctl reload` and its exit code is checked (one retry); the drain check then shows real deliveries from the cron.

## 10. Assumptions and what could not be verified locally

* **`sudo` over ssh with stdin:** `emit-next` and `stage` rely on `ssh ... 'sudo ...'` passing a pipe through to the command with no tty (`use_pty` allocates a pty only when a tty is involved). Not verified against the real sudoers; `plan` does not exercise it. If `stage` fails with a refusal about stdin, stop: nothing was changed.
* **Real `systemctl restart` timing** of the Backend container (the tests use a fake that restarts instantly). The health wait is 90 s by default.
* **The API host name:** `--api-hostname` defaults to `api.copilt.org`; the real `hostname` of the droplet was not available. `plan` fails with the real name in the message if it differs; pass it explicitly.
* **`nourishvik-care` health:** accepted when `State.Status=running` and the health status is `healthy` or absent; its real healthcheck configuration was not available.
* **Outbound HTTPS from the Control Plane host as root** (`probe-old`) to `api.copilt.org`: the PHP `WP_ACCESSIBLE_HOSTS` allow-list is WordPress-level; no host firewall rule was seen that blocks root. The Control Plane `probe-new` uses the same path as production deliveries.
* **`aicc-mail health` output shape:** the tool reads `license_outbox.{available,pending,exhausted,oldest_pending_age_seconds}` from the JSON; any other shape makes the preflight fail (nothing is changed).
* The host tools are Python 3 (3.9 tested on the Mac, 3.12 expected on Ubuntu 24.04) rather than bash with an embedded program; same conventions (root only, flock, O_EXCL temp + fsync + rename, journal audit).

## 11. Installing the tools

* **Control Plane host:** `install-stack.sh --only scripts` (from the pushed bundle, like `aicc-set-brevo-key`) installs `/usr/local/sbin/aicc-rotate-webhook-secret` (root 0755) and `/usr/local/lib/aicc/webhook-probe.php` (root 0644). Check with `sudo aicc-rotate-webhook-secret status --expect-stage-id 3e897286ce82e55f4d866acf0d526a5f`.
* **API host:** nothing to install by hand: `rotate-webhook-secret.sh run` (or `install-api-tool`) uploads the file over ssh and checks its sha256 before and after. The `aicc` user needs `sudo` for `python3`, `sh`, `mv` and the tool (it has passwordless sudo today).

## 12. Owner execution package (skeleton: to be completed)

**Before you start (all must be true):** [ ] the Control Plane tool is installed (section 11) [ ] `plan --confirm-production` ends `PLAN OK` [ ] the API host name in the plan matches [ ] the time is inside a deploy window (UTC minutes 18-26 or 48-56, not hour 02 or 03) [ ] nobody else is deploying to either host [ ] _[TO COMPLETE: owner decision on the optional `--preflight-cmd` script]_ [ ] _[TO COMPLETE: how long the owner can watch: the run is about 3 minutes plus the drain, up to 10]_

**Run, in this order:**

```bash
cd <the Site checkout that contains this change>
infra/provision/rotate-webhook-secret.sh plan     --confirm-production
infra/provision/rotate-webhook-secret.sh run      --confirm-production            # prints the id, ends READY TO FINALIZE
infra/provision/rotate-webhook-secret.sh verify   --confirm-production
infra/provision/rotate-webhook-secret.sh finalize --confirm-production --id <ID>  # only after you have read the run output
infra/provision/rotate-webhook-secret.sh verify   --confirm-production
```

**Paste back (nothing else, never a secret):** the `new rotation id`; the lines `fingerprints equal: ...`, `probe-new: PASS`, `probe-old: PASS` (4 lines), `outbox: pending=... (baseline ...) exhausted=0`, `READY TO FINALIZE`; the final `VERIFY OK` after finalize. If anything says `FAILED in phase`, paste that block (it contains no secret) and **do not retry**: it names the next command.

**Stop conditions:** any `CRITICAL`, any `STATE UNKNOWN`, `BYSTANDER CHANGED`, `exhausted` above 0, `RETIRED_SECRET_IN_USE`: stop and paste.

**Approval sentence:** _[TO COMPLETE by the owner]_ **Rollback:** `rotate-webhook-secret.sh rollback --confirm-production --id <ID>` before `finalize`; it puts the EXPOSED secret back, so it is only a pause, never a fix. **After this procedure:** the previous secret is retired on both hosts; keep (do not delete) the files named in section 8; any restore of old files is followed by `verify`.

## 13. Tests

```bash
bash infra/stack-tests/test_p38_rotation.sh        # this procedure (about five minutes: it simulates both hosts and runs about eighty rotations or refusals)
npm run infra:lint                                  # includes the static rules over the three scripts
npm run infra:test                                  # the whole infra suite (test_p38_rotation.sh is in it)
```
