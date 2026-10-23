# Alerting: three layers, what each sees, and what the owner must still do

Status (updated 2026-10-22): the **code and procedures are in place**; **live delivery is gated on owner actions** (Telegram credentials on the host; DigitalOcean console policies) and **independent 24/7 detection is gated on one owner decision** (a dedicated public GitHub repository for the Actions sentinel, `infra/sentinel/github/README.md`). Verified read-only on the host on 2026-10-22: `/etc/aicc-ops/secrets.env` is **absent** (`telegram-status`: source none, present no), so the adapter is disabled and no alert has ever been delivered anywhere; the host can reach `api.telegram.org:443` (TLS handshake verified). Nothing below claims a delivered alert that was not observed. After the in-place promotion (`production-promotion.md`) the host label in every message becomes `aicc-cp-prod (production)`. **The Mac sentinel is not 24/7** (it is blind while the Mac sleeps, is shut or is offline); only layer C's GitHub Actions variant covers the night, and it is not created yet.

| Layer | What it is | Sees | Cannot see | Delivery | State |
|---|---|---|---|---|---|
| A. AICC Ops (on the Droplet) | `infra/aicc-ops`: 30 s collectors, alert engine, capacity engine, loopback UI `127.0.0.1:9190` | services, RAM/swap/CPU/disk, PHP-FPM, MySQL, 5xx, backups (incl. off-host copy), TLS expiry, restarts | its own host being dead, DNS/firewall/TLS problems on the public path | Telegram (outbound) | deployed on the staging Droplet; engine + adapter tested; **the Telegram adapter is disabled (alerts are recorded locally only) until credentials exist** |
| B. DigitalOcean Monitoring | free Droplet metric alert policies | CPU, memory, disk, load, bandwidth from the hypervisor agent | processes, the application, the public path | **email / Slack only** (no Telegram) | **owner creates the policies in the console** (section 3) |
| C. External sentinel | `infra/sentinel`: outbound HTTPS checks of the public name | DNS, TCP, TLS validity/expiry, `/healthz`, host identity, an app page, latency | resource pressure, internals | Telegram (+ macOS notification) | Mac LaunchAgent **installed and running on the owner's Mac** (Telegram disabled: no secrets file; macOS notifications on); **intermittent, not 24/7**; the 24/7 variant is prepared and needs one owner gate (section 4) |

A single transient error never pages: AICC Ops needs a sustained window (1 to 40 samples of 30 s depending on the rule, see the table), the sentinel needs 3 failures in its last 5 checks.

## 1. AICC Ops to Telegram

Messages (plain text, no parse mode): `[WARNING]`, `[CRITICAL]`, `[RECOVERED]`, `[TEST]`, flapping notices. Each carries the host label (**`aicc-cp-stage (staging)`** today, **`aicc-cp-prod (production)`** after the promotion), the rule title, the current value against the threshold, a UTC time, and (RECOVERED) the duration. A RECOVERED message exists only for a condition that had a sent FIRING notice. Dedupe/cooldown per rule (15 min to 24 h), flap suppression (4 or more state changes in 30 min: further notices for that rule are suppressed until it is stable, which also means that a REAL outage shortly after a noisy period, for example right after a restore drill, can be recorded locally but not sent), at most 30 messages per hour in total. The text contains only rule titles, numbers, the host label and fixed words: an IP, email, cookie, order number, bearer/long token or Telegram token is scrubbed (tested); there is no URL pattern because messages carry no URLs by construction. The **daily digest is OFF** (`telegram.digest_enabled = false`).

Rules shipped (thresholds are provisional; per-rule overrides in `/etc/aicc-ops/aicc-ops.toml` under `[alerts.rules.<id>]`):

