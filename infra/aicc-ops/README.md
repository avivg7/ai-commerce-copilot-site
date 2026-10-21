# AICC Ops

A tiny, first-party, **operator-only** observability service for the AICC staging/production Linux host, plus (in `../sentinel/`) the design and a reference implementation of an external availability sentinel.

* Python 3.12 **standard library only** (sqlite3, http.server, urllib, subprocess, ssl, tomllib). No pip, no npm, nothing downloaded on the host.
* One process, one SQLite file, one loopback web UI. No Prometheus, Grafana or Netdata.
* Targets (measured on a Mac with fixtures; see "Measured overhead"): <= 40 MB RSS, < 1% CPU, <= 150 MB disk.
* **Status: built and tested locally against fixtures. Nothing is deployed. The real host does not exist yet.** Section "What is not verified" lists everything that can only be proven on the host.

Labels: **VERIFIED** = exercised by tests/runs in this repo; **INFERRED** = follows from design/docs but not run against the real thing; **UNVERIFIED** = needs the real host or a provider's current terms.

## Architecture

```
 +--------------------------- aicc-ops (one process, user aicc-ops, MemoryMax 64M, CPUQuota 15%) ---------------------------+
 | collectors (every 30 s, each in its own thread with a timeout + try/except; failure => collector.<name>.ok = 0 metric)   |
 |   host  caddy  phpfpm  mysql  cp  backups  cert  edge  [backend_metrics*] [postgres*]       (* optional, off by default) |
 |        |                                                                                                                  |
 |        v   raw 30 s samples --> 5-min rollups --> 1-h rollups   (SQLite WAL, size cap, free-space guard)                  |
 |        |-----> alert engine (sustain / hysteresis / cooldown / dedupe / flap / persisted state) --> Telegram (outbound)    |
 |        |-----> capacity engine (pure functions, informational only)                                                       |
 |        '-----> UI + export on 127.0.0.1:9190 (GET only, no JS, strict CSP)  <--- ssh -L 9190:127.0.0.1:9190 <host>        |
 +---------------------------------------------------------------------------------------------------------------------------+
```

Package layout: `aicc_ops/` (config, util, store, capacity, alerts, telegram, ui, charts, export, fcgi, app, cli, `collectors/`), `bin/aicc-ops`, `config/aicc-ops.example.toml`, `systemd/` (service, digest service+timer, logrotate, PHP-FPM snippet), `sql/monitoring-user.sql`, `install.sh`, `measure-overhead.sh`, `tests/`, `tools/` (local-only fixtures and evidence generators; not installed).

## Metrics catalog

Frequencies are the defaults (`interval_s` per collector). "Retention" is the same for every metric: raw 30 s samples 48 h, 5-minute rollups 35 d, 1-hour rollups 400 d (avg/min/max/p95 per bucket; the 1-h tier is built from raw while raw still exists), subject to the size cap. Rates are computed from counter deltas (counter resets are detected and handled). Only low-cardinality, label-free series are stored (no per-URL, per-host, per-merchant, per-user series).

