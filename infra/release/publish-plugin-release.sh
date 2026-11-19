#!/usr/bin/env bash
# Publishes one AICC Plugin release into the Control Plane's PRIVATE release store ON THE HOST (AICC_LM_PLUGIN_RELEASE_DIR = /srv/aicc/shared/plugin-releases), or moves its `current`
# pointer (publish / roll forward / roll back). Runs ON THE MAC. The host-side installer is scripts/plugin-release/install-plugin-release.sh of the Control Plane (docs/plugin-delivery.md);
# this script verifies, transfers and calls it; it implements none of the installer's rules itself except the same local pre-checks, so a bad artifact is refused before any network access.
#
#   infra/release/publish-plugin-release.sh --zip <ai-commerce-copilot-X.zip> --manifest <...X.manifest.json> [--sha256-file <...X.zip.sha256>] --installer <install-plugin-release.sh>
#        --stage-host H --stage-ip IPV4 --stage-id <32 hex> [--signature <...X.manifest.sig>] [--plugin-dir <Plugin repo or build dir>] [--pubkeys <b64[,b64]>]
#        [--allow-unsigned (STAGING ONLY)] [--set-current] [--key K] [--user aicc] [--dry-run] [--check-only]
#   infra/release/publish-plugin-release.sh --point-at <version> --installer <install-plugin-release.sh> --stage-host H --stage-ip IPV4 --stage-id ID [--key K]      (roll back / forward; nothing uploaded but the installer)
#   PRODUCTION (--env production): --stage-host www.copilt.org, --key ~/.ssh/aicc_cp_prod*, --known-hosts <pinned file>, --confirm-production <the version>, and --apply.
#        WITHOUT --apply a production run is a DRY RUN (local verification + the plan; no network).
#
# SIGNED UPDATE CHANNEL (docs/launch/update-signing.md in the Plugin repo): the release must come with the owner's OFFLINE Ed25519 signature, ai-commerce-copilot-<version>.manifest.sig (made by the
# Plugin's `php bin/sign-release.php sign`; found next to the manifest or given with --signature). It is checked here as far as possible, uploaded next to the ZIP and the manifest, and passed to the
# host installer with --signature (which verifies it again BEFORE installing, and keeps it immutable). Local checks: the file is a regular file named for the manifest's version, is JSON with
# alg ed25519, a 64-byte base64 signature and a signing time; and, when the Plugin's tool and the owner's PUBLIC key list are available (--plugin-dir holding bin/sign-release.php and
# release/endpoints.conf UPDATE_PUBLIC_KEYS, or --pubkeys with --plugin-dir), `php bin/sign-release.php verify` must pass AND every public key baked into the ZIP must be on that list.
# --env production REFUSES a release whose signature could not be verified that way, and never accepts --allow-unsigned. Staging may publish an unsigned release only with the explicit
# --allow-unsigned flag (the store then never offers it to a merchant's updater). --point-at (roll back / forward) needs none of this: the installer re-verifies the installed signature.
#
# Local verification (refuses with exit 3 before any network access):
#   * the ZIP is named ai-commerce-copilot-<strict version>.zip; the manifest names the same slug/version/file name; SHA-256 and size of the ZIP equal the manifest's;
#     the .sha256 file (the build machine's second channel, `<hash>  <file name>`) equals them too; the manifest says dirty:false with a 40-hex built_from_commit (never a development build);
#   * the installer file is the Control Plane's install-plugin-release.sh (header check); its SHA-256 is printed and re-checked ON THE HOST before it is run as root;
#   * environment gates exactly as deploy-release.sh: stage host/IP/key rules, production host name, key name aicc_cp_prod*, pinned known_hosts (no trust on first use), the production API/GitHub Pages
#     addresses refused, and the host identity (AICC_ENV, AICC_HOSTNAME, AICC_STAGE_ID) read over ssh BEFORE anything is uploaded.
# On the host (as root through sudo): the installer re-validates everything (staged private copies, required --expect-sha256 = the value from the .sha256 file, clean-build manifest, immutable
# version directory, lock, atomic `current`), then this script reads the store back through WordPress (AICC_LM_Release_Store::configuration_problem() must be empty after --set-current).
# An installed version is never overwritten; publish a new version number. Exit codes: 0 ok, 1 failed, 2 usage, 3 refused by a safety rule.
# NEVER run against the live host without the owner's approval of that step (production-promotion.md 6.10).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../provision/lib/ip-guard.sh"
ZIP=""; MAN=""; SHAF=""; INSTALLER=""; SHOST=""; SIP=""; SID=""; KEY=""; USER_NAME="aicc"; ENVN="stage"; KNOWN_HOSTS=""; CONFIRM=""; APPLY=0; DRY=0; CHECK_ONLY=0; SETCUR=0; POINT=""
SIGARG=""; ALLOW_UNSIGNED=0; PLUGDIR=""; PUBKEYS=""
RELDIR="/srv/aicc/shared/plugin-releases"
DENY_IPS="139.59.157.231 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153"
while [ $# -gt 0 ]; do
  case "$1" in
    --zip) ZIP="${2:-}"; shift 2 ;; --manifest) MAN="${2:-}"; shift 2 ;; --sha256-file) SHAF="${2:-}"; shift 2 ;; --installer) INSTALLER="${2:-}"; shift 2 ;;
    --stage-host) SHOST="${2:-}"; shift 2 ;; --stage-ip) SIP="${2:-}"; shift 2 ;; --stage-id) SID="${2:-}"; shift 2 ;; --key) KEY="${2:-}"; shift 2 ;; --user) USER_NAME="${2:-}"; shift 2 ;;
    --env) ENVN="${2:-}"; shift 2 ;; --known-hosts) KNOWN_HOSTS="${2:-}"; shift 2 ;; --confirm-production) CONFIRM="${2:-}"; shift 2 ;; --apply) APPLY=1; shift ;;
    --dry-run) DRY=1; shift ;; --check-only) CHECK_ONLY=1; shift ;; --set-current) SETCUR=1; shift ;; --point-at) POINT="${2:-}"; shift 2 ;;
    --signature) SIGARG="${2:-}"; shift 2 ;; --allow-unsigned) ALLOW_UNSIGNED=1; shift ;; --plugin-dir) PLUGDIR="${2:-}"; shift 2 ;; --pubkeys) PUBKEYS="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,34p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 3; }
