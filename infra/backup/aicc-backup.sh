#!/usr/bin/env bash
# AICC Control Plane backup (staging host now, production later). Installed as /usr/local/sbin/aicc-backup, run by aicc-backup.timer (HOURLY at :17 UTC) and
# by deploy tooling before a release (--label pre-release).
#
#   sudo aicc-backup [--label scheduled|pre-release|manual] [--quick] [--dry-run]
#
# What one run produces, in /srv/aicc/backups (dir 0751 root, files 0600 root, status.json 0644):
#   aicc_cp-<UTC>-<label>.sql.gz         mysqldump --single-transaction --routines --triggers --events --no-tablespaces, via the unix socket, account aicc_backup
#   aicc_cp-<UTC>-<label>.sql.gz.sha256  "<hash>  <file>" (sha256sum -c compatible)
#   aicc-files-<UTC>-<label>.tar.gz      WordPress persistent files in a SEPARATE 0600 archive: shared/uploads, shared/wp-config.php (secrets!), /etc/aicc-edge, /etc/aicc-ops/aicc-ops.toml (not its secrets.env),
#                                        and pointers.txt (what site/cp current+previous pointed to). Caddy's certificate storage is NOT included (re-issuable,
#                                        private keys stay on the host; use aicc-caddy-storage-backup for a deliberate encrypted copy).
#   aicc-files-<UTC>-<label>.tar.gz.sha256
#   status.json                          for AICC Ops stale-backup alerts and for the release gate (see schema below)
# Checks before anything is called "ok": gzip -t on both archives, the dump ends with "-- Dump completed", tar listing works, and (unless --quick) a RESTORE SMOKE:
# the dump is loaded into the throwaway database aicc_restore_check, sanity SQL runs, the database is dropped again.
# Safety: single instance (lock), refuses when the backup filesystem has < 15% free, partial files carry a .partial suffix until verified, nothing secret is ever printed.
# Retention (tiered, so an hourly timer does not keep 168 full copies): every set of the last 24 h, then the newest set of each UTC day up to RETENTION_DAYS (7), and never
# fewer than the newest 3 sets. Pruning runs after a successful run AND, when the disk guard would refuse, once before the guard (a full disk must not stay full forever).
#
# RPO: the timer is HOURLY (minute 17 UTC; a missed run executes after boot: Persistent=true), so the on-host RPO is about 1 hour.
# RTO: measured by infra/backup/dr-drill.sh on the real host (see the drill section of README-backup.md for the figure and what it does and does not cover).
#
# status.json schema (schema 1):
#   {"schema":1,"status":"ok|failed","label":"...","started_at":"...","finished_at":"...","finished_epoch":N,"duration_s":N,"reason":"",
#    "disk_free_pct":N,"retention_days":7,"host":"...",
#    "db_dump":{"file":"...","bytes":N,"sha256":"...","gzip_test":"ok","complete_marker":"ok","restore_check":"ok|skipped|skipped_empty_database|failed","tables":N,"options_rows":N},
#    "files_archive":{"file":"...","bytes":N,"sha256":"...","gzip_test":"ok","paths":[...]},
#    "last_success":{"finished_at":"...","finished_epoch":N,"label":"...","db_dump_file":"...","files_archive_file":"..."}}
#   "last_success" survives a later failure; the release gate (activate-release.sh) uses it, AICC Ops alerts on "status" and on its age.
# Exit codes: 0 ok, 1 failed, 2 usage, 3 another run holds the lock (a SCHEDULED run that finds the lock held exits 0: the other run is doing the job), 4 disk guard.
#
# Test/fixture flags (all explicit; defaults are the host layout): --backup-dir --shared-dir --edge-conf-dir --release-root --mysql-defaults-file --db --restore-db
#   --fixture-test   fail-closed: both database names must start with aicc_rehearsal; runs without root; never touches anything outside --backup-dir except reading.
set -euo pipefail
umask 077

