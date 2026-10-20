#!/usr/bin/env bash
# AICC edge preflight: refuse to start (or reload) the edge when the environment or a file it depends on is missing or unsafe.
#
#   scripts/ops/edge-preflight.sh [--caddyfile FILE] [--env-file FILE] [--caddy BIN] [--no-validate] [--quiet]
#
# Why this exists (architecture review F6, reproduced with the real Caddy): Caddy itself does NOT refuse an empty or unset AICC_OPERATOR_CIDRS (every operator rule then denies
# everyone: a silent staff lockout), nor an unset or empty AICC_STATIC_ROOT (every page is a 404), nor an unset AICC_WP_UPSTREAM (every WordPress route is a branded 502).
# `caddy validate` says "Valid configuration" in all of those cases. This script is the check that fails. Call it from systemd (ExecStartPre, docs/cutover/caddy-edge.service.template)
# and from anything that starts the edge by hand; the rehearsal runner (scripts/rehearsal/edge.mjs) calls it before every start and reload.
#
# Reads the variables from the environment, or from --env-file (KEY=VALUE lines, the same file systemd's EnvironmentFile reads; quotes around the value are removed).
# Checks, each failure printed as "PREFLIGHT FAIL: ..." (all failures are listed, then exit 1):
#   AICC_STATIC_ROOT      directory (a symlink to one is fine), readable, containing index.html, 404.html and 50x.html
#   AICC_WP_UPSTREAM      host:port or http(s)://host:port, port 1-65535
#   AICC_OPERATOR_CIDRS   non-empty; every item a valid IPv4/IPv6 address or CIDR; NOT a match-everything range (/0, 0.0.0.0, ::) unless AICC_ALLOW_OPEN_OPERATOR=1
#   TLS                   a manual `tls <cert> <key>` line in the Caddyfile: both files readable, key not group/world readable, certificate not expired (warns under 21 days),
#                         SANs cover www.copilt.org and copilt.org, key matches the certificate. Otherwise (Caddy-managed ACME) AICC_ACME_EMAIL must be a plausible address,
#                         unless the file uses `local_certs` (rehearsal).
#   AICC_LOG_DIR          (default /var/log/caddy) exists and is writable by the user running this script
#   admin API             an `admin <address>` in the Caddyfile must be loopback or a unix socket (never 0.0.0.0 / a LAN address); `admin off` is fine
#   caddy validate        last, unless --no-validate
# Exit codes: 0 all good (warnings allowed), 1 at least one failure, 2 usage error.
set -u

CADDYFILE=""; ENVFILE=""; CADDY="${CADDY_BIN:-caddy}"; VALIDATE=1; QUIET=0
while [ $# -gt 0 ]; do
	case "$1" in
		--caddyfile) CADDYFILE="$2"; shift 2 ;;
		--env-file) ENVFILE="$2"; shift 2 ;;
		--caddy) CADDY="$2"; shift 2 ;;
		--no-validate) VALIDATE=0; shift ;;
		--quiet) QUIET=1; shift ;;
		-h|--help) sed -n 2,26p "$0"; exit 0 ;;
		*) echo "usage: $0 [--caddyfile FILE] [--env-file FILE] [--caddy BIN] [--no-validate] [--quiet]" >&2; exit 2 ;;
	esac
done

if [ -n "$ENVFILE" ]; then
	[ -r "$ENVFILE" ] || { echo "PREFLIGHT FAIL: env file $ENVFILE is not readable" >&2; exit 1; }
	while IFS= read -r line || [ -n "$line" ]; do
		case "$line" in ''|'#'*) continue ;; esac
		key="${line%%=*}"; val="${line#*=}"
		val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
		case "$key" in AICC_*|CADDY_BIN) export "$key=$val" ;; esac
	done < "$ENVFILE"
fi

FAILS=0; WARNS=0
fail() { echo "PREFLIGHT FAIL: $*" >&2; FAILS=$((FAILS + 1)); }
warn() { echo "PREFLIGHT WARN: $*" >&2; WARNS=$((WARNS + 1)); }
note() { [ "$QUIET" = 1 ] || echo "preflight ok: $*"; }

# ---- static root ----------------------------------------------------------------------------------------------------------------
ROOT="${AICC_STATIC_ROOT:-}"
if [ -z "$ROOT" ]; then fail "AICC_STATIC_ROOT is empty or unset (Caddy would start and answer 404 for every page)"
elif [ ! -d "$ROOT" ]; then fail "AICC_STATIC_ROOT=$ROOT is not a directory (or a dangling symlink)"
elif [ ! -r "$ROOT" ]; then fail "AICC_STATIC_ROOT=$ROOT is not readable by $(id -un)"
else
	for f in index.html 404.html 50x.html; do
		[ -s "$ROOT/$f" ] || fail "AICC_STATIC_ROOT=$ROOT has no $f (the release must contain the export's pages and docs/cutover/50x.html)"
	done
	[ "$FAILS" = 0 ] && note "static root $ROOT ($(cd "$ROOT" && pwd -P))"
