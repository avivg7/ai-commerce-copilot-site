#!/usr/bin/env bash
# Tests of the P45 passwordless USB signing tools: infra/release/usb-key-ceremony.sh, infra/release/sign-plugin-release-usb.sh, infra/release/render-owner-signing-command.sh (+ lib/usb-common.sh, usb_tools.py, usb_sign.php).
# EVERYTHING here runs on THROWAWAY, UNENCRYPTED FAT32 disk images that this suite creates under the system temp dir and deletes again (hdiutil create -fs 'MS-DOS FAT32', NO encryption, no password anywhere),
# attached with the AICC_TEST_HARNESS=1 seam (a disk image under the temp dir stands in for the USB stick). No real key is read or created, /Volumes/KEY_n sticks are never touched, nothing is sent anywhere.
# The signed artifact is a throwaway build of the Plugin's pinned commit plus ONE local-only commit that swaps the baked public keys for the keys generated here (never pushed).
# Needs macOS (hdiutil, diskutil), bash, python3, php with sodium+zip, git, jq. The Plugin repo: AICC_PLUGIN_DIR (default ~/self_projects/aicc-plugin-p44) at AICC_PLUGIN_COMMIT (default 4dc7558); the suite skips if absent.
# Run: bash infra/stack-tests/test_p45_usb_signing.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; REL="$REPO/infra/release"
CER_SH="$REL/usb-key-ceremony.sh"; SIGN_SH="$REL/sign-plugin-release-usb.sh"; RENDER_SH="$REL/render-owner-signing-command.sh"; UT="$REL/lib/usb_tools.py"
T_SUITE="p45-usb-signing"; . "$HERE/lib/t.sh"
[ "$(uname -s)" = Darwin ] && command -v hdiutil >/dev/null 2>&1 && command -v diskutil >/dev/null 2>&1 || { t_skip "the whole suite" "needs macOS hdiutil/diskutil"; t_summary; exit 0; }
for tool in php python3 git jq; do command -v "$tool" >/dev/null 2>&1 || { echo "need $tool"; exit 2; }; done
PLUG_SRC="${AICC_PLUGIN_DIR:-$HOME/self_projects/aicc-plugin-p44}"; PLUG_COMMIT="${AICC_PLUGIN_COMMIT:-4dc7558}"
if ! { [ -f "$PLUG_SRC/bin/sign-release.php" ] && git -C "$PLUG_SRC" cat-file -e "$PLUG_COMMIT^{commit}" 2>/dev/null && php -r 'exit(function_exists("sodium_crypto_sign_detached")&&class_exists("ZipArchive")?0:1);'; }; then
  t_skip "the whole suite" "Plugin repo/commit ($PLUG_SRC @ $PLUG_COMMIT) or php sodium+zip not available"; t_summary; exit 0
fi
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ap45.XXXX")"; TMP="$(cd "$TMP" && pwd -P)"
MOUNTED=""; FAKEMNT=""
cleanup() {
  local m
  for m in $MOUNTED $FAKEMNT; do hdiutil detach "$m" >/dev/null 2>&1 || hdiutil detach -force "$m" >/dev/null 2>&1; done
  rm -rf "$TMP"
}
trap cleanup EXIT
mkdir -p "$TMP/img" "$TMP/mnt" "$TMP/logs" "$TMP/out" "$TMP/h" "$TMP/keys"; chmod 700 "$TMP/keys"
LOG="$TMP/logs/all.log"; : > "$LOG"

# ------------------------------------------------------------------ throwaway FAT32 images (unencrypted, UDIF, tiny)
mkimg() {  # <name> <volume label>
  local n="$1" v="$2"
  hdiutil create -size 40m -fs 'MS-DOS FAT32' -volname "$v" -type UDIF "$TMP/img/$n.dmg" >/dev/null 2>&1 || hdiutil create -size 64m -fs 'MS-DOS FAT32' -volname "$v" -type UDIF "$TMP/img/$n.dmg" >/dev/null 2>&1 || return 1
  attach_img "$n"
}
attach_img() { mkdir -p "$TMP/mnt/$1"; hdiutil attach -nobrowse -mountpoint "$TMP/mnt/$1" "$TMP/img/$1.dmg" >/dev/null 2>&1 || return 1; case " $MOUNTED " in *" $TMP/mnt/$1 "*) ;; *) MOUNTED="$MOUNTED $TMP/mnt/$1" ;; esac; }
detach_img() { hdiutil detach "$TMP/mnt/$1" >/dev/null 2>&1 || hdiutil detach -force "$TMP/mnt/$1" >/dev/null 2>&1; }
M() { printf '%s/mnt/%s' "$TMP" "$1"; }
uuid_of() { diskutil info -plist "$(M "$1")" | python3 -I -c 'import plistlib,sys; print(plistlib.loads(sys.stdin.buffer.read())["VolumeUUID"])'; }
guard() { case "$*" in */Volumes/KEY_1*|*/Volumes/KEY_2*) echo "TEST BUG: a real stick path reached a command" >&2; return 99 ;; esac; return 0; }
# harness wrappers (stdin is /dev/null unless a confirmation phrase is piped)
CER()  { guard "$@" || return 99; env AICC_TEST_HARNESS=1 bash "$CER_SH" "$@" < /dev/null; }
CERY() { local ph="$1"; shift; guard "$@" || return 99; printf '%s\n' "$ph" | env AICC_TEST_HARNESS=1 bash "$CER_SH" "$@"; }
SGN()  { guard "$@" || return 99; env AICC_TEST_HARNESS=1 bash "$SIGN_SH" "$@" < /dev/null; }
SGNY() { local ph="$1"; shift; guard "$@" || return 99; printf '%s\n' "$ph" | env AICC_TEST_HARNESS=1 bash "$SIGN_SH" "$@"; }
logrun() { "$@" 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }
nfiles() { find "$1" -mindepth 1 -maxdepth 1 -name "$2" 2>/dev/null | wc -l | tr -d ' '; }
pubof() { "${UTP[@]}" jget "$1" public_key; }
UTP=(python3 -I "$UT")

echo "== 0. building the stage: Plugin build with the keys the ceremony generates =="
for img in "P PRIMARYSTK" "S STANDBYSTK"; do set -- $img; mkimg "$1" "$2" || { t_skip "the whole suite" "cannot create/attach a throwaway FAT32 disk image"; t_summary; exit 0; }; done
PLK="$TMP/plug-tw"
git clone -q --local "$PLUG_SRC" "$PLK" && git -C "$PLK" checkout -q --detach "$PLUG_COMMIT" && git -C "$PLK" config user.email t@example.test && git -C "$PLK" config user.name t || { t_skip "the whole suite" "cannot clone the Plugin"; t_summary; exit 0; }
PHEAD="$(git -C "$PLK" rev-parse HEAD)"
UUID_P="$(uuid_of P)"; UUID_S="$(uuid_of S)"
# a pre-existing OLD-vault look-alike on the primary stick: names only are listed, it must survive untouched
mkdir -p "$(M P)/AICC-SIGNING-BACKUP"; printf 'not a real vault: a placeholder file\n' > "$(M P)/AICC-SIGNING-BACKUP/aicc-keys-primary.dmg"; OLDSUM="$(shasum -a 256 "$(M P)/AICC-SIGNING-BACKUP/aicc-keys-primary.dmg" | cut -d' ' -f1)"

echo "== A. the independent Ed25519 implementation and the signing helper =="
t_ok "pure-python Ed25519 passes the RFC 8032 test vectors" "${UTP[@]}" selftest
php "$PLK/bin/sign-release.php" keygen --secret-out "$TMP/keys/ref.key" > "$TMP/keys/ref.out" 2>&1
REFPUB="$(sed -n 's/^public key.*: //p' "$TMP/keys/ref.out")"
IND="$("${UTP[@]}" ed25519 --openssl < "$TMP/keys/ref.key")"
t_eq "libsodium (via the Plugin keygen) = pure python on a fresh key" "$(printf '%s\n' "$IND" | sed -n 's/^pub_python\t//p')" "$REFPUB"
case "$IND" in *"openssl_equals_python	yes"*) t_pass "...and OpenSSL derives the same public key" ;; *"unavailable"*) t_skip "OpenSSL cross-check" "this openssl cannot do Ed25519" ;; *) t_bad "OpenSSL derives the same public key" "$IND" ;; esac
printf 'Zm9v\n' > "$TMP/keys/junk.key"; t_fail "a non-key file is refused by the independent derivation" bash -c "python3 -I '$UT' ed25519 < '$TMP/keys/junk.key'"
t_fail "php derive refuses a corrupt key (stored public half differs from the seed's)" bash -c "python3 -I -c 'import base64,sys; r=base64.b64decode(open(sys.argv[1]).read()); sys.stdout.write(base64.b64encode(r[:32]+bytes(32)).decode())' '$TMP/keys/ref.key' > '$TMP/keys/corrupt.key'; php '$REL/lib/usb_sign.php' derive --key-file '$TMP/keys/corrupt.key'"
# the signing helper must produce byte-for-byte the signature of the Plugin's own tool for the same key and issued-at
REFB="$TMP/refbuild"; mkdir -p "$REFB"
python3 - "$REFB" "$REFPUB" <<'PY'
import hashlib, json, sys, zipfile, os
d, pk = sys.argv[1:3]; v = "9.9.9"
zp = os.path.join(d, "ai-commerce-copilot-%s.zip" % v)
with zipfile.ZipFile(zp, "w") as z:
    z.writestr("ai-commerce-copilot/ai-commerce-copilot.php", "<?php\n")
    z.writestr("ai-commerce-copilot/includes/aicc-release-defaults.php", "<?php\nclass AICC_Release_Keys { const PUBLIC_KEYS = '%s'; }\n" % pk)
