#!/usr/bin/env bash
# Shared functions for aicc-backup.sh and aicc-restore-test.sh (sourced). Self-contained on purpose: installed to /usr/local/lib/aicc/backup/.
# No secrets are handled here: database credentials live ONLY in the 0600 option file given by --mysql-defaults-file (never on a command line).

b_ts()   { date -u +%Y-%m-%dT%H:%M:%SZ; }
b_log()  { printf '%s  %s\n' "$(b_ts)" "$*" | tee -a "${BACKUP_LOG:-/dev/null}" >&2; }
b_die()  { b_log "FATAL $*"; exit "${2:-1}"; }
iso_from_epoch() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }
sha256_file() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }
file_size() { stat -c '%s' "$1" 2>/dev/null || stat -f '%z' "$1"; }
file_mtime() { stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1"; }

# free_pct <path>: percentage of free space on the filesystem holding <path> (matches what df reports as 100-use%)
free_pct() { df -Pk "$1" | awk 'NR==2{ if ($3+$4 > 0) printf "%d", ($4*100)/($3+$4); else print 0 }'; }

# Directory lock that works on Linux and macOS (flock is not on macOS). Stale locks (dead pid) are taken over.
acquire_lock() { # acquire_lock <lockdir>
  local d="$1" pid
  if mkdir "$d" 2>/dev/null; then echo $$ > "$d/pid"; return 0; fi
  pid="$(cat "$d/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then return 1; fi
  b_log "taking over stale lock of pid ${pid:-?}"
  rm -rf "$d"; mkdir "$d" 2>/dev/null && echo $$ > "$d/pid"
}
release_lock() { rm -rf "$1" 2>/dev/null || true; }

# mysql client wrappers: the option file MUST be the first argument. Socket comes from that file ([client] socket=).
MYSQL_BIN="${MYSQL_BIN:-mysql}"; MYSQLDUMP_BIN="${MYSQLDUMP_BIN:-mysqldump}"
my() { "$MYSQL_BIN" --defaults-extra-file="$MY_CNF" --batch --skip-column-names "$@"; }

# Fixture guard (fail closed): in --fixture-test mode every database name MUST start with aicc_rehearsal, the option file must live under the
# rehearsal home or a temp dir, and nothing else is accepted. Outside fixture mode the production names are the only ones allowed.
guard_names() { # guard_names <fixture:0|1> <db> <restore-db>
  local fx="$1" db="$2" rdb="$3"
  [[ "$db" =~ ^[A-Za-z0-9_]+$ && "$rdb" =~ ^[A-Za-z0-9_]+$ ]] || b_die "database names may contain only letters, digits and underscore"
  [ "$db" != "$rdb" ] || b_die "the restore-check database must differ from the source database"
  if [ "$fx" = 1 ]; then
    case "$db" in aicc_rehearsal*) ;; *) b_die "FIXTURE GUARD: database '$db' does not start with aicc_rehearsal: refusing" ;; esac
    case "$rdb" in aicc_rehearsal*) ;; *) b_die "FIXTURE GUARD: restore database '$rdb' does not start with aicc_rehearsal: refusing" ;; esac
  else
    [ "$rdb" = "aicc_restore_check" ] || b_die "restore-check database must be exactly aicc_restore_check"
    case "$db" in aicc_rehearsal*) b_die "aicc_rehearsal* databases are fixture-only: use --fixture-test" ;; esac
    [[ "$db" =~ ^aicc_[a-z0-9_]+$ ]] || b_die "source database name must match ^aicc_[a-z0-9_]+\$"
  fi
}

# sanity SQL on a restored database: table count, and the WordPress options table has rows when it exists. Prints "tables=N options_rows=M".
sanity_sql() { # sanity_sql <db>  -> sets SAN_TABLES SAN_OPTIONS ; returns 1 on failure
  local rdb="$1" opt
  SAN_TABLES="$(my -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${rdb}'")" || return 1
  [ "${SAN_TABLES:-0}" -ge 1 ] || return 1
  opt="$(my -e "SELECT table_name FROM information_schema.tables WHERE table_schema='${rdb}' AND table_name LIKE '%\\_options' ORDER BY LENGTH(table_name) LIMIT 1")" || return 1
  SAN_OPTIONS="n/a"
  if [ -n "$opt" ]; then
    SAN_OPTIONS="$(my -e "SELECT COUNT(*) FROM \`${rdb}\`.\`${opt}\`")" || return 1
    [ "${SAN_OPTIONS:-0}" -ge 1 ] || return 1
  fi
  return 0
}

# restore_into <dump.sql.gz> <restore-db>: drop+create the throwaway DB, load the dump, run sanity SQL; the caller drops the DB afterwards.
restore_into() {
  local dump="$1" rdb="$2"
  my -e "DROP DATABASE IF EXISTS \`${rdb}\`; CREATE DATABASE \`${rdb}\` CHARACTER SET utf8mb4"
  # The smoke check runs as the unprivileged backup account, which (deliberately) lacks SET_ANY_DEFINER/SUPER: that privilege would let it create objects
  # owned by ANY account (including root) in the throwaway database and then run them. So DEFINER=`user`@`host` clauses are removed for this check only
  # (a real restore by root keeps them). LC_ALL=C: dumps may contain bytes that are not valid UTF-8.
  gzip -dc "$dump" | LC_ALL=C sed -e 's/DEFINER=`[^`]*`@`[^`]*`//g' | "$MYSQL_BIN" --defaults-extra-file="$MY_CNF" --database="$rdb"
}
drop_db() { my -e "DROP DATABASE IF EXISTS \`$1\`" >/dev/null 2>&1 || true; }