| Metric(s) | Source | Frequency | Retention |
|---|---|---|---|
| `cpu.vcpus`, `cpu.used_pct`, `cpu.iowait_pct`, `cpu.steal_pct` | `/proc/cpuinfo`, `/proc/stat` deltas, cgroup `cpu.max` | 30 s | 48 h / 35 d / 400 d |
| `load.1/5/15`, `load.per_vcpu` | `/proc/loadavg` | 30 s | same |
| `mem.total_bytes`, `mem.available_bytes`, `mem.used_bytes`, `mem.used_pct` (from MemAvailable, cgroup limit if lower) | `/proc/meminfo` | 30 s | same |
| `swap.total_bytes`, `swap.used_bytes`, `swap.used_pct`, `swap.in_pps`, `swap.out_pps` (pages/s) | `/proc/meminfo`, `/proc/vmstat` pswpin/pswpout | 30 s | same |
| `disk.<mount>.total_bytes/used_bytes/used_pct/inodes_used_pct` | `statvfs` per configured mount (`root` = `/`) | 30 s | same |
| `io.read_bps`, `io.write_bps`, `io.util_pct` | `/proc/diskstats` (whole disks only) | 30 s | same |
| `net.rx_bps`, `net.tx_bps` (public interface auto-detected via default route) | `/proc/net/dev`, `/proc/net/route` | 30 s | same |
| `uptime.seconds` | `/proc/uptime` | 30 s | same |
| `host.reboot_required` (0/1), `host.reboot_required_age_s` | existence and mtime of `/var/run/reboot-required` (config `collectors.host.reboot_required_file`; never read, `needrestart` is NOT run) | 30 s | same |
| `svc.<unit>.active/failed/present/restarts/uptime_s` | `systemctl show -p NRestarts,ActiveState,SubState,ActiveEnterTimestamp,LoadState <unit>` | 30 s | same |
| `caddy.up`, `caddy.in_flight`, `caddy.rate_{2xx,3xx,4xx,5xx,other}`, `caddy.req_rate`, `caddy.resp_bytes_ps`, `caddy.req_bytes_ps`, `caddy.lat_p50/p95/p99_ms`, `caddy.dyn_lat_*_ms` (handlers in `dynamic_handlers`), `caddy.upstream_healthy_min`, `caddy.upstream_count` | Caddy admin `http://127.0.0.1:12019/metrics` (Prometheus text; `AICC_ADMIN_ADDR` default of `docs/cutover/Caddyfile.edge.template`), status classes summed over `code`, quantiles from histogram bucket deltas | 30 s | same |
| `edge.up`, `edge.status`, `edge.latency_ms` | loopback HTTPS GET `/healthz` with SNI = hostname | 30 s | same |
| `fpm.up`, `fpm.active/idle/total`, `fpm.listen_queue`, `fpm.max_listen_queue`, `fpm.max_active`, `fpm.active_ratio`, `fpm.max_children_reached(+_delta)`, `fpm.slow_requests(+_delta)` | PHP-FPM status over the pool unix socket (own FastCGI client) | 30 s | same |
| `mysql.up`, `mysql.threads_connected/running`, `mysql.max_used_connections`, `mysql.max_connections`, `mysql.conn_pressure_pct`, `mysql.slow_queries_delta`, `mysql.aborted_connects_delta`, `mysql.qps`, `mysql.uptime_s`, `mysql.db_size_bytes` | `mysql` CLI, socket auth, `SHOW GLOBAL STATUS`/`SHOW VARIABLES`/information_schema | 30 s | same |
| `cp.<metric>_per_min` for registrations, login_success, login_failure, checkout_start (approximate), order_completed, refund, license_issued, license_lifecycle_failure, store_connection, password_reset_failure; `cp.<metric>.r.<reason>_per_min` (fixed enums only); `cp.order_per_checkout_ratio`; `cp.table_present`; `cp.action_scheduler_pending/failed`; `cp.wc_cron_last_run_age_seconds` | read-only SELECT of `{prefix}aicc_ops_counters`, `{prefix}actionscheduler_actions`, optional `{prefix}options` heartbeat | 60 s (opt-in) | same |
| `backup.status_ok`, `backup.newest_age_s` (age of the last SUCCESSFUL backup), `backup.last_run_age_s`, `backup.newest_size_bytes`, `backup.restore_check_ok`, `backup.disk_free_pct`, `backup.status_present`, `backup.dir_present` (+ `backup.count` when the directory is listable) | `/srv/aicc/backups/status.json` (schema 1 from `infra/backup/aicc-backup.sh`; the directory is 0751 so it is opened by name, never listed) | 5 min | same |
| `backup.offhost_present` (0/1), `backup.offhost_verified` (0/1: schema 1, `verified: true`, well-formed), `backup.offhost_age_s` (now - `acked_at`), `backup.offhost_reason` (0 ok, 1 not JSON, 2 unknown schema, 3 not verified, 4 bad/missing fields, 5 unreadable) | `collectors.backups.offhost_ack_file` (default `/srv/aicc/backups/offhost-ack.json`, `""` disables) | 5 min | same |
| `unitfail.<unit>.failed/age_s`, `unitfail.failed_count` | `/var/lib/aicc/status/unit-<name>.json` written by `infra/systemd/aicc-unit-status.sh` (OnFailure= hook) | 60 s | same |
| `cert.days_left`, `cert.ok` | served certificate on loopback (SNI) or PEM file; own DER parser | 1 h | same |
| `backend.*` (optional, API host only) | backend loopback `/metrics` with bearer token | 30 s (disabled) | same |
| `pg.*` (optional, API host only) | `psql` | 60 s (disabled) | same |
| `collector.<name>.ok`, `collector.<name>.duration_ms` | the collector framework | every run | same |
| `ops.rss_bytes`, `ops.db_bytes`, `ops.cycle_ms`, `ops.fs_free_pct`, `ops.write_blocked` | AICC Ops itself | 30 s | same |

**Control Plane contract** (VERIFIED against fixtures): table `{prefix}aicc_ops_counters(metric, bucket_minute, reason, value)`; the collector reads only complete minutes since its previous read and emits per-minute **rates** (rollup `avg x minutes` recovers totals). Unknown metric names and reasons outside the contract enums (`license_lifecycle_failure`: validate|activate|deactivate|expire|revoke|delivery|issue|other; `order_completed`: processing|completed; `registrations`: checkout|account|admin; `store_connection`: approve|purchase) are dropped, never turned into series. `checkout_start` is **approximate** (a page view in a session with a cart) so the UI only shows it as a ratio against `order_completed`, never as an exact funnel. A missing table (it is created lazily) is tolerated (`cp.table_present = 0`). The cron heartbeat is the option `aicc_ops_cron_last_run`; reading it needs SELECT on the options table (which also holds site secrets), so it is an **owner decision** and by default the collector falls back to the newest completed Action Scheduler action.