data = open(zp, "rb").read(); h = hashlib.sha256(data).hexdigest()
json.dump({"slug": "ai-commerce-copilot", "version": v, "filename": os.path.basename(zp), "sha256": h, "size": len(data), "requires_wp": "6.0", "requires_php": "7.4", "requires_wc": "7.0", "dirty": False, "built_from_commit": "a" * 40, "changelog": "x"}, open(zp[:-4] + ".manifest.json", "w"))
PY
AICC_RELEASE_SIGNING_KEY_FILE="$TMP/keys/ref.key" php "$PLK/bin/sign-release.php" sign --manifest "$REFB/ai-commerce-copilot-9.9.9.manifest.json" --zip "$REFB/ai-commerce-copilot-9.9.9.zip" --sig-out "$REFB/plugin.sig" --issued-at 2026-11-22T10:00:00Z >/dev/null 2>&1
php "$REL/lib/usb_sign.php" sign --key-file "$TMP/keys/ref.key" --plugin-dir "$PLK" --manifest "$REFB/ai-commerce-copilot-9.9.9.manifest.json" --zip "$REFB/ai-commerce-copilot-9.9.9.zip" --sig-out "$REFB/helper.sig" --expect-pub "$REFPUB" --issued-at 2026-11-22T10:00:00Z >/dev/null 2>&1
t_eq "the helper's signature is byte-identical to the Plugin tool's for the same key and issued-at" "$(shasum -a 256 "$REFB/helper.sig" | cut -d' ' -f1)" "$(shasum -a 256 "$REFB/plugin.sig" | cut -d' ' -f1)"
t_fail "the helper never overwrites a signature file" php "$REL/lib/usb_sign.php" sign --key-file "$TMP/keys/ref.key" --plugin-dir "$PLK" --manifest "$REFB/ai-commerce-copilot-9.9.9.manifest.json" --zip "$REFB/ai-commerce-copilot-9.9.9.zip" --sig-out "$REFB/helper.sig" --expect-pub "$REFPUB"
t_fail "the helper refuses a key that is not the expected public key" php "$REL/lib/usb_sign.php" sign --key-file "$TMP/keys/ref.key" --plugin-dir "$PLK" --manifest "$REFB/ai-commerce-copilot-9.9.9.manifest.json" --zip "$REFB/ai-commerce-copilot-9.9.9.zip" --sig-out "$REFB/h2.sig" --expect-pub "$(printf 'A%.0s' $(seq 43))="
t_ok "php smoke: signs and verifies a disposable message" php "$REL/lib/usb_sign.php" smoke --key-file "$TMP/keys/ref.key"

echo "== B. the test seam can never be used for a real-looking stick =="
HOFF() { env -u AICC_TEST_HARNESS bash "$CER_SH" "$@" < /dev/null; }
t_rc "harness OFF: a throwaway disk image mounted anywhere is REFUSED (it is a disk image, not a USB stick)" 3 HOFF preflight --usb "$(M P)" --role primary
t_contains "...and the reason says disk image" "$(HOFF preflight --usb "$(M P)" --role primary 2>&1)" "DISK IMAGE"
t_rc "harness OFF: a plain folder (an internal path) is REFUSED" 3 HOFF preflight --usb "$TMP/h" --role primary
t_contains "...it is not a mount point" "$(HOFF preflight --usb "$TMP/h" --role primary 2>&1)" "not the mount point"
t_rc "harness OFF: the internal system volume / is REFUSED (not on a USB bus)" 3 HOFF preflight --usb / --role primary
t_contains "...and it says so" "$(HOFF preflight --usb / --role primary 2>&1)" "not on a USB bus"
# a real-looking mount: the SAME kind of image attached under /Volumes with a KEY_-style label (never KEY_1 / KEY_2)
hdiutil create -size 40m -fs 'MS-DOS FAT32' -volname KEY_9TEST -type UDIF "$TMP/img/fake.dmg" >/dev/null 2>&1 && hdiutil attach -nobrowse "$TMP/img/fake.dmg" >/dev/null 2>&1 && FAKEMNT="/Volumes/KEY_9TEST"
if [ -d /Volumes/KEY_9TEST ]; then
  t_rc "harness OFF: a look-alike /Volumes/KEY_9TEST (disk image) is REFUSED" 3 HOFF preflight --usb /Volumes/KEY_9TEST --role primary
  t_rc "harness ON but the image is mounted under /Volumes (not under the temp dir): REFUSED" 3 CER preflight --usb /Volumes/KEY_9TEST --role primary
  t_contains "...the harness message says why" "$(CER preflight --usb /Volumes/KEY_9TEST --role primary 2>&1)" "not under the system temp dir"
  ln -s /Volumes/KEY_9TEST "$TMP/linktoreal"
  t_rc "harness ON: a temp-dir symlink to a /Volumes mount is REFUSED (the resolved path is outside the temp dir)" 3 CER preflight --usb "$TMP/linktoreal" --role primary
else t_skip "look-alike /Volumes mount tests" "could not attach a disk image under /Volumes"; fi
t_rc "harness ON: /Volumes/KEY_1 is REFUSED on the literal path alone (no disk access)" 3 env AICC_TEST_HARNESS=1 bash "$CER_SH" preflight --usb /Volumes/KEY_1 --role primary
t_rc "harness ON: /Volumes/KEY_2 is REFUSED on the literal path alone" 3 env AICC_TEST_HARNESS=1 bash "$CER_SH" preflight --usb /Volumes/KEY_2 --role standby
t_rc "harness ON: ../ components are refused" 3 env AICC_TEST_HARNESS=1 bash "$CER_SH" preflight --usb "$TMP/mnt/P/../../../../Volumes/KEY_1" --role primary
t_rc "harness ON: a plain folder under the temp dir (not a mounted disk image) is REFUSED" 3 CER preflight --usb "$TMP/h" --role primary
t_rc "harness ON, signing script: /Volumes/KEY_1 is REFUSED too" 3 env AICC_TEST_HARNESS=1 bash "$SIGN_SH" --usb /Volumes/KEY_1 --role primary --plugin-dir "$PLK" --zip /x/ai-commerce-copilot-1.1.4.zip --manifest /x/m.json --version 1.1.4 --sha256 "$(printf 'a%.0s' $(seq 64))" --commit abcdef0 --primary-fp 1111-2222-3333-4444
t_contains "the harness prints a loud banner" "$(CER preflight --usb "$(M P)" --role primary 2>&1 | head -3)" "AICC_TEST_HARNESS=1"
t_not_contains "...and no banner without the variable" "$(HOFF preflight --usb "$TMP/h" --role primary 2>&1)" "AICC_TEST_HARNESS"
t_eq "the harness is only ever read in usb_tools.py classify (one place in code)" "$(grep -l 'AICC_TEST_HARNESS' "$REL"/lib/*.py "$REL"/lib/*.php | wc -l | tr -d ' ')" "1"

