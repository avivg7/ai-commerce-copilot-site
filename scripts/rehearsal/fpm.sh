#!/usr/bin/env bash
#
# AICC edge rehearsal: a SEPARATE php-fpm process on a UNIX SOCKET in front of the rehearsal WordPress docroot (the Linux staging architecture: Caddy php_fastcgi -> PHP-FPM, no HTTP upstream).
#
#   scripts/rehearsal/fpm.sh start|stop|restart|status|conf
#
# Everything it writes lives under ~/aicc-rehearsal/scratch-fpm (config, pid, socket, logs). It READS the CP fixture docroot (~/aicc-rehearsal/cp/wp) and the fixture's
# prepend.php (the X-Rehearsal-Upstream owner marker); it does not change the fixture's files, database or its php -S server. Differences from Linux (be honest): macOS
# php-fpm from Local by Flywheel (PHP 8.2.29), run as the invoking user (no master/worker user split), no opcache tuning, no systemd, pm=static with a few children.
# Socket: ~/aicc-rehearsal/scratch-fpm/aicc-cp.sock, mode 0660 (production: /run/php/aicc-cp.sock, owner www-data, group = the edge's user, mode 0660).
set -uo pipefail
HOME_DIR="${AICC_REHEARSAL_HOME:-$HOME/aicc-rehearsal}"
BASE="$HOME_DIR/scratch-fpm"
CP="$HOME_DIR/cp"
SOCK="$BASE/aicc-cp.sock"
LOCAL_SERVICES="$HOME/Library/Application Support/Local/lightning-services"
FPM="${AICC_REHEARSAL_PHP_FPM:-$(ls "$LOCAL_SERVICES"/php-8.2.29+0/bin/*/sbin/php-fpm 2>/dev/null | head -1)}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EGRESS_GUARD="$REPO_DIR/scripts/rehearsal/egress-guard.php"   # WordPress HTTP API fail-closed (see that file); php-fpm also runs under the loopback-only sandbox profile on macOS
SANDBOX=()
if [ "${AICC_REHEARSAL_NO_SANDBOX:-}" != 1 ] && command -v sandbox-exec >/dev/null 2>&1; then SANDBOX=(sandbox-exec -f "$REPO_DIR/scripts/rehearsal/loopback-only.sb"); fi
die() { echo "ERROR: $*" >&2; exit 1; }
conf() {
	mkdir -p "$BASE/log" "$BASE/run"
	cat > "$BASE/php.ini" <<INI
; rehearsal php.ini for the scratch php-fpm (the Local php binary has no php.ini of its own)
memory_limit = 512M
expose_php = On
display_errors = 0
log_errors = 1
error_log = $BASE/log/php-error.log
cgi.fix_pathinfo = 0
max_execution_time = 60
upload_max_filesize = 64M
post_max_size = 64M
INI
	cat > "$BASE/php-fpm.conf" <<CONF
[global]
pid = $BASE/run/php-fpm.pid
error_log = $BASE/log/php-fpm.log
daemonize = yes
[aicc-cp]
listen = $SOCK
listen.mode = 0660
pm = static
pm.max_children = 8
pm.max_requests = 500
catch_workers_output = yes
clear_env = yes
php_admin_value[auto_prepend_file] = $EGRESS_GUARD
php_admin_value[error_log] = $BASE/log/php-error.log
access.log = $BASE/log/access.log
CONF
}
pid() { cat "$BASE/run/php-fpm.pid" 2>/dev/null; }
up() { local p; p="$(pid)"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null && [ -S "$SOCK" ]; }
case "${1:-}" in
	conf) conf; echo "$BASE/php-fpm.conf" ;;
	start)
		[ -x "$FPM" ] || die "php-fpm not found (set AICC_REHEARSAL_PHP_FPM)"
		[ -f "$CP/wp/wp-config.php" ] || die "the CP fixture docroot $CP/wp does not exist (cp-fixture.sh create)"
		up && { echo "php-fpm already up (pid $(pid)) on $SOCK"; exit 0; }
		conf; rm -f "$SOCK"
		${SANDBOX[@]+"${SANDBOX[@]}"} "$FPM" -y "$BASE/php-fpm.conf" -c "$BASE/php.ini" || die "php-fpm failed to start (see $BASE/log/php-fpm.log)"
		for _ in $(seq 1 30); do [ -S "$SOCK" ] && break; sleep 0.2; done
		up && echo "php-fpm up (pid $(pid)) on $SOCK" || die "php-fpm did not create $SOCK" ;;
	stop) p="$(pid)"; [ -n "$p" ] && kill -QUIT "$p" 2>/dev/null; for _ in $(seq 1 30); do up || break; sleep 0.2; done; rm -f "$SOCK"; echo "php-fpm stopped" ;;
	restart) "$0" stop; "$0" start ;;
	status) if up; then echo "php-fpm UP pid $(pid) socket $SOCK ($(stat -f '%Sp' "$SOCK"))"; else echo "php-fpm DOWN"; exit 1; fi ;;
	*) sed -n 3,6p "$0"; exit 2 ;;
esac