## Storage and retention math

* One SQLite file (WAL, `synchronous=NORMAL`, incremental auto-vacuum). Tables: `raw`, `r5`, `r1h`, `alert_state`, `alert_events`, `events`, `config_snapshot`, `metrics`, `meta`.
* Prune order when the **150 MiB hard cap** (db + wal) is exceeded: oldest 10% of `r1h`, then `r5`, then `raw`, repeated with checkpoint + incremental vacuum until under the cap (VERIFIED by test).
* **Free-space guard:** below 10% free on the data filesystem no sample is written; instead `ops.write_blocked = 1` and a CRITICAL `monitoring_write_blocked` alert go out (Telegram needs no disk) (VERIFIED).
* Measured on fixtures with **145 series** (`tools/measure_db_growth.py --days 14`, SQLite dbstat; evidence file `db-growth-projection.json`):

| Tier | Rows after 14 d | Bytes | Growth/day | Steady-state projection |
|---|---|---|---|---|
| raw (48 h window) | 835,200 | 15.8 MB | bounded | 15.8 MB |
| 5-min (35 d) | 584,640 | 23.2 MB | 1.65 MB/day | 57.9 MB |
| 1-h (400 d) | 48,720 | 2.0 MB | 0.14 MB/day | 57.3 MB |
| **Total** | | | ~1.8 MB/day while filling | **~125 MiB**, under the 150 MiB cap |

  The margin is about 25 MiB at 145 series; adding many more series (e.g. dozens of systemd units or mounts) pushes the 1-h tier past the cap and the oldest 1-h rows are then pruned automatically. The real series count and byte sizes must be re-measured on the host (fixture values are not production values).

## Alert catalog (provisional defaults, all configurable under `[alerts.rules.<id>]`)

Sustain = consecutive 30 s evaluations before FIRING; clear = consecutive evaluations below the hysteresis threshold before RECOVERED; cooldown = min seconds between FIRING notices for one key. Critical severity needs its own sustain (`crit_samples`). CRITICAL reminders repeat every 6 h (warnings never repeat).

| Rule id | Fires when | Severity | Sustain / clear | Cooldown |
|---|---|---|---|---|
| `service_down` (per unit) | systemd unit not active / failed / not installed | CRITICAL | 2 / 2 | 15 min |
| `edge_probe` | loopback HTTPS probe of `/healthz` fails | CRITICAL | 3 / 2 | 15 min |
| `caddy_admin` | Caddy admin metrics unreachable | WARNING | 4 / 4 | 1 h |
| `http_5xx` | >= 5% (WARN) / >= 25% (CRIT) of >= 20 requests in the last 5 min are 5xx; clears < 2% | WARN/CRIT | 2 / 4 | 30 min |
| `ram_high` | memory used >= 90% (WARN) / >= 96% (CRIT); clears < 85% | WARN/CRIT | 10 min / 5 min (crit 5 min) | 30 min |
| `ram_available_low` | **available** memory (`MemAvailable`, MiB) < 200 (WARN) / < 120 (CRIT); clears > 300. `ram_high` is on used%; this one is the figure that matters on a 2 GiB host (measured minimum available under load was about 1059 MiB, so this fires only on a real squeeze) | WARN/CRIT | 5 min / 5 min (crit 5 min) | 30 min |
| `swap_activity` | swap-in >= 100 pages/s or swap-out >= 300 pages/s (WARN); swap-in >= 1000 (CRIT) | WARN/CRIT | 10 min / 5 min | 30 min |
| `cpu_saturation` | CPU >= 90% (WARN) / >= 98% (CRIT, 20 min); clears < 80% | WARN/CRIT | 10 min / 5 min | 30 min |
| `disk_low` (per mount) | used >= 85% / >= 93%; clears < 80% | WARN/CRIT | 1 min / 2 min | 1 h |
| `inodes_low` | inodes >= 85% / >= 95% | WARN/CRIT | 1 min / 2 min | 1 h |
| `fpm_down` | FPM status page not answering | CRITICAL | 1 min / 1 min | 15 min |
| `fpm_saturation` | max_children reached (last 10 min), listen queue >= 1, or active/total >= 0.9; queue >= 10 is CRITICAL | WARN/CRIT | 2 min / 5 min | 1 h |
| `db_down` | MySQL unreachable | CRITICAL | 1 min / 1 min | 15 min |
| `db_conn_pressure` | threads_connected/max_connections >= 80% / >= 95% | WARN/CRIT | 10 min / 5 min | 30 min |
| `backup_stale` | last successful backup older than 3 h (WARN) / 12 h (CRIT) (defaults match the HOURLY backup timer), directory missing, or no `status.json` yet | WARN/CRIT | immediate | 6 h |
| `backup_failed` | `status.json` says failed, or the restore smoke check failed | CRITICAL | immediate | 6 h |
| `offhost_stale` | **off-host backup copy is stale**: the owner's Mac has not confirmed a verified copy (`offhost-ack.json`, see below) in > 36 h (WARN) / > 96 h (CRIT) (the larger of the acknowledgement's age and how far the acknowledged SET lags the newest backup); clears < 30 h. Missing file: WARN only once the host has been up > 48 h AND a successful backup exists (a new host has no ack yet). `verified=false`, unknown schema, malformed JSON or missing fields: WARN with the reason. Text: "the owner's Mac has not confirmed a verified copy of the newest backup in N h ... Run infra/backup/pull-offhost.sh." | WARN/CRIT | 1 min / 1 min | 6 h |
| `unit_failed` (per unit) | an `aicc-unit-status` failure file exists for a unit (backup, edge, wp-cron, cert-expiry ...) | CRITICAL | immediate / 2 | 1 h |
| `cert_expiry` / `cert_unreadable` | certificate <= 14 days (WARN) / <= 5 days (CRIT); cert cannot be read | WARN/CRIT | immediate | 12 h |
| `process_restart` (per unit) | >= 3 (WARN) / >= 6 (CRIT) NRestarts increments in the last hour | WARN/CRIT | immediate | 1 h |
| `collector_failure` (per collector) | a collector reports ok = 0 | WARNING | 2 min / 1 min | 1 h |
| `monitoring_disk_cap` | AICC Ops DB >= 85% / >= 95% of its cap | WARN/CRIT | 1 min / 2 min | 6 h |
| `monitoring_write_blocked` | free space below the guard: writes refused | CRITICAL | immediate | 30 min |
| `wc_cron_stale` | last cron heartbeat older than 1 h / 4 h (the system cron runs every 2 minutes, `aicc-wp-cron.timer` `OnCalendar=*:0/2`; the thresholds are 30x that, `tests/test_alerts.py::CronCadence` pins both) | WARN/CRIT | 1 min | 1 h |
| `reboot_required` | `/var/run/reboot-required` exists (unattended-upgrades installed a kernel/library update that stays inactive until a reboot; the host never reboots by itself). WARNING only, never escalates, **never auto-clears: it clears only when the file disappears** (i.e. after a reboot). Text carries no package names | WARN | 1 sample | 24 h |
| `backend_down`, `backend_postgres_down`, `backend_health_degraded`, `backend_pool_pressure`, `backend_5xx` | only when the optional backend collector is enabled | mixed | see `alerts.py` | 1 h |

