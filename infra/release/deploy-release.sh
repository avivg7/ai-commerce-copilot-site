#!/usr/bin/env bash
# Deploys a built release to the STAGING host (default) or, with --env production, to the PRODUCTION host through a tightened path. Runs ON THE MAC. Uses only the dedicated stage key. Fail closed: every refusal happens BEFORE any network access
# except the read-only identity check.
#
#   infra/release/deploy-release.sh --kind site|cp --artifact <release-out/kind-<id>.tar.gz> \
#        --stage-host stage.copilt.org --stage-ip <IPV4> --stage-id <32 hex> [--key ~/.ssh/aicc_cp_stage] [--user aicc] [--dry-run] [--check-only] [--first-install]
#   PRODUCTION (--env production; nothing in this repository has ever run it against a real production host, none exists yet):
#        --env production --kind site|cp --artifact ... --stage-host www.copilt.org --stage-ip <PRODUCTION IPV4> --stage-id <32 hex> --key ~/.ssh/aicc_cp_prod* \
#        --known-hosts <pinned known_hosts file with the production host key> --confirm-production <the release id> [--dry-run] [--check-only]
#      The same flags are reused so one implementation carries both environments; the production branch only ever TIGHTENS: the host name must be exactly www.copilt.org,
#      the address may not be one of the deny-listed public addresses (API Droplet, GitHub Pages), the key file must be named aicc_cp_prod*, the host
#      identity file must say AICC_ENV=production with this host name and id, a site artifact must be a PRODUCTION build (no identity route) from a clean commit, a cp artifact
#      must come from a clean commit, and --confirm-production must equal the release id (a per-release, conscious owner step: it cannot be pasted once and forgotten).
#      The connection always goes to --stage-ip: public DNS is never consulted, so a rehearsal or a deploy before the DNS cutover cannot reach the old site.
#
# REQUIRED explicit flags: --stage-host, --stage-ip, --stage-id (nothing is guessed or defaulted). In --env stage (the default) refused outright:
#   * 139.59.157.231 (production API Droplet) and the other public deny-list addresses; www.copilt.org, copilt.org, api.copilt.org and anything that is not stage*.copilt.org;
#   * the production key (any path containing aicc_digitalocean_prod); a key that is not a private-key file; SSH agent identities are not used (IdentitiesOnly);
#   * an artifact whose tarball hash differs from its manifest, whose files differ from SHA256SUMS, whose kind differs from --kind;
#   * a site artifact that is not a STAGE build carrying exactly this --stage-id (a production build has no identity file, so it can never reach the staging host);
#   * a host whose /etc/aicc-stage-identity does not say AICC_ENV=staging, AICC_HOSTNAME=<--stage-host>, AICC_STAGE_ID=<--stage-id>.
# Steps: verify artifact locally -> read-only identity check -> (cp) remote `aicc-backup --label pre-release` -> rsync the tree to
#   /srv/aicc/<kind>/releases/.incoming-<id>/ -> remote `sudo aicc-activate-release` (verify, dump gate, atomic swap, health gate, auto-rollback) -> (site) check the live identity endpoint.
# --dry-run: local checks only, prints the plan, no network. --check-only: local checks + the read-only identity check, nothing is uploaded.
# --first-install (cp only): the very first Control Plane release, before `wp core install`; the health gate then accepts WordPress' install redirect once.
# Exit codes: 0 ok, 1 failed, 2 usage, 3 refused by a safety rule; activate-release's own codes (3 rolled back, 4 critical) are reported as-is.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/release-common.sh
. "$HERE/lib/release-common.sh"
KIND=""; ART=""; SHOST=""; SIP=""; SID=""; KEY="$HOME/.ssh/aicc_cp_stage"; USER_NAME="aicc"; DRY=0; CHECK_ONLY=0; FIRST=0; ENVN="stage"; CONFIRM=""; KNOWN_HOSTS=""
STAGE_IPS="157.230.110.211 206.189.248.204"
DENY_IPS="139.59.157.231 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153"
. "$HERE/../provision/lib/ip-guard.sh"   # strict address check (security review L5)
while [ $# -gt 0 ]; do
  case "$1" in
    --kind) KIND="${2:-}"; shift 2 ;; --artifact) ART="${2:-}"; shift 2 ;; --stage-host) SHOST="${2:-}"; shift 2 ;; --stage-ip) SIP="${2:-}"; shift 2 ;;
    --stage-id) SID="${2:-}"; shift 2 ;; --key) KEY="${2:-}"; shift 2 ;; --user) USER_NAME="${2:-}"; shift 2 ;; --dry-run) DRY=1; shift ;; --check-only) CHECK_ONLY=1; shift ;; --first-install) FIRST=1; shift ;; --env) ENVN="${2:-}"; shift 2 ;; --known-hosts) KNOWN_HOSTS="${2:-}"; shift 2 ;; --confirm-production) CONFIRM="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,32p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 3; }
