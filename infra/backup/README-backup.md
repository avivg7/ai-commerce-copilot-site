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
* `aicc-files-<UTC>-<label>.tar.gz` + `.sha256` : **separate `0600` archive** of `shared/uploads`, `shared/wp-config.php` (secrets: this is why it is separate from the DB dump), `/etc/aicc-edge`, `/etc/aicc-ops/aicc-ops.toml` (thresholds and host label; its `secrets.env` is deliberately NOT included) and `pointers.txt` (which release `current`/`previous` pointed to, every release manifest's tarball hash and source commit, and the host identity line). Caddy's certificate storage is deliberately not included: certificates are re-issuable and their private keys stay on the host (`aicc-caddy-storage-backup` exists for a deliberate encrypted copy).
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

Files: `tar -xzpf aicc-files-<ts>-<label>.tar.gz -C / --exclude=pointers.txt` (use `aicc-restore live` instead whenever possible) restores uploads, `wp-config.php` and `/etc/aicc-edge` to their paths (check ownership afterwards: `chown -R aicc-cp:aicc-edge /srv/aicc/shared/uploads`, `chown root:aicc-cp /srv/aicc/shared/wp-config.php`). The code is not in the backup: it comes from the release tarballs (`pointers.txt` says which release was live).

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