State machine (VERIFIED by `tests/test_alerts.py`): fire after N consecutive breaches; **dedupe** per rule+scope; hold between breach and clear thresholds (hysteresis); RECOVERED only if a FIRING notice was actually sent; ESCALATED when the critical sustain is met; **flap suppression** (>= 4 state changes in 30 min => one FLAPPING notice, then silence until quiet for a window); persistent across restart; a bad rule or a failing disk never stops alerting. **These thresholds are provisional until staging measurements tune them.**

## Capacity engine (informational only)

`aicc_ops/capacity.py` evaluates 24 h and 7 d windows of 5-minute points and returns HEALTHY / WATCH / UPGRADE RECOMMENDED with reasons. It never calls an API and never resizes anything (a test greps the module for network imports). "p95" means the 95th percentile of 5-minute **averages**, so a spike alone cannot trigger a recommendation; "peak" is the highest 5-minute maximum. **Proposed defaults, to be validated on staging, not production-proven:**

* UPGRADE RECOMMENDED if, over the 24 h or 7 d window, any of: RAM p95 >= 85%; available RAM < 150 MiB in >= 2 separate episodes; swap-in > 50 pages/s for >= 10 min on >= 3 days; CPU p95 >= 85%; PHP `max_children` reached on >= 3 separate days; p95 latency > 2 s for >= 30 min (6 consecutive points, only counting points with real traffic; dynamic-route histogram when available); DB connection pressure p95 >= 90%; load per vCPU p95 >= 3.
* WATCH if RAM p95 >= 75%, CPU p95 >= 70%, any swap-in activity, p95 latency > 1.5 s, PHP active/total p95 >= 0.8, any `max_children` day or listen queue, DB pressure >= 70%, load per vCPU >= 1.5.
* Figures are shown with capacity context, e.g. `1.3 GiB / 2.0 GiB — 65%`.
* **Latency of dynamic routes is not separable with the current edge** (VERIFIED read-only against the live rehearsal Caddy 2.11.7): every HTTP series carries one `handler` value, `subroute`, so requests are counted once (no double counting) but PHP traffic cannot be told apart from static files and redirects. `caddy.dyn_lat_*` therefore does not exist and the capacity engine uses all-route latency, which is diluted by fast redirects/static responses and optimistic for PHP. To get a true dynamic-route latency the edge would need a distinct handler/route label for the PHP route (owner/edge-package decision).

## Telegram (outbound only)