case "$ENVN" in stage|production) ;; *) echo "--env must be stage or production" >&2; exit 2 ;; esac
[ -n "$INSTALLER" ] && [ -n "$SHOST" ] && [ -n "$SIP" ] && [ -n "$SID" ] || { echo "usage: --installer FILE --stage-host H --stage-ip IP --stage-id ID (--zip Z --manifest M | --point-at VERSION)  (nothing is defaulted)" >&2; exit 2; }
VER_RE='^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$'
if [ -n "$POINT" ]; then
  [ -z "$ZIP$MAN$SHAF" ] || refuse "--point-at cannot be combined with --zip/--manifest/--sha256-file"
  [[ "$POINT" =~ $VER_RE ]] || refuse "--point-at: not a strict version: $POINT"
  [ -z "$SIGARG" ] && [ "$ALLOW_UNSIGNED" = 0 ] || refuse "--point-at takes neither --signature nor --allow-unsigned: the installer re-verifies the signature already installed with that version"
else
  [ -n "$ZIP" ] && [ -n "$MAN" ] || { echo "--zip and --manifest are required (or --point-at VERSION)" >&2; exit 2; }
  if [ "$ALLOW_UNSIGNED" = 1 ]; then
    [ "$ENVN" != production ] || refuse "--allow-unsigned is never accepted with --env production: the owner's signature is mandatory there"
    [ -z "$SIGARG" ] || refuse "--allow-unsigned together with --signature is ambiguous: give one"
  fi
