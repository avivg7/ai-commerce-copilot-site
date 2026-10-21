#!/usr/bin/env bash
# What is listening on this host, and is it exactly what the stage/production architecture allows? (run ON the host, as root or the service user; read-only)
#
#   scripts/ops/edge-listener-audit.sh [--operator-port 8443] [--admin-port 12019] [--allow PORT]... [--no-mysql-check]
#
# Allowed, and nothing else:
#   TCP  *:80 and *:443                      the public edge (Caddy)
#   TCP  127.0.0.1:<operator-port>           the SSH-tunnel operator listener (Caddy)         -> FAIL if it is bound to any other address
#   TCP  127.0.0.1:<admin-port>              Caddy's admin API + /metrics                      -> FAIL if it is bound to any other address
#   TCP  :22                                 sshd (a deployment may move it: --allow N)
#   UDP  nothing                             HTTP/3 is OFF: any UDP listener on 80/443 is a FAIL
#   no TCP listener for PHP-FPM (unix socket only), none for MySQL (socket only: 3306/33060 closed even on loopback), none for Redis/Memcached/the old php -S 18982 upstream.
# Exit codes: 0 all as expected, 1 at least one unexpected listener, 2 usage / no tool (needs ss or lsof).
set -u
OPP=8443; ADM=12019; ALLOW=(); MYSQLCHK=1
while [ $# -gt 0 ]; do
	case "$1" in
		--operator-port) OPP="$2"; shift 2 ;;
		--admin-port) ADM="$2"; shift 2 ;;
		--allow) ALLOW+=("$2"); shift 2 ;;
		--no-mysql-check) MYSQLCHK=0; shift ;;
		-h|--help) sed -n 2,15p "$0"; exit 0 ;;
		*) echo "usage: $0 [--operator-port N] [--admin-port N] [--allow PORT]... [--no-mysql-check]" >&2; exit 2 ;;
	esac
done
if command -v ss >/dev/null 2>&1; then
	TCP="$(ss -H -ltn 2>/dev/null | awk '{print $4}')"
	UDP="$(ss -H -lun 2>/dev/null | awk '{print $4}')"
elif command -v lsof >/dev/null 2>&1; then
	TCP="$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $9}')"
	UDP="$(lsof -nP -iUDP 2>/dev/null | awk 'NR>1{print $9}')"
else echo "need ss or lsof" >&2; exit 2; fi
FAILS=0
fail() { echo "FAIL: $*"; FAILS=$((FAILS + 1)); }
ok() { echo "ok:   $*"; }
isallowed() { local p="$1" a; for a in "${ALLOW[@]:-}"; do [ "$a" = "$p" ] && return 0; done; return 1; }
seen_op=0; seen_adm=0; seen_pub=0
while IFS= read -r l; do
	[ -n "$l" ] || continue
	addr="${l%:*}"; port="${l##*:}"
	addr="${addr#[}"; addr="${addr%]}"
	case "$addr" in '*'|0.0.0.0|::|'') wild=1 ;; *) wild=0 ;; esac
	case "$addr" in 127.*|::1) loop=1 ;; *) loop=0 ;; esac
	if [ "$port" = "$OPP" ]; then
		[ "$loop" = 1 ] && { seen_op=1; ok "operator listener $l is loopback-only"; } || fail "operator port $OPP is bound to $addr (must be 127.0.0.1 only)"
	elif [ "$port" = "$ADM" ]; then
		[ "$loop" = 1 ] && { seen_adm=1; ok "admin API $l is loopback-only"; } || fail "admin API port $ADM is bound to $addr (must be loopback only)"
	elif [ "$port" = 80 ] || [ "$port" = 443 ]; then
		[ "$wild" = 1 ] && { seen_pub=1; ok "public listener $l"; } || ok "public listener $l (bound to $addr)"
	elif [ "$port" = 22 ] || isallowed "$port"; then ok "$l (allowed: ssh / --allow)"
	elif [ "$port" = 3306 ] || [ "$port" = 33060 ]; then [ "$MYSQLCHK" = 1 ] && fail "MySQL listens on TCP $l (the architecture is socket-only)" || ok "$l (mysql check off)"
	elif [ "$port" = 9000 ] || [ "$port" = 9001 ]; then fail "PHP-FPM listens on TCP $l (the architecture is a unix socket)"
	elif [ "$port" = 6379 ] || [ "$port" = 11211 ]; then fail "cache service on TCP $l (not part of the architecture)"
	elif [ "$port" = 18982 ] || [ "$port" = 8080 ]; then fail "an HTTP upstream listens on $l (no HTTP upstream port may exist: php_fastcgi over a unix socket)"
	elif [ "$loop" = 1 ]; then echo "note: loopback listener $l (not part of the edge architecture; check it is yours)"
	else fail "unexpected non-loopback TCP listener $l"; fi
done <<< "$TCP"
[ "$seen_op" = 1 ] || fail "no operator listener on 127.0.0.1:$OPP (the SSH tunnel would have nothing to reach)"
[ "$seen_adm" = 1 ] || fail "no admin API on 127.0.0.1:$ADM"
[ "$seen_pub" = 1 ] || fail "no public listener on :443"
while IFS= read -r l; do
	[ -n "$l" ] || continue
	port="${l##*:}"
	case "$port" in 80|443) fail "UDP listener $l: HTTP/3 must be OFF" ;; esac
done <<< "$UDP"
echo "edge-listener-audit: $FAILS failure(s)"
[ "$FAILS" = 0 ]
