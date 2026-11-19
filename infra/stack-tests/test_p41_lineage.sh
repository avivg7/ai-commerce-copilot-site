#!/usr/bin/env bash
# P41 R: the wp-config LINEAGE guard. Two infra lines diverged after Site bf54801: feat/p38-brevo-infra (the Brevo API mail region + the five P35 constants pinned as owner facts, 9d6290e) and the p39/p40 Site
# line (1693122, whose infra/ is byte-identical to bf54801 = the P37 self-service region: Trial, Turnstile, notify, milestone sync, owner-ops). This suite proves that the MERGED tree renders BOTH from ONE template
# and ONE facts file, and that the render for the committed production owner-facts fixture has exactly the structure of the live file. Nothing reads a host: SYNTHETIC fixtures only (infra/stack-tests/fixtures/).
#   L  lineage:     both ancestries are in this tree; the template carries every region exactly once; owner_facts knows every key the activation needs
#   P  live render: fixtures/owner-facts.production.live.env (+ a safe Brevo key file) renders golden/wp-config.production.p41-live.php byte for byte; its constants and types are the live ones; only the documented lines differ from the default
#   A  activation:  fixtures/owner-facts.production.p41-activation.env renders golden/wp-config.production.p41-activation.php byte for byte = the live file + ONLY additions (and the one extended outbound host list)
#   C  --compare:   read-only (the target is untouched, no leftover, no value printed); IDENTICAL for the live render against a synthetic live file; DIFFERENT names exactly the five P35 constants without their facts
#   R  refusals:    the Control Plane's own readiness rules (no Turnstile secret / no mail / no notify / no cap) refuse the activation render; nothing is written
# Regenerate the goldens deliberately: AICC_UPDATE_GOLDEN=1 bash infra/stack-tests/test_p41_lineage.sh   (review the diff!)
# Run: bash infra/stack-tests/test_p41_lineage.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; INFRA="$REPO/infra"; PROV="$INFRA/provision"; FIX="$HERE/fixtures"
T_SUITE="p41-lineage"; . "$HERE/lib/t.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ap41l.XXXX")"; trap 'rm -rf "$TMP"' EXIT
for tool in php python3 jq; do command -v "$tool" >/dev/null 2>&1 || { echo "need $tool"; exit 2; }; done
SEC="$TMP/sec"; REL="$TMP/rel"; MAILD="$TMP/mail"; ABS="$TMP/abs"; OUT="$TMP/prod.php"; OFF="$TMP/owner-facts.env"
mkdir -p "$SEC" "$REL" "$MAILD" "$ABS"; chmod 700 "$SEC"; chmod 750 "$REL" "$MAILD"; echo '<?php' > "$ABS/wp-settings.php"
HEX="$(printf 'ab12%.0s' $(seq 16))"; OFU="$(id -un):$(id -gn)"
printf 'golden_db_pass_0001\n' > "$SEC/db-cp.pass"
{ for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT; do printf '%s=SALTVALUE_%s\n' "$k" "$k"; done; printf 'AICC_ACTIVATION_PROOF_SECRET=%s\nAICC_ENTITLEMENT_WEBHOOK_SECRET=%s\n' "$HEX" "$HEX"; } > "$SEC/wp-secrets.env"; chmod 600 "$SEC/wp-secrets.env"
printf 'WEBHOOK-test-0123456789-0123456789-abcdef\n' > "$SEC/entitlement-webhook.secret"; printf 'PROOF-test-0123456789-0123456789-abcdefgh\n' > "$SEC/activation-proof.secret"; chmod 600 "$SEC/"*.secret
R() { env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --env production --confirm-production --out "${OUTF:-$OUT}" --secrets-dir "$SEC" --mail-dir "$MAILD" --plugin-release-dir "$REL" --owner-facts-file "$OFF" --owner "$OFU" "$@"; }
hexnorm() { sed -E 's/[0-9a-f]{64}/HEX64/g' "$1"; }
cst() { local f="$1"; shift; php -r 'define("ABSPATH",$argv[2]); require $argv[1]; $o=array(); foreach (array_slice($argv,3) as $n) { $o[$n]=defined($n)?constant($n):null; } echo json_encode($o);' "$f" "$ABS/" "$@"; }
defnames() { sed -n "s/^define( '\([A-Za-z0-9_]*\)'.*/\1/p" "$1" | sort; }
deflines() { grep -E "^define\( '" "$1" | sort; }
facts_from() { cp "$1" "$OFF"; chmod 600 "$OFF"; }
BREVOKEY='xkeysib-TEST-NOT-A-REAL-KEY-0000'; TSSECRET='0x4AAAAAAATSsecretVALUE0123456789abcdef'
brevo_on() { printf '%s\n' "$BREVOKEY" > "$MAILD/brevo-api.key"; chmod 640 "$MAILD/brevo-api.key"; }
brevo_off() { rm -f "$MAILD/brevo-api.key"; }
ts_on() { printf '%s\n' "$TSSECRET" > "$MAILD/turnstile.secret"; chmod 640 "$MAILD/turnstile.secret"; }
ts_off() { rm -f "$MAILD/turnstile.secret"; }
GOLD_DEFAULT="$HERE/golden/wp-config.production.no-owner-facts.php"
GOLD_LIVE="$HERE/golden/wp-config.production.p41-live.php"; GOLD_ACT="$HERE/golden/wp-config.production.p41-activation.php"
TPL="$PROV/wp-config.production.template.php"
FIVE="AICC_EA_LAUNCH_OFFER_MODE AICC_OWNER_DASHBOARD_USER_IDS AICC_OWNER_METRICS_BASE AICC_OWNER_METRICS_TOKEN_FILE AICC_OWNER_OPS_SNAPSHOT_FILE"
BREVOC="AICC_MAIL_ALLOWED_FROM_DOMAINS AICC_MAIL_API_KEY_FILE AICC_MAIL_DAILY_BUDGET AICC_MAIL_ENABLED AICC_MAIL_FROM_ADDRESS AICC_MAIL_FROM_NAME AICC_MAIL_PROVIDER AICC_MAIL_REPLY_TO"
ACTC="AICC_FUNNEL_COUNTERS_ENABLED AICC_MILESTONE_SYNC_SCHEDULED AICC_NOTIFY_ENABLED AICC_NOTIFY_EXCLUDED_CUSTOMERS AICC_OWNER_OPS_SECTION_ENABLED AICC_TRIAL_SELF_SERVICE_CAP AICC_TRIAL_SELF_SERVICE_ENABLED AICC_TURNSTILE_SECRET_FILE AICC_TURNSTILE_SITE_KEY"
sorted() { printf '%s\n' $1 | sort | tr '\n' ' '; }