fi

# ---- upstream -------------------------------------------------------------------------------------------------------------------
UP="${AICC_WP_UPSTREAM:-}"
if [ -z "$UP" ]; then fail "AICC_WP_UPSTREAM is empty or unset (every WordPress route would answer the branded 502)"
else
	hp="${UP#http://}"; hp="${hp#https://}"; hp="${hp%%/*}"
	port="${hp##*:}"
	if [ "$hp" = "$port" ] || ! [[ "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
		fail "AICC_WP_UPSTREAM=$UP must be host:port or http(s)://host:port with a port from 1 to 65535"
	elif [ -z "${hp%:*}" ]; then fail "AICC_WP_UPSTREAM=$UP has no host"
	else
		note "upstream $UP"
		h="${hp%:*}"
		case "$h" in 127.*|localhost|'[::1]'|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*|*.internal|*.local) ;; *) warn "AICC_WP_UPSTREAM host $h is not loopback/private: the upstream must not be reachable from the internet (scripts/ops/upstream-exposure-check.sh)" ;; esac
	fi
fi

# ---- operator CIDRs -------------------------------------------------------------------------------------------------------------
valid_v4() { # addr[/prefix]
	local a="${1%%/*}" p=""; [[ "$1" == */* ]] && p="${1#*/}"
	[[ "$a" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
	local o; for o in "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}"; do [ "$((10#$o))" -le 255 ] || return 1; done
	if [ -n "$p" ]; then [[ "$p" =~ ^[0-9]{1,2}$ ]] && [ "$((10#$p))" -le 32 ] || return 1; fi
	return 0
}
valid_v6() {
	local a="${1%%/*}" p=""; [[ "$1" == */* ]] && p="${1#*/}"
	[[ "$a" == *:* ]] || return 1
	[[ "$a" =~ ^[0-9a-fA-F:.]+$ ]] || return 1
	[[ "$a" != *:::* ]] || return 1
	local colons="${a//[^:]/}"; { [ "${#colons}" -ge 2 ] && [ "${#colons}" -le 7 ]; } || return 1
	[[ "$a" == *::*::* ]] && return 1
	if [ -n "$p" ]; then [[ "$p" =~ ^[0-9]{1,3}$ ]] && [ "$((10#$p))" -le 128 ] || return 1; fi
	return 0
}
OPS="${AICC_OPERATOR_CIDRS:-}"
if [ -z "${OPS// /}" ]; then fail "AICC_OPERATOR_CIDRS is empty or unset (Caddy would start and deny /wp-admin/, staff /wp-login.php and /wp-cron.php to everybody, staff included)"
else
	n=0
	for item in $OPS; do
		n=$((n + 1))
		if valid_v4 "$item" || valid_v6 "$item"; then
			pfx=""; [[ "$item" == */* ]] && pfx="${item#*/}"
			case "$item" in 0.0.0.0|0.0.0.0/*|::|::/*|::0|::0/*) bad=1 ;; *) bad=0 ;; esac
			[ "$pfx" = "0" ] && bad=1
			if [ "$bad" = 1 ] && [ "${AICC_ALLOW_OPEN_OPERATOR:-}" != "1" ]; then fail "AICC_OPERATOR_CIDRS item $item matches every address: that makes /wp-admin/ public (set AICC_ALLOW_OPEN_OPERATOR=1 only if that is really intended)"; fi
		else fail "AICC_OPERATOR_CIDRS item '$item' is not an IPv4/IPv6 address or CIDR"; fi
	done
	[ "$n" -gt 0 ] && note "operator list: $n item(s)"
fi

# ---- TLS --------------------------------------------------------------------------------------------------------------------------
codeonly() { grep -v '^[[:space:]]*#' "$1"; }
MANUAL=""
if [ -n "$CADDYFILE" ]; then
	if [ ! -r "$CADDYFILE" ]; then fail "Caddyfile $CADDYFILE is not readable"
	else
		MANUAL="$(codeonly "$CADDYFILE" | awk '$1=="tls" && $2!="internal" && $2!="{" && NF>=3 {print $2" "$3; exit}')"
		LOCAL="$(codeonly "$CADDYFILE" | grep -c '^[[:space:]]*local_certs[[:space:]]*$')"
		if [ -n "$MANUAL" ]; then
			cert="${MANUAL% *}"; key="${MANUAL#* }"
			if [ ! -r "$cert" ]; then fail "TLS certificate file $cert is not readable (Option A: put the pre-issued fullchain there)"
			elif [ ! -r "$key" ]; then fail "TLS key file $key is not readable by $(id -un)"
			else
				mode="$(stat -c '%a' "$key" 2>/dev/null || stat -f '%Lp' "$key" 2>/dev/null)"
				[ "${mode: -2}" = "00" ] || fail "TLS key $key has mode $mode: it must not be group/world accessible (chmod 600)"
				if ! openssl x509 -in "$cert" -noout 2>/dev/null; then fail "$cert is not a PEM certificate"
				else
					openssl x509 -in "$cert" -noout -checkend 0 >/dev/null 2>&1 || fail "TLS certificate $cert has EXPIRED ($(openssl x509 -in "$cert" -noout -enddate))"
					if ! openssl x509 -in "$cert" -noout -checkend $((21 * 86400)) >/dev/null 2>&1; then warn "TLS certificate $cert expires within 21 days ($(openssl x509 -in "$cert" -noout -enddate)); renew it and reload"; fi
					san="$(openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null)"
					for name in www.copilt.org copilt.org; do echo "$san" | grep -Eq "DNS:${name//./\\.}([,[:space:]]|$)" || fail "TLS certificate $cert has no SAN DNS:$name"; done
					a="$(openssl x509 -in "$cert" -noout -pubkey 2>/dev/null | openssl pkey -pubin -outform der 2>/dev/null | openssl dgst -sha256 2>/dev/null)"
					b="$(openssl pkey -in "$key" -pubout -outform der 2>/dev/null | openssl dgst -sha256 2>/dev/null)"
					[ -n "$a" ] && [ "$a" = "$b" ] || fail "TLS key $key does not belong to certificate $cert"
					note "manual certificate $cert (key $key)"
				fi
			fi
		elif [ "$LOCAL" -gt 0 ]; then note "local_certs (rehearsal): no ACME e-mail needed"
		else
			em="${AICC_ACME_EMAIL:-}"
			if [[ "$em" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then note "ACME contact $em"
			else fail "AICC_ACME_EMAIL is empty or not an e-mail address (the Caddyfile's 'email' line needs it; or use manual certificates: tls <cert> <key> in aicc_tls)"; fi
		fi
		# admin API must stay on loopback or a socket
		adm="$(codeonly "$CADDYFILE" | awk '$1=="admin" && NF>=2 {print $2; exit}')"
		# {$VAR:default} / {$VAR}: resolve like Caddy does (environment first, then the default)
		if [[ "$adm" =~ ^\{\$([A-Za-z_][A-Za-z0-9_]*)(:(.*))?\}$ ]]; then v="${BASH_REMATCH[1]}"; d="${BASH_REMATCH[3]}"; adm="${!v:-$d}"; fi
		if [ -z "$adm" ]; then warn "no 'admin' address in the Caddyfile: Caddy's default is localhost:2019 (the API's Caddy on the same host uses it too: give the edge its own, e.g. admin 127.0.0.1:12019)"
		else
			case "$adm" in off|localhost:*|127.*:*|'[::1]':*|unix/*) note "admin API $adm" ;; *) fail "admin API address '$adm' is not loopback/unix: the admin API can reconfigure the whole edge without authentication" ;; esac
		fi
	fi
fi

# ---- log dir -----------------------------------------------------------------------------------------------------------------------
LD="${AICC_LOG_DIR:-/var/log/caddy}"
if [ ! -d "$LD" ]; then fail "AICC_LOG_DIR=$LD does not exist (Caddy exits when it cannot open its log files)"
elif ! ( t="$LD/.aicc-preflight.$$"; : > "$t" ) 2>/dev/null; then fail "AICC_LOG_DIR=$LD is not writable by $(id -un)"
else rm -f "$LD/.aicc-preflight.$$"; note "log dir $LD writable"; fi

if [ -n "${AICC_WP_TIMEOUT:-}" ] && ! [[ "$AICC_WP_TIMEOUT" =~ ^[0-9]+(ms|s|m)$ ]]; then fail "AICC_WP_TIMEOUT=$AICC_WP_TIMEOUT is not a duration like 60s"; fi

# ---- caddy validate (last) ------------------------------------------------------------------------------------------------------------
if [ "$VALIDATE" = 1 ] && [ -n "$CADDYFILE" ] && [ "$FAILS" = 0 ]; then
	if ! command -v "$CADDY" >/dev/null 2>&1 && [ ! -x "$CADDY" ]; then fail "caddy binary '$CADDY' not found"
	else
		out="$("$CADDY" validate --config "$CADDYFILE" --adapter caddyfile 2>&1)"; rc=$?
		if [ $rc -ne 0 ]; then fail "caddy validate failed: $(echo "$out" | grep -v '"level":"info"' | tail -3 | tr '\n' ' ')"; else note "caddy validate: valid"; fi
	fi
fi

if [ "$FAILS" -gt 0 ]; then echo "PREFLIGHT: $FAILS failure(s), $WARNS warning(s): NOT starting" >&2; exit 1; fi
[ "$QUIET" = 1 ] || echo "PREFLIGHT: ok ($WARNS warning(s))"
exit 0
