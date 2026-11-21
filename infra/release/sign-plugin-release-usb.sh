#!/usr/bin/env bash
# THE approved command to sign one private AICC Plugin release with the PASSWORDLESS, possession-based USB key (P45; docs/release/usb-signing-threat-model.md). Offline: nothing is sent anywhere.
# There is no password prompt and no unlock step of any kind. The only thing you type is the confirmation phrase this script prints.
#
#   sign-plugin-release-usb.sh --usb /Volumes/<STICK> --role primary --plugin-dir <clean Plugin checkout at the release commit> \
#        --zip <ai-commerce-copilot-X.zip> --manifest <...X.manifest.json> --version X.Y.Z --sha256 <64 hex, second channel> --commit <release commit> \
#        --primary-fp <xxxx-xxxx-xxxx-xxxx> --expect-volume-uuid <the stick's volume UUID from the handover>
#        [--pubkeys <b64,b64>]  (default: release/endpoints.conf UPDATE_PUBLIC_KEYS of --plugin-dir, primary FIRST)  [--sig-out <file>]  [--eject]
#   Emergency only (documented in the threat model): --role standby --emergency-standby --standby-fp <fp> --emergency-reason "<why the primary cannot sign>"; it has its own confirmation phrase.
#
# What it proves BEFORE it signs (any failure: exit 3, nothing written):
#   the volume is a PHYSICAL removable USB stick (diskutil: USB bus, not internal, not a disk image, not network/cloud/repo path), judged by the device and NOT by its label; the volume UUID equals the one in the stick's
#   identity file AND the one you pass (--expect-volume-uuid: a duplicate label or a copied folder fails); the key file is at the fixed path, a regular file, not a symlink; the PUBLIC key derived from the private key
#   (a fresh computation in PHP/libsodium, not the stored half) equals the PRIMARY key of the trusted list, its fingerprint equals the identity file and --primary-fp (the standby key never signs a normal release);
#   the Plugin checkout is clean at exactly --commit; the manifest is dirty:false, for --version, built from that commit, with --sha256; the ZIP's size/SHA-256 equal the manifest's and it bakes exactly the trusted list;
#   no signature exists yet; where the filesystem enforces permissions the key file is 0600 and yours (FAT32 does not: you get a WARNING that possession is the only protection).
# Then: the typed phrase  SIGN <version> <first 8 of the ZIP's sha256>;  sign;  verify with the zip-aware strict form (--pubkeys AND --zip) and the others; the tamper controls (manifest, ZIP) and a WRONG-KEY negative control.
# The stick is only READ (this script writes nothing to it). The secret is read inside PHP, zeroed, never printed, never copied, never an argument or environment value; umask 077, ulimit -c 0, no xtrace, no history;
# temp files only in a mktemp directory removed on EVERY exit path. Finally: eject the stick (--eject does it) and put it back in its place.
# TRUST, stated plainly: this script runs PHP code from --plugin-dir (the signature class) while the key is readable; the checkout must be CLEAN at the pinned commit you fetched yourself (as in P44). Malware on this Mac
# could use the key while the stick is attached: sign from a clean checkout, then eject at once. Anyone who physically holds the stick can sign: there is no cryptographic protection against the possessor.
# Exit codes: 0 signed and verified; 1 a signing/verification step failed (any signature written is removed); 2 usage; 3 refused by a safety rule.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/usb-common.sh
. "$HERE/lib/usb-common.sh"
usb_hygiene
TD=""; TMPSIG=""
cleanup() { [ -z "$TMPSIG" ] || rm -f "$TMPSIG"; [ -z "$TD" ] || rm -rf "$TD"; return 0; }
trap cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 129' HUP
USB=""; ROLE=""; PLUG=""; ZIP=""; MAN=""; VERSION=""; SHA=""; COMMIT=""; FP=""; KEYS=""; SIGOUT=""; EXPUUID=""; EMERG=0; STBFP=""; REASON=""; EJECT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --usb) USB="${2:-}"; shift 2 ;; --role) ROLE="${2:-}"; shift 2 ;; --plugin-dir) PLUG="${2:-}"; shift 2 ;; --zip) ZIP="${2:-}"; shift 2 ;; --manifest) MAN="${2:-}"; shift 2 ;;
    --version) VERSION="${2:-}"; shift 2 ;; --sha256) SHA="${2:-}"; shift 2 ;; --commit) COMMIT="${2:-}"; shift 2 ;; --primary-fp) FP="${2:-}"; shift 2 ;; --pubkeys) KEYS="${2:-}"; shift 2 ;;
    --sig-out) SIGOUT="${2:-}"; shift 2 ;; --expect-volume-uuid) EXPUUID="${2:-}"; shift 2 ;; --emergency-standby) EMERG=1; shift ;; --standby-fp) STBFP="${2:-}"; shift 2 ;;
    --emergency-reason) REASON="${2:-}"; shift 2 ;; --eject) EJECT=1; shift ;;
    -h|--help) sed -n 2,26p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$USB" ] && [ -n "$ROLE" ] && [ -n "$PLUG" ] && [ -n "$ZIP" ] && [ -n "$MAN" ] && [ -n "$VERSION" ] && [ -n "$SHA" ] && [ -n "$COMMIT" ] || { echo "usage: see the header (--usb --role --plugin-dir --zip --manifest --version --sha256 --commit and --primary-fp are required)" >&2; exit 2; }