self="${BASH_SOURCE[0]}"; while [ -L "$self" ]; do d="$(cd "$(dirname "$self")" && pwd)"; self="$(readlink "$self")"; case "$self" in /*) ;; *) self="$d/$self";; esac; done
LIBDIR="$(cd "$(dirname "$self")" && pwd)/lib"
# shellcheck source=lib/backup-common.sh
. "$LIBDIR/backup-common.sh"

LABEL="scheduled"; QUICK=0; DRY=0; FIXTURE=0
BACKUP_DIR="/srv/aicc/backups"; SHARED_DIR="/srv/aicc/shared"; EDGE_CONF="/etc/aicc-edge"; RELEASE_ROOT="/srv/aicc"
MY_CNF="/etc/aicc/backup.cnf"; DB="aicc_cp"; RESTORE_DB="aicc_restore_check"; RETENTION_DAYS=7; MIN_FREE_PCT=15; KEEP_MIN_SETS=3
usage() { sed -n 2,40p "$self"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="${2:-}"; shift 2 ;;
    --quick) QUICK=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --fixture-test) FIXTURE=1; shift ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --shared-dir) SHARED_DIR="$2"; shift 2 ;;
    --edge-conf-dir) EDGE_CONF="$2"; shift 2 ;;
    --release-root) RELEASE_ROOT="$2"; shift 2 ;;
    --mysql-defaults-file) MY_CNF="$2"; shift 2 ;;
    --db) DB="$2"; shift 2 ;;
    --restore-db) RESTORE_DB="$2"; shift 2 ;;
    --retention-days) RETENTION_DAYS="$2"; shift 2 ;;
    --min-free-pct) MIN_FREE_PCT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done
case "$LABEL" in scheduled|pre-release|manual) ;; *) echo "--label must be scheduled, pre-release or manual" >&2; exit 2 ;; esac
[[ "$MIN_FREE_PCT" =~ ^[0-9]+$ ]] || { echo "--min-free-pct must be a number" >&2; exit 2; }
[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && [ "$RETENTION_DAYS" -ge 1 ] || { echo "--retention-days must be a positive integer" >&2; exit 2; }
for p in "$BACKUP_DIR" "$SHARED_DIR" "$EDGE_CONF" "$RELEASE_ROOT" "$MY_CNF"; do [[ "$p" == /* ]] || { echo "paths must be absolute: $p" >&2; exit 2; }; done

if [ "$FIXTURE" = 0 ] && [ "$(id -u)" != "0" ] && [ "${AICC_TEST_HARNESS:-0}" != "1" ]; then echo "must run as root (sudo). Refusing." >&2; exit 2; fi
guard_names "$FIXTURE" "$DB" "$RESTORE_DB"
if [ "$FIXTURE" = 1 ]; then
  # the option file for a fixture run must be a file the caller wrote for it (mode 0600 and not world-readable)
  case "$MY_CNF" in "$HOME"/aicc-rehearsal/*|/private/tmp/*|/tmp/*|/var/folders/*|/private/var/folders/*) ;; *) b_die "FIXTURE GUARD: option file $MY_CNF is outside the rehearsal home / temp dirs" 2 ;; esac
fi
[ -f "$MY_CNF" ] || { echo "option file $MY_CNF missing (create-staging-db.sh writes it)" >&2; exit 2; }
mode="$(stat -c '%a' "$MY_CNF" 2>/dev/null || stat -f '%Lp' "$MY_CNF")"
case "$mode" in 600|400) ;; *) echo "option file $MY_CNF must be mode 0600 (is $mode). Refusing." >&2; exit 2 ;; esac

if [ "$DRY" = 1 ]; then
  echo "DRY-RUN: would back up database $DB (restore smoke into $RESTORE_DB: $([ $QUICK = 1 ] && echo skipped || echo yes)),"
  echo "         files archive of $SHARED_DIR/uploads, $SHARED_DIR/wp-config.php, $EDGE_CONF, pointers under $RELEASE_ROOT,"
  echo "         into $BACKUP_DIR (label $LABEL), retention ${RETENTION_DAYS} days, disk guard ${MIN_FREE_PCT}%, status $BACKUP_DIR/status.json"
  exit 0
fi

mkdir -p "$BACKUP_DIR"; chmod 0751 "$BACKUP_DIR" 2>/dev/null || true
BACKUP_LOG="$BACKUP_DIR/backup.log"; : >> "$BACKUP_LOG"; chmod 600 "$BACKUP_LOG"
LOCKDIR="$BACKUP_DIR/.lock"
STARTED_EPOCH="$(date -u +%s)"; STARTED_AT="$(iso_from_epoch "$STARTED_EPOCH")"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="aicc_cp-${STAMP}-${LABEL}.sql.gz"; FILES="aicc-files-${STAMP}-${LABEL}.tar.gz"
[ "$DB" = "aicc_cp" ] || DUMP="${DB}-${STAMP}-${LABEL}.sql.gz"
STATUS="$BACKUP_DIR/status.json"
REASON=""; RESTORE_RESULT="skipped"; TABLES=0; OPTROWS=0; DUMP_BYTES=0; DUMP_SHA=""; FILES_BYTES=0; FILES_SHA=""; FILE_PATHS=()
HAVE_LOCK=0; RESULT="failed"

write_status() { # write_status ok|failed
  local st="$1" now fin prev_ls dumpobj filesobj ls
  now="$(date -u +%s)"; fin="$(iso_from_epoch "$now")"
  prev_ls="null"
  if [ -f "$STATUS" ] && command -v jq >/dev/null 2>&1; then prev_ls="$(jq -c '.last_success // null' "$STATUS" 2>/dev/null || echo null)"; fi
  [ -n "$prev_ls" ] || prev_ls="null"
  ls="$prev_ls"
  if [ "$st" = ok ]; then
    ls="$(jq -n -c --arg fa "$fin" --argjson fe "$now" --arg l "$LABEL" --arg d "$DUMP" --arg f "$FILES" '{finished_at:$fa,finished_epoch:$fe,label:$l,db_dump_file:$d,files_archive_file:$f}')"
  fi
  dumpobj="null"; filesobj="null"
  if [ "$st" = ok ] || [ -n "$DUMP_SHA" ]; then
    dumpobj="$(jq -n -c --arg f "$DUMP" --argjson b "${DUMP_BYTES:-0}" --arg s "$DUMP_SHA" --arg rc "$RESTORE_RESULT" --argjson t "${TABLES:-0}" --argjson o "${OPTROWS:-0}" \
      '{file:$f,bytes:$b,sha256:$s,gzip_test:"ok",complete_marker:"ok",restore_check:$rc,tables:$t,options_rows:$o}')"
  fi
  if [ -n "$FILES_SHA" ]; then
    filesobj="$(jq -n -c --arg f "$FILES" --argjson b "${FILES_BYTES:-0}" --arg s "$FILES_SHA" --argjson p "$(printf '%s\n' "${FILE_PATHS[@]:-}" | jq -R . | jq -s -c 'map(select(length>0))')" \
      '{file:$f,bytes:$b,sha256:$s,gzip_test:"ok",paths:$p}')"
  fi
  jq -n -c --arg st "$st" --arg l "$LABEL" --arg sa "$STARTED_AT" --arg fa "$fin" --argjson fe "$now" --argjson dur "$((now - STARTED_EPOCH))" --arg r "$REASON" \
     --argjson df "$(free_pct "$BACKUP_DIR")" --argjson rd "$RETENTION_DAYS" --arg h "$(hostname | tr -cd 'A-Za-z0-9.-')" \
     --argjson dump "$dumpobj" --argjson files "$filesobj" --argjson ls "$ls" \
     '{schema:1,status:$st,label:$l,started_at:$sa,finished_at:$fa,finished_epoch:$fe,duration_s:$dur,reason:$r,disk_free_pct:$df,retention_days:$rd,host:$h,db_dump:$dump,files_archive:$files,last_success:$ls}' \
     > "$STATUS.new"
  chmod 644 "$STATUS.new"; mv -f "$STATUS.new" "$STATUS"
}

cleanup() {
  local rc=$?
  rm -f "$BACKUP_DIR"/*.partial 2>/dev/null || true
  if [ "$HAVE_LOCK" = 1 ]; then
    # the throwaway database never outlives a run
    drop_db "$RESTORE_DB"
    if [ "$RESULT" != ok ]; then
      [ -n "$REASON" ] || REASON="aborted (exit $rc)"
      write_status failed || true
      b_log "FAILED: $REASON"
    fi
    release_lock "$LOCKDIR"
  fi
  exit "$rc"
}
trap cleanup EXIT

command -v jq >/dev/null 2>&1 || b_die "jq is required (installed by cloud-init)" 1
command -v gzip >/dev/null 2>&1 || b_die "gzip missing" 1
if ! acquire_lock "$LOCKDIR"; then b_log "another backup is running (lock $LOCKDIR): exiting"; trap - EXIT; [ "$LABEL" = scheduled ] && exit 0; exit 3; fi
HAVE_LOCK=1

# Retention (tiered): only files this script creates; keep every set of the last 24 h, the newest set of each UTC day older than that up to RETENTION_DAYS, and never
# fewer than the newest KEEP_MIN_SETS. The timestamp in the file name (UTC) decides, not the mtime.
prune() { # prune <glob-pattern>
  local pat="$1" f base ts day now cutoff_day cutoff_h n=0 seen_days="" idx=0
  now="$(date -u +%s)"; cutoff_h=$((now - 86400)); cutoff_day=$((now - RETENTION_DAYS * 86400))
  # newest first by NAME (the UTC stamp sorts chronologically)
  # shellcheck disable=SC2012
  for f in $(ls -1 "$BACKUP_DIR"/$pat 2>/dev/null | sort -r); do
    idx=$((idx + 1)); base="$(basename "$f")"
    ts="$(printf '%s' "$base" | sed -n 's/.*-\([0-9]\{8\}\)T\([0-9]\{6\}\)Z-.*/\1\2/p')"
    [ -n "$ts" ] || continue
    ep="$(date -u -d "${ts:0:8} ${ts:8:2}:${ts:10:2}:${ts:12:2}" +%s 2>/dev/null || date -u -j -f '%Y%m%d%H%M%S' "$ts" +%s 2>/dev/null || echo 0)"
    [ "$ep" -gt 0 ] || continue
    [ "$idx" -le "$KEEP_MIN_SETS" ] && continue                      # the newest sets are never touched
    if [ "$ep" -ge "$cutoff_h" ]; then continue; fi                   # last 24 h: keep all
    day="${ts:0:8}"
    if [ "$ep" -lt "$cutoff_day" ]; then rm -f -- "$f" "$f.sha256"; n=$((n + 1)); b_log "pruned $base (older than ${RETENTION_DAYS} days)"; continue; fi
    case " $seen_days " in *" $day "*) rm -f -- "$f" "$f.sha256"; n=$((n + 1)); b_log "pruned $base (not the newest of $day)" ;; *) seen_days="$seen_days $day" ;; esac
  done
  return 0
}
prune_all() { prune "${DB}-*.sql.gz"; prune "aicc-files-*.tar.gz"; }