| Need | Rule | WARNING / CRITICAL | Sustained |
|---|---|---|---|
| Caddy / site unhealthy | `edge_probe`, `service_down`, `caddy_admin` | probe not 200 / unit not active | 3 / 2 / 4 samples |
| Repeated 5xx | `http_5xx` | 5 % / 25 % of requests (min 20 requests) | 2 samples over a 5 min window |
| High CPU | `cpu_saturation` | 90 % / 98 % | 10 min (WARNING), 20 min (CRITICAL) |
| Low RAM | `ram_available_low`, `ram_high` | available < 200 MiB / < 120 MiB; used 90 % / 96 % | 5 min (`ram_available_low`), 10 min (`ram_high`) |
| Swap | `swap_activity` | swap-in 100 / 1000 pages/s, swap-out 300 | 10 min |
| Disk | `disk_low`, `inodes_low` | disk 85 % / 93 %, inodes 85 % / 95 % used | 2 samples |
| PHP-FPM `max_children` | `fpm_max_children` (counts from the FPM log via a root timer; no socket access) | ≥ 5 / ≥ 40 `reached pm.max_children` events per 15 min | 2 samples |
| PHP-FPM pool status | `fpm_saturation`, `fpm_down` | need the pool status page over the PHP socket: **the collector is switched OFF on the staging host by an earlier owner decision** (it needs the `aicc-ops` account in the PHP socket's group), so these two cannot fire there | 4 / 2 samples |
| MySQL | `db_down`, `db_conn_pressure` | unreachable on its socket; 80 % / 95 % of connections | 2 samples (`db_down`), 10 min (`db_conn_pressure`) |
| Backup | `backup_failed`, `backup_stale`, **`offhost_stale`** | last run failed; newest good backup older than **3 h / 12 h** (matches the hourly timer); no verified off-host copy for 36 h / 96 h, or an acknowledged set that lags the newest backup by that much (**a laptop that sleeps Friday to Monday exceeds 36 h: raise `warn_h`/`crit_h` of `offhost_stale` in the host config if that is the normal pattern**) | 1-2 samples |
| TLS expiry | `cert_expiry` | 14 days / 5 days | 1 sample |
| Unexpected restart/crash | `process_restart`, `unit_failed` | 3 / 6 restarts per hour; an `OnFailure=` hook fired | 1 sample |

### Telegram credentials: the only supported procedure (no secret ever goes through chat)

The owner creates the bot and puts the secret **directly on the host**, typed into a hidden prompt:

1. In Telegram, talk to **@BotFather** → `/newbot` → note the bot's @username (the token is shown once; do not paste it anywhere except step 4).
2. Open your new bot and send it any message (`hello`) so a chat exists.
3. `ssh aicc@stage.copilt.org` (or the reserved IP).
4. `sudo aicc-ops-secrets set-telegram` → paste the token at the hidden prompt (nothing is echoed). It validates the format, writes the file, and runs `telegram-check` itself (`ok`, or exit 1 = written but the check failed; exit 2 = invalid input; exit 3 = refused, e.g. not root). If you do not know the chat id, press Enter at its prompt: the helper only prints a note. Then run `sudo /opt/aicc-ops/bin/aicc-ops --config /etc/aicc-ops/aicc-ops.toml telegram-discover-chat` (it lists chat id and type, never message text) and `sudo aicc-ops-secrets set-telegram --keep-token --chat-id <id>`.
5. `sudo systemctl restart aicc-ops`
6. Verify without sending anything sensitive (`sudo aicc-ops-secrets status` needs sudo: the helper is `0750 root:root`): `sudo /opt/aicc-ops/bin/aicc-ops --config /etc/aicc-ops/aicc-ops.toml telegram-status` (source, owner and mode, token LENGTH, chat-id presence; exit 0 = usable, 3 = not) and `... telegram-check` (bot @username). Then one explicit test message: `... telegram-send-test --send`.

Properties: the file is `/etc/aicc-ops/secrets.env`, mode `0640 root:aicc-ops`, written atomically; the token is never on a command line or in an environment variable, never logged, never in the repository; the CLI refuses a group-writable or world-readable file. **Replacing** a token: revoke it in @BotFather (`/revoke`), then run step 4 again. **Removing**: `sudo aicc-ops-secrets remove-telegram`. Anyone who can read `/etc/aicc-ops/secrets.env` (root, the `aicc-ops` service user) can use the bot for anything the Bot API allows (reading updates, messaging any chat that has talked to it); our software only ever sends the alert text to the one chat.

### 1a. The rules re-verified against the CURRENT measurements (read-only, loopback UI export, 2026-10-22; no PII)

Source: `http://127.0.0.1:9190/export.json` on the host (24 h at 60 s resolution, 7 d at 10 min; the 7 d window includes the Phase 2B load/capacity campaigns of 2026-10-21, so its maxima are test peaks, not normal operation). Evidence: `~/Downloads/AICC-launch-evidence/infra/alert-measurements.md`.

| Rule (default) | 24 h idle | 7 d incl. load tests | Verdict |
|---|---|---|---|
| `cpu_saturation` 90 % / 98 % for 10 / 20 min | avg 5.9 %, p95 10.4 %, max 1-min 69.6 % | 5-min max 100 % (load test) | keep: far from idle; a test peak is shorter than the 10 min sustain |
| `ram_high` 90 % / 96 % | used avg 38.0 %, max 45.2 % | max 54.6 % | keep |
| `ram_available_low` < 200 / < 120 MiB | min available 1,145 MiB | min 1,031 MiB | keep (a real squeeze only) |
| `swap_activity` swap-in ≥ 100 pps, 10 min | 0 | one 10-min bucket at 206 pps during a load test | keep |
| `disk_low` 85 % / 93 % | 12.1 % | 12.4 % | keep |
| `db_conn_pressure` 80 % / 95 % | 3.3 % (max 6.7 %) | - | keep |
| `fpm_max_children` ≥ 5 per 15 min | none | one WARNING (19:11 on 2026-10-21, load test) | keep |
| latency (capacity engine) | caddy p95 avg 9 ms, worst minute 1.7 s | - | informational only |
| `backup_stale` 3 h / 12 h, `backup_failed` | newest good backup ≤ 1 h old | - | keep (hourly timer) |
| `offhost_stale` 36 h / 96 h | 27 acknowledged pulls in 26.5 h; **largest gap 3 h 44 min** (02:06 to 05:51 UTC, Mac asleep), then 2 h 45 min | - | keep. A Mac that sleeps Friday to Monday exceeds 36 h: if that is the normal pattern, raise `warn_h` (owner decision, exact block below) |
| `cert_expiry` 14 d / 5 d | LE certificate 2027-01-19 | - | keep; **off during the dark-production phase** (Caddy's internal certificate lives 12 h), re-enabled by `final-edge` |
| **`wc_cron_stale` 60 min / 240 min** | **5 FIRING + 5 RECOVERED pairs in 24 h** (every ~1-3 h) | heartbeat age max 3,680 s | **CHANGED to warn 7,200 s (2 h), critical unchanged 14,400 s** |

Why `wc_cron_stale` changed (the only change): the collector's fallback heartbeat is "age of the newest completed Action Scheduler action". With no store traffic the only completed action is a roughly hourly housekeeping job, so the age reaches 3,600-3,680 s every hour, exactly the 3,600 s threshold; the rule fired and recovered every few hours (9 pairs in 36 h on an idle host). With Telegram connected that is a message pair every few hours about nothing. 7,200 s is twice the observed maximum. The rule exists to catch a dead WP-Cron timer; that is still caught immediately by `service_down` (`aicc-wp-cron.timer` is in the unit list) and `unit_failed`. The change lives in `infra/aicc-ops/config/aicc-ops.production.toml` (`[alerts.rules.wc_cron_stale] warn_s = 7200`), pinned by a test; the shipped code default is unchanged. Alert events of the 36 h window otherwise: `service_down` 10 pairs (all from the 2026-10-21 failure drills), `cert_unreadable` 2 (during certificate issuance), `db_down` 1 and `collector_failure` 1 (drills), `fpm_max_children` 1 (load test).

Optional owner override for a laptop that sleeps over weekends (not applied): add to `/etc/aicc-ops/aicc-ops.toml`
```toml
[alerts.rules.offhost_stale]
warn_h = 60       # was 36
crit_h = 120      # was 96
```
Every hour added here is an hour in which the only off-host copy may be that stale without anyone being told.

### 1b. Owner checklist: Telegram in 3 minutes (the secret never goes through chat)

`AO='sudo /opt/aicc-ops/bin/aicc-ops --config /etc/aicc-ops/aicc-ops.toml'`; open a host session first (`~/aicc-rehearsal/bin/stage-ssh -t bash` today; the production key afterwards).

1. (60 s) Telegram → `@BotFather` → `/newbot` → note the `@username`; the token is shown once. Open your bot, press **Start**, send `hello`.
2. (30 s) On the host: `sudo aicc-ops-secrets set-telegram` → paste the token at the **hidden** prompt; at the chat-id prompt press Enter if unknown, then `$AO telegram-discover-chat` (prints chat ids and types, never message text) and `sudo aicc-ops-secrets set-telegram --keep-token --chat-id <id>`. Then `sudo systemctl restart aicc-ops`.
3. (90 s) Verify, in this order; every expected result is stated:

| # | Command / action | Expected |
|---|---|---|
| a | `sudo aicc-ops-secrets status` ; `$AO telegram-status` | present yes, owner/mode `root:aicc-ops 0640`, token LENGTH shown (never the token), chat id present; exit 0 |
| b | `$AO telegram-check` | `ok @<your bot>` |
| c | `$AO telegram-send-test --send` | the Telegram chat receives `[TEST] aicc-cp-prod (production) - Telegram path check <UTC>. No action needed.` (staging label before the promotion) |
| d | WARNING then RECOVERED: `test ! -e /var/run/reboot-required && sudo touch /var/run/reboot-required && date -u` (if the file already exists a **real** reboot is pending: do not use this test, see below) | within ~60 s: `[WARNING] <label> ... Host reboot pending ...` (no package names) |
| e | dedupe: wait 150 s with the file still present | still exactly **one** message (the condition holds, nothing repeats; cooldown 24 h) |
| f | `sudo rm /var/run/reboot-required` | within ~60 s: `[RECOVERED] <label> ...` with the duration |
| g | cooldown (optional; wait **31 minutes** after f, otherwise 4 state changes in 30 min raise a FLAPPING notice instead): touch the file again, wait 90 s, remove it | **no** second `[WARNING]` (cooldown 24 h) and no `[RECOVERED]` (none is owed: no FIRING notice was sent in this episode) |
| h | what AICC Ops recorded: `curl -s 'http://127.0.0.1:9190/export.json?kind=alerts&limit=6'` | FIRING/RECOVERED rows for `reboot_required` (the suppressed episode appears as a row but was not sent) |
| i | secret-leakage audit (from the Mac): `ssh -t aicc@<host> 'sudo python3 -I -' < infra/aicc-ops/tools/secret_leak_audit.py` | `RESULT: CLEAN`, `secrets file: mode 640 uid 0 gid <aicc-ops>`; it searched the whole journal, `/var/log` (+ rotated `.gz`), `/var/lib`, `/etc`, `/srv/aicc/shared`, `/tmp`, `/run`, shell histories and every process's command line and environment for the token, printing paths/counts only. Exit 1 + `LEAK` lines = treat the token as burned (BotFather `/revoke`, repeat step 2) |
| j | `sudo stat -c '%a %U:%G' /etc/aicc-ops/secrets.env` ; `git grep -n 'TELEGRAM_BOT_TOKEN=' -- ':!*tests*'` in the repo | `640 root:aicc-ops`; no value in any file |

If a real reboot marker exists (unattended-upgrades created it), use this instead of d-f: `sudo systemctl stop aicc-backup.timer` (a `service_down` CRITICAL for that unit after ~60 s), then `sudo systemctl start aicc-backup.timer` (RECOVERED). The backup timer is only paused for the minutes in between; run `sudo systemctl start aicc-backup.service` afterwards if the pause spanned :17.
Failure reading: `telegram-send-test` exit 1 = Telegram refused (revoked token / wrong chat id / bot not started), 3 = unusable credentials file (mode or owner), the service log (`journalctl -u aicc-ops`) shows only an enum reason. Telegram messages are plain text; the daily digest is OFF.

## 2. Failure modes: who sees what (summary; the full matrix is `infra/sentinel/DESIGN.md` section 2)

* Process crash, resource pressure, backup trouble, a certificate about to expire: AICC Ops (A).
* The whole Droplet down, kernel panic, network outage, firewall mistake, DNS or TLS wrong on the public path: **only C** sees it (A and its Telegram path die with the host). B may notice missing metrics but its behaviour on missing data is not relied on.
* The application broken while Caddy answers: C with a PHP-rendered target (`stage-app`), A through 5xx/FPM/MySQL rules.
* AICC Ops itself dead: not detected by A. Mitigations: `Restart=on-failure`, `MemoryMax`, DO memory policy; a true dead-man ping needs a third-party service (owner decision, not taken).

## 3. DigitalOcean alert policies (free; owner creates them, ~5 minutes; no token is requested or used)

Facts from the DigitalOcean documentation (docs.digitalocean.com/products/monitoring/how-to/manage-alerts and /concepts/metrics, read 2026-10-22): metric types are **1/5/15 Minute Load Average, Memory Utilization Percent, Disk Utilization Percent (root disk only), CPU Utilization Percent (all cores), Disk Read/Write I/O, and Public/Private Inbound/Outbound Bandwidth**; the rule is "is above" or "is below" a threshold; **the only durations are 5 min, 10 min, 30 min and 1 hour** (the earlier "15 minutes" in this document does not exist as a choice: corrected below); notification is **email and/or Slack, at least one**; memory excludes cached memory; load average is **not** normalised by vCPU count. **There is no "Droplet down / unreachable" metric**: a dead Droplet is detected only by the external sentinel (an earlier text claiming DO covers "droplet down" was wrong).

Where: DigitalOcean control panel → **Monitoring** → **Resource Alerts** tab → **Create Resource Alert** (older UI wording: Alert Policies). Scope each policy to **the single Droplet `aicc-cp-stage`** (keep this name: renaming a Droplet has no benefit and the console label is not used by our software); **never select "All Droplets", never touch the API Droplet's policies**. Notification: **Email** to an address you read (the account e-mail is the default; add a second address if you have one; Slack only if you already use it). Whether `ops@copilt.org` (the ACME contact) forwards to a mailbox you read is UNKNOWN to this repository: send the temporary test below to find out.

Values for a 1 vCPU / 2 GiB host, chosen so that they act as the **independent safety net** behind AICC Ops (which warns first, in Telegram, at lower durations) and do not duplicate its noise. Measured basis (section 1a): CPU 24 h avg 5.9 %, memory used 38 % (cache excluded, same definition as DO), disk 12 %, load 5-min max 2.9 during the load campaign.

| Policy name | Metric | Rule | Threshold | Duration | Severity | Rationale |
|---|---|---|---|---|---|---|
| `aicc-prod-cpu` | CPU Utilization Percent | is above | **85** | **30 min** | warning | equals the capacity engine's `upgrade_cpu_p95_pct`; 30 minutes is real demand, not a cache purge; AICC Ops warns at 90 % / 10 min first |
| `aicc-prod-memory` | Memory Utilization Percent | is above | **85** | **10 min** | warning | idle 38 %, load-test max 55 %; 85 % means a leak or a runaway process with OOM near; AICC Ops `ram_high` is 90 % (used) and `ram_available_low` < 200 MiB |
| `aicc-prod-disk` | Disk Utilization Percent | is above | **75** | **10 min** | warning | 12 % today; 75 % leaves weeks to act before AICC Ops' 85 / 93 % |
| `aicc-prod-load5` | 5 Minute Load Average | is above | **3** | **30 min** | warning | not normalised: on 1 vCPU, 3 sustained for 30 min is severe CPU/IO contention (capacity engine `upgrade_load_per_vcpu = 3.0`); DO's generic advice (about the vCPU count) would page on every burst of this single-core box |
| `aicc-prod-egress` (optional) | Public Outbound Bandwidth | is above | **UNKNOWN unit: read it in the policy form** (expected Mbps) | 30 min | warning | measured: normal ≤ ~2 Mbit/s 10-min average, 24 Mbit/s peak in a load test. Set it to roughly 10x normal once you see the unit, and compare with the Droplet's included transfer (shown on the Droplet's *Networking* page; **not verified here**). Skip it if the unit is unclear. |

Do not add a paid product (DigitalOcean's Uptime checks: price and channels not verified). Do not modify the existing API Droplet's monitoring.

**Prove delivery (10 minutes, then delete the test):** create a 5th policy `aicc-test-disk` = Disk Utilization Percent is above **5** for **5 min** on the same Droplet (the disk is at 12 %, so it must fire); an e-mail should arrive within about 10 minutes (look in spam); then **delete** `aicc-test-disk`. These policies are **not counted as live** until you confirm that e-mail and that each of the four policies shows "Droplet: aicc-cp-stage".

## 4. External sentinel (24/7): honest evaluation of the free options

Facts checked 2026-10-22: `gh auth status` (account `avivg7`, repo-admin token); `gh repo view` / `gh repo list` (read-only); GitHub documentation (events that trigger workflows; about billing for GitHub Actions); provider pricing pages fetched today (UptimeRobot, Better Stack, Healthchecks.io).

| Option | 24/7? | Independent of DO and the Mac? | Cost | Privacy | Reliability facts | Verdict |
|---|---|---|---|---|---|---|
| **Mac LaunchAgent** (`infra/sentinel/macos`, installed) | **No**: nothing runs while the Mac sleeps, is shut, travels or is offline; an outage that starts and ends meanwhile is never seen | independent of DO; **is** the Mac | free | local | 120 s resolution when awake | keep as a second observer; **never call it 24/7** |
| **GitHub Actions, dedicated PUBLIC repo** (prepared: `infra/sentinel/github/`) | roughly: best effort | yes / yes (GitHub-hosted runners) | free (public repo: standard runners free; a private repo has 2,000 min/month on GitHub Free, a 10-minute cadence needs ~4,300) | the workflow, `targets.toml` (host name + Reserved IP, both public DNS facts) and **run logs are public**; probes `https://www.copilt.org/healthz` only; Telegram token/chat id are Actions secrets | "shortest interval is once every 5 minutes"; "can be delayed during periods of high loads"; "only run on the default branch"; **auto-disabled after 60 days without repository activity** (public repos); state kept in the Actions cache | **recommended as the 24/7 observer**; one owner gate (create the repo, two secrets); detection 20-40 min, not minutes |
| `avivg7/ai-commerce-copilot-site` (the existing public repo) | - | - | free | - | public, **last push 2026-08-19 (64 days: already past the 60-day mark)**, and its `main` is the live old www site with a Pages deploy workflow and the rollback tag: a push there can redeploy the live site | **do not use** |
| Private repos (`aicc-backend`, `aicc-control-plane`, plugin) | - | - | quota-limited (above) | private | - | do not use |
| UptimeRobot free | yes (5-minute checks, 50 monitors) | yes / yes | $0 | third party sees the URL | page describes Free as "good for hobby and non-profit projects" (commercial use ambiguous; its terms were reported to have changed in 2026: unverified); **Telegram on the no-cost plan not confirmed** (Free lists "only 5 integrations"; no SMS/voice credits) | evaluated, **not signed up**; a candidate second observer once terms and channels are verified |
| Better Stack free | yes (10 monitors & heartbeats; frequency on the no-cost tier not stated on the page) | yes / yes | $0 | third party | no-cost tier lists "Slack & e-mail alerts"; "free for personal projects"; **no Telegram** | evaluated, not signed up |
| Healthchecks.io free | a dead-man switch, not a prober (20 jobs); would need a ping FROM the host or Mac | - | $0 | third party sees only ping times | integrations on the no-cost tier not confirmed | would close "AICC Ops itself is dead"; **not done** |
| The existing API Droplet | yes | **no** (same provider/region) | free | - | - | **not done and not to be done** without a separate owner approval |

Owner kit (2026-10-23, proven locally with a stand-in target and a fake Telegram): `docs/launch/ops-owner-kit/` (`03-sentinel-decision-package.md` compares Mac-only, public-repo Actions and the alternatives and recommends the public repo; the workflow now also fails the run while DOWN so GitHub's own email is a second, Telegram-independent path, has a manual `send_test` input, and the staged repo ships a short public README instead of the owner guide).

Recommendation: create the dedicated public repository and enable the Actions sentinel at the cutover (`production-promotion.md` step 10.2), keep the Mac sentinel as an extra, and keep the DigitalOcean email policies as the independent notification path. Until the Actions sentinel exists, **a whole-host, DNS or TLS outage while the Mac is asleep is detected by nothing external**; AICC Ops and the DO policies die or stay silent with the host. All three observers speak Telegram: a revoked token or a muted chat blinds them together (section 5). Targets: `targets.dark.toml` (api only) while dark, `targets.production.toml` (Mac) and `github/targets.github.toml` (Actions) after the cutover.

## 5. Honest limits of this alerting design (from the independent review)

* **One shared channel.** Layers A and C both send through the same Telegram bot and chat. A Telegram outage, a revoked token or a muted chat blinds both at once; neither raises an alarm for its own failed deliveries (they count them in their stats and logs only). DigitalOcean's email policies (layer B) are the only independent path.
* **The Mac is shared by four controls**: the sentinel (i), the off-host pull, the release artifacts (`~/aicc-releases`) and the operator key. LaunchAgents run in the logged-in user's session: after a **logout** or a reboot that stops at the FileVault pre-login screen they do not run at all, and nothing says so. Both are silent gaps until the Mac is used again.
* **The daily digest is OFF** (owner default), so "no digest" cannot serve as a dead-man signal for AICC Ops itself.
* **No dedicated OOM-kill rule**: an OOM kill shows up as `process_restart` / `unit_failed` and as swap/RAM pressure.
* `ram_available_low` and `ram_high` can fire for the same condition (two messages).
* **The off-host acknowledgement proves the Mac's key could read the host's hashes, not that the Mac holds the bytes** (a buggy or compromised client could ack without a copy). A server-nonce challenge would close it; not implemented.
