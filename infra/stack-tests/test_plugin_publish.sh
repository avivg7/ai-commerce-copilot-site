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
# a built release in the shape bin/build-release.sh produces
B="$TMP/dist"; mkdir -p "$B"
python3 - "$B" "$V" <<'PY'
import hashlib, json, sys, zipfile, os
d, v = sys.argv[1:3]
zp = os.path.join(d, "ai-commerce-copilot-%s.zip" % v)
with zipfile.ZipFile(zp, "w") as z:
    z.writestr("ai-commerce-copilot/ai-commerce-copilot.php", "<?php\n/*\n * Plugin Name: AI Commerce Copilot\n * Version: %s\n */\n" % v)
data = open(zp, "rb").read(); h = hashlib.sha256(data).hexdigest()
m = {"slug": "ai-commerce-copilot", "version": v, "filename": os.path.basename(zp), "sha256": h, "size": len(data), "requires_wp": "6.0", "requires_php": "7.4", "requires_wc": "7.0",
     "dirty": False, "built_from_commit": "a" * 40, "changelog": "x"}
json.dump(m, open(zp[:-4] + ".manifest.json", "w"))
open(zp + ".sha256", "w").write("%s  %s\n" % (h, os.path.basename(zp)))
PY
ZIP="$B/$ZN"; MAN="$B/ai-commerce-copilot-$V.manifest.json"; SHAF="$ZIP.sha256"; SHA="$(cut -d' ' -f1 "$SHAF")"
INST="$TMP/install-plugin-release.sh"; printf '#!/usr/bin/env bash\n# Install one AICC Plugin release into the Control Plane'"'"'s PRIVATE release store (docs/plugin-delivery.md).\necho fake\n' > "$INST"
PUBL() { env PATH="$STUB:$PATH" bash "$PUB" --installer "$INST" --stage-id "$SID" "$@"; }
S() { PUBL --stage-host stage.copilt.org --stage-ip 203.0.113.9 --key "$KEY" "$@"; }
P() { PUBL --env production --stage-host www.copilt.org --stage-ip 203.0.113.9 --key "$PKEY" --known-hosts "$KH" "$@"; }
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
t_rc "production: no --confirm-production is REFUSED" 3 P --apply "${ZM[@]}"
t_rc "production: a confirmation for another version is REFUSED" 3 P --confirm-production 9.9.9 --apply "${ZM[@]}"
t_rc "production: --point-at needs its own confirmation" 3 P --point-at 1.1.0 --confirm-production $V --apply
t_eq "none of the refusals made an ssh or rsync call" "$(wc -l < "$CALLS" | tr -d ' ')" "0"

echo "== dry runs send nothing =="
t_ok "stage --dry-run prints the plan" S --dry-run "${ZM[@]}"
t_contains "...the plan names the installer hash, the --expect-sha256 and the store" "$(S --dry-run --set-current "${ZM[@]}")" "--expect-sha256 $SHA --set-current"
t_ok "production WITHOUT --apply is a dry run (exit 0)" P --confirm-production $V "${ZM[@]}"
t_contains "...and says how to run it" "$(P --confirm-production $V "${ZM[@]}")" "add --apply to run it"
t_eq "...zero calls so far" "$(wc -l < "$CALLS" | tr -d ' ')" "0"

echo "== identity gates (read-only ssh, nothing uploaded) =="
STUB_ENV=production STUB_HOSTNAME=www.copilt.org t_rc "stage command against a host that says PRODUCTION is refused" 3 S "${ZM[@]}"
STUB_ENV=staging t_rc "production command against a host that says STAGING is refused" 3 P --confirm-production $V --apply "${ZM[@]}"
STUB_ENV=production STUB_HOSTNAME=www.copilt.org STUB_ID=ffffffffffffffffffffffffffffffff t_rc "production host with another id is refused" 3 P --confirm-production $V --apply "${ZM[@]}"
STUB_HOSTNAME=other.copilt.org t_rc "stage host with another name is refused" 3 S "${ZM[@]}"
t_eq "...no rsync happened" "$(grep -c '^rsync' "$CALLS" || true)" "0"
: > "$CALLS"; t_ok "--check-only reads the identity and uploads nothing" S --check-only "${ZM[@]}"
t_eq "...one ssh call, no rsync" "$(grep -c '^ssh' "$CALLS")/$(grep -c '^rsync' "$CALLS" || true)" "1/0"

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
STUB_ENV=production STUB_HOSTNAME=www.copilt.org STUB_CURRENT=$V t_ok "production --apply with the confirmation succeeds" P --confirm-production $V --apply --set-current "${ZM[@]}"
t_eq "every production ssh call pins the host key (StrictHostKeyChecking=yes + the pinned file)" "$(grep '^ssh' "$CALLS" | grep -c "StrictHostKeyChecking=yes -o UserKnownHostsFile=$KH")/$(grep -c '^ssh' "$CALLS")" "$(grep -c '^ssh' "$CALLS")/$(grep -c '^ssh' "$CALLS")"
: > "$CALLS"
STUB_ENV=production STUB_HOSTNAME=www.copilt.org STUB_CURRENT=1.1.0 t_ok "production rollback: --point-at 1.1.0 --confirm-production 1.1.0 --apply" P --point-at 1.1.0 --confirm-production 1.1.0 --apply
t_contains "...pointer move only" "$(cat "$CALLS")" "--point-at 1.1.0"
echo "== compatibility with the REAL host-side installer of the Control Plane (run locally against a temp release dir; skipped when that worktree is absent) =="
CPI="${AICC_CP_INSTALLER:-/Users/avivgerman/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/launch-dist/scripts/plugin-release/install-plugin-release.sh}"
if [ -f "$CPI" ]; then
  RD="$TMP/store"; mkdir -p "$RD"; chmod 750 "$RD"; GRP="$(id -gn)"
  t_ok "the publisher's installer-header check accepts the real script" env PATH="$STUB:$PATH" bash "$PUB" --installer "$CPI" --stage-id "$SID" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --key "$KEY" --dry-run "${ZM[@]}"
  t_ok "the exact arguments the publisher sends install a release (--zip --manifest --release-dir --group --expect-sha256 --set-current)" bash "$CPI" --release-dir "$RD" --group "$GRP" --zip "$ZIP" --manifest "$MAN" --expect-sha256 "$SHA" --set-current
  t_eq "...current points at the version" "$(cat "$RD/current" | tr -d ' \n')" "$V"
  t_ok "...re-running with the same bytes is a no-op (immutable releases)" bash "$CPI" --release-dir "$RD" --group "$GRP" --zip "$ZIP" --manifest "$MAN" --expect-sha256 "$SHA"
  t_fail "...a wrong --expect-sha256 (swapped ZIP+manifest pair) is refused by the real installer" bash "$CPI" --release-dir "$RD" --group "$GRP" --zip "$ZIP" --manifest "$MAN" --expect-sha256 "$(printf 'e%.0s' $(seq 64))"
  t_ok "the arguments of a rollback (--point-at) are accepted" bash "$CPI" --release-dir "$RD" --group "$GRP" --point-at "$V"
else t_skip "real installer compatibility" "no Control Plane launch-dist worktree at $CPI"; fi

t_summary