echo "== C. the key ceremony on a throwaway FAT32 stick =="
PRE="$(CER preflight --usb "$(M P)" --role primary 2>&1)"
t_contains "preflight: names the filesystem" "$PRE" "MS-DOS FAT32 (msdos)"
t_contains "...the volume UUID" "$PRE" "$UUID_P"
t_contains "...that permissions are NOT enforced" "$PRE" "POSIX permissions enforced     : no"
t_contains "...the security limitation, plainly" "$PRE" "Possession of the stick is the ONLY control"
t_contains "...free space and the device" "$PRE" "size / free"
t_contains "...a names-only summary of the existing contents" "$PRE" "AICC-SIGNING-BACKUP"
t_contains "...it says the old vault copies are NOT touched" "$PRE" "NOT touched"
t_contains "...it says it changed nothing" "$PRE" "nothing was formatted, erased or changed"
t_eq "...the old vault placeholder is untouched" "$(shasum -a 256 "$(M P)/AICC-SIGNING-BACKUP/aicc-keys-primary.dmg" | cut -d' ' -f1)" "$OLDSUM"
t_eq "...the temporary probe file is gone" "$(nfiles "$(M P)" '*probe*')" "0"
t_rc "preflight with no --role is a usage error" 2 CER preflight --usb "$(M P)"
# generate refusals (nothing is created)
t_rc "generate: a wrong confirmation phrase is REFUSED" 3 CERY "GENERATE PRIMARY KEY ON 00000000" generate --usb "$(M P)" --role primary --plugin-dir "$PLK" --plugin-commit "$PLUG_COMMIT" --expect-handover-dir "$TMP/h"
t_rc "generate: no confirmation (stdin closed) is REFUSED" 3 CER generate --usb "$(M P)" --role primary --plugin-dir "$PLK" --plugin-commit "$PLUG_COMMIT" --expect-handover-dir "$TMP/h"
t_eq "...no key folder was created by the refusals" "$(nfiles "$(M P)" 'AICC-RELEASE-SIGNING')" "0"
t_rc "generate: a wrong --plugin-commit is REFUSED" 3 CERY "GENERATE PRIMARY KEY ON ${UUID_P:0:8}" generate --usb "$(M P)" --role primary --plugin-dir "$PLK" --plugin-commit 0123456 --expect-handover-dir "$TMP/h"
echo x >> "$PLK/README.md"; t_rc "generate: a dirty Plugin checkout is REFUSED" 3 CERY "GENERATE PRIMARY KEY ON ${UUID_P:0:8}" generate --usb "$(M P)" --role primary --plugin-dir "$PLK" --plugin-commit "$PLUG_COMMIT" --expect-handover-dir "$TMP/h"; git -C "$PLK" checkout -q README.md
mkdir -p "$TMP/repo-like/.git"; t_rc "generate: a handover directory inside a git repository is REFUSED" 3 CERY "GENERATE PRIMARY KEY ON ${UUID_P:0:8}" generate --usb "$(M P)" --role primary --plugin-dir "$PLK" --plugin-commit "$PLUG_COMMIT" --expect-handover-dir "$TMP/repo-like"
t_rc "generate: a handover directory in a cloud-synced path is REFUSED" 3 CERY "GENERATE PRIMARY KEY ON ${UUID_P:0:8}" generate --usb "$(M P)" --role primary --plugin-dir "$PLK" --plugin-commit "$PLUG_COMMIT" --expect-handover-dir "$TMP/Mobile Documents/com~apple~CloudDocs/h"
t_rc "generate: a handover directory on the stick itself is REFUSED" 3 CERY "GENERATE PRIMARY KEY ON ${UUID_P:0:8}" generate --usb "$(M P)" --role primary --plugin-dir "$PLK" --plugin-commit "$PLUG_COMMIT" --expect-handover-dir "$(M P)/handover"
t_eq "...still no key folder and no handover directory litter on the stick" "$(( $(nfiles "$(M P)" 'AICC-RELEASE-SIGNING') + $(nfiles "$(M P)" '*handover*') ))" "0"
GEN="$(logrun env AICC_TEST_HARNESS=1 bash -c "printf '%s\n' 'GENERATE PRIMARY KEY ON ${UUID_P:0:8}' | bash '$CER_SH' generate --usb '$(M P)' --role primary --plugin-dir '$PLK' --plugin-commit '$PLUG_COMMIT' --expect-handover-dir '$TMP/h'")"; GRC=$?
t_eq "generate PRIMARY: rc 0" "$GRC" "0"
KP="$(M P)/AICC-RELEASE-SIGNING/aicc-release-primary.key"; IDP="$(M P)/AICC-RELEASE-SIGNING/aicc-release-primary.identity.json"; HP="$TMP/h/aicc-release-primary.handover.json"
t_ok "the key file exists on the stick at the fixed path" test -f "$KP"
t_eq "...and holds exactly one base64 line (89 bytes)" "$(wc -c < "$KP" | tr -d ' ')" "89"
PRI="$(pubof "$IDP")"; FPP="$("${UTP[@]}" jget "$IDP" fingerprint)"
t_contains "generate prints the public key and fingerprint" "$GEN" "$PRI"
t_contains "...the independent derivation result" "$GEN" "independent pure-python RFC 8032"
t_contains "...the smoke test" "$GEN" "offline signing smoke test            : ok"
t_contains "...tells the owner to EJECT and RE-PLUG" "$GEN" "EJECT the stick"
t_contains "...and that it is NOT COMPLETE yet" "$GEN" "NOT COMPLETE YET"
t_eq "no ._ AppleDouble file anywhere on the stick" "$(find "$(M P)" -name '._*' | wc -l | tr -d ' ')" "0"
t_eq "the identity file is public JSON with role/key/fingerprint/uuid/volume/fs/device/tool" "$("${UTP[@]}" jget "$IDP" role)|$("${UTP[@]}" jget "$IDP" volume_uuid)|$("${UTP[@]}" jget "$IDP" filesystem)|$("${UTP[@]}" jget "$IDP" volume_name)" "primary|$UUID_P|MS-DOS FAT32|PRIMARYSTK"
t_ok "...with a created UTC time and the tool version" bash -c "python3 -I '$UT' jget '$IDP' created_utc | grep -qE '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$' && python3 -I '$UT' jget '$IDP' tool | grep -q 'usb-key-ceremony.sh'"
t_ok "the handover file exists outside the repo and outside any git repo" bash -c "[ -f '$HP' ] && case '$HP' in '$REPO'/*) exit 1 ;; esac"
t_eq "...with the public key, fingerprint, role, volume UUID and a created time" "$("${UTP[@]}" jget "$HP" public_key)|$("${UTP[@]}" jget "$HP" fingerprint)|$("${UTP[@]}" jget "$HP" role)|$("${UTP[@]}" jget "$HP" volume_uuid)" "$PRI|$FPP|primary|$UUID_P"
t_eq "...and ceremony_verified_after_replug is still null (generate never sets it)" "$("${UTP[@]}" jget "$HP" ceremony_verified_after_replug)" ""
t_eq "the old vault placeholder is STILL untouched" "$(shasum -a 256 "$(M P)/AICC-SIGNING-BACKUP/aicc-keys-primary.dmg" | cut -d' ' -f1)" "$OLDSUM"
t_rc "generate again on the same stick is REFUSED (a key is never overwritten)" 3 CERY "GENERATE PRIMARY KEY ON ${UUID_P:0:8}" generate --usb "$(M P)" --role primary --plugin-dir "$PLK" --plugin-commit "$PLUG_COMMIT" --expect-handover-dir "$TMP/h2"
t_rc "preflight on a stick that holds a key is REFUSED" 3 CER preflight --usb "$(M P)" --role primary
t_rc "a STANDBY key on the primary's stick is REFUSED (never share a device)" 3 CERY "GENERATE STANDBY KEY ON ${UUID_P:0:8}" generate --usb "$(M P)" --role standby --plugin-dir "$PLK" --plugin-commit "$PLUG_COMMIT" --expect-handover-dir "$TMP/h2"
# verify, before and after the re-plug
VB="$(CER verify --usb "$(M P)" --role primary --expect-pubkey "$PRI" --expect-volume-uuid "$UUID_P" --handover-dir "$TMP/h" 2>&1)"; VBRC=$?
t_eq "verify BEFORE the re-plug: rc 4 (content passes, ceremony not complete)" "$VBRC" "4"
t_contains "...it says NOT COMPLETE" "$VB" "NOT COMPLETE"
t_eq "...and nothing was recorded" "$("${UTP[@]}" jget "$HP" ceremony_verified_after_replug)" ""
t_rc "verify with a wrong expected public key FAILS (rc 1)" 1 CER verify --usb "$(M P)" --role primary --expect-pubkey "$(printf 'A%.0s' $(seq 43))=" --handover-dir "$TMP/h"
t_rc "verify with a wrong expected volume UUID FAILS (rc 1)" 1 CER verify --usb "$(M P)" --role primary --expect-pubkey "$PRI" --expect-volume-uuid 00000000-0000-0000-0000-000000000000 --handover-dir "$TMP/h"
detach_img P && attach_img P
UUID_P2="$(uuid_of P)"; t_eq "eject and re-attach keeps the volume UUID" "$UUID_P2" "$UUID_P"
VA="$(logrun env AICC_TEST_HARNESS=1 bash "$CER_SH" verify --usb "$(M P)" --role primary --expect-pubkey "$PRI" --expect-volume-uuid "$UUID_P" --handover-dir "$TMP/h" < /dev/null)"; VARC=$?
t_eq "verify AFTER the re-plug: rc 0" "$VARC" "0"
t_contains "...PASS, after a re-mount" "$VA" "PASS: every check passed AFTER a re-mount"
t_ok "...ceremony_verified_after_replug is now a UTC timestamp" bash -c "python3 -I '$UT' jget '$HP' ceremony_verified_after_replug | grep -qE '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$'"
t_contains "...with the evidence recorded" "$("${UTP[@]}" jget "$HP" ceremony_replug_evidence)" "IORegistry"
t_eq "...still no ._ files after the re-attach" "$(find "$(M P)" -name '._*' | wc -l | tr -d ' ')" "0"
# a sidecar on the stick makes verify FAIL
: > "$(M P)/AICC-RELEASE-SIGNING/._aicc-release-primary.key"; t_rc "verify FAILS when an AppleDouble sidecar is present (rc 1)" 1 CER verify --usb "$(M P)" --role primary --expect-pubkey "$PRI" --handover-dir "$TMP/h"; rm -f "$(M P)/AICC-RELEASE-SIGNING/._aicc-release-primary.key"
# standby on the second stick
GENS="$(logrun env AICC_TEST_HARNESS=1 bash -c "printf '%s\n' 'GENERATE STANDBY KEY ON ${UUID_S:0:8}' | bash '$CER_SH' generate --usb '$(M S)' --role standby --plugin-dir '$PLK' --plugin-commit '$PLUG_COMMIT' --expect-handover-dir '$TMP/h'")"
KS="$(M S)/AICC-RELEASE-SIGNING/aicc-release-standby.key"; IDS="$(M S)/AICC-RELEASE-SIGNING/aicc-release-standby.identity.json"; HS="$TMP/h/aicc-release-standby.handover.json"
STB="$(pubof "$IDS")"; FPS="$("${UTP[@]}" jget "$IDS" fingerprint)"
t_ok "generate STANDBY on the second stick" test -f "$KS"
t_ok "the two keys differ" test "$PRI" != "$STB"
detach_img S && attach_img S; t_rc "standby verify after re-plug passes (rc 0)" 0 env AICC_TEST_HARNESS=1 bash "$CER_SH" verify --usb "$(M S)" --role standby --expect-pubkey "$STB" --handover-dir "$TMP/h" </dev/null
detach_img P && attach_img P; detach_img S && attach_img S
# ---- the Plugin build that bakes THESE keys, primary first
sed -i.bak "s#^UPDATE_PUBLIC_KEYS=.*#UPDATE_PUBLIC_KEYS=$PRI,$STB#" "$PLK/release/endpoints.conf" && rm -f "$PLK/release/endpoints.conf.bak" && git -C "$PLK" commit -qam "throwaway keys from the ceremony"
mkdir -p "$TMP/tw"; ( cd "$PLK" && bin/build-release.sh --out "$TMP/tw" >/dev/null 2>&1 ) || { t_bad "the throwaway Plugin build" "build failed"; t_summary; exit 1; }
COMMIT="$(git -C "$PLK" rev-parse HEAD)"; V="$(jq -r .version "$TMP/tw/"*.manifest.json)"; ZN="ai-commerce-copilot-$V.zip"
ZIP="$TMP/tw/$ZN"; MAN="$TMP/tw/ai-commerce-copilot-$V.manifest.json"; SHA="$(shasum -a 256 "$ZIP" | cut -d' ' -f1)"; LIST="$PRI,$STB"
t_ok "the throwaway build is a different commit from the pinned one (one local-only commit)" test "$COMMIT" != "$PHEAD"
FIX() { local d="$TMP/out/$1"; mkdir -p "$d"; cp "$ZIP" "$MAN" "$d/"; }
S_ARGS=(--role primary --plugin-dir "$PLK" --version "$V" --sha256 "$SHA" --commit "${COMMIT:0:12}" --primary-fp "$FPP")
# $1 = case dir: runs the signer for that case dir's copies of the ZIP and the manifest
SA() { local d="$TMP/out/$1"; shift; printf -- '--usb\n%s\n--zip\n%s\n--manifest\n%s\n--sig-out\n%s\n' "$(M P)" "$d/$ZN" "$d/ai-commerce-copilot-$V.manifest.json" "$d/ai-commerce-copilot-$V.manifest.sig"; }
SIGNP() {  # <case> [extra args...]; stdin /dev/null
  local c="$1"; shift; local d="$TMP/out/$c"; FIX "$c" 2>/dev/null
  SGN --usb "$(M P)" --zip "$d/$ZN" --manifest "$d/ai-commerce-copilot-$V.manifest.json" --sig-out "$d/ai-commerce-copilot-$V.manifest.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_P" "$@"
}
SIGNPY() { local ph="$1" c="$2"; shift 2; local d="$TMP/out/$c"; FIX "$c" 2>/dev/null
  SGNY "$ph" --usb "$(M P)" --zip "$d/$ZN" --manifest "$d/ai-commerce-copilot-$V.manifest.json" --sig-out "$d/ai-commerce-copilot-$V.manifest.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_P" "$@"; }
