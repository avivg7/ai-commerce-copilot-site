# Backup, restore and off-host copy (Control Plane staging host; same design for production)

## What exists

| Piece | Where | Runs | Purpose |
|---|---|---|---|
| `aicc-backup.sh` (installed as `/usr/local/sbin/aicc-backup`) | host | `aicc-backup.timer` daily 03:30 UTC (+ up to 2 min jitter, `Persistent=true`), and `--label pre-release` before every Control Plane release | DB dump + files archive + restore smoke + `status.json` |
| `aicc-restore-test.sh` (`aicc-restore-test`) | host | by hand, after any change to the backup, and as a drill | restores a dump into a throwaway database and runs sanity SQL |
| `pull-offhost.sh` | **the owner's Mac** | by hand or launchd/cron the owner sets up | pulls the latest dump + archive over SSH, verifies checksums, keeps 14 |
| `lib/backup-common.sh` | host (next to the scripts) | sourced | shared functions, fixture guard |

Files in `/srv/aicc/backups` (directory `0751 root:root`, so AICC Ops can open `status.json` by name but cannot list it; every dump and archive is `0600 root`):

* `aicc_cp-<UTC>-<label>.sql.gz` + `.sha256` : `mysqldump --single-transaction --quick --routines --triggers --events --no-tablespaces`, through the MySQL unix socket, account `aicc_backup` (SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES on `aicc_cp`; `SHOW_ROUTINE` global; ALL only on `aicc_restore_check`). Credentials live in `/etc/aicc/backup.cnf` (`0600 root`), never on a command line.
* `aicc-files-<UTC>-<label>.tar.gz` + `.sha256` : **separate `0600` archive** of `shared/uploads`, `shared/wp-config.php` (secrets: this is why it is separate from the DB dump), `/etc/aicc-edge` and `pointers.txt` (which release `current`/`previous` pointed to). Caddy's certificate storage is deliberately not included: certificates are re-issuable and their private keys stay on the host (`aicc-caddy-storage-backup` exists for a deliberate encrypted copy).
* `status.json` : schema documented at the top of `aicc-backup.sh`. Top-level `"status": "ok|failed"` (what AICC Ops' backup collector parses), `last_success` (survives a later failure; used by the release gate), per-file sha256 and sizes, `restore_check`, `disk_free_pct`.
* `restore-test.json` : result of the last restore test. `backup.log` : the job's log (no secrets).

Checks before a run is called ok: single instance (lock), `>= 15%` free disk (otherwise exit 4, status failed, nothing written), `gzip -t` on both archives, dump ends with `-- Dump completed`, tar listing, and (not with `--quick`) the **restore smoke**: the dump is loaded into `aicc_restore_check`, table counts must equal the source and the `*_options` table must have rows, then the database is dropped (also on failure). The smoke strips `DEFINER=` clauses because the backup account must not hold `SET_ANY_DEFINER`; a real restore as root keeps them.

Retention: files older than 7 days are deleted **only after a successful run** and **never one of the newest three sets**, so a streak of failures cannot empty the directory.

## RPO and RTO (stated, not promised)

* **RPO (data you can lose): up to 24 hours** with the daily timer (a missed run executes after boot). **Hourly option:** `systemctl edit aicc-backup.timer` and add `OnCalendar=` (reset) then `OnCalendar=hourly`; a dump of a store this size takes seconds; the restore smoke can be skipped for the hourly runs by adding `--quick` to a copy of the service. Binary logging is OFF, so there is no point-in-time recovery: the last dump is the recovery point.
* **RTO (time to be back):** **not yet measured.** A restore of the database on the same host has been exercised only against disposable databases (this repository's tests, and the rehearsal fixture). A full disaster-recovery drill (new Droplet, install, restore, deploy) has **not** been run. Do not quote a number until it has: the first drill on the real host should time each step in the runbook and replace this paragraph. Expect minutes for the restore itself and the better part of an hour for rebuilding a host, but that is an estimate, not a measurement.

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

Files: `tar -xzpf aicc-files-<ts>-<label>.tar.gz -C /` restores uploads, `wp-config.php` and `/etc/aicc-edge` to their paths (check ownership afterwards: `chown -R aicc-cp:aicc-edge /srv/aicc/shared/uploads`, `chown root:aicc-cp /srv/aicc/shared/wp-config.php`). The code is not in the backup: it comes from the release tarballs (`pointers.txt` says which release was live).

## Off-host copy (runs on the Mac)

`infra/backup/pull-offhost.sh --stage-ip <IPV4>` pulls `last_success` from `status.json`, verifies the sha256 sidecar, the hash recorded in `status.json` and `gzip -t`, keeps the newest 14 sets in `~/aicc-offhost-backups-stage` (`0700`, files `0600`). It is a **pull** (modelled on the proven API-host pull in the Backend repo, `docs/digitalocean-infrastructure.md` section 14): the server holds no credentials for the Mac, so a compromised server cannot delete the Mac's copies. It refuses a host that is not given on the command line, `139.59.157.231`, any hostname that is not `stage*.copilt.org`, and the production key; it uses only `~/.ssh/aicc_cp_stage` and verifies the host's `/etc/aicc-stage-identity` first.

* The files archive contains `wp-config.php` (database password, salts, staging-only plugin secrets): keep the folder on FileVault-encrypted storage. `--no-files-archive` pulls the database dump only.
* Scheduling is the owner's choice (launchd/cron); nothing is installed on the Mac by these scripts.
* An off-host copy that is never restored is a hope, not a backup: run `gzip -dc <dump> | mysql` into a scratch database on the Mac at least once and record it here.

## What is proven and what is not

Proven by `infra:test` (no server needed): the scripts work against the rehearsal fixture database and against a throwaway MySQL server with the real `aicc_backup` account and its exact grants (including triggers, routines, events, views), corrupt/truncated/mismatched dumps are rejected, the lock, retention, disk guard and fixture guard behave, `status.json` has the fields AICC Ops and the release gate read, and the off-host pull verifies checksums and refuses wrong hosts/keys. **Not proven until run on the real host:** the same on Ubuntu with MySQL 8.0 (tests ran on MySQL 8.4), the systemd timer firing, `SHOW_ROUTINE` sufficing on 8.0 for `--routines`, a full disaster-recovery drill, and the RTO.
