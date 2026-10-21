# Alerting: three layers, what each sees, and what the owner must still do

Status (2026-10-21, Phase 2B): the **code and procedures are in place**; **live delivery is gated on two owner actions** (Telegram credentials; DigitalOcean console policies) and **independent 24/7 detection is gated on one owner decision** (where the external sentinel runs). Nothing below claims a delivered alert that was not observed; the acceptance report lists what was actually fired.

| Layer | What it is | Sees | Cannot see | Delivery | State |
|---|---|---|---|---|---|
| A. AICC Ops (on the Droplet) | `infra/aicc-ops`: 30 s collectors, alert engine, capacity engine, loopback UI `127.0.0.1:9190` | services, RAM/swap/CPU/disk, PHP-FPM, MySQL, 5xx, backups (incl. off-host copy), TLS expiry, restarts | its own host being dead, DNS/firewall/TLS problems on the public path | Telegram (outbound) | engine + adapter tested; **dry-run until credentials exist** |
| B. DigitalOcean Monitoring | free Droplet metric alert policies | CPU, memory, disk, load, bandwidth from the hypervisor agent | processes, the application, the public path | **email / Slack only** (no Telegram) | **owner creates the policies in the console** (section 3) |
| C. External sentinel | `infra/sentinel`: outbound HTTPS checks of the public name | DNS, TCP, TLS validity/expiry, `/healthz`, host identity, an app page, latency | resource pressure, internals | Telegram (+ macOS notification) | Mac LaunchAgent (intermittent) installable; 24/7 variant needs an owner decision (section 4) |

A single transient error never pages: AICC Ops needs a sustained window (rule-specific, typically 2-10 samples of 30 s), the sentinel needs 3 failures in its last 5 checks.

## 1. AICC Ops to Telegram

Messages (plain text, no parse mode): `[WARNING]`, `[CRITICAL]`, `[RECOVERED]`, `[TEST]`, flapping notices. Each carries the host label **`aicc-cp-stage (staging)`**, the rule title, the current value against the threshold, a UTC time, and (RECOVERED) the duration. A RECOVERED message exists only for a condition that had a sent FIRING notice. Dedupe/cooldown per rule (15 min to 12 h), flap suppression (more than 4 transitions in 30 min), at most 30 messages per hour in total. The text never contains an IP, email, URL, cookie, order number or token (scrubbed and tested). The **daily digest is OFF** (`telegram.digest_enabled = false`).

Rules shipped (thresholds are provisional; per-rule overrides in `/etc/aicc-ops/aicc-ops.toml` under `[alerts.rules.<id>]`):

| Need | Rule | WARNING / CRITICAL | Sustained |
|---|---|---|---|
| Caddy / site unhealthy | `edge_probe`, `service_down`, `caddy_admin` | probe not 200 / unit not active | 3 / 2 / 4 samples |
| Repeated 5xx | `http_5xx` | 5 % / 25 % of requests (min 20 requests) | 2 samples over a 5 min window |
| High CPU | `cpu_saturation` | 90 % / 98 % | 10 min (WARNING), 40 min (CRITICAL) |
| Low RAM | `ram_available_low` (and `ram_high`) | available < 200 MiB / < 120 MiB; used 90 % / 96 % | 5 min |
| Swap | `swap_activity` | swap-in 100 / 1000 pages/s, swap-out 300 | 10 min |
| Disk | `disk_low`, `inodes_low` | 85 % / 93 % used | 2 samples |
| PHP-FPM `max_children` | `fpm_max_children` (from the log, no socket access), `fpm_saturation`, `fpm_down` (need the pool status page: collector off by owner decision) | ≥ 5 / ≥ 40 `reached pm.max_children` events per 15 min | 2 samples |
| MySQL | `db_down`, `db_conn_pressure` | unreachable on its socket; 80 % / 95 % of connections | 2 samples |
| Backup | `backup_failed`, `backup_stale`, **`offhost_stale`** | last run failed; newest good backup older than **3 h / 12 h** (matches the hourly timer); no verified off-host copy for 36 h / 96 h, or an acknowledged set that lags the newest backup by that much (**a laptop that sleeps Friday to Monday exceeds 36 h: raise `warn_h`/`crit_h` of `offhost_stale` in the host config if that is the normal pattern**) | 1-2 samples |
| TLS expiry | `cert_expiry` | 14 days / 5 days | 1 sample |
| Unexpected restart/crash | `process_restart`, `unit_failed` | 3 / 6 restarts per hour; an `OnFailure=` hook fired | 1 sample |

### Telegram credentials: the only supported procedure (no secret ever goes through chat)

The owner creates the bot and puts the secret **directly on the host**, typed into a hidden prompt:

1. In Telegram, talk to **@BotFather** → `/newbot` → note the bot's @username (the token is shown once; do not paste it anywhere except step 4).
2. Open your new bot and send it any message (`hello`) so a chat exists.
3. `ssh aicc@stage.copilt.org` (or the reserved IP).
4. `sudo aicc-ops-secrets set-telegram` → paste the token at the hidden prompt (nothing is echoed). Leave the chat id blank the first time if you do not know it; the helper then runs the discovery and tells you the id to enter on a second run (`sudo aicc-ops-secrets set-telegram --keep-token`).
5. `sudo systemctl restart aicc-ops`
6. Verify without sending anything sensitive: `sudo /opt/aicc-ops/bin/aicc-ops --config /etc/aicc-ops/aicc-ops.toml telegram-status` (presence, owner, mode) and `... telegram-check` (bot @username). Then one explicit test message: `... telegram-send-test --send`.

