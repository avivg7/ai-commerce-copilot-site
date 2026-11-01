#!/usr/bin/env bash
# Tests of infra/release/publish-plugin-release.sh (Mac side). ssh and rsync are STUBS that only record what they would do; nothing leaves this machine, the live host is never contacted.
# Run: bash infra/stack-tests/test_plugin_publish.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; PUB="$REPO/infra/release/publish-plugin-release.sh"
T_SUITE="plugin-publish"; . "$HERE/lib/t.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/appub.XXXX")"; trap 'rm -rf "$TMP"' EXIT
SID=0123456789abcdef0123456789abcdef; V=1.2.0; ZN="ai-commerce-copilot-$V.zip"
STUB="$TMP/stub"; mkdir -p "$STUB"; CALLS="$TMP/calls.log"; : > "$CALLS"
cat > "$STUB/ssh" <<EOS
#!/usr/bin/env bash
echo "ssh \$*" >> "$CALLS"
cmd="\${@: -1}"
case "\$cmd" in
  "cat /etc/aicc-stage-identity") printf 'AICC_ENV=%s\nAICC_HOSTNAME=%s\nAICC_STAGE_ID=%s\n' "\${STUB_ENV:-staging}" "\${STUB_HOSTNAME:-stage.copilt.org}" "\${STUB_ID:-$SID}" ;;
  *sha256sum\ -c*) exit "\${STUB_SHA_RC:-0}" ;;
  *"sudo cat "*"/current") echo "\${STUB_CURRENT:-}" ;;
  *"sudo aicc-wp eval"*) printf '%s' "\${STUB_PROBLEM:-}" ;;
  *"sudo bash "*) exit "\${STUB_INSTALL_RC:-0}" ;;
  *) exit 0 ;;
esac
EOS
cat > "$STUB/rsync" <<EOS
#!/usr/bin/env bash
echo "rsync \$*" >> "$CALLS"
EOS
chmod +x "$STUB/ssh" "$STUB/rsync"
KEY="$TMP/aicc_cp_stage"; printf -- '-----BEGIN %s-----\nDUMMY\n-----END %s-----\n' "OPENSSH PRIVATE KEY" "OPENSSH PRIVATE KEY" > "$KEY"; chmod 600 "$KEY"
PKEY="$TMP/aicc_cp_prod_operator"; cp "$KEY" "$PKEY"; PRODKEY="$TMP/aicc_digitalocean_prod"; cp "$KEY" "$PRODKEY"
KH="$TMP/known_hosts_prod"; echo "203.0.113.9 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItestonlytestonlytestonlytestonlytestonlytest" > "$KH"
# --- the offline signing tool of the Plugin (bin/sign-release.php); the REAL one is used when its worktree exists, with a THROWAWAY key generated here (never a real key) ---------------
PLUG_SRC="${AICC_PLUGIN_DIR:-/Users/avivgerman/Projects/ai-commerce-copilot-worktrees/launch-secfix}"
HAVE_SIGN=0; PUBKEY=""; PDIR="$TMP/plugin"; KEYF="$TMP/keys/release.key"
if [ -f "$PLUG_SRC/bin/sign-release.php" ] && [ -f "$PLUG_SRC/includes/class-aicc-release-signature.php" ] && command -v php >/dev/null 2>&1 && php -r 'exit(function_exists("sodium_crypto_sign_detached")?0:1);' 2>/dev/null; then
  mkdir -p "$PDIR/bin" "$PDIR/includes" "$PDIR/release" "$TMP/keys"; chmod 700 "$TMP/keys"
  cp "$PLUG_SRC/bin/sign-release.php" "$PDIR/bin/"; cp "$PLUG_SRC/includes/class-aicc-release-signature.php" "$PDIR/includes/"
  PUBKEY="$(php "$PDIR/bin/sign-release.php" keygen --secret-out "$KEYF" 2>/dev/null | sed -n 's/^public key.*: //p')"
  if [ -n "$PUBKEY" ]; then HAVE_SIGN=1; printf 'LICENSE_API_URL=https://www.copilt.org\nUPDATE_PUBLIC_KEYS=%s\n' "$PUBKEY" > "$PDIR/release/endpoints.conf"; fi
fi
# a built release in the shape bin/build-release.sh produces (the public key(s) are baked into includes/aicc-release-defaults.php)
B="$TMP/dist"; mkdir -p "$B"
python3 - "$B" "$V" "$PUBKEY" <<'PY'
import hashlib, json, sys, zipfile, os
d, v, pk = sys.argv[1:4]
zp = os.path.join(d, "ai-commerce-copilot-%s.zip" % v)
with zipfile.ZipFile(zp, "w") as z:
    z.writestr("ai-commerce-copilot/ai-commerce-copilot.php", "<?php\n/*\n * Plugin Name: AI Commerce Copilot\n * Version: %s\n */\n" % v)
    z.writestr("ai-commerce-copilot/includes/aicc-release-defaults.php", "<?php\nclass AICC_Release_Keys { const PUBLIC_KEYS = '%s'; }\n" % pk)
data = open(zp, "rb").read(); h = hashlib.sha256(data).hexdigest()
m = {"slug": "ai-commerce-copilot", "version": v, "filename": os.path.basename(zp), "sha256": h, "size": len(data), "requires_wp": "6.0", "requires_php": "7.4", "requires_wc": "7.0",
     "dirty": False, "built_from_commit": "a" * 40, "changelog": "x"}
