# Backup, restore and off-host copy (Control Plane staging host; same design for production)

## What exists

| Piece | Where | Runs | Purpose |
|---|---|---|---|
| `aicc-backup.sh` (`/usr/local/sbin/aicc-backup`) | host | `aicc-backup.timer` **hourly at :17 UTC** (+ up to 2 min jitter, `Persistent=true`), and `--label pre-release` before every Control Plane release | DB dump + files archive + restore smoke + `status.json` |
| `aicc-restore-test.sh` (`aicc-restore-test`) | host | by hand, after any change to the backup | restores a dump into a throwaway database and runs sanity SQL |
| `aicc-restore.sh` (`aicc-restore`) | host | by hand (real incident) and by `dr-drill.sh` | `fingerprint` / `scratch` / `verify` / `live`: the restore procedure as ONE verified, timed tool (`verify` only checks hashes, archive members and identity and changes nothing) |
| `aicc-offhost-serve.sh` (`/usr/local/sbin/aicc-offhost-serve`) | host | only through the restricted SSH account `aicc-offhost` | `identity` / `status` / `get <backup file>` / `ack ...`, nothing else |
| `install-offhost-access.sh` | host, once | by the operator | creates that account (owner-approved model), sudoers rule for that one script, sshd `Match` block, the pull key's `authorized_keys` line |
| `pull-offhost.sh` | **the owner's Mac** | by hand, or hourly by the LaunchAgent (`macos/install-launchd.sh`) | pulls the newest verified set, applies tiered retention (below), then tells the host (`ack`) |
| `macos/` | the owner's Mac | launchd | `StartInterval` 3600 + `RunAtLoad`; the runner counts consecutive failures and shows ONE macOS notification when there have been 3 or more consecutive failures AND 26 h or more since the last verified pull (at most one notification per 12 h) |
| `dr-drill.sh` | the owner's Mac | by hand | timed drill: freeze, backup, pull off-host, destroy the data tier, recover from the Mac copy, compare fingerprints |
| `lib/backup-common.sh` | host | sourced | shared functions, fixture guard |

Files in `/srv/aicc/backups` (directory `0751 root:root`, so AICC Ops can open `status.json` by name but cannot list it; every dump and archive is `0600 root`):