* Every alert message starts with `[LEVEL] <host_label>`; the default label is `aicc-cp-stage (staging)`, i.e. **host and environment** (set `general.host_label`). FIRING/ESCALATED/REMINDER carry `Since <UTC>`, RECOVERED and FLAPPING carry `At <UTC>`, and every threshold alert states the current value next to its thresholds (`available memory 150 MiB (warn < 200 MiB, critical < 120 MiB)`).
* `sendMessage` over HTTPS via `urllib`. Credentials only from `/etc/aicc-ops/secrets.env` (`TELEGRAM_BOT_TOKEN=`, `TELEGRAM_CHAT_ID=`) or a systemd credential `secrets.env`; **never from the repo or TOML**. The file must not be world-accessible or group-writable (0600 root-owned via `LoadCredential`, or 0640 `root:aicc-ops` for direct read); otherwise the adapter stays disabled (fail closed).
* No secrets => disabled, logged once. `--dry-run-telegram` prints exactly what would be sent and never opens a socket (VERIFIED with a test that makes every socket call fail).
* Templates: WARNING, CRITICAL, RECOVERED (+ FLAPPING, REMINDER/ESCALATED variants) and a **daily digest that is OFF by default** (`telegram.digest_enabled`, timer not enabled by `install.sh`). Plain text (no parse mode). Rate limit (30/h by default, then one summary line), retry with exponential backoff, 429 `retry_after` honoured, queue never blocks the collector. No inbound commands, webhooks or polling.
* Tests use a fake HTTP server; the base URL can only be overridden by test code, and only to `http://127.0.0.1:<port>` (constructor argument, or for the manual CLI commands the env pair `AICC_OPS_TEST_HARNESS=1` + `AICC_OPS_TEST_BASE_URL`, which is ignored without the first variable and never read by the daemon).
* The daemon never polls. The only inbound-style call is the **manual, one-shot** `telegram-discover-chat` (Bot API `getUpdates`, `limit=20`, `timeout=2`) that the owner runs once to learn the chat id. It sends no `offset`, so it acknowledges nothing: Telegram keeps the updates (up to 24 h) and nothing is consumed or deleted. It prints only `chat_id`, `type` and, for groups/channels, the public title/@handle; never message text and never the name of a private person.

## Telegram credentials: operator procedure

The bot token is a password for the bot. **Never paste it in chat, a ticket, a shell argument (`--token ...`), an environment variable of a long-lived shell, or the repo.** The helper below reads it with echo off (or from stdin) and writes it straight into `/etc/aicc-ops/secrets.env`; nothing else ever sees it. Use `AO` as shorthand (it holds no secret): `AO='sudo /opt/aicc-ops/bin/aicc-ops --config /etc/aicc-ops/aicc-ops.toml'`. (The secrets file is `root:aicc-ops 0640`, so these commands need `sudo`.)

1. **Create the bot**: in Telegram open `@BotFather`, send `/newbot`, choose a name; BotFather answers with the token. Keep that chat window open; do not copy the token anywhere except step 4.
2. **Send a message to the bot**: open your new bot, press Start, send any word (for a group: add the bot, send a message there). The bot cannot find your chat until you do this.
3. **SSH to the host** (the staging Droplet). If the helper is not there yet, `sudo ./install.sh` from the repo copy installs it as `/usr/local/sbin/aicc-ops-secrets` (root-only, 0750).
4. **Store the token**: `sudo aicc-ops-secrets set-telegram`. Paste the token at the hidden prompt (you will see nothing), press Enter. At the chat-id prompt either type the chat id, or press Enter if you do not know it yet. The script validates both, writes `/etc/aicc-ops/secrets.env` atomically (umask 077, temp file next to it, `chmod 0640`, `chown root:aicc-ops`, `mv`), keeps any other keys already in the file, then runs `telegram-check` as the `aicc-ops` user and prints `ok` or the failure. Non-interactive alternative (password manager): `pm get aicc-bot | sudo aicc-ops-secrets set-telegram --stdin --chat-id 123456789` (one line = token; without `--chat-id` a second line = chat id).
5. **Find the chat id** if you pressed Enter: `$AO telegram-discover-chat` lists each chat with its id and type. Then `sudo aicc-ops-secrets set-telegram --keep-token --chat-id <id>` (keeps the stored token, changes only the chat id).
6. **Check**: `aicc-ops-secrets status` (presence, owner, mode; `$AO telegram-status` adds the token *length* and chat-id presence; exit 0 = usable, 3 = not). `$AO telegram-check` calls `getMe` and prints only the bot's `@username` and `ok`; a failure prints only `HTTP <status>` or the exception type. Neither sends a message.
7. **Prove the path with one message**: `$AO telegram-send-test` shows the message it *would* send (dry run). `$AO telegram-send-test --send` sends exactly one: `[TEST] aicc-cp-stage (staging) - Telegram path check <UTC time>. No action needed.` and prints only `ok`/`FAILED` and the HTTP status.
8. **Restart so the running service picks the credentials up**: `sudo systemctl restart aicc-ops` (the helper prints this command but never runs it). Without credentials the daemon logs "telegram: disabled" once and keeps recording alerts locally.
* **Rotate**: in `@BotFather` send `/revoke` (the old token stops working at once), then run `sudo aicc-ops-secrets set-telegram` again with the new token, `$AO telegram-check`, `sudo systemctl restart aicc-ops`.
* **Remove**: `sudo aicc-ops-secrets remove-telegram` (removes only the two Telegram keys, deletes the file if nothing else is in it), `/revoke` the token in BotFather, `sudo systemctl restart aicc-ops`.
* **Safety rules the code enforces**: a secrets file that is group-writable or world-accessible is refused by the daemon and by every command above (fix with `chmod 0640` / `chown root:aicc-ops`); the commands never print the token, part of it or the request URL; `getMe`/`getUpdates`/`sendMessage` run in-process with `urllib` (the token is in no argv); the helper ignores its test overrides unless `AICC_OPS_TEST_HARNESS=1`.
* **If you did paste a token somewhere**: treat it as burned: `/revoke` it in BotFather and run `set-telegram` with the new one.
* Exit codes: `0` ok, `1` the API call failed, `3` unusable credentials / refused (no secrets, unsafe mode, not root).