echo "== L. lineage: both infra ancestries are in this tree, one template carries every region =="
if git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  for spec in "9d6290e|the P38 Brevo line (the five P35 constants pinned as owner facts)" "24e1f6e|the P38 Brevo wp-config region" "bf54801|the P37 self-service region (Trial/Turnstile/notify/milestone/owner-ops)" "1693122|the P40 Site line (the deployed Site, infra identical to bf54801)"; do
    IFS='|' read -r c what <<< "$spec"
    if git -C "$REPO" cat-file -e "$c^{commit}" 2>/dev/null; then t_ok "HEAD contains $c: $what" git -C "$REPO" merge-base --is-ancestor "$c" HEAD; else t_skip "HEAD contains $c: $what" "commit object not present in this clone"; fi
  done
else t_skip "ancestry checks" "not a git checkout"; fi
for m in MAIL BREVO OWNER_FACTS P37 P35; do t_eq "the production template carries the $m region exactly once (begin/end)" "$(grep -c "@@${m}_BEGIN@@" "$TPL")/$(grep -c "@@${m}_END@@" "$TPL")" "1/1"; done
t_eq "...and the Trial/Turnstile placeholder, the Brevo placeholder and the P35 blocks placeholder each appear once" "$(grep -c '^@@P37_SELF_SERVICE@@$' "$TPL")/$(grep -c '^@@BREVO_MAIL@@$' "$TPL")/$(grep -c '^@@P35_OWNER_BLOCKS@@$' "$TPL")" "1/1/1"
KEYS_OUT="$(env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production keys)"
need="AICC_TRIAL_SELF_SERVICE_ENABLED AICC_TRIAL_SELF_SERVICE_CAP AICC_TURNSTILE_ENABLED AICC_TURNSTILE_SITE_KEY AICC_NOTIFY_ENABLED AICC_NOTIFY_EXCLUDED_CUSTOMERS AICC_MILESTONE_SYNC_SCHEDULED AICC_OWNER_OPS_SECTION_ENABLED AICC_FUNNEL_COUNTERS_ENABLED AICC_MAIL_PROVIDER AICC_MAIL_FROM_ADDRESS AICC_MAIL_FROM_NAME AICC_MAIL_REPLY_TO AICC_MAIL_DAILY_BUDGET AICC_LM_PLUGIN_SIGNING_PUBKEYS $FIVE"
missing=""; for k in $need; do printf '%s\n' "$KEYS_OUT" | grep -qx "$k" || missing="$missing $k"; done
t_eq "owner-facts knows EVERY key the activation and the live file need (Brevo + Trial + Turnstile + notify + milestone + owner-ops + the five P35 constants)" "${missing:-none}" "none"
t_eq "the stage environment still accepts none of the P35/P37/P38 keys (production only)" "$(env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/none.env" --env stage keys | grep -c 'AICC_TRIAL_\|AICC_MAIL_PROVIDER\|AICC_OWNER_METRICS\|AICC_NOTIFY' || true)" "0"

