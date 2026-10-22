#!/usr/bin/env bash
# Operator access to the STAGING Control Plane (wp-admin, staff login) WITHOUT any public wp-admin. Runs ON THE MAC.
#
#   infra/provision/operator-tunnel.sh --stage-ip <IPV4> [--stage-host stage.copilt.org] [--key ~/.ssh/aicc_cp_stage] [--local-port 8443] [--remote-port 8443]
#                                      [--profile-dir ~/.aicc-stage-chrome] [--no-chrome] [--dry-run]
#
#   PRODUCTION (promoted host): infra/provision/operator-tunnel.sh --env production --stage-ip <IPV4> --key ~/.ssh/aicc_cp_prod_operator --known-hosts <pinned file> [--spki-hash <base64>]
#     host name www.copilt.org, separate Chrome profile (~/.aicc-prod-chrome), pinned host key. While the edge is DARK (Caddy's internal CA) Chrome does not trust the certificate: pass
#     --spki-hash (SHA-256 of the Caddy intermediate's public key, base64; docs/cutover/production-promotion.md section 6) and Chrome ignores errors for that one key in THAT profile only.
#     After the cutover the certificate is public and no --spki-hash is needed.
#
# What it does:
#   1. opens   ssh -N -L 127.0.0.1:<local-port>:127.0.0.1:<remote-port>  aicc@<stage-ip>   (loopback-only forward on BOTH ends; key = the dedicated stage key; control socket for a clean stop)
#      <remote-port> is the edge's OPERATOR LISTENER: the same host name on `bind 127.0.0.1`, port AICC_OPERATOR_PORT (default 8443), part of the Caddyfile rendered by
#      scripts/ops/render-edge.mjs --mode stage (docs/cutover/stage-linux.md section 5). Nothing on the internet can connect to it; whoever arrives there IS the operator.
#   2. launches a SEPARATE Chrome profile (--user-data-dir) whose host resolver maps  stage.copilt.org -> 127.0.0.1:<local-port>:
#         --host-resolver-rules="MAP stage.copilt.org 127.0.0.1:8443"
#      Chrome therefore requests https://stage.copilt.org/ (real name, real Let's Encrypt certificate, correct Host/SNI) but the TCP connection goes through the tunnel.
#      On the server the edge sees the connection from 127.0.0.1, which is the only address in AICC_OPERATOR_CIDRS: /wp-admin/, /wp-login.php and /wp-cron.php answer
#      for you and 403 for everybody else. Your normal browser profile and /etc/hosts are not touched; QUIC is disabled in that profile (no UDP path exists).
#   3. waits; Ctrl-C (or closing this script) closes the tunnel.
# Fail closed: --stage-ip is required (no default), refuses the production API address, production hostnames, the production key, a port in use, a missing Chrome.
# The tunnel only works after the edge is running on the host (RUNBOOK step "enable-edge"). Alternative without Chrome flags: docs/cutover/stage-linux.md section 5 (hosts file + local port 443).
set -euo pipefail
STAGE_IP=""; STAGE_HOST=""; KEY=""; LPORT=8443; RPORT=8443; PROFILE=""; CHROME=1; DRY=0; USER_NAME="aicc"; ENVN="stage"; KNOWN_HOSTS=""; SPKI=""
DENY_IPS="139.59.157.231 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/ip-guard.sh"   # strict address check (security review L5)
while [ $# -gt 0 ]; do
  case "$1" in
    --stage-ip) STAGE_IP="${2:-}"; shift 2 ;; --stage-host) STAGE_HOST="${2:-}"; shift 2 ;; --key) KEY="${2:-}"; shift 2 ;; --local-port) LPORT="${2:-}"; shift 2 ;; --remote-port) RPORT="${2:-}"; shift 2 ;;
    --profile-dir) PROFILE="${2:-}"; shift 2 ;; --env) ENVN="${2:-}"; shift 2 ;; --known-hosts) KNOWN_HOSTS="${2:-}"; shift 2 ;; --spki-hash) SPKI="${2:-}"; shift 2 ;; --no-chrome) CHROME=0; shift ;; --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,19p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 3; }