json.dump(m, open(zp[:-4] + ".manifest.json", "w"))
open(zp + ".sha256", "w").write("%s  %s\n" % (h, os.path.basename(zp)))
PY
ZIP="$B/$ZN"; MAN="$B/ai-commerce-copilot-$V.manifest.json"; SHAF="$ZIP.sha256"; SHA="$(cut -d' ' -f1 "$SHAF")"
SIGN="ai-commerce-copilot-$V.manifest.sig"; SIG="$B/$SIGN"
if [ "$HAVE_SIGN" = 1 ]; then
  AICC_RELEASE_SIGNING_KEY_FILE="$KEYF" php "$PDIR/bin/sign-release.php" sign --manifest "$MAN" >/dev/null 2>&1
else
  # no signing tool on this machine: a structurally valid signature that cannot verify (enough for the staging-side sanity checks; the full-verification tests are skipped)
  python3 -I -c 'import base64, json, os, sys; json.dump({"schema": 1, "alg": "ed25519", "key_id": "0000-0000-0000-0000", "issued_at": "2026-10-23T10:00:00Z", "signature": base64.b64encode(os.urandom(64)).decode()}, open(sys.argv[1], "w"))' "$SIG"
fi
INST="$TMP/install-plugin-release.sh"; printf '#!/usr/bin/env bash\n# Install one AICC Plugin release into the Control Plane'"'"'s PRIVATE release store (docs/plugin-delivery.md).\necho fake\n' > "$INST"
PUBL() { env PATH="$STUB:$PATH" bash "$PUB" --installer "$INST" --stage-id "$SID" "$@"; }
# production 8: the host installer verifies against the owner's PUBLIC list handed over by the publisher (never the ZIP's own keys), so a signed publish or a --point-at needs one. The wrappers
# add a well-formed list unless the call names its own (--pubkeys / --plugin-dir) or sets NOKEY=1.
WKEY="${PUBKEY:-$(python3 -I -c 'import base64; print(base64.b64encode(bytes(range(32))).decode())')}"
KA() { case " $* " in *" --pubkeys "*|*" --plugin-dir "*) ;; *) [ "${NOKEY:-0}" = 1 ] || echo "--pubkeys $WKEY";; esac; }
# shellcheck disable=SC2046  # $(KA ...) must word-split into "--pubkeys <key>" (or nothing)
S() { PUBL --stage-host stage.copilt.org --stage-ip 203.0.113.9 --key "$KEY" $(KA "$@") "$@"; }
# shellcheck disable=SC2046
P() { PUBL --env production --stage-host www.copilt.org --stage-ip 203.0.113.9 --key "$PKEY" --known-hosts "$KH" $(KA "$@") "$@"; }
PV() { P --plugin-dir "$PDIR" "$@"; }       # production with the Plugin build dir (its release/endpoints.conf holds the public key the signature is verified against)
ZM=(--zip "$ZIP" --manifest "$MAN" --sha256-file "$SHAF")

