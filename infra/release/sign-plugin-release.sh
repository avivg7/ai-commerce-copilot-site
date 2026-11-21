#!/usr/bin/env bash
# OFFLINE SIGNING of one AICC Plugin release, on the owner's vault Mac. The owner-facing, minimal, safe form of `bin/sign-release.php sign` + `verify` (docs/cutover/p41-plugin-publication.md section 2).
# It refuses anything that is not exactly the release the coordinator handed over, signs with the vault key, and then proves the signature the way a customer's store and the Control Plane will.
#
#   AICC_RELEASE_SIGNING_KEY_FILE=<vault key file, mode 0600, yours>  \
#   sign-plugin-release.sh --plugin-dir <Plugin checkout at the release commit> --zip <ai-commerce-copilot-X.zip> --manifest <...X.manifest.json> \
#        --version X.Y.Z --sha256 <64 hex from the coordinator: SECOND channel> --commit <the release commit, 7-40 hex> --primary-fp <xxxx-xxxx-xxxx-xxxx: the primary key's fingerprint you read from keygen>
#        [--pubkeys <b64,b64>]   (default: release/endpoints.conf UPDATE_PUBLIC_KEYS of --plugin-dir: primary FIRST, then the standby)   [--sig-out <file>]  (default: next to the manifest, named for the version)
#
# The secret key is only ever a FILE named by the environment variable (never an argument, never printed, never copied). Nothing is sent anywhere; no network is used.
# Refuses (exit 3, nothing written): a key file that is a symlink, not yours, or readable/writable by group/other; a Plugin checkout that is not clean or not at --commit; a manifest that is not dirty:false, not
# built from that commit, not for --version; a ZIP whose SHA-256 or size differs from the manifest or from --sha256; a ZIP whose baked public-key list is not exactly the owner's list; a --primary-fp that is not
# the first key of that list; an existing signature file (it never overwrites one); a pre-release version.
# Then: sign (the Plugin tool itself re-checks ZIP vs manifest and that the ZIP carries the signing key's public half); the signature must name --primary-fp (a signature by the standby key is removed:
# that is for an emergency only); and four verifications with the Plugin repo's own tool (the fixed tool of P44 checks a supplied --zip also with --pubkeys; the --zip-alone form stays for older checkouts):
#   (1) --pubkeys <list>   (2) --zip <ZIP>   (3) --pubkeys <the primary alone>   (4) --pubkeys <list> AND --zip <ZIP>   and tamper controls: a manifest one byte larger, and a ZIP one byte larger (an old tool that accepts it is refused), must NOT verify.
# TRUST, stated plainly: this script runs PHP code that lives in --plugin-dir (bin/sign-release.php and includes/class-aicc-release-signature.php) with AICC_RELEASE_SIGNING_KEY_FILE in its environment, so a tampered
# checkout could read the key. What protects you: the checkout must be CLEAN and at the commit the coordinator gave you over a SECOND channel (--commit), the manifest must have been built from exactly that commit, and
# --primary-fp is the fingerprint YOU read from keygen (independent of anything in the checkout): a signature by any other key is removed. Use a checkout you fetched yourself (git clone / git fetch from the repository,
# then `git rev-parse HEAD` equal to the announced commit), never a folder somebody sent you. Temp files (the unverified signature, the tamper-control copy) are removed on EVERY exit, including a refusal or a failure.
# Exit codes: 0 signed and verified; 1 a signing/verification step failed (any signature written is removed); 2 usage; 3 refused by a safety rule.
set -euo pipefail
TMPSIG=""; TD=""
cleanup() { [ -z "$TMPSIG" ] || rm -f "$TMPSIG"; [ -z "$TD" ] || rm -rf "$TD"; }
trap cleanup EXIT
PLUG=""; ZIP=""; MAN=""; VERSION=""; SHA=""; COMMIT=""; FP=""; KEYS=""; SIGOUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --plugin-dir) PLUG="${2:-}"; shift 2 ;; --zip) ZIP="${2:-}"; shift 2 ;; --manifest) MAN="${2:-}"; shift 2 ;; --version) VERSION="${2:-}"; shift 2 ;; --sha256) SHA="${2:-}"; shift 2 ;;
    --commit) COMMIT="${2:-}"; shift 2 ;; --primary-fp) FP="${2:-}"; shift 2 ;; --pubkeys) KEYS="${2:-}"; shift 2 ;; --sig-out) SIGOUT="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,21p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 3; }
