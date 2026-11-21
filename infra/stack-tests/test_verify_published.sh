#!/usr/bin/env bash
# Tests of the P41 release tools: infra/release/sign-plugin-release.sh (offline signing wrapper) and infra/release/verify-published-plugin.sh (+ lib/verify_published.py, lib/updater_offer_check.php).
# EVERYTHING here is local: THROWAWAY Ed25519 keys generated in a temp dir (a real key is never read or created), a build of the Plugin's 1.1.1 candidate commit that bakes the throwaway PUBLIC key, and a
# MOCK Control Plane on a loopback port that misbehaves in exactly one way per negative control. No ssh, no production host, no WordPress, no database. The REAL Control Plane fixture is test_verify_published_fixture.sh.
#   S  signing wrapper:   positive, then every refusal (wrong key, standby key, wrong commit, dirty tree, tampered ZIP, wrong SHA-256 / version / fingerprint, key file mode, existing signature, the real candidate ZIP)
#   A  release record:    offline checks (positive + tampered ZIP, tampered manifest, attacker signature, edited key_id hint, wrong version, no-downgrade rule, ...)
#   B  customer path vs a mock CP: positive, and one server fault per negative control (tampered / truncated ZIP, wrong panel data, leaks to a signed-out caller, non-uniform updater refusal, accepted wrong
#      origin / tenant, downgrade offer, foreign offer signature, ...): the tool must FAIL with the right check id
#   G  safety guards:     production mode refuses any other host, credentials files with loose permissions, a password never appears in output or report
# Needs: bash, python3, php with sodium+zip, git, jq. The Plugin repo: AICC_PLUGIN_DIR (default ~/self_projects/aicc-plugin-p41) at AICC_PLUGIN_COMMIT (default abdcda2 = the 1.1.1 candidate); the suite skips itself if absent.
# Run: bash infra/stack-tests/test_verify_published.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; REL="$REPO/infra/release"
T_SUITE="verify-published"; . "$HERE/lib/t.sh"
for tool in php python3 git jq; do command -v "$tool" >/dev/null 2>&1 || { echo "need $tool"; exit 2; }; done
PLUG_SRC="${AICC_PLUGIN_DIR:-$HOME/self_projects/aicc-plugin-p41}"; PLUG_COMMIT="${AICC_PLUGIN_COMMIT:-abdcda2}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/avp.XXXX")"; MOCKPID=""; trap '[ -z "$MOCKPID" ] || kill "$MOCKPID" 2>/dev/null; rm -rf "$TMP"' EXIT
. "$HERE/lib/tw_release.sh"
if ! tw_release_build > "$TMP/build.log" 2>&1; then t_skip "the whole suite" "$(tail -1 "$TMP/build.log")"; t_summary; exit 0; fi
if [ "$PLUG_COMMIT" = abdcda2 ]; then t_eq "the REAL 1.1.1 candidate rebuilds reproducibly from abdcda2 (ZIP sha256 9757ab35...)" "$RSHA" "9757ab35bc89f14a72a366c6e1ce8fdb9274722f84b2dfff232e4a268447aee2"; fi
fo() { printf '%s/o%s%s' "$TMP" "$RANDOM" "$RANDOM"; }       # a fresh --out path every call (the tool refuses a non-empty --out)
nfiles() { find "$1" -mindepth 1 -maxdepth 1 -name "$2" 2>/dev/null | wc -l | tr -d ' '; }
SIGN() { env AICC_RELEASE_SIGNING_KEY_FILE="${KF:-$KEYS/primary.key}" bash "$REL/sign-plugin-release.sh" "$@"; }
SIGNK() { local KF="$1"; shift; SIGN "$@"; }       # SIGNK <key file> <args...>
S_ARGS=(--plugin-dir "$PD" --zip "$ZIP" --manifest "$MAN" --version "$V" --sha256 "$SHA" --commit "${COMMIT:0:12}" --primary-fp "$FP")