nosig() { [ "$(find "$TMP/out/$1" -name '*sig*' | wc -l | tr -d ' ')" = 0 ]; }
PHRASE="SIGN $V ${SHA:0:8}"

echo "== D. refusals of the USB signing command (each one writes nothing) =="
REF() {  # <name> <case> <expected stderr fragment> <extra args...>
  local n="$1" c="$2" frag="$3"; shift 3; local out rc=0; out="$(SIGNP "$c" "$@" 2>&1)" || rc=$?
  if [ "$rc" = 3 ] && case "$out" in *"$frag"*) true ;; *) false ;; esac && nosig "$c"; then t_pass "$n"; else t_bad "$n" "rc=$rc, fragment '$frag': $(printf '%s' "$out" | tail -3 | tr '\n' '|')"; fi
}
t_rc "usage error without the required arguments (rc 2)" 2 SGN --usb "$(M P)"
t_rc "a standby role without the emergency flag is REFUSED (rc 3)" 3 SGN --usb "$(M S)" --role standby --plugin-dir "$PLK" --zip "$ZIP" --manifest "$MAN" --version "$V" --sha256 "$SHA" --commit "${COMMIT:0:12}" --primary-fp "$FPS"
t_rc "--emergency-standby with --role primary is REFUSED" 3 SGN --usb "$(M P)" --role primary --emergency-standby --plugin-dir "$PLK" --zip "$ZIP" --manifest "$MAN" --version "$V" --sha256 "$SHA" --commit "${COMMIT:0:12}" --primary-fp "$FPP"
REF "USB missing (no such mount) is REFUSED" r_usb "no such directory" --usb "$TMP/mnt/NOPE"
REF "a plain directory (an internal path) as the stick is REFUSED" r_dir "not the mount point" --usb "$TMP/h"
REF "the primary key's fingerprint must match --primary-fp" r_fp "not the expected fingerprint" --primary-fp 1111-2222-3333-4444
REF "a wrong --expect-volume-uuid is REFUSED" r_uuid "not the expected" --expect-volume-uuid 00000000-0000-0000-0000-000000000000
REF "a wrong commit is REFUSED" r_commit "not at the release commit" --commit 0123456
REF "a pre-release version is REFUSED" r_ver "no -dev/-rc suffix" --version 1.1.4-dev.1
REF "a wrong coordinator SHA-256 is REFUSED" r_sha "SHA-256 differs" --sha256 "$(printf 'b%.0s' $(seq 64))"
cp "$ZIP" "$TMP/tampered.zip"; printf X >> "$TMP/tampered.zip"; mkdir -p "$TMP/out/r_zip"; cp "$TMP/tampered.zip" "$TMP/out/r_zip/$ZN"; cp "$MAN" "$TMP/out/r_zip/"
t_rc "a ZIP that differs from the manifest is REFUSED" 3 SGN --usb "$(M P)" --zip "$TMP/out/r_zip/$ZN" --manifest "$TMP/out/r_zip/ai-commerce-copilot-$V.manifest.json" --sig-out "$TMP/out/r_zip/ai-commerce-copilot-$V.manifest.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_P"
t_ok "...and no signature exists for it" nosig r_zip
mkdir -p "$TMP/out/r_man"; cp "$ZIP" "$TMP/out/r_man/"; jq '.size = (.size + 1)' "$MAN" > "$TMP/out/r_man/ai-commerce-copilot-$V.manifest.json"
t_rc "a manifest that differs from the ZIP is REFUSED" 3 SGN --usb "$(M P)" --zip "$TMP/out/r_man/$ZN" --manifest "$TMP/out/r_man/ai-commerce-copilot-$V.manifest.json" --sig-out "$TMP/out/r_man/ai-commerce-copilot-$V.manifest.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_P"
mkdir -p "$TMP/out/r_mc"; cp "$ZIP" "$TMP/out/r_mc/"; jq --arg c "$(printf 'ab%.0s' $(seq 20))" '.built_from_commit = $c' "$MAN" > "$TMP/out/r_mc/ai-commerce-copilot-$V.manifest.json"
t_rc "a manifest built from another commit is REFUSED" 3 SGN --usb "$(M P)" --zip "$TMP/out/r_mc/$ZN" --manifest "$TMP/out/r_mc/ai-commerce-copilot-$V.manifest.json" --sig-out "$TMP/out/r_mc/ai-commerce-copilot-$V.manifest.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_P"
echo x >> "$PLK/README.md"; REF "a dirty Plugin checkout is REFUSED" r_dirty "not clean"; git -C "$PLK" checkout -q README.md
mkdir -p "$TMP/out/r_exist2"; cp "$ZIP" "$MAN" "$TMP/out/r_exist2/"; echo '{}' > "$TMP/out/r_exist2/ai-commerce-copilot-$V.manifest.sig"
t_rc "...an existing .manifest.sig blocks signing (rc 3)" 3 SGN --usb "$(M P)" --zip "$TMP/out/r_exist2/$ZN" --manifest "$TMP/out/r_exist2/ai-commerce-copilot-$V.manifest.json" --sig-out "$TMP/out/r_exist2/ai-commerce-copilot-$V.manifest.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_P"
t_rc "a key list the ZIP does not bake is REFUSED (the baked list must equal the trusted list)" 3 SGN --usb "$(M P)" --zip "$ZIP" --manifest "$MAN" --sig-out "$TMP/out/r_list.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_P" --pubkeys "$PRI"
t_rc "...a signature path not named for the version is REFUSED" 3 SGN --usb "$(M P)" --zip "$ZIP" --manifest "$MAN" --sig-out "$TMP/out/wrongname.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_P"
# the stick's own state
mv "$KP" "$KP.off"; REF "the key file is missing: REFUSED" r_nokey "missing, a symlink or not a regular file"; mv "$KP.off" "$KP"
mv "$KP" "$TMP/keys/p-orig.key"; ln -s "$TMP/keys/ref.key" "$KP"; REF "the key file is a symlink: REFUSED" r_link "missing, a symlink or not a regular file"; rm -f "$KP"; mv "$TMP/keys/p-orig.key" "$KP"
cp "$IDP" "$IDP.off"; rm -f "$IDP"; REF "the identity file is missing: REFUSED" r_noid "no identity file"; mv "$IDP.off" "$IDP"
cp "$IDP" "$IDP.off"; "${UTP[@]}" jset "$IDP" "volume_uuid=11111111-2222-3333-4444-555555555555"; REF "an identity file naming another volume UUID is REFUSED (the label proves nothing)" r_idu "another stick"; cp "$IDP.off" "$IDP"; rm -f "$IDP.off"
cp "$IDP" "$IDP.off"; "${UTP[@]}" jset "$IDP" "role=standby"; REF "an identity file with another role is REFUSED" r_idr "identity file's role"; cp "$IDP.off" "$IDP"; rm -f "$IDP.off"
# wrong stick: the standby stick offered as the primary, with the standby's key renamed to the primary's name and a matching (copied+edited) identity
mkdir -p "$(M S)/AICC-RELEASE-SIGNING"; cp "$KS" "$(M S)/AICC-RELEASE-SIGNING/aicc-release-primary.key"; cp "$IDS" "$(M S)/AICC-RELEASE-SIGNING/aicc-release-primary.identity.json"; "${UTP[@]}" jset "$(M S)/AICC-RELEASE-SIGNING/aicc-release-primary.identity.json" "role=primary"
t_rc "the STANDBY key (under the primary's file name) is REFUSED for a normal release" 3 SGN --usb "$(M S)" --zip "$ZIP" --manifest "$MAN" --sig-out "$TMP/out/r_stb.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_S"
t_contains "...and it says it is the STANDBY key" "$(SGN --usb "$(M S)" --zip "$ZIP" --manifest "$MAN" --sig-out "$TMP/out/r_stb.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_S" 2>&1)" "is the STANDBY key"
rm -f "$(M S)/AICC-RELEASE-SIGNING/aicc-release-primary.key" "$(M S)/AICC-RELEASE-SIGNING/aicc-release-primary.identity.json"
t_rc "the standby stick without a primary identity file is REFUSED" 3 SGN --usb "$(M S)" --zip "$ZIP" --manifest "$MAN" --sig-out "$TMP/out/r_stb2.sig" "${S_ARGS[@]}"
# a key that is not on the trusted list at all (a third stick whose key is not baked)
mkimg X XSTICK && XU="$(uuid_of X)" && CERY "GENERATE PRIMARY KEY ON ${XU:0:8}" generate --usb "$(M X)" --role primary --plugin-dir "$PLK" --plugin-commit "${COMMIT:0:12}" --expect-handover-dir "$TMP/hx" >/dev/null 2>&1
t_rc "a stick whose key is not on the trusted list is REFUSED (wrong key)" 3 SGN --usb "$(M X)" --zip "$ZIP" --manifest "$MAN" --sig-out "$TMP/out/r_x.sig" "${S_ARGS[@]}" --primary-fp "$("${UTP[@]}" jget "$(M X)/AICC-RELEASE-SIGNING/aicc-release-primary.identity.json" fingerprint)" --expect-volume-uuid "$XU"
# a duplicate label: a second image with the SAME label and a copy of the whole key folder
mkimg P2 PRIMARYSTK; cp -R "$(M P)/AICC-RELEASE-SIGNING" "$(M P2 2>/dev/null || M P2)/" 2>/dev/null; UUID_P2D="$(uuid_of P2)"
t_ok "the duplicate-label stick really has the same label and another UUID" bash -c "[ '$UUID_P2D' != '$UUID_P' ] && diskutil info -plist '$(M P2)' | python3 -I -c 'import plistlib,sys; sys.exit(0 if plistlib.loads(sys.stdin.buffer.read())[\"VolumeName\"]==\"PRIMARYSTK\" else 1)'"
t_rc "right LABEL, wrong UUID (a copy of the folder on a look-alike stick) is REFUSED" 3 SGN --usb "$(M P2)" --zip "$ZIP" --manifest "$MAN" --sig-out "$TMP/out/r_dup.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_P"
t_contains "...the identity file says it belongs to another volume" "$(SGN --usb "$(M P2)" --zip "$ZIP" --manifest "$MAN" --sig-out "$TMP/out/r_dup.sig" "${S_ARGS[@]}" 2>&1)" "The label proves nothing"
t_rc "...and with the duplicate's own UUID passed, the identity file still refuses (rc 3)" 3 SGN --usb "$(M P2)" --zip "$ZIP" --manifest "$MAN" --sig-out "$TMP/out/r_dup.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_P2D"
t_ok "...no signature was written by any refusal" bash -c "[ ! -e '$TMP/out/r_dup.sig' ] && [ ! -e '$TMP/out/r_x.sig' ] && [ ! -e '$TMP/out/r_stb.sig' ]"
t_rc "xtrace (bash -x) is REFUSED" 3 env AICC_TEST_HARNESS=1 bash -x "$SIGN_SH" --usb "$(M P)" --role primary </dev/null
t_rc "xtrace through SHELLOPTS is REFUSED" 3 env AICC_TEST_HARNESS=1 SHELLOPTS=xtrace bash "$SIGN_SH" --usb "$(M P)" --role primary </dev/null
t_rc "xtrace is refused by the ceremony too" 3 env AICC_TEST_HARNESS=1 bash -x "$CER_SH" preflight --usb "$(M P)" --role primary </dev/null
t_rc "the typed confirmation is required: a wrong phrase is REFUSED" 3 SIGNPY "SIGN $V 00000000" r_conf1 
t_ok "...no signature" nosig r_conf1
t_rc "stdin closed: no confirmation, REFUSED, and no password prompt exists" 3 SIGNP r_conf2
t_ok "...no signature" nosig r_conf2