# ---- disk guard ------------------------------------------------------------------------------------------------------------------------------
FREE="$(free_pct "$BACKUP_DIR")"
if [ "$FREE" -lt "$MIN_FREE_PCT" ]; then
  # a full disk must not stay full for ever: retention normally runs only after a success, so apply it once before giving up
  b_log "disk guard: ${FREE}% free (< ${MIN_FREE_PCT}%): applying retention before refusing"
  prune_all; FREE="$(free_pct "$BACKUP_DIR")"
fi
if [ "$FREE" -lt "$MIN_FREE_PCT" ]; then REASON="disk guard: only ${FREE}% free on the backup filesystem (< ${MIN_FREE_PCT}%)"; b_log "$REASON"; exit 4; fi
b_log "backup start: label=$LABEL db=$DB free=${FREE}% quick=$QUICK"

# ---- 1. database dump ---------------------------------------------------------------------------------------------------------------------
"$MYSQL_BIN" --defaults-extra-file="$MY_CNF" -e "SELECT 1" >/dev/null 2>&1 || { REASON="cannot connect to MySQL with $MY_CNF"; exit 1; }
if ! "$MYSQLDUMP_BIN" --defaults-extra-file="$MY_CNF" --single-transaction --quick --routines --triggers --events --no-tablespaces \
      --set-gtid-purged=OFF --default-character-set=utf8mb4 "$DB" 2> "$BACKUP_DIR/.dump.err" | gzip -c > "$BACKUP_DIR/$DUMP.partial"; then
  REASON="mysqldump failed: $(tr -d '\r' < "$BACKUP_DIR/.dump.err" | grep -v -i 'password' | head -3 | tr '\n' ' ')"; rm -f "$BACKUP_DIR/.dump.err"; exit 1