echo "== S. the owner's signing wrapper (throwaway keys; the REAL ZIP can never be signed with them) =="
t_rc "refuses without AICC_RELEASE_SIGNING_KEY_FILE (rc 3, nothing written)" 3 env -u AICC_RELEASE_SIGNING_KEY_FILE bash "$REL/sign-plugin-release.sh" "${S_ARGS[@]}"
t_eq "...no signature written" "$(nfiles "$TMP/tw" '*.sig')" "0"
cp "$KEYS/primary.key" "$KEYS/loose.key"; chmod 644 "$KEYS/loose.key"
t_rc "refuses a key file readable by group/other (rc 3)" 3 SIGNK "$KEYS/loose.key" "${S_ARGS[@]}"
ln -s "$KEYS/primary.key" "$KEYS/link.key"
t_rc "refuses a symlinked key file (rc 3)" 3 SIGNK "$KEYS/link.key" "${S_ARGS[@]}"
t_rc "refuses a wrong commit (rc 3)" 3 SIGN "${S_ARGS[@]:0:8}" --commit 0123456 --primary-fp "$FP" --sha256 "$SHA"
t_rc "refuses a wrong SHA-256 from the coordinator (second channel) (rc 3)" 3 SIGN --plugin-dir "$PD" --zip "$ZIP" --manifest "$MAN" --version "$V" --sha256 "$(printf 'a%.0s' $(seq 64))" --commit "${COMMIT:0:12}" --primary-fp "$FP"
t_rc "refuses a wrong version (the manifest is for another one) (rc 3)" 3 SIGN --plugin-dir "$PD" --zip "$ZIP" --manifest "$MAN" --version 9.9.9 --sha256 "$SHA" --commit "${COMMIT:0:12}" --primary-fp "$FP"
t_rc "refuses a pre-release version (rc 3)" 3 SIGN --plugin-dir "$PD" --zip "$ZIP" --manifest "$MAN" --version 1.1.1-dev.1 --sha256 "$SHA" --commit "${COMMIT:0:12}" --primary-fp "$FP"
t_rc "refuses the STANDBY's fingerprint as --primary-fp (rc 3: it is not the first key of the list)" 3 SIGN --plugin-dir "$PD" --zip "$ZIP" --manifest "$MAN" --version "$V" --sha256 "$SHA" --commit "${COMMIT:0:12}" --primary-fp "$FPS"
cp "$ZIP" "$TMP/tampered.zip"; printf X >> "$TMP/tampered.zip"; mkdir -p "$TMP/tam"; cp "$TMP/tampered.zip" "$TMP/tam/$ZN"; cp "$MAN" "$TMP/tam/"
t_rc "refuses a tampered ZIP (rc 3)" 3 SIGN --plugin-dir "$PD" --zip "$TMP/tam/$ZN" --manifest "$TMP/tam/ai-commerce-copilot-$V.manifest.json" --version "$V" --sha256 "$SHA" --commit "${COMMIT:0:12}" --primary-fp "$FP"
echo x >> "$PD/README.md"; t_rc "refuses a dirty Plugin checkout (rc 3)" 3 SIGN "${S_ARGS[@]}"; git -C "$PD" checkout -q README.md
jq '.dirty = true' "$MAN" > "$TMP/tam/ai-commerce-copilot-$V.manifest.json"; t_rc "refuses a manifest that says dirty:true (rc 3)" 3 SIGN --plugin-dir "$PD" --zip "$ZIP" --manifest "$TMP/tam/ai-commerce-copilot-$V.manifest.json" --version "$V" --sha256 "$SHA" --commit "${COMMIT:0:12}" --primary-fp "$FP"
# the REAL candidate (owner keys baked, checkout = its own commit): a throwaway key must not sign it; the Plugin tool itself refuses because the ZIP does not carry that key's public half
mkdir -p "$TMP/realsig"; cp "$RZIP" "$RMAN" "$TMP/realsig/"
RKEYS="$(sed -n 's/^UPDATE_PUBLIC_KEYS=//p' "$TMP/plug-real/release/endpoints.conf" | head -1)"
RFP="$(php -r 'define("ABSPATH","/x/"); require $argv[1]."/includes/class-aicc-release-signature.php"; echo AICC_Release_Signature::fingerprint(base64_decode(explode(",", $argv[2])[0], true));' "$PD" "$RKEYS")"
t_rc "the REAL candidate ZIP cannot be signed with a throwaway key (rc 1: the ZIP bakes the owner's keys, not this key's public half)" 1 SIGN --plugin-dir "$TMP/plug-real" --zip "$TMP/realsig/$ZN" --manifest "$TMP/realsig/ai-commerce-copilot-$V.manifest.json" --version "$V" --sha256 "$RSHA" --commit "${PLUG_COMMIT}" --primary-fp "$RFP"
t_eq "...and no signature was written for it" "$(nfiles "$TMP/realsig" '*sig*')" "0"
t_rc "...even through the Plugin tool itself (rc 1)" 1 env AICC_RELEASE_SIGNING_KEY_FILE="$KEYS/primary.key" php "$PD/bin/sign-release.php" sign --manifest "$TMP/realsig/ai-commerce-copilot-$V.manifest.json" --zip "$TMP/realsig/$ZN"
t_rc "the ATTACKER's key cannot sign the throwaway build either (rc 1: its public half is not baked)" 1 SIGNK "$KEYS/attacker.key" "${S_ARGS[@]}"
t_eq "...and no signature was left behind by any refusal" "$(nfiles "$TMP/tw" '*sig*')" "0"
t_rc "the STANDBY key signs, but the wrapper REMOVES it (rc 1: not the primary)" 1 SIGNK "$KEYS/standby.key" "${S_ARGS[@]}"
t_eq "...nothing left behind" "$(nfiles "$TMP/tw" '*sig*')" "0"
OUTS="$(SIGN "${S_ARGS[@]}" 2>&1)"; src=$?
t_eq "the PRIMARY key signs: rc 0" "$src" "0"
t_contains "...it says SIGNED with the primary fingerprint" "$OUTS" "SIGNED  $V  key $FP"
t_eq "...four verifications ran and the tamper controls were stated" "$(printf '%s\n' "$OUTS" | grep -c '^  verified: ')/$(printf '%s\n' "$OUTS" | grep -c 'tamper control')" "4/1"
t_not_contains "...the secret key is not in the output" "$OUTS" "$(tr -d '\n' < "$KEYS/primary.key")"
t_ok "the signature file exists, named for the version" test -f "$SIG"
t_rc "a second run refuses to overwrite the signature (rc 3)" 3 SIGN "${S_ARGS[@]}"
t_ok "the throwaway build is NOT the real one (different ZIP bytes, only aicc-release-defaults.php differs)" test "$SHA" != "$RSHA"