fi
[[ "$SIP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || refuse "--stage-ip must be a literal IPv4 address"
aicc_ip_guard "$SIP" "--stage-ip " || exit 3
for d in $DENY_IPS; do [ "$SIP" = "$d" ] && refuse "$SIP is the API Droplet or a GitHub Pages address, not a Control Plane host"; done
if [ "$ENVN" = production ]; then
  [ "$SHOST" = "www.copilt.org" ] || refuse "--env production publishes to the host named exactly www.copilt.org (got $SHOST)"
  [ -n "$KEY" ] || { echo "--env production needs --key (aicc_cp_prod*)" >&2; exit 2; }
  case "$(basename "$KEY")" in aicc_cp_prod*) ;; *) refuse "the production key file must be named aicc_cp_prod* (got $(basename "$KEY"))" ;; esac
  [ -n "$KNOWN_HOSTS" ] && [ -s "$KNOWN_HOSTS" ] || refuse "--env production needs --known-hosts FILE holding the pinned host key (no trust on first use)"
  ssh-keygen -F "$SIP" -f "$KNOWN_HOSTS" >/dev/null 2>&1 || refuse "the pinned known-hosts file has no entry for $SIP"
  WANTV="${POINT:-}"
else
  [ -n "$KEY" ] || KEY="$HOME/.ssh/aicc_cp_stage"
  case "$SHOST" in www.copilt.org|copilt.org|api.copilt.org) refuse "$SHOST is a production hostname" ;; esac
  [[ "$SHOST" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || refuse "--stage-host must be a stage*.copilt.org name (got $SHOST)"
  case "$KEY" in *aicc_cp_prod*) refuse "the production key is not used for staging" ;; esac
fi
[[ "$SID" =~ ^[0-9a-f]{32}$ ]] || refuse "--stage-id must be 32 lowercase hex characters"
case "$KEY" in *aicc_digitalocean_prod*) refuse "never use the API Droplet's key" ;; esac
[ -f "$KEY" ] || { echo "no such key file: $KEY" >&2; exit 2; }
grep -q "PRIVATE KEY" "$KEY" 2>/dev/null || refuse "$KEY is not a private key file"
[[ "$USER_NAME" =~ ^[a-z][a-z0-9_-]{0,31}$ ]] || refuse "bad --user"

# ---- the installer (it will run as root on the host: be sure which file it is) ----------------------------------------------------------------
[ -f "$INSTALLER" ] || { echo "installer not found: $INSTALLER" >&2; exit 2; }
head -c 4096 "$INSTALLER" | grep -q '^# Install one AICC Plugin release into the Control Plane.s PRIVATE release store' || refuse "$INSTALLER is not the Control Plane's install-plugin-release.sh"
ISHA="$(shasum -a 256 "$INSTALLER" | cut -d' ' -f1)"

# ---- local verification of the artifact -----------------------------------------------------------------------------------------------------
VERSION=""; SHA=""; ZIPNAME=""
if [ -z "$POINT" ]; then
  [ -f "$ZIP" ] && [ -f "$MAN" ] || { echo "zip or manifest not found" >&2; exit 2; }
  VOUT="$(python3 -I - "$ZIP" "$MAN" "$SHAF" <<'PY'
import hashlib, json, os, re, sys
zip_path, man_path, shaf = sys.argv[1:4]
def fail(m): sys.stderr.write("REFUSED: " + m + "\n"); sys.exit(1)
m = json.load(open(man_path))
if not isinstance(m, dict) or m.get("slug") != "ai-commerce-copilot": fail("manifest slug is not ai-commerce-copilot")
v = m.get("version")
if not isinstance(v, str) or not re.fullmatch(r"\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?", v): fail("manifest version is not a strict version")
fn = "ai-commerce-copilot-%s.zip" % v
if m.get("filename") != fn or os.path.basename(zip_path) != fn: fail("file name mismatch: the ZIP must be %s and the manifest must say so" % fn)
if m.get("dirty") is not False: fail("the manifest does not say dirty:false: a development build is never published")
if not re.fullmatch(r"[0-9a-f]{40}", str(m.get("built_from_commit", ""))): fail("manifest built_from_commit is not a 40-hex commit")
h = hashlib.sha256(); n = 0
with open(zip_path, "rb") as f:
    for c in iter(lambda: f.read(1 << 20), b""): h.update(c); n += len(c)
