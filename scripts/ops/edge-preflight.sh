#!/usr/bin/env bash
# AICC edge preflight: refuse to start (or reload) the edge when the environment, a file it depends on, or the rendered Caddyfile is missing or unsafe. FAIL CLOSED.
#
#   scripts/ops/edge-preflight.sh [--mode stage|production|rehearsal] [--caddyfile FILE] [--env-file FILE] [--caddy BIN] [--no-validate] [--quiet]
#
# Why this exists (architecture review F6, reproduced with the real Caddy): Caddy itself does NOT refuse an unset or empty AICC_STATIC_ROOT (every page is a 404), an unset socket or
# docroot (every WordPress route is a branded 502), nor a Caddyfile that listens where it must not. `caddy validate` says "Valid configuration" in all of those cases. This script is
# the check that fails. Call it from systemd (ExecStartPre / ExecReload, docs/cutover/caddy-edge.service.template) and from anything that starts the edge by hand; the rehearsal runner
# (scripts/rehearsal/edge.mjs) calls it with --mode rehearsal before every start and reload.
#
# Reads the variables from the environment, or from --env-file (KEY=VALUE lines, the same file systemd's EnvironmentFile reads; quotes around the value are removed).
# MODE: --mode or AICC_EDGE_MODE. Without either it is derived from the Caddyfile (local_certs -> rehearsal; the stage identity route -> stage; otherwise production) and a note says so.
#
# Checks, each failure printed as "PREFLIGHT FAIL: ..." (all failures are listed, then exit 1):
#   every mode   AICC_STATIC_ROOT   directory (a symlink to one is fine), readable, with index.html, 404.html and 50x.html
#                AICC_LOG_DIR       exists and is writable;  AICC_WP_TIMEOUT a duration
#                admin API          an explicit `admin <address>` that is loopback or a unix socket (never 0.0.0.0 / a LAN address)
#                HTTP/3 OFF         `protocols h1 h2` is present, no Alt-Svc value is set
#                metrics            enabled as a GLOBAL option, routed by no site/handle/snippet (the endpoint lives on the loopback admin API only)
#                operator listener  exactly one `bind`, and it is `bind 127.0.0.1`; every listener in `caddy adapt` is :80, :443 or 127.0.0.1:<port>
#                WordPress origin   fastcgi form: AICC_PHP_FPM_SOCKET is a unix socket path (never host:port), the socket exists and is writable; AICC_WP_ROOT is a WordPress docroot
#                                   reverse_proxy form (rehearsal only): AICC_WP_UPSTREAM host:port
#   stage        AICC_PUBLIC_HOST   a host name that is NOT a production name (www/apex/api.copilt.org, or any other *.copilt.org that does not start with stage)
#                AICC_STAGE_ID      16+ characters, and AICC_STAGE_HOST equals AICC_PUBLIC_HOST; the Caddyfile carries the identity route
#                certificates       automatic ACME only (no local_certs, no tls internal, no pre-issued files), AICC_ACME_EMAIL plausible, AICC_ACME_CA Let's Encrypt (staging = WARN)
#                operator CIDRs     AICC_OPERATOR_CIDRS must be EMPTY (no public allowlist; the SSH-tunnel listener is the only operator path)
#   production   as stage, but AICC_PUBLIC_HOST must be www.copilt.org, AICC_STAGE_ID must be unset, the Caddyfile must NOT carry the identity route, and AICC_ALLOW_PRODUCTION_MODE=1
#                is required (the production render is not activated by anything in this repo)
#   rehearsal    local_certs present, no public-CA configuration (acme_ca, email, issuers, DNS challenges), tls internal (or files under $HOME), optional CIDR list validated
# Overrides that exist on purpose and are printed when used: AICC_ALLOW_INTERNAL_TLS=1 (a stage/production CHECK build with tls internal), AICC_ALLOW_MANUAL_TLS=1 (Option A files),
#   AICC_ALLOW_OPERATOR_CIDRS=1, AICC_ALLOW_OPEN_OPERATOR=1, AICC_ALLOW_PRODUCTION_MODE=1, AICC_ALLOW_CUSTOM_ACME_CA=1.
# Exit codes: 0 all good (warnings allowed), 1 at least one failure, 2 usage error.
set -u

