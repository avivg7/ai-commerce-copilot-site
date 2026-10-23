#!/usr/bin/env bash
# SIGNING KIT SELF-TEST. Runs the exact owner procedure of 01-signing-and-backup-key-kit.md part A in a THROWAWAY sandbox with THROWAWAY keys:
# generate two keys (onto an encrypted disk image, like the real procedure), bake both public keys, build, sign, verify, tamper, rotate, then destroy everything.
# It never touches the real Plugin checkout (it works on a local clone), any network, or any real key. Safe to run any time.
#   signing-selftest.sh --plugin-repo <path to a Plugin checkout that has bin/sign-release.php> [--keep] [--site-repo DIR --cp-repo DIR]   (the last two also prove the publish-plugin-release.sh local checks)
set -uo pipefail
PLUGIN=""; KEEP=0; SITE=""; CP=""
while [ $# -gt 0 ]; do case "$1" in --plugin-repo) PLUGIN="${2:-}"; shift 2;; --keep) KEEP=1; shift;; --site-repo) SITE="${2:-}"; shift 2;; --cp-repo) CP="${2:-}"; shift 2;; *) echo "usage: $0 --plugin-repo DIR [--keep]" >&2; exit 2;; esac; done
[ -f "$PLUGIN/bin/sign-release.php" ] || { echo "no bin/sign-release.php in '$PLUGIN'" >&2; exit 2; }
SB="$(mktemp -d "${TMPDIR:-/tmp}/aicc-signing-selftest.XXXXXX")"; chmod 700 "$SB"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL  $1"; }
t_ok() { local d="$1"; shift; if "$@" >"$SB/last.out" 2>&1; then ok "$d"; else bad "$d"; sed 's/^/        /' "$SB/last.out" | head -8; fi; }
t_no() { local d="$1"; shift; if "$@" >"$SB/last.out" 2>&1; then bad "$d (was accepted!)"; else ok "$d  [$(head -c 150 "$SB/last.out" | tr '\n' ' ')]"; fi; }
MNT=""
cleanup() {
  if [ -n "$MNT" ] && [ -d "$MNT" ]; then hdiutil detach "$MNT" -force >/dev/null 2>&1 || true; fi
  if [ "$KEEP" = 1 ]; then echo "sandbox kept at $SB (THROWAWAY keys only)"; return; fi
  # best-effort overwrite of the throwaway key files before deletion (APFS/SSD make a true shred impossible: that is why the REAL keys never touch the internal disk)
  find "$SB" -name '*.key' -type f -exec sh -c 'for f; do head -c 128 /dev/urandom > "$f" 2>/dev/null; done' _ {} + 2>/dev/null
  rm -rf "$SB"; [ ! -e "$SB" ] && echo "sandbox deleted: $SB"
}
trap cleanup EXIT
echo "== sandbox $SB; php $(php -r 'echo PHP_VERSION;') sodium=$(php -r 'echo function_exists("sodium_crypto_sign_detached")?"yes":"NO";')"

echo "== 0. clone the Plugin into the sandbox (the real repo is never modified)"
git clone -q --no-hardlinks "$PLUGIN" "$SB/plugin" || { echo "clone failed"; exit 1; }
git -C "$SB/plugin" -c user.name=selftest -c user.email=selftest@example.invalid checkout -q --detach "$(git -C "$PLUGIN" rev-parse HEAD)"
git -C "$SB/plugin" config user.name selftest; git -C "$SB/plugin" config user.email selftest@example.invalid
cd "$SB/plugin" || exit 1

echo "== 1. encrypted key medium (macOS encrypted disk image; the real one lives on the USB stick) + keygen onto it"
printf 'throwaway-selftest-passphrase\n' | hdiutil create -size 16m -encryption AES-256 -fs APFS -volname AICCKEYS -stdinpass "$SB/keys.dmg" >/dev/null 2>&1 && ok "encrypted image created (AES-256)" || bad "hdiutil create"
MNT="$SB/mnt"; mkdir -p "$MNT"
printf 'throwaway-selftest-passphrase\n' | hdiutil attach -stdinpass -mountpoint "$MNT" "$SB/keys.dmg" >/dev/null 2>&1 && ok "image mounted" || bad "hdiutil attach"
umask 077
t_ok "keygen PRIMARY onto the encrypted image" php bin/sign-release.php keygen --secret-out "$MNT/aicc-release-primary.key"
t_ok "keygen STANDBY onto the encrypted image" php bin/sign-release.php keygen --secret-out "$MNT/aicc-release-standby.key"
t_no "keygen REFUSES to overwrite an existing key" php bin/sign-release.php keygen --secret-out "$MNT/aicc-release-primary.key"
t_no "keygen REFUSES a path inside the repository" php bin/sign-release.php keygen --secret-out "$SB/plugin/inrepo.key"
t_no "keygen REFUSES a relative path" php bin/sign-release.php keygen --secret-out relative.key
for k in primary standby; do
  m="$(stat -f %Lp "$MNT/aicc-release-$k.key")"; [ "$m" = 600 ] && ok "$k key file mode 0600" || bad "$k key mode $m"
done
# derive public keys + fingerprints WITHOUT printing any secret
pubof() { php -r '$s=base64_decode(trim(file_get_contents($argv[1])),true);echo base64_encode(sodium_crypto_sign_publickey_from_secretkey($s));' "$1"; }
PRIM_PUB="$(pubof "$MNT/aicc-release-primary.key")"; STBY_PUB="$(pubof "$MNT/aicc-release-standby.key")"
[ ${#PRIM_PUB} -eq 44 ] && [ ${#STBY_PUB} -eq 44 ] && [ "$PRIM_PUB" != "$STBY_PUB" ] && ok "two distinct 44-character public keys" || bad "public keys malformed/equal"
fp_indep() { printf '%s' "$1" | base64 -D | shasum -a 256 | cut -c1-16 | sed -E 's/(....)(....)(....)(....)/\1-\2-\3-\4/'; }
FP_PRIM="$(fp_indep "$PRIM_PUB")"; echo "      primary public: $PRIM_PUB  fingerprint(independent, shasum): $FP_PRIM"; echo "      standby public: $STBY_PUB  fingerprint(independent, shasum): $(fp_indep "$STBY_PUB")"

echo "== 2. put BOTH public keys in release/endpoints.conf and commit (the only thing that goes in git)"
python3 - "$SB/plugin/release/endpoints.conf" "$PRIM_PUB,$STBY_PUB" <<'PY'
import re,sys
p,v=sys.argv[1:3]; t=open(p).read()
t=re.sub(r'(?m)^UPDATE_PUBLIC_KEYS=.*$', 'UPDATE_PUBLIC_KEYS='+v, t); open(p,'w').write(t)
PY
grep -q "^UPDATE_PUBLIC_KEYS=$PRIM_PUB,$STBY_PUB\$" release/endpoints.conf && ok "endpoints.conf holds primary,standby" || bad "endpoints.conf edit"
git add release/endpoints.conf && git commit -q -m "selftest: bake throwaway public keys" && ok "committed (clean tree for the build)" || bad "commit"
git status --porcelain --untracked-files=no | grep -q . && bad "tree not clean" || ok "working tree clean"

echo "== 3. build the release, sign with the PRIMARY, verify (the owner commands)"
t_ok "build-release.sh --out dist" bin/build-release.sh --out dist
MAN="$(ls dist/ai-commerce-copilot-*.manifest.json | head -1)"; VER="$(php -r 'echo json_decode(file_get_contents($argv[1]),true)["version"];' "$MAN")"; ZIP="dist/ai-commerce-copilot-$VER.zip"; SIG="dist/ai-commerce-copilot-$VER.manifest.sig"
echo "      version under test: $VER"
unzip -p "$ZIP" ai-commerce-copilot/includes/aicc-release-defaults.php | grep -q "PUBLIC_KEYS = '$PRIM_PUB,$STBY_PUB'" && ok "the ZIP carries both public keys (baked)" || bad "keys not baked"
t_no "sign REFUSES a group/world-readable key file" bash -c "chmod 644 '$MNT/aicc-release-primary.key'; AICC_RELEASE_SIGNING_KEY_FILE='$MNT/aicc-release-primary.key' php bin/sign-release.php sign --manifest '$MAN'; rc=\$?; chmod 600 '$MNT/aicc-release-primary.key'; exit \$rc"
t_no "sign REFUSES a missing key env var" env -u AICC_RELEASE_SIGNING_KEY_FILE php bin/sign-release.php sign --manifest "$MAN"
export AICC_RELEASE_SIGNING_KEY_FILE="$MNT/aicc-release-primary.key"
t_ok "sign with the PRIMARY" php bin/sign-release.php sign --manifest "$MAN"
unset AICC_RELEASE_SIGNING_KEY_FILE
grep -q "\"key_id\": \"$FP_PRIM\"" "$SIG" && ok "signature key_id == independently computed fingerprint of the primary ($FP_PRIM)" || bad "key_id mismatch"
t_ok "verify (tool, keys from the ZIP)" php bin/sign-release.php verify --manifest "$MAN" --sig "$SIG" --zip "$ZIP"
t_ok "verify (tool, explicit --pubkeys)" php bin/sign-release.php verify --manifest "$MAN" --sig "$SIG" --pubkeys "$PRIM_PUB,$STBY_PUB"
cat > "$SB/handcheck.php" <<'PHP'
<?php // independent check: no AICC code, PHP + sodium only (the snippet from docs/launch/update-signing.md section 4)
$m=json_decode(file_get_contents($argv[1]),true);$d=json_decode(file_get_contents($argv[2]),true);
$msg=implode("\n",["AICC-PLUGIN-RELEASE-v1","slug:ai-commerce-copilot","version:".$m["version"],"sha256:".$m["sha256"],"size:".$m["size"],"requires_wp:".$m["requires_wp"],"requires_php:".$m["requires_php"],"requires_wc:".$m["requires_wc"],"issued_at:".$d["issued_at"]])."\n";
exit(sodium_crypto_sign_verify_detached(base64_decode($d["signature"]),$msg,base64_decode($argv[3]))?0:1);
PHP
t_ok "INDEPENDENT hand-check (no AICC code) accepts with the primary public key" php "$SB/handcheck.php" "$MAN" "$SIG" "$PRIM_PUB"
t_no "INDEPENDENT hand-check rejects with the standby public key (wrong key)" php "$SB/handcheck.php" "$MAN" "$SIG" "$STBY_PUB"
t_ok "ZIP sha256 sidecar matches" bash -c "cd dist && shasum -a 256 -c ai-commerce-copilot-$VER.zip.sha256"

if [ -n "$SITE" ] && [ -n "$CP" ]; then
  echo "== 3b. the Site's publish-plugin-release.sh --check-only (LOCAL checks only: no network, no host) accepts the signed release and rejects bad ones"
  PUB="$SITE/infra/release/publish-plugin-release.sh"; INST="$CP/scripts/plugin-release/install-plugin-release.sh"
  mkdir -p "$SB/stub"; printf '#!/bin/sh\nexit 255\n' > "$SB/stub/ssh"; chmod +x "$SB/stub/ssh"   # no network: ssh is a stub that fails at once
  PCHK() { PATH="$SB/stub:$PATH" bash "$PUB" --check-only --zip "$1" --manifest "$2" --sha256-file "$ZIP.sha256" --signature "$3" --plugin-dir "$SB/plugin" --installer "$INST" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id 0123456789abcdef0123456789abcdef; }
  PCHK "$ZIP" "$MAN" "$SIG" >"$SB/pchk.out" 2>&1; grep -q "signature verified locally" "$SB/pchk.out" && ok "check-only: genuine ZIP + manifest + PRIMARY signature pass every LOCAL check ('signature verified locally'); it then stops only because ssh is stubbed" || { bad "check-only genuine"; cat "$SB/pchk.out"; }
  mkdir -p "$SB/tz"; cp "$ZIP" "$SB/tz/"; printf X | dd of="$SB/tz/ai-commerce-copilot-$VER.zip" bs=1 seek=300 conv=notrunc 2>/dev/null
  t_no "check-only: tampered ZIP refused" PCHK "$SB/tz/ai-commerce-copilot-$VER.zip" "$MAN" "$SIG"
  cp "$SIG" "$SB/ai-commerce-copilot-$VER.manifest.sig"; python3 - "$SB/ai-commerce-copilot-$VER.manifest.sig" <<'PY'
import json,sys,base64
d=json.load(open(sys.argv[1])); b=bytearray(base64.b64decode(d["signature"])); b[5]^=1; d["signature"]=base64.b64encode(bytes(b)).decode(); json.dump(d,open(sys.argv[1],"w"))
PY
  t_no "check-only: a one-bit-flipped signature refused" PCHK "$ZIP" "$MAN" "$SB/ai-commerce-copilot-$VER.manifest.sig"
fi

echo "== 4. TAMPER tests: every one must be REJECTED"
cp "$MAN" "$SB/m.good"; cp "$SIG" "$SB/s.good"
python3 - "$MAN" "$SB/m.version" version "9.9.9" <<'PY'
import json,sys; m=json.load(open(sys.argv[1])); m[sys.argv[3]]=sys.argv[4]; json.dump(m,open(sys.argv[2],"w"))
PY
python3 - "$MAN" "$SB/m.sha" sha256 "$(printf 'a%.0s' $(seq 64))" <<'PY'
import json,sys; m=json.load(open(sys.argv[1])); m[sys.argv[3]]=sys.argv[4]; json.dump(m,open(sys.argv[2],"w"))
PY
python3 - "$MAN" "$SB/m.size" size "1" <<'PY'
import json,sys; m=json.load(open(sys.argv[1])); m[sys.argv[3]]=int(sys.argv[4]); json.dump(m,open(sys.argv[2],"w"))
PY
t_no "manifest with a different VERSION (9.9.9)" php bin/sign-release.php verify --manifest "$SB/m.version" --sig "$SIG" --pubkeys "$PRIM_PUB,$STBY_PUB"
t_no "manifest with a different SHA-256" php bin/sign-release.php verify --manifest "$SB/m.sha" --sig "$SIG" --pubkeys "$PRIM_PUB,$STBY_PUB"
t_no "manifest with a different SIZE" php bin/sign-release.php verify --manifest "$SB/m.size" --sig "$SIG" --pubkeys "$PRIM_PUB,$STBY_PUB"
python3 - "$SIG" "$SB/s.flip" <<'PY'
import json,sys,base64
d=json.load(open(sys.argv[1])); b=bytearray(base64.b64decode(d["signature"])); b[0]^=1; d["signature"]=base64.b64encode(bytes(b)).decode(); json.dump(d,open(sys.argv[2],"w"))
PY
t_no "signature with ONE flipped bit" php bin/sign-release.php verify --manifest "$MAN" --sig "$SB/s.flip" --pubkeys "$PRIM_PUB,$STBY_PUB"
python3 - "$SIG" "$SB/s.time" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); d["issued_at"]="2030-01-01T00:00:00Z"; json.dump(d,open(sys.argv[2],"w"))
PY
t_no "signing time altered" php bin/sign-release.php verify --manifest "$MAN" --sig "$SB/s.time" --pubkeys "$PRIM_PUB,$STBY_PUB"
: > "$SB/s.empty"; echo '{"garbage":1}' > "$SB/s.garbage"
t_no "empty signature file" php bin/sign-release.php verify --manifest "$MAN" --sig "$SB/s.empty" --pubkeys "$PRIM_PUB"
t_no "garbage signature file" php bin/sign-release.php verify --manifest "$MAN" --sig "$SB/s.garbage" --pubkeys "$PRIM_PUB"
php bin/sign-release.php keygen --secret-out "$MNT/attacker.key" >/dev/null 2>&1; ATT_PUB="$(pubof "$MNT/attacker.key")"
t_no "verify against an UNRELATED public key (attacker key only)" php bin/sign-release.php verify --manifest "$MAN" --sig "$SIG" --pubkeys "$ATT_PUB"
cp "$ZIP" "$SB/z.tampered"; printf 'X' | dd of="$SB/z.tampered" bs=1 seek=200 conv=notrunc 2>/dev/null
t_no "ZIP with one byte changed (hash no longer matches the signed manifest)" php bin/sign-release.php verify --manifest "$MAN" --sig "$SIG" --zip "$SB/z.tampered"
t_no "SIGN refuses a tampered ZIP" env AICC_RELEASE_SIGNING_KEY_FILE="$MNT/aicc-release-primary.key" php bin/sign-release.php sign --manifest "$MAN" --zip "$SB/z.tampered" --sig-out "$SB/never.sig"
[ ! -e "$SB/never.sig" ] && ok "...and wrote no signature" || bad "signature written for a tampered ZIP"
t_no "SIGN with an attacker key refused: the ZIP does not carry that public key" env AICC_RELEASE_SIGNING_KEY_FILE="$MNT/attacker.key" php bin/sign-release.php sign --manifest "$MAN" --sig-out "$SB/att.sig"
cmp -s "$MAN" "$SB/m.good" && cmp -s "$SIG" "$SB/s.good" && ok "the genuine manifest and signature are unchanged by all of the above" || bad "genuine files changed"
t_ok "the genuine pair still verifies after all attacks" php bin/sign-release.php verify --manifest "$MAN" --sig "$SIG" --zip "$ZIP"

echo "== 5. STANDBY can sign the same build (rotation / emergency path) and is accepted"
t_ok "sign with the STANDBY" env AICC_RELEASE_SIGNING_KEY_FILE="$MNT/aicc-release-standby.key" php bin/sign-release.php sign --manifest "$MAN" --sig-out "$SB/standby.sig"
t_ok "standby-signed pair verifies" php bin/sign-release.php verify --manifest "$MAN" --sig "$SB/standby.sig" --zip "$ZIP"

echo "== 6. determinism: rebuilding the same commit gives the same bytes (so a signature is reproducible evidence)"
bin/build-release.sh --out "$SB/dist2" >/dev/null 2>&1
[ "$(shasum -a 256 < "$ZIP")" = "$(shasum -a 256 < "$SB/dist2/ai-commerce-copilot-$VER.zip")" ] && ok "rebuild is byte-identical" || bad "rebuild differs"

echo "== 7. a build with NO key baked is never signable (what keeps the updater launch-blocked)"
git checkout -q HEAD~1 -- release/endpoints.conf; git -c user.name=s -c user.email=s@example.invalid commit -q -am "selftest: back to empty key"
bin/build-release.sh --out "$SB/dist3" >"$SB/b3.out" 2>&1; grep -q -i "warning" "$SB/b3.out" && ok "build prints the loud no-key WARNING" || bad "no warning for an empty key"
M3="$(ls "$SB"/dist3/*.manifest.json | head -1)"
t_no "sign REFUSES a ZIP that carries no key" env AICC_RELEASE_SIGNING_KEY_FILE="$MNT/aicc-release-primary.key" php bin/sign-release.php sign --manifest "$M3" --sig-out "$SB/nokey.sig"

echo "== 8. the image is unreadable without the passphrase (key medium check)"
hdiutil detach "$MNT" -force >/dev/null 2>&1; MNT=""
printf 'wrong-passphrase\n' | hdiutil attach -stdinpass -mountpoint "$SB/mnt2" "$SB/keys.dmg" >/dev/null 2>&1 && bad "image mounted with a WRONG passphrase" || ok "wrong passphrase cannot mount the image"
echo "== RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