echo "== A. the release record, offline =="
VPO() { rm -rf "${TMP:?}/out-a"; bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --out "$TMP/out-a" "$@" 2>&1; }
OUTA="$(VPO --local-zip "$ZIP" --previous-version 1.1.0 --expect-key-id "$FP")"; rc=$?
t_eq "positive: every record check passes (rc 0)" "$rc" "0"
t_eq "...11 checks ran (R1 R2 R3 R4a R4b R4c R5 R6a R6b R6c R6d)" "$(printf '%s\n' "$OUTA" | grep -c '^PASS')" "11"
t_ok "...a report was written" test -f "$TMP/out-a/verify-report.json"
exp_fail() { local n="$1" id="$2"; shift 2; local out rc=0; out="$("$@" 2>&1)" || rc=$?; if [ "$rc" = 1 ] && printf '%s' "$out" | grep -q "^FAIL  $id"; then t_pass "$n"; else t_bad "$n" "rc=$rc; $(printf '%s' "$out" | grep '^FAIL' | head -3 | tr '\n' '|')"; fi; }
exp_fail "a TAMPERED local ZIP fails R6a (the --pubkeys form of the Plugin tool would not notice)" R6a VPO --local-zip "$TMP/tampered.zip"
t_ok "...(P44) bin/sign-release.php verify --pubkeys AND --zip now refuses a tampered --zip (the fixed Plugin tool); the --zip-alone form refuses it too" bash -c "! php '$PD/bin/sign-release.php' verify --manifest '$MAN' --sig '$SIG' --pubkeys '$LIST' --zip '$TMP/tampered.zip' >/dev/null 2>&1 && ! php '$PD/bin/sign-release.php' verify --manifest '$MAN' --sig '$SIG' --zip '$TMP/tampered.zip' >/dev/null 2>&1"
exp_fail "a wrong SHA-256 from the second channel fails R1" R1 bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$(printf 'b%.0s' $(seq 64))" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --out "$(fo)"
exp_fail "a wrong --version fails R1" R1 bash "$REL/verify-published-plugin.sh" --mode offline --version 1.1.9 --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --out "$(fo)"
jq '.size = (.size + 1)' "$MAN" > "$TMP/m-size.json"; cp "$SIG" "$TMP/s.sig"
exp_fail "a TAMPERED manifest (size) fails R3 (the signature no longer matches)" R3 bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$SHA" --manifest "$TMP/m-size.json" --sig "$SIG" --plugin-dir "$PD" --out "$(fo)"
mkdir -p "$TMP/att"; php "$REL/../stack-tests/lib/forge_sig.php" "$PD" "$MAN" "$KEYS/attacker.key" "$TMP/att/ai-commerce-copilot-$V.manifest.sig" >/dev/null
exp_fail "a signature by the ATTACKER's key (not on the owner's list) fails R3" R3 bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$TMP/att/ai-commerce-copilot-$V.manifest.sig" --plugin-dir "$PD" --out "$(fo)"
exp_fail "a WRONG key list (the attacker's only) fails R3" R3 bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --pubkeys "$ATT" --out "$(fo)"
php "$REL/../stack-tests/lib/forge_sig.php" "$PD" "$MAN" "$KEYS/primary.key" "$TMP/att/hint.sig" "$FPS" >/dev/null; cp "$TMP/att/hint.sig" "$TMP/att/ai-commerce-copilot-$V.manifest.sig"
exp_fail "an edited key_id HINT (signed by the primary, labelled as the standby) fails R4b: the hint is not trusted" R4b bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$TMP/att/ai-commerce-copilot-$V.manifest.sig" --plugin-dir "$PD" --out "$(fo)"
exp_fail "a signature by the STANDBY when the primary is expected fails R4c" R4c VPO --expect-key-id "$FPS"
exp_fail "re-publishing the same version fails R5 (not strictly newer)" R5 VPO --previous-version "$V"
exp_fail "a DOWNGRADE (previous version newer) fails R5" R5 VPO --previous-version 9.0.0
cp "$SIG" "$TMP/att/wrongname.sig"; exp_fail "a signature file not named for the version fails R2" R2 bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$TMP/att/wrongname.sig" --plugin-dir "$PD" --out "$(fo)"
jq '.dirty = true' "$MAN" > "$TMP/att/ai-commerce-copilot-$V.manifest.json"; exp_fail "a manifest saying dirty:true fails R1" R1 bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$SHA" --manifest "$TMP/att/ai-commerce-copilot-$V.manifest.json" --sig "$SIG" --plugin-dir "$PD" --out "$(fo)"
# the REAL 1.1.1 candidate (owner keys baked) judged against the THROWAWAY list: its baked keys are not on the list
exp_fail "the REAL candidate ZIP against a throwaway key list fails (its baked owner keys are not on the list)" R6d bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$RSHA" --manifest "$RMAN" --sig "$SIG" --plugin-dir "$PD" --local-zip "$RZIP" --out "$(fo)"
t_rc "usage: a non-strict version is refused (rc 2)" 2 bash "$REL/verify-published-plugin.sh" --mode offline --version 1.1.1-dev.2 --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD"
t_rc "usage: a malformed --sha256 is refused (rc 2)" 2 bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 abc --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD"
t_rc "usage: a malformed key list is refused (rc 2)" 2 bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --pubkeys "not-a-key"