if h.hexdigest() != m.get("sha256"): fail("the ZIP's SHA-256 differs from the manifest")
if n != m.get("size"): fail("the ZIP's size differs from the manifest")
if shaf:
    line = open(shaf).read().split()
    if len(line) != 2 or line[0] != h.hexdigest() or os.path.basename(line[1].lstrip("*")) != fn: fail("the .sha256 file does not match the ZIP (second channel disagrees)")
print(v, fn, h.hexdigest())
PY
)" || exit 3
  read -r VERSION ZIPNAME SHA <<< "$VOUT"
  [ -n "$VERSION" ] || refuse "artifact verification produced no result"
  [ -n "$SHAF" ] || echo "NOTE: no --sha256-file given: the expected hash is taken from the manifest, which travels with the ZIP. Pass the build machine's .sha256 file so a swapped ZIP+manifest pair is caught." >&2
  WANTV="$VERSION"
fi
# ---- production never carries a pre-release (launch-prep, round 3): the first customer version is 1.1.0 (owner decision); earlier Plugin heads carried 1.1.0-dev.N.
#      The production publish refuses a -dev/-rc/-beta version, for a new release and for --point-at alike (first-signed-release.sh stage 0 refuses one as well).
if [ "$ENVN" = production ]; then
  case "${POINT:-$VERSION}" in
    *-*) refuse "production publishes only release versions (X.Y.Z): '${POINT:-$VERSION}' is a pre-release/development version. Choose the first customer version (owner decision, recommended 1.1.0), bump the Plugin, rebuild and sign." ;;
  esac
fi
# ---- the owner's signature (A-02): present, sane, named for this version, verified against the owner's public key list where possible ----------------
SIGFILE=""; SIGNAME=""; SIGVERIFIED=0; SIGNOTE=""
if [ -z "$POINT" ]; then
  if [ "$ALLOW_UNSIGNED" = 1 ]; then
    echo "WARNING: publishing $VERSION WITHOUT a signature (--allow-unsigned, staging only): no merchant's updater will ever be offered it, and the Control Plane launch gate fails while it is current." >&2
    SIGNOTE="UNSIGNED (--allow-unsigned, staging only)"
  else
    SIGNAME="ai-commerce-copilot-$VERSION.manifest.sig"
    SIGFILE="${SIGARG:-${MAN%.json}.sig}"
    if [ ! -f "$SIGFILE" ] || [ -L "$SIGFILE" ]; then
      refuse "no signature: $SIGFILE is not a regular file. Sign the manifest OFFLINE first (php bin/sign-release.php sign --manifest ..., docs/launch/update-signing.md) and put the .manifest.sig next to it or pass --signature. Staging only: --allow-unsigned."
    fi
    [ "$(basename "$SIGFILE")" = "$SIGNAME" ] || refuse "the signature file is named $(basename "$SIGFILE") but must be $SIGNAME (the manifest's version): a signature made for another release"
    python3 -I - "$SIGFILE" <<'PY' || exit 3