echo "== local refusals (before ANY network access) =="
mkdir -p "$TMP/bad"; cp "$ZIP" "$TMP/bad/$ZN"; printf 'X' >> "$TMP/bad/$ZN"
t_rc "a tampered ZIP (hash differs from the manifest) is REFUSED" 3 S --zip "$TMP/bad/$ZN" --manifest "$MAN" --sha256-file "$SHAF"
jq '.dirty = true' "$MAN" > "$TMP/bad/dirty.json"; t_rc "a manifest that says dirty:true is REFUSED" 3 S --zip "$ZIP" --manifest "$TMP/bad/dirty.json" --sha256-file "$SHAF"
jq 'del(.dirty)' "$MAN" > "$TMP/bad/nodirty.json"; t_rc "a manifest without a dirty field is REFUSED" 3 S --zip "$ZIP" --manifest "$TMP/bad/nodirty.json" --sha256-file "$SHAF"
jq '.built_from_commit = "abc"' "$MAN" > "$TMP/bad/commit.json"; t_rc "a manifest without a 40-hex commit is REFUSED" 3 S --zip "$ZIP" --manifest "$TMP/bad/commit.json" --sha256-file "$SHAF"
jq '.version = "1.2"' "$MAN" > "$TMP/bad/ver.json"; t_rc "a non-strict version is REFUSED" 3 S --zip "$ZIP" --manifest "$TMP/bad/ver.json" --sha256-file "$SHAF"
jq '.slug = "other"' "$MAN" > "$TMP/bad/slug.json"; t_rc "another slug is REFUSED" 3 S --zip "$ZIP" --manifest "$TMP/bad/slug.json" --sha256-file "$SHAF"
echo "$(printf 'f%.0s' $(seq 64))  $ZN" > "$TMP/bad/other.sha256"; t_rc "a .sha256 file (second channel) that disagrees is REFUSED" 3 S --zip "$ZIP" --manifest "$MAN" --sha256-file "$TMP/bad/other.sha256"
cp "$ZIP" "$TMP/bad/renamed.zip"; t_rc "a ZIP with the wrong file name is REFUSED" 3 S --zip "$TMP/bad/renamed.zip" --manifest "$MAN" --sha256-file "$SHAF"
echo "#!/bin/sh" > "$TMP/bad/other-installer.sh"; t_rc "an installer that is not the Control Plane's script is REFUSED" 3 env PATH="$STUB:$PATH" bash "$PUB" --installer "$TMP/bad/other-installer.sh" --stage-id "$SID" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --key "$KEY" "${ZM[@]}"
t_rc "--point-at with --zip is REFUSED" 3 S --point-at 1.2.0 --zip "$ZIP" --manifest "$MAN"
t_rc "--point-at with a non-version is REFUSED" 3 S --point-at '1.2.0; rm -rf /'
t_rc "missing --zip/--manifest is a usage error" 2 S
echo "== environment gates =="
t_rc "stage: a production host name is REFUSED" 3 PUBL --stage-host www.copilt.org --stage-ip 203.0.113.9 --key "$KEY" "${ZM[@]}"
t_rc "stage: a non-stage name is REFUSED" 3 PUBL --stage-host example.org --stage-ip 203.0.113.9 --key "$KEY" "${ZM[@]}"
t_rc "stage: the production key name is REFUSED" 3 PUBL --stage-host stage.copilt.org --stage-ip 203.0.113.9 --key "$PKEY" "${ZM[@]}"
t_rc "the API Droplet's key is REFUSED" 3 PUBL --stage-host stage.copilt.org --stage-ip 203.0.113.9 --key "$PRODKEY" "${ZM[@]}"
for ip in 139.59.157.231 185.199.108.153 139.073.157.231; do t_rc "the address $ip is REFUSED" 3 PUBL --stage-host stage.copilt.org --stage-ip $ip --key "$KEY" "${ZM[@]}"; done
t_rc "a malformed --stage-id is REFUSED" 3 env PATH="$STUB:$PATH" bash "$PUB" --installer "$INST" --stage-id nothex --stage-host stage.copilt.org --stage-ip 203.0.113.9 --key "$KEY" "${ZM[@]}"
t_rc "production: a stage host name is REFUSED" 3 PUBL --env production --stage-host stage.copilt.org --stage-ip 203.0.113.9 --key "$PKEY" --known-hosts "$KH" --confirm-production $V --apply "${ZM[@]}"
t_rc "production: a key not named aicc_cp_prod* is REFUSED" 3 PUBL --env production --stage-host www.copilt.org --stage-ip 203.0.113.9 --key "$KEY" --known-hosts "$KH" --confirm-production $V --apply "${ZM[@]}"
t_rc "production: no --known-hosts (no trust on first use) is REFUSED" 3 PUBL --env production --stage-host www.copilt.org --stage-ip 203.0.113.9 --key "$PKEY" --confirm-production $V --apply "${ZM[@]}"
echo "other.example ssh-ed25519 AAAAxx" > "$TMP/known_other"; t_rc "production: a known-hosts file without the address is REFUSED" 3 PUBL --env production --stage-host www.copilt.org --stage-ip 203.0.113.9 --key "$PKEY" --known-hosts "$TMP/known_other" --confirm-production $V --apply "${ZM[@]}"
t_rc "production: no --confirm-production is REFUSED" 3 PV --apply "${ZM[@]}"
t_rc "production: a confirmation for another version is REFUSED" 3 PV --confirm-production 9.9.9 --apply "${ZM[@]}"
t_rc "production: --point-at needs its own confirmation" 3 P --point-at 1.1.0 --confirm-production $V --apply
t_eq "none of the refusals made an ssh or rsync call" "$(wc -l < "$CALLS" | tr -d ' ')" "0"

echo "== production never carries a pre-release (the Plugin head is 1.1.0-dev.N; the first customer version is the owner's decision) =="
python3 - "$TMP" <<'PY'
import hashlib, json, os, sys, zipfile
t = sys.argv[1]; v = "1.2.0-dev.1"
d = os.path.join(t, "prerel"); os.makedirs(d, exist_ok=True)
zp = os.path.join(d, "ai-commerce-copilot-%s.zip" % v)
with zipfile.ZipFile(zp, "w") as z:
    z.writestr("ai-commerce-copilot/ai-commerce-copilot.php", "<?php\n/*\n * Version: %s\n */\n" % v)
data = open(zp, "rb").read(); h = hashlib.sha256(data).hexdigest()
m = json.load(open(os.path.join(t, "dist", "ai-commerce-copilot-1.2.0.manifest.json"))); m["version"] = v; m["filename"] = os.path.basename(zp); m["sha256"] = h; m["size"] = len(data)
json.dump(m, open(zp[:-4] + ".manifest.json", "w")); open(zp + ".sha256", "w").write("%s  %s\n" % (h, os.path.basename(zp)))
PY
PR=(--zip "$TMP/prerel/ai-commerce-copilot-1.2.0-dev.1.zip" --manifest "$TMP/prerel/ai-commerce-copilot-1.2.0-dev.1.manifest.json" --sha256-file "$TMP/prerel/ai-commerce-copilot-1.2.0-dev.1.zip.sha256")
t_rc "production: a pre-release version (1.2.0-dev.1) is REFUSED (dry run)" 3 P --confirm-production 1.2.0-dev.1 "${PR[@]}"
t_contains "...and the refusal says why" "$(P --confirm-production 1.2.0-dev.1 "${PR[@]}" 2>&1)" "pre-release/development version"
t_rc "production: a pre-release version is REFUSED with --apply too" 3 P --confirm-production 1.2.0-dev.1 --apply "${PR[@]}"
t_rc "production: --point-at a pre-release version is REFUSED" 3 P --point-at 1.2.0-dev.1 --confirm-production 1.2.0-dev.1 --apply
t_ok "staging still accepts a pre-release (dry run; QA builds are 1.x.y-dev.N)" S --dry-run --allow-unsigned "${PR[@]}"
t_eq "...none of these refusals made a network call" "$(wc -l < "$CALLS" | tr -d ' ')" "0"