[ -n "$KIND" ] && [ -n "$ART" ] && [ -n "$SHOST" ] && [ -n "$SIP" ] && [ -n "$SID" ] || { echo "usage: $0 --kind site|cp --artifact FILE --stage-host H --stage-ip IP --stage-id ID  (all required, nothing is defaulted)" >&2; exit 2; }
case "$KIND" in site|cp) ;; *) echo "--kind must be site or cp" >&2; exit 2 ;; esac
case "$ENVN" in stage|production) ;; *) echo "--env must be stage or production" >&2; exit 2 ;; esac
[[ "$SIP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || refuse "--stage-ip must be a literal IPv4 address"
aicc_ip_guard "$SIP" "--stage-ip " || exit 3
if [ "$ENVN" = production ]; then
  [ "$SHOST" = "www.copilt.org" ] || refuse "--env production deploys to the host named exactly www.copilt.org (got $SHOST)"
  # Owner decision 2026-10-22: the EXISTING staging Droplet (STAGE_IPS) is promoted in place to the initial production host (docs/cutover/production-promotion.md), so its addresses
  # are no longer refused here. What stops a production release reaching a host that has NOT been promoted is the identity gate below (AICC_ENV=production + this host name + this id,
  # read from the host before anything is uploaded) together with the pinned host key. Only the API Droplet and the GitHub Pages addresses stay refused outright.
  for d in $DENY_IPS; do [ "$SIP" = "$d" ] && refuse "$SIP is the API Droplet or a GitHub Pages address: neither is the production Control Plane host."; done
  case "$(basename "$KEY")" in aicc_cp_prod*) ;; *) refuse "the production key file must be named aicc_cp_prod* (got $(basename "$KEY"))" ;; esac
  # the production host key must be PINNED beforehand (verified out of band, e.g. in the DigitalOcean console): no trust-on-first-use for the host that takes customer data
  [ -n "$KNOWN_HOSTS" ] && [ -s "$KNOWN_HOSTS" ] || refuse "--env production needs --known-hosts FILE holding the pinned host key of the production host (no trust on first use)"
  ssh-keygen -F "$SIP" -f "$KNOWN_HOSTS" >/dev/null 2>&1 || refuse "the pinned known-hosts file has no entry for $SIP"
else
  for d in $DENY_IPS; do [ "$SIP" = "$d" ] && refuse "$SIP is a production/public address, not the staging Droplet."; done
  case "$SHOST" in www.copilt.org|copilt.org|api.copilt.org) refuse "$SHOST is a production hostname." ;; esac
  [[ "$SHOST" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || refuse "--stage-host must be a stage*.copilt.org name (got $SHOST)"
  case "$KEY" in *aicc_cp_prod*) refuse "the production key is not used for staging." ;; esac
fi
[[ "$SID" =~ ^[0-9a-f]{32}$ ]] || refuse "--stage-id must be 32 lowercase hex characters"
case "$KEY" in *aicc_digitalocean_prod*) refuse "never use the API Droplet's key." ;; esac
[ -f "$KEY" ] || { echo "no such key file: $KEY" >&2; exit 2; }
grep -q "PRIVATE KEY" "$KEY" 2>/dev/null || refuse "$KEY is not a private key file"
[[ "$USER_NAME" =~ ^[a-z][a-z0-9_-]{0,31}$ ]] || refuse "bad --user"
case "$ART" in *.tar.gz) ;; *) echo "--artifact must be the .tar.gz produced by a build script" >&2; exit 2 ;; esac
[ -f "$ART" ] || { echo "artifact not found: $ART" >&2; exit 2; }
BASE="${ART%.tar.gz}"; MAN="$BASE.manifest.json"; SUMS="$BASE.SHA256SUMS"
[ -f "$MAN" ] && [ -f "$SUMS" ] || refuse "manifest/SHA256SUMS next to the artifact are missing"