echo "== E. the signing flow, end to end, with the PASSWORDLESS USB key =="
# an argv/environment recorder in front of php and python3: the key path may appear, the key content never
mkdir -p "$TMP/shim"; REALPHP="$(command -v php)"; REALPY="$(command -v python3)"; ARGLOG="$TMP/logs/argv-env.log"; : > "$ARGLOG"
for w in "php:$REALPHP" "python3:$REALPY"; do n="${w%%:*}"; r="${w#*:}"; printf '#!/bin/sh\n{ printf "ARGV:"; for a in "$@"; do printf " [%%s]" "$a"; done; printf "\\nENV:\\n"; env; printf "ENDCALL\\n"; } >> "%s"\nexec "%s" "$@"\n' "$ARGLOG" "$r" > "$TMP/shim/$n"; chmod +x "$TMP/shim/$n"; done
mkdir -p "$TMP/out/ok1"; cp "$ZIP" "$MAN" "$TMP/out/ok1/"
d="$TMP/out/ok1"
OUT="$(printf '%s\n' "$PHRASE" | env PATH="$TMP/shim:$PATH" AICC_TEST_HARNESS=1 bash "$SIGN_SH" --usb "$(M P)" --zip "$d/$ZN" --manifest "$d/ai-commerce-copilot-$V.manifest.json" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_P" 2>&1)"; SRC=$?
printf '%s\n' "$OUT" >> "$LOG"
t_eq "the PRIMARY key on the USB signs: rc 0" "$SRC" "0"
t_contains "...it says SIGNED with the primary fingerprint" "$OUT" "SIGNED  $V  key $FPP  (the primary, from the USB stick)"
t_eq "...four verifications ran" "$(printf '%s\n' "$OUT" | grep -c '^  verified: ')" "4"
t_contains "...the tamper control is stated" "$OUT" "tamper control"
t_contains "...the wrong-key control is stated" "$OUT" "wrong-key control: a signature by a throwaway key is NOT accepted"
t_contains "...it prints the signature file path" "$OUT" "$d/ai-commerce-copilot-$V.manifest.sig"
t_eq "...and the signature file's SHA-256" "$(printf '%s\n' "$OUT" | sed -n 's/^  sha256 of the signature file: //p')" "$(shasum -a 256 "$d/ai-commerce-copilot-$V.manifest.sig" | cut -d' ' -f1)"
t_contains "...it WARNS that the filesystem enforces no permissions" "$OUT" "does NOT enforce file permissions"
t_contains "...it states that the stick was only read" "$OUT" "nothing was written to it"
t_contains "...it ends with the eject instruction" "$OUT" "NOW EJECT THE STICK"
t_contains "...it prints the typed-confirmation prompt (not a password prompt)" "$OUT" "type exactly this phrase"
t_contains "...the harness marks the result as a test artifact" "$OUT" "TEST ARTIFACT"
t_eq "...nothing but the signature appeared (zip, manifest, sig)" "$(ls "$d" | tr '\n' ' ')" "ai-commerce-copilot-$V.manifest.json ai-commerce-copilot-$V.manifest.sig ai-commerce-copilot-$V.zip "
t_eq "...no temp signature left behind" "$(find "$d" -name '*.tmp.*' | wc -l | tr -d ' ')" "0"
t_eq "...no aicc temp dir left behind" "$(find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'aicc-usbsign.*' 2>/dev/null | wc -l | tr -d ' ')" "0"
t_eq "...the stick is unchanged by signing (no new file, no ._ sidecar)" "$(find "$(M P)" -newer "$d/ai-commerce-copilot-$V.manifest.sig" 2>/dev/null | wc -l | tr -d ' ')|$(find "$(M P)" -name '._*' | wc -l | tr -d ' ')" "0|0"
SIGF="$d/ai-commerce-copilot-$V.manifest.sig"
t_ok "the signature verifies with the zip-aware strict verify against the trusted list" php "$PLK/bin/sign-release.php" verify --manifest "$d/ai-commerce-copilot-$V.manifest.json" --sig "$SIGF" --pubkeys "$LIST" --zip "$d/$ZN"
t_contains "...and names the primary key" "$(cat "$SIGF")" "\"key_id\": \"$FPP\""
t_eq "...the public signature file is world-readable (0644), unlike the key" "$(stat -f '%Lp' "$SIGF")" "644"
t_rc "a second run for the same release is REFUSED (already signed)" 3 env AICC_TEST_HARNESS=1 bash -c "printf '%s\n' '$PHRASE' | bash '$SIGN_SH' --usb '$(M P)' --zip '$d/$ZN' --manifest '$d/ai-commerce-copilot-$V.manifest.json' --sig-out '$SIGF' --role primary --plugin-dir '$PLK' --version '$V' --sha256 '$SHA' --commit '${COMMIT:0:12}' --primary-fp '$FPP' --expect-volume-uuid '$UUID_P'"
# negatives against the produced signature
php "$REL/lib/usb_sign.php" wrong-key-sig --plugin-dir "$PLK" --manifest "$MAN" --out "$TMP/wrong.sig" >/dev/null 2>&1
t_fail "a signature by a throwaway WRONG key does not verify against the trusted list" php "$PLK/bin/sign-release.php" verify --manifest "$MAN" --sig "$TMP/wrong.sig" --pubkeys "$LIST" --zip "$ZIP"
printf X >> "$TMP/tampered.zip"; t_fail "tamper: the signature does not accept a tampered ZIP (zip-aware verify)" php "$PLK/bin/sign-release.php" verify --manifest "$MAN" --sig "$SIGF" --pubkeys "$LIST" --zip "$TMP/tampered.zip"
jq '.size = (.size + 1)' "$MAN" > "$TMP/man-tampered.json"; t_fail "tamper: the signature does not accept a tampered manifest" php "$PLK/bin/sign-release.php" verify --manifest "$TMP/man-tampered.json" --sig "$SIGF" --pubkeys "$LIST"
# the publisher's verification, unchanged from P44, accepts the USB signature and the offline verifier of the published-release tool too
t_ok "the Plugin's own offline verify with the primary public key alone accepts it" php "$PLK/bin/sign-release.php" verify --manifest "$d/ai-commerce-copilot-$V.manifest.json" --sig "$SIGF" --pubkeys "$PRI"
# the P41/P44 offline release verifier (unchanged) accepts the USB-made signature: no publisher/verifier change is needed
VP="$(bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$SHA" --manifest "$d/ai-commerce-copilot-$V.manifest.json" --sig "$SIGF" --plugin-dir "$PLK" --local-zip "$d/$ZN" --out "$TMP/vp-out" 2>&1)"; VPRC=$?
printf '%s\n' "$VP" >> "$LOG"
t_eq "the unchanged offline release verifier (verify-published-plugin.sh --mode offline) accepts the USB-made signature (rc 0)" "$VPRC" "0"
# a second case: wrong LABEL, right UUID (rename the volume): signing still works, the label proves nothing
diskutil rename "$(M P)" RENAMEDLBL >/dev/null 2>&1
if [ "$(diskutil info -plist "$(M P)" | python3 -I -c 'import plistlib,sys; print(plistlib.loads(sys.stdin.buffer.read())["VolumeName"])')" = RENAMEDLBL ]; then
  FIX r_label; RO="$(SIGNPY "$PHRASE" r_label 2>&1)"; RORC=$?
  t_eq "a stick with a DIFFERENT label but the right UUID still signs (rc 0: identity is the UUID + key, not the label)" "$RORC" "0"
  t_contains "...the output shows the new label as 'not trusted'" "$RO" "label 'RENAMEDLBL' (NOT trusted)"