echo "== dry runs send nothing =="
t_ok "stage --dry-run prints the plan" S --dry-run "${ZM[@]}"
t_contains "...the plan names the installer hash, the --expect-sha256 and the store" "$(S --dry-run --set-current "${ZM[@]}")" "--expect-sha256 $SHA --set-current"
t_ok "production WITHOUT --apply is a dry run (exit 0)" PV --confirm-production $V "${ZM[@]}"
t_contains "...and says how to run it" "$(PV --confirm-production $V "${ZM[@]}")" "add --apply to run it"
t_eq "...zero calls so far" "$(wc -l < "$CALLS" | tr -d ' ')" "0"

echo "== identity gates (read-only ssh, nothing uploaded) =="
STUB_ENV=production STUB_HOSTNAME=www.copilt.org t_rc "stage command against a host that says PRODUCTION is refused" 3 S "${ZM[@]}"
STUB_ENV=staging t_rc "production command against a host that says STAGING is refused" 3 PV --confirm-production $V --apply "${ZM[@]}"
STUB_ENV=production STUB_HOSTNAME=www.copilt.org STUB_ID=ffffffffffffffffffffffffffffffff t_rc "production host with another id is refused" 3 PV --confirm-production $V --apply "${ZM[@]}"
STUB_HOSTNAME=other.copilt.org t_rc "stage host with another name is refused" 3 S "${ZM[@]}"
t_eq "...no rsync happened" "$(grep -c '^rsync' "$CALLS" || true)" "0"
: > "$CALLS"; t_ok "--check-only reads the identity and uploads nothing" S --check-only "${ZM[@]}"
t_eq "...one ssh call, no rsync" "$(grep -c '^ssh' "$CALLS")/$(grep -c '^rsync' "$CALLS" || true)" "1/0"

echo "== the signed update channel (the owner's offline .manifest.sig is required; production never publishes an unsigned or unverifiable release) =="
NS="$TMP/nosig"; mkdir -p "$NS"; cp "$ZIP" "$MAN" "$SHAF" "$NS/"       # the same release WITHOUT its signature file
ZN0=(--zip "$NS/$ZN" --manifest "$NS/ai-commerce-copilot-$V.manifest.json" --sha256-file "$NS/$ZN.sha256")
: > "$CALLS"
t_rc "staging: a release with NO signature is REFUSED unless --allow-unsigned is given explicitly" 3 S "${ZN0[@]}"
t_rc "production: an unsigned release is REFUSED (dry run)" 3 P --confirm-production $V "${ZN0[@]}"
t_rc "production: an unsigned release is REFUSED (--apply)" 3 P --confirm-production $V --apply "${ZN0[@]}"
t_rc "production: --allow-unsigned is REFUSED even with --apply" 3 P --confirm-production $V --apply --allow-unsigned "${ZN0[@]}"
t_rc "production: --allow-unsigned is REFUSED even when a signature exists" 3 P --confirm-production $V --apply --allow-unsigned "${ZM[@]}"
t_rc "--allow-unsigned together with --signature is ambiguous: REFUSED" 3 S --allow-unsigned --signature "$SIG" "${ZM[@]}"
mkdir -p "$TMP/badsig"
cp "$SIG" "$TMP/badsig/ai-commerce-copilot-9.9.9.manifest.sig"
t_rc "a signature file named for ANOTHER version is REFUSED" 3 S --signature "$TMP/badsig/ai-commerce-copilot-9.9.9.manifest.sig" "${ZM[@]}"
cp "$SIG" "$TMP/badsig/anything.sig"
t_rc "a signature file with a non-standard name is REFUSED" 3 S --signature "$TMP/badsig/anything.sig" "${ZM[@]}"
t_rc "a missing --signature file is REFUSED" 3 S --signature "$TMP/badsig/$SIGN" "${ZM[@]}"
printf 'not json' > "$TMP/badsig/$SIGN"; t_rc "a signature that is not JSON is REFUSED" 3 S --signature "$TMP/badsig/$SIGN" "${ZM[@]}"
jq '.alg = "rsa"' "$SIG" > "$TMP/badsig/$SIGN"; t_rc "a signature with another algorithm is REFUSED" 3 S --signature "$TMP/badsig/$SIGN" "${ZM[@]}"
jq '.signature = "!!!not-base64!!!"' "$SIG" > "$TMP/badsig/$SIGN"; t_rc "a signature that is not base64 is REFUSED" 3 S --signature "$TMP/badsig/$SIGN" "${ZM[@]}"
jq '.signature = "QUJD"' "$SIG" > "$TMP/badsig/$SIGN"; t_rc "a signature of the wrong length (not 64 bytes) is REFUSED" 3 S --signature "$TMP/badsig/$SIGN" "${ZM[@]}"
jq 'del(.issued_at)' "$SIG" > "$TMP/badsig/$SIGN"; t_rc "a signature without a signing time is REFUSED" 3 S --signature "$TMP/badsig/$SIGN" "${ZM[@]}"
ln -s "$SIG" "$TMP/badsig/link.manifest.sig"; t_rc "a symbolic link as the signature is REFUSED" 3 S --signature "$TMP/badsig/link.manifest.sig" "${ZM[@]}"
t_eq "none of these refusals made an ssh or rsync call" "$(wc -l < "$CALLS" | tr -d ' ')" "0"
if [ "$HAVE_SIGN" = 1 ]; then
  echo "-- full verification with the Plugin's own tool (php bin/sign-release.php verify) and the public key from release/endpoints.conf --"
  t_ok "staging: a genuine signature verifies against the key list of the Plugin build dir (--plugin-dir)" S --dry-run --plugin-dir "$PDIR" "${ZM[@]}"
  t_contains "...the plan says it was verified" "$(S --dry-run --plugin-dir "$PDIR" "${ZM[@]}" 2>&1)" "signature verified locally"
  t_ok "production: a genuine signature verifies (dry run)" P --confirm-production $V --plugin-dir "$PDIR" "${ZM[@]}"
  t_rc "production: WITHOUT any public key to verify against the release is REFUSED (cannot verify)" 3 P --confirm-production $V "${ZM[@]}"
  t_ok "production: --pubkeys <key> (with the Plugin tool) overrides the list in endpoints.conf" PV --confirm-production $V --pubkeys "$PUBKEY" "${ZM[@]}"
  t_rc "production: --pubkeys WITHOUT the Plugin tool cannot verify: REFUSED" 3 P --confirm-production $V --pubkeys "$PUBKEY" "${ZM[@]}"
  python3 - "$SIG" "$TMP/badsig/$SIGN" <<'PY'