MODE="${AICC_EDGE_MODE:-}"; CADDYFILE=""; ENVFILE=""; CADDY="${CADDY_BIN:-caddy}"; VALIDATE=1; QUIET=0
while [ $# -gt 0 ]; do
	case "$1" in
		--mode) MODE="$2"; shift 2 ;;
		--caddyfile) CADDYFILE="$2"; shift 2 ;;
		--env-file) ENVFILE="$2"; shift 2 ;;
		--caddy) CADDY="$2"; shift 2 ;;
		--no-validate) VALIDATE=0; shift ;;
		--quiet) QUIET=1; shift ;;
		-h|--help) sed -n 2,40p "$0"; exit 0 ;;
		*) echo "usage: $0 [--mode stage|production|rehearsal] [--caddyfile FILE] [--env-file FILE] [--caddy BIN] [--no-validate] [--quiet]" >&2; exit 2 ;;
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
	[ -z "$MODE" ] && MODE="${AICC_EDGE_MODE:-}"
fi

FAILS=0; WARNS=0
fail() { echo "PREFLIGHT FAIL: $*" >&2; FAILS=$((FAILS + 1)); }
warn() { echo "PREFLIGHT WARN: $*" >&2; WARNS=$((WARNS + 1)); }
note() { [ "$QUIET" = 1 ] || echo "preflight ok: $*"; }
override() { echo "PREFLIGHT NOTE: $1 is set: $2" >&2; }
codeonly() { grep -v '^[[:space:]]*#' "$1"; }

# ---- the Caddyfile text (code lines only) and the mode -------------------------------------------------------------------------------
CODE=""
if [ -n "$CADDYFILE" ]; then
	if [ ! -r "$CADDYFILE" ]; then fail "Caddyfile $CADDYFILE is not readable"; else CODE="$(codeonly "$CADDYFILE")"; fi
fi
if [ -z "$MODE" ]; then
	if [ -n "$CODE" ]; then
		if printf '%s\n' "$CODE" | grep -q '^[[:space:]]*local_certs[[:space:]]*$'; then MODE=rehearsal
		elif printf '%s\n' "$CODE" | grep -q 'aicc-stage-identity'; then MODE=stage
		else MODE=production; fi
		[ "$QUIET" = 1 ] || echo "preflight note: no --mode / AICC_EDGE_MODE given; derived '$MODE' from the Caddyfile (say it explicitly in the unit)"
	else MODE=stage; fi
fi
case "$MODE" in stage|production|rehearsal) ;; *) echo "PREFLIGHT FAIL: --mode must be stage, production or rehearsal (got '$MODE')" >&2; exit 2 ;; esac
note "mode $MODE"

has() { printf '%s\n' "$CODE" | grep -Eq "$1"; }

# ---- production mode is not activated by anything in this repo ------------------------------------------------------------------------
if [ "$MODE" = production ] && [ "${AICC_ALLOW_PRODUCTION_MODE:-}" != "1" ]; then
	fail "mode production is refused: the production render is NOT activated by the staging work (set AICC_ALLOW_PRODUCTION_MODE=1 on cutover day only; it would request public certificates for www.copilt.org and copilt.org)"
fi
[ "${AICC_ALLOW_PRODUCTION_MODE:-}" = "1" ] && override AICC_ALLOW_PRODUCTION_MODE "the production render may start"

