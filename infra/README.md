# infra/

Deployment-side material for the AICC staging/production Linux host. Everything here is prepared and tested locally; **nothing has been run on a real server** unless a file says otherwise.

| Directory | What it is |
|---|---|
| `provision/` | Droplet creation package (cloud-init, verifier) and stack installation scripts |
| `systemd/` | Units for the edge, backups, wp-cron, cert-expiry timers, and the failure-status hook read by AICC Ops |
| `php/`, `mysql/`, `fail2ban/`, `logrotate/` | Service configuration for PHP-FPM, MySQL, fail2ban and log rotation |
| `backup/` | Backup, restore-test and off-host pull scripts (writes the `status.json` that AICC Ops reads) |
| `release/` | Release build, deploy and activation scripts |
| `stack-tests/` | Local lint and tests for the infrastructure scripts (`npm run infra:lint`, `npm run infra:test`) |
| **`aicc-ops/`** | **AICC Ops: tiny first-party, operator-only observability (collectors, SQLite history, alerts, capacity verdicts, loopback UI). Python 3.12 stdlib only. Tests: `npm run ops:test`. See `aicc-ops/README.md`.** |
| **`sentinel/`** | **External availability sentinel: design (`DESIGN.md`, failure-mode table, deployment options) and a stdlib reference implementation. Not deployed. Tests: `npm run sentinel:test`.** |

Two observers, deliberately separate: AICC Ops explains *why* from inside the host; the sentinel answers *is it reachable from outside* from a different failure domain; DigitalOcean Monitoring (email/Slack) stays as the independent safety net.

---

## Stack provisioning: the Linux STAGING host (section owned by the provisioning work)

Target: DigitalOcean Basic Regular, **1 vCPU / 2 GiB RAM / 50 GiB**, Ubuntu 24.04 LTS, 2 GiB swapfile (`vm.swappiness=10`), UFW 22/80/443 tcp, fail2ban, no HTTP/3. Staging `stage.copilt.org`; production `www.copilt.org` later on the same architecture. Stage 1 (cloud-init) is `provision/cloud-init.template.yaml`; everything below is installed afterwards, by reviewed scripts, step by step over SSH. **Nothing in this section has been run on a real Droplet.**