echo "== B. the customer path against a MOCK Control Plane (one fault per negative control) =="
printf 'AICC_VERIFY_USER=cust\nAICC_VERIFY_PASS=Pw-%s\n' "ZZtop-1234567890-sentinel" > "$TMP/creds.env"; chmod 600 "$TMP/creds.env"
PWSENT="Pw-ZZtop-1234567890-sentinel"; OPWSENT="Pw-Other-0987654321-sentinel"; printf 'AICC_VERIFY_USER=other\nAICC_VERIFY_PASS=%s\n' "$OPWSENT" > "$TMP/creds-other.env"; chmod 600 "$TMP/creds-other.env"; REF=11111111-2222-4333-8444-555555555555; OREF=aaaaaaaa-2222-4333-8444-555555555555
printf 'AICC_STORE_ACTIVATION_REF=%s\nAICC_STORE_ORIGIN=https://shop-a.example\nAICC_OTHER_ACTIVATION_REF=%s\n' "$REF" "$OREF" > "$TMP/store.env"; chmod 600 "$TMP/store.env"
mock_up() { # fault [zip]
  [ -z "$MOCKPID" ] || { kill "$MOCKPID" 2>/dev/null; wait "$MOCKPID" 2>/dev/null; }
  python3 "$HERE/lib/mock_cp.py" --zip "${2:-$ZIP}" --manifest "$MAN" --sig "$SIG" --user cust --password "$PWSENT" --other-user other --other-password "$OPWSENT" --ref "$REF" --origin https://shop-a.example --other-ref "$OREF" --fault "$1" > "$TMP/mock.out" 2>&1 &
  MOCKPID=$!; disown "$MOCKPID" 2>/dev/null; for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do grep -q '^PORT' "$TMP/mock.out" 2>/dev/null && break; sleep 0.25; done
  MPORT="$(sed -n 's/^PORT //p' "$TMP/mock.out")"
}
VPM() { rm -rf "${TMP:?}/out-b"; bash "$REL/verify-published-plugin.sh" --mode fixture --base-url "http://127.0.0.1:$MPORT" --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --credentials-file "$TMP/creds.env" --other-credentials-file "$TMP/creds-other.env" --store-file "$TMP/store.env" --package-download --out "$TMP/out-b" "$@" 2>&1; }
mock_up none; OUTB="$(VPM --local-zip "$ZIP" --previous-version 1.1.0 --expect-key-id "$FP")"; rc=$?
t_eq "positive: a correct server passes every check (rc 0)" "$rc" "0"
t_eq "...all of R, C, U and D ran (counts)" "$(printf '%s\n' "$OUTB" | grep -c '^PASS')/$(printf '%s\n' "$OUTB" | grep -c '^FAIL')" "48/0"
t_not_contains "...the password never appears in the output" "$OUTB" "$PWSENT"
t_not_contains "...nor the OTHER customer's password" "$OUTB" "$OPWSENT"
t_eq "...nor in the report, the work directory's file names or the downloaded ZIP's name" "$(grep -rl -e "$PWSENT" -e "$OPWSENT" "$TMP/out-b" 2>/dev/null | wc -l | tr -d ' ')" "0"
t_not_contains "...the nonce is never printed" "$OUTB" "_wpnonce=n0nce"
t_eq "...the verified download is kept under its final name, the .part file is gone" "$(find "$TMP/out-b" -maxdepth 1 -name '*.part' | wc -l | tr -d ' ')/$(find "$TMP/out-b" -maxdepth 1 -name "$ZN" | wc -l | tr -d ' ')" "0/1"
t_ok "...and it is byte-identical to the published ZIP" cmp -s "$TMP/out-b/$ZN" "$ZIP"
for spec in "tamper|C4|the server serves bytes that differ from the signed manifest (a swapped ZIP)" "truncate|C4|the server cuts the connection half way through the ZIP" \
            "panel-version|C2|the panel shows another version" "panel-sha|C2|the panel shows another SHA-256" "no-sig-key|C3|the panel shows no signing key" \
            "leak-unauth|U1|a signed-out caller receives the ZIP" "stale-nonce-ok|U3|a stale nonce is accepted" "cross-tenant-ok|U22|ANOTHER customer's nonce link works in this session (cross-tenant download)" "unknown-offer|U5|an unknown proof gets an offer (non-uniform refusal)" \
            "downgrade-offer|U14|a store that already has a newer version is offered the release (downgrade)" "wrong-origin-ok|U15|a WRONG ORIGIN is accepted" "wrong-tenant-ok|U17|ANOTHER TENANT's ref is accepted" \
            "bad-offer-signature|U11|the offer carries a signature that is not the owner's" "package-open|U8|the package route serves any proof"; do
  IFS='|' read -r fault id what <<< "$spec"; mock_up "$fault"; rm -rf "$TMP/out-b"; exp_fail "NEGATIVE CONTROL ($fault): $what -> FAIL $id" "$id" VPM
done
mock_up truncate; rm -rf "$TMP/out-b"; VPM >/dev/null 2>&1
t_eq "a truncated download leaves NOTHING under the final name and no .part file (so nothing can be installed)" "$(find "$TMP/out-b" -maxdepth 1 -name '*zip*' 2>/dev/null | wc -l | tr -d ' ')" "0"
mock_up none; printf 'AICC_VERIFY_USER=cust\nAICC_VERIFY_PASS=wrong-wrong-wrong-wrong\n' > "$TMP/badcreds.env"; chmod 600 "$TMP/badcreds.env"
exp_fail "NEGATIVE CONTROL: wrong password -> FAIL C1" C1 bash "$REL/verify-published-plugin.sh" --mode fixture --base-url "http://127.0.0.1:$MPORT" --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --credentials-file "$TMP/badcreds.env" --out "$(fo)"
exp_fail "NEGATIVE CONTROL: the tool is told a DIFFERENT version than the server publishes -> FAIL" R1 bash "$REL/verify-published-plugin.sh" --mode fixture --base-url "http://127.0.0.1:$MPORT" --version 1.1.9 --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --credentials-file "$TMP/creds.env" --out "$(fo)"
# credentials through NAMED environment variables
t_rc "credentials may come from NAMED environment variables (rc 0)" 0 env AVP_U=cust AVP_P="$PWSENT" bash "$REL/verify-published-plugin.sh" --mode fixture --base-url "http://127.0.0.1:$MPORT" --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --user-env AVP_U --pass-env AVP_P --no-updater-probes --out "$(fo)"
t_rc "...an unset variable is a usage error (rc 2)" 2 env -u AVP_P AVP_U=cust bash "$REL/verify-published-plugin.sh" --mode fixture --base-url "http://127.0.0.1:$MPORT" --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --user-env AVP_U --pass-env AVP_P --out "$(fo)"

