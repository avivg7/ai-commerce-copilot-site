# Security gate: PHP USN-8948-1 (CVE-2026-109618, CVE-2026-109619) on `aicc-cp-stage`, 2026-10-21

Status: **remediated and verified on the staging host.** No production system (`www`, apex, `api.copilt.org`, the API Droplet, Neon, Render, payments) was touched.

## What the advisory says (as far as I could verify it)

Canonical's notice page `https://ubuntu.com/security/notices/USN-8948-1` (fetched 2026-10-21; the page text was summarised by the fetch tool, not read in a browser) lists "PHP vulnerabilities", affected `libapache2-mod-php8.3`, `php8.3-cgi`, `php8.3-cli`, `php8.3-fpm`, CVE-2026-109618 (out-of-memory handling while processing requests, remote code execution) and CVE-2026-109619 (request state across worker reuse, remote code execution), fixed in Ubuntu 24.04 (noble) at `8.3.6-0ubuntu0.24.04.13`. A general web search did not yet index the notice, and `apt-get changelog` for `.13` returned 404 on `changelogs.ubuntu.com` (not published yet), so the host itself could not name the CVEs. What the host DID prove independently: the version `8.3.6-0ubuntu0.24.04.13` exists in the official archive (`noble-security`) for `php8.3-cli`, `php8.3-fpm` and `php8.3-common` and is newer than the installed `.12`.

## Before

| Item | Value |
|---|---|
| Installed (all `php8.3-*`: cli, common, curl, fpm, gd, intl, mbstring, mysql, opcache, readline, xml, zip) | `8.3.6-0ubuntu0.24.04.12` (installed 2026-10-20 22:52 UTC); `php-common 2:93ubuntu2` |
| Fixed version offered by `noble-security` after `apt-get update` | `8.3.6-0ubuntu0.24.04.13` |
| Had unattended-upgrades installed the fix? | **No.** It ran at 06:51 (apt-daily-upgrade) and 10:02 UTC on 2026-10-21 and found nothing to upgrade: the notice is dated 2026-10-21 and was not in the package index yet. The next scheduled run was 2026-10-22 06:01 UTC. |
| Running workers | master started 18:21 UTC, built from `.12` |

## Remediation (distribution repository only: no PPA, no compilation, no release upgrade)

`apt-get install -y --only-upgrade` of exactly the 12 installed `php8.3-*` packages at 18:28:57 UTC (requested by `aicc`), config files kept (`--force-confold`). The package's own post-install restarted PHP-FPM at 18:29:27; I restarted it again explicitly at 18:29:49.

## After (proof the ACTIVE workers are patched)

* All 12 packages `8.3.6-0ubuntu0.24.04.13`. `dpkg -S` attributes the running binary to `php8.3-fpm 8.3.6-0ubuntu0.24.04.13`; `php-fpm8.3 -v` and `php -v` report `built: Oct 19 2026 15:16:58`.
* Master and workers started after the install (18:29:49); `/proc/<pid>/exe` is `/usr/sbin/php-fpm8.3`; the only `(deleted)` mappings are `/dev/zero` (anonymous shared memory); no mapped library or binary is a deleted file.
* Pool and ini configuration unchanged (hashes and mtimes), systemd sandbox exposure score unchanged (4.1), listeners identical (22, 80, 443, loopback 12019/8443/9190, resolver stubs), PHP socket `0660 aicc-cp:aicc-edge`.
* Services active: php8.3-fpm, Caddy, MySQL 8.0.46, AICC Ops, fail2ban, ufw, the timers; 0 failed units. `/healthz` 200, `/`, `/pricing/`, `/he/pricing/`, `/my-account/`, REST plans 200, `wp-login.php` 403 on the public listener, WordPress 7.1.3 / WooCommerce 10.9.4 / AICC plugin active, `smoke-cp` ok, 58 tables.
* Targeted browser regression after the patch: sections 1, 3, 4, 6, 7, 10, 11 (operator tunnel path) and 12 = 389 checks, 0 failures, 0 egress violations. Benign multipart probes (valid, 5 MB, 70 MB over the limit, malformed boundary) got clean 400/413 refusals and the workers stayed up.

## Evidence inspected before patching (what it does and does not show)

Window: the host's life (log starts 2026-10-20). Edge log: 16,458 records, request headers allow-listed (no bodies). `php8.3-fpm.log`: no signal, segfault, kill, OOM or memory-limit wording; no PHP error log file exists; kernel log: no php segfault/OOM-kill. The only 5xx responses (9) are my own fault-injection drills (PHP-FPM stopped, `kill -9` of MySQL/PHP-FPM). `systemd` shows one `php8.3-fpm` main process killed by SIGKILL at 18:17:10 UTC = my own failure drill. 648 multipart POSTs from internet scanners all received `421` from Caddy's unknown-host catch-all and never reached PHP; no request exceeded 1 MB; 2 "executing too slow" warnings are the Action Scheduler runner during my own load test. **Conclusion supported by the evidence: no indicator of exploitation was found in the available logs. This does not prove the absence of compromise** (bodies are not logged, the logs cover only the host's short life, the host held no customer data).

## Process gap found

The fix reached the archive the day it was announced, but the host's automatic patching only looks once a day (~06:00 UTC), so the exposure window for a critical remote-code-execution fix can be up to ~24 h on this host plus the time until PHP-FPM restarts. **Implemented 2026-10-22 (Workstream 14, branch `launch/secupdates`).** The stock timers were not simply sped up: Ubuntu's `apt.systemd.daily` honours day-granularity `APT::Periodic` stamps, so a faster `apt-daily` timer would mostly do nothing. Instead a dedicated job runs EVERY HOUR (`aicc-security-updates.timer`, `*:23` plus up to 10 min jitter, `Persistent=true`):

1. `apt-get update` (one retry); 2. `unattended-upgrade` with the UNCHANGED policy (Allowed-Origins = the distribution and its `-security` pockets only; `Automatic-Reboot` stays `false`); 3. verification that the RUNNING services are patched (a service whose main process still maps a deleted executable or library is reported; PHP-FPM, the only public-facing apt service, is re-executed with a graceful `systemctl reload`); 4. a status file `/var/lib/aicc/status/security-updates.json` (numbers and package NAMES only) that AICC Ops reads.

Worst-case lag from "fix in the archive" to "installed and active" is now about 70 minutes plus mirror delay (it was up to ~24 h). Three AICC Ops rules watch it: `security_updates_pending` (WARNING 6 h / CRITICAL 24 h), `security_updates_stale` (job not completing: 4 h / 12 h; or its last run failed) and `services_need_restart`. The existing `reboot_required` rule still covers kernel/libc updates that need a planned reboot (the host never reboots by itself). MySQL and SSH are never restarted by the job itself (package post-install scripts handle their own restarts); an unpatched-but-running MySQL shows up in `services_need_restart`.

Trade-off accepted: a security update to `mysql-server` can now restart MySQL at any hour (a few seconds of database unavailability) instead of only around 06:00 UTC; the alternative is a longer exposure window for a database or PHP vulnerability.

Raw evidence: `~/Downloads/AICC-cutover-evidence/linux-stage/phase2b/php-security/` (01-before-packages … 10-multipart-smoke, 09-browser-smoke.log).