echo "== P. the LIVE render: committed production owner facts -> the live structure =="
brevo_off; ts_off; rm -f "$OFF"; OUTF="$TMP/default.php" R >/dev/null 2>&1
t_ok "(baseline) with no facts the render is the committed default golden, byte for byte" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$TMP/default.php') '$GOLD_DEFAULT'"
facts_from "$FIX/owner-facts.production.live.env"; brevo_on
t_ok "the live fixture renders (with a safe Brevo key file in place)" R
t_ok "...php -l clean" php -l "$OUT"
if [ "${AICC_UPDATE_GOLDEN:-0}" = 1 ]; then hexnorm "$OUT" > "$GOLD_LIVE"; echo "golden regenerated: $GOLD_LIVE"; fi
t_ok "...and it equals golden/wp-config.production.p41-live.php BYTE FOR BYTE (64-hex values normalised)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD_LIVE'"
LV="$(cst "$OUT" AICC_OWNER_METRICS_TOKEN_FILE AICC_OWNER_METRICS_BASE AICC_OWNER_DASHBOARD_USER_IDS AICC_EA_LAUNCH_OFFER_MODE AICC_OWNER_OPS_SNAPSHOT_FILE AICC_MAIL_ENABLED AICC_MAIL_PROVIDER AICC_MAIL_API_KEY_FILE AICC_MAIL_FROM_ADDRESS AICC_MAIL_FROM_NAME AICC_MAIL_REPLY_TO AICC_MAIL_DAILY_BUDGET AICC_MAIL_ALLOWED_FROM_DOMAINS WP_ACCESSIBLE_HOSTS WP_HOME AICC_LM_PLUGIN_RELEASE_DIR AICC_ENTITLEMENT_WEBHOOK_URL)"
t_eq "...PHP reads the five P35 constants exactly as the P35 script appended them (token file, base, user ids as a STRING, announce, snapshot file)" "$(echo "$LV" | jq -c '[.AICC_OWNER_METRICS_TOKEN_FILE,.AICC_OWNER_METRICS_BASE,.AICC_OWNER_DASHBOARD_USER_IDS,.AICC_EA_LAUNCH_OFFER_MODE,.AICC_OWNER_OPS_SNAPSHOT_FILE]')" '["/srv/aicc/shared/owner-metrics.token","https://api.copilt.org","1","announce","/srv/aicc/shared/owner-ops-snapshot.json"]'
t_eq "...and the Brevo constants (enabled true, provider, key FILE path, sender, name, reply-to, budget as an INTEGER, allowed sender domains)" "$(echo "$LV" | jq -c '[.AICC_MAIL_ENABLED,.AICC_MAIL_PROVIDER,.AICC_MAIL_API_KEY_FILE,.AICC_MAIL_FROM_ADDRESS,.AICC_MAIL_FROM_NAME,.AICC_MAIL_REPLY_TO,.AICC_MAIL_DAILY_BUDGET,.AICC_MAIL_ALLOWED_FROM_DOMAINS]')" '[true,"brevo_api","/etc/aicc-mail/brevo-api.key","notifications@copilt.org","AI Commerce Copilot","support@copilt.org",240,["copilt.org"]]'
t_eq "...the outbound host list is the API host plus api.brevo.com (nothing else)" "$(echo "$LV" | jq -r .WP_ACCESSIBLE_HOSTS)" "api.copilt.org,api.brevo.com"
t_eq "...the unchanged production constants are still the golden's (home, release store, webhook URL)" "$(echo "$LV" | jq -c '[.WP_HOME,.AICC_LM_PLUGIN_RELEASE_DIR,.AICC_ENTITLEMENT_WEBHOOK_URL]')" '["https://www.copilt.org","/srv/aicc/shared/plugin-releases","https://api.copilt.org/v1/internal/entitlement/webhook"]'
P37C="AICC_TRIAL_SELF_SERVICE_ENABLED AICC_TRIAL_SELF_SERVICE_CAP AICC_TURNSTILE_SITE_KEY AICC_TURNSTILE_SECRET_FILE AICC_NOTIFY_ENABLED AICC_NOTIFY_EXCLUDED_CUSTOMERS AICC_MAIL_MAX_PER_HOUR AICC_MAIL_MAX_PER_DAY AICC_FUNNEL_COUNTERS_ENABLED AICC_OWNER_OPS_SECTION_ENABLED AICC_MILESTONE_SYNC_SCHEDULED AICC_PLAN_CHANGE_ENABLED AICC_PAY_RECONCILE_ENABLED AICC_PRIVACY_REQUESTS_ENABLED"
t_eq "...NO Trial/Turnstile/notify/milestone/owner-ops constant is defined by the live render (public trial issuance stays closed)" "$(cst "$OUT" $P37C | jq -c '[.[]|select(.!=null)]|length')" "0"
t_eq "the constants the live render ADDS to the default are exactly the five P35 + the eight Brevo constants" "$(sorted "$(comm -13 <(defnames "$TMP/default.php") <(defnames "$OUT") | tr '\n' ' ')")" "$(sorted "$FIVE $BREVOC")"
t_eq "...it removes none of the default's constants" "$(comm -23 <(defnames "$TMP/default.php") <(defnames "$OUT") | tr '\n' ' ')" ""
t_eq "...and the ONLY default define whose value changes is WP_ACCESSIBLE_HOSTS (api.brevo.com appended)" "$(comm -23 <(deflines "$TMP/default.php") <(deflines "$OUT") | sed -n "s/^define( '\([A-Z_]*\)'.*/\1/p" | tr '\n' ' ')" "WP_ACCESSIBLE_HOSTS "
t_eq "the SMTP region is not rendered while the Brevo transport is selected (no smtp-relay host)" "$(grep -v '^[[:space:]]*//' "$OUT" | grep -c 'smtp-relay.brevo.com' || true)" "0"
t_not_contains "no secret is in the live render (the fake Brevo key, the Turnstile secret)" "$(cat "$OUT")" "$BREVOKEY"
cp "$OUT" "$TMP/live-render.php"

echo "== A. the ACTIVATION render: the live file + only additions, ONE render yields Brevo + Trial + Turnstile + notify + milestone + owner-ops =="
facts_from "$FIX/owner-facts.production.p41-activation.env"; brevo_on; ts_on
t_ok "the activation fixture renders (Brevo key file + Turnstile secret file present)" R
t_ok "...php -l clean" php -l "$OUT"
if [ "${AICC_UPDATE_GOLDEN:-0}" = 1 ]; then hexnorm "$OUT" > "$GOLD_ACT"; echo "golden regenerated: $GOLD_ACT"; fi
t_ok "...and it equals golden/wp-config.production.p41-activation.php BYTE FOR BYTE" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD_ACT'"
AV="$(cst "$OUT" $ACTC AICC_MAIL_PROVIDER AICC_MAIL_ENABLED WP_ACCESSIBLE_HOSTS AICC_TRIAL_TURNSTILE AICC_COMMERCE_OPEN AICC_PLAN_CHANGE_ENABLED)"
t_eq "...the switches are the exact boolean true (the Control Plane reads === true) and the cap an INTEGER 25" "$(echo "$AV" | jq -c '[.AICC_TRIAL_SELF_SERVICE_ENABLED,.AICC_TRIAL_SELF_SERVICE_CAP,.AICC_NOTIFY_ENABLED,.AICC_MILESTONE_SYNC_SCHEDULED,.AICC_OWNER_OPS_SECTION_ENABLED,.AICC_FUNNEL_COUNTERS_ENABLED]')" '[true,25,true,true,true,true]'
t_eq "...Turnstile: the public site key and the secret FILE path (never the secret); the excluded customer is the owner's test account (2)" "$(echo "$AV" | jq -c '[.AICC_TURNSTILE_SITE_KEY,.AICC_TURNSTILE_SECRET_FILE,.AICC_NOTIFY_EXCLUDED_CUSTOMERS]')" '["0x4AAAAAAApubLICsitekey01","/etc/aicc-mail/turnstile.secret","2"]'
t_eq "...the outbound hosts are api.copilt.org, challenges.cloudflare.com (Turnstile siteverify) AND api.brevo.com, in that order" "$(echo "$AV" | jq -r .WP_ACCESSIBLE_HOSTS)" "api.copilt.org,challenges.cloudflare.com,api.brevo.com"
t_eq "...Brevo is still on, and the things that must stay closed are absent: no turnstile bypass, no commerce, no plan change" "$(echo "$AV" | jq -c '[.AICC_MAIL_PROVIDER,.AICC_MAIL_ENABLED,.AICC_TRIAL_TURNSTILE,.AICC_COMMERCE_OPEN,.AICC_PLAN_CHANGE_ENABLED]')" '["brevo_api",true,null,null,null]'
t_eq "relative to the LIVE render the activation ADDS exactly the nine documented constants" "$(sorted "$(comm -13 <(defnames "$TMP/live-render.php") <(defnames "$OUT") | tr '\n' ' ')")" "$(sorted "$ACTC")"
t_eq "...removes NONE, and every live constant keeps its value (the only changed define is WP_ACCESSIBLE_HOSTS, extended)" "$(comm -23 <(defnames "$TMP/live-render.php") <(defnames "$OUT") | wc -l | tr -d ' ')/$(comm -23 <(deflines "$TMP/live-render.php") <(deflines "$OUT") | sed -n "s/^define( '\([A-Z_]*\)'.*/\1/p" | tr '\n' ' ')" "0/WP_ACCESSIBLE_HOSTS "
t_eq "...the five hand-appended P35 constants are all still there with their live values" "$(cst "$OUT" $FIVE | jq -c '[.AICC_OWNER_METRICS_TOKEN_FILE,.AICC_OWNER_METRICS_BASE,.AICC_OWNER_DASHBOARD_USER_IDS,.AICC_EA_LAUNCH_OFFER_MODE,.AICC_OWNER_OPS_SNAPSHOT_FILE]')" '["/srv/aicc/shared/owner-metrics.token","https://api.copilt.org","1","announce","/srv/aicc/shared/owner-ops-snapshot.json"]'
t_not_contains "no secret is in the activation render (Turnstile secret, Brevo key)" "$(cat "$OUT")" "$TSSECRET"
t_not_contains "...nor the Brevo key" "$(cat "$OUT")" "$BREVOKEY"
t_eq "the same render is idempotent: a second run says unchanged" "$(R 2>&1 | grep -c 'unchanged')" "1"
cp "$OUT" "$TMP/act-render.php"

echo "== C. --compare: read-only, names only =="
facts_from "$FIX/owner-facts.production.live.env"; brevo_on; ts_off
LIVEF="$TMP/live-file.php"; cp "$TMP/live-render.php" "$LIVEF"; chmod 640 "$LIVEF"; H0="$(shasum -a 256 "$LIVEF" | cut -d' ' -f1)"
CMP="$(R --compare --out "$LIVEF" 2>&1)"; crc=$?
t_eq "the live facts compared with a live file of that structure: IDENTICAL (exit 0)" "$crc" "0"
t_contains "...the message says IDENTICAL" "$CMP" "IDENTICAL"
t_eq "--compare left the target file untouched and left no .compare/.wpcfg leftover in the secrets directory or beside the output" "$(shasum -a 256 "$LIVEF" | cut -d' ' -f1)/$(find "$SEC" "$TMP" -maxdepth 1 \( -name '.compare.*' -o -name '.wpcfg.*' \) | wc -l | tr -d ' ')" "$H0/0"
# a live file WITHOUT the five hand-appended constants and the facts WITHOUT them: the trap, simulated both ways
python3 - "$LIVEF" "$TMP/live-nofive.php" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
for n in ("AICC_OWNER_METRICS_TOKEN_FILE", "AICC_OWNER_METRICS_BASE", "AICC_OWNER_DASHBOARD_USER_IDS", "AICC_EA_LAUNCH_OFFER_MODE", "AICC_OWNER_OPS_SNAPSHOT_FILE"):
    s = re.sub(r"^define\( '%s',.*\n" % n, "", s, flags=re.M)
open(sys.argv[2], "w").write(s)
PY
CMP="$(R --compare --out "$TMP/live-nofive.php" 2>&1)"; crc=$?
t_eq "a host whose wp-config LACKS the five constants: --compare DIFFERENT (exit 4) and names exactly them as 'added' (a render would add them)" "$crc/$(printf '%s' "$CMP" | sed -n 's/^  added  : //p' | tr -d ',' )" "4/AICC_EA_LAUNCH_OFFER_MODE AICC_OWNER_DASHBOARD_USER_IDS AICC_OWNER_METRICS_BASE AICC_OWNER_METRICS_TOKEN_FILE AICC_OWNER_OPS_SNAPSHOT_FILE"
# the facts WITHOUT the five (the state BEFORE 9d6290e pinned them): a re-render would REMOVE them from the live file -> --compare must say so
grep -v '^AICC_OWNER_\|^AICC_EA_LAUNCH' "$FIX/owner-facts.production.live.env" > "$OFF"; chmod 600 "$OFF"
CMP="$(R --compare --out "$LIVEF" 2>&1)"; crc=$?
t_eq "THE TRAP: facts without the five P35 facts compared with the live file: DIFFERENT (exit 4) and names exactly the five as 'removed' (never re-render in that state)" "$crc/$(printf '%s' "$CMP" | sed -n 's/^  removed: //p' | tr -d ',')" "4/AICC_EA_LAUNCH_OFFER_MODE AICC_OWNER_DASHBOARD_USER_IDS AICC_OWNER_METRICS_BASE AICC_OWNER_METRICS_TOKEN_FILE AICC_OWNER_OPS_SNAPSHOT_FILE"
t_not_contains "...no VALUE appears in the --compare output (token file path, user ids)" "$CMP" "owner-metrics.token"
t_not_contains "...nor a secret" "$CMP" "$BREVOKEY"
t_eq "...and the live file is STILL untouched after the DIFFERENT run" "$(shasum -a 256 "$LIVEF" | cut -d' ' -f1)" "$H0"
facts_from "$FIX/owner-facts.production.p41-activation.env"; ts_on
CMP="$(R --compare --out "$LIVEF" 2>&1)"; crc=$?
t_eq "the ACTIVATION facts compared with the live file: DIFFERENT (exit 4); 'added' = the nine activation constants, 'removed' = none" "$crc/$(printf '%s' "$CMP" | sed -n 's/^  removed: //p')" "4/-"
t_eq "...(the added names)" "$(sorted "$(printf '%s' "$CMP" | sed -n 's/^  added  : //p' | tr -d ',')")" "$(sorted "$ACTC")"
t_eq "...(the changed name: only WP_ACCESSIBLE_HOSTS)" "$(printf '%s' "$CMP" | sed -n 's/^  changed: //p')" "WP_ACCESSIBLE_HOSTS"
t_eq "...the live file is still untouched" "$(shasum -a 256 "$LIVEF" | cut -d' ' -f1)" "$H0"

echo "== R. the Control Plane's readiness rules refuse an incomplete activation (nothing is written) =="
facts_from "$FIX/owner-facts.production.p41-activation.env"; brevo_on; ts_on; R >/dev/null 2>&1; KEEP="$(shasum -a 256 "$OUT" | cut -d' ' -f1)"
refuses() { local n="$1" needle="$2"; shift 2; local o rc=0; o="$(R "$@" 2>&1)" || rc=$?; if [ "$rc" != 0 ] && printf '%s' "$o" | grep -q "$needle" && [ "$(shasum -a 256 "$OUT" | cut -d' ' -f1)" = "$KEEP" ]; then t_pass "$n"; else t_bad "$n" "rc=$rc; $(printf '%s' "$o" | tail -2 | tr '\n' '|')"; fi; }
ts_off;    refuses "the signup switch without the Turnstile secret FILE is refused (blocker 'turnstile')" "Turnstile"; ts_on
brevo_off; refuses "the signup switch without a working mail transport (no Brevo key, no smtp.env) is refused (blocker 'mail')" "mail"; brevo_on
grep -v '^AICC_NOTIFY_ENABLED' "$FIX/owner-facts.production.p41-activation.env" > "$OFF"; chmod 600 "$OFF"
refuses "the signup switch without the notification switch is refused" "AICC_NOTIFY_ENABLED"
grep -v '^AICC_TURNSTILE_ENABLED' "$FIX/owner-facts.production.p41-activation.env" > "$OFF"; chmod 600 "$OFF"
refuses "the signup switch without AICC_TURNSTILE_ENABLED (outbound host for siteverify) is refused (blocker 'turnstile_blocked')" "AICC_TURNSTILE_ENABLED"
grep -v '^AICC_TRIAL_SELF_SERVICE_CAP' "$FIX/owner-facts.production.p41-activation.env" > "$OFF"; chmod 600 "$OFF"
refuses "the signup switch without a cap is refused (mode would read 'off')" "cap"
facts_from "$FIX/owner-facts.production.p41-activation.env"; sed -i.bak 's/^AICC_TRIAL_SELF_SERVICE_CAP=25/AICC_TRIAL_SELF_SERVICE_CAP=30/' "$OFF"; rm -f "$OFF.bak"
refuses "a cap that is not an approved stage (25/50/100) is refused" "25"
facts_from "$FIX/owner-facts.production.p41-activation.env"; brevo_on; ts_on
t_ok "(control) the complete activation set renders again" R
t_summary
