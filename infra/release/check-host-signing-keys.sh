#!/usr/bin/env bash
# READ-ONLY check that the Control Plane host's trust anchor AICC_LM_PLUGIN_SIGNING_PUBKEYS holds the owner's signing key, WITHOUT reading its value into the output (docs/cutover/p41-plugin-publication.md section 3).
# One ssh call runs a tiny PHP snippet through `sudo aicc-wp eval`; the snippet prints ONLY: defined / not defined, how many entries, the fingerprint of each entry, and whether each key of the owner's list is among them.
# It never prints the constant, never prints wp-config.php, never changes anything. The keys it compares with are the owner's PUBLIC keys (release/endpoints.conf UPDATE_PUBLIC_KEYS of --plugin-dir, or --pubkeys).
#
#   check-host-signing-keys.sh (--plugin-dir <Plugin repo or build dir> | --pubkeys <primary[,standby]>) --stage-host H --stage-ip IPV4 --stage-id <32 hex> --key K [--known-hosts F] [--env production|stage] [--user aicc]
#     production: --stage-host www.copilt.org, --key named aicc_cp_prod*, --known-hosts <pinned file with an entry for the IP>. The host identity (/etc/aicc-stage-identity) must match before anything else is asked.
# Exit codes: 0 the PRIMARY key (first of the list) is configured on the host; 1 it is not (or the constant is not defined / not usable); 2 usage; 3 refused by a safety rule.
# What a mismatch means: the store would refuse to serve the release (a signed release verifies only against THIS list) and the launch gate blocks. Fix: `sudo aicc-owner-facts set AICC_LM_PLUGIN_SIGNING_PUBKEYS '<primary>,<standby>'`,
# render, reload PHP-FPM (docs/cutover/p41-plugin-publication.md section 3.2) - a separate, approved host step; this script never does it.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../provision/lib/ip-guard.sh"
PLUGDIR=""; KEYS=""; SHOST=""; SIP=""; SID=""; KEY=""; KH=""; ENVN="production"; USER_NAME="aicc"
while [ $# -gt 0 ]; do
  case "$1" in
    --plugin-dir) PLUGDIR="${2:-}"; shift 2 ;; --pubkeys) KEYS="${2:-}"; shift 2 ;; --stage-host) SHOST="${2:-}"; shift 2 ;; --stage-ip) SIP="${2:-}"; shift 2 ;; --stage-id) SID="${2:-}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;; --known-hosts) KH="${2:-}"; shift 2 ;; --env) ENVN="${2:-}"; shift 2 ;; --user) USER_NAME="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,12p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 3; }
case "$ENVN" in production|stage) ;; *) echo "--env must be production or stage" >&2; exit 2 ;; esac
[ -n "$SHOST" ] && [ -n "$SIP" ] && [ -n "$SID" ] && [ -n "$KEY" ] || { echo "usage: --stage-host H --stage-ip IP --stage-id ID --key K (--plugin-dir D | --pubkeys LIST)" >&2; exit 2; }
if [ -z "$KEYS" ] && [ -n "$PLUGDIR" ] && [ -f "$PLUGDIR/release/endpoints.conf" ]; then KEYS="$(sed -n 's/^UPDATE_PUBLIC_KEYS=//p' "$PLUGDIR/release/endpoints.conf" | head -1 | tr -d ' \r')"; fi
[[ "$KEYS" =~ ^[A-Za-z0-9+/]{43}=(,[A-Za-z0-9+/]{43}=)?$ ]] || { echo "need the owner's public key list: --pubkeys <primary[,standby]> or --plugin-dir with release/endpoints.conf UPDATE_PUBLIC_KEYS" >&2; exit 2; }
[[ "$SIP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || refuse "--stage-ip must be a literal IPv4 address"
aicc_ip_guard "$SIP" "--stage-ip " || exit 3
for d in 139.59.157.231 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153; do [ "$SIP" = "$d" ] && refuse "$SIP is the API Droplet or a GitHub Pages address, not a Control Plane host"; done
[[ "$SID" =~ ^[0-9a-f]{32}$ ]] || refuse "--stage-id must be 32 lowercase hex characters"
[ -f "$KEY" ] && grep -q "PRIVATE KEY" "$KEY" 2>/dev/null || refuse "$KEY is not a private key file"
case "$KEY" in *aicc_digitalocean_prod*) refuse "never use the API Droplet's key" ;; esac
if [ "$ENVN" = production ]; then
  [ "$SHOST" = "www.copilt.org" ] || refuse "--env production asks the host named exactly www.copilt.org (got $SHOST)"
  case "$(basename "$KEY")" in aicc_cp_prod*) ;; *) refuse "the production key file must be named aicc_cp_prod* (got $(basename "$KEY"))" ;; esac
  [ -n "$KH" ] && [ -s "$KH" ] || refuse "--env production needs --known-hosts FILE holding the pinned host key (no trust on first use)"
  ssh-keygen -F "$SIP" -f "$KH" >/dev/null 2>&1 || refuse "the pinned known-hosts file has no entry for $SIP"
  SHK=yes