case "$ROLE" in primary|standby) ;; *) echo "--role must be primary (normal) or standby (emergency only)" >&2; exit 2 ;; esac
if [ "$ROLE" = primary ]; then
  [ "$EMERG" = 0 ] || usb_refuse "--emergency-standby only goes with --role standby"
  [ -n "$FP" ] || { echo "--primary-fp is required" >&2; exit 2; }
else
  [ "$EMERG" = 1 ] || usb_refuse "the STANDBY key never signs a normal release. It is for an emergency only: add --emergency-standby --standby-fp <fp> --emergency-reason \"...\" (docs/release/usb-signing-threat-model.md)"
  [ -n "$STBFP" ] && [ -n "$REASON" ] || usb_refuse "an emergency standby signing needs --standby-fp and --emergency-reason"
  FP="$STBFP"
fi
[[ "$VERSION" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$ ]] || usb_refuse "--version must be X.Y.Z with no -dev/-rc suffix (a pre-release is never signed for customers)"
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || usb_refuse "--sha256 must be 64 lowercase hex characters"
[[ "$COMMIT" =~ ^[0-9a-f]{7,40}$ ]] || usb_refuse "--commit must be 7-40 hex characters"
[[ "$FP" =~ ^[0-9a-f]{4}(-[0-9a-f]{4}){3}$ ]] || usb_refuse "the key fingerprint must look like 9d49-041f-0ced-13ac"
[ -z "$EXPUUID" ] || [[ "$EXPUUID" =~ ^[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$ ]] || usb_refuse "--expect-volume-uuid must look like XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
usb_need_tools

# ---- (a) the device, not the label
usb_classify "$USB"
MP="$U_mount_point"
echo "== USB signing: $VERSION, role $ROLE =="
echo "  stick: physical USB (diskutil: $U_bus_protocol), label '$U_volume_name' (NOT trusted), volume UUID $U_volume_uuid, device $U_device_node, filesystem $U_fs_name"
IDF="$(usb_idfile "$MP" "$ROLE")"; KF="$(usb_keyfile "$MP" "$ROLE")"
[ -f "$IDF" ] && [ ! -L "$IDF" ] || usb_refuse "the stick has no identity file at $IDF: this is not a stick made by usb-key-ceremony.sh for the $ROLE key"
[ "$("${USB_PY[@]}" jget "$IDF" volume_uuid)" = "$U_volume_uuid" ] || usb_refuse "the identity file says this key belongs to volume '$("${USB_PY[@]}" jget "$IDF" volume_uuid)', but this volume is $U_volume_uuid: another stick (or a copy of the folder, or a reformatted stick). The label proves nothing."
if [ -n "$EXPUUID" ]; then
  [ "$(printf '%s' "$EXPUUID" | tr '[:lower:]' '[:upper:]')" = "$(printf '%s' "$U_volume_uuid" | tr '[:lower:]' '[:upper:]')" ] || usb_refuse "this volume's UUID $U_volume_uuid is not the expected $EXPUUID (--expect-volume-uuid, from the handover): wrong stick"
else
  echo "  WARNING: no --expect-volume-uuid given: the stick is identified only by its own identity file. Pass the volume UUID from the handover."
fi
[ "$("${USB_PY[@]}" jget "$IDF" role)" = "$ROLE" ] || usb_refuse "the identity file's role is '$("${USB_PY[@]}" jget "$IDF" role)', not $ROLE"
# ---- (b) the key file
[ -f "$KF" ] && [ ! -L "$KF" ] || usb_refuse "the key file $KF is missing, a symlink or not a regular file"
# ---- (f) permissions, only where the filesystem enforces them
if [ "$(usb_perms_static)" = yes ]; then
  kmode="$(stat -f '%Lp' "$KF" 2>/dev/null || stat -c '%a' "$KF")"
  [ $(( 8#$kmode & 8#077 )) -eq 0 ] || usb_refuse "the key file's mode $kmode lets group/other read or write it (this filesystem enforces permissions: chmod 600 it)"
  [ "$(stat -f '%u' "$KF" 2>/dev/null || stat -c '%u' "$KF")" = "$(id -u)" ] || usb_refuse "the key file is not owned by you"
else
  echo "  WARNING: this filesystem ($U_fs_name, mount flags: $U_mount_flags) does NOT enforce file permissions: anyone who holds this stick can sign releases. Possession is the ONLY protection."
fi
# ---- the trusted list and the Plugin checkout
TOOL="$PLUG/bin/sign-release.php"
[ -f "$TOOL" ] && [ -f "$PLUG/includes/class-aicc-release-signature.php" ] || usb_refuse "--plugin-dir is not a Plugin checkout (no bin/sign-release.php)"
git -C "$PLUG" rev-parse --git-dir >/dev/null 2>&1 || usb_refuse "--plugin-dir is not a git checkout"
HEADSHA="$(git -C "$PLUG" rev-parse HEAD)"
case "$HEADSHA" in "$COMMIT"*) ;; *) usb_refuse "the Plugin checkout is at ${HEADSHA:0:12}, not at the release commit $COMMIT" ;; esac
[ -z "$(git -C "$PLUG" status --porcelain)" ] || usb_refuse "the Plugin checkout is not clean (git status shows changes): sign only a clean checkout of the release commit"
if [ -z "$KEYS" ]; then KEYS="$(sed -n 's/^UPDATE_PUBLIC_KEYS=//p' "$PLUG/release/endpoints.conf" | head -1 | tr -d ' \r')"; fi
[[ "$KEYS" =~ ^[A-Za-z0-9+/]{43}=(,[A-Za-z0-9+/]{43}=)?$ ]] || usb_refuse "the public key list is not one or two base64 32-byte keys"
PRIMARY="${KEYS%%,*}"; STANDBY=""; case "$KEYS" in *,*) STANDBY="${KEYS#*,}" ;; esac
if [ "$ROLE" = primary ]; then WANT="$PRIMARY"; else WANT="$STANDBY"; [ -n "$WANT" ] || usb_refuse "the trusted list has no standby key"; fi
# ---- (c) the key proves itself: derive the public key from the private key, in process
usb_derive "$KF"
if [ "$K_PUB" != "$WANT" ]; then
  if [ "$ROLE" = primary ] && [ -n "$STANDBY" ] && [ "$K_PUB" = "$STANDBY" ]; then usb_refuse "the key on this stick is the STANDBY key ($K_FP), not the primary: the standby never signs a normal release"; fi
  usb_refuse "the public key derived from the key on this stick ($K_FP) is NOT the $ROLE key of the trusted list: wrong stick or wrong key"
fi
[ "$K_FP" = "$FP" ] || usb_refuse "the fingerprint of the key on this stick ($K_FP) is not the expected fingerprint $FP (--primary-fp / --standby-fp)"
[ "$("${USB_PY[@]}" jget "$IDF" public_key)" = "$K_PUB" ] && [ "$("${USB_PY[@]}" jget "$IDF" fingerprint)" = "$K_FP" ] || usb_refuse "the identity file's public key/fingerprint differ from the key's: the stick was tampered with or mixed up"
PFP="$(php -r 'echo implode("-", str_split(substr(hash("sha256", base64_decode($argv[1], true)), 0, 16), 4));' "$PRIMARY")"
[ "$ROLE" != primary ] || [ "$PFP" = "$FP" ] || usb_refuse "--primary-fp $FP is not the fingerprint of the first key of the list ($PFP)"
echo "  key: the public key derived from the private key is the $ROLE key of the trusted list (fingerprint $K_FP); the identity file agrees"
# ---- (d) manifest, ZIP and the trusted list are one consistent thing; (e) no signature yet
[ -f "$ZIP" ] && [ -f "$MAN" ] || usb_refuse "the ZIP or the manifest does not exist"
[ "$(basename "$ZIP")" = "ai-commerce-copilot-$VERSION.zip" ] || usb_refuse "the ZIP must be named ai-commerce-copilot-$VERSION.zip"
[ -n "$SIGOUT" ] || SIGOUT="${MAN%.json}.sig"
[ "$(basename "$SIGOUT")" = "ai-commerce-copilot-$VERSION.manifest.sig" ] || usb_refuse "the signature file must be named ai-commerce-copilot-$VERSION.manifest.sig (the publisher requires that name)"
[ ! -e "$SIGOUT" ] || usb_refuse "$SIGOUT already exists: this script never overwrites a signature (move it away if you are sure)"
case "$SIGOUT/" in "$MP"/*) usb_refuse "the signature must not be written onto the stick" ;; esac
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
if not k or k.group(1) != keys: no("the ZIP bakes the public keys '%s', not exactly the trusted list" % (k.group(1) if k else "(none)"))
PY
# ---- (g) the typed confirmation: the only input
if [ "$ROLE" = primary ]; then
  usb_confirm "SIGN $VERSION ${SHA:0:8}"
else
  echo
  echo "  EMERGENCY: signing with the STANDBY key. Reason you gave: $REASON"
  usb_confirm "SIGN $VERSION ${SHA:0:8} WITH THE STANDBY KEY"
fi
# ---- (h) sign (in process; the key is read by PHP from the stick and zeroed), then verify
TD="$(mktemp -d "${TMPDIR:-/tmp}/aicc-usbsign.XXXXXX")"; chmod 700 "$TD"
TMPSIG="$SIGOUT.tmp.$$"
sout="$(php "$USB_PHP" sign --key-file "$KF" --plugin-dir "$PLUG" --manifest "$MAN" --zip "$ZIP" --sig-out "$TMPSIG" --expect-pub "$WANT" 2>&1)" || usb_fail "signing refused: ${sout#usb_sign: }"
v1="$(php "$TOOL" verify --manifest "$MAN" --sig "$TMPSIG" --pubkeys "$KEYS" 2>&1)" || usb_fail "verify against the trusted key list failed: $v1"
v2="$(php "$TOOL" verify --manifest "$MAN" --sig "$TMPSIG" --zip "$ZIP" 2>/dev/null)" || usb_fail "verify against the ZIP's own baked keys failed"
v3="$(php "$TOOL" verify --manifest "$MAN" --sig "$TMPSIG" --pubkeys "$WANT" 2>&1)" || usb_fail "the signature does not verify with the $ROLE public key alone: $v3"
v4="$(php "$TOOL" verify --manifest "$MAN" --sig "$TMPSIG" --pubkeys "$KEYS" --zip "$ZIP" 2>&1)" || usb_fail "the zip-aware verify (--pubkeys AND --zip) failed: $v4"
# the signature must name this key
case "$(cat "$TMPSIG")" in *"\"key_id\": \"$FP\""*) ;; *) usb_fail "the signature does not name key $FP: removed" ;; esac
# tamper controls and the Plugin tool's own fix check
cp "$ZIP" "$TD/tampered.zip"; printf 'x' >> "$TD/tampered.zip"
if php "$TOOL" verify --manifest "$MAN" --sig "$TMPSIG" --pubkeys "$KEYS" --zip "$TD/tampered.zip" >/dev/null 2>&1; then usb_fail "this Plugin checkout's bin/sign-release.php accepts a TAMPERED ZIP with --pubkeys AND --zip (it predates the P44 fix): the signature was removed; use the P44-line checkout the coordinator announced"; fi
python3 -I - "$MAN" "$TD/m.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1])); m["size"] = int(m["size"]) + 1; json.dump(m, open(sys.argv[2], "w"))
PY
if php "$TOOL" verify --manifest "$TD/m.json" --sig "$TMPSIG" --pubkeys "$KEYS" >/dev/null 2>&1; then usb_fail "a TAMPERED manifest verified with this signature: stop and investigate"; fi
# WRONG-KEY negative control: a signature by a throwaway in-memory key (never written anywhere) must NOT verify against the trusted list
php "$USB_PHP" wrong-key-sig --plugin-dir "$PLUG" --manifest "$MAN" --out "$TD/wrong.sig" >/dev/null 2>&1 || usb_fail "could not run the wrong-key negative control"
if php "$TOOL" verify --manifest "$MAN" --sig "$TD/wrong.sig" --pubkeys "$KEYS" >/dev/null 2>&1; then usb_fail "a signature by a THROWAWAY key verified against the trusted list: stop and investigate"; fi
rm -rf "$TD"; TD=""
mv "$TMPSIG" "$SIGOUT"; TMPSIG=""
chmod 0644 "$SIGOUT" 2>/dev/null || true   # the signature is PUBLIC (umask 077 made it 0600; the publisher and the coordinator must be able to read it)
# ---- (i) the public result
if [ "$ROLE" = primary ]; then echo "SIGNED  $VERSION  key $FP  (the primary, from the USB stick)"; else echo "SIGNED  $VERSION  key $FP  (the STANDBY, EMERGENCY: $REASON)"; fi
echo "  $v1"; echo "  $v2"; echo "  $v3"; echo "  $v4"
echo "  tamper control: a manifest one byte larger is NOT accepted by this signature; a ZIP one byte larger is NOT accepted by the zip-aware verify"
echo "  wrong-key control: a signature by a throwaway key is NOT accepted against the trusted list"
echo "  signature file (public, not secret): $SIGOUT"
echo "  sha256 of the signature file: $(shasum -a 256 "$SIGOUT" | cut -d' ' -f1)"
[ "${AICC_TEST_HARNESS:-}" != 1 ] || echo "  TEST HARNESS: this signature was made with a throwaway disk image standing in for a USB stick: a TEST ARTIFACT."
echo "Next: hand ONLY the .manifest.sig to the coordinator. The stick was only read; nothing was written to it."
# ---- (k) eject
if [ "$EJECT" = 1 ]; then
  diskutil eject "$MP" >/dev/null 2>&1 && echo "Ejected $MP: unplug the stick and put it back in its place." || echo "Could not eject $MP automatically: close every window using it, then run: diskutil eject '$MP'"
else
  echo "NOW EJECT THE STICK and put it back in its place:  diskutil eject '$MP'   (add --eject to do it for you)"
fi