import base64, json, sys
d = json.load(open(sys.argv[1])); raw = bytearray(base64.b64decode(d["signature"])); raw[0] ^= 1; d["signature"] = base64.b64encode(bytes(raw)).decode()
json.dump(d, open(sys.argv[2], "w"))
PY
  t_rc "a signature with one flipped bit is REFUSED by the real verifier" 3 S --plugin-dir "$PDIR" --signature "$TMP/badsig/$SIGN" "${ZM[@]}"
  t_rc "...also in production" 3 P --confirm-production $V --apply --plugin-dir "$PDIR" --signature "$TMP/badsig/$SIGN" "${ZM[@]}"
  jq '.issued_at = "2026-01-01T00:00:00Z"' "$SIG" > "$TMP/badsig/$SIGN"; t_rc "a signature whose signing time was edited is REFUSED" 3 S --plugin-dir "$PDIR" --signature "$TMP/badsig/$SIGN" "${ZM[@]}"
  # another key than the one the build trusts
  OKEY="$TMP/keys/other.key"; OPUB="$(php "$PDIR/bin/sign-release.php" keygen --secret-out "$OKEY" 2>/dev/null | sed -n 's/^public key.*: //p')"
  t_rc "a pubkey list that does NOT contain the signing key refuses the release" 3 PV --confirm-production $V --pubkeys "$OPUB" "${ZM[@]}"
  python3 - "$TMP" "$OPUB" "$V" <<'PY'
import hashlib, json, os, sys, zipfile
t, pk, v = sys.argv[1:4]
d = os.path.join(t, "foreign"); os.makedirs(d, exist_ok=True)
zp = os.path.join(d, "ai-commerce-copilot-%s.zip" % v)
with zipfile.ZipFile(zp, "w") as z:
    z.writestr("ai-commerce-copilot/ai-commerce-copilot.php", "<?php\n")
    z.writestr("ai-commerce-copilot/includes/aicc-release-defaults.php", "<?php\nclass AICC_Release_Keys { const PUBLIC_KEYS = '%s'; }\n" % pk)
data = open(zp, "rb").read(); h = hashlib.sha256(data).hexdigest()
m = json.load(open(os.path.join(t, "dist", "ai-commerce-copilot-%s.manifest.json" % v))); m["sha256"] = h; m["size"] = len(data)
json.dump(m, open(zp[:-4] + ".manifest.json", "w")); open(zp + ".sha256", "w").write("%s  %s\n" % (h, os.path.basename(zp)))
PY
  # the owner's key signs a manifest whose ZIP carries ANOTHER key (the sign tool would refuse; done by hand with the same signed text) -> the shipped build could not verify its own update
  AICC_FKEY="$KEYF" AICC_FMAN="$TMP/foreign/ai-commerce-copilot-$V.manifest.json" AICC_FOUT="$TMP/foreign/$SIGN" AICC_FLIB="$PDIR/includes/class-aicc-release-signature.php" php -r '
    define( "ABSPATH", "/" ); require getenv( "AICC_FLIB" );
    $m = json_decode( file_get_contents( getenv( "AICC_FMAN" ) ), true ); $at = "2026-10-23T10:00:00Z";
    $msg = AICC_Release_Signature::message( array( "slug" => $m["slug"], "version" => $m["version"], "sha256" => $m["sha256"], "size" => $m["size"], "requires_wp" => $m["requires_wp"], "requires_php" => $m["requires_php"], "requires_wc" => $m["requires_wc"], "issued_at" => $at ) );
    $sk = base64_decode( trim( file_get_contents( getenv( "AICC_FKEY" ) ) ) ); $pk = sodium_crypto_sign_publickey_from_secretkey( $sk );
    file_put_contents( getenv( "AICC_FOUT" ), json_encode( array( "schema" => 1, "alg" => "ed25519", "key_id" => AICC_Release_Signature::fingerprint( $pk ), "issued_at" => $at, "signature" => base64_encode( sodium_crypto_sign_detached( $msg, $sk ) ) ) ) );'
  FZ=(--zip "$TMP/foreign/$ZN" --manifest "$TMP/foreign/ai-commerce-copilot-$V.manifest.json" --sha256-file "$TMP/foreign/$ZN.sha256")
  t_ok "control: that hand-made signature verifies against the owner's key (the fixture is sound)" php "$PDIR/bin/sign-release.php" verify --manifest "$TMP/foreign/ai-commerce-copilot-$V.manifest.json" --sig "$TMP/foreign/$SIGN" --pubkeys "$PUBKEY"
  t_rc "a genuinely signed manifest whose ZIP bakes ONLY another key is REFUSED in production (the build could not verify its own update)" 3 PV --confirm-production $V "${FZ[@]}"
