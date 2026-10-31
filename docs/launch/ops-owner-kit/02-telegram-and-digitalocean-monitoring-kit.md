# Package 2: TELEGRAM + DIGITALOCEAN MONITORING KIT (one session, about 45 minutes)

Verified against heads: Site 914fade CP 7d61559 Plugin c879b4a Backend 1f99cc0 (2026-10-23).

Paths: `SITE=~/self_projects/ai_copilot_site-worktrees/launch-integration` (until `launch/integration` is landed; never `launch-kitA` or `launch-infra`). Every relative `infra/...` / `scripts/...` command below is run from `cd "$SITE"` (from the home directory it fails with "No such file").

Result: (1) AICC Ops on the Control Plane Droplet messages you in Telegram (`[WARNING]`, `[CRITICAL]`, `[RECOVERED]`), (2) DigitalOcean emails you from the hypervisor side if CPU/memory/disk/load go bad, and both paths are PROVEN by a test alert you received. Today (verified read-only 2026-10-22 and again 2026-10-23): `/etc/aicc-ops/secrets.env` does not exist, so no alert has EVER been delivered anywhere; the DO agent (`do-agent` 3.18.16) is installed and active on the staging Droplet (checked 2026-10-23 with one read-only ssh session), so DO's memory/disk/load policies can work.