else t_skip "wrong label, right UUID" "diskutil rename did not apply to the image"; fi
# emergency standby
t_rc "standby emergency without a reason is REFUSED" 3 SGN --usb "$(M S)" --role standby --emergency-standby --standby-fp "$FPS" --plugin-dir "$PLK" --zip "$ZIP" --manifest "$MAN" --version "$V" --sha256 "$SHA" --commit "${COMMIT:0:12}"
mkdir -p "$TMP/out/emg"; cp "$ZIP" "$MAN" "$TMP/out/emg/"
EO="$(printf '%s\n' "$PHRASE WITH THE STANDBY KEY" | env AICC_TEST_HARNESS=1 bash "$SIGN_SH" --usb "$(M S)" --role standby --emergency-standby --standby-fp "$FPS" --emergency-reason "test: primary stick lost" --plugin-dir "$PLK" --zip "$TMP/out/emg/$ZN" --manifest "$TMP/out/emg/ai-commerce-copilot-$V.manifest.json" --version "$V" --sha256 "$SHA" --commit "${COMMIT:0:12}" --expect-volume-uuid "$UUID_S" 2>&1)"; ERC=$?
t_eq "the STANDBY signs only through the emergency flag with its own phrase (rc 0)" "$ERC" "0"
t_contains "...and the output says EMERGENCY and the reason" "$EO" "the STANDBY, EMERGENCY: test: primary stick lost"
t_contains "...the signature names the standby fingerprint" "$(cat "$TMP/out/emg/ai-commerce-copilot-$V.manifest.sig")" "\"key_id\": \"$FPS\""
mkdir -p "$TMP/out/emg2"; cp "$ZIP" "$MAN" "$TMP/out/emg2/"
t_rc "...the normal phrase does NOT unlock the emergency path (rc 3)" 3 env AICC_TEST_HARNESS=1 bash -c "printf '%s\n' '$PHRASE' | bash '$SIGN_SH' --usb '$(M S)' --role standby --emergency-standby --standby-fp '$FPS' --emergency-reason x --plugin-dir '$PLK' --zip '$TMP/out/emg2/$ZN' --manifest '$TMP/out/emg2/ai-commerce-copilot-$V.manifest.json' --version '$V' --sha256 '$SHA' --commit '${COMMIT:0:12}'"
# --eject
detach_img P; attach_img P; FIX r_eject
ZO="$(printf '%s\n' "$PHRASE" | env AICC_TEST_HARNESS=1 bash "$SIGN_SH" --usb "$(M P)" --zip "$TMP/out/r_eject/$ZN" --manifest "$TMP/out/r_eject/ai-commerce-copilot-$V.manifest.json" --sig-out "$TMP/out/r_eject/ai-commerce-copilot-$V.manifest.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_P" --eject 2>&1)"
t_contains "--eject ejects the stick after signing" "$ZO" "Ejected"
t_fail "...and the mount is gone" test -d "$(M P)/AICC-RELEASE-SIGNING"
attach_img P