else
  t_skip "full signature verification (needs php with sodium and the Plugin worktree at $PLUG_SRC)" "not available here"
fi
echo "-- staging with an explicit --allow-unsigned, and the signed upload --"
: > "$CALLS"
t_ok "staging: --allow-unsigned publishes an unsigned release" S --allow-unsigned "${ZN0[@]}"
C="$(cat "$CALLS")"
t_not_contains "...the installer gets NO --signature" "$C" "--signature"
t_not_contains "...no signature file is uploaded" "$(grep '^rsync' "$CALLS")" ".sig"
t_contains "...a loud warning is printed" "$(S --allow-unsigned --dry-run "${ZN0[@]}" 2>&1)" "WITHOUT a signature"
: > "$CALLS"
t_ok "staging: a signed release publishes (signature auto-detected next to the manifest)" S "${ZM[@]}"
C="$(cat "$CALLS")"
t_contains "the signature is rsynced next to the ZIP and the manifest" "$(grep '^rsync' "$CALLS")" "plugin-incoming/$V/$SIGN"
t_contains "the host installer is called with --signature pointing at the uploaded file" "$C" "--signature ~aicc/plugin-incoming/$V/$SIGN"
t_contains "...together with --expect-sha256 as before" "$C" "--expect-sha256 $SHA"
t_eq "the signature is uploaded BEFORE the installer runs" "$(grep -n "rsync.*$SIGN\|sudo bash" "$CALLS" | cut -d: -f1 | tr '\n' ' ' | awk '{print ($1<$2) ? "ordered" : "NOT ordered"}')" "ordered"
: > "$CALLS"
t_ok "an explicit --signature elsewhere works too (name still has to match)" S --signature "$SIG" --zip "$NS/$ZN" --manifest "$NS/ai-commerce-copilot-$V.manifest.json" --sha256-file "$NS/$ZN.sha256"
t_contains "...and is uploaded under the standard name" "$(grep '^rsync' "$CALLS")" "plugin-incoming/$V/$SIGN"
t_contains "the dry-run plan lists the signature" "$(S --dry-run "${ZM[@]}" 2>&1)" "$SIGN"
t_rc "--point-at with --signature is REFUSED (the installer re-verifies the installed signature itself)" 3 S --point-at 1.1.0 --signature "$SIG"
t_rc "--point-at with --allow-unsigned is REFUSED" 3 S --point-at 1.1.0 --allow-unsigned

echo "== the trust anchor handed to the host installer (production 8) =="
: > "$CALLS"
t_contains "a signed publish passes the owner's public key list to the host installer (--pubkeys), not left to the ZIP" "$(S --dry-run "${ZM[@]}" 2>&1)" "--pubkeys $WKEY"
if [ "$HAVE_SIGN" = 1 ]; then
  t_contains "...with --plugin-dir the list comes from the build dir's release/endpoints.conf" "$(S --dry-run --plugin-dir "$PDIR" "${ZM[@]}" 2>&1)" "--pubkeys $PUBKEY"
fi
NOKEY=1 t_rc "a signed publish with NO key list anywhere is REFUSED before any network access (staging too)" 3 S --dry-run "${ZM[@]}"
NOKEY=1 t_contains "...and says why" "$(NOKEY=1 S --dry-run "${ZM[@]}" 2>&1)" "no trusted public key list"
NOKEY=1 t_rc "production: a signed publish with no key list is REFUSED" 3 P --confirm-production $V "${ZM[@]}"
NOKEY=1 t_rc "production: --point-at with no key list is REFUSED (the installer re-verifies the installed signature against it)" 3 P --point-at 1.1.0 --confirm-production 1.1.0
t_contains "production: --point-at passes the key list to the installer" "$(P --point-at 1.1.0 --confirm-production 1.1.0 2>&1)" "--pubkeys $WKEY"
t_rc "a malformed key list (three keys) is REFUSED" 3 S --dry-run --pubkeys "$WKEY,$WKEY,$WKEY" "${ZM[@]}"
t_rc "a malformed key list (not base64) is REFUSED" 3 S --dry-run --pubkeys "not-a-key" "${ZM[@]}"
t_not_contains "an --allow-unsigned staging publish passes no key list (nothing to verify)" "$(S --allow-unsigned --dry-run "${ZN0[@]}" 2>&1)" "--pubkeys"