**Bring-up order (details, verification and rollback per step: `provision/RUNBOOK-stage-bringup.md`):** 0 lint+tests, droplet verified, DNS A record -> 1 `push-bundle.sh` -> 2 stage-2 SSH hardening (`stage2-verify-second-session.sh` in a second session, then `harden-stage2.sh`) -> 3 `install-stack.sh` (preflight, identity, packages, users-dirs, caddy, wpcli, php, mysql, sysctl, scripts, systemd, logrotate, fail2ban, services, verify) -> 4 `create-staging-db.sh`, `render-wp-config.sh` -> 5 `install-stack.sh --only edge-env` -> 6 `build-cp-release.sh` + `deploy-release.sh --kind cp --first-install`, `wp core install` -> 7 `build-site-release.sh --target stage` + `deploy-release.sh --kind site` -> 8 Caddyfile (rendered by `scripts/ops/render-edge.mjs --mode stage`), `--only caddyfile`, `--only enable-edge` (Let's Encrypt staging CA first, then the real one) -> 9 `--only enable-timers` -> 10 `operator-tunnel.sh` -> 11 `backup/pull-offhost.sh` -> 12 final checks.

| Where | Files |
|---|---|
| `provision/` | `install-stack.sh` (+ `lib/common.sh`, `pins.env`), `harden-stage2.sh`, `stage2-verify-second-session.{sh,md}` (+ `lib/ssh-session.sh`), `create-staging-db.sh`, `render-wp-config.sh`, `wp-config.stage.template.php`, `push-bundle.sh`, `operator-tunnel.sh`, `RUNBOOK-stage-bringup.md` |
| `systemd/` | `aicc-edge.service`, `aicc-wp-cron.{service,timer}`, `aicc-backup.{service,timer}`, `aicc-cert-expiry.{service,timer}`, `aicc-notify-failure@.service`, `overrides/{php8.3-fpm,mysql}.service.d/aicc.conf`, `aicc-unit-status.sh`, `edge.env.stage.template` |
| `php/` `mysql/` | `aicc-pool.conf`, `90-aicc-fpm.ini`, `90-aicc-cli.ini`, `aicc-mail-sink.sh`, `aicc-admin.pool.conf.sample` (not installed); `99-aicc.cnf` |
| `fail2ban/` `logrotate/` | jails `aicc-wp-login` and `caddy-4xx-flood` with their filters; rules for PHP logs, the MySQL slow log, the backup log |
| `backup/` | `aicc-backup.sh`, `aicc-restore-test.sh`, `pull-offhost.sh` (Mac), `lib/backup-common.sh`, `README-backup.md` (RPO/RTO, restore) |
| `release/` | `build-site-release.sh`, `build-cp-release.sh`, `deploy-release.sh` (Mac), `activate-release.sh`, `rollback-release.sh`, `smoke-{cp,site}.sh` (host), `lib/{release-common.sh,release_tool.py}`, `pins.env`, `README.md` (model, migration rules) |
| `stack-tests/` | `lint.{sh,py}`, `run-all.sh`, `test_{lint,provision,backup,release,ubuntu}.sh`, `ubuntu-inner.sh`, `test_fail2ban_regex.py`, `lib/t.sh` |

### Memory budget (2048 MiB; the owner chose this size on purpose)

| Component | Typical steady state | Configured worst case | systemd cap (High / Max) | Why this number |
|---|---|---|---|---|
| Kernel, systemd, sshd, journald, chrony, fail2ban, DO agent | ~250 MiB | n/a | n/a | estimate for Ubuntu 24.04 server; confirm with `free -m` on the host |
| MySQL 8.0 | measured 160 MiB idle, 182 MiB after a WordPress install and warm-up; expect 330-400 once the pool fills | pool 192 + 30 connections x ~3 + ~150 = ~430 | 600 M / 720 M | pool 192 MiB (the working set of a small store fits several times; **chunk size set to 64 MiB because 8.0 rounds the pool up to a multiple of 128 MiB: "192M" silently became 256M, found by running a real mysqld**), `performance_schema` OFF (saves tens to hundreds of MiB), `max_connections` 30 (3 PHP workers + cron + backup + restore check + Ops + admin), table caches 800, binlog OFF, socket only |
| PHP-FPM (`aicc` pool) | master ~35 + 3 workers (measured RSS 89-97 MiB each, mostly shared OPcache pages) + OPcache 128 MiB shm | 3 x 192 MiB (`memory_limit`) + 128 + 30 = 734 | 640 M / 900 M | `pm.max_children=3` on one vCPU (the extra workers only overlap MySQL waits), `max_requests=300`, OPcache **128 MiB: measured 68 MiB used by 1,709 scripts after only front-end/REST/store warm-up, wp-admin adds more** |
| Caddy 2.11.x | 40-80 MiB | `GOMEMLIMIT=160MiB` | 200 M / 320 M | static files + TLS + reverse proxy to a unix socket |
| wp-cron (every minute) | 60-120 MiB for a few seconds | `memory_limit` 192M | Max 256 M | `Nice=10` |
| backup (03:30 UTC) | ~30 MiB (streaming dump + gzip) | | Max 256 M | `Nice=19`, idle IO class |
| Page cache / free | whatever is left (>= 500 MiB) | | | MySQL `O_DIRECT` keeps InnoDB out of the page cache |

Sum of the three `MemoryHigh` values 1440 MiB + ~300 MiB OS/cache floor = 1740 MiB < 2048 MiB; the 2 GiB swapfile (swappiness 10) is the safety net, not capacity. `MemoryMax` values (900 + 720 + 320) intentionally exceed RAM: they are per-service ceilings that protect the others (OOM score of mysqld is lowered: PHP workers die first and respawn in milliseconds). `npm run infra:lint` recomputes this arithmetic from the files.

### What each guard does (short)

* **Fail closed:** every script has `set -euo pipefail`, refuses non-root where it must run as root, has `--dry-run`, and the stage tooling refuses `139.59.157.231`, `www/api/apex copilt.org`, and the production SSH key by name. The stack installer refuses a host without `/etc/aicc-stage-identity` saying `AICC_ENV=staging`.
* **Releases:** immutable versioned trees, atomic `ln -sfn` + `mv -T` swap, health gate (twice in a row within 30 s) with automatic rollback, Control Plane activation **refused without a successful dump younger than 15 minutes**, code rollback is not a database rollback (additive-migration rules in `release/README.md`).
* **Backups:** daily dump + separate `0600` files archive + restore smoke into `aicc_restore_check`, `status.json` for AICC Ops (`"status":"ok|failed"`, `last_success`), 7-day retention that never deletes the newest three sets, off-host pull to the Mac with 14 copies.
* **fail2ban:** `aicc-wp-login` counts POSTs to `/my-account/` and `/wp-login.php` (rate) and 403/429 on `/wp-login.php`, `/xmlrpc.php`, `/wp-admin/`, `/wp-cron.php`; it **cannot** tell a failed login from a successful one (WordPress answers both with 200/302 and the log has no body); the plugin's own throttle is the real login defence. `caddy-4xx-flood` bans 60 client errors per minute. Loopback is never banned (the operator tunnel arrives from 127.0.0.1).

### Verified here vs only on the real host

Full lists: `provision/RUNBOOK-stage-bringup.md`, section "Proven vs pending". Short form: `npm run infra:test` runs on the Mac against a throwaway MySQL, the rehearsal fixture (`aicc_rehearsal_cp` only) and an **Ubuntu 24.04 container** (real PHP 8.3 + php-fpm, MySQL 8.0, `systemd-analyze verify` on systemd 255, fail2ban 1.0.2, OpenSSH 9.6; needs the Docker daemon, skipped without it). systemd as PID 1, UFW, Caddy on Linux, Let's Encrypt, DigitalOcean, the cloud firewall and real memory under load were **not** and cannot be verified here.