Hard rules for you: the bot token is typed ONLY into the hidden prompt on the server (or into BotFather's chat on your phone); never into this chat, a file, a ticket or a shell command line. Scope every DigitalOcean policy to the Control Plane Droplet only; never select "All Droplets"; never touch the API Droplet (`139.59.157.231`, api.copilt.org) or DigitalOcean billing.

## Part 1. Telegram (about 20 minutes)

The server-side tool, subcommands and exit codes below were verified against the repo (`infra/aicc-ops/bin/aicc-ops-secrets`, `aicc_ops/cli.py`); `npm run ops:test` (including the Telegram adapter against fakes) passes at the heads above (re-run it on the day; counts change). The live Telegram delivery itself is NOT proven until you do the steps.

Create TWO bots (one minute each): `AICC Ops` for the server and a separate `AICC Sentinel` for the GitHub watcher (package 3), so revoking one never blinds the other. Keep the chat the same.

1. (phone/desktop Telegram, 2 min) Open `@BotFather` -> `/newbot` -> name and @username (must end in `bot`). It shows the token ONCE. Do not copy it anywhere except the hidden prompt in step 3. Open your new bot, press **Start**, send `hello` (a bot can only message a chat the user started: Telegram Bot docs, core.telegram.org/bots/tutorial, read 2026-10-23).
2. (Mac) open a host session. Today: `~/aicc-rehearsal/bin/stage-ssh -t bash`; after promotion the production operator key (see `production-promotion.md`). On the host set `AO='sudo /opt/aicc-ops/bin/aicc-ops --config /etc/aicc-ops/aicc-ops.toml'`.
3. (host, 1 min) `sudo aicc-ops-secrets set-telegram` -> paste the token at the hidden prompt (nothing echoes). At the chat-id prompt press Enter. Exit 0 and "telegram-check: ok" = valid token. (Alternative for a password-manager pipe: `... | sudo aicc-ops-secrets set-telegram --stdin`; the token is never accepted as an argument or environment variable.)
4. (host, 1 min) chat-id discovery: `$AO telegram-discover-chat` prints chat ids and types, never message text. Pick your private chat's id, then `sudo aicc-ops-secrets set-telegram --keep-token --chat-id <id>` and `sudo systemctl restart aicc-ops`.
5. (host) verify, with the expected result:
   * `sudo aicc-ops-secrets status` and `$AO telegram-status`: present yes, `root:aicc-ops 0640`, token LENGTH shown (never the token), chat id present, exit 0.
   * `$AO telegram-check`: `ok @<your bot>`.
   * `$AO telegram-send-test --send`: your Telegram receives `[TEST] aicc-cp-stage (staging) - Telegram path check <UTC>. No action needed.` (the label becomes `aicc-cp-prod (production)` after promotion).
6. WARNING then RECOVERED, dedupe and cooldown (host, about 6 minutes; full table `docs/cutover/alerting.md` section 1b):
   * `test ! -e /var/run/reboot-required && sudo touch /var/run/reboot-required && date -u` (if the file already exists a REAL reboot is pending: use the backup-timer variant at the end of 1b instead). Within ~60 s you get `[WARNING] <label> ... Host reboot pending ...`.
   * wait 150 s with the file still there: still exactly ONE message (dedupe; cooldown 24 h).
   * `sudo rm /var/run/reboot-required`: within ~60 s `[RECOVERED] <label> ...` with the duration.
   * (optional, wait 31 minutes first or a FLAPPING notice replaces it) touch again, wait 90 s, remove: NO second `[WARNING]` and no `[RECOVERED]` (cooldown; none owed).
   * what was recorded: `curl -s 'http://127.0.0.1:9190/export.json?kind=alerts&limit=6'` shows the FIRING/RECOVERED rows for `reboot_required`, including the suppressed episode. Claude can read this part itself afterwards (no sudo).
7. Secret-leak check (from the Mac, about 1 minute): `~/aicc-rehearsal/bin/stage-ssh -t 'sudo python3 -I -' < "$SITE/infra/aicc-ops/tools/secret_leak_audit.py"` (after the promotion use `$PSSH` instead of `stage-ssh`: the wrapper then logs into PRODUCTION). Expected `RESULT: CLEAN` and `secrets file: mode 640 uid 0 gid <aicc-ops>`; it searches the journal, `/var/log` (+ rotated), `/var/lib`, `/etc`, `/srv/aicc/shared`, `/tmp`, `/run`, shell histories and every process's argv/environment and prints only paths and counts. `LEAK` lines = the token is burned: `/revoke` in BotFather and redo from step 1. Also `sudo stat -c '%a %U:%G' /etc/aicc-ops/secrets.env` -> `640 root:aicc-ops`.

Failure reading: `telegram-send-test` exit 1 = Telegram refused (revoked token, wrong chat id, bot never started); 3 = unusable credentials file (mode/owner); the service log (`journalctl -u aicc-ops`) shows only an enum reason. Replace a token: `/revoke` in BotFather, then step 3 again. Remove: `sudo aicc-ops-secrets remove-telegram`.

Honest limits: Telegram is one shared path for AICC Ops, the Mac sentinel and the GitHub sentinel (a muted chat or revoked token blinds all three); DigitalOcean email (Part 2) and the GitHub workflow-failure email (package 3) are the independent paths. The daily digest is OFF, so "no digest" is not a dead-man signal for AICC Ops itself.

## Part 2. DigitalOcean alert policies (about 20 minutes, free)

Verified against the current DigitalOcean documentation on 2026-10-23: docs.digitalocean.com/products/monitoring/how-to/manage-alerts/ , /products/monitoring/concepts/metrics/ , /products/monitoring/ ("a free, opt-in service ... provided at no additional cost"). The Site's `alerting.md` section 3 (written 2026-10-22) matches: no corrections were needed. Facts to rely on:
* Console path: control panel -> **Monitoring** -> **Create Resource Alert** (top right). Fields: **Metric Type**, **Rule** (`is above` / `is below`), **Threshold** (default 70), **Duration** (only 5 min, 10 min, 30 min, 1 hour), **Droplets or Tag**, notification method (**Email** and/or **Slack**; at least one), name, **Create Resource Alert**.
* Metric names (exact, 12 in total): `1/5/15 Minute Load Average`, `Memory Utilization Percent`, `Disk Utilization Percent`, `CPU Utilization Percent`, `Disk Read/Write I/O`, `Public/Private Inbound/Outbound Bandwidth`. Memory excludes cached memory; Disk is the ROOT disk only; CPU is total across all CPUs; load average is NOT divided by vCPU count; the Droplet must have the DO metrics agent (installed and active here).
* Email recipients must be verified members of the same team (default: the account email). There is no "Droplet down" metric: a dead Droplet is only seen by the external sentinel (package 3). The docs say nothing about recovery/"resolved" emails or delivery latency: UNKNOWN, so do not rely on a recovery email.

Create these four policies, each scoped to the single Droplet `aicc-cp-stage` (this is the same machine that is promoted in place to production; the policies carry over. If you ever create a NEW production Droplet, repeat on it and nowhere else), notification = Email to an address you read:

| Name | Metric Type | Rule | Threshold | Duration |
|---|---|---|---|---|
| `aicc-prod-cpu` | CPU Utilization Percent | is above | 85 | 30 min |
| `aicc-prod-memory` | Memory Utilization Percent | is above | 85 | 10 min |
| `aicc-prod-disk` | Disk Utilization Percent | is above | 75 | 10 min |
| `aicc-prod-load5` | 5 Minute Load Average | is above | 3 | 30 min |

(Measured basis: CPU 24 h average 5.9 %, memory used 38 %, disk 12 %, load5 max 2.9 in the load campaign: `~/aviv_files/AICC/commerce_copilot_images/AICC-launch-evidence/infra/alert-measurements.md`. Optional fifth, skip if the unit is unclear: Public Outbound Bandwidth, 30 min; the form shows the unit.)

Prove delivery (10-20 minutes, then delete):
1. Create a TEMPORARY fifth policy `aicc-test-disk`: Disk Utilization Percent, is above **5**, **5 min**, same Droplet, Email. The disk is at ~12 %, so it must fire. If the form refuses 5, use any value below the percentage on the Droplet's Graphs tab.
2. Wait up to 20 minutes; look in spam. UNKNOWN: DO does not document the delay.
3. When the email arrives, **delete `aicc-test-disk`** (Monitoring -> Resource Alerts -> delete) and confirm the list shows exactly the four policies, each listing `Droplet: aicc-cp-stage`. Until you have both the email and the four-policy list, the policies are NOT counted as live.
4. Tell Claude "email arrived, test policy deleted" (and nothing else about the mail).

Do not add DigitalOcean's paid Uptime checks (price not verified). Do not touch the API Droplet's monitoring.

## Time and order
Telegram steps 1-5 12 min, step 6 8 min (can overlap the DO wait), step 7 1 min; DO 4 policies 8 min, test 10-20 min wait. Order: none between Part 1 and Part 2. Part 1 needs a host session (today the staging Droplet; after promotion the production key). `promote-to-production.sh` keeps `/etc/aicc-ops/secrets.env` (verify with `telegram-status`), but the production re-check is REQUIRED, not optional: after promotion step 6.8 repeat steps 5 (`telegram-send-test --send`) and 7 (leak audit) on the PRODUCTION host with `$PSSH` (production-promotion.md 6.8 and host-readiness item 10). The `[TEST]` message must carry the label `aicc-cp-prod (production)` and the audit must print `RESULT: CLEAN`; redo steps 2-4 as well if the label or the secrets file is lost.

## After your steps: what Claude does immediately
* Reads (no sudo, read-only ssh) the loopback alert history to confirm the WARNING/FIRING and RECOVERED rows, and the `[TEST]` event, and compares them with what you pasted (only the first words of each message, never a token).
* Re-runs `npm run ops:test` and `infra:test` if you change thresholds; updates `alerting.md` status from "not delivered" to the observed facts (with dates).
* Cannot verify: your Telegram inbox, your email inbox, the DO console. Those proofs are yours; Claude records only what you report.
