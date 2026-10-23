# RUNBOOK: bringing up the STAGING Control Plane stack (stage.copilt.org)

Exact order, from a freshly created Droplet to a working, verified staging site. Every step has **Run**, **Verify** and **Rollback**. This runbook WAS executed on the real staging Droplet (2026-10-21) step by step over SSH; the scripts had been tested on a Mac (and, where noted in `infra/README.md`, in an Ubuntu 24.04 container) before. Any step that fails stops the sequence. It covers STAGING only: there is no production equivalent yet (`docs/cutover/runbook.md` section 11, blocker B-3).

Conventions: `MAC$` = on your Mac, `HOST$` = on the Droplet as user `aicc` (`sudo` where shown). `<IP>` = the Droplet's public IPv4 (the one `verify-droplet.sh` used), `<KEY>` = `~/.ssh/aicc_cp_stage`. Never use `~/.ssh/aicc_digitalocean_prod` or `139.59.157.231`: every script refuses them.

Hard rules that hold for the whole runbook: no secret is ever pasted into chat or committed; database passwords are generated on the host into `0600` files and never printed; the operator reaches wp-admin only through the SSH tunnel; `www.copilt.org`, `copilt.org` and `api.copilt.org` are never touched.

---

## Step 0. Preconditions (Mac)

```bash
MAC$ cd ~/self_projects/ai_copilot_site
MAC$ npm run infra:lint && npm run infra:test        # both must be green (counts are in infra/README.md)
MAC$ infra/provision/verify-droplet.sh --ip <IP> --key <KEY>    # the stage-1 checks from README-droplet-creation.md all PASS
MAC$ dig +short stage.copilt.org A                   # must print the RESERVED IPv4 (the A record must exist before TLS is requested, Step 9)
```
Rollback: nothing changed yet.

## Step 1. Put the bundle on the host (Mac)

```bash
MAC$ infra/provision/push-bundle.sh --stage-ip <IP> --stage-host stage.copilt.org --key <KEY> --dry-run   # read the file list
MAC$ infra/provision/push-bundle.sh --stage-ip <IP> --stage-host stage.copilt.org --key <KEY>
```
Verify: `ssh -i <KEY> aicc@<IP> 'ls ~/aicc-infra-bundle/infra/provision'` lists `install-stack.sh`. The push refuses a host whose `/etc/aicc-stage-identity` is not `AICC_ENV=staging` / `AICC_HOSTNAME=stage.copilt.org`.
Rollback: `ssh ... 'rm -rf ~/aicc-infra-bundle'`.

## Step 2. Stage 2: close root SSH, with a second session (two terminals)

Follow `infra/provision/stage2-verify-second-session.md` exactly (session 1 stays open; session 2 as `aicc` runs `stage2-verify-second-session.sh`; session 1 runs `harden-stage2.sh --dry-run`, then for real; session 3 proves a new login works and `ssh root@<IP>` is refused).
Verify: `sudo sshd -T | grep -E '^(permitrootlogin|allowusers)'` prints `permitrootlogin no` and `allowusers aicc`.
Rollback: `sudo rm /etc/ssh/sshd_config.d/05-aicc-stage2.conf && sudo sshd -t && sudo systemctl reload ssh` (or the DigitalOcean web console).

## Step 3. Install the stack (host)