* `aicc_cp-<UTC>-<label>.sql.gz` + `.sha256` : `mysqldump --single-transaction --quick --routines --triggers --events --no-tablespaces`, through the MySQL unix socket, account `aicc_backup` (SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES on `aicc_cp`; `SHOW_ROUTINE` global; ALL only on `aicc_restore_check`). Credentials live in `/etc/aicc/backup.cnf` (`0600 root`), never on a command line.
* `aicc-files-<UTC>-<label>.tar.gz` + `.sha256` : **separate `0600` archive** of `shared/uploads`, `shared/plugin-releases`, `/etc/aicc-edge`, `/etc/aicc-ops/aicc-ops.toml` (thresholds and host label; its `secrets.env` is deliberately NOT included) and `pointers.txt` (which release `current`/`previous` pointed to, every release manifest's tarball hash and source commit, the host identity line, and `wp_config_sha256`: a HASH of the rendered `wp-config.php`). **The rendered `shared/wp-config.php` is NOT in any archive since 2026-10-23** (security review B, F-05: it carries the DB password, the WordPress salts and both shared licensing secrets, and the archive is copied to the owner's Mac): restore re-renders it from `/etc/aicc/secrets` + the template (`aicc-render-wp-config`), see below. Caddy's certificate storage is deliberately not included: certificates are re-issuable and their private keys stay on the host (`aicc-caddy-storage-backup` exists for a deliberate encrypted copy).
* `status.json` : schema documented at the top of `aicc-backup.sh`. Top-level `"status": "ok|failed"` (what AICC Ops' backup collector parses), `last_success` (survives a later failure; used by the release gate), per-file sha256 and sizes, `restore_check`, `disk_free_pct`.
* `restore-test.json` : result of the last restore test. `backup.log` : the job's log (no secrets).

Checks before a run is called ok: single instance (lock), `>= 15%` free disk (otherwise exit 4, status failed, nothing written), `gzip -t` on both archives, dump ends with `-- Dump completed`, tar listing, and (not with `--quick`) the **restore smoke**: the dump is loaded into `aicc_restore_check`, table counts must equal the source and the `*_options` table must have rows, then the database is dropped (also on failure). The smoke strips `DEFINER=` clauses because the backup account must not hold `SET_ANY_DEFINER`; a real restore as root keeps them.

Retention (host, tiered): every set of the last 24 h, then the newest set of each UTC day up to 7 days, and never fewer than the newest three sets; it runs after a successful run AND once before the disk guard would refuse a run, so a full disk cannot stay full for ever. That is roughly 30 sets (about 25 + 6), not 168. Re-check the arithmetic (and consider `--quick` for the hourly runs and an incremental uploads archive) when the database or the uploads grow: every run archives the whole uploads tree.

## RPO and RTO (what is measured, what is not)

* **On-host RPO: about 1 hour** (hourly timer; a missed run executes after boot). Binary logging is OFF, so there is no point-in-time recovery: the last dump is the recovery point.
* **Off-host RPO: the time since the Mac last pulled** (normally within the hour, but only while the Mac is awake and online). The host knows: every verified pull writes `offhost-ack.json` through `aicc-offhost-serve ack`, and AICC Ops alerts `offhost_stale` (WARNING after 36 h, CRITICAL after 96 h without an acknowledged verified copy; a brand-new host with no ack warns only after 48 h uptime). **When the Mac sleeps or is offline no copy leaves the host**; the data on the host is then protected only by the host's own disk. This is the honest limit of a free off-host mechanism that depends on the owner's Mac. A second pull location (another always-on machine of the owner's, or a paid object store) is the way to remove it: an owner decision, not made.
* **RTO: measured by `dr-drill.sh`**, see "Disaster-recovery drill" below. The figure covers loss of the data tier on the same Droplet (database, uploads, wp-config) recovered from the Mac's copy. It does **not** cover loss of the whole Droplet.

## Restore procedure (database), on the host, as root

```bash
cd /srv/aicc/backups
ls -lt aicc_cp-*.sql.gz | head                         # pick the dump (status.json .last_success names the newest good one)
sha256sum -c aicc_cp-<ts>-<label>.sql.gz.sha256         # must say OK
gzip -t aicc_cp-<ts>-<label>.sql.gz                     # must be silent
sudo aicc-restore-test --file aicc_cp-<ts>-<label>.sql.gz   # proves it loads (throwaway DB), leaves the live DB alone
# the real restore (this REPLACES the live database; take a fresh dump first so the current state is not lost):
sudo aicc-backup --label manual
systemctl stop aicc-wp-cron.timer                       # no cron writes during the restore
mysql -e "DROP DATABASE aicc_cp; CREATE DATABASE aicc_cp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci;"
gzip -dc aicc_cp-<ts>-<label>.sql.gz | mysql aicc_cp   # as root over the socket (auth_socket): definers are kept
mysql -e "GRANT ALL PRIVILEGES ON aicc_cp.* TO 'aicc_cp'@'localhost';"   # only needed if the grants were lost (they live in the mysql schema, not in aicc_cp)
sudo aicc-wp option get siteurl                         # smoke: WordPress reads the restored database
systemctl start aicc-wp-cron.timer
```

Files: `tar -xzpf aicc-files-<ts>-<label>.tar.gz -C / --exclude=pointers.txt` (use `aicc-restore live` instead whenever possible) restores uploads and `/etc/aicc-edge` to their paths (check ownership afterwards: `chown -R aicc-cp:aicc-edge /srv/aicc/shared/uploads`); then re-create the configuration with `sudo aicc-render-wp-config --env stage` (production: `--env production --confirm-production`; needs `/etc/aicc/secrets` with the database password and, in production, the two owner-held shared secrets). Archives taken BEFORE 2026-10-23 still contain the rendered file: `aicc-restore` never extracts it (do not do it by hand either; treat any such old archive as holding live secrets, and rotate them if one ever leaves your control). The code is not in the backup: it comes from the release tarballs (`pointers.txt` says which release was live).

## Off-host copy (runs on the Mac)

`infra/backup/pull-offhost.sh --stage-ip <IPV4>` connects as the restricted account `aicc-offhost` with the dedicated key `~/.ssh/aicc_cp_stage_offhost`, reads `status` (the newest successful set), pulls the dump and the files archive with `get`, and reads `status` (the newest successful set; if the host's newest RUN failed it pulls `last_success` with a warning), pulls the files, then sends `ack`, which the host re-checks against its own sidecars before writing `offhost-ack.json`. It applies tiered retention in `~/aicc-offhost-backups-stage` (`0700`, files `0600`): every set of the last 24 h, the newest of each UTC day for 14 days, the newest of each ISO week for 8 weeks, never fewer than the newest three (`--keep N` instead keeps simply the newest N, N >= 2); it takes a lock (one pull at a time; a skipped run exits 4) and writes `.last-ok`. It accepts a file only if the received bytes hash to the host's own `.sha256` sidecar and, when the set is the one `status.json` currently describes, to the hash recorded there, and `gzip -t` passes.

**Access model (owner-approved 2026-10-21).** The server holds no credential for the Mac. The Mac holds a key that can only run `aicc-offhost-serve` (sshd `ForceCommand` for the account + `restrict,command=` on the key + a sudoers rule naming that one script). It cannot log in interactively, forward ports, read anything but files matching `aicc_cp-/aicc-files-<UTC>-<label>.{sql.gz,tar.gz}[.sha256]`, or write anything but `offhost-ack.json`. The operator key (`aicc_cp_stage`) is never used unattended. Remove the whole path with `sudo infra/backup/install-offhost-access.sh --remove`.

**Setup** (once): `ssh-keygen -t ed25519 -N "" -f ~/.ssh/aicc_cp_stage_offhost -C aicc-offhost-pull`; copy the `.pub` to the host; `sudo bash infra/backup/install-offhost-access.sh --pubkey-file <that file>` (it validates `visudo -cf`, `sshd -t` and the effective config (ForceCommand ours for `aicc-offhost`, none for `aicc`) before reloading `ssh`, and reverts the sshd drop-in on any failure (`--remove` removes the rest)); then on the Mac `infra/backup/macos/install-launchd.sh --stage-ip <IPV4>` (dry-run) and `--apply`. Uninstall: `--uninstall --apply` (backups and logs are kept).

**What happens when the Mac is asleep/offline:** launchd runs one catch-up pull at wake; until then nothing is pulled; after 36 h the host raises `offhost_stale`; the runner shows one macOS notification after 26 h without a verified pull if the Mac is awake but the pull keeps failing. The files archive contains `wp-config.php` (database password, salts, plugin secrets): keep the folder on FileVault-encrypted storage. `--no-files-archive` pulls the database dump only.

An off-host copy that is never restored is a hope, not a backup: the drill below restores from the Mac's copy, and `aicc-restore scratch` loads any dump into a scratch database and fingerprints it without touching the live data.

## Disaster-recovery drill (`dr-drill.sh`)

Scenario: the data tier of the Droplet is lost (database dropped, uploads and `wp-config.php` deleted). Recovery source: the verified copy that lives on the Mac. Steps and timings are in the JSON report; the pass criteria are (1) `aicc-restore live` ends with its health gate and sanity checks green, (2) the per-table fingerprint (row count + `CHECKSUM TABLE`) of the OFF-HOST copy loaded into a scratch database equals the fingerprint taken before the disaster EXACTLY (no exceptions), and the recovered live database equals it except for a named list of tables the application rewrites by itself after start-up (`wp_options`, Action Scheduler tables, WooCommerce sessions, `wp_usermeta`, AICC counters/throttles/logs), (3) uploads and `wp-config.php` exist again, (4) `/healthz` and `/pricing/` answer 200 through the edge, (5) no restore directory or `aicc_dr*` scratch database remains and the services are reported active (leftovers and unit states are reported in the JSON; they are not part of the pass condition).

**Measured on the real staging host, 2026-10-21 (evidence: `~/Downloads/AICC-cutover-evidence/linux-stage/phase2b/dr-drill-3.json`; two earlier runs of the same day failed for reasons found and fixed in the drill script/restore tool, and the first complete run showed the `wp_options` checksum difference explained below).**

| Step | Seconds |
|---|---|
| freeze writers / fresh backup / fingerprint before (preparation, not RTO) | 1.1 / 9.6 / 2.9 |
| off-host pull to the Mac (restricted key, checksums verified, ack) | 8.3 |
| **disaster** (database dropped, uploads and wp-config.php deleted) | 2.9 |
| copy the Mac's verified copy back to the host | 2.4 |
| strict check: the Mac copy loaded into a scratch database and fingerprinted | 10.1 |
| `aicc-restore live` in total | 33.1 |
|   verify / preload check (dump loads into a scratch DB first) | 0.13 / 13.22 |
|   database restore | 7.11 |
|   files restore + permissions | 0.02 + 0.03 |
|   start services | 0.43 |
|   health gate (PHP + wp-config + DB + WordPress + WooCommerce + plugin, `/healthz` through the edge, siteurl) | 8.32 |
|   sanity (options rows, administrator exists) | 2.33 |
| fingerprint after recovery | 3.1 |
| **RTO: disaster declared to recovery proven** | **60.4** |

What the drill proved: the recovery source was the copy that lives OFF the host; the database came back with the same 58 tables; the Mac's copy loaded into a scratch database is **identical to the pre-disaster state in every table (row count and `CHECKSUM TABLE`: 0 differing lines)**; all 13 uploaded files (12 real ones plus the drill's marker) came back and a marker file with random content is byte-identical; `/healthz` and `/pricing/` answer 200 through the edge; no restore directory, scratch database or stray unit remained, all services and timers are active. The live database differs from the pre-disaster fingerprint in one table only, `wp_options` (434 rows both times, a different checksum): the application rewrites options (cron schedule, transients) on its first requests after start-up. That comparison therefore allows a named list of application-rewritten tables, and the strict, exception-free comparison is the one made on the off-host copy.

What this RTO is: loss of the data tier on the same Droplet, a staging-sized database (3.4 MB) and uploads (13 files), the Mac online. It is **not** a promise for a larger production database, and not for loss of the whole Droplet (new host: cloud-init + `install-stack.sh` + database account + this restore + redeploying the release tarballs from the Mac + the certificate; that path is documented, not timed). `aicc-restore live` needs the hashes of the OFF-HOST copy (`--sha256`, `--files-sha256`); for a whole-host rebuild add `--allow-new-host-id` (the rebuilt host has a new random stage id) and re-render `wp-config.php` or restore the database password (the restored `wp-config.php` holds the OLD database password; the new database account has a new one). If the database is already gone the safety backup step fails: pass `--no-safety-backup` (the drill does). Run `aicc-restore live` under `tmux`/`systemd-run` so a dropped SSH session cannot interrupt it (it ignores SIGHUP/SIGPIPE, but a killed terminal is not a plan).

## Covered and not covered by this procedure

| Failure | Covered | How |
|---|---|---|
| Corrupted/dropped database, deleted uploads or wp-config on the same Droplet | yes | `aicc-restore live` from the newest verified set (host copy or Mac copy) |
| Bad release | yes | `aicc-rollback-release` (code only; the database is restored from the pre-release dump only if the schema changed incompatibly) |
| Loss of the whole Droplet (host destroyed, disk lost, account problem) | **only with manual work, time not measured by the drill** | new Droplet: cloud-init, `install-stack.sh`, `create-staging-db.sh`/production DB step, restore the DB + files archive (it brings `wp-config.php` and the edge env), re-deploy the release tarballs from the Mac (`~/aicc-releases`; `pointers.txt` lists which), re-issue the certificate (Caddy does it) |
| Secrets: `/etc/aicc/secrets` (DB passwords, admin password) and `/etc/aicc-ops/secrets.env` (AICC Ops Telegram token) | no | regenerable (DB account, salts: users are logged out) or owner-held (Telegram token, production webhook and activation-proof secrets); never in a backup |
| Caddy certificate storage | no | re-issued automatically (rate limits apply) |
| AICC Ops history (SQLite) | no | monitoring data, rebuilt from zero |
| A backup that is corrupt but passes its checksum | partly | the restore smoke at backup time loads every dump into a throwaway database; the drill proves one recovery end to end |
| Point-in-time recovery, accidental data change noticed days later | no | binary logging off; hourly dumps kept tiered on the host (24 h hourly, then one per day up to 7 days) and on the Mac (24 h hourly, then daily for 14 days, then weekly for 8 weeks) |
| The Mac copy lost at the same time as the Droplet | no | a second off-host location is the fix (owner decision) |

## What is proven and what is not

Proven by `infra:test` (no server needed): the scripts work against the rehearsal fixture database and against a throwaway MySQL server with the real `aicc_backup` account and its exact grants (including triggers, routines, events, views), corrupt/truncated/mismatched dumps are rejected, the lock, retention, disk guard and fixture guard behave, `status.json` has the fields AICC Ops and the release gate read, and the off-host pull verifies checksums and refuses wrong hosts/keys. **Proven on the real host (2026-10-21):** the backup on Ubuntu with MySQL 8.0 with `SHOW_ROUTINE` sufficing for `--routines`; the restricted pull and ack from the Mac; the timed drill (above). **Not proven:** several consecutive scheduled runs over days (the hourly timer was introduced in this phase), loss of the whole Droplet, a second renewal cycle.

## Production (the promoted host `www.copilt.org`, docs/cutover/production-promotion.md)

Everything above applies unchanged to the promoted Droplet; this section lists what is different, what is measured and what is **not** protected. Nothing here has run on the production identity on the live host yet (the host is still staging); the production-mode chain was exercised in an isolated target.

### Names and identity in production

| Thing | Production value | Notes |
|---|---|---|
| Host identity | `AICC_ENV=production`, `AICC_HOSTNAME=www.copilt.org`, new random `AICC_STAGE_ID` | file name `/etc/aicc-stage-identity` is historical; written by `promote-to-production.sh` |
| Database, dump and archive names | `aicc_cp`, `aicc_cp-<UTC>-<label>.sql.gz`, `aicc-files-<UTC>-<label>.tar.gz` | unchanged: they name the database, not the environment. The environment is inside every archive (`pointers.txt host_identity`) and is checked by `pull-offhost.sh` and `aicc-restore` |
| Host backup account / DB account | `aicc_backup` (SELECT/SHOW VIEW/TRIGGER/EVENT/LOCK TABLES on `aicc_cp`, SHOW_ROUTINE, ALL on `aicc_restore_check`), **new random password** at promotion; `/etc/aicc/backup.cnf` 0600 | |
| Backup directory | `/srv/aicc/backups` 0751, **emptied at promotion** (the staging sets go to the rollback bundle) | the restricted pull can therefore never fetch staging data into the production directory |
| Off-host account on the host | `aicc-offhost` (unchanged; it carries no environment) with the **production** pull key `aicc_cp_prod_offhost` installed by `install-offhost-access.sh --env production --confirm-production` (replaces the staging key) | restricted forced command: identity / status / get / ack only |
| Mac side | key `~/.ssh/aicc_cp_prod_offhost`, directory `~/aicc-offhost-backups-production` (0700, FileVault disk), pinned host key `~/.ssh/known_hosts_aicc_prod_cp` (`StrictHostKeyChecking=yes`), LaunchAgent `com.aicc.offhost-pull.production` | `pull-offhost.sh --env production --stage-ip <IPV4> --expect-id <id>`; `macos/install-launchd.sh --env production ... --apply` |
| Ack file | `/srv/aicc/backups/offhost-ack.json`, **absent** until the first production pull | the AICC Ops `offhost_stale` rule warns only after 48 h of uptime AND a successful backup with no ack, then at 36 h / 96 h of staleness |
| AICC Ops rules | `backup_failed`, `backup_stale` (3 h WARN / 12 h CRIT), `offhost_stale` (36 h / 96 h), label `aicc-cp-prod (production)` | `infra/aicc-ops/config/aicc-ops.production.toml` |
| Restore tool | `aicc-restore <action> --production` (every action) and, for `live`, `--confirm-production-restore` | a restore typed without the flag is refused on the production host and a flagged restore is refused on a staging host; archives from another environment are refused (`host_identity` check) |
| Release metadata | every release keeps its manifest (tarball sha256, source commit, target); `pointers.txt` inside each files archive lists the live and previous release ids and their hashes; the deployment log continues in `/var/lib/aicc/deployments.jsonl` with a `promoted_to_production` boundary record | the code is not in the backup: it is rebuilt from the tagged commits or taken from `~/aicc-releases` on the Mac |
| Retention | host: all sets of the last 24 h, then the newest of each UTC day up to 7 days, never fewer than 3 (about 30 sets); Mac: 24 h hourly, 14 daily, 8 weekly | unchanged |
| Plugin release store | `/srv/aicc/shared/plugin-releases` (`AICC_LM_PLUGIN_RELEASE_DIR`, root:aicc-cp 0750; immutable release ZIPs + manifests + the `current` pointer) is **included** in the files archive (about 1 MB per release) and restored only when the archive carries it; it is outside every web root and not readable by Caddy's group | decided 2026-10-23: re-publishing is possible but a rebuild is only byte-identical if the toolchain is |
| Public exposure | **none**: no backup, dump, archive, status or ack file is reachable through Caddy (the static root is `/srv/aicc/site/current`, the PHP docroot `/srv/aicc/cp/current`; `/srv/aicc/backups` is in neither); the only network path to the files is the restricted SSH account; `production-edge-check.sh` also asserts that `/package.json`, `/.env`, `/wp-config.php`, `/wp-content/debug.log` and friends are not served | verified by the edge check and the listener audit, not by an external scan of every possible path |

### Rehearsal of the production-mode chain (isolated target, measured 2026-10-22)

`infra/backup/rehearse-production-dr.sh --shape-dump <real dump> --report ...` runs on the Mac against a throwaway MySQL and a temp host tree, with the production identity and names: empty production database + accounts (0.11 s) -> two hourly-cadence backups (0.95 s and 1.09 s each; dump + files archive + restore smoke + `status.json`) -> `pull-offhost.sh --env production` through a stub ssh into the production directory (0.91 s; checksum-verified, ack written) -> the AICC Ops backups collector on the result reports `backup.status_ok 1`, `restore_check_ok 1`, `offhost_verified 1`, `offhost_reason 0` -> `aicc-restore verify --production` of the off-host dump and a scratch load fingerprinted against the source (**0 differing lines over 58 tables**, 2.48 s) -> disaster (database dropped, uploads and wp-config deleted) and recovery **from the off-host copy** with the documented manual procedure: DB 0.39 s, files 0.04 s, strict per-table fingerprint **0 differing lines**, 13 of 13 uploaded files byte-identical, **isolated RTO 2.26 s** (Mac, 3.5 MB database). Evidence: `~/Downloads/AICC-launch-evidence/infra/dr-rehearsal-production-mode.json`. The schema is the real 58-table staging schema; the data is staging test data and is labelled so in the report.
On the **real host's hardware**, read-only (the live database untouched): `aicc-restore scratch` of the newest real dump (65 KB, 58 tables) took **9.07 s** end to end (load + fingerprint), the live database list before and after identical. This is not an RTO: it is the cost of the host-side load and checksum of the current staging-sized database. The full-chain timed figure remains `dr-drill-3.json` (staging mode, 60.4 s). `dr-drill.sh --env production ...` exists for a destructive production-mode drill and refuses unless the database holds no customer and no order.

### What the off-host copy really is, and what you lose (the honest part)

The off-host mechanism is **the owner's Mac pulling once an hour**. It runs only while the Mac is awake, online, logged in (LaunchAgents do not run after a logout or at a FileVault pre-login screen) and has not been closed. Measured over 26.5 hours (27 acknowledged pulls, 0 failures): the largest gap between acknowledged pulls was **3 h 44 min** (02:06 to 05:51 UTC, Mac asleep), then 2 h 45 min; the host keeps hourly sets, so **the off-host copy was at most about 4.7 hours behind the data on the host** in that window. A weekend away is days.

| Scenario | What survives | What you lose |
|---|---|---|
| Database corrupted or a bad release, Droplet alive | the hourly sets on the host (24 h of hourly, 7 days of daily) | up to 1 hour (no point-in-time recovery: `disable_log_bin`) |
| Droplet destroyed / disk lost / account locked, Mac copy current | the Mac's tiered copies and the release artifacts in `~/aicc-releases` | everything written since the last acknowledged pull: **usually under an hour, observed worst case 4.7 h, weekend or travel: days** |
| Droplet destroyed AND the Mac lost or its disk dead | nothing | everything. Secrets that live only on the host (DB passwords, salts) are regenerable; the owner-held ones (entitlement webhook secret, activation-proof key, SMTP key, Telegram token) are in the owner's password manager and are **not** in any backup |
| Mac off for more than 36 h | the host's own sets | the data is protected only by the host's disk; AICC Ops raises `offhost_stale` WARNING at 36 h, CRITICAL at 96 h (a weekend trip trips the first: raise `warn_h` knowingly, `alerting.md` 1a) |

Whole-Droplet loss is **documented, not timed**: new Droplet from the same cloud-init -> `install-stack.sh` -> push bundle -> first CP release -> `promote-to-production.sh apply` (it produces the production identity, an empty database and the configuration) -> `aicc-restore live --production --confirm-production-restore --allow-new-host-id` with the **Mac copy and its out-of-band hashes** -> re-render `wp-config.php` (the archive carries the OLD database password; the new database account has a new one) -> redeploy the release tarballs (`pointers.txt` names them) -> point the Reserved IP at the new Droplet (the IP is a DigitalOcean resource, the DNS record does not change) -> Caddy re-issues the certificates (rate limits apply). Caddy's storage is not in the backup.

### Free second-copy options (evaluated, none enabled, nothing signed up)

DigitalOcean Droplet backups and snapshots are **paid and are not enabled**. Free options that would remove the "Mac asleep" window, with their caveats (provider terms and limits change: re-verify before relying on any; **UNVERIFIED here**):
1. **A second always-on machine the owner already owns** (home server, a Raspberry Pi, an office PC) running the same restricted pull (`pull-offhost.sh` + its own key in `authorized_keys` with the same forced command). Best option if it exists: same security model, no new account.
2. **Client-side-encrypted copy to a personal free cloud tier** pushed from the Mac after each verified pull (for example `rclone` with its `crypt` remote to a free-tier object store or drive). It copes with a dead Mac disk, **not** with a sleeping Mac (it runs on the Mac), and it needs a provider account (some require a card on file).
3. **The host pushing out** (to a free object store) would give 24/7 copies but puts a write-capable credential on the host that a compromised host could use to delete the copies; the pull-only model deliberately avoids that. Not recommended unless the credential is append-only/versioned (a provider feature to verify).
4. **Using a Git hosting service as a blob store** (even a private repository): against the spirit of the service terms for large or frequent binaries and awkward to prune; not recommended.
Until one of these exists, the honest statement for the owner is: **the off-host copy is as available as your Mac**.


## Encrypted off-host copies (F-05, security review B; 2026-10-23)

Two decisions, both about what rests on the owner's Mac:

1. **The rendered `wp-config.php` is no longer archived** (above). It is re-rendered on restore from `/etc/aicc/secrets` + the template (`aicc-render-wp-config`, installed by `install-stack.sh`; `aicc-restore live` has a `wpconfig` step that runs it when the file is missing, the DR drill deletes the file and proves it comes back). Consequence for a whole-Droplet rebuild: the DB password and salts are regenerated by `create-staging-db.sh` / the renderer (nothing to restore), the two owner-held secrets (entitlement webhook, activation proof) are re-entered with `promote-to-production.sh set-owner-secret`. They are in the owner's password manager, never in a backup.
2. **The Mac keeps only ciphertext.** `pull-offhost.sh --encrypt-to <recipient certificate.pem>` verifies each file as before (checksums, `gzip -t`), encrypts it with CMS (AES-256, RSA >= 3072) to the owner's recipient certificate, stores `<name>.cms` and deletes the plaintext temp file. **`--env production` requires `--encrypt-to`** (so does the production LaunchAgent installer). The certificate is a PUBLIC key; the pull refuses a file that also contains a private key. Whoever copies the Mac's backup folder (theft, Time Machine, iCloud, a mis-set `--dest`) gets ciphertext. Why on the Mac and not on the host: the host's own copies stay plaintext on its disk (same trust as the live database), the transport is SSH, and verification/ack keep working on plaintext hashes; the host never holds a decryption key either way. What it does NOT protect against: malware on the Mac during the minutes a file is being pulled (the plaintext exists in a 0600 temp file in the 0700 destination until it is encrypted).

**Key handling (owner gate; no new paid service).**
```bash
# on a machine that is NOT the pulling Mac (or on the Mac, then MOVE the private key away at once and delete this copy):
openssl req -x509 -newkey rsa:4096 -nodes -keyout aicc-backup-recipient.key -out aicc-backup-recipient.crt -subj "/CN=aicc-backup-recipient" -days 3650
# 1. store aicc-backup-recipient.key in the password manager AND on an offline medium (USB stick in a drawer); 2. delete the file from the generating machine;
# 3. copy ONLY the .crt to the Mac:  install -m 644 aicc-backup-recipient.crt ~/.config/aicc/backup-recipient.crt
infra/backup/macos/install-launchd.sh --env production --stage-ip <IPV4> --expect-id <id> --encrypt-to $HOME/.config/aicc/backup-recipient.crt --apply
# restore / drill (the private key is fetched for the minutes it takes, then deleted again):
infra/backup/decrypt-offhost.sh --key /path/to/aicc-backup-recipient.key --in ~/aicc-offhost-backups-production/aicc_cp-<ts>-<label>.sql.gz.cms --out /tmp/dump.sql.gz
```
Losing the private key makes the Mac's copies unreadable (the host's own hourly sets are unaffected): keep two copies of it. Rotating: make a new key pair, point the agent at the new certificate; older ciphertext needs the old key, so keep it. The certificate must expire in more than a day (the pull refuses otherwise). `dr-drill.sh` takes `--encrypt-to` and `--decrypt-key` (required together; mandatory in production). An unreadable-at-rest copy that has never been decrypted is a hope, not a backup: run `decrypt-offhost.sh` once after the first pull and compare the hash it checks.