# ---- local verification of the artifact ------------------------------------------------------------------------------------------------------
[ "$(jq -r '.kind' "$MAN")" = "$KIND" ] || refuse "artifact kind '$(jq -r '.kind' "$MAN")' is not '$KIND'"
ID="$(jq -r '.release_id' "$MAN")"; [[ "$ID" =~ $RELEASE_ID_RE ]] || refuse "manifest has a bad release id"
case "$(basename "$ART")" in "$KIND-$ID.tar.gz") ;; *) refuse "artifact file name does not match the manifest's release id" ;; esac
[ "$(sha256_of_file "$ART")" = "$(jq -r '.tarball.sha256' "$MAN")" ] || refuse "tarball SHA-256 differs from its manifest: the artifact was altered or corrupted"
if [ "$ENVN" = stage ]; then
  if [ "$KIND" = site ]; then [ "$(jq -r '.sources.target // empty' "$MAN")" = "stage" ] || refuse "this site artifact is not a stage build (target=$(jq -r '.sources.target // "none"' "$MAN")): production builds never go to staging"; fi
else
  [ "$CONFIRM" = "$ID" ] || refuse "--confirm-production must be the release id $ID (typed for THIS release)"
  [ "$(jq -r 'if .sources.dirty == false then "clean" else "not-clean" end' "$MAN")" = "clean" ] || refuse "the artifact was built from a dirty tree: a production release comes from a clean commit"
  if [ "$KIND" = site ]; then
    [ "$(jq -r '.sources.target // empty' "$MAN")" = "production" ] || refuse "this site artifact is not a PRODUCTION build (target=$(jq -r '.sources.target // "none"' "$MAN"))"
  fi
fi
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
python3 -I "$HERE/lib/release_tool.py" unpack --tarball "$ART" --dest "$WORK/tree" >/dev/null
verify_tree "$WORK/tree" "$SUMS" >/dev/null || refuse "the unpacked tree differs from SHA256SUMS"
# A release tree never carries a wp-config template (architecture review B-3: the production template is a record of required settings, not a usable file; staging renders its own on the host).
if [ -n "$(find "$WORK/tree" \( -name 'wp-config.production*' -o -name 'wp-config*.template*' \) -print | head -n 1)" ]; then refuse "the artifact contains a wp-config template: configuration is rendered on the host (render-wp-config.sh), never shipped in a release"; fi
if [ "$KIND" = site ] && [ "$ENVN" = stage ]; then
  grep -q "\"id\":\"$SID\"" "$WORK/tree/.well-known/aicc-stage-identity" 2>/dev/null || refuse "the site build carries no identity file for stage id $SID (built for another stage, or a production build)"
  grep -q "\"host\":\"$SHOST\"" "$WORK/tree/.well-known/aicc-stage-identity" || refuse "the site build was made for another host"
fi
if [ "$KIND" = site ] && [ "$ENVN" = production ]; then
  [ ! -e "$WORK/tree/.well-known/aicc-stage-identity" ] || refuse "a production site must not carry the staging identity route"
  # error pages are noindex by design: the edge's 404.html / 50x.html AND Next's own not-found routes (_not-found/index.html, 404/index.html: found on the first real production deploy)
  if find "$WORK/tree" -type f -name '*.html' ! -name '404.html' ! -name '50x.html' ! -path '*/_not-found/index.html' ! -path '*/404/index.html' -exec grep -qi 'noindex' {} + 2>/dev/null; then refuse "the production site tree contains a noindex robots meta outside the error pages"; fi
  if [ -f "$WORK/tree/robots.txt" ] && grep -qiE '^Disallow:[[:space:]]*/[[:space:]]*$' "$WORK/tree/robots.txt"; then refuse "robots.txt blocks everything: this looks like a stage build"; fi
fi
echo "artifact OK: $KIND $ID ($(jq -r '.file_count' "$MAN") files, tarball sha256 $(jq -r '.tarball.sha256' "$MAN" | cut -c1-16)...)"

if [ "$ENVN" = production ]; then SHK=yes; KH="$KNOWN_HOSTS"; else SHK=accept-new; KH="$HOME/.ssh/known_hosts_aicc_stage"; fi
SSH_OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking="$SHK" -o UserKnownHostsFile="$KH")
SSH=(ssh "${SSH_OPTS[@]}" "$USER_NAME@$SIP")
RDIR="/srv/aicc/$KIND/releases"
if [ "$DRY" = 1 ]; then
  cat <<EOT