## Off-host backup acknowledgement (`offhost-ack.json`)

The server cannot know that a copy of its backups exists somewhere else. The owner's Mac, after `infra/backup/pull-offhost.sh` has pulled **and verified** a backup set (sha256 of the received bytes == the server's sidecar == the hash in `status.json`, `gzip -t` ok), sends the restricted SSH command `ack ...`; the root-owned `aicc-offhost-serve` on the host re-checks both hashes against the host's own sidecars and then writes this file next to `status.json` (it stamps `acked_at` with the HOST's clock):

```json
{"schema": 1, "acked_at": 1792600000, "set_ts": "20261021T033000Z", "dump": "<dump file name>", "dump_sha256": "<64 hex>",
 "files": "<files archive name>", "files_sha256": "<64 hex>", "puller": "mac-pull", "verified": true}
```

`acked_at` is Unix seconds on the host's clock (a value more than 1 h in the future is still treated as invalid). `files`/`files_sha256` may be omitted for database-only pulls. Anything else (unknown `schema`, `verified` not literally `true`, missing/non-hex `dump_sha256`, malformed JSON) makes the ack **invalid**: `backup.offhost_verified = 0` and the rule raises a WARNING with the reason. The file must be readable by the `aicc-ops` user (the backup directory is 0751, so it is opened by name, like `status.json`). The path is `collectors.backups.offhost_ack_file`. A malformed file is not a collector failure (no double alert); an unreadable one is (`collector_failure` names `PermissionError`).

Tuning: `[alerts.rules.offhost_stale]` accepts `warn_h` (36), `crit_h` (96), `clear_h` (30), `absent_after_uptime_h` (48) plus the usual `enabled`, `for_samples`, `clear_samples`, `cooldown_s`. **Writer:** this package only reads the file; the writer is `infra/backup/aicc-offhost-serve.sh` (`ack`), invoked by `pull-offhost.sh` after each verified pull. Until the first ack exists the rule (correctly) warns after 48 h of uptime that no off-host copy has ever been confirmed. What the rule proves is only that a verified-copy confirmation is recent; it does not compare `set_ts` with the newest backup on the host.

## Privacy statement

AICC Ops stores and sends **numbers about the machine and aggregate counts**. It never collects: customer or merchant identifiers, emails, IP addresses of visitors, URLs/paths/query strings, request or response bodies, cookies, headers, order numbers, license keys or tokens. Caddy labels are used only to aggregate (status class, dynamic/all) and are then discarded. Control Plane counters carry a fixed enum `reason`, anything else is dropped. Telegram messages contain only rule titles, metric values, the host label and fixed words; every message additionally passes a PII/secret scrubber, and unit tests scan every template and every rendered alert for emails, IPs, tokens, long secrets, cookies and order numbers. The UI and exports contain no secrets and the config page redacts secret-looking keys. Logs go to journald and contain no request data (the HTTP server logs nothing per request).

## Security self-review

**Attack surface.** One TCP listener on `127.0.0.1:9190`; the process refuses any other bind address (IPv4/IPv6 loopback only, `localhost` accepted) unless `--unsafe-bind` is passed, which the unit never does (tested, including a CLI exit code 2 before anything is created). There is no inbound command channel, no webhook, no SSH key handling. Outbound: loopback probes, `api.telegram.org`, nothing else.