case "$ENVN" in stage|production) ;; *) echo "--env must be stage or production" >&2; exit 2 ;; esac
if [ "$ENVN" = production ]; then [ -n "$STAGE_HOST" ] || STAGE_HOST="www.copilt.org"; [ -n "$PROFILE" ] || PROFILE="$HOME/.aicc-prod-chrome"; [ -n "$KEY" ] || { echo "--env production needs --key (aicc_cp_prod*)" >&2; exit 2; }
else [ -n "$STAGE_HOST" ] || STAGE_HOST="stage.copilt.org"; [ -n "$PROFILE" ] || PROFILE="$HOME/.aicc-stage-chrome"; [ -n "$KEY" ] || KEY="$HOME/.ssh/aicc_cp_stage"; fi
[ -n "$STAGE_IP" ] || { echo "usage: $0 --stage-ip <ipv4> [options]" >&2; exit 2; }
[[ "$STAGE_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || refuse "--stage-ip must be a literal IPv4 address"
for d in $DENY_IPS; do [ "$STAGE_IP" = "$d" ] && refuse "$STAGE_IP is a production/public address."; done
aicc_ip_guard "$STAGE_IP" "--stage-ip " || exit 3
if [ "$ENVN" = production ]; then
  [ "$STAGE_HOST" = "www.copilt.org" ] || refuse "--env production uses the host name www.copilt.org"
  case "$(basename "$KEY")" in aicc_cp_prod*) ;; *) refuse "the production key file must be named aicc_cp_prod*" ;; esac
  [ -s "$KNOWN_HOSTS" ] || refuse "--env production needs --known-hosts FILE (pinned host key)"
  ssh-keygen -F "$STAGE_IP" -f "$KNOWN_HOSTS" >/dev/null 2>&1 || refuse "the pinned known-hosts file has no entry for $STAGE_IP"
  [ -z "$SPKI" ] || [[ "$SPKI" =~ ^[A-Za-z0-9+/]{43}=$ ]] || refuse "--spki-hash must be a base64 SHA-256 (44 characters)"
else
  case "$STAGE_HOST" in www.copilt.org|copilt.org|api.copilt.org) refuse "$STAGE_HOST is a production hostname." ;; esac
  [[ "$STAGE_HOST" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || refuse "--stage-host must be a stage*.copilt.org name"
  case "$KEY" in *aicc_cp_prod*) refuse "the production key is not used for staging." ;; esac
  [ -z "$SPKI" ] || refuse "--spki-hash is for the dark production edge only"
fi
case "$KEY" in *aicc_digitalocean_prod*) refuse "never use the production key." ;; esac
[ -f "$KEY" ] || { echo "no such key file: $KEY" >&2; exit 2; }
[[ "$LPORT" =~ ^[0-9]+$ ]] && [ "$LPORT" -ge 1024 ] && [ "$LPORT" -le 65535 ] || refuse "--local-port must be 1024-65535"
[[ "$RPORT" =~ ^[0-9]+$ ]] && [ "$RPORT" -ge 1024 ] && [ "$RPORT" -le 65535 ] || refuse "--remote-port must be 1024-65535 (the operator listener; never 80/443)"
case "$LPORT" in 9111|9112|9113|9114|8981|8982|8983) refuse "port $LPORT belongs to the owner's QA fixtures" ;; esac
CTL="$(mktemp -u "${TMPDIR:-/tmp}/aicc-tunnel.XXXXXX")"
if [ "$ENVN" = production ]; then KH="$KNOWN_HOSTS"; SHK=yes; else KH="$HOME/.ssh/known_hosts_aicc_stage"; SHK=accept-new; fi
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=$SHK -o UserKnownHostsFile="$KH"
     -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -N -f -M -S "$CTL" -L "127.0.0.1:$LPORT:127.0.0.1:$RPORT" "$USER_NAME@$STAGE_IP")
CHROME_APP="/Applications/Google Chrome.app"
CHROME_ARGS=(--user-data-dir="$PROFILE" --host-resolver-rules="MAP $STAGE_HOST 127.0.0.1:$LPORT" --disable-quic --no-first-run --no-default-browser-check)
[ -z "$SPKI" ] || CHROME_ARGS+=("--ignore-certificate-errors-spki-list=$SPKI")
CHROME_ARGS+=("https://$STAGE_HOST/wp-login.php")
if [ "$DRY" = 1 ]; then
  echo "DRY-RUN:"; printf '  %q ' "${SSH[@]}"; echo
  printf '  open -na %q --args ' "$CHROME_APP"; printf '%q ' "${CHROME_ARGS[@]}"; echo
  exit 0
fi
if lsof -nP -iTCP:"$LPORT" -sTCP:LISTEN >/dev/null 2>&1; then refuse "local port $LPORT is already in use"; fi
if [ "$CHROME" = 1 ] && [ ! -d "$CHROME_APP" ]; then refuse "Chrome not found at $CHROME_APP (use --no-chrome and set the host-resolver rule yourself)"; fi
"${SSH[@]}" || { echo "could not open the tunnel (is the edge up? is the key right?)" >&2; exit 1; }
cleanup() { ssh -S "$CTL" -O exit "$USER_NAME@$STAGE_IP" >/dev/null 2>&1 || true; echo "tunnel closed"; }
trap cleanup EXIT INT TERM
echo "tunnel up: 127.0.0.1:$LPORT -> $STAGE_IP:127.0.0.1:$RPORT (the edge's operator listener)"
if [ "$CHROME" = 1 ]; then open -na "$CHROME_APP" --args "${CHROME_ARGS[@]}"; echo "Chrome (separate profile $PROFILE) opened https://$STAGE_HOST/wp-login.php"
else echo "Chrome flag to use: --host-resolver-rules=\"MAP $STAGE_HOST 127.0.0.1:$LPORT\""; fi
echo "Ctrl-C to close the tunnel."
while kill -0 "$(ssh -S "$CTL" -O check "$USER_NAME@$STAGE_IP" 2>&1 | sed -n 's/.*pid=\([0-9]*\).*/\1/p')" 2>/dev/null; do sleep 5; done