# ---- public host / identity ------------------------------------------------------------------------------------------------------------
PRODNAMES_RE='^(www\.|api\.)?copilt\.org$'
valid_host() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]]; }
if [ "$MODE" = stage ] || [ "$MODE" = production ]; then
	H="${AICC_PUBLIC_HOST:-}"
	if [ -z "$H" ]; then fail "AICC_PUBLIC_HOST is empty or unset (the site address would be empty)"
	elif ! valid_host "$H"; then fail "AICC_PUBLIC_HOST='$H' is not a valid host name"
	elif [ "$MODE" = stage ]; then
		if [[ "$H" =~ $PRODNAMES_RE ]]; then fail "AICC_PUBLIC_HOST=$H is a PRODUCTION name: a stage edge must never request a certificate for it"
		elif [[ "$H" == *.copilt.org ]] && [[ "$H" != stage*.copilt.org ]]; then fail "AICC_PUBLIC_HOST=$H is under the production domain but is not a stage* name"
		else note "public host $H (stage)"; fi
	else
		[ "$H" = "www.copilt.org" ] && note "public host $H (production)" || fail "AICC_PUBLIC_HOST=$H: the production render serves www.copilt.org"
	fi
	if [ "$MODE" = stage ]; then
		SID="${AICC_STAGE_ID:-}"
		if [ -z "$SID" ]; then fail "AICC_STAGE_ID is empty or unset (the identity route would answer with an empty id; the test tooling could not prove which server it talks to)"
		elif ! [[ "$SID" =~ ^[A-Za-z0-9_-]{16,}$ ]]; then fail "AICC_STAGE_ID must be 16 or more characters of [A-Za-z0-9_-] (a random id)"
		else note "stage id set (${#SID} chars)"; fi
		[ "${AICC_STAGE_HOST:-}" = "$H" ] || fail "AICC_STAGE_HOST='${AICC_STAGE_HOST:-}' must equal AICC_PUBLIC_HOST ($H): the identity route reports it"
		[ -n "$CODE" ] && ! has 'X-Robots-Tag[[:space:]]+"noindex' && fail "the stage Caddyfile does not send X-Robots-Tag noindex (the staging host must never be indexed)"
		[ -n "$CODE" ] && ! has 'aicc-stage-identity' && fail "the stage Caddyfile has no identity route (/.well-known/aicc-stage-identity): render it with scripts/ops/render-edge.mjs --mode stage"
	else
		[ -z "${AICC_STAGE_ID:-}" ] || fail "AICC_STAGE_ID is set in production mode (the production build never carries a stage identity)"
		[ -n "$CODE" ] && has 'aicc-stage-identity' && fail "the production Caddyfile contains the stage identity route"
	fi
fi

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

# ---- the WordPress origin: php_fastcgi (unix socket + docroot) or, rehearsal only, reverse_proxy ---------------------------------------
PROXY_FORM=0
if [ -n "$CODE" ] && printf '%s\n' "$CODE" | awk '/^\(wp_proxy\) \{/{f=1;next} f&&/^\}/{exit} f&&/import wp_proxy_http/{found=1} END{exit !found}'; then PROXY_FORM=1; fi
if [ "$PROXY_FORM" = 1 ]; then
	[ "$MODE" = rehearsal ] || fail "the Caddyfile selects the reverse_proxy WordPress origin; stage and production use php_fastcgi over a unix socket (no HTTP upstream port)"
	UP="${AICC_WP_UPSTREAM:-}"
	if [ -z "$UP" ]; then fail "AICC_WP_UPSTREAM is empty or unset (every WordPress route would answer the branded 502)"
	else
		hp="${UP#http://}"; hp="${hp#https://}"; hp="${hp%%/*}"
		port="${hp##*:}"
		if [ "$hp" = "$port" ] || ! [[ "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
			fail "AICC_WP_UPSTREAM=$UP must be host:port or http(s)://host:port with a port from 1 to 65535"
		elif [ -z "${hp%:*}" ]; then fail "AICC_WP_UPSTREAM=$UP has no host"
		else
			note "upstream (reverse_proxy, rehearsal) $UP"
			h="${hp%:*}"
			case "$h" in 127.*|localhost|'[::1]'|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*|*.internal|*.local) ;; *) warn "AICC_WP_UPSTREAM host $h is not loopback/private: the upstream must not be reachable from the internet (scripts/ops/upstream-exposure-check.sh)" ;; esac
		fi
	fi
