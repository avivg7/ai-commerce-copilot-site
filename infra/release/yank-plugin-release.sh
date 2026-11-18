#!/usr/bin/env bash
# THE STOP SWITCH for a Plugin release in the Control Plane's private release store: marks an INSTALLED version "yanked" (or un-yanks it) by setting "yanked": true in its manifest, ON THE HOST.
# A yanked release is never offered to a store's updater, never shown on the account page, and the rollback list skips it; if `current` points at it nothing is offered at all (docs/plugin-delivery.md).
# Nothing is deleted. The manifest fields the owner's signature covers are untouched, so the signature still verifies. Use it when a published release must stop being served and there is NO earlier version
# to `publish-plugin-release.sh --point-at` (the first release): then publish a corrected release under a NEW version number and point `current` at it.
#
#   yank-plugin-release.sh --version X.Y.Z [--unyank] --stage-host H --stage-ip IPV4 --stage-id <32 hex> --key K [--known-hosts F] [--env production|stage] [--user aicc] [--confirm-production X.Y.Z] [--apply]
#   PRODUCTION (--env production, the default): --stage-host www.copilt.org, --key named aicc_cp_prod*, --known-hosts <pinned file with an entry for the IP>, --confirm-production <the version>.
#        WITHOUT --apply it is a DRY RUN (local checks and the plan; no network), in every environment. NEVER run it against the live host without the owner's approval of that step.
# On the host (as root through sudo, one python3 process fed over ssh stdin): the version directory must exist, the manifest must be a regular file (not a symlink) of that directory and valid JSON; the file is rewritten
# atomically with the same owner, group and mode; the answer is read back through WordPress (AICC_LM_Release_Store::manifest). Exit codes: 0 done / dry run printed, 1 failed, 2 usage, 3 refused by a safety rule.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../provision/lib/ip-guard.sh"
VERSION=""; UN=0; SHOST=""; SIP=""; SID=""; KEY=""; KH=""; ENVN="production"; USER_NAME="aicc"; CONFIRM=""; APPLY=0
RELDIR="/srv/aicc/shared/plugin-releases"
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;; --unyank) UN=1; shift ;; --stage-host) SHOST="${2:-}"; shift 2 ;; --stage-ip) SIP="${2:-}"; shift 2 ;; --stage-id) SID="${2:-}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;; --known-hosts) KH="${2:-}"; shift 2 ;; --env) ENVN="${2:-}"; shift 2 ;; --user) USER_NAME="${2:-}"; shift 2 ;; --confirm-production) CONFIRM="${2:-}"; shift 2 ;; --apply) APPLY=1; shift ;;
    -h|--help) sed -n 2,16p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 3; }
case "$ENVN" in production|stage) ;; *) echo "--env must be production or stage" >&2; exit 2 ;; esac
[ -n "$VERSION" ] && [ -n "$SHOST" ] && [ -n "$SIP" ] && [ -n "$SID" ] && [ -n "$KEY" ] || { echo "usage: --version X.Y.Z --stage-host H --stage-ip IP --stage-id ID --key K" >&2; exit 2; }
[[ "$VERSION" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$ ]] || refuse "--version must be a strict X.Y.Z"
[[ "$SIP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || refuse "--stage-ip must be a literal IPv4 address"
aicc_ip_guard "$SIP" "--stage-ip " || exit 3
for d in 139.59.157.231 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153; do [ "$SIP" = "$d" ] && refuse "$SIP is the API Droplet or a GitHub Pages address, not a Control Plane host"; done
[[ "$SID" =~ ^[0-9a-f]{32}$ ]] || refuse "--stage-id must be 32 lowercase hex characters"
[ -f "$KEY" ] && grep -q "PRIVATE KEY" "$KEY" 2>/dev/null || refuse "$KEY is not a private key file"
case "$KEY" in *aicc_digitalocean_prod*) refuse "never use the API Droplet's key" ;; esac
if [ "$ENVN" = production ]; then
  [ "$SHOST" = "www.copilt.org" ] || refuse "--env production acts on the host named exactly www.copilt.org (got $SHOST)"
  case "$(basename "$KEY")" in aicc_cp_prod*) ;; *) refuse "the production key file must be named aicc_cp_prod* (got $(basename "$KEY"))" ;; esac
  [ -n "$KH" ] && [ -s "$KH" ] || refuse "--env production needs --known-hosts FILE holding the pinned host key (no trust on first use)"
  ssh-keygen -F "$SIP" -f "$KH" >/dev/null 2>&1 || refuse "the pinned known-hosts file has no entry for $SIP"
  [ "$CONFIRM" = "$VERSION" ] || refuse "--confirm-production must equal the version ($VERSION): a conscious per-version step"
  SHK=yes