echo "== G. guards: production mode talks to one host only; secrets files must be private =="
PROD() { bash "$REL/verify-published-plugin.sh" --mode "$1" --base-url "$2" --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --out "$(fo)" "${@:3}"; }
t_rc "production mode refuses another host (rc 3)" 3 PROD production https://example.com
t_rc "production mode refuses the API host (rc 3)" 3 PROD production https://api.copilt.org
t_rc "production mode refuses plain http (rc 3)" 3 PROD production http://www.copilt.org
t_rc "production mode refuses a loopback address (rc 3)" 3 PROD production http://127.0.0.1:9911
t_rc "production mode refuses a path or userinfo in the base URL (rc 3)" 3 PROD production https://www.copilt.org/my-account/
t_rc "stage mode refuses the production host (rc 3)" 3 PROD stage https://www.copilt.org
t_rc "fixture mode refuses the production host (rc 3)" 3 PROD fixture https://www.copilt.org
t_rc "fixture mode refuses a non-loopback address (rc 3)" 3 PROD fixture http://203.0.113.9
cp "$TMP/creds.env" "$TMP/creds-loose.env"; chmod 644 "$TMP/creds-loose.env"
t_rc "a credentials file readable by others is refused (rc 3)" 3 PROD fixture http://127.0.0.1:9 --credentials-file "$TMP/creds-loose.env"
ln -s "$TMP/creds.env" "$TMP/creds-link.env"; t_rc "a symlinked credentials file is refused (rc 3)" 3 PROD fixture http://127.0.0.1:9 --credentials-file "$TMP/creds-link.env"
t_contains "the tool's own header documents that production changes state only by sign-in, the account download and fabricated-proof POSTs" "$(sed -n 1,40p "$REL/verify-published-plugin.sh")" "STATE CHANGES ON PRODUCTION"
t_eq "no password, user, token or key is a command-line argument anywhere in the tool (no --password/--pass/--token option exists)" "$(grep -c -E '"--(password|pass|token|key|secret)"' "$REL/lib/verify_published.py" || true)" "0"
t_eq "the tool has no hard-coded release version, SHA-256 or commit" "$(grep -c -E '1\.1\.[0-9]|9757ab35|abdcda2' "$REL/lib/verify_published.py" "$REL/verify-published-plugin.sh" "$REL/sign-plugin-release.sh" | awk -F: '{s+=$2} END {print s+0}')" "0"
echo "== O. --out handling (the tool never deletes or re-permissions what the operator points it at) =="
OD="$TMP/preexisting"; mkdir -p "$OD"; echo keep > "$OD/keep.txt"; printf 'DO-NOT-DELETE' > "$OD/ai-commerce-copilot-$V.zip"; chmod 755 "$OD"
t_rc "a NON-EMPTY --out is refused (rc 2)" 2 bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --out "$OD"
t_eq "...nothing in it was deleted, replaced or re-permissioned" "$(cat "$OD/keep.txt")/$(cat "$OD/ai-commerce-copilot-$V.zip")/$(stat -f '%Lp' "$OD" 2>/dev/null || stat -c '%a' "$OD")" "keep/DO-NOT-DELETE/755"
OE="$TMP/empty-out"; mkdir -p "$OE"; chmod 755 "$OE"
t_rc "an EMPTY existing --out is accepted (rc 0)" 0 bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --out "$OE"
t_eq "...its own mode is NOT changed (still 755); the work happens in a fresh 0700 subdirectory" "$(stat -f '%Lp' "$OE" 2>/dev/null || stat -c '%a' "$OE")/$(find "$OE" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')/$(find "$OE" -mindepth 1 -maxdepth 1 -type d -perm 700 | wc -l | tr -d ' ')" "755/1/1"
ln -s "$OE" "$TMP/out-link"
t_rc "a symlinked --out is refused (rc 2)" 2 bash "$REL/verify-published-plugin.sh" --mode offline --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --out "$TMP/out-link"
mock_up none; OF="$TMP/o-fresh-not-yet"
t_rc "a --out that does not exist is created (0700) and works (rc 0)" 0 bash "$REL/verify-published-plugin.sh" --mode fixture --base-url "http://127.0.0.1:$MPORT" --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --credentials-file "$TMP/creds.env" --no-updater-probes --out "$OF"
t_eq "...with mode 700" "$(stat -f '%Lp' "$OF" 2>/dev/null || stat -c '%a' "$OF")" "700"
t_eq "the signing wrapper leaves no temp file or directory behind after a refusal at ANY stage" "$(find "$TMP/tw" "${TMPDIR:-/tmp}" -maxdepth 1 \( -name '*.tmp.*' -o -name 'aicc-sign.*' \) 2>/dev/null | wc -l | tr -d ' ')" "0"