echo "== stage publish (stubs) =="
: > "$CALLS"
t_ok "publish without --set-current succeeds" S "${ZM[@]}"
C="$(cat "$CALLS")"
t_contains "the ZIP, the manifest and the installer are rsynced to the private incoming directory" "$C" "plugin-incoming/$V/$ZN"
t_contains "the installer's sha256 is re-checked on the host before it runs" "$C" "sha256sum -c"
t_contains "the host-side installer gets --expect-sha256, the release dir and the group" "$C" "--release-dir /srv/aicc/shared/plugin-releases --group aicc-cp --zip"
t_contains "...with the hash from the build machine's second channel" "$C" "--expect-sha256 $SHA"
t_not_contains "...and NO --set-current (staged only)" "$C" "--set-current"
t_not_contains "no WordPress probe when nothing was made current" "$C" "aicc-wp eval"
t_eq "the installer runs only AFTER the identity read and the sha check" "$(grep -n 'cat /etc/aicc-stage-identity\|sha256sum -c\|sudo bash' "$CALLS" | cut -d: -f1 | tr '\n' ' ' | awk '{print ($1<$2 && $2<$3) ? "ordered" : "NOT ordered"}')" "ordered"
t_contains "the incoming directory is removed at the end" "$(tail -1 "$CALLS")" "rm -rf ~/plugin-incoming/$V"
t_eq "every ssh call used the key with IdentitiesOnly and BatchMode" "$(grep '^ssh' "$CALLS" | grep -vc -e "-i $KEY -o IdentitiesOnly=yes -o BatchMode=yes" || true)" "0"
: > "$CALLS"
STUB_CURRENT=$V t_ok "publish with --set-current verifies the pointer and asks WordPress" S --set-current "${ZM[@]}"
t_contains "...--set-current is passed to the installer" "$(cat "$CALLS")" "--set-current"
t_contains "...the store is read back through WordPress" "$(cat "$CALLS")" "AICC_LM_Release_Store::configuration_problem()"
STUB_CURRENT=1.1.0 t_rc "a pointer that does not read back as the new version fails (1)" 1 S --set-current "${ZM[@]}"
STUB_CURRENT=$V STUB_PROBLEM="release failed its integrity check" t_rc "a WordPress-reported store problem fails (1)" 1 S --set-current "${ZM[@]}"
STUB_INSTALL_RC=1 t_rc "an installer refusal fails (1) and still cleans up" 1 S "${ZM[@]}"
t_contains "...cleanup ran" "$(tail -1 "$CALLS")" "rm -rf ~/plugin-incoming/$V"
: > "$CALLS"
STUB_SHA_RC=1 t_rc "an installer whose hash differs on the host is NOT executed (3)" 3 S "${ZM[@]}"
t_eq "...no 'sudo bash' call was made" "$(grep -c 'sudo bash' "$CALLS" || true)" "0"

echo "== roll back / forward (--point-at) =="
: > "$CALLS"
STUB_CURRENT=1.1.0 t_ok "stage --point-at 1.1.0" S --point-at 1.1.0
t_contains "the installer is called with --point-at and no ZIP" "$(cat "$CALLS")" "--point-at 1.1.0"
t_not_contains "...nothing but the installer is uploaded (no ZIP, no manifest)" "$(grep '^rsync' "$CALLS")" ".zip"
t_not_contains "...no --expect-sha256 for a pointer move (the installer re-verifies the installed files)" "$(cat "$CALLS")" "--expect-sha256"