echo "== F. old keys are rejected by a build that bakes the new keys =="
# a throwaway OLD key pair signs a build that bakes the OLD keys; that signature must not verify against the build baking the NEW keys
OLDP="$TMP/plug-old"; git clone -q --local "$PLUG_SRC" "$OLDP" && git -C "$OLDP" checkout -q --detach "$PLUG_COMMIT" && git -C "$OLDP" config user.email t@example.test && git -C "$OLDP" config user.name t
php "$OLDP/bin/sign-release.php" keygen --secret-out "$TMP/keys/old.key" > "$TMP/keys/old.out" 2>&1; OLDPUB="$(sed -n 's/^public key.*: //p' "$TMP/keys/old.out")"
sed -i.bak "s#^UPDATE_PUBLIC_KEYS=.*#UPDATE_PUBLIC_KEYS=$OLDPUB#" "$OLDP/release/endpoints.conf" && rm -f "$OLDP/release/endpoints.conf.bak" && git -C "$OLDP" commit -qam "old throwaway key"
mkdir -p "$TMP/oldb"; ( cd "$OLDP" && bin/build-release.sh --out "$TMP/oldb" >/dev/null 2>&1 )
OLDMAN="$(ls "$TMP/oldb/"*.manifest.json)"; OLDZIP="${OLDMAN%.manifest.json}.zip"
AICC_RELEASE_SIGNING_KEY_FILE="$TMP/keys/old.key" php "$OLDP/bin/sign-release.php" sign --manifest "$OLDMAN" --zip "$OLDZIP" >/dev/null 2>&1
OLDSIG="${OLDMAN%.json}.sig"
t_ok "the old key's signature is valid for its own build (control)" php "$OLDP/bin/sign-release.php" verify --manifest "$OLDMAN" --sig "$OLDSIG" --pubkeys "$OLDPUB" --zip "$OLDZIP"
t_fail "the old key's signature is REJECTED against the new trusted list" php "$PLK/bin/sign-release.php" verify --manifest "$OLDMAN" --sig "$OLDSIG" --pubkeys "$LIST" --zip "$OLDZIP"
t_fail "...and the new build's verify (baked new keys) rejects a manifest signed by the old key" php "$PLK/bin/sign-release.php" verify --manifest "$MAN" --sig "$OLDSIG" --pubkeys "$LIST" --zip "$ZIP"
t_fail "...and the build that bakes the NEW keys cannot be signed with the OLD key (the Plugin tool refuses)" env AICC_RELEASE_SIGNING_KEY_FILE="$TMP/keys/old.key" php "$PLK/bin/sign-release.php" sign --manifest "$MAN" --zip "$ZIP" --sig-out "$TMP/old-on-new.sig"

echo "== G. backup (throwaway images only; the real devices are never used) =="
mkimg B BACKUPSTK && UUID_B="$(uuid_of B)"
t_contains "backup-plan prints the options and executes nothing" "$(CER backup-plan 2>&1)" "OFFLINE BACKUP OPTIONS"
t_contains "...never the other key's stick, never the cloud" "$(CER backup-plan 2>&1)" "never back one key up onto the other key's stick"
BK() { CER backup --from-usb "$(M P)" --role primary --to-usb "$@"; }
BKY() { local ph="$1"; shift; CERY "$ph" backup --from-usb "$(M P)" --role primary --to-usb "$@"; }
t_rc "backup: from == to (the same volume) is REFUSED" 3 BKY "COPY PRIMARY KEY FROM ${UUID_P:0:8} TO ${UUID_P:0:8}" "$(M P)"
t_rc "backup: a destination that holds the OTHER role's key (the standby stick) is REFUSED" 3 BKY "COPY PRIMARY KEY FROM ${UUID_P:0:8} TO ${UUID_S:0:8}" "$(M S)"
t_rc "backup: a cloud-synced destination path is REFUSED" 3 BKY "COPY PRIMARY KEY FROM ${UUID_P:0:8} TO 00000000" "$TMP/Mobile Documents/com~apple~CloudDocs"
mkdir -p "$TMP/Dropbox"; t_rc "backup: a Dropbox path is REFUSED" 3 BKY "x" "$TMP/Dropbox"
t_rc "backup: a destination inside a git repository is REFUSED" 3 BKY "x" "$REPO/infra"
t_rc "backup: an internal disk (the system volume) as the destination is REFUSED" 3 env -u AICC_TEST_HARNESS bash "$CER_SH" backup --from-usb "$(M P)" --role primary --to-usb / </dev/null
t_rc "backup: a plain internal folder as the destination is REFUSED" 3 BKY "x" "$TMP/h"
t_rc "backup: a wrong confirmation phrase is REFUSED" 3 BKY "COPY PRIMARY KEY FROM X TO Y" "$(M B)"
t_eq "...nothing was copied by any refusal" "$(nfiles "$(M B)" 'AICC-RELEASE-SIGNING')" "0"
t_rc "backup: the source must hold that role's key (standby from the primary stick: REFUSED)" 3 CER backup --from-usb "$(M P)" --role standby --to-usb "$(M B)"
BO="$(logrun env AICC_TEST_HARNESS=1 bash -c "printf '%s\n' 'COPY PRIMARY KEY FROM ${UUID_P:0:8} TO ${UUID_B:0:8}' | bash '$CER_SH' backup --from-usb '$(M P)' --role primary --to-usb '$(M B)'")"; BRC=$?
t_eq "backup after the typed confirmation: rc 0" "$BRC" "0"
t_contains "...the fingerprint is identical on both sticks" "$BO" "fingerprint $FPP is identical on both sticks"
t_eq "...the copy derives the same public key" "$(php "$REL/lib/usb_sign.php" derive --key-file "$(M B)/AICC-RELEASE-SIGNING/aicc-release-primary.key" | sed -n 's/^pub=//p')" "$PRI"
t_eq "...its identity file names the destination's own UUID and the original" "$("${UTP[@]}" jget "$(M B)/AICC-RELEASE-SIGNING/aicc-release-primary.identity.json" volume_uuid)|$("${UTP[@]}" jget "$(M B)/AICC-RELEASE-SIGNING/aicc-release-primary.identity.json" backup_of_volume_uuid)" "$UUID_B|$UUID_P"
t_eq "...no ._ files on the destination" "$(find "$(M B)" -name '._*' | wc -l | tr -d ' ')" "0"
t_eq "...the source key is unchanged" "$(php "$REL/lib/usb_sign.php" derive --key-file "$KP" | sed -n 's/^pub=//p')" "$PRI"
t_rc "backup again onto the same destination is REFUSED (never overwrites)" 3 BKY "COPY PRIMARY KEY FROM ${UUID_P:0:8} TO ${UUID_B:0:8}" "$(M B)"
t_rc "primary and standby never share a device: a STANDBY backup onto the primary backup stick is REFUSED" 3 CERY "COPY STANDBY KEY FROM ${UUID_S:0:8} TO ${UUID_B:0:8}" backup --from-usb "$(M S)" --role standby --to-usb "$(M B)"
t_rc "verify of the backup stick passes (its own UUID)" 0 env AICC_TEST_HARNESS=1 bash "$CER_SH" verify --usb "$(M B)" --role primary --expect-pubkey "$PRI" --expect-volume-uuid "$UUID_B" --handover-dir "$TMP/none" </dev/null
FIX bk; BS="$(printf '%s\n' "$PHRASE" | env AICC_TEST_HARNESS=1 bash "$SIGN_SH" --usb "$(M B)" --zip "$TMP/out/bk/$ZN" --manifest "$TMP/out/bk/ai-commerce-copilot-$V.manifest.json" --sig-out "$TMP/out/bk/ai-commerce-copilot-$V.manifest.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_B" 2>&1)"
t_contains "signing from the backup stick works with ITS volume UUID" "$BS" "SIGNED  $V  key $FPP"
t_rc "...and the ORIGINAL's UUID is refused for the backup stick (rc 3)" 3 env AICC_TEST_HARNESS=1 bash "$SIGN_SH" --usb "$(M B)" --zip "$ZIP" --manifest "$MAN" --sig-out "$TMP/out/bk-wrong.sig" "${S_ARGS[@]}" --expect-volume-uuid "$UUID_P" </dev/null

