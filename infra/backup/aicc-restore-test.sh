#!/usr/bin/env bash
# Restore test: load a backup dump into a DISPOSABLE database, run sanity SQL, drop the database again. Proves that a dump can actually be restored;
# it NEVER touches the live database. Installed as /usr/local/sbin/aicc-restore-test.
#
#   sudo aicc-restore-test                      latest dump in /srv/aicc/backups
#   sudo aicc-restore-test --file aicc_cp-20261021T033012Z-scheduled.sql.gz
#   sudo aicc-restore-test --dry-run
#
# Steps: (1) sha256 sidecar verified, (2) gzip -t, (3) "-- Dump completed" trailer present, (4) DROP/CREATE aicc_restore_check, load, (5) sanity SQL:
# table count >= 1 and (when a *_options table exists) it has rows, (6) database dropped (also on failure). Result is written to
# /srv/aicc/backups/restore-test.json (schema 1: status ok|failed, dump file, tables, options_rows, finished_at) so "a restore has been proven" is a recorded fact.
# Exit codes: 0 ok, 1 failed, 2 usage.
# Fixture flags (same guard as aicc-backup): --backup-dir --mysql-defaults-file --db --restore-db --fixture-test (database names must start with aicc_rehearsal).
set -euo pipefail
umask 077
self="${BASH_SOURCE[0]}"; while [ -L "$self" ]; do d="$(cd "$(dirname "$self")" && pwd)"; self="$(readlink "$self")"; case "$self" in /*) ;; *) self="$d/$self";; esac; done
# shellcheck source=lib/backup-common.sh
. "$(cd "$(dirname "$self")" && pwd)/lib/backup-common.sh"

BACKUP_DIR="/srv/aicc/backups"; MY_CNF="/etc/aicc/backup.cnf"; DB="aicc_cp"; RESTORE_DB="aicc_restore_check"; FILE=""; DRY=0; FIXTURE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --fixture-test) FIXTURE=1; shift ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --mysql-defaults-file) MY_CNF="$2"; shift 2 ;;
    --db) DB="$2"; shift 2 ;;
    --restore-db) RESTORE_DB="$2"; shift 2 ;;
    -h|--help) sed -n 2,16p "$self"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
for p in "$BACKUP_DIR" "$MY_CNF"; do [[ "$p" == /* ]] || { echo "paths must be absolute: $p" >&2; exit 2; }; done
if [ "$FIXTURE" = 0 ] && [ "$(id -u)" != "0" ] && [ "${AICC_TEST_HARNESS:-0}" != "1" ]; then echo "must run as root (sudo). Refusing." >&2; exit 2; fi
guard_names "$FIXTURE" "$DB" "$RESTORE_DB"
if [ "$FIXTURE" = 1 ]; then
  case "$MY_CNF" in "$HOME"/aicc-rehearsal/*|/private/tmp/*|/tmp/*|/var/folders/*|/private/var/folders/*) ;; *) b_die "FIXTURE GUARD: option file $MY_CNF is outside the rehearsal home / temp dirs" 2 ;; esac
fi
[ -f "$MY_CNF" ] || { echo "option file $MY_CNF missing" >&2; exit 2; }
BACKUP_LOG="$BACKUP_DIR/backup.log"
if [ -z "$FILE" ]; then
  # shellcheck disable=SC2012
  FILE="$(ls -1t "$BACKUP_DIR"/"${DB}"-*.sql.gz 2>/dev/null | head -1 || true)"
  [ -n "$FILE" ] || b_die "no dump found in $BACKUP_DIR" 1
else
  case "$FILE" in */*) ;; *) FILE="$BACKUP_DIR/$FILE" ;; esac
fi
[ -f "$FILE" ] || b_die "dump not found: $FILE" 1
if [ "$DRY" = 1 ]; then echo "DRY-RUN: would verify checksum and restore $FILE into $RESTORE_DB, run sanity SQL, drop $RESTORE_DB"; exit 0; fi

RESULT=failed; REASON=""; SAN_TABLES=0; SAN_OPTIONS=0
write_result() {
  command -v jq >/dev/null 2>&1 || return 0
  jq -n -c --arg st "$RESULT" --arg f "$(basename "$FILE")" --arg r "$REASON" --argjson t "${SAN_TABLES:-0}" --argjson o "$([[ "${SAN_OPTIONS:-0}" =~ ^[0-9]+$ ]] && echo "$SAN_OPTIONS" || echo 0)" --arg fa "$(b_ts)" \
    '{schema:1,status:$st,dump_file:$f,reason:$r,tables:$t,options_rows:$o,finished_at:$fa}' > "$BACKUP_DIR/restore-test.json.new" 2>/dev/null \
    && chmod 644 "$BACKUP_DIR/restore-test.json.new" && mv -f "$BACKUP_DIR/restore-test.json.new" "$BACKUP_DIR/restore-test.json" || true
}
# shellcheck disable=SC2154  # rc is assigned inside the trap string
trap 'rc=$?; drop_db "$RESTORE_DB"; [ "$RESULT" = ok ] || { [ -n "$REASON" ] || REASON="aborted (exit $rc)"; b_log "RESTORE TEST FAILED: $REASON"; }; write_result; exit $rc' EXIT

if [ -f "$FILE.sha256" ]; then
  want="$(awk '{print $1}' "$FILE.sha256")"; got="$(sha256_file "$FILE")"
  [ "$want" = "$got" ] || { REASON="sha256 mismatch for $(basename "$FILE")"; exit 1; }
  b_log "sha256 verified"
else REASON="no .sha256 sidecar for $(basename "$FILE")"; exit 1; fi
gzip -t "$FILE" || { REASON="gzip -t failed"; exit 1; }
gzip -dc "$FILE" | tail -n 1 | grep -q '^-- Dump completed' || { REASON="dump trailer missing"; exit 1; }
restore_into "$FILE" "$RESTORE_DB" || { REASON="dump did not load"; exit 1; }
sanity_sql "$RESTORE_DB" || { REASON="sanity SQL failed"; exit 1; }
RESULT=ok
b_log "RESTORE TEST OK: $(basename "$FILE") -> tables=$SAN_TABLES options_rows=$SAN_OPTIONS (database $RESTORE_DB dropped)"
exit 0