else
  case "$SHOST" in www.copilt.org|copilt.org|api.copilt.org) refuse "$SHOST is a production hostname" ;; esac
  [[ "$SHOST" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || refuse "--stage-host must be a stage*.copilt.org name"
  case "$KEY" in *aicc_cp_prod*) refuse "the production key is not used for staging" ;; esac
  SHK=accept-new; [ -n "$KH" ] || KH="$HOME/.ssh/known_hosts_aicc_stage"
fi
SSH_OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking="$SHK" -o UserKnownHostsFile="$KH")
ident="$(ssh "${SSH_OPTS[@]}" "$USER_NAME@$SIP" 'cat /etc/aicc-stage-identity' 2>/dev/null)" || { echo "cannot read the host identity over SSH (host down, wrong key, host key not pinned)" >&2; exit 1; }
WANTENV=staging; [ "$ENVN" = production ] && WANTENV=production
echo "$ident" | grep -q "^AICC_ENV=${WANTENV}\$" || refuse "host does not say AICC_ENV=$WANTENV"
echo "$ident" | grep -q "^AICC_HOSTNAME=${SHOST}\$" || refuse "host identity AICC_HOSTNAME is not $SHOST"
echo "$ident" | grep -q "^AICC_STAGE_ID=${SID}\$" || refuse "host identity AICC_STAGE_ID does not match --stage-id: not the host this command was meant for"
echo "host identity OK ($SHOST, id matches)"
# the snippet: reads the constant, prints NO value. The owner's PUBLIC keys are literals in it (they are in the plugin's endpoints.conf and in every build).
SNIP='$want = array_map( "trim", explode( ",", "'"$KEYS"'" ) );
if ( ! defined( "AICC_LM_PLUGIN_SIGNING_PUBKEYS" ) || ! is_string( AICC_LM_PLUGIN_SIGNING_PUBKEYS ) || "" === trim( AICC_LM_PLUGIN_SIGNING_PUBKEYS ) ) { echo "HOSTKEYS not-defined\n"; return; }
$have = array_values( array_filter( array_map( "trim", explode( ",", AICC_LM_PLUGIN_SIGNING_PUBKEYS ) ), "strlen" ) );
$fp = function ( $b64 ) { $raw = base64_decode( $b64, true ); return ( false !== $raw && 32 === strlen( $raw ) ) ? implode( "-", str_split( substr( hash( "sha256", $raw ), 0, 16 ), 4 ) ) : "unusable"; };
echo "HOSTKEYS defined entries=" . count( $have ) . " fingerprints=" . implode( ",", array_map( $fp, $have ) ) . "\n";
foreach ( $want as $i => $k ) { echo "HOSTKEYS " . ( 0 === $i ? "primary" : "standby" ) . " " . $fp( $k ) . " " . ( in_array( $k, $have, true ) ? "PRESENT" : "ABSENT" ) . "\n"; }'
B64="$(printf '%s' "$SNIP" | base64 | tr -d '\n')"
out="$(ssh "${SSH_OPTS[@]}" "$USER_NAME@$SIP" "sudo aicc-wp eval \"eval(base64_decode('$B64'));\"" 2>/dev/null)" || { echo "the host query failed (aicc-wp eval)" >&2; exit 1; }
printf '%s\n' "$out" | grep '^HOSTKEYS' || { echo "the host answered nothing usable" >&2; exit 1; }
if printf '%s\n' "$out" | grep -q '^HOSTKEYS primary .* PRESENT$'; then
  printf '%s\n' "$out" | grep -q '^HOSTKEYS standby .* ABSENT$' && echo "NOTE: the standby key is not configured on the host (allowed; add it before a rotation)."
  echo "OK: the primary signing key is configured on the host's AICC_LM_PLUGIN_SIGNING_PUBKEYS (the value itself was not printed)."
  exit 0
fi
echo "NOT OK: the host's AICC_LM_PLUGIN_SIGNING_PUBKEYS does not hold the primary key (or is not defined): the store would refuse to serve a release signed with it. See the header for the fix." >&2
exit 1