echo "== H. the host trust-anchor check (ssh is a STUB that runs the real PHP snippet against a constant it defines; the value is never printed) =="
STUB="$TMP/stub"; mkdir -p "$STUB"; SID=0123456789abcdef0123456789abcdef
cat > "$STUB/ssh" <<'EOS'
#!/usr/bin/env bash
[ -z "${STUB_LOG:-}" ] || echo "ssh $*" >> "$STUB_LOG"
cmd="${@: -1}"
case "$cmd" in
  "cat /etc/aicc-stage-identity") printf 'AICC_ENV=%s\nAICC_HOSTNAME=%s\nAICC_STAGE_ID=%s\n' "${STUB_ENV:-production}" "${STUB_HOSTNAME:-www.copilt.org}" "${STUB_ID:-0123456789abcdef0123456789abcdef}" ;;
  *"sudo aicc-wp eval"*)
    b64="$(printf '%s' "$cmd" | sed -n "s/.*base64_decode('\([^']*\)').*/\1/p")"
    code="$(printf '%s' "$b64" | base64 -d)"
    php -r 'if (getenv("STUB_CONST") !== false) { define("AICC_LM_PLUGIN_SIGNING_PUBKEYS", getenv("STUB_CONST")); } eval($argv[1]);' "$code" ;;
  *) exit 0 ;;