**No authentication, by design.** Access control is "who can reach loopback": the owner's SSH tunnel. The Host header must be a loopback name (DNS-rebinding defence), and responses carry `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and a CSP of `default-src 'none'; style-src 'self'; script-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'`. No cookies, no JavaScript, no external requests (all VERIFIED by tests, and by browser proof for pages and CSP).

**If someone exposes it by mistake** (e.g. a Caddy `reverse_proxy` to 9190 or `--unsafe-bind`): the pages contain operational numbers and the redacted config, no secrets and no customer data; every endpoint is GET only (other methods return 405), nothing writes, nothing executes commands or reads arbitrary files (routes are an exact allow-list, `/assets/ops.css` is an in-memory string). A proxied request would carry a public Host header and be rejected with 403. The leaked information (host sizing, service names, traffic volume) is reconnaissance value, which is why exposure through Caddy is forbidden: **never add a Caddy route to 9190 or to the Caddy admin `/metrics`.**

**PHP-FPM socket (owner decision).** Anything that can connect to the pool socket can ask FPM to execute a `.php` file as the pool user (`aicc-cp`). AICC Ops only sends the fixed status path, but a compromised `aicc-ops` account would inherit that reach. Options: ACL for `aicc-ops` on the socket (preferred), group `aicc-edge` (what `install-stack.sh --ops-fpm-access` does), or disable `collectors.phpfpm` and rely on the edge probe + 5xx rate. See `systemd/php-fpm-status.conf.snippet`.

**File permissions.** Code under `/opt/aicc-ops` root-owned and not writable by the service user; `/etc/aicc-ops` 0750 `root:aicc-ops`; config 0640; `/var/lib/aicc-ops` 0750 `aicc-ops`; secrets 0600/0640 and never created by the installer. Unit sandbox: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `PrivateDevices`, empty capability set, syscall filter, `MemoryDenyWriteExecute`, `ReadWritePaths=/var/lib/aicc-ops` only (**INFERRED until `systemd-analyze security` is run on the host**).

**Secrets.** Telegram token/chat id and the optional backend metrics token are runtime files only; config shows paths, never values; a test scans the package for token-shaped strings; the token is never logged and never echoed in an error.

**SSRF.** Collectors only accept loopback hosts (`assert_loopback`); the Caddy and backend URLs must be `http://` loopback; the backend collector disables proxies. Targets are operator-owned config, never derived from any response. The sentinel can only GET/HEAD configured HTTPS URLs and refuses redirects off the original origin.

**SQL injection.** The only SQL is built from constants plus validated identifiers (`[A-Za-z0-9_$]` prefix, `[A-Za-z0-9_]{1,64}` schema, integer minute bounds); SQLite access is fully parameterised; unknown metric/reason strings read from MySQL are dropped, not used as identifiers.

**DoS.** Thread cap with 503 when exhausted, per-connection read timeout (10 s), 2 KiB URI limit, <= 12 query fields, exports validated and bounded (<= 20 metrics, <= 1500 points each, <= 30,000 rows, fixed range list), response/metrics bodies capped, the UI reads through short-lived read-only SQLite connections, capacity results are cached for 60 s, collectors time out and cannot stack threads.

**Log hygiene.** No per-request logging; errors name the failing component, never a URL with a token, never a response body.

## Local development, tests and evidence tools

```bash
python3.12 -m unittest discover -s tests -t .      # from infra/aicc-ops (npm run ops:test from the site root)
python3.12 tools/fake_host.py --dir ./fakehost     # synthetic host: /proc files, Caddy text, FPM socket, TLS /healthz, systemctl+mysql shims
python3.12 tools/seed_history.py --db fakehost/data/aicc-ops.sqlite3 --days 30
AICC_E2E_UI_PORT=19190 python3.12 bin/aicc-ops --config fakehost/e2e.toml run --dry-run-telegram
python3.12 tools/measure_db_growth.py --days 14    # bytes/day and projection from fixtures
python3.12 tools/alert_transcript.py               # scripted incident through the real engine + dry-run Telegram
node tools/shots.mjs http://127.0.0.1:19190 out/   # Playwright proof (uses ../../scripts/lib/browser.mjs)
```

## Measured overhead

Measured on **this Mac** (Apple silicon, macOS, Python 3.12.3, `measure-overhead.sh -m 10 -i 10`, 60 samples over 595 s), real collectors against the fixture host (`tools/fake_host.py`: fixture /proc files, fixture Caddy/FPM/MySQL/backup/unit-status data, real loopback TLS probe), 9 collectors every 30 s (CP and unitstatus included), alert engine, dry-run Telegram, UI idle, DB seeded with 30 days of synthetic history (145 series, ~67-72 MB). Evidence: `overhead-macos-10min.json` (plus two earlier runs).