import base64, json, os, re, sys
def fail(m): sys.stderr.write("REFUSED: signature file: " + m + "\n"); sys.exit(1)
p = sys.argv[1]
if os.path.getsize(p) > 4096: fail("too large to be a signature")
try: d = json.load(open(p))
except Exception: fail("not JSON")
if not isinstance(d, dict) or d.get("alg") != "ed25519": fail("alg is not ed25519")
s = d.get("signature")
try: raw = base64.b64decode(s, validate=True) if isinstance(s, str) and len(s) <= 128 else b""
except Exception: raw = b""
if len(raw) != 64: fail("the signature is not 64 base64-encoded bytes")
if not isinstance(d.get("issued_at"), str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", d["issued_at"]): fail("issued_at is missing or malformed")
if not isinstance(d.get("key_id"), str) or not re.fullmatch(r"[0-9a-f-]{1,64}", d["key_id"]): fail("key_id is missing or malformed")
PY
    # the owner's PUBLIC key list: --pubkeys, else release/endpoints.conf UPDATE_PUBLIC_KEYS of the Plugin build dir
    KEYS="$PUBKEYS"
    if [ -z "$KEYS" ] && [ -n "$PLUGDIR" ] && [ -f "$PLUGDIR/release/endpoints.conf" ]; then
      KEYS="$(sed -n 's/^UPDATE_PUBLIC_KEYS=//p' "$PLUGDIR/release/endpoints.conf" | head -1 | tr -d ' \r')"
    fi
    PHPBIN="${PHP_BIN:-php}"
    if [ -n "$KEYS" ] && [ -n "$PLUGDIR" ] && [ -f "$PLUGDIR/bin/sign-release.php" ] && command -v "$PHPBIN" >/dev/null 2>&1; then
      [[ "$KEYS" =~ ^[A-Za-z0-9+/]{43}=(,[A-Za-z0-9+/]{43}=)?$ ]] || refuse "the public key list is malformed (one or two base64 keys of 32 bytes, comma separated)"
      vout="$("$PHPBIN" "$PLUGDIR/bin/sign-release.php" verify --manifest "$MAN" --sig "$SIGFILE" --pubkeys "$KEYS" 2>&1)" || refuse "the signature does NOT verify against the owner's public key list: ${vout:-no reason}"
      # P41: the --pubkeys form of the verify tool never looks at the ZIP (it uses the ZIP only when --pubkeys is absent), so the ZIP is cross-checked by a second run: the tool re-hashes it against the manifest and verifies with the keys it bakes
      vzip="$("$PHPBIN" "$PLUGDIR/bin/sign-release.php" verify --manifest "$MAN" --sig "$SIGFILE" --zip "$ZIP" 2>&1)" || refuse "the signature does NOT verify against this ZIP and the public keys it bakes: ${vzip:-no reason}"
      python3 -I - "$ZIP" "$KEYS" <<'PY' || exit 3
import base64, re, sys, zipfile
def fail(m): sys.stderr.write("REFUSED: " + m + "\n"); sys.exit(1)
keys = {k.strip() for k in sys.argv[2].split(",") if k.strip()}
try:
    d = zipfile.ZipFile(sys.argv[1]).read("ai-commerce-copilot/includes/aicc-release-defaults.php").decode("utf-8", "replace")
except Exception: fail("the ZIP has no includes/aicc-release-defaults.php (not a release build)")
m = re.search(r"const PUBLIC_KEYS = '([A-Za-z0-9+/=,]*)';", d)
baked = {k.strip() for k in (m.group(1) if m else "").split(",") if k.strip()}
if not baked: fail("the ZIP carries no update-signing public key: a build that cannot verify its own updates is never published")
if not baked <= keys: fail("the ZIP bakes a public key that is not on the owner's list (UPDATE_PUBLIC_KEYS): refusing")
PY
      SIGVERIFIED=1; SIGNOTE="signature verified locally ($vout)"
      echo "$SIGNOTE"
    else
      if [ "$ENVN" = production ]; then
        refuse "the signature cannot be verified locally (needs --plugin-dir with bin/sign-release.php and release/endpoints.conf UPDATE_PUBLIC_KEYS - or --pubkeys - and php with sodium). Production never publishes a release it could not verify."
      fi
      SIGNOTE="signature present and well-formed; NOT verified locally (no Plugin tool / php here: the host installer verifies it against the public key list passed to it)"
      echo "NOTE: $SIGNOTE" >&2
    fi
  fi
fi
# ---- the trust anchor for the HOST installer (production 8) ----------------------------------------------------------------------------------------
# The host installer verifies the signature (on a new install and on --point-at) against the keys handed to it HERE, never against the keys inside the ZIP (a ZIP would be vouching for
# itself). They are the owner's PUBLIC list: --pubkeys, else release/endpoints.conf UPDATE_PUBLIC_KEYS of --plugin-dir, i.e. the same list the local verification above used.
if [ -z "${KEYS:-}" ]; then
  KEYS="$PUBKEYS"
  if [ -z "$KEYS" ] && [ -n "$PLUGDIR" ] && [ -f "$PLUGDIR/release/endpoints.conf" ]; then
    KEYS="$(sed -n 's/^UPDATE_PUBLIC_KEYS=//p' "$PLUGDIR/release/endpoints.conf" | head -1 | tr -d ' \r')"
  fi
fi
if [ -n "$KEYS" ]; then
  [[ "$KEYS" =~ ^[A-Za-z0-9+/]{43}=(,[A-Za-z0-9+/]{43}=)?$ ]] || refuse "the public key list is malformed (one or two base64 keys of 32 bytes, comma separated)"
fi
if [ -n "$SIGNAME" ] || [ -n "$POINT" ]; then
  if [ -z "$KEYS" ]; then
    if [ "$ENVN" = production ] || [ -n "$SIGNAME" ]; then
      refuse "no trusted public key list for the host installer: pass --pubkeys <primary,standby> or --plugin-dir <Plugin build dir with release/endpoints.conf>. The host installer no longer trusts the keys inside the ZIP, so it could not verify the signature (a point-at re-verifies the installed signature the same way)."
    fi
    echo "NOTE: no public key list given: the host installer will refuse --point-at for a release that has a signature installed." >&2
  fi
fi
if [ "$ENVN" = production ]; then
  [ "$CONFIRM" = "$WANTV" ] && [ -n "$CONFIRM" ] || refuse "--confirm-production must equal the version being published or pointed at ($WANTV): a conscious per-version step"
  [ "$APPLY" = 1 ] || DRY=1        # production is a dry run unless --apply
fi
if [ -n "$POINT" ]; then TARGET_DESC="point current at $POINT"; else TARGET_DESC="publish $VERSION ($ZIPNAME, sha256 ${SHA:0:16}...)"; if [ "$SETCUR" = 1 ]; then TARGET_DESC="$TARGET_DESC and make it current"; fi; fi

SHK=accept-new; KH="$HOME/.ssh/known_hosts_aicc_stage"; if [ "$ENVN" = production ]; then SHK=yes; KH="$KNOWN_HOSTS"; fi
SSH_OPTS=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking="$SHK" -o UserKnownHostsFile="$KH")
SSH=(ssh "${SSH_OPTS[@]}" -- "$USER_NAME@$SIP")
INC="plugin-incoming/${POINT:-$VERSION}"
INSTALL_ARGS="--release-dir $RELDIR --group aicc-cp"
if [ -n "$POINT" ]; then INSTALL_ARGS="$INSTALL_ARGS --point-at $POINT"
else
  SCFLAG=""; if [ "$SETCUR" = 1 ]; then SCFLAG=" --set-current"; fi
  INSTALL_ARGS="$INSTALL_ARGS --zip ~$USER_NAME/$INC/$ZIPNAME --manifest ~$USER_NAME/$INC/manifest.json --expect-sha256 $SHA$SCFLAG"
  if [ -n "$SIGNAME" ]; then INSTALL_ARGS="$INSTALL_ARGS --signature ~$USER_NAME/$INC/$SIGNAME"; fi