fi
if [ -s "$BACKUP_DIR/.dump.err" ] && grep -qiE 'error|denied' "$BACKUP_DIR/.dump.err"; then REASON="mysqldump reported an error"; rm -f "$BACKUP_DIR/.dump.err"; exit 1; fi
rm -f "$BACKUP_DIR/.dump.err"
chmod 600 "$BACKUP_DIR/$DUMP.partial"
gzip -t "$BACKUP_DIR/$DUMP.partial" || { REASON="gzip -t failed on the dump"; exit 1; }
gzip -dc "$BACKUP_DIR/$DUMP.partial" | tail -n 1 | grep -q '^-- Dump completed' || { REASON="dump is incomplete (no '-- Dump completed' trailer)"; exit 1; }
DUMP_BYTES="$(file_size "$BACKUP_DIR/$DUMP.partial")"; [ "$DUMP_BYTES" -gt 200 ] || { REASON="dump is implausibly small ($DUMP_BYTES bytes)"; exit 1; }
DUMP_SHA="$(sha256_file "$BACKUP_DIR/$DUMP.partial")"
b_log "dump ok: $DUMP ($DUMP_BYTES bytes, sha256 ${DUMP_SHA:0:16}...)"

# ---- 2. restore smoke check (throwaway database) --------------------------------------------------------------------------------------------
src_tables="$(my -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB}'")"
if [ "$src_tables" = 0 ]; then
  # A brand-new database (before the very first Control Plane release installs WordPress) has no tables: there is nothing to restore-check. The dump itself is still
  # taken and verified, so the first deploy can pass the pre-release gate; status.json says so explicitly.
  RESTORE_RESULT="skipped_empty_database"; b_log "note: database $DB has no tables yet: restore smoke skipped (first deploy)"
