#!/usr/bin/env bash
# Copies the provisioning bundle (infra/ and scripts/ops/) to the staging host so the installers can run there. Runs ON THE MAC. Read/write only ~aicc/aicc-infra-bundle.
#
#   infra/provision/push-bundle.sh --stage-ip <IPV4> --stage-host stage.copilt.org [--key ~/.ssh/aicc_cp_stage] [--user aicc] [--dry-run]
#
#   PRODUCTION (the promoted host): infra/provision/push-bundle.sh --env production --stage-ip <IPV4> --stage-host www.copilt.org --expect-id <32 hex> --key ~/.ssh/aicc_cp_prod_operator --known-hosts <pinned file>
#     tightens only: host name exactly www.copilt.org, key file named aicc_cp_prod*, a pinned known-hosts file with an entry for the address (no trust on first use), and the host identity must say
#     AICC_ENV=production with this host name and the id given in --expect-id.
# Excludes: node_modules, .git, aicc-ops/tests, *.pyc, any file whose name looks like a secret (.env*, *.pem, *.key). Same refusals as the other stage tooling
# (production IP/hostnames/key). Then, on the host:  cd ~/aicc-infra-bundle && sudo infra/provision/install-stack.sh --dry-run
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
STAGE_IP=""; STAGE_HOST=""; KEY=""; USER_NAME="aicc"; DRY=0; ENVN="stage"; EXPECT_ID=""; KNOWN_HOSTS=""
DENY_IPS="139.59.157.231 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153"
. "$HERE/lib/ip-guard.sh"   # strict address check: canonical notation only, IPv4-embedding IPv6 forms and production ranges refused (security review L5)
while [ $# -gt 0 ]; do
  case "$1" in
    --stage-ip) STAGE_IP="${2:-}"; shift 2 ;; --stage-host) STAGE_HOST="${2:-}"; shift 2 ;; --key) KEY="${2:-}"; shift 2 ;; --user) USER_NAME="${2:-}"; shift 2 ;; --dry-run) DRY=1; shift ;; --env) ENVN="${2:-}"; shift 2 ;; --expect-id) EXPECT_ID="${2:-}"; shift 2 ;; --known-hosts) KNOWN_HOSTS="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,8p "$0"; exit 0 ;; *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 3; }
case "$ENVN" in stage|production) ;; *) echo "--env must be stage or production" >&2; exit 2 ;; esac
[ -n "$KEY" ] || { [ "$ENVN" = production ] && { echo "--env production needs --key (aicc_cp_prod*)" >&2; exit 2; } || KEY="$HOME/.ssh/aicc_cp_stage"; }
[ -n "$STAGE_IP" ] && [ -n "$STAGE_HOST" ] || { echo "usage: $0 --stage-ip IP --stage-host stage.copilt.org" >&2; exit 2; }
[[ "$STAGE_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || refuse "--stage-ip must be a literal IPv4 address"
for d in $DENY_IPS; do [ "$STAGE_IP" = "$d" ] && refuse "$STAGE_IP is a production/public address."; done
aicc_ip_guard "$STAGE_IP" "--stage-ip " || exit 3
if [ "$ENVN" = production ]; then
  [ "$STAGE_HOST" = "www.copilt.org" ] || refuse "--env production pushes to the host named exactly www.copilt.org"
  [[ "$EXPECT_ID" =~ ^[0-9a-f]{32}$ ]] || refuse "--env production needs --expect-id <32 hex>"
  case "$(basename "$KEY")" in aicc_cp_prod*) ;; *) refuse "the production key file must be named aicc_cp_prod*" ;; esac
  [ -s "$KNOWN_HOSTS" ] || refuse "--env production needs --known-hosts FILE (pinned host key, no trust on first use)"
  ssh-keygen -F "$STAGE_IP" -f "$KNOWN_HOSTS" >/dev/null 2>&1 || refuse "the pinned known-hosts file has no entry for $STAGE_IP"
else
  case "$STAGE_HOST" in www.copilt.org|copilt.org|api.copilt.org) refuse "$STAGE_HOST is a production hostname." ;; esac
  [[ "$STAGE_HOST" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || refuse "--stage-host must be a stage*.copilt.org name"
  case "$KEY" in *aicc_cp_prod*) refuse "the production key is not used for staging." ;; esac
fi
case "$KEY" in *aicc_digitalocean_prod*) refuse "never use the production key." ;; esac
[ -f "$KEY" ] || { echo "no such key file: $KEY" >&2; exit 2; }
if [ "$ENVN" = production ]; then SSHO="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$KNOWN_HOSTS"
else SSHO="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$HOME/.ssh/known_hosts_aicc_stage"; fi
ident="$($SSHO "$USER_NAME@$STAGE_IP" 'cat /etc/aicc-stage-identity' 2>/dev/null)" || { echo "cannot read the host identity" >&2; exit 1; }
if [ "$ENVN" = production ]; then
  echo "$ident" | grep -q '^AICC_ENV=production$' || refuse "host does not say AICC_ENV=production"
  echo "$ident" | grep -q "^AICC_STAGE_ID=${EXPECT_ID}\$" || refuse "host identity id differs from --expect-id"
else
  echo "$ident" | grep -q '^AICC_ENV=staging$' || refuse "host does not say AICC_ENV=staging"
fi
echo "$ident" | grep -q "^AICC_HOSTNAME=${STAGE_HOST}\$" || refuse "host identity hostname is not $STAGE_HOST"
RS=(rsync -a --delete --delete-excluded -e "$SSHO" --exclude node_modules --exclude .git --exclude __pycache__ --exclude '*.pyc' --exclude '.env*' --exclude '*.pem' --exclude '*.key'
    --exclude 'aicc-ops/tests' --exclude 'sentinel/tests' --exclude '.DS_Store')
[ "$DRY" = 1 ] && RS+=(-n -v)
if [ "$DRY" != 1 ]; then $SSHO "$USER_NAME@$STAGE_IP" 'mkdir -p ~/aicc-infra-bundle/infra ~/aicc-infra-bundle/scripts/ops' || { echo "cannot create the bundle directory" >&2; exit 1; }; fi
"${RS[@]}" "$REPO/infra/" "$USER_NAME@$STAGE_IP:aicc-infra-bundle/infra/"
"${RS[@]}" "$REPO/scripts/ops/" "$USER_NAME@$STAGE_IP:aicc-infra-bundle/scripts/ops/"
if [ "$DRY" = 1 ]; then echo "DRY RUN: nothing was copied"; else echo "bundle pushed to ~$USER_NAME/aicc-infra-bundle on $STAGE_HOST"; fi
