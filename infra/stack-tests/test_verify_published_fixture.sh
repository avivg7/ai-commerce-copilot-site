#!/usr/bin/env bash
# END-TO-END proof of infra/release/verify-published-plugin.sh against a REAL, DISPOSABLE Control Plane (WordPress 7.1.2 + WooCommerce + the aicc-license-manager plugin of a CP worktree, MySQL 8.4,
# php -S) on loopback ports 9910-9919 (builder R's range), with THROWAWAY keys only. The release goes through the owner's REAL signing wrapper (sign-plugin-release.sh) and the Control Plane's REAL host
# installer (scripts/plugin-release/install-plugin-release.sh); the customers are synthetic. Nothing leaves this Mac, no production host or key is touched.
# Opt-in (it starts mysqld and php -S, ~1 minute): AICC_VERIFY_FIXTURE=1 bash infra/stack-tests/test_verify_published_fixture.sh   [AICC_CP_DIR=<CP worktree>] [AICC_PLUGIN_DIR/AICC_PLUGIN_COMMIT as in test_verify_published.sh]
#   F1  the owner signs (wrapper), the host installer installs, the fixture comes up                F2  positive: a customer with an active plan passes every check (45)
#   F3  another tenant's customer also passes; the REVOKED customer cannot download (FAIL C2); a wrong password FAILS C1
#   F4  the Control Plane trusts ANOTHER key: the panel withholds the release and the store gets no offer (FAIL C2, U10)
#   F5  the stored ZIP is tampered on the host: the Control Plane refuses to serve it (FAIL C4), then restored          F6  a yanked release is withheld (FAIL C2) and comes back
#   F7  WordPress's own installer: a truncated copy of the ZIP is refused and nothing is installed; the verified ZIP installs (not activated)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; REL="$REPO/infra/release"
T_SUITE="verify-published-fixture"; . "$HERE/lib/t.sh"
if [ "${AICC_VERIFY_FIXTURE:-0}" != 1 ]; then t_skip "the whole suite" "opt-in: set AICC_VERIFY_FIXTURE=1 (starts a disposable MySQL + WordPress on ports 9910/9911)"; t_summary; exit 0; fi
for tool in php python3 git jq; do command -v "$tool" >/dev/null 2>&1 || { echo "need $tool"; exit 2; }; done
CP="${AICC_CP_DIR:-$HOME/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/p40-pricing}"
PLUG_SRC="${AICC_PLUGIN_DIR:-$HOME/self_projects/aicc-plugin-p41}"; PLUG_COMMIT="${AICC_PLUGIN_COMMIT:-abdcda2}"
[ -d "$CP/admin/wp-content/plugins/aicc-license-manager" ] || { t_skip "the whole suite" "no Control Plane worktree at $CP (AICC_CP_DIR)"; t_summary; exit 0; }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/avpf.XXXX")"; ST="$TMP/state"
cleanup() { bash "$REL/fixture/verify-published-fixture.sh" down --dir "$ST" >/dev/null 2>&1; rm -rf "$TMP"; }; trap cleanup EXIT
. "$HERE/lib/tw_release.sh"
if ! tw_release_build > "$TMP/build.log" 2>&1; then t_skip "the whole suite" "$(tail -1 "$TMP/build.log")"; t_summary; exit 0; fi

echo "== F1. sign (the owner's wrapper), install (the host installer), bring the Control Plane fixture up =="
KF="$KEYS/primary.key"
t_ok "the owner's wrapper signs the throwaway build with the throwaway primary key" env AICC_RELEASE_SIGNING_KEY_FILE="$KF" bash "$REL/sign-plugin-release.sh" --plugin-dir "$PD" --zip "$ZIP" --manifest "$MAN" --version "$V" --sha256 "$SHA" --commit "${COMMIT:0:12}" --primary-fp "$FP"
SIG="$TMP/tw/ai-commerce-copilot-$V.manifest.sig"
t_ok "the fixture comes up on 9910/9911 and the release is installed by the REAL host installer" bash "$REL/fixture/verify-published-fixture.sh" up --cp "$CP" --zip "$ZIP" --manifest "$MAN" --sig "$SIG" --pubkeys "$LIST" --dir "$ST" --ports 9910,9911
[ -f "$ST/fixture.env" ] || { t_bad "fixture state exists" "no fixture.env"; t_summary; exit 1; }
BASE="http://127.0.0.1:9911"; FIXD="$(sed -n 's/^FIX=//p' "$ST/fixture.env" | head -1 | python3 -I -c 'import shlex,sys; print(shlex.split(sys.stdin.read())[0])')"
PHPB="$(sed -n 's/^PHPB=//p' "$ST/fixture.env" | python3 -I -c 'import shlex,sys; print(shlex.split(sys.stdin.read())[0])')"; WPCLI="$(sed -n 's/^WPCLI=//p' "$ST/fixture.env" | head -1)"
WPF() { "$PHPB" -d memory_limit=512M "$WPCLI" "$@" --path="$FIXD/wp"; }
RELD="$(sed -n 's/^REL=//p' "$ST/fixture.env" | python3 -I -c 'import shlex,sys; print(shlex.split(sys.stdin.read())[0])')"
t_eq "the release store says current = $V" "$(cat "$RELD/current")" "$V"
VP() { local creds="$1"; shift; bash "$REL/verify-published-plugin.sh" --mode fixture --base-url "$BASE" --version "$V" --sha256 "$SHA" --manifest "$MAN" --sig "$SIG" --plugin-dir "$PD" --credentials-file "$creds" --out "$TMP/out" "$@" 2>&1; }
exp_fail() { local n="$1" id="$2"; shift 2; local out rc=0; out="$("$@" 2>&1)" || rc=$?; if [ "$rc" = 1 ] && printf '%s' "$out" | grep -q "^FAIL  $id"; then t_pass "$n"; else t_bad "$n" "rc=$rc; $(printf '%s' "$out" | grep '^FAIL' | head -3 | tr '\n' '|')"; fi; }

