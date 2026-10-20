#!/usr/bin/env bash
# Certificate expiry monitor for the AICC edge (cron / monitoring friendly).
#
#   scripts/ops/cert-expiry-check.sh --host www.copilt.org --host copilt.org            # real TLS handshake to host:443 (SNI = host)
#   scripts/ops/cert-expiry-check.sh --host www.copilt.org --connect 203.0.113.10:443   # same, but connect to a specific IP (staging edge before the DNS flip)
#   scripts/ops/cert-expiry-check.sh --file /etc/aicc-edge/certs/fullchain.pem          # a PEM file (Option A, before it is loaded)
# Options: --warn-days N (default 21)  --crit-days N (default 7)  --cacert FILE (verify against this CA; default: do not verify, only read the dates)  --quiet
# Output, one line per target: "OK|WARN|CRITICAL|UNKNOWN <target> notAfter=<date>".  Exit code is the worst of all targets:
#   0 all fine   1 WARN (expires in less than warn-days)   2 CRITICAL (less than crit-days, or already expired)   3 UNKNOWN (could not connect / parse)
# Why: Option A certificates (pre-issued with certbot --manual, renewed by hand every 60-90 days) expire silently, Caddy does not watch certificate files, and this plan does
# not rely on any e-mail from the CA (whether the CA still sends expiry notices is not verified). Run it from OUTSIDE the edge host (cron on another machine, or an uptime
# monitor that can run a command) so that it sees what clients see; alert on any non-zero exit. Needs only bash and openssl.
set -u
WARN=21; CRIT=7; QUIET=0; CACERT=""; TARGETS=(); CONNECT=""
while [ $# -gt 0 ]; do
	case "$1" in
		--host) TARGETS+=("host:$2"); shift 2 ;;
		--file) TARGETS+=("file:$2"); shift 2 ;;
		--connect) CONNECT="$2"; shift 2 ;;
		--warn-days) WARN="$2"; shift 2 ;;
		--crit-days) CRIT="$2"; shift 2 ;;
		--cacert) CACERT="$2"; shift 2 ;;
		--quiet) QUIET=1; shift ;;
		-h|--help) sed -n 2,14p "$0"; exit 0 ;;
		*) echo "usage: $0 (--host NAME | --file PEM)... [--connect IP:PORT] [--warn-days N] [--crit-days N] [--cacert FILE] [--quiet]" >&2; exit 3 ;;
	esac
done
[ ${#TARGETS[@]} -gt 0 ] || { echo "usage: $0 (--host NAME | --file PEM)..." >&2; exit 3; }
worst=0
TO=""; command -v timeout >/dev/null 2>&1 && TO="timeout 15"
bump() { [ "$1" -gt "$worst" ] && worst="$1"; }
for t in "${TARGETS[@]}"; do
	kind="${t%%:*}"; val="${t#*:}"; pem=""
	if [ "$kind" = file ]; then
		[ -r "$val" ] && pem="$(cat "$val")" || { echo "UNKNOWN $val cannot read file"; bump 3; continue; }
	else
		name="${val%%:*}"; hostport="${CONNECT:-$val}"; [[ "$hostport" == *:* ]] || hostport="$hostport:443"
		args=(-connect "$hostport" -servername "$name")
		[ -n "$CACERT" ] && args+=(-CAfile "$CACERT" -verify_return_error)
		pem="$(echo | $TO openssl s_client "${args[@]}" 2>/dev/null | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' | awk '/END CERTIFICATE/{print; exit} {print}')" 2>/dev/null
		[ -n "$pem" ] || { echo "UNKNOWN $val no certificate from $hostport (connection or verification failed)"; bump 3; continue; }
	fi
	na="$(echo "$pem" | openssl x509 -noout -enddate 2>/dev/null | sed 's/^notAfter=//')"
	[ -n "$na" ] || { echo "UNKNOWN $val cannot parse certificate"; bump 3; continue; }
	if ! echo "$pem" | openssl x509 -noout -checkend 0 >/dev/null 2>&1; then echo "CRITICAL $val notAfter=$na EXPIRED"; bump 2
	elif ! echo "$pem" | openssl x509 -noout -checkend $((CRIT * 86400)) >/dev/null 2>&1; then echo "CRITICAL $val notAfter=$na (< $CRIT days)"; bump 2
	elif ! echo "$pem" | openssl x509 -noout -checkend $((WARN * 86400)) >/dev/null 2>&1; then echo "WARN $val notAfter=$na (< $WARN days)"; bump 1
	else [ "$QUIET" = 1 ] || echo "OK $val notAfter=$na"; fi
done
exit "$worst"