DRY-RUN plan (nothing sent):
  1. ssh $USER_NAME@$SIP (key $KEY): read /etc/aicc-stage-identity, require staging + $SHOST + $SID
  2. $( [ "$KIND" = cp ] && echo "ssh: sudo aicc-backup --label pre-release   (the activation gate needs a dump younger than 15 minutes)" || echo "(site: no database step)")
  3. rsync -a --delete --partial -z tree/ -> $RDIR/.incoming-$ID/   (+ manifest and SHA256SUMS)
  4. ssh: sudo aicc-activate-release --kind $KIND --release-id $ID   (verify, atomic swap, health gate, auto-rollback)
EOT
  exit 0
fi

# ---- remote identity (read-only) -----------------------------------------------------------------------------------------------------------
ident="$("${SSH[@]}" 'cat /etc/aicc-stage-identity' 2>/dev/null)" || { echo "cannot read the host identity over SSH (host down, wrong key, or not the staging host)" >&2; exit 1; }
if [ "$ENVN" = production ]; then echo "$ident" | grep -q '^AICC_ENV=production$' || refuse "host does not say AICC_ENV=production (a staging or unknown host can never receive a production release)"
else echo "$ident" | grep -q '^AICC_ENV=staging$' || refuse "host does not say AICC_ENV=staging"; fi
echo "$ident" | grep -q "^AICC_HOSTNAME=${SHOST}\$" || refuse "host identity AICC_HOSTNAME is not $SHOST"
echo "$ident" | grep -q "^AICC_STAGE_ID=${SID}\$" || refuse "host identity AICC_STAGE_ID does not match --stage-id: this is not the staging host this build was made for"
echo "host identity OK ($SHOST, stage id matches)"
[ "$CHECK_ONLY" = 0 ] || { echo "check-only: nothing uploaded"; exit 0; }

# ---- upload and activate --------------------------------------------------------------------------------------------------------------------
if [ "$KIND" = cp ]; then
  echo "taking the pre-release dump ..."
  "${SSH[@]}" 'sudo /usr/local/sbin/aicc-backup --label pre-release' || { echo "pre-release backup FAILED: not deploying" >&2; exit 1; }
fi
RSH="ssh ${SSH_OPTS[*]}"
rsync -a --delete --partial -z -e "$RSH" "$WORK/tree"/ "$USER_NAME@$SIP:$RDIR/.incoming-$ID/"
rsync -a -e "$RSH" "$MAN" "$USER_NAME@$SIP:$RDIR/.incoming-$ID.manifest.json"
rsync -a -e "$RSH" "$SUMS" "$USER_NAME@$SIP:$RDIR/.incoming-$ID.SHA256SUMS"
rc=0
EXTRA=""; [ "$FIRST" = 1 ] && [ "$KIND" = cp ] && EXTRA=" --allow-uninstalled"
"${SSH[@]}" "sudo /usr/local/sbin/aicc-activate-release --kind $KIND --release-id $ID$EXTRA" || rc=$?
case "$rc" in
  0) echo "ACTIVATED: $KIND $ID" ;;
  3) echo "ROLLED BACK by the health gate: $KIND $ID was NOT kept live (see the host's $RDIR/$ID.FAILED and journal)." >&2; exit 3 ;;
  4) echo "CRITICAL: the new release failed and the rollback is ALSO unhealthy. Act now: sudo aicc-rollback-release --kind $KIND --to <id> or restore; see RUNBOOK." >&2; exit 4 ;;
  *) echo "activation failed (exit $rc); nothing was swapped unless the output above says so." >&2; exit 1 ;;
esac
if [ "$KIND" = site ] && [ "$ENVN" = stage ]; then
  live="$(curl -fksS --max-time 10 --resolve "$SHOST:443:$SIP" "https://$SHOST/.well-known/aicc-stage-identity" 2>/dev/null || true)"
  if echo "$live" | grep -q "\"id\":\"$SID\""; then echo "live identity endpoint matches (certificate not verified by this check): https://$SHOST/.well-known/aicc-stage-identity"
  else echo "NOTE: the live identity endpoint did not answer with this stage id (the edge may not be running yet: expected on the very first deploy)." >&2; fi
fi
echo "rollback if needed: ssh ... 'sudo aicc-rollback-release --kind $KIND'"