fail()   { echo "FAILED: $*" >&2; exit 1; }
[ -n "$PLUG" ] && [ -n "$ZIP" ] && [ -n "$MAN" ] && [ -n "$VERSION" ] && [ -n "$SHA" ] && [ -n "$COMMIT" ] && [ -n "$FP" ] || { echo "usage: see the header (all of --plugin-dir --zip --manifest --version --sha256 --commit --primary-fp are required)" >&2; exit 2; }
[[ "$VERSION" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$ ]] || refuse "--version must be X.Y.Z with no -dev/-rc suffix (a pre-release is never signed for customers)"
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || refuse "--sha256 must be 64 lowercase hex characters"
[[ "$COMMIT" =~ ^[0-9a-f]{7,40}$ ]] || refuse "--commit must be 7-40 hex characters"
[[ "$FP" =~ ^[0-9a-f]{4}(-[0-9a-f]{4}){3}$ ]] || refuse "--primary-fp must look like 9d49-041f-0ced-13ac"
command -v php >/dev/null 2>&1 && php -r 'exit(function_exists("sodium_crypto_sign_detached")?0:1);' || refuse "php with ext-sodium is required"
KEYFILE="${AICC_RELEASE_SIGNING_KEY_FILE:-}"
[ -n "$KEYFILE" ] || refuse "set AICC_RELEASE_SIGNING_KEY_FILE to the vault key file (an environment variable, never an argument)"
[ -f "$KEYFILE" ] && [ ! -L "$KEYFILE" ] || refuse "the key file is not a regular file (or is a symlink)"
kmode="$(stat -f '%Lp' "$KEYFILE" 2>/dev/null || stat -c '%a' "$KEYFILE")"
[ $(( 8#$kmode & 8#077 )) -eq 0 ] || refuse "the key file's mode $kmode lets group/other read or write it (chmod 600 it)"
[ "$(stat -f '%u' "$KEYFILE" 2>/dev/null || stat -c '%u' "$KEYFILE")" = "$(id -u)" ] || refuse "the key file is not owned by you"
TOOL="$PLUG/bin/sign-release.php"
[ -f "$TOOL" ] && [ -f "$PLUG/includes/class-aicc-release-signature.php" ] || refuse "--plugin-dir is not a Plugin checkout (no bin/sign-release.php)"
git -C "$PLUG" rev-parse --git-dir >/dev/null 2>&1 || refuse "--plugin-dir is not a git checkout"
HEADSHA="$(git -C "$PLUG" rev-parse HEAD)"
case "$HEADSHA" in "$COMMIT"*) ;; *) refuse "the Plugin checkout is at ${HEADSHA:0:12}, not at the release commit $COMMIT" ;; esac
[ -z "$(git -C "$PLUG" status --porcelain)" ] || refuse "the Plugin checkout is not clean (git status shows changes): sign only a clean checkout of the release commit"
[ -f "$ZIP" ] && [ -f "$MAN" ] || refuse "the ZIP or the manifest does not exist"
[ "$(basename "$ZIP")" = "ai-commerce-copilot-$VERSION.zip" ] || refuse "the ZIP must be named ai-commerce-copilot-$VERSION.zip"
[ -n "$SIGOUT" ] || SIGOUT="${MAN%.json}.sig"
[ "$(basename "$SIGOUT")" = "ai-commerce-copilot-$VERSION.manifest.sig" ] || refuse "the signature file must be named ai-commerce-copilot-$VERSION.manifest.sig (the publisher requires that name)"
[ ! -e "$SIGOUT" ] || refuse "$SIGOUT already exists: this script never overwrites a signature (move it away if you are sure)"
if [ -z "$KEYS" ]; then KEYS="$(sed -n 's/^UPDATE_PUBLIC_KEYS=//p' "$PLUG/release/endpoints.conf" | head -1 | tr -d ' \r')"; fi
[[ "$KEYS" =~ ^[A-Za-z0-9+/]{43}=(,[A-Za-z0-9+/]{43}=)?$ ]] || refuse "the public key list is not one or two base64 32-byte keys"
PRIMARY="${KEYS%%,*}"
# manifest, ZIP and the owner's list must be one consistent thing
python3 -I - "$MAN" "$ZIP" "$VERSION" "$SHA" "$HEADSHA" "$KEYS" <<'PY' || exit 3
import hashlib, json, re, sys, zipfile
man, zp, ver, sha, head, keys = sys.argv[1:7]
def no(m): sys.stderr.write("REFUSED: %s\n" % m); sys.exit(1)
m = json.load(open(man))
if m.get("slug") != "ai-commerce-copilot" or m.get("version") != ver: no("the manifest is not for ai-commerce-copilot %s" % ver)
if m.get("dirty") is not False: no("the manifest does not say dirty:false (a development build is never signed)")
if m.get("built_from_commit") != head: no("the manifest was built from %s, not from the checkout's commit %s" % (str(m.get("built_from_commit"))[:12], head[:12]))
if m.get("sha256") != sha: no("the manifest's SHA-256 differs from the one the coordinator gave you")
h = hashlib.sha256(); n = 0
with open(zp, "rb") as f:
    for c in iter(lambda: f.read(1 << 20), b""): h.update(c); n += len(c)
if h.hexdigest() != sha or n != m.get("size"): no("the ZIP's SHA-256 or size differs from the manifest / the coordinator's value")
d = zipfile.ZipFile(zp).read("ai-commerce-copilot/includes/aicc-release-defaults.php").decode("utf-8", "replace")
k = re.search(r"const PUBLIC_KEYS = '([^']*)';", d)
if not k or k.group(1) != keys: no("the ZIP bakes the public keys '%s', not exactly the owner's list" % (k.group(1) if k else "(none)"))
PY
PRIMARY_FP="$(php -r 'define("ABSPATH","/x/"); require $argv[1]."/includes/class-aicc-release-signature.php"; echo AICC_Release_Signature::fingerprint(base64_decode($argv[2], true));' "$PLUG" "$PRIMARY")"
[ "$PRIMARY_FP" = "$FP" ] || refuse "--primary-fp $FP is not the fingerprint of the FIRST key of the list ($PRIMARY_FP): wrong list, or you read the standby's fingerprint"
TMPSIG="$SIGOUT.tmp.$$"
# a manifest-only key the Plugin tool uses for its own checks: it signs ONLY what it has verified
sout="$(php "$TOOL" sign --manifest "$MAN" --zip "$ZIP" --sig-out "$TMPSIG" 2>&1)" || fail "the Plugin signing tool refused: ${sout##*sign-release: }"
case "$sout" in *"with key $FP "*) ;; *) fail "the signature was NOT made by the primary key $FP (the tool said: ${sout%% ->*}): removed. Signing with the standby is an emergency step."; esac
v1="$(php "$TOOL" verify --manifest "$MAN" --sig "$TMPSIG" --pubkeys "$KEYS" 2>&1)" || fail "verify against the owner's key list failed: $v1"
v2="$(php "$TOOL" verify --manifest "$MAN" --sig "$TMPSIG" --zip "$ZIP" 2>&1)" || fail "verify against the ZIP's own baked keys failed: $v2"
v3="$(php "$TOOL" verify --manifest "$MAN" --sig "$TMPSIG" --pubkeys "$PRIMARY" 2>&1)" || fail "the signature does not verify with the primary public key alone: $v3"
# (4) the zip-aware strict form (needs the fixed Plugin tool, P44): --pubkeys <owner list> AND --zip: the ZIP is checked against the manifest and the owner's list is the trusted set
v4="$(php "$TOOL" verify --manifest "$MAN" --sig "$TMPSIG" --pubkeys "$KEYS" --zip "$ZIP" 2>&1)" || fail "the zip-aware verify (--pubkeys AND --zip) failed: $v4"
TD="$(mktemp -d "${TMPDIR:-/tmp}/aicc-sign.XXXXXX")"
# tool self-test: a Plugin checkout whose sign-release.php ignores --zip when --pubkeys is given (before P44) would let a tampered ZIP through that form: refuse to rely on it
cp "$ZIP" "$TD/tampered.zip"; printf 'x' >> "$TD/tampered.zip"
if php "$TOOL" verify --manifest "$MAN" --sig "$TMPSIG" --pubkeys "$KEYS" --zip "$TD/tampered.zip" >/dev/null 2>&1; then fail "this Plugin checkout's bin/sign-release.php accepts a TAMPERED ZIP with --pubkeys AND --zip (it predates the fix): the signature was removed; use a Plugin checkout from the P44 release line (the commit the coordinator announced), not an older one"; fi
python3 -I - "$MAN" "$TD/m.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1])); m["size"] = int(m["size"]) + 1; json.dump(m, open(sys.argv[2], "w"))
PY
if php "$TOOL" verify --manifest "$TD/m.json" --sig "$TMPSIG" --pubkeys "$KEYS" >/dev/null 2>&1; then fail "a TAMPERED manifest verified with this signature: stop and investigate"; fi
rm -rf "$TD"; TD=""
mv "$TMPSIG" "$SIGOUT"; TMPSIG=""
echo "SIGNED  $VERSION  key $FP  (the primary)"
echo "  $v1"
echo "  $v2"
echo "  $v3"
echo "  $v4"
echo "  tamper control: a manifest one byte larger is NOT accepted by this signature; a ZIP one byte larger is NOT accepted by the zip-aware verify"
echo "  signature file (public, not secret): $SIGOUT"
echo "  sha256 of the signature file: $(shasum -a 256 "$SIGOUT" | cut -d' ' -f1)"
echo "Next: back up that file; unmount the vault; hand ONLY the .manifest.sig to the coordinator."