Properties: the file is `/etc/aicc-ops/secrets.env`, mode `0640 root:aicc-ops`, written atomically; the token is never on a command line or in an environment variable, never logged, never in the repository; the CLI refuses a group-writable or world-readable file. **Replacing** a token: revoke it in @BotFather (`/revoke`), then run step 4 again. **Removing**: `sudo aicc-ops-secrets remove-telegram`. Anyone who can read `/etc/aicc-ops/secrets.env` (root, the `aicc-ops` service user) can use the bot: it can only send messages to that chat.

## 2. Failure modes: who sees what (summary; the full matrix is `infra/sentinel/DESIGN.md` section 2)

* Process crash, resource pressure, backup trouble, a certificate about to expire: AICC Ops (A).
* The whole Droplet down, kernel panic, network outage, firewall mistake, DNS or TLS wrong on the public path: **only C** sees it (A and its Telegram path die with the host). B may notice missing metrics but its behaviour on missing data is not relied on.
* The application broken while Caddy answers: C with a PHP-rendered target (`stage-app`), A through 5xx/FPM/MySQL rules.
* AICC Ops itself dead: not detected by A. Mitigations: `Restart=on-failure`, `MemoryMax`, DO memory policy; a true dead-man ping needs a third-party service (owner decision, not taken).

## 3. DigitalOcean alert policies (free; owner creates them, ~5 minutes)

No token was requested and none is used. In the DigitalOcean console: **Monitoring → Alert Policies → Create alert policy**, scope **only** the Droplet `aicc-cp-stage` (never the API Droplet), notification **email to the address you read** (and Slack only if you already use it). Values come from the measured capacity of this host (RAM peak 650 MB used of 1967, minimum available 1059 MB, swap 0; the CPU is the first resource to saturate):

| Metric | Condition | Duration | Severity | Rationale |
|---|---|---|---|---|
| CPU | > 85 % | 15 min | warning | matches the capacity engine's `upgrade_cpu_p95` (85 %); a 15-minute plateau is real demand, not a cache purge; short load-test peaks are outside any real window |
| Memory | > 85 % | 10 min | warning | measured peak under 8 concurrent workers was 33 %; 85 % means a leak or a runaway process, and OOM-killing is near |
| Disk usage | > 75 % | 5 min | warning | 48 GB volume at 12 %; 75 % leaves weeks of room to act before AICC Ops' 85/93 % |
| Load average (5 min) | > 3 | 15 min | warning | the capacity engine's `upgrade_load_per_vcpu = 3.0` on 1 vCPU |

Optional (not recommended now): bandwidth policies; DigitalOcean's Uptime product (its price and alert channels were not verified; do not add a paid product).
Do not modify the existing API Droplet's monitoring. The owner confirms in the console that each policy shows "Droplet: aicc-cp-stage" and a working email; **I cannot create them (no token), so they are NOT counted as live in the acceptance report until you confirm**.

## 4. External sentinel: the smallest owner decision

The sentinel code and tests exist (`infra/sentinel`; targets `targets.stage.toml`: edge `/healthz` with expected address, host identity, PHP page, API health). Where it runs decides whether the "whole host down" case is covered:

| Option | Failure domain | 24/7 | Cost | Owner action |
|---|---|---|---|---|
| (i) **Mac LaunchAgent** (installed by `infra/sentinel/macos/install-launchd.sh --apply`) | independent of DigitalOcean; shares the Mac | **No**: blind while the Mac sleeps/offline; an outage that starts and ends while it sleeps is never seen | free | accept this limit |
| (ii) **GitHub Actions schedule** (`examples/github-actions-sentinel.yml.example`) | independent of DigitalOcean and the Mac | roughly: GitHub delays/skips schedules; detection in tens of minutes | free **only if the repository is public** | confirm the repo is public; merge the workflow to the default branch (an owner gate: nothing is pushed or merged here); add the two Actions secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the repository settings; GitHub disables schedules after 60 days without repository activity |
| (iii) the existing API Droplet | another Droplet in the same provider and region | yes | free | **not done**: it needs a separate owner approval to put anything on that host |

Recommendation: install (i) now as the free extra observer and take (ii) if the repository is public, because that is the only free option that survives your Mac sleeping. Until (ii) or (iii) exists, **the "whole host/network/DNS down while the Mac is asleep" scenario is not covered**: the acceptance report states B-1 as partially closed for exactly that reason.

## 5. Honest limits of this alerting design (from the independent review)

* **One shared channel.** Layers A and C both send through the same Telegram bot and chat. A Telegram outage, a revoked token or a muted chat blinds both at once; neither raises an alarm for its own failed deliveries (they count them in their stats and logs only). DigitalOcean's email policies (layer B) are the only independent path.
* **The Mac is shared by four controls**: the sentinel (i), the off-host pull, the release artifacts (`~/aicc-releases`) and the operator key. LaunchAgents run in the logged-in user's session: after a **logout** or a reboot that stops at the FileVault pre-login screen they do not run at all, and nothing says so. Both are silent gaps until the Mac is used again.
* **The daily digest is OFF** (owner default), so "no digest" cannot serve as a dead-man signal for AICC Ops itself.
* **No dedicated OOM-kill rule**: an OOM kill shows up as `process_restart` / `unit_failed` and as swap/RAM pressure.
* `ram_available_low` and `ram_high` can fire for the same condition (two messages).
* **The off-host acknowledgement proves the Mac's key could read the host's hashes, not that the Mac holds the bytes** (a buggy or compromised client could ack without a copy). A server-nonce challenge would close it; not implemented.
