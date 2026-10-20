#!/usr/bin/env bash
# Creates the Control Plane database and its two MySQL accounts ON THE HOST, through the MySQL unix socket (root via auth_socket; no password used).
#     sudo infra/provision/create-staging-db.sh [--dry-run]
#   database          aicc_cp               utf8mb4
#   application user  aicc_cp@localhost     ALL PRIVILEGES on aicc_cp.* only (no global privileges, no GRANT OPTION)
#   backup user       aicc_backup@localhost SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES on aicc_cp.*; SHOW_ROUTINE (global, read-only definitions);
#                                           ALL on the throwaway database aicc_restore_check only (for the restore smoke test)
# Passwords: generated here with openssl (256 bit), written ONLY to 0600 root files, passed to MySQL on stdin (never on a command line, never echoed):
#   /etc/aicc/secrets/db-cp.pass   (application user)           /etc/aicc/backup.cnf  ([client] option file used by aicc-backup, mode 0600)
# Idempotent: existing secret files are reused (the SQL is CREATE ... IF NOT EXISTS + ALTER USER with the same password), so a re-run changes nothing.
# Rotation: delete the secret file, run this again, then run render-wp-config.sh (the web application gets the new password only through wp-config).
# Test seams (flags, all absolute paths): --socket --secrets-dir --backup-cnf --mysql-bin so tests can run against a throwaway mysqld.
set -euo pipefail
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF/lib/common.sh"
DB="aicc_cp"; APPUSER="aicc_cp"; BKUSER="aicc_backup"; RESTORE_DB="aicc_restore_check"
SOCKET="/run/mysqld/mysqld.sock"; SECRETS="/etc/aicc/secrets"; BKCNF="/etc/aicc/backup.cnf"; MYSQL="mysql"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) AICC_DRY_RUN=1; shift ;;
    --socket) SOCKET="$2"; shift 2 ;;
    --secrets-dir) SECRETS="$2"; shift 2 ;;
    --backup-cnf) BKCNF="$2"; shift 2 ;;
    --mysql-bin) MYSQL="$2"; shift 2 ;;
    --db) DB="$2"; shift 2 ;;
    -h|--help) sed -n 2,16p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ "$DB" =~ ^aicc_[a-z0-9_]{1,40}$ ]] || die "database name must match ^aicc_[a-z0-9_]+\$"
[ "$DB" != "$RESTORE_DB" ] || die "refusing: $RESTORE_DB is the throwaway restore-check database"
[[ "$SOCKET" == /* && "$SECRETS" == /* && "$BKCNF" == /* ]] || die "paths must be absolute"
if [ "${AICC_TEST_HARNESS:-0}" != "1" ] && [ "$(id -u)" != "0" ] && ! is_dry; then die "must run as root (sudo). Refusing."; fi
if is_dry; then
  would "create database $DB (utf8mb4), users $APPUSER and $BKUSER at localhost via $SOCKET"
  would "write $SECRETS/db-cp.pass (0600) and $BKCNF (0600) only if they do not exist; passwords never printed"
  exit 0
fi
[ -S "$SOCKET" ] || die "MySQL socket $SOCKET not found (is mysql running?)"
umask 077
mkdir -p "$SECRETS" "$(dirname "$BKCNF")"; chmod 700 "$SECRETS"
gen() { openssl rand -hex 24; }          # 48 hex chars: no quoting problems in SQL or option files
getpw() { # getpw <file> -> prints nothing; sets PW (creates the file when missing)
  if [ -s "$1" ]; then PW="$(cat "$1")"; return 0; fi
  PW="$(gen)"; ( umask 077; printf '%s' "$PW" > "$1" ); chmod 600 "$1"; info "created $1 (0600)"
}
APPPW_FILE="$SECRETS/db-cp.pass"
getpw "$APPPW_FILE"; APPPW="$PW"
BKPW_FILE="$SECRETS/db-backup.pass"
getpw "$BKPW_FILE"; BKPW="$PW"
[[ "$APPPW" =~ ^[0-9a-f]{48}$ && "$BKPW" =~ ^[0-9a-f]{48}$ ]] || die "secret file content is not what this script generates; remove it to rotate"
sql="$(cat <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci;
CREATE USER IF NOT EXISTS '$APPUSER'@'localhost' IDENTIFIED BY '$APPPW';
ALTER USER '$APPUSER'@'localhost' IDENTIFIED BY '$APPPW';
GRANT ALL PRIVILEGES ON \`$DB\`.* TO '$APPUSER'@'localhost';
CREATE USER IF NOT EXISTS '$BKUSER'@'localhost' IDENTIFIED BY '$BKPW';
ALTER USER '$BKUSER'@'localhost' IDENTIFIED BY '$BKPW';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES ON \`$DB\`.* TO '$BKUSER'@'localhost';
GRANT SHOW_ROUTINE ON *.* TO '$BKUSER'@'localhost';
GRANT ALL PRIVILEGES ON \`aicc\\_restore\\_check\`.* TO '$BKUSER'@'localhost';
FLUSH PRIVILEGES;
SQL
)"
# the SQL (with passwords) goes to mysql's stdin only
printf '%s\n' "$sql" | "$MYSQL" --protocol=socket --socket="$SOCKET" -uroot
unset sql APPPW BKPW PW
# option file for the backup job: [client] only, socket only
tmp="$(mktemp "$(dirname "$BKCNF")/.bk.XXXXXX")"
{ echo "[client]"; echo "user=$BKUSER"; printf 'password=%s\n' "$(cat "$BKPW_FILE")"; echo "socket=$SOCKET"; } > "$tmp"
chmod 600 "$tmp"; mv -f "$tmp" "$BKCNF"
info "database $DB ready; accounts $APPUSER and $BKUSER configured; $BKCNF written (0600)"
info "next: sudo infra/provision/render-wp-config.sh"