else
	SOCK_RAW="${AICC_PHP_FPM_SOCKET:-unix//run/php/aicc-cp.sock}"
	if [[ "$SOCK_RAW" != unix//* ]]; then fail "AICC_PHP_FPM_SOCKET='$SOCK_RAW' must be unix//absolute/path (a UNIX socket; no host:port upstream exists in this architecture)"
	else
		SOCK="${SOCK_RAW#unix/}"
		if [ -S "$SOCK" ]; then
			[ -w "$SOCK" ] && note "php-fpm socket $SOCK" || fail "php-fpm socket $SOCK exists but is not writable by $(id -un) (listen.owner / listen.group / listen.mode of the pool)"
		else fail "php-fpm socket $SOCK does not exist (start PHP-FPM first: the unit needs After=/Requires= the pool; every WordPress route would answer the branded 502)"; fi
	fi
	WPR="${AICC_WP_ROOT:-}"
	if [ -z "$WPR" ]; then fail "AICC_WP_ROOT is empty or unset (the docroot Caddy reads and PHP-FPM executes)"
	elif [ ! -d "$WPR" ]; then fail "AICC_WP_ROOT=$WPR is not a directory (or a dangling symlink)"
	else
		for f in index.php wp-load.php wp-includes/version.php; do [ -s "$WPR/$f" ] || fail "AICC_WP_ROOT=$WPR has no $f (not a WordPress docroot)"; done
		[ -r "$WPR/index.php" ] || fail "AICC_WP_ROOT=$WPR is not readable by $(id -un)"
		[ -w "$WPR/index.php" ] && warn "AICC_WP_ROOT=$WPR is writable by $(id -un): the edge's user should only read the docroot"
		note "WordPress docroot $WPR"
	fi
fi

# ---- operator CIDRs (OPTIONAL extra; default empty) --------------------------------------------------------------------------------
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
if [ -n "${OPS// /}" ]; then
	if [ "$MODE" != rehearsal ]; then
		if [ "${AICC_ALLOW_OPERATOR_CIDRS:-}" = "1" ]; then override AICC_ALLOW_OPERATOR_CIDRS "a public CIDR allowlist is active in $MODE mode"
		else fail "AICC_OPERATOR_CIDRS='$OPS' is set in $MODE mode: the public allowlist is gone (owner decision 2026-10-21); operators use the SSH tunnel to the loopback listener"; fi
	fi
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
	[ "$n" -gt 0 ] && note "optional public operator list: $n item(s)"
else note "no public operator CIDR list (operators use the loopback listener)"; fi

# ---- operator listener port ---------------------------------------------------------------------------------------------------------
OPP="${AICC_OPERATOR_PORT:-8443}"
if ! [[ "$OPP" =~ ^[0-9]+$ ]] || [ "$OPP" -lt 1024 ] || [ "$OPP" -gt 65535 ] || [ "$OPP" = 80 ] || [ "$OPP" = 443 ]; then fail "AICC_OPERATOR_PORT=$OPP must be a port from 1024 to 65535 other than 80/443"; fi

# ---- the Caddyfile itself ----------------------------------------------------------------------------------------------------------
if [ -n "$CODE" ]; then
	GLOBAL="$(awk '/# BEGIN GLOBAL OPTIONS/{f=1} f{print} /# END GLOBAL OPTIONS/{exit}' "$CADDYFILE" | grep -v '^[[:space:]]*#')"
	# TLS: what the Caddyfile does about certificates
	MANUAL="$(printf '%s\n' "$CODE" | awk '$1=="tls" && $2!="internal" && $2!="{" && NF>=3 {print $2" "$3; exit}')"
	LOCAL=0; printf '%s\n' "$CODE" | grep -q '^[[:space:]]*local_certs[[:space:]]*$' && LOCAL=1
	INTERNAL=0; printf '%s\n' "$CODE" | grep -Eq '^[[:space:]]*tls[[:space:]]+internal([[:space:]]|$)' && INTERNAL=1
	if [ "$MODE" = rehearsal ]; then
		[ "$LOCAL" = 1 ] || fail "rehearsal mode needs the global option local_certs (a rehearsal must never reach a public CA)"
		if printf '%s\n' "$CODE" | grep -Eqi '(^|[[:space:]])(acme_ca|acme_dns|acme_eab)([[:space:]]|$)|^[[:space:]]*email[[:space:]]|issuer[[:space:]]+(acme|zerossl)|letsencrypt|zerossl|on_demand_tls|^[[:space:]]*dns[[:space:]]'; then fail "public-CA configuration (acme_ca / email / issuer / letsencrypt / zerossl / dns challenge) in a rehearsal Caddyfile: a rehearsal must never contact a public ACME CA"; fi
		if [ -n "$MANUAL" ]; then
			case "$MANUAL" in "$HOME"/*" $HOME"/*) ;; *) fail "rehearsal tls files must both live under \$HOME: $MANUAL" ;; esac
		fi
	else
		if [ "$LOCAL" = 1 ] || [ "$INTERNAL" = 1 ] || printf '%s\n' "$CODE" | grep -q '^[[:space:]]*skip_install_trust'; then
			if [ "${AICC_ALLOW_INTERNAL_TLS:-}" = "1" ]; then override AICC_ALLOW_INTERNAL_TLS "local_certs / tls internal in a $MODE Caddyfile: a CHECK build, not a deployment (browsers will not trust it)"
			else fail "local_certs / tls internal / skip_install_trust in a $MODE Caddyfile: certificates would be issued by Caddy's own CA, not a public CA (set AICC_ALLOW_INTERNAL_TLS=1 only for a check build)"; fi
		fi
		if [ -n "$MANUAL" ]; then
			if [ "${AICC_ALLOW_MANUAL_TLS:-}" = "1" ]; then override AICC_ALLOW_MANUAL_TLS "pre-issued certificate files (Option A)"
			else fail "pre-issued certificate files ($MANUAL) in a $MODE Caddyfile: the plan is Caddy's automatic HTTPS (owner decision 2026-10-21); set AICC_ALLOW_MANUAL_TLS=1 to override"; fi
		fi
		if [ "$LOCAL" = 0 ] && [ "$INTERNAL" = 0 ] && [ -z "$MANUAL" ]; then
			em="${AICC_ACME_EMAIL:-}"
			if [[ "$em" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then note "ACME contact $em"
			else fail "AICC_ACME_EMAIL is empty or not an e-mail address (the Caddyfile's 'email' line needs it)"; fi
			CA="${AICC_ACME_CA:-https://acme-v02.api.letsencrypt.org/directory}"
			case "$CA" in
				https://acme-v02.api.letsencrypt.org/directory) note "ACME CA Let's Encrypt production" ;;
				https://acme-staging-v02.api.letsencrypt.org/directory) warn "AICC_ACME_CA is the Let's Encrypt STAGING directory: certificates will NOT be trusted by browsers (first-start dry run only)" ;;
				*) if [ "${AICC_ALLOW_CUSTOM_ACME_CA:-}" = "1" ]; then override AICC_ALLOW_CUSTOM_ACME_CA "ACME CA $CA"; else fail "AICC_ACME_CA=$CA is not Let's Encrypt (owner-approved CA); set AICC_ALLOW_CUSTOM_ACME_CA=1 to override"; fi ;;
			esac
			printf '%s\n' "$GLOBAL" | grep -q '^[[:space:]]*acme_ca ' || fail "the Caddyfile has no acme_ca line (the CA must be pinned to Let's Encrypt; the default would also try ZeroSSL)"
		fi
	fi
	# manual certificate files (Option A or a rehearsal files variant): readable, key mode, not expired, SANs, key match
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
				if [ "$MODE" = stage ]; then names="${AICC_PUBLIC_HOST:-}"; else names="www.copilt.org copilt.org"; fi
				for name in $names; do echo "$san" | grep -Eq "DNS:${name//./\\.}([,[:space:]]|$)" || fail "TLS certificate $cert has no SAN DNS:$name"; done
				a="$(openssl x509 -in "$cert" -noout -pubkey 2>/dev/null | openssl pkey -pubin -outform der 2>/dev/null | openssl dgst -sha256 2>/dev/null)"
				b="$(openssl pkey -in "$key" -pubout -outform der 2>/dev/null | openssl dgst -sha256 2>/dev/null)"
				[ -n "$a" ] && [ "$a" = "$b" ] || fail "TLS key $key does not belong to certificate $cert"
				note "manual certificate $cert (key $key)"
			fi
		fi
	fi
	# admin API must be explicit and stay on loopback or a socket
	adm="$(printf '%s\n' "$CODE" | awk '$1=="admin" && NF>=2 {print $2; exit}')"
	# {$VAR:default} / {$VAR}: resolve like Caddy does (environment first, then the default)
	if [[ "$adm" =~ ^\{\$([A-Za-z_][A-Za-z0-9_]*)(:(.*))?\}$ ]]; then v="${BASH_REMATCH[1]}"; d="${BASH_REMATCH[3]}"; adm="${!v:-$d}"; fi
	if [ -z "$adm" ]; then fail "no 'admin' address in the Caddyfile: Caddy's default is localhost:2019 (give the edge its own loopback address, e.g. admin 127.0.0.1:12019)"
	else
		case "$adm" in off|localhost:*|127.*:*|'[::1]':*|unix/*) note "admin API $adm" ;; *) fail "admin API address '$adm' is not loopback/unix: the admin API can reconfigure the whole edge without authentication" ;; esac
	fi
	# HTTP/3 off, no Alt-Svc
	has '^[[:space:]]*protocols[[:space:]]+h1[[:space:]]+h2[[:space:]]*$' || fail "HTTP/3 is not switched off: the Caddyfile has no 'servers { protocols h1 h2 }' (owner decision: HTTP/3 OFF)"
	if has 'Alt-Svc[[:space:]]+"|[[:space:]]protocols[[:space:]].*h3'; then fail "the Caddyfile sets an Alt-Svc value or enables h3 (HTTP/3 must be OFF)"; fi
	# an https request whose Host differs from the TLS server name must be refused (421), not answered with Caddy's empty 200
	has '^[[:space:]]*strict_sni_host[[:space:]]+on[[:space:]]*$' || fail "the Caddyfile has no 'strict_sni_host on' (a request with a foreign Host over a valid SNI would get an empty 200 from Caddy instead of 421)"
	# metrics: global option only
	if ! printf '%s\n' "$GLOBAL" | grep -Eq '^[[:space:]]*metrics[[:space:]]*$'; then fail "the global option 'metrics' is missing (Caddy's metrics must be enabled; they are served by the loopback admin API only)"; fi
	nmet="$(printf '%s\n' "$CODE" | grep -Ec '^[[:space:]]*metrics([[:space:]{]|$)')"
	[ "$nmet" = 1 ] || fail "'metrics' appears $nmet times in the Caddyfile: it must be the single global option and must never be routed by a site, handle or snippet (it would publish Prometheus text)"
	# listeners: exactly one bind, loopback
	nbind="$(printf '%s\n' "$CODE" | grep -Ec '^[[:space:]]*(default_)?bind[[:space:]]')"
	badbind="$(printf '%s\n' "$CODE" | grep -E '^[[:space:]]*bind[[:space:]]' | grep -Evc '^[[:space:]]*bind[[:space:]]+127\.0\.0\.1[[:space:]]*$')"
	if [ "$MODE" = rehearsal ]; then
		[ "$badbind" = 0 ] || fail "a 'bind' other than 'bind 127.0.0.1' in the rehearsal Caddyfile"
	else
		[ "$nbind" = 1 ] && [ "$badbind" = 0 ] || fail "the Caddyfile must contain exactly one 'bind', and it must be 'bind 127.0.0.1' (the operator listener); found $nbind bind line(s), $badbind not loopback"
	fi
	printf '%s\n' "$CODE" | grep -q '^[[:space:]]*bind 127\.0\.0\.1[[:space:]]*$' || fail "the operator listener's 'bind 127.0.0.1' is missing"
	has '^[[:space:]]*import[[:space:]]+aicc_operator_guard' || fail "the operator listener guard (aicc_operator_guard) is missing from the Caddyfile"
fi

# ---- log dir -----------------------------------------------------------------------------------------------------------------------
LD="${AICC_LOG_DIR:-/var/log/caddy}"
if [ ! -d "$LD" ]; then fail "AICC_LOG_DIR=$LD does not exist (Caddy exits when it cannot open its log files)"
elif ! ( t="$LD/.aicc-preflight.$$"; : > "$t" ) 2>/dev/null; then fail "AICC_LOG_DIR=$LD is not writable by $(id -un)"
else rm -f "$LD/.aicc-preflight.$$"; note "log dir $LD writable"; fi

if [ -n "${AICC_WP_TIMEOUT:-}" ] && ! [[ "$AICC_WP_TIMEOUT" =~ ^[0-9]+(ms|s|m)$ ]]; then fail "AICC_WP_TIMEOUT=$AICC_WP_TIMEOUT is not a duration like 60s"; fi

# ---- caddy adapt: every listener is :80, :443 or loopback:port --------------------------------------------------------------------
if [ -n "$CADDYFILE" ] && [ "$FAILS" = 0 ] && { command -v "$CADDY" >/dev/null 2>&1 || [ -x "$CADDY" ]; }; then
	J="$("$CADDY" adapt --config "$CADDYFILE" --adapter caddyfile 2>/dev/null | tr -d ' \n\t')"
	if [ -z "$J" ]; then fail "caddy adapt produced no output for $CADDYFILE (the file does not adapt with this environment)"
	else
		LISTENERS="$(printf '%s' "$J" | grep -o '"listen":\[[^]]*\]' | grep -o '"[^"]*"' | grep -v '^"listen"$' | tr -d '"' | sort -u)"
		while IFS= read -r l; do
			[ -n "$l" ] || continue
			case "$l" in
				:80|:443) ;;
				127.0.0.1:*|'[::1]':*)
					if [ "$MODE" != rehearsal ] && [ "${l##*:}" != "$OPP" ]; then fail "listener $l is loopback but not on the operator port $OPP"; fi ;;
				*) if [ "$MODE" = rehearsal ] && [[ "$l" =~ ^(0\.0\.0\.0|\[::\])?:[0-9]+$ ]]; then :; else fail "listener '$l' is not :80, :443 or 127.0.0.1:<operator port>: the edge would listen on an address it must not"; fi ;;
			esac
		done <<< "$LISTENERS"
		# the operator listener must be present and loopback
		printf '%s\n' "$LISTENERS" | grep -q "^127\.0\.0\.1:$OPP\$" || { [ "$MODE" = rehearsal ] || fail "the adapted config has no 127.0.0.1:$OPP listener (the operator listener)"; }
		# nothing may listen on the operator port on a non-loopback address
		printf '%s\n' "$LISTENERS" | grep -E ":$OPP\$" | grep -Ev '^(127\.0\.0\.1|\[::1\]):' | grep -q . && fail "the operator port $OPP is bound on a non-loopback address"
		# HTTP/3 off in the adapted config (QUIC would add a UDP listener)
		printf '%s' "$J" | grep -q '"protocols":\["h1","h2"\]' || fail "the adapted config does not restrict servers to protocols h1 and h2 (HTTP/3 would be on)"
		[ "$FAILS" = 0 ] && note "adapted listeners: $(printf '%s' "$LISTENERS" | tr '\n' ' ')(protocols h1, h2)"
	fi
fi

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