| Measure | Target | Measured on macOS | Notes |
|---|---|---|---|
| RSS | <= 40 MB | **avg 19 MiB, peak 36 MiB** (steady working set 30-32 MiB; the low values are macOS compressing idle pages) | Run 1 peaked at 41 MiB before warm-up effects settled, runs 2-3 at 35-36 MiB. Python + stdlib imports alone are ~27 MiB. **Linux RSS is typically higher than macOS "compressed" RSS and must be re-measured on the host; expect roughly the steady-state 30-35 MiB figure.** |
| CPU | < 1% | **0.13%** of one core (0.8 CPU-seconds in 595 s) | macOS `ps` cputime; each 30 s cycle took about 30-150 ms of work. |
| Open files | n/a | 45 | |
| Disk | <= 150 MB | DB 67-72 MB for 30 days of the 145-series fixture; projection to the full retention ~125 MiB (see Storage) | The DB shrank slightly during the run (age-based pruning of the seeded history). |

**Caveats (important):** macOS vs Linux: different RSS accounting (compressed memory), different `ps` CPU sampling, no cgroup limits, no real `/proc`, fixture collectors that answer in microseconds (real `mysql` CLI forks, `systemctl show` per unit and the Caddy scrape will cost more CPU: budget a few tens of milliseconds per unit/mysql call every 30 s, still expected well under 1% but UNVERIFIED). The UI was idle during the run; measured afterwards: a full 30-day history page rendered in ~97 ms and bumped RSS by ~5 MiB (29 to 34.5 MiB); the overview and capacity pages took ~1 ms (capacity results are cached for 60 s).

## Deployment checklist (owner, on the real host; nothing here has been run)

1. Host exists, Ubuntu 24.04, Python 3.12 (`python3 --version`), `mysql` client installed, swap file active.
2. Copy `infra/aicc-ops/` to the host and run `sudo ./install.sh` (idempotent; creates user `aicc-ops`, dirs and modes, installs units; enables nothing).
3. `sudo mysql < /opt/aicc-ops/sql/monitoring-user.sql`; then check the socket login as `aicc-ops` (command in the SQL file).
4. Decide the PHP-FPM socket access for `aicc-ops` (see `systemd/php-fpm-status.conf.snippet` and the security section; the pool already sets `pm.status_path`), then check `max_children` (3 in `infra/php/aicc-pool.conf`) matches the config, and make sure Caddy never routes `/fpm-status`.
5. Keep the Caddy admin API on loopback (`127.0.0.1:12019` in the edge template, global `metrics` option on); confirm `curl -s http://127.0.0.1:12019/metrics | grep caddy_http_request_duration` and expect `handler="subroute"` only (see capacity notes). Add `/healthz` to the edge.
6. Edit `/etc/aicc-ops/aicc-ops.toml`: unit names (`systemctl list-units`), mounts, database name and prefix, backup dir/status-file contract with the backup package, hostname; enable `collectors.cp` after the Control Plane table exists.
7. Optional Telegram: follow "Telegram credentials: operator procedure" above (`sudo aicc-ops-secrets set-telegram`, never paste the token anywhere else). `telegram-test` and `telegram-send-test` (without `--send`) are dry runs.
8. `sudo systemctl enable --now aicc-ops`; verify `ss -ltnp | grep 9190` shows only `127.0.0.1`; `ssh -L 9190:127.0.0.1:9190 host` and open `http://127.0.0.1:9190/`.
9. `systemd-analyze security aicc-ops` and fix anything the sandbox breaks. Run `measure-overhead.sh -m 30` and compare with the targets; re-measure DB growth after 3 days.
10. Run staging for >= 7 days, then tune alert and capacity thresholds from real data before trusting any verdict.

## What is not verified (needs the real host)

systemd unit behaviour and sandbox compatibility; `install.sh` as root with `useradd`/`chown` (only the DESTDIR staging path was run); the real `/proc` of Linux under cgroup limits (parsers are tested against documented formats, not a live sample); Caddy metric names/labels on the real host (the rehearsal Caddy on this Mac was read read-only and matched the parser, see evidence); real PHP-FPM pool status and the ACL socket access; the MySQL account, auth_socket login, privileges and `SHOW` output (no MySQL was available here; the SQL file and CLI flags are UNVERIFIED); the Control Plane tables and heartbeat option on a live WordPress; certificate reading from the real Caddy; the Telegram Bot API (never contacted from this repo; the `getMe`/`getUpdates`/`sendMessage` paths and the credentials helper are tested only against a loopback fake and a temp directory, not as root on the host: `chown`, the `aicc-ops` group and `runuser` are exercised only on the real host); RSS/CPU/disk numbers on Linux 1 vCPU/2 GiB; DB growth with the real series count; the realism of every alert and capacity threshold.

## Optional modules (disabled by default)

* `collectors.backend_metrics`: scrapes the API backend's loopback `/metrics` (bearer token from a root-only file, no proxy, no forwarding headers). Requires the backend to be built and run with `AICC_METRICS_ENABLED` on the API host: **a production change that needs its own owner approval; nothing points at api.copilt.org.** Tested only against a fixture of the documented exposition format and a fake listener that enforces the documented 401/403 rules.
* `collectors.postgres`: a `psql`-based collector for the API host; same approval rule; untested beyond import.