echo "== F2. positive: a customer with an ACTIVE plan, a connected store, the real routes =="
OUT="$(VP "$ST/creds.env" --store-file "$ST/store.env" --package-download --local-zip "$ZIP" --previous-version 1.1.0 --expect-key-id "$FP")"; rc=$?
t_eq "every check passes (rc 0)" "$rc" "0"
t_eq "...45 PASS, 0 FAIL" "$(printf '%s\n' "$OUT" | grep -c '^PASS')/$(printf '%s\n' "$OUT" | grep -c '^FAIL')" "45/0"
t_ok "...the downloaded ZIP is byte-identical to the published one" cmp -s "$TMP/out/ai-commerce-copilot-$V.zip" "$ZIP"
t_eq "...the Control Plane logged ONE plugin_downloaded for the account and ONE for the updater (package) download" "$(WPF eval 'global $wpdb; echo (int) $wpdb->get_var("SELECT COUNT(*) FROM " . AICC_LM_Activator::audit_table() . " WHERE event_type = \"plugin_downloaded\"");' 2>/dev/null | tail -1)" "2"

echo "== F3. other customers =="
t_rc "another tenant's customer (active solo plan) also passes the customer path (rc 0)" 0 VP "$ST/creds-b.env" --no-updater-probes
exp_fail "the REVOKED customer (a refund outcome) cannot get the plugin: FAIL C2 (no panel, no link)" C2 VP "$ST/creds-c.env" --no-updater-probes
printf 'AICC_VERIFY_USER=nobody\nAICC_VERIFY_PASS=wrong-wrong-wrong-wrong\n' > "$TMP/bad.env"; chmod 600 "$TMP/bad.env"
exp_fail "a wrong password: FAIL C1" C1 VP "$TMP/bad.env" --no-updater-probes

echo "== F4. the Control Plane's trust anchor is another key =="
WPF option update aicc_lm_test_plugin_signing_pubkeys "$ATT" >/dev/null 2>&1
exp_fail "the release is withheld from the account page: FAIL C2" C2 VP "$ST/creds.env" --store-file "$ST/store.env"
exp_fail "...and no offer reaches the store: FAIL U10" U10 VP "$ST/creds.env" --store-file "$ST/store.env"
WPF option update aicc_lm_test_plugin_signing_pubkeys "$LIST" >/dev/null 2>&1
t_rc "restored: the customer path passes again (rc 0)" 0 VP "$ST/creds.env" --no-updater-probes

echo "== F5. the stored ZIP is tampered on the host =="
SZ="$RELD/$V/$ZN"; cp "$SZ" "$TMP/stored.orig"; chmod u+w "$SZ"; printf X >> "$SZ"
exp_fail "the Control Plane re-hashes before serving and refuses: FAIL C4 (HTTP 404, no bytes)" C4 VP "$ST/creds.env" --no-updater-probes
exp_fail "...and the updater's package route refuses too: FAIL U19" U19 VP "$ST/creds.env" --store-file "$ST/store.env" --package-download
cp "$TMP/stored.orig" "$SZ"; t_rc "restored: passes again (rc 0)" 0 VP "$ST/creds.env" --no-updater-probes

echo "== F6. a YANKED release (the rollback lever) =="
SM="$RELD/$V/ai-commerce-copilot-$V.manifest.json"; cp "$SM" "$TMP/stored.manifest"; chmod u+w "$SM"; jq '.yanked = true' "$TMP/stored.manifest" > "$SM"
exp_fail "a yanked release is withheld from the panel: FAIL C2" C2 VP "$ST/creds.env" --store-file "$ST/store.env"
exp_fail "...and from the updater: FAIL U10" U10 VP "$ST/creds.env" --store-file "$ST/store.env"
cp "$TMP/stored.manifest" "$SM"; t_rc "un-yanked (manifest restored): passes again (rc 0)" 0 VP "$ST/creds.env" --no-updater-probes

echo "== F7. WordPress's own installer refuses a truncated ZIP; the verified ZIP installs =="
python3 -I - "$TMP/out/ai-commerce-copilot-$V.zip" "$TMP/trunc.zip" <<'PY'
import sys
d = open(sys.argv[1], "rb").read(); open(sys.argv[2], "wb").write(d[: len(d) // 2])
PY
WPF plugin install "$TMP/trunc.zip" >/dev/null 2>&1; irc=$?
t_ok "wp plugin install <truncated ZIP> fails (rc $irc) and nothing named ai-commerce-copilot is installed" bash -c "[ $irc -ne 0 ] && [ ! -e '$FIXD/wp/wp-content/plugins/ai-commerce-copilot' ]"
WPF plugin install "$TMP/out/ai-commerce-copilot-$V.zip" >/dev/null 2>&1
t_eq "the ZIP the tool VERIFIED installs (not activated) at version $V" "$(WPF plugin get ai-commerce-copilot --field=version 2>/dev/null | tail -1)" "$V"
t_summary
