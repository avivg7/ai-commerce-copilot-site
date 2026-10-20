#!/usr/bin/env bash
# Copies the provisioning bundle (infra/ and scripts/ops/) to the staging host so the installers can run there. Runs ON THE MAC. Read/write only ~aicc/aicc-infra-bundle.
#
#   infra/provision/push-bundle.sh --stage-ip <IPV4> --stage-host stage.copilt.org [--key ~/.ssh/aicc_cp_stage] [--user aicc] [--dry-run]
#
# Excludes: node_modules, .git, aicc-ops/tests, *.pyc, any file whose name looks like a secret (.env*, *.pem, *.key). Same refusals as the other stage tooling
# (production IP/hostnames/key). Then, on the host:  cd ~/aicc-infra-bundle && sudo infra/provision/install-stack.sh --dry-run
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
STAGE_IP=""; STAGE_HOST=""; KEY="$HOME/.ssh/aicc_cp_stage"; USER_NAME="aicc"; DRY=0
DENY_IPS="139.59.157.231 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153"
while [ $# -gt 0 ]; do
  case "$1" in
    --stage-ip) STAGE_IP="${2:-}"; shift 2 ;; --stage-host) STAGE_HOST="${2:-}"; shift 2 ;; --key) KEY="${2:-}"; shift 2 ;; --user) USER_NAME="${2:-}"; shift 2 ;; --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,8p "$0"; exit 0 ;; *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 3; }
[ -n "$STAGE_IP" ] && [ -n "$STAGE_HOST" ] || { echo "usage: $0 --stage-ip IP --stage-host stage.copilt.org" >&2; exit 2; }
[[ "$STAGE_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || refuse "--stage-ip must be a literal IPv4 address"
for d in $DENY_IPS; do [ "$STAGE_IP" = "$d" ] && refuse "$STAGE_IP is a production/public address."; done
case "$STAGE_HOST" in www.copilt.org|copilt.org|api.copilt.org) refuse "$STAGE_HOST is a production hostname." ;; esac
[[ "$STAGE_HOST" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || refuse "--stage-host must be a stage*.copilt.org name"
case "$KEY" in *aicc_digitalocean_prod*) refuse "never use the production key." ;; esac
[ -f "$KEY" ] || { echo "no such key file: $KEY" >&2; exit 2; }
SSHO="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$HOME/.ssh/known_hosts_aicc_stage"
ident="$($SSHO "$USER_NAME@$STAGE_IP" 'cat /etc/aicc-stage-identity' 2>/dev/null)" || { echo "cannot read the host identity" >&2; exit 1; }
echo "$ident" | grep -q '^AICC_ENV=staging$' || refuse "host does not say AICC_ENV=staging"
echo "$ident" | grep -q "^AICC_HOSTNAME=${STAGE_HOST}\$" || refuse "host identity hostname is not $STAGE_HOST"
RS=(rsync -a --delete --delete-excluded -e "$SSHO" --exclude node_modules --exclude .git --exclude __pycache__ --exclude '*.pyc' --exclude '.env*' --exclude '*.pem' --exclude '*.key'
    --exclude 'aicc-ops/tests' --exclude 'sentinel/tests' --exclude '.DS_Store')
[ "$DRY" = 1 ] && RS+=(-n -v)
if [ "$DRY" != 1 ]; then $SSHO "$USER_NAME@$STAGE_IP" 'mkdir -p ~/aicc-infra-bundle/infra ~/aicc-infra-bundle/scripts/ops' || { echo "cannot create the bundle directory" >&2; exit 1; }; fi
"${RS[@]}" "$REPO/infra/" "$USER_NAME@$STAGE_IP:aicc-infra-bundle/infra/"
"${RS[@]}" "$REPO/scripts/ops/" "$USER_NAME@$STAGE_IP:aicc-infra-bundle/scripts/ops/"
if [ "$DRY" = 1 ]; then echo "DRY RUN: nothing was copied"; else echo "bundle pushed to ~$USER_NAME/aicc-infra-bundle on $STAGE_HOST"; fi