else
  case "$SHOST" in www.copilt.org|copilt.org|api.copilt.org) refuse "$SHOST is a production hostname" ;; esac
  [[ "$SHOST" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || refuse "--stage-host must be a stage*.copilt.org name"
  case "$KEY" in *aicc_cp_prod*) refuse "the production key is not used for staging" ;; esac
  SHK=accept-new; [ -n "$KH" ] || KH="$HOME/.ssh/known_hosts_aicc_stage"
fi
ACT=yank; [ "$UN" = 0 ] || ACT=unyank
if [ "$APPLY" != 1 ]; then
  cat <<EOT
DRY-RUN plan ($ENVN; local checks passed; nothing sent):
  1. ssh $USER_NAME@$SIP (key $KEY, host key $SHK): read /etc/aicc-stage-identity, require production + $SHOST + $SID
  2. ssh: sudo python3 -I - $VERSION $RELDIR $ACT   (script on stdin): set "yanked": $([ "$UN" = 0 ] && echo true || echo false) in $RELDIR/$VERSION/ai-commerce-copilot-$VERSION.manifest.json, same owner/group/mode, atomically
  3. ssh: read it back through WordPress (AICC_LM_Release_Store::manifest)
  action: $ACT $VERSION   (add --apply to run it)
EOT
  exit 0
fi
SSH_OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking="$SHK" -o UserKnownHostsFile="$KH")
ident="$(ssh "${SSH_OPTS[@]}" "$USER_NAME@$SIP" 'cat /etc/aicc-stage-identity' 2>/dev/null)" || { echo "cannot read the host identity over SSH (host down, wrong key, host key not pinned)" >&2; exit 1; }
WANTENV=staging; [ "$ENVN" = production ] && WANTENV=production
echo "$ident" | grep -q "^AICC_ENV=${WANTENV}\$" || refuse "host does not say AICC_ENV=$WANTENV"
echo "$ident" | grep -q "^AICC_HOSTNAME=${SHOST}\$" || refuse "host identity AICC_HOSTNAME is not $SHOST"
echo "$ident" | grep -q "^AICC_STAGE_ID=${SID}\$" || refuse "host identity AICC_STAGE_ID does not match --stage-id: not the host this command was meant for"
echo "host identity OK ($SHOST, id matches)"
rc=0
ssh "${SSH_OPTS[@]}" "$USER_NAME@$SIP" "sudo python3 -I - $VERSION $RELDIR $ACT" <<'PY' || rc=$?
import json, os, re, stat, sys
ver, rdir, act = sys.argv[1:4]
def no(m): sys.stderr.write("yank: %s\n" % m); sys.exit(1)
if not re.fullmatch(r"\d{1,4}\.\d{1,4}\.\d{1,4}", ver) or act not in ("yank", "unyank"): no("bad arguments")
d = os.path.join(rdir, ver); p = os.path.join(d, "ai-commerce-copilot-%s.manifest.json" % ver)
if os.path.islink(d) or not os.path.isdir(d): no("version directory %s does not exist (or is a symlink)" % ver)
if os.path.islink(p) or not os.path.isfile(p): no("the manifest is not a regular file")
st = os.stat(p)
m = json.load(open(p))
if not isinstance(m, dict) or m.get("version") != ver or m.get("slug") != "ai-commerce-copilot": no("the manifest is not this release's")
if act == "yank": m["yanked"] = True
else: m.pop("yanked", None)
tmp = p + ".tmp-yank"
with open(tmp, "w") as f:
    json.dump(m, f, indent=2); f.write("\n"); f.flush(); os.fsync(f.fileno())
os.chown(tmp, st.st_uid, st.st_gid); os.chmod(tmp, stat.S_IMODE(st.st_mode))
os.replace(tmp, p)
print("%s %s: manifest rewritten (owner %d:%d mode %o)" % (act, ver, st.st_uid, st.st_gid, stat.S_IMODE(st.st_mode)))
PY
[ "$rc" = 0 ] || { echo "the host-side step failed (exit $rc); the manifest is unchanged unless the output above says otherwise" >&2; exit 1; }
got="$(ssh "${SSH_OPTS[@]}" "$USER_NAME@$SIP" "sudo aicc-wp eval 'echo json_encode( AICC_LM_Release_Store::manifest( \"$VERSION\" )[\"yanked\"] );'" 2>/dev/null | tail -1 | tr -d ' \r\n')" || got=""
want=true; [ "$UN" = 0 ] || want=false
[ "$got" = "$want" ] || { echo "WordPress reads yanked=${got:-?}, expected $want" >&2; exit 1; }
echo "VERIFIED through WordPress: $VERSION is now $([ "$UN" = 0 ] && echo YANKED || echo NOT yanked). Nothing was deleted; the signature is unaffected."