esac
EOS
chmod +x "$STUB/ssh"
PKEY="$TMP/aicc_cp_prod_operator"; printf -- '-----BEGIN %s-----\nDUMMY\n-----END %s-----\n' "OPENSSH PRIVATE KEY" "OPENSSH PRIVATE KEY" > "$PKEY"; chmod 600 "$PKEY"
KH="$TMP/known_hosts_prod"; echo "203.0.113.9 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItestonlytestonlytestonlytestonlytestonlytest" > "$KH"
CHK() { env PATH="$STUB:$PATH" bash "$REL/check-host-signing-keys.sh" --pubkeys "$LIST" --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$PKEY" --known-hosts "$KH" "$@" 2>&1; }
OUTH="$(STUB_CONST="$LIST" CHK)"; rc=$?
t_eq "host list = primary,standby: OK (rc 0)" "$rc" "0"
t_contains "...it says the primary key is configured" "$OUTH" "OK: the primary signing key is configured"
t_contains "...it prints the fingerprints (derived, not the value): primary PRESENT" "$OUTH" "HOSTKEYS primary $FP PRESENT"
t_not_contains "...and NEVER the constant's value (no base64 key in the output)" "$OUTH" "$PRI"
OUTH="$(STUB_CONST="$PRI" CHK)"; rc=$?; t_eq "host list = primary only: OK with a NOTE about the standby (rc 0)" "$rc/$(printf '%s' "$OUTH" | grep -c 'NOTE: the standby')" "0/1"
OUTH="$(STUB_CONST="$STB" CHK)"; rc=$?; t_eq "host list = the STANDBY only: NOT OK (rc 1)" "$rc" "1"
OUTH="$(STUB_CONST="$ATT" CHK)"; rc=$?; t_eq "host list = another key: NOT OK (rc 1)" "$rc" "1"
OUTH="$(CHK)"; rc=$?; t_eq "constant NOT defined: NOT OK (rc 1)" "$rc/$(printf '%s' "$OUTH" | grep -c 'not-defined')" "1/1"
OUTH="$(STUB_CONST="not-a-key,also-not" CHK)"; rc=$?; t_eq "an unusable constant: NOT OK (rc 1), entries shown as unusable" "$rc/$(printf '%s' "$OUTH" | grep -c 'unusable')" "1/1"
t_rc "a host whose stage id differs is refused before anything is asked (rc 3)" 3 env STUB_ID=ffffffffffffffffffffffffffffffff STUB_CONST="$LIST" PATH="$STUB:$PATH" bash "$REL/check-host-signing-keys.sh" --pubkeys "$LIST" --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$PKEY" --known-hosts "$KH"
t_rc "a staging host answering as production target is refused (rc 3)" 3 env STUB_ENV=staging PATH="$STUB:$PATH" bash "$REL/check-host-signing-keys.sh" --pubkeys "$LIST" --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$PKEY" --known-hosts "$KH"
t_rc "production with another host name is refused (rc 3)" 3 env PATH="$STUB:$PATH" bash "$REL/check-host-signing-keys.sh" --pubkeys "$LIST" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$PKEY" --known-hosts "$KH"
cp "$PKEY" "$TMP/aicc_key_other"; t_rc "a key file not named aicc_cp_prod* is refused for production (rc 3)" 3 env PATH="$STUB:$PATH" bash "$REL/check-host-signing-keys.sh" --pubkeys "$LIST" --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$TMP/aicc_key_other" --known-hosts "$KH"
t_rc "no pinned known-hosts entry is refused (rc 3)" 3 env PATH="$STUB:$PATH" bash "$REL/check-host-signing-keys.sh" --pubkeys "$LIST" --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$PKEY" --known-hosts "$TMP/nokh"
t_rc "the API Droplet's address is refused (rc 3)" 3 env PATH="$STUB:$PATH" bash "$REL/check-host-signing-keys.sh" --pubkeys "$LIST" --stage-host www.copilt.org --stage-ip 139.59.157.231 --stage-id "$SID" --key "$PKEY" --known-hosts "$KH"
t_rc "without the owner's public key list it is a usage error (rc 2)" 2 env PATH="$STUB:$PATH" bash "$REL/check-host-signing-keys.sh" --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$PKEY" --known-hosts "$KH"
: > "$TMP/h.calls"
for bad in '-oProxyCommand=touch /tmp/avp-pwned' '-F/dev/null' 'Aicc' 'a.b' 'a b' '' ; do
  t_rc "check-host: --user '$bad' is refused (rc 2 or 3), never reaches ssh" 3 env STUB_LOG="$TMP/h.calls" STUB_CONST="$LIST" PATH="$STUB:$PATH" bash "$REL/check-host-signing-keys.sh" --pubkeys "$LIST" --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$PKEY" --known-hosts "$KH" --user "$bad"
done
t_eq "check-host: none of those reached the ssh stub" "$(wc -l < "$TMP/h.calls" | tr -d ' ')" "0"
STUB_LOG="$TMP/h.calls" STUB_CONST="$LIST" CHK >/dev/null 2>&1
t_eq "check-host: every ssh call puts the destination after '--' (an operator string can never be an ssh option)" "$(grep -c -- ' -- aicc@203.0.113.9 ' "$TMP/h.calls")/$(wc -l < "$TMP/h.calls" | tr -d ' ')" "2/2"
t_eq "the script changes nothing on the host: its remote commands are only the identity read and the eval (no tee/mv/sed -i/render/owner-facts set)" "$(grep -v '^#' "$REL/check-host-signing-keys.sh" | grep -c -E 'aicc-owner-facts|aicc-render-wp-config|tee |mv |rm |systemctl' | tr -d ' ')" "0"

echo "== F. first-signed-release.sh: stage 3 cross-checks the ZIP (the --pubkeys form alone would not) =="
FSR() { env PLUG="$PD" CPW="$CPDIR" VERSION="$V" PRIMARY_PUB="$PRI" STANDBY_PUB="$STB" PRIMARY_FP="$FP" OUT="$TMP/fsr-out" bash "$REL/first-signed-release.sh" "$@" 2>&1; }
CPDIR="$TMP/cpw"; mkdir -p "$CPDIR/scripts/plugin-release"; printf '#!/usr/bin/env bash\n' > "$CPDIR/scripts/plugin-release/install-plugin-release.sh"
t_rc "stage 0: preconditions pass on the throwaway checkout (rc 0)" 0 FSR 0
t_rc "stage 0: a wrong primary public key (not what endpoints.conf holds) is refused (rc 1)" 1 env PLUG="$PD" CPW="$CPDIR" VERSION="$V" PRIMARY_PUB="$ATT" STANDBY_PUB="$STB" PRIMARY_FP="$FP" bash "$REL/first-signed-release.sh" 0
mkdir -p "$TMP/fsr-out"; cp "$ZIP" "$MAN" "$SIG" "$TMP/fsr-out/"; cp "$ZIP.sha256" "$TMP/fsr-out/" 2>/dev/null || true
OUT3="$(FSR 3)"; rc=$?
t_eq "stage 3 with the genuine ZIP: OK (rc 0); the --pubkeys form, the --zip form AND the zip-aware strict form ran" "$rc/$(printf '%s\n' "$OUT3" | grep -c '^verified:')" "0/3"
cp "$TMP/tampered.zip" "$TMP/fsr-out/$ZN"
OUT3="$(FSR 3)"; rc=$?
t_eq "stage 3 with a TAMPERED ZIP next to the genuine manifest+signature: FAILS (rc 1) - before P41 it passed because --pubkeys made the tool ignore the ZIP" "$rc" "1"
t_contains "...and says why" "$OUT3" "does not verify against the ZIP"
cp "$ZIP" "$TMP/fsr-out/$ZN"; cp "$TMP/att/ai-commerce-copilot-$V.manifest.sig.keep" "$TMP/fsr-out/x" 2>/dev/null || true
php "$REL/../stack-tests/lib/forge_sig.php" "$PD" "$MAN" "$KEYS/standby.key" "$TMP/fsr-out/ai-commerce-copilot-$V.manifest.sig" >/dev/null
OUT3="$(FSR 3)"; rc=$?
t_eq "stage 3 with a signature by the STANDBY key: FAILS (rc 1: not the primary)" "$rc" "1"
php "$REL/../stack-tests/lib/forge_sig.php" "$PD" "$MAN" "$KEYS/attacker.key" "$TMP/fsr-out/ai-commerce-copilot-$V.manifest.sig" >/dev/null
OUT3="$(FSR 3)"; rc=$?
t_eq "stage 3 with a signature by the ATTACKER key: FAILS (rc 1)" "$rc" "1"
t_contains "stage 2 prints the owner's wrapper command (not a bare sign-release.php call)" "$(FSR 2 < /dev/null)" "sign-plugin-release.sh"
echo "== Y. yank-plugin-release.sh (the stop switch; ssh is a STUB that runs the host-side python on a scratch release store) =="
RS="$TMP/relstore"; mkdir -p "$RS/$V"; cp "$ZIP" "$MAN" "$SIG" "$RS/$V/"; chmod 640 "$RS/$V/ai-commerce-copilot-$V.manifest.json"; echo "$V" > "$RS/current"
YSTUB="$TMP/ystub"; mkdir -p "$YSTUB"; : > "$TMP/ystub.calls"
cat > "$YSTUB/ssh" <<EOS
#!/usr/bin/env bash
echo "ssh \$*" >> "$TMP/ystub.calls"
cmd="\${@: -1}"
case "\$cmd" in
  "cat /etc/aicc-stage-identity") printf 'AICC_ENV=production\nAICC_HOSTNAME=www.copilt.org\nAICC_STAGE_ID=0123456789abcdef0123456789abcdef\n' ;;
  "sudo python3 -I - "*) set -- \$cmd; python3 -I - "\$5" "$RS" "\$7" ;;
  *"sudo aicc-wp eval"*) jq -c '(.yanked // false)' "$RS/$V/ai-commerce-copilot-$V.manifest.json" ;;
  *) exit 0 ;;