```bash
HOST$ cd ~/aicc-infra-bundle
HOST$ sudo infra/provision/install-stack.sh --dry-run            # read ALL of it: users, packages, files, units
HOST$ sudo infra/provision/install-stack.sh --only preflight,identity
HOST$ grep AICC_STAGE_ID /etc/aicc-stage-identity                # write this 32-hex id down: the builds and deploys need it (an identifier, not a secret)
HOST$ sudo infra/provision/install-stack.sh --only packages,users-dirs
HOST$ sudo infra/provision/install-stack.sh --only caddy,wpcli --require-cosign   # see "Verifying Caddy" below; drop --require-cosign if cosign is not installed
HOST$ sudo infra/provision/install-stack.sh --only php,mysql,sysctl,scripts,systemd,logrotate,fail2ban,services,verify
```
(`sudo infra/provision/install-stack.sh` with no `--only` runs all of these in that order; the split lets you read each step's output.)
Verify: the final `verify` step prints PASS lines only; additionally `ss -ltnp` shows only sshd on the public side (nothing on 3306/33060), `ls -l /run/php/aicc-cp.sock` shows `srw-rw---- aicc-cp aicc-edge`, `systemctl is-active mysql php8.3-fpm` both `active`, `systemctl is-enabled aicc-edge` is **not** enabled yet, `free -m` shows 2 GiB swap.
Rollback: the installer is additive and idempotent. Config files it replaced are in `/var/backups/aicc-config/<timestamp>/`. To remove the PHP pool: delete `/etc/php/8.3/fpm/pool.d/aicc.conf`, move `www.conf.aicc-disabled` back, `systemctl restart php8.3-fpm`. MySQL drop-in: delete `/etc/mysql/mysql.conf.d/99-aicc.cnf`, restart mysql.

### Verifying Caddy (once, on the Mac, before trusting the pin)
The installer checks the tarball's SHA-512 against the pin in `infra/provision/pins.env` and against the release's own `caddy_2.11.7_checksums.txt`, and verifies the Sigstore signature of that file **when `cosign` is installed on the host** (it is not by default; no third-party apt repository is used). To verify the signature yourself without installing anything on the server:
```bash
MAC$ brew install cosign   # or download a cosign release and check its checksum
MAC$ cd /tmp && V=2.11.7 && B=https://github.com/caddyserver/caddy/releases/download/v$V
MAC$ curl -fsSLO $B/caddy_${V}_checksums.txt -O $B/caddy_${V}_checksums.txt.pem -O $B/caddy_${V}_checksums.txt.sig
MAC$ cosign verify-blob caddy_${V}_checksums.txt --certificate caddy_${V}_checksums.txt.pem --signature caddy_${V}_checksums.txt.sig \
       --certificate-identity-regexp '^https://github\.com/caddyserver/caddy/\.github/workflows/' --certificate-oidc-issuer https://token.actions.githubusercontent.com
MAC$ grep caddy_${V}_linux_amd64.tar.gz caddy_${V}_checksums.txt     # the hash must equal CADDY_TARBALL_SHA512 in pins.env
```
The identity regexp is the documented shape for Caddy's release workflow but was **not** run here (no network to GitHub was allowed while preparing this); if cosign rejects it, read the certificate's identity and correct the pin file in a reviewed commit rather than skipping verification.

## Step 4. Database and wp-config (host)

```bash
HOST$ sudo infra/provision/create-staging-db.sh --dry-run
HOST$ sudo infra/provision/create-staging-db.sh               # creates aicc_cp, users aicc_cp and aicc_backup; passwords -> /etc/aicc/secrets (0600), /etc/aicc/backup.cnf (0600); nothing printed
HOST$ sudo infra/provision/render-wp-config.sh                # -> /srv/aicc/shared/wp-config.php (0640 root:aicc-cp)
```
Verify: `sudo ls -l /etc/aicc/secrets /etc/aicc/backup.cnf /srv/aicc/shared/wp-config.php` (modes `0600`/`0640`); `sudo php -l /srv/aicc/shared/wp-config.php`; `sudo mysql -e "SHOW GRANTS FOR 'aicc_cp'@'localhost'"` shows privileges on `aicc_cp`.* only.
Rollback: `sudo mysql -e "DROP DATABASE aicc_cp; DROP USER 'aicc_cp'@'localhost', 'aicc_backup'@'localhost'"`; remove the secret files.

## Step 4b. Hand-off to AICC Ops (host; optional until Ops is deployed)

AICC Ops (`infra/aicc-ops`, its own work item) reads what this stack writes. The matching values are already in its example config: PHP-FPM status over the socket `/run/php/aicc-cp.sock` (`/fpm-status`), backups from `/srv/aicc/backups` (`status.json`: top-level `"status":"ok|failed"`, `last_success`), failed-unit files `/var/lib/aicc/status/unit-<name>.json`, units `aicc-edge`, `php8.3-fpm`, `mysql`, `fail2ban` and the three timers, MySQL through the socket as `aicc_monitor` (auth_socket, OS user `aicc-ops`).
```bash
HOST$ sudo mysql < ~/aicc-infra-bundle/infra/aicc-ops/sql/monitoring-user.sql          # Ops' own file; creates aicc_monitor (no password)
# OWNER DECISION: may the `aicc-ops` user connect to the PHP socket (needed only for the /fpm-status collector)? Connecting lets a FastCGI client run any .php file as aicc-cp.
HOST$ sudo infra/provision/install-stack.sh --only users-dirs --ops-fpm-access      # adds aicc-ops to group aicc-edge; without it the FPM collector reports "permission denied" (fail closed)
```

## Step 5. Edge environment (host; owner input needed)

Owner input: **the ACME contact e-mail** (Let's Encrypt account contact; not relied on for expiry warnings).
```bash
HOST$ sudo infra/provision/install-stack.sh --only edge-env --acme-email <OWNER-EMAIL>
```
It writes `/etc/aicc-edge/edge.env` once (never overwritten) with the variables of `docs/cutover/Caddyfile.edge.template`: `AICC_EDGE_MODE=stage`, `AICC_PUBLIC_HOST=AICC_STAGE_HOST=stage.copilt.org`, **`AICC_STAGE_ID` copied from `/etc/aicc-stage-identity`** (one id for the identity route, the site build and the deploy script), `AICC_STATIC_ROOT=/srv/aicc/site/current`, `AICC_WP_ROOT=/srv/aicc/cp/current`, `AICC_PHP_FPM_SOCKET=unix//run/php/aicc-cp.sock`, `AICC_OPERATOR_PORT=8443`, and **`AICC_ACME_CA` = the Let's Encrypt STAGING directory for the first start** (Step 8 switches it).
Verify: `sudo cat /etc/aicc-edge/edge.env` (no secrets; no `AICC_OPERATOR_CIDRS`: stage has no public operator allowlist).
Rollback: delete the file.

## Step 6. Control Plane: build, first deploy, install WordPress

```bash
MAC$ infra/release/build-cp-release.sh --cp-worktree "$CPW" --out-dir ~/aicc-releases --dry-run        # $CPW = the Control Plane worktree of the approved commit (REQUIRED, no default); shows the pinned inputs and the CP commit
MAC$ infra/release/build-cp-release.sh --cp-worktree "$CPW" --out-dir ~/aicc-releases                  # (also verifies the packaged theme's brand kit against this Site repo and fails on drift) WordPress 7.1.3 + WooCommerce 10.9.4 + Storefront 4.6.2 + AICC theme/plugin; reproducible; manifest with hashes
MAC$ infra/release/deploy-release.sh --kind cp --artifact ~/aicc-releases/cp-<id>.tar.gz \
        --stage-host stage.copilt.org --stage-ip <IP> --stage-id <STAGE_ID> --key <KEY> --dry-run
MAC$ infra/release/deploy-release.sh ... --first-install     # same command without --dry-run; --first-install only for the very first Control Plane release
```
What happens: identity check, pre-release dump (an empty database is dumped and the restore smoke is skipped, stated in `status.json`), rsync, verification, atomic swap, graceful PHP-FPM reload, health gate (WordPress answers its install redirect: accepted once), prune.
Then install WordPress **on the host** (the admin password is typed at the prompt, never stored in a script or printed):
```bash
HOST$ sudo aicc-wp core install --url=https://stage.copilt.org --title="AICC Control Plane (staging)" --admin_user=<operator-login> --admin_email=<OWNER-EMAIL> --prompt=admin_password --skip-email
HOST$ sudo aicc-wp plugin activate woocommerce aicc-license-manager
HOST$ sudo aicc-wp theme activate aicc-admin
HOST$ sudo aicc-wp option update permalink_structure '/%postname%/' && sudo aicc-wp rewrite flush
```
Content seeding (commercial products, account-required checkout, legal documents) is done by the Control Plane repo's own idempotent scripts (`scripts/bootstrap-commercial-products.php`, `configure-account-required-checkout.php`, `seed-legal-documents.php`, as `scripts/rehearsal/cp-fixture.sh create` does for the fixture): run them with `aicc-wp eval-file` from a copy of that repo on the host, with their `*_APPLY=1` switches. They are **not** part of this stack; the owner decides when staging gets content.
Verify: `sudo aicc-wp core version` (7.1.3), `sudo aicc-wp plugin list --fields=name,status,version`, `ls -l /srv/aicc/cp/` (`current` and no `previous` yet), `sudo cat /srv/aicc/backups/status.json | jq '{status,label,finished_at}'`.
Rollback: `sudo aicc-rollback-release --kind cp` (needs a `previous`; on the first release there is none: `sudo rm /srv/aicc/cp/current` and drop the database to start over). A failed health gate rolls back by itself (exit 3) and leaves the failed tree in `releases/` with a `.FAILED` marker.

## Step 7. Static site: build, deploy

```bash
MAC$ infra/release/build-site-release.sh --target stage --stage-id <STAGE_ID> --out-dir ~/aicc-releases   # runs: AICC_BASE_PATH="" SITE_URL=https://stage.copilt.org npm run build (into a temp dist dir; out/ is not touched)
MAC$ infra/release/deploy-release.sh --kind site --artifact ~/aicc-releases/site-<id>.tar.gz --stage-host stage.copilt.org --stage-ip <IP> --stage-id <STAGE_ID> --key <KEY>
```
The stage build has `noindex` on every page, a disallow-all `robots.txt`, no sitemap and `/.well-known/aicc-stage-identity`. Production builds (`--target production`) have none of that and are refused by `deploy-release.sh`.
Verify: `ls -l /srv/aicc/site/current` on the host; `test -s /srv/aicc/site/current/index.html /srv/aicc/site/current/404.html /srv/aicc/site/current/50x.html`.
Rollback: `sudo aicc-rollback-release --kind site`.

## Step 8. Caddyfile and the public edge (needs Steps 5-7 done, DNS in place)

The Caddyfile is rendered from the ONE template by the edge/cutover work (`docs/cutover/stage-linux.md`): public `:80/:443`, `php_fastcgi` over the unix socket, the loopback **operator listener** `stage.copilt.org:8443` (`bind 127.0.0.1`), the identity route `/.well-known/aicc-stage-identity`, `X-Robots-Tag: noindex`, HTTP/3 off, metrics on the loopback admin API only.
```bash
MAC$  node scripts/ops/render-edge.mjs --mode stage --out /tmp/Caddyfile.stage        # review it; production names are refused
MAC$  scp -i <KEY> /tmp/Caddyfile.stage aicc@<IP>:~/Caddyfile.stage
HOST$ sudo infra/provision/install-stack.sh --only caddyfile --caddyfile ~/Caddyfile.stage    # runs `aicc-edge-preflight --mode stage` on the candidate first; installs only if it passes
```
Requirements this stack satisfies for the Caddyfile (stage-linux.md section 9): socket `/run/php/aicc-cp.sock` `0660 aicc-cp:aicc-edge`; `security.limit_extensions=.php`, `cgi.fix_pathinfo=0`, `expose_php=Off`, `clear_env=yes`, `request_terminate_timeout=55s` < the edge's 60 s; the docroot `/srv/aicc/cp/current` is root-owned, readable by `aicc-edge`, not writable by it; `wp-config.php` has no `X-Forwarded-*` handling and an empty `AICC_LM_TRUSTED_PROXIES`. **Please use `resolve_root_symlink`** on `php_fastcgi` (measured: without a PHP-FPM reload the old release is still served through the symlink path; `activate-release.sh` always reloads, `resolve_root_symlink` additionally makes OPcache follow the real release path).

### TLS with Caddy's automatic HTTPS (public CA)
* The **A record `stage.copilt.org` -> Reserved IPv4 must exist and have propagated before** `enable-edge` (`dig +short stage.copilt.org @1.1.1.1` from the Mac and `dig` on the host). Do not create an AAAA record that points somewhere else. Ports 80 and 443 must be open in UFW **and** the DigitalOcean cloud firewall (they are).
* **First start: the Let's Encrypt STAGING directory** (`AICC_ACME_CA` in `edge.env`, already set by Step 5): it has generous rate limits and its certificates are deliberately untrusted by browsers, so a wrong DNS record or a firewall mistake costs nothing. Real-CA limits to keep in mind afterwards: 5 failed validations per hostname per hour, 5 duplicate certificates per week, 50 certificates per registered domain (`copilt.org`) per week, 300 new orders per account per 3 hours; do not restart Caddy repeatedly while issuance fails, fix the cause first.
```bash
HOST$ sudo infra/provision/install-stack.sh --only enable-edge       # re-runs the stage preflight, refuses unless a site release is active, then starts aicc-edge and runs the listener audit
HOST$ journalctl -u aicc-edge -f                                      # watch for the certificate obtained message (staging CA)
HOST$ sudo aicc-edge-listener-audit                                   # only *:80, *:443, 127.0.0.1:8443, 127.0.0.1:12019, sshd; no UDP; no 3306/33060
MAC$  curl -s https://stage.copilt.org/.well-known/aicc-stage-identity --insecure ; echo     # {"env":"staging","host":"stage.copilt.org","id":"<STAGE_ID>"} (--insecure only while the CA is the untrusted staging one)
# when docs/cutover/stage-linux.md section 6 passes with the staging CA: switch to the real CA
HOST$ sudo sed -i '/^AICC_ACME_CA=/d;/^# FIRST start only/,/^# and `systemctl reload/d' /etc/aicc-edge/edge.env && sudo systemctl reload aicc-edge     # or edit the file by hand
MAC$  openssl s_client -connect stage.copilt.org:443 -servername stage.copilt.org </dev/null 2>/dev/null | openssl x509 -noout -issuer -subject -dates     # issuer is now Let's Encrypt (R10/R11/E5...) not "(STAGING)"
MAC$  scripts/ops/cert-expiry-check.sh --host stage.copilt.org            # OK <date>
MAC$  curl -s -o /dev/null -w '%{http_code}\n' https://stage.copilt.org/wp-login.php     # 403 from the public internet
```
Rollback: `sudo systemctl disable --now aicc-edge` (the site goes dark; nothing else changes). Certificates stay in `/var/lib/aicc-edge/caddy`.

## Step 9. Timers (host)

```bash
HOST$ sudo infra/provision/install-stack.sh --only enable-timers     # wp-cron every 2 minutes, backup 03:30 UTC, certificate check 06:15 UTC
HOST$ systemctl list-timers 'aicc-*'
HOST$ sudo systemctl start aicc-backup.service && sudo cat /srv/aicc/backups/status.json | jq .
HOST$ sudo aicc-restore-test                                          # restore test of the dump just taken
```
Verify: `systemctl is-active aicc-wp-cron.timer aicc-backup.timer aicc-cert-expiry.timer`; `journalctl -u aicc-wp-cron -n 5` shows clean runs; `ls /var/lib/aicc/status/` shows `unit-aicc-*.json` with `"state":"ok"`.
Rollback: `sudo systemctl disable --now aicc-wp-cron.timer aicc-backup.timer aicc-cert-expiry.timer`.

## Step 10. Operator access (Mac)

```bash
MAC$ infra/provision/operator-tunnel.sh --stage-ip <IP> --dry-run
MAC$ infra/provision/operator-tunnel.sh --stage-ip <IP>
```
Opens `ssh -N -L 127.0.0.1:8443:127.0.0.1:8443` (to the edge's **operator listener**, `bind 127.0.0.1`, port `AICC_OPERATOR_PORT`) with the stage key and a separate Chrome profile started with `--host-resolver-rules="MAP stage.copilt.org 127.0.0.1:8443"`, so you browse `https://stage.copilt.org/wp-admin/` with the real certificate and the real host name while the connection goes through the tunnel. Whoever reaches that listener IS the operator; the public listener answers 403 for `/wp-admin/`, `/wp-login.php` and `/wp-cron.php`. Log in with the operator account from Step 6. (Alternative without Chrome flags: `docs/cutover/stage-linux.md` section 5.)
Verify: in that Chrome, `/wp-login.php` loads; in your normal browser it answers 403. Rollback: Ctrl-C closes the tunnel; delete `~/.aicc-stage-chrome` to drop the profile.

## Step 11. Off-host backup (Mac)

```bash
MAC$ infra/backup/pull-offhost.sh --stage-ip <IP> --dry-run
MAC$ infra/backup/pull-offhost.sh --stage-ip <IP>
MAC$ ls -l ~/aicc-offhost-backups-stage; tail -3 ~/aicc-offhost-backups-stage/pull.log
```
Verify: `SUCCESS pulled ... checksum verified` for the dump and the files archive. Restore the pulled dump into a scratch database on the Mac once and record the result in `infra/backup/README-backup.md` (a copy that was never restored is unproven). Scheduling it (launchd/cron) is your choice.

## Step 12. Final verification

* `HOST$ sudo infra/provision/install-stack.sh --only verify` all PASS; `systemd-analyze security aicc-edge` reviewed.
* `HOST$ sudo aicc-edge-listener-audit` passes (nothing listens that should not).
* `HOST$ sudo fail2ban-client status` lists `sshd`, `aicc-wp-login`, `caddy-4xx-flood`; `sudo fail2ban-regex /var/log/aicc-edge/aicc-edge.log /etc/fail2ban/filter.d/aicc-wp-login.conf` reports matches **and a date template hit** (if not, switch `datepattern` to the commented fallback in the filter, reload).
* Memory: `free -m`, `systemctl status mysql php8.3-fpm aicc-edge | grep Memory`; `curl --unix-socket` is not needed: AICC Ops reads `/fpm-status` itself.
* Reboot test (planned, with the console open): `sudo reboot`; afterwards mysql, php8.3-fpm and aicc-edge are `active` in that order and `https://stage.copilt.org/` answers.
* A deliberate rollback drill: deploy a second site release, `sudo aicc-rollback-release --kind site`, deploy again.

---

## What is deliberately manual

* Creating the Droplet, Reserved IP, cloud firewall, the DNS A record (README-droplet-creation.md).
* The two-session SSH hardening decision and the third-login proof.
* The ACME contact e-mail; deciding when to issue the real certificate.
* WordPress' first install and the operator's admin password (typed at a prompt, never stored by tooling).
* Content seeding with the Control Plane repo's scripts; plugin settings that need real third-party credentials (none are configured on staging; mail goes to a file sink, never out).
* Running the off-host pull on a schedule; deciding about Droplet Backups/snapshots (not approved).
* Anything involving `www.copilt.org`, `copilt.org`, `api.copilt.org`, the production API host or its key: out of scope for these tools by design.

## If something goes wrong

DigitalOcean web console (Droplet, Access, Launch Droplet Console) is independent of sshd, UFW and fail2ban. `journalctl -u <unit> -n 100`, `/var/log/aicc-cp/php-error.log`, `/var/log/aicc-cp/php-slow.log`, `/var/log/mysql/error.log`, `/srv/aicc/backups/backup.log`, `/var/lib/aicc/status/unit-*.json`.

---

## Proven vs pending (explicit)

**Proven before the real host exists** (`npm run infra:test`; suites `test_lint`, `test_provision`, `test_backup`, `test_release`, `test_ubuntu`):
* On the Mac: dry-run of every step; idempotent installation into a temp prefix; the stage-2 logic with a stubbed sshd/systemctl; `create-staging-db.sh` grants, `render-wp-config.sh` output (evaluated by PHP), backup/restore with the real `aicc_backup` account against a **throwaway mysqld** (triggers, routines, events, views), the backup/restore scripts against the rehearsal fixture `aicc_rehearsal_cp` only (guards tested), the off-host pull with a stubbed ssh, the whole release pipeline (swap atomicity, rollback, carry-forward, refusals, reproducible tarball, no secrets/fixtures), deploy guards with stubbed ssh/rsync, fail2ban regexes against 6,964 real Caddy log lines.
* In an **Ubuntu 24.04 container** (Docker, `CAP_SYS_PTRACE`, no PID 1): real PHP 8.3.6 + php-fpm with the pool/ini (settings read back from inside a request), MySQL 8.0.46 with the drop-in (effective variables read back), `systemd-analyze verify` (systemd 255) on all units, fail2ban 1.0.2 (`fail2ban-client -t`, `fail2ban-regex` with the real date pattern), OpenSSH 9.6 (`sshd -t/-T`, first-value-wins, two real SSH sessions through the verify and harden scripts), `useradd`/`setfacl`/modes, WordPress 7.1.3 + WooCommerce 10.9.4 + Storefront + the AICC plugin/theme installed with WP-CLI 2.12.0 on PHP 8.3, first install / swap / health gate / rollback / stale-OPcache demonstration, backup + restore on the real schema, the edge preflight (stage mode) on our `edge.env`.

**Only on the real Droplet** (do not assume): systemd as PID 1 (boot order mysql -> php-fpm -> aicc-edge, timers firing, sandbox directives such as `ProtectSystem=strict` with the real paths, `OnFailure=` hook execution, `MemoryHigh/Max` enforcement, `Restart=`); `systemd-analyze security`; Caddy 2.11.7 on Linux (the container had no Caddy: the checks that need `caddy adapt` were not run), the Sigstore signature (cosign identity regexp unverified), the pinned amd64 tarball hash against the real download; Let's Encrypt issuance and renewal; UFW and the DigitalOcean cloud firewall; unattended-upgrades interplay; the real memory under load (the budget table in `infra/README.md` is measured only for idle/warm-up, on arm64 in a container); MySQL 8.0 on amd64 with the real disk; the ssh.service unit name and `systemctl reload ssh`; `journalctl _COMM=sshd` on the real journal (the container used sshd's own log in the same format); fail2ban banning (not just matching) and the iptables/nft action; DNS; the SSH tunnel and Chrome flags on your Mac; the off-host pull against the real host; a full disaster-recovery drill (RTO).

## Known bring-up pitfalls (found on the real host; the fixes are in git history, listed here so the next operator does not rediscover them)

* **Split runs leave a stale MySQL/PHP-FPM** (commit `11d77c6`): when `install-stack.sh` is run in several `--only` steps, a service started by an earlier step keeps the OLD configuration. The installer now restarts stale `mysql` / `php8.3-fpm` across split runs; if you edit a config by hand, restart the service yourself.
* **`push-bundle.sh` creates the remote directories** and the WP-CLI check runs as root (`11d77c6`); a bundle push to a fresh Droplet used to fail on the missing directory.
* **AICC Ops reported MySQL down for 94 minutes** (commit `70c1d22`): `mysql --no-defaults` must be the FIRST client option; client option errors are now collector failures. If `aicc-ops` raises `db_down:mysql` or `collector_failure:cp` right after an install, check `journalctl -u aicc-ops` for a client option error before assuming MySQL is down.
* **`PREFLIGHT WARN: AICC_WP_ROOT=/srv/aicc/cp/current is writable by root`** is printed on every Caddy start and reload: expected (root owns the release tree); it is noise, not a problem. Do not train yourself to ignore other `PREFLIGHT` lines.
* **`systemctl reload aicc-edge` runs the preflight first**; a refused preflight leaves the running edge untouched. After editing `edge.env`, Step 8's `sed` range-delete of the staging-CA line works only while both marker lines of the template exist; check the file with `cat` before and after.
* **Root-owned state needs `sudo` for reading**: `/var/log/aicc-edge/*.log` (0640), `/var/lib/aicc-edge/caddy/certificates` (0700). `ls` without sudo fails and looks like "no certificate".
* **The Droplet has no public IPv6**; UFW carries v6 rules for 80/443/22 that do nothing. There is no AAAA record for `stage.copilt.org`.
* **The first requests after every PHP-FPM reload are slow** (cold OPcache: 4.8 s for `/pricing/`, once 11.5 s for a REST request). The release tooling now warms the common pages after the health gate (`infra/release/warm-cp.sh`); a manual `systemctl restart php8.3-fpm` does not.
* **WP-Cron runs every 2 minutes** (`aicc-wp-cron.timer`), not every minute; Action Scheduler's async runner is switched off in the Control Plane plugin, so the queue is processed by that timer only.

## Stage 3 hardening and sample-content cleanup (security review, 2026-10-21; NOT yet run on the host)

**Stage 3 (SSH crypto allow-list, unused services).** After stage 2 is in force, from the FIRST session and with a fresh second-session marker:
```
HOST$ sudo infra/provision/harden-stage3.sh --dry-run          # prints what it would write/mask
HOST$ sudo infra/provision/harden-stage3.sh                    # writes sshd_config.d/06-aicc-stage3-crypto.conf, sshd -t + effective sshd -T, reload (never restart); masks snapd, ModemManager, udisks2, multipathd when nothing depends on them
MAC$  ssh -i ~/.ssh/aicc_cp_stage -o IdentitiesOnly=yes aicc@<IP> true     # a THIRD login proves the new algorithms work BEFORE you close the first session
```
It refuses a host whose `/etc/aicc-stage-identity` is not staging, refuses without stage 2 in force and without the two-session marker, never touches `do-agent` / `droplet-agent`, and skips a unit with the reason when something depends on it. Rollback: `sudo rm /etc/ssh/sshd_config.d/06-aicc-stage3-crypto.conf && sudo sshd -t && sudo systemctl reload ssh`; services: `sudo systemctl unmask <unit> && sudo systemctl enable --now <unit>`. Narrowing port 22 in the DigitalOcean Cloud Firewall is an **[OWNER]** decision in the panel and is documented only.

**WordPress default sample content** ("Hello world!", "Sample Page", the sample comment "A WordPress Commenter") is public at `/wp-json/wp/v2/posts|comments`. The Control Plane launch gate reports it as a WARN note. Removal (a command to RUN ON THE HOST by the operator, not run by anything in this repository):
```
HOST$ sudo -u aicc-cp wp --path=/srv/aicc/cp/current post delete $(sudo -u aicc-cp wp --path=/srv/aicc/cp/current post list --post_type=post,page --name=hello-world,sample-page --field=ID --post_status=any) --force
HOST$ sudo -u aicc-cp wp --path=/srv/aicc/cp/current comment delete $(sudo -u aicc-cp wp --path=/srv/aicc/cp/current comment list --author_email=wapuu@wordpress.example --field=comment_ID) --force
```
(Both commands fail harmlessly with "no IDs" when the content is already gone.)