fi
# the owner's PUBLIC key list is the host installer's trust anchor for the signature it verifies (a new install and a --point-at alike)
if [ -n "$KEYS" ] && { [ -n "$POINT" ] || [ -n "$SIGNAME" ]; }; then INSTALL_ARGS="$INSTALL_ARGS --pubkeys $KEYS"; fi
if [ "$DRY" = 1 ]; then
  cat <<EOT
DRY-RUN plan ($ENVN; local verification passed; nothing sent):
  1. ssh $USER_NAME@$SIP (key $KEY, host key $SHK): read /etc/aicc-stage-identity, require $([ "$ENVN" = production ] && echo production || echo staging) + $SHOST + $SID
  2. rsync the installer (sha256 $ISHA)$([ -z "$POINT" ] && echo ", the ZIP and the manifest")$([ -n "$SIGNAME" ] && echo ", the signature $SIGNAME") -> ~$USER_NAME/$INC/ (0700)
  3. ssh: re-check the installer's sha256 on the host, then: sudo ~$USER_NAME/$INC/install-plugin-release.sh $INSTALL_ARGS
  4. ssh: read the store back through WordPress (AICC_LM_Release_Store::configuration_problem() must be empty$([ "$SETCUR" = 1 ] || [ -n "$POINT" ] || echo "; skipped: no --set-current, the release is only staged")), remove ~$USER_NAME/$INC
  action: $TARGET_DESC