echo "== H. no secret anywhere, no password prompt, no unlock step =="
SCRIPTS="$REL/usb-key-ceremony.sh $REL/sign-plugin-release-usb.sh $REL/lib/usb-common.sh $REL/lib/usb_tools.py $REL/lib/usb_sign.php $REL/render-owner-signing-command.sh"
t_eq "grep proof: no passphrase / keychain / stdinpass / -encryption / read -s in the new scripts" "$(grep -nEi 'passphrase|keychain|stdinpass|-encryption|read -[a-z]*s |security (find|add)-|hdiutil (create|attach)|openssl enc|gpg ' $SCRIPTS | wc -l | tr -d ' ')" "0"
t_eq "grep proof: the scripts never print or pass the secret (no cat/echo/env of the key file; the key path is the only thing handed to PHP)" "$(grep -nE 'cat "\$(KF|kf)"|echo "\$\(cat|AICC_RELEASE_SIGNING_KEY_FILE|export .*KEY' $REL/usb-key-ceremony.sh $REL/sign-plugin-release-usb.sh $REL/lib/usb-common.sh | wc -l | tr -d ' ')" "0"
t_eq "...the only place a key file is copied is the explicit, confirmed backup command (one cat)" "$(grep -c 'cat "\$skey" >' $REL/usb-key-ceremony.sh)" "1"
t_eq "grep proof: the signing script never writes to the stick (no cp/mv/rm/touch/mkdir/tee/> onto \$MP, \$KF or \$IDF)" "$(grep -nE '(cp|mv|rm|touch|mkdir|tee|ln|chmod)[^|;]*"\$(MP|KF|IDF|USB)"|> *"\$(MP|KF|IDF)' $REL/sign-plugin-release-usb.sh | grep -v -E '^\s*[0-9]+:\s*#' | wc -l | tr -d ' ')" "0"
t_eq "the scripts have two 'read' loops only: usb_confirm (stdin, the typed phrase) and the parse of the classifier's temp file (not stdin)" "$(grep -nE '(^|[^a-z])read +-[a-zA-Z]' $REL/usb-key-ceremony.sh $REL/sign-plugin-release-usb.sh $REL/lib/usb-common.sh $REL/render-owner-signing-command.sh | wc -l | tr -d ' ')" "2"
t_eq "...and no read is silent (-s)" "$(cat $REL/usb-key-ceremony.sh $REL/sign-plugin-release-usb.sh $REL/lib/usb-common.sh $REL/render-owner-signing-command.sh | grep -cE 'read +-[a-zA-Z]*s')" "0"
t_eq "...usb_confirm is the only read, without -s" "$(grep -c 'IFS= read -r got' $REL/lib/usb-common.sh)|$(grep -c 'read -s' $REL/lib/usb-common.sh)" "1|0"
t_not_contains "the confirmation prompt is a phrase, not a password prompt" "$(printf '%s' "$OUT" | tr 'A-Z' 'a-z')" "password:"
# secret scan: the key's content must not appear in any log, output, identity, handover, signature, argv or environment record
SECRETS_OK=1
for kf in "$KP" "$KS" "$(M B)/AICC-RELEASE-SIGNING/aicc-release-primary.key" "$TMP/keys/ref.key"; do
  bad="$(python3 -I - "$kf" "$TMP/logs" "$TMP/h" "$TMP/out" "$IDP" "$IDS" <<'PY'
import os, sys
key = open(sys.argv[1]).read().strip()
hits = []
for root in sys.argv[2:]:
    paths = [root] if os.path.isfile(root) else [os.path.join(dp, f) for dp, _, fs in os.walk(root) for f in fs]
    for p in paths:
        try:
            if key in open(p, errors="replace").read(): hits.append(p)
        except OSError: pass
print(len(hits))
PY
)"
  [ "$bad" = 0 ] || SECRETS_OK=0
done
t_eq "the secret key content is in NO log, handover, identity file, signature or output" "$SECRETS_OK" "1"
t_eq "no 64-byte base64 secret (86 chars + ==) appears in any log, handover or identity file (the public .sig files hold a 64-byte SIGNATURE of that shape, so they are excluded here and scanned for the key content above)" "$(grep -rEh --exclude='*.sig' '[A-Za-z0-9+/]{86}==' "$TMP/logs" "$TMP/h" "$IDP" "$IDS" 2>/dev/null | wc -l | tr -d ' ')" "0"
t_ok "the argv/environment record of every php/python3 call exists" test -s "$ARGLOG"
t_ok "...the key PATH may appear in argv (control)" grep -q 'aicc-release-primary.key' "$ARGLOG"
t_eq "...but the key CONTENT never appears in any argv or environment" "$(python3 -I - "$KP" "$ARGLOG" <<'PY'
import sys
key = open(sys.argv[1]).read().strip(); log = open(sys.argv[2], errors="replace").read()
print(log.count(key))
PY
)" "0"
t_eq "...and no environment variable of any child names a key or a secret" "$(grep -cE '^(AICC_RELEASE_SIGNING_KEY_FILE|AICC_.*SECRET|.*PASSWORD|.*PASSPHRASE)=' "$ARGLOG")" "0"
t_eq "the handover files carry no secret field and no 64-byte value" "$(cat "$HP" "$HS" | grep -ciE 'secret key|private|seed')" "0"
t_eq "the identity files carry no secret" "$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sorted(d))' "$IDP" | grep -ci 'secret')" "0"
t_eq "no key file or key copy exists in the repository or the handover directory" "$(find "$REPO" "$TMP/h" -name 'aicc-release-*.key' 2>/dev/null | grep -v '/node_modules/' | wc -l | tr -d ' ')" "0"

echo "== I. the owner command renderer =="
if [ -f "$RENDER_SH" ]; then
  RHO="$TMP/h/aicc-release-primary.handover.json"
  RN="$(bash "$RENDER_SH" --manifest "$MAN" --zip "$ZIP" --handover "$RHO" --plugin-commit "$COMMIT" --standby-handover "$TMP/h/aicc-release-standby.handover.json" --site-dir "$REPO" 2>&1)"; RNRC=$?
  t_eq "render-owner-signing-command.sh: rc 0" "$RNRC" "0"
  t_contains "...the block names the real fingerprint, SHA-256, commit and volume UUID" "$RN" "PRIMARY_FP=$FPP"
  t_contains "...the volume UUID from the handover" "$RN" "VOLUME_UUID=$UUID_P"
  t_contains "...the ZIP's SHA-256" "$RN" "SHA=$SHA"
  t_contains "...the single approved command" "$RN" "sign-plugin-release-usb.sh"
  t_not_contains "...no placeholder is left" "$RN" "<NEW_"
  t_not_contains "...no password step in the block" "$(printf '%s' "$RN" | tr 'A-Z' 'a-z')" "passphrase"
  cp "$RHO" "$TMP/h-unverified.json"; "${UTP[@]}" jset "$TMP/h-unverified.json" "ceremony_verified_after_replug=null"
  t_rc "the renderer refuses a handover whose ceremony was not verified after the re-plug" 3 bash "$RENDER_SH" --manifest "$MAN" --zip "$ZIP" --handover "$TMP/h-unverified.json" --plugin-commit "$COMMIT"
  t_rc "...and a manifest built from another commit" 3 bash "$RENDER_SH" --manifest "$MAN" --zip "$ZIP" --handover "$RHO" --plugin-commit $(printf 'ab%.0s' $(seq 20))
else t_skip "renderer" "render-owner-signing-command.sh not present"; fi

echo "== J. cleanup proof =="
for n in P S X P2 B; do detach_img "$n"; done
[ -z "$FAKEMNT" ] || { hdiutil detach "$FAKEMNT" >/dev/null 2>&1; FAKEMNT=""; }
t_eq "no throwaway image of this suite is still attached" "$(hdiutil info | grep -c "$TMP")" "0"
MOUNTED=""
t_summary
