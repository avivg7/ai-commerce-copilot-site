#!/usr/bin/env bash
# OPcache warm-up after a Control Plane activation (architecture review M-7). Runs ON THE HOST, called by activate-release.sh AFTER the health gate passed. It NEVER fails
# a release: whatever happens here the exit status is 0 (the release is live and healthy; a slow first visitor is the only thing at stake).
#
# WHY: every CP release ends with `systemctl reload php8.3-fpm` (SIGUSR2), which frees the whole 128 MiB OPcache (opcache.validate_timestamps=0 makes the reload mandatory).
# On the one-vCPU staging host the first WordPress requests after a reload/restart took 4.8 s (/pricing/), 5.3 s (admin-ajax) and once 11.5 s (/wp-json/): the first customer after a
# release pays for compiling WordPress, WooCommerce and the plugin. The gate (smoke-cp.sh) only warms the REST index. This requests a small FIXED set of WordPress-owned URLs once,
# through Caddy's PUBLIC listener on loopback (the real path: edge -> FastCGI -> the new release), so the common pages are compiled before a visitor arrives.
#
# LEAST INVASIVE choice (considered and rejected: calling php-fpm directly with cgi-fcgi, which would warm a request shape the edge does not send and needs libfcgi; and the
# operator listener, which is for humans and is bound to a different certificate path): `curl --resolve <host>:443:127.0.0.1 https://<host>/<path>`, GET only, no cookies kept,
# nothing written, one request per path, a few seconds each (a total budget caps the whole run), User-Agent "aicc-release-warmup/1" so the access log shows what it was. 127.0.0.1 is in fail2ban's ignoreip.
#
#   warm-cp.sh [--edge-env /etc/aicc-edge/edge.env] [--host NAME] [--connect IP:PORT] [--scheme https|http] [--timeout SECONDS (per request, default 10: a COLD request took 5-11 s on the host)] [--budget SECONDS (all requests, default 30)] [--paths "P1 P2 ..."] [--dry-run]
# The host name is AICC_PUBLIC_HOST from the edge environment file (read with sed, never sourced). Default paths: the pages a visitor or a merchant opens first.
set -euo pipefail
EDGE_ENV="/etc/aicc-edge/edge.env"; HOST=""; CONNECT="127.0.0.1:443"; SCHEME="https"; TIMEOUT=10; BUDGET=30; DRY=0
PATHS="/pricing/ /my-account/ /cart/ /?rest_route=/aicc-license/v1/plans"
while [ $# -gt 0 ]; do
  case "$1" in
    --edge-env) EDGE_ENV="${2:-}"; shift 2 ;; --host) HOST="${2:-}"; shift 2 ;; --connect) CONNECT="${2:-}"; shift 2 ;; --scheme) SCHEME="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;; --budget) BUDGET="${2:-}"; shift 2 ;; --paths) PATHS="${2:-}"; shift 2 ;; --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,14p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "warm-cp: unknown argument: $1 (ignored; warm-up never fails a release)" >&2; exit 0 ;;
  esac
done
say() { printf 'warm-cp: %s\n' "$*"; }
[[ "$TIMEOUT" =~ ^[0-9]{1,2}$ ]] || TIMEOUT=10
[[ "$BUDGET" =~ ^[0-9]{1,3}$ ]] || BUDGET=30
case "$SCHEME" in http|https) ;; *) say "bad --scheme, skipped"; exit 0 ;; esac
[[ "$CONNECT" =~ ^[0-9.]+:[0-9]{1,5}$ ]] || { say "bad --connect, skipped"; exit 0; }
IP="${CONNECT%%:*}"; PORT="${CONNECT##*:}"
case "$IP" in 127.*) ;; *) say "--connect must be a loopback address (got $IP): skipped"; exit 0 ;; esac
if [ -z "$HOST" ] && [ -r "$EDGE_ENV" ]; then HOST="$(sed -n 's/^AICC_PUBLIC_HOST=//p' "$EDGE_ENV" | head -1 | tr -d '"'"'"' \r')"; fi
[[ "$HOST" =~ ^[A-Za-z0-9.-]{3,253}$ ]] || { say "no usable host name (AICC_PUBLIC_HOST in $EDGE_ENV): skipped"; exit 0; }
command -v curl >/dev/null 2>&1 || { say "curl not installed: skipped"; exit 0; }
n=0; okn=0; t0=$(date +%s)
for p in $PATHS; do
  [[ "$p" == /* && "$p" =~ ^[A-Za-z0-9/_.?=\&%-]*$ ]] || { say "ignoring unsafe path: $p"; continue; }
  if [ $(( $(date +%s) - t0 )) -ge "$BUDGET" ]; then say "time budget (${BUDGET}s) used up: remaining paths skipped"; break; fi
  n=$((n + 1))
  url="$SCHEME://$HOST:$PORT$p"
  [ "$SCHEME" = https ] && [ "$PORT" = 443 ] && url="https://$HOST$p"
  if [ "$DRY" = 1 ]; then say "would GET $url via $IP:$PORT"; continue; fi
  # -k: the target is our own loopback listener and nothing sensitive is sent; a certificate that is not (yet) trusted must not stop the warm-up. -o /dev/null: nothing is kept.
  res="$(curl -ksS -o /dev/null --max-time "$TIMEOUT" --connect-timeout 3 --resolve "$HOST:$PORT:$IP" -A 'aicc-release-warmup/1' -H 'Accept: text/html,application/json' -w '%{http_code} %{time_total}s' "$url" 2>&1)" || res="no answer within ${TIMEOUT}s ($(printf '%s' "$res" | tr '\n' ' ' | cut -c1-80))"
  say "$p -> $res"
  case "$res" in [23]??" "*) okn=$((okn + 1)) ;; esac
done
say "done: $okn of $n requests answered 2xx/3xx in $(( $(date +%s) - t0 )) s (informational: a failure here never fails the release)"
exit 0