echo "== production publish (stubs) =="
: > "$CALLS"
STUB_ENV=production STUB_HOSTNAME=www.copilt.org STUB_CURRENT=$V t_ok "production --apply with the confirmation succeeds" PV --confirm-production $V --apply --set-current "${ZM[@]}"
t_eq "every production ssh call pins the host key (StrictHostKeyChecking=yes + the pinned file)" "$(grep '^ssh' "$CALLS" | grep -c "StrictHostKeyChecking=yes -o UserKnownHostsFile=$KH")/$(grep -c '^ssh' "$CALLS")" "$(grep -c '^ssh' "$CALLS")/$(grep -c '^ssh' "$CALLS")"
: > "$CALLS"
STUB_ENV=production STUB_HOSTNAME=www.copilt.org STUB_CURRENT=1.1.0 t_ok "production rollback: --point-at 1.1.0 --confirm-production 1.1.0 --apply" P --point-at 1.1.0 --confirm-production 1.1.0 --apply
t_contains "...pointer move only" "$(cat "$CALLS")" "--point-at 1.1.0"
echo "== compatibility with the REAL host-side installer of the Control Plane (the launch-secfix worktree is the contract; run locally against a temp release dir; skipped when absent) =="
CPI="${AICC_CP_INSTALLER:-/Users/avivgerman/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/release-1.1.0-prep-docs/scripts/plugin-release/install-plugin-release.sh}"
if [ -f "$CPI" ]; then
  # production 8: only an installer that takes its trust anchor from the operator (--pubkeys-file) is the contract; an older one would make the checks below pass or fail for the wrong reason
  t_ok "the Control Plane installer at $CPI takes its trust anchor from the operator (--pubkeys-file); an older one makes the checks below meaningless: set AICC_CP_INSTALLER to the release-preparation worktree's scripts/plugin-release/install-plugin-release.sh" grep -q -e '--pubkeys-file)' "$CPI"
  RD="$TMP/store"; mkdir -p "$RD"; chmod 750 "$RD"; GRP="$(id -gn)"
  t_ok "the publisher's installer-header check accepts the real script" env PATH="$STUB:$PATH" bash "$PUB" --installer "$CPI" --stage-id "$SID" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --key "$KEY" --dry-run --pubkeys "$WKEY" "${ZM[@]}"
  if grep -q -e '--signature)' "$CPI"; then
    if [ "$HAVE_SIGN" = 1 ]; then
      # the exact argument list the publisher sends for a signed release (see the stub run above), against the real installer
      SENT="$(env PATH="$STUB:$PATH" bash "$PUB" --installer "$CPI" --stage-id "$SID" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --key "$KEY" --dry-run --set-current --plugin-dir "$PDIR" "${ZM[@]}" | sed -n 's|.*install-plugin-release.sh \(--release-dir.*\)$|\1|p')"
      t_contains "the publisher's plan passes --signature" "$SENT" "--signature ~aicc/plugin-incoming/$V/$SIGN"
      t_contains "the publisher's plan passes the owner's key list" "$SENT" "--pubkeys $PUBKEY"
      mkdir -p "$TMP/inc"; cp "$ZIP" "$TMP/inc/$ZN"; cp "$MAN" "$TMP/inc/manifest.json"; cp "$SIG" "$TMP/inc/$SIGN"
      ARGS="$(printf '%s' "$SENT" | sed -e "s|--release-dir [^ ]*|--release-dir $RD|" -e "s|--group [^ ]*|--group $GRP|" -e "s|~aicc/plugin-incoming/$V|$TMP/inc|g")"
      ARGV=(); read -r -a ARGV <<< "$ARGS"
      t_ok "the REAL installer accepts exactly those arguments, verifies the signature and installs the release as current" bash "$CPI" "${ARGV[@]}"
      t_eq "...current points at the version" "$(tr -d ' \n' < "$RD/current")" "$V"
      t_eq "...the signature is stored next to the manifest" "$(cmp -s "$SIG" "$RD/$V/$SIGN" && echo same || echo different)" "same"
      t_ok "...re-running with the same bytes and signature is a no-op" bash "$CPI" "${ARGV[@]}"
      t_ok "...the arguments of a rollback (--point-at) re-verify the installed signature against the owner's list" bash "$CPI" --release-dir "$RD" --group "$GRP" --point-at "$V" --pubkeys "$PUBKEY"
      t_fail "...a rollback with NO key list is refused by the real installer (it will not fall back to the ZIP's own keys)" bash "$CPI" --release-dir "$RD" --group "$GRP" --point-at "$V"
      # a tampered signature that PASSES every local sanity check is still refused by the host (second line of defence)
      python3 - "$SIG" "$TMP/inc/tampered.sig" <<'PY'
import base64, json, sys
d = json.load(open(sys.argv[1])); raw = bytearray(base64.b64decode(d["signature"])); raw[5] ^= 1; d["signature"] = base64.b64encode(bytes(raw)).decode()
json.dump(d, open(sys.argv[2], "w"))
PY
      RD2="$TMP/store2"; mkdir -p "$RD2"; chmod 750 "$RD2"
      t_fail "the REAL installer refuses a tampered signature and installs nothing" bash "$CPI" --release-dir "$RD2" --group "$GRP" --zip "$ZIP" --manifest "$MAN" --expect-sha256 "$SHA" --signature "$TMP/inc/tampered.sig" --pubkeys "$PUBKEY" --set-current
      t_eq "...the store stayed empty" "$(find "$RD2" -mindepth 1 -maxdepth 1 ! -name '.*' | wc -l | tr -d ' ')" "0"
      t_fail "the REAL installer refuses a genuine signature when no key list is given (the ZIP is not its own trust anchor)" bash "$CPI" --release-dir "$RD2" --group "$GRP" --zip "$ZIP" --manifest "$MAN" --expect-sha256 "$SHA" --signature "$SIG"
      t_ok "control: an UNSIGNED install still works on the host (what --allow-unsigned staging does) and is flagged" bash "$CPI" --release-dir "$RD2" --group "$GRP" --zip "$ZIP" --manifest "$MAN" --expect-sha256 "$SHA"
    else t_skip "real installer with --signature" "needs php with sodium and the Plugin worktree (signing tool) to make a genuine signature"; fi
  else
    t_ok "the exact arguments the publisher sends install a release (--zip --manifest --release-dir --group --expect-sha256 --set-current)" bash "$CPI" --release-dir "$RD" --group "$GRP" --zip "$ZIP" --manifest "$MAN" --expect-sha256 "$SHA" --set-current
    t_skip "real installer with --signature" "this installer predates --signature (not the launch-secfix contract)"
  fi
  RD3="$TMP/store3"; mkdir -p "$RD3"; chmod 750 "$RD3"
  t_fail "...a wrong --expect-sha256 (swapped ZIP+manifest pair) is refused by the real installer" bash "$CPI" --release-dir "$RD3" --group "$GRP" --zip "$ZIP" --manifest "$MAN" --expect-sha256 "$(printf 'e%.0s' $(seq 64))"
else t_skip "real installer compatibility" "no Control Plane launch-secfix worktree at $CPI"; fi

t_summary