esac
EOS
chmod +x "$YSTUB/ssh"
YK() { env PATH="$YSTUB:$PATH" bash "$REL/yank-plugin-release.sh" --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$PKEY" --known-hosts "$KH" --confirm-production "$V" "$@" 2>&1; }
OUTY="$(YK --version "$V")"; rc=$?
t_eq "production without --apply is a DRY RUN: plan printed, rc 0, the host is never contacted" "$rc/$(grep -c . "$TMP/ystub.calls")" "0/0"
t_contains "...the plan names the manifest and the atomic rewrite" "$OUTY" "set \"yanked\": true"
M="$RS/$V/ai-commerce-copilot-$V.manifest.json"; MODE0="$(stat -f '%Lp' "$M" 2>/dev/null || stat -c '%a' "$M")"
OUTY="$(YK --version "$V" --apply)"; rc=$?
t_eq "--apply yanks it: rc 0 and WordPress reads yanked=true" "$rc/$(jq -r .yanked "$M")" "0/true"
t_contains "...the output says VERIFIED and that the signature is unaffected" "$OUTY" "VERIFIED through WordPress: $V is now YANKED"
t_eq "...the file mode is preserved" "$(stat -f '%Lp' "$M" 2>/dev/null || stat -c '%a' "$M")" "$MODE0"
t_ok "...and the owner's signature STILL verifies (yanked is not a signed field)" php "$PD/bin/sign-release.php" verify --manifest "$M" --sig "$RS/$V/ai-commerce-copilot-$V.manifest.sig" --zip "$RS/$V/$ZN"
t_eq "...nothing else in the manifest changed (every other field equals the original)" "$(jq -c 'del(.yanked)' "$M")" "$(jq -c . "$MAN")"
t_ok "...no file was deleted (ZIP, manifest, signature, current all present)" bash -c "[ -f '$RS/$V/$ZN' ] && [ -f '$M' ] && [ -f '$RS/$V/ai-commerce-copilot-$V.manifest.sig' ] && [ -f '$RS/current' ]"
OUTY="$(YK --version "$V" --apply --unyank)"; rc=$?
t_eq "--unyank restores it: rc 0, the field is gone, WordPress reads false" "$rc/$(jq -r 'has("yanked")' "$M")" "0/false"
: > "$TMP/ystub.calls"
for bad in '-oProxyCommand=touch /tmp/avp-pwned' '-F/dev/null' 'Aicc' 'a.b' ''; do
  t_rc "yank: --user '$bad' is refused (rc 3), never reaches ssh" 3 env PATH="$YSTUB:$PATH" bash "$REL/yank-plugin-release.sh" --version "$V" --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$PKEY" --known-hosts "$KH" --confirm-production "$V" --apply --user "$bad"
done
t_eq "yank: none of those reached the ssh stub" "$(wc -l < "$TMP/ystub.calls" | tr -d ' ')" "0"
VICTIM="$TMP/victim.txt"; echo "VICTIM-ORIGINAL" > "$VICTIM"; ln -s "$VICTIM" "$M.tmp-yank"
OUTY="$(YK --version "$V" --apply)"; rc=$?
t_eq "yank: a symlink planted at the old fixed temp path is NOT followed: the victim file is unchanged and the yank still succeeds" "$rc/$(cat "$VICTIM")/$(jq -r .yanked "$M")" "0/VICTIM-ORIGINAL/true"
rm -f "$M.tmp-yank"; YK --version "$V" --apply --unyank >/dev/null
t_eq "yank: every ssh call puts the destination after '--'" "$(grep -c -- ' -- aicc@203.0.113.9 ' "$TMP/ystub.calls")/$(wc -l < "$TMP/ystub.calls" | tr -d ' ')" "$(wc -l < "$TMP/ystub.calls" | tr -d ' ')/$(wc -l < "$TMP/ystub.calls" | tr -d ' ')"
t_eq "yank: no temp file is left in the release directory" "$(find "$RS/$V" -name '*tmp*' | wc -l | tr -d ' ')" "0"
t_rc "a wrong --confirm-production is refused (rc 3)" 3 env PATH="$YSTUB:$PATH" bash "$REL/yank-plugin-release.sh" --version "$V" --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$PKEY" --known-hosts "$KH" --confirm-production 9.9.9 --apply
t_rc "another host name is refused (rc 3)" 3 env PATH="$YSTUB:$PATH" bash "$REL/yank-plugin-release.sh" --version "$V" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$PKEY" --known-hosts "$KH" --confirm-production "$V" --apply
t_rc "a non-strict version is refused (rc 3)" 3 env PATH="$YSTUB:$PATH" bash "$REL/yank-plugin-release.sh" --version "1.1.1-dev.1" --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$PKEY" --known-hosts "$KH" --confirm-production 1.1.1-dev.1 --apply
t_rc "a version that is not installed fails on the host side, nothing changed (rc 1)" 1 env PATH="$YSTUB:$PATH" bash "$REL/yank-plugin-release.sh" --version 7.7.7 --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --key "$PKEY" --known-hosts "$KH" --confirm-production 7.7.7 --apply
mv "$M" "$TMP/real-manifest"; ln -s "$TMP/real-manifest" "$M"
t_rc "a symlinked manifest is refused on the host side (rc 1)" 1 YK --version "$V" --apply
rm -f "$M"; mv "$TMP/real-manifest" "$M"
t_rc "a host with another stage id is refused (rc 3)" 3 env PATH="$YSTUB:$PATH" bash "$REL/yank-plugin-release.sh" --version "$V" --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id ffffffffffffffffffffffffffffffff --key "$PKEY" --known-hosts "$KH" --confirm-production "$V" --apply
t_summary