$([ -z "$POINT" ] && echo "  signature: $SIGNOTE")
$([ "$ENVN" = production ] && [ "$APPLY" != 1 ] && echo "  (production: add --apply to run it)")
EOT
  exit 0
fi

# ---- remote identity (read-only) before anything is uploaded --------------------------------------------------------------------------------
ident="$("${SSH[@]}" 'cat /etc/aicc-stage-identity' 2>/dev/null)" || { echo "cannot read the host identity over SSH (host down, wrong key, host key not pinned)" >&2; exit 1; }
WANTENV=staging; [ "$ENVN" = production ] && WANTENV=production
echo "$ident" | grep -q "^AICC_ENV=${WANTENV}\$" || refuse "host does not say AICC_ENV=$WANTENV (a release for one environment never goes to the other)"
echo "$ident" | grep -q "^AICC_HOSTNAME=${SHOST}\$" || refuse "host identity AICC_HOSTNAME is not $SHOST"
echo "$ident" | grep -q "^AICC_STAGE_ID=${SID}\$" || refuse "host identity AICC_STAGE_ID does not match --stage-id: not the host this command was meant for"
echo "host identity OK ($SHOST, id matches)"
[ "$CHECK_ONLY" = 0 ] || { echo "check-only: nothing uploaded"; exit 0; }

# ---- upload, verify the installer on the host, run it ---------------------------------------------------------------------------------------
"${SSH[@]}" "umask 077; rm -rf ~/$INC && mkdir -p ~/$INC" || { echo "cannot create the incoming directory" >&2; exit 1; }
RSH="ssh ${SSH_OPTS[*]}"
rsync -a -e "$RSH" "$INSTALLER" "$USER_NAME@$SIP:$INC/install-plugin-release.sh"
if [ -z "$POINT" ]; then
  rsync -a -e "$RSH" "$ZIP" "$USER_NAME@$SIP:$INC/$ZIPNAME"
  rsync -a -e "$RSH" "$MAN" "$USER_NAME@$SIP:$INC/manifest.json"
  if [ -n "$SIGNAME" ]; then rsync -a -e "$RSH" "$SIGFILE" "$USER_NAME@$SIP:$INC/$SIGNAME"; fi
fi
"${SSH[@]}" "echo '$ISHA  $INC/install-plugin-release.sh' | sha256sum -c - >/dev/null" || { "${SSH[@]}" "rm -rf ~/$INC" || true; refuse "the installer on the host does not have the sha256 of the local file: transfer damaged or tampered; NOT executed"; }
rc=0
"${SSH[@]}" "sudo bash ~/$INC/install-plugin-release.sh $INSTALL_ARGS" || rc=$?
if [ "$rc" != 0 ]; then "${SSH[@]}" "rm -rf ~/$INC" || true; echo "the host-side installer refused or failed (exit $rc); the store is unchanged unless its output above says otherwise." >&2; exit 1; fi
if [ "$SETCUR" = 1 ] || [ -n "$POINT" ]; then
  want="${POINT:-$VERSION}"
  got="$("${SSH[@]}" "sudo cat $RELDIR/current" 2>/dev/null | tr -d ' \r\n')" || got=""
  [ "$got" = "$want" ] || { echo "the store's current pointer reads '${got:-nothing}', expected $want" >&2; exit 1; }
  prob="$("${SSH[@]}" "sudo aicc-wp eval 'echo AICC_LM_Release_Store::configuration_problem();'" 2>/dev/null)" || prob="(could not ask WordPress)"
  [ -z "$prob" ] || { echo "WordPress reports a problem with the store: $prob" >&2; exit 1; }
  echo "VERIFIED through WordPress: the release store is valid, current = $want"
fi
"${SSH[@]}" "rm -rf ~/$INC" || true
echo "DONE: $TARGET_DESC. Roll back with: $0 --point-at <previous version> ... (no file is ever deleted)"