elif [ "$QUICK" = 0 ]; then
  RESTORE_RESULT="failed"
  if restore_into "$BACKUP_DIR/$DUMP.partial" "$RESTORE_DB" && sanity_sql "$RESTORE_DB"; then
    TABLES="$SAN_TABLES"; OPTROWS="${SAN_OPTIONS/n\/a/0}"
    if [ "$TABLES" = "$src_tables" ]; then RESTORE_RESULT="ok"; else REASON="restore smoke: table count differs (source $src_tables, restored $TABLES)"; exit 1; fi
  else REASON="restore smoke check FAILED (the dump does not load or the sanity SQL failed)"; exit 1; fi
  drop_db "$RESTORE_DB"
  b_log "restore smoke ok: tables=$TABLES options_rows=$OPTROWS (database $RESTORE_DB dropped)"
fi
mv -f "$BACKUP_DIR/$DUMP.partial" "$BACKUP_DIR/$DUMP"
( cd "$BACKUP_DIR" && printf '%s  %s\n' "$DUMP_SHA" "$DUMP" > "$DUMP.sha256" ); chmod 600 "$BACKUP_DIR/$DUMP.sha256"

# ---- 3. files archive (separate, 0600) ------------------------------------------------------------------------------------------------------
PTR="$(mktemp -d "$BACKUP_DIR/.ptr.XXXXXX")"
{
  echo "# release pointers at $STARTED_AT (label $LABEL)"
  for k in site cp; do for l in current previous; do
    if [ -L "$RELEASE_ROOT/$k/$l" ]; then printf '%s/%s -> %s\n' "$k" "$l" "$(readlink "$RELEASE_ROOT/$k/$l")"; else printf '%s/%s -> (none)\n' "$k" "$l"; fi
  done; done
  # which releases exist and what they were built from (DR needs the release tarballs from the build host; this says WHICH ones and their hashes)
  for k in site cp; do
    for m in "$RELEASE_ROOT/$k"/releases/*.manifest.json; do
      [ -f "$m" ] || continue
      printf 'release %s %s tarball_sha256=%s cp_commit=%s\n' "$k" "$(basename "$m" .manifest.json)" "$(jq -r '.tarball.sha256 // "?"' "$m" 2>/dev/null)" "$(jq -r '.sources.cp_commit // .sources.site_commit // "-"' "$m" 2>/dev/null)"
    done
  done
  IDF=/etc/aicc-stage-identity; [ "${AICC_TEST_HARNESS:-0}" = "1" ] && IDF="${AICC_IDENTITY_FILE:-$IDF}"      # the seam exists only for infra/stack-tests and the production-mode rehearsal
  printf 'host_identity %s\n' "$(tr '\n' ' ' < "$IDF" 2>/dev/null | sed 's/ *$//')"
} > "$PTR/pointers.txt"
TAR_ITEMS=()
add_item() { # add_item <absolute path> : archived relative to /
  if [ -e "$1" ]; then TAR_ITEMS+=("${1#/}"); FILE_PATHS+=("$1"); else b_log "note: $1 does not exist (skipped)"; fi
}
add_item "$SHARED_DIR/uploads"; add_item "$SHARED_DIR/wp-config.php"; add_item "$EDGE_CONF"
# AICC Ops configuration (thresholds, host label); its secrets.env (Telegram) is deliberately NOT included
if [ "$FIXTURE" = 0 ]; then add_item /etc/aicc-ops/aicc-ops.toml; fi
if [ "$FIXTURE" = 0 ] && [ ! -f "$SHARED_DIR/wp-config.php" ]; then REASON="wp-config.php missing from $SHARED_DIR (a Control Plane without it cannot be restored)"; rm -rf "$PTR"; exit 1; fi
FILE_PATHS+=("pointers.txt")
if [ ${#TAR_ITEMS[@]} -gt 0 ]; then
  tar -czf "$BACKUP_DIR/$FILES.partial" -C / "${TAR_ITEMS[@]}" -C "$PTR" pointers.txt 2> "$BACKUP_DIR/.tar.err" || { REASON="tar failed: $(head -2 "$BACKUP_DIR/.tar.err" | tr '\n' ' ')"; rm -rf "$PTR" "$BACKUP_DIR/.tar.err"; exit 1; }
else
  tar -czf "$BACKUP_DIR/$FILES.partial" -C "$PTR" pointers.txt
fi
rm -rf "$PTR" "$BACKUP_DIR/.tar.err"
chmod 600 "$BACKUP_DIR/$FILES.partial"
gzip -t "$BACKUP_DIR/$FILES.partial" || { REASON="gzip -t failed on the files archive"; exit 1; }
tar -tzf "$BACKUP_DIR/$FILES.partial" >/dev/null || { REASON="tar listing of the files archive failed"; exit 1; }
FILES_BYTES="$(file_size "$BACKUP_DIR/$FILES.partial")"; FILES_SHA="$(sha256_file "$BACKUP_DIR/$FILES.partial")"
mv -f "$BACKUP_DIR/$FILES.partial" "$BACKUP_DIR/$FILES"
( cd "$BACKUP_DIR" && printf '%s  %s\n' "$FILES_SHA" "$FILES" > "$FILES.sha256" ); chmod 600 "$BACKUP_DIR/$FILES.sha256"
b_log "files archive ok: $FILES ($FILES_BYTES bytes)"

# ---- 4. status first (so a retention problem can never hide a good backup), then retention ----------------------------------------------------
RESULT=ok
write_status ok
b_log "status.json written: ok"
prune_all
b_log "backup finished: ok"
exit 0
