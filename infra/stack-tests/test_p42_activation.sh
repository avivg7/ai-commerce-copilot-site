#!/usr/bin/env bash
# P42 R: the ACTIVATION RENDER, verified against the production state the coordinator read on 2026-11-19 (read-only; this suite reads no host). SYNTHETIC owner-facts fixtures only (infra/stack-tests/fixtures/).
# LIVE state encoded: AICC_MAIL_PROVIDER=brevo_api + sender/reply-to + budget 240, AICC_LEGAL_SUPPORT_EMAIL=support@copilt.org, the five hand-appended P35 constants (pinned as facts),
# AICC_LM_TRUSTED_PROXIES = an EMPTY array (template, not a fact), WP_ACCESSIBLE_HOSTS = api.copilt.org,api.brevo.com. NOT set live: notify, the Turnstile site key and secret file, the trial switch and cap,
# milestone scheduling, the owner-ops section, AICC_LEGAL_REVIEW_APPROVED.
#   L  the live render (p42-live) equals its golden; the values the coordinator listed are exactly what the render holds
#   S1 ONE owner-facts update (Turnstile enabled + site key + the secret FILE, notify, milestone scheduling, owner-ops) renders EXACTLY the intended constants: +5 names, none removed, every live value and the five P35 constants kept,
#      WP_ACCESSIBLE_HOSTS extended with challenges.cloudflare.com and NOTHING else; the signup switch and cap stay absent (public signup stays closed)
#   SL the LEGAL step (after counsel approved): AICC_LEGAL_REVIEW_APPROVED=true is the only addition (the Control Plane blocker `legal_review`; it also removes the "Being finalized" banners)
#   S2 at the very end the cap 25 (integer) and the switch (boolean true) are the only additions; the render REFUSES them unless the legal approval is already in the facts
#   C  --compare at each step names exactly those constants (never a value) and writes nothing
#   R  refusals: the signup switch without notify / the Turnstile site key / the secret FILE / AICC_TURNSTILE_ENABLED / a cap; a cap outside 25, 50, 100; a Turnstile SECRET as a fact; the site key pasted as the secret
# Regenerate the goldens deliberately: AICC_UPDATE_GOLDEN=1 bash infra/stack-tests/test_p42_activation.sh   (review the diff!)
# Run: bash infra/stack-tests/test_p42_activation.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; INFRA="$REPO/infra"; PROV="$INFRA/provision"; FIX="$HERE/fixtures"
T_SUITE="p42-activation"; . "$HERE/lib/t.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ap42a.XXXX")"; trap 'rm -rf "$TMP"' EXIT
for tool in php python3 jq; do command -v "$tool" >/dev/null 2>&1 || { echo "need $tool"; exit 2; }; done
SEC="$TMP/sec"; REL="$TMP/rel"; MAILD="$TMP/mail"; ABS="$TMP/abs"; OUT="$TMP/prod.php"; OFF="$TMP/owner-facts.env"
mkdir -p "$SEC" "$REL" "$MAILD" "$ABS"; chmod 700 "$SEC"; chmod 750 "$REL" "$MAILD"; echo '<?php' > "$ABS/wp-settings.php"
HEX="$(printf 'ab12%.0s' $(seq 16))"; OFU="$(id -un):$(id -gn)"
printf 'golden_db_pass_0001\n' > "$SEC/db-cp.pass"
{ for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT; do printf '%s=SALTVALUE_%s\n' "$k" "$k"; done; printf 'AICC_ACTIVATION_PROOF_SECRET=%s\nAICC_ENTITLEMENT_WEBHOOK_SECRET=%s\n' "$HEX" "$HEX"; } > "$SEC/wp-secrets.env"; chmod 600 "$SEC/wp-secrets.env"
printf 'WEBHOOK-test-0123456789-0123456789-abcdef\n' > "$SEC/entitlement-webhook.secret"; printf 'PROOF-test-0123456789-0123456789-abcdefgh\n' > "$SEC/activation-proof.secret"; chmod 600 "$SEC/"*.secret
R() { env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --env production --confirm-production --out "${OUTF:-$OUT}" --secrets-dir "$SEC" --mail-dir "$MAILD" --plugin-release-dir "$REL" --owner-facts-file "$OFF" --owner "$OFU" "$@"; }
T() { env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production "$@"; }
hexnorm() { sed -E 's/[0-9a-f]{64}/HEX64/g' "$1"; }
cst() { local f="$1"; shift; php -r 'define("ABSPATH",$argv[2]); require $argv[1]; $o=array(); foreach (array_slice($argv,3) as $n) { $o[$n]=defined($n)?constant($n):null; } echo json_encode($o);' "$f" "$ABS/" "$@"; }
defnames() { sed -n "s/^define( '\([A-Za-z0-9_]*\)'.*/\1/p" "$1" | sort; }
deflines() { grep -E "^define\( '" "$1" | sort; }
sorted() { printf '%s\n' $1 | sort | tr '\n' ' '; }
facts_from() { cp "$1" "$OFF"; chmod 600 "$OFF"; }
BREVOKEY='xkeysib-TEST-NOT-A-REAL-KEY-0000'; TSSECRET='0x4AAAAAAATSsecretVALUE0123456789abcdef'
brevo_on() { printf '%s\n' "$BREVOKEY" > "$MAILD/brevo-api.key"; chmod 640 "$MAILD/brevo-api.key"; }
ts_on() { printf '%s\n' "$TSSECRET" > "$MAILD/turnstile.secret"; chmod 640 "$MAILD/turnstile.secret"; }
ts_off() { rm -f "$MAILD/turnstile.secret"; }
GOLD_LIVE="$HERE/golden/wp-config.production.p42-live.php"; GOLD_S1="$HERE/golden/wp-config.production.p42-stage1.php"; GOLD_SL="$HERE/golden/wp-config.production.p42-stage-legal.php"; GOLD_S2="$HERE/golden/wp-config.production.p42-stage2.php"
FIVE="AICC_EA_LAUNCH_OFFER_MODE AICC_OWNER_DASHBOARD_USER_IDS AICC_OWNER_METRICS_BASE AICC_OWNER_METRICS_TOKEN_FILE AICC_OWNER_OPS_SNAPSHOT_FILE"
S1C="AICC_MILESTONE_SYNC_SCHEDULED AICC_NOTIFY_ENABLED AICC_OWNER_OPS_SECTION_ENABLED AICC_TURNSTILE_SECRET_FILE AICC_TURNSTILE_SITE_KEY"
S2C="AICC_TRIAL_SELF_SERVICE_CAP AICC_TRIAL_SELF_SERVICE_ENABLED"
SLC="AICC_LEGAL_REVIEW_APPROVED"
TRIALC="AICC_TRIAL_SELF_SERVICE_ENABLED AICC_TRIAL_SELF_SERVICE_CAP AICC_TRIAL_TURNSTILE AICC_MAIL_MAX_PER_HOUR AICC_MAIL_MAX_PER_DAY AICC_NOTIFY_EXCLUDED_CUSTOMERS AICC_FUNNEL_COUNTERS_ENABLED AICC_PLAN_CHANGE_ENABLED AICC_PAY_RECONCILE_ENABLED AICC_PRIVACY_REQUESTS_ENABLED AICC_LEGAL_REVIEW_APPROVED AICC_COMMERCE_OPEN"

echo "== L. the LIVE render (2026-11-19 facts) =="
brevo_on; ts_off; facts_from "$FIX/owner-facts.production.p42-live.env"
t_ok "the p42-live fixture renders (a safe Brevo key file in place, no Turnstile secret file)" R
t_ok "...php -l clean" php -l "$OUT"
if [ "${AICC_UPDATE_GOLDEN:-0}" = 1 ]; then hexnorm "$OUT" > "$GOLD_LIVE"; echo "golden regenerated: $GOLD_LIVE"; fi
t_ok "...and it equals golden/wp-config.production.p42-live.php byte for byte (64-hex values normalised)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD_LIVE'"
LV="$(cst "$OUT" AICC_MAIL_PROVIDER AICC_MAIL_FROM_ADDRESS AICC_MAIL_REPLY_TO AICC_MAIL_DAILY_BUDGET AICC_LEGAL_SUPPORT_EMAIL AICC_LM_TRUSTED_PROXIES WP_HTTP_BLOCK_EXTERNAL WP_ACCESSIBLE_HOSTS AICC_MAIL_ENABLED $TRIALC)"
t_eq "the constants the coordinator read are what the render holds: provider, sender, reply-to, budget 240 (integer), support e-mail" "$(echo "$LV" | jq -c '[.AICC_MAIL_PROVIDER,.AICC_MAIL_FROM_ADDRESS,.AICC_MAIL_REPLY_TO,.AICC_MAIL_DAILY_BUDGET,.AICC_LEGAL_SUPPORT_EMAIL]')" '["brevo_api","notifications@copilt.org","support@copilt.org",240,"support@copilt.org"]'
t_eq "...AICC_LM_TRUSTED_PROXIES is an EMPTY array (Caddy hands PHP the real client address; a trusted-proxy list would only open a path to trust a client-supplied header)" "$(echo "$LV" | jq -c '.AICC_LM_TRUSTED_PROXIES')" "[]"
t_eq "...WP_HTTP_BLOCK_EXTERNAL true; WP_ACCESSIBLE_HOSTS = api.copilt.org,api.brevo.com (challenges.cloudflare.com is NOT allowed: the genuine turnstile_blocked blocker)" "$(echo "$LV" | jq -c '[.WP_HTTP_BLOCK_EXTERNAL,.WP_ACCESSIBLE_HOSTS]')" '[true,"api.copilt.org,api.brevo.com"]'
t_eq "...none of the NOT-set-live constants is defined (notify, Turnstile, trial switch/cap, milestone, owner-ops, legal approval, commerce)" "$(cst "$OUT" AICC_NOTIFY_ENABLED AICC_TURNSTILE_SITE_KEY AICC_TURNSTILE_SECRET_FILE AICC_MILESTONE_SYNC_SCHEDULED AICC_OWNER_OPS_SECTION_ENABLED $TRIALC | jq -c '[.[]|select(.!=null)]|length')" "0"
t_eq "...the five P35 constants are present" "$(sorted "$(for n in $FIVE; do grep -q "^define( '$n'" "$OUT" && echo $n; done | tr '\n' ' ')")" "$(sorted "$FIVE")"
cp "$OUT" "$TMP/live.php"

echo "== S1. ONE owner-facts update: Turnstile (enabled + site key + secret FILE), notify, milestone scheduling, owner-ops =="
ts_on; facts_from "$FIX/owner-facts.production.p42-stage1.env"
t_ok "stage 1 renders (Turnstile secret FILE and Brevo key FILE in place)" R
t_ok "...php -l clean" php -l "$OUT"
if [ "${AICC_UPDATE_GOLDEN:-0}" = 1 ]; then hexnorm "$OUT" > "$GOLD_S1"; echo "golden regenerated: $GOLD_S1"; fi
t_ok "...equals golden/wp-config.production.p42-stage1.php byte for byte" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD_S1'"
t_eq "relative to the live render it ADDS exactly five constants (site key, secret FILE path, notify, milestone scheduling, owner-ops section)" "$(sorted "$(comm -13 <(defnames "$TMP/live.php") <(defnames "$OUT") | tr '\n' ' ')")" "$(sorted "$S1C")"
t_eq "...removes NONE" "$(comm -23 <(defnames "$TMP/live.php") <(defnames "$OUT") | wc -l | tr -d ' ')" "0"
t_eq "...and the only live define whose value changes is WP_ACCESSIBLE_HOSTS" "$(comm -23 <(deflines "$TMP/live.php") <(deflines "$OUT") | sed -n "s/^define( '\([A-Z_]*\)'.*/\1/p" | tr '\n' ' ')" "WP_ACCESSIBLE_HOSTS "
python3 - "$TMP/live.php" "$OUT" > "$TMP/hosts.txt" <<'PY'
import re, sys
def hosts(p):
    m = re.search(r"define\( 'WP_ACCESSIBLE_HOSTS', '([^']*)' \);", open(p).read()); return set(m.group(1).split(","))
a, b = hosts(sys.argv[1]), hosts(sys.argv[2])
print(",".join(sorted(b - a)) + "|" + ",".join(sorted(a - b)))
PY
t_eq "...WP_ACCESSIBLE_HOSTS gains challenges.cloudflare.com and NOTHING else (no wildcard, no other host; nothing lost)" "$(cat "$TMP/hosts.txt")" "challenges.cloudflare.com|"
SV="$(cst "$OUT" AICC_TURNSTILE_SITE_KEY AICC_TURNSTILE_SECRET_FILE AICC_NOTIFY_ENABLED AICC_MILESTONE_SYNC_SCHEDULED AICC_OWNER_OPS_SECTION_ENABLED $TRIALC AICC_MAIL_PROVIDER AICC_LM_TRUSTED_PROXIES)"
t_eq "...the switches are the exact boolean true; the site key is the public value; the secret is a FILE path" "$(echo "$SV" | jq -c '[.AICC_NOTIFY_ENABLED,.AICC_MILESTONE_SYNC_SCHEDULED,.AICC_OWNER_OPS_SECTION_ENABLED,.AICC_TURNSTILE_SITE_KEY,.AICC_TURNSTILE_SECRET_FILE]')" '[true,true,true,"0x4AAAAAAApubLICsitekey01","/etc/aicc-mail/turnstile.secret"]'
t_eq "...the signup switch, the cap and every other trial/commerce/legal-approval constant stay ABSENT (public signup is still closed)" "$(echo "$SV" | jq -c --argjson n "$(echo "$TRIALC" | tr ' ' '\n' | jq -R . | jq -sc .)" '[. as $o | $n[] | select($o[.] != null)]')" "[]"
t_eq "...Brevo and the empty trusted-proxy array are unchanged" "$(echo "$SV" | jq -c '[.AICC_MAIL_PROVIDER,.AICC_LM_TRUSTED_PROXIES]')" '["brevo_api",[]]'
t_eq "...the five P35 constants keep their live lines byte for byte" "$(for n in $FIVE; do diff <(grep "^define( '$n'" "$TMP/live.php") <(grep "^define( '$n'" "$OUT") >/dev/null && echo same; done | wc -l | tr -d ' ')" "5"
t_not_contains "...no secret in the render (the Turnstile secret, the Brevo key)" "$(cat "$OUT")" "$TSSECRET"
t_not_contains "...nor the Brevo key" "$(cat "$OUT")" "$BREVOKEY"
cp "$OUT" "$TMP/s1.php"

echo "== SL. the LEGAL step: AICC_LEGAL_REVIEW_APPROVED=true, only after counsel approved and the documents were re-published =="
facts_from "$FIX/owner-facts.production.p42-stage-legal.env"
t_ok "the legal stage renders" R
t_ok "...php -l clean" php -l "$OUT"
if [ "${AICC_UPDATE_GOLDEN:-0}" = 1 ]; then hexnorm "$OUT" > "$GOLD_SL"; echo "golden regenerated: $GOLD_SL"; fi
t_ok "...equals golden/wp-config.production.p42-stage-legal.php byte for byte" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD_SL'"
t_eq "relative to stage 1 it ADDS exactly AICC_LEGAL_REVIEW_APPROVED, removes none, changes none" "$(sorted "$(comm -13 <(defnames "$TMP/s1.php") <(defnames "$OUT") | tr '\n' ' ')")/$(comm -23 <(deflines "$TMP/s1.php") <(deflines "$OUT") | wc -l | tr -d ' ')" "$(sorted "$SLC")/0"
t_eq "...it is the boolean true (the Control Plane reads === true: 'true', 1 and 'yes' do not count) and the signup switch and cap are STILL absent" "$(cst "$OUT" AICC_LEGAL_REVIEW_APPROVED AICC_TRIAL_SELF_SERVICE_ENABLED AICC_TRIAL_SELF_SERVICE_CAP | jq -c '[.AICC_LEGAL_REVIEW_APPROVED,.AICC_TRIAL_SELF_SERVICE_ENABLED,.AICC_TRIAL_SELF_SERVICE_CAP]')" "[true,null,null]"
t_rc "AICC_LEGAL_REVIEW_APPROVED accepts only the value true (false is refused: leave it unset)" 1 T set AICC_LEGAL_REVIEW_APPROVED false
t_rc "...'yes' and '1' are refused too" 1 T set AICC_LEGAL_REVIEW_APPROVED yes
cp "$OUT" "$TMP/sl.php"

echo "== S2. at the very end: the cap 25 and the signup switch =="
facts_from "$FIX/owner-facts.production.p42-stage2.env"
t_ok "stage 2 renders" R
t_ok "...php -l clean" php -l "$OUT"
if [ "${AICC_UPDATE_GOLDEN:-0}" = 1 ]; then hexnorm "$OUT" > "$GOLD_S2"; echo "golden regenerated: $GOLD_S2"; fi
t_ok "...equals golden/wp-config.production.p42-stage2.php byte for byte" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD_S2'"
t_eq "relative to the legal stage it ADDS exactly the cap and the switch, removes none, changes none" "$(sorted "$(comm -13 <(defnames "$TMP/sl.php") <(defnames "$OUT") | tr '\n' ' ')")/$(comm -23 <(deflines "$TMP/sl.php") <(deflines "$OUT") | wc -l | tr -d ' ')" "$(sorted "$S2C")/0"
t_eq "...the cap is the INTEGER 25 and the switch the boolean true (the Control Plane reads === true and is_int)" "$(cst "$OUT" AICC_TRIAL_SELF_SERVICE_CAP AICC_TRIAL_SELF_SERVICE_ENABLED | jq -c '[.AICC_TRIAL_SELF_SERVICE_CAP,.AICC_TRIAL_SELF_SERVICE_ENABLED]')" "[25,true]"
t_eq "...AICC_TRIAL_TURNSTILE (the bypass) and AICC_COMMERCE_OPEN stay absent" "$(cst "$OUT" AICC_TRIAL_TURNSTILE AICC_COMMERCE_OPEN | jq -c '[.[]|select(.!=null)]|length')" "0"
t_eq "...the total set of constants versus live is exactly eight (5 + legal + 2) and the hosts list only grew by challenges.cloudflare.com" "$(sorted "$(comm -13 <(defnames "$TMP/live.php") <(defnames "$OUT") | tr '\n' ' ')")" "$(sorted "$S1C $SLC $S2C")"

echo "== C. --compare at each step: names only, nothing written =="
facts_from "$FIX/owner-facts.production.p42-stage1.env"; H0="$(shasum -a 256 "$TMP/live.php" | cut -d' ' -f1)"; cp "$TMP/live.php" "$TMP/live-file.php"; chmod 640 "$TMP/live-file.php"
CMP="$(R --compare --out "$TMP/live-file.php" 2>&1)"; crc=$?
t_eq "stage 1 facts vs the LIVE file: DIFFERENT (exit 4)" "$crc" "4"
t_eq "...added = exactly the five" "$(sorted "$(printf '%s' "$CMP" | sed -n 's/^  added  : //p' | tr -d ',')")" "$(sorted "$S1C")"
t_eq "...removed none, changed only WP_ACCESSIBLE_HOSTS" "$(printf '%s' "$CMP" | sed -n 's/^  removed: //p')/$(printf '%s' "$CMP" | sed -n 's/^  changed: //p')" "-/WP_ACCESSIBLE_HOSTS"
t_not_contains "...no value is printed" "$CMP" "0x4AAAAAAApubLICsitekey01"
t_eq "...the live file is untouched" "$(shasum -a 256 "$TMP/live-file.php" | cut -d' ' -f1)" "$H0"
cp "$TMP/s1.php" "$TMP/s1-file.php"; chmod 640 "$TMP/s1-file.php"
CMP="$(R --compare --out "$TMP/s1-file.php" 2>&1)"; crc=$?
t_eq "stage 1 facts vs the stage-1 file: IDENTICAL (exit 0) (the state right after the render and the reload)" "$crc" "0"
facts_from "$FIX/owner-facts.production.p42-stage-legal.env"
CMP="$(R --compare --out "$TMP/s1-file.php" 2>&1)"; crc=$?
t_eq "legal-stage facts vs the stage-1 file: DIFFERENT; added = AICC_LEGAL_REVIEW_APPROVED only; removed -; changed -" "$crc/$(sorted "$(printf '%s' "$CMP" | sed -n 's/^  added  : //p' | tr -d ',')")/$(printf '%s' "$CMP" | sed -n 's/^  removed: //p')/$(printf '%s' "$CMP" | sed -n 's/^  changed: //p')" "4/$(sorted "$SLC")/-/-"
cp "$TMP/sl.php" "$TMP/sl-file.php"; chmod 640 "$TMP/sl-file.php"
facts_from "$FIX/owner-facts.production.p42-stage2.env"
CMP="$(R --compare --out "$TMP/sl-file.php" 2>&1)"; crc=$?
t_eq "stage 2 facts vs the legal-stage file: DIFFERENT; added = the cap and the switch; removed -; changed -" "$crc/$(sorted "$(printf '%s' "$CMP" | sed -n 's/^  added  : //p' | tr -d ',')")/$(printf '%s' "$CMP" | sed -n 's/^  removed: //p')/$(printf '%s' "$CMP" | sed -n 's/^  changed: //p')" "4/$(sorted "$S2C")/-/-"
grep -v '^AICC_OWNER_METRICS\|^AICC_OWNER_DASHBOARD\|^AICC_OWNER_OPS_SNAPSHOT\|^AICC_EA_LAUNCH' "$FIX/owner-facts.production.p42-stage1.env" > "$OFF"; chmod 600 "$OFF"
CMP="$(R --compare --out "$TMP/s1-file.php" 2>&1)"; crc=$?
t_eq "THE TRAP: the stage-1 facts WITHOUT the five P35 facts vs the live-shaped file: exit 4 and 'removed' names exactly the five" "$crc/$(sorted "$(printf '%s' "$CMP" | sed -n 's/^  removed: //p' | tr -d ',')")" "4/$(sorted "$FIVE")"

echo "== R. refusals: the Control Plane's own readiness rules (nothing is written) =="
ts_on; facts_from "$FIX/owner-facts.production.p42-stage2.env"; R >/dev/null 2>&1; KEEP="$(shasum -a 256 "$OUT" | cut -d' ' -f1)"
refuses() { local n="$1" needle="$2"; shift 2; local o rc=0; o="$(R "$@" 2>&1)" || rc=$?; if [ "$rc" != 0 ] && printf '%s' "$o" | grep -qi -- "$needle" && [ "$(shasum -a 256 "$OUT" | cut -d' ' -f1)" = "$KEEP" ]; then t_pass "$n"; else t_bad "$n" "rc=$rc; $(printf '%s' "$o" | tail -2 | tr '\n' '|')"; fi; }
drop() { grep -v "^$1=" "$FIX/owner-facts.production.p42-stage2.env" > "$OFF"; chmod 600 "$OFF"; }
drop AICC_LEGAL_REVIEW_APPROVED; refuses "the signup switch + cap WITHOUT AICC_LEGAL_REVIEW_APPROVED=true is refused (P42: the Control Plane blocker legal_review; counsel approval and re-published documents first)" "AICC_LEGAL_REVIEW_APPROVED"
drop AICC_NOTIFY_ENABLED;        refuses "the signup switch WITHOUT AICC_NOTIFY_ENABLED is refused" "AICC_NOTIFY_ENABLED"
drop AICC_TURNSTILE_SITE_KEY;    refuses "the signup switch WITHOUT the Turnstile site key is refused" "AICC_TURNSTILE_SITE_KEY"
drop AICC_TURNSTILE_ENABLED;     refuses "the signup switch WITHOUT AICC_TURNSTILE_ENABLED (the outbound host) is refused" "AICC_TURNSTILE_ENABLED"
drop AICC_TRIAL_SELF_SERVICE_CAP; refuses "the signup switch WITHOUT a cap is refused" "cap"
facts_from "$FIX/owner-facts.production.p42-stage2.env"; ts_off; refuses "the signup switch WITHOUT the Turnstile secret FILE is refused" "secret file"; ts_on
for bad in 30 24 26 0 -1 250 100.5 abc ""; do
  t_rc "a cap of '$bad' is refused at set time" 1 T set AICC_TRIAL_SELF_SERVICE_CAP "$bad"
done
for good in 25 50 100; do t_rc "a cap of $good is accepted" 0 T set AICC_TRIAL_SELF_SERVICE_CAP "$good"; done
facts_from "$FIX/owner-facts.production.p42-stage2.env"; sed -i.bak 's/^AICC_TRIAL_SELF_SERVICE_CAP=25/AICC_TRIAL_SELF_SERVICE_CAP=30/' "$OFF"; rm -f "$OFF.bak"
refuses "a HAND-EDITED cap of 30 in the facts file is refused by the renderer" "25, 50 or 100"
t_rc "the secret can NOT be an owner fact (AICC_TURNSTILE_SECRET is not a key)" 1 T set AICC_TURNSTILE_SECRET "$TSSECRET"
t_rc "...nor can the secret FILE PATH (AICC_TURNSTILE_SECRET_FILE is rendered from the verified file, never from a fact)" 1 T set AICC_TURNSTILE_SECRET_FILE /etc/aicc-mail/turnstile.secret
t_rc "...nor the Turnstile bypass AICC_TRIAL_TURNSTILE" 1 T set AICC_TRIAL_TURNSTILE off
t_rc "...nor a trusted-proxy list (AICC_LM_TRUSTED_PROXIES is not a fact: the empty array is right behind Caddy)" 1 T set AICC_LM_TRUSTED_PROXIES 127.0.0.1
printf '%s\n' "$TSSECRET" > "$MAILD/turnstile.secret"; chmod 640 "$MAILD/turnstile.secret"
facts_from "$FIX/owner-facts.production.p42-stage2.env"; sed -i.bak "s/^AICC_TURNSTILE_SITE_KEY=.*/AICC_TURNSTILE_SITE_KEY=$TSSECRET/" "$OFF"; rm -f "$OFF.bak"
refuses "the SECRET pasted as the site key is refused by the renderer (it equals the secret file's first line)" "equals the Turnstile secret"
t_not_contains "...and the refusal never prints the secret" "$(R 2>&1 || true)" "$TSSECRET"
printf '%s\n' "$TSSECRET" > "$MAILD/turnstile.secret"; chmod 600 "$MAILD/turnstile.secret"; facts_from "$FIX/owner-facts.production.p42-stage2.env"
refuses "a Turnstile secret file with mode 0600 (PHP could not read it) is refused" "0640"
chmod 640 "$MAILD/turnstile.secret"
t_ok "(control) the complete stage-2 set renders again" R

echo "== RV. review fixes: the facts tool refuses a change that would BREAK the render rules; Cloudflare's PUBLIC TEST keys are never accepted =="
ts_on
refused_change() { # <name> <text the refusal must contain> <owner-facts args...>; the facts file must be byte-identical afterwards
  local n="$1" want="$2"; shift 2; local b a o rc=0
  b="$(shasum -a 256 "$OFF" | cut -d' ' -f1)"; o="$(T "$@" 2>&1 </dev/null)" || rc=$?; a="$(shasum -a 256 "$OFF" | cut -d' ' -f1)"
  if [ "$rc" = 1 ] && [ "$a" = "$b" ] && printf '%s' "$o" | grep -qF -- "$want"; then t_pass "$n"; else t_bad "$n" "rc=$rc unchanged=$([ "$a" = "$b" ] && echo yes || echo NO) out=$(printf '%s' "$o" | tail -2 | tr '\n' '|' | cut -c1-240)"; fi
}
for k in AICC_LEGAL_REVIEW_APPROVED AICC_NOTIFY_ENABLED AICC_TURNSTILE_SITE_KEY AICC_TURNSTILE_ENABLED AICC_TRIAL_SELF_SERVICE_CAP; do
  facts_from "$FIX/owner-facts.production.p42-stage2.env"
  refused_change "unset $k while the signup switch is set is REFUSED (nothing written)" "would break the render rules" unset "$k"
done
facts_from "$FIX/owner-facts.production.p42-stage1.env"
refused_change "set AICC_TRIAL_SELF_SERVICE_ENABLED without cap and legal approval is REFUSED (set)" "AICC_LEGAL_REVIEW_APPROVED" set AICC_TRIAL_SELF_SERVICE_ENABLED true
b="$(shasum -a 256 "$OFF" | cut -d' ' -f1)"; o="$(printf 'true\n' | T set-stdin AICC_TRIAL_SELF_SERVICE_ENABLED 2>&1)"; rc=$?
t_eq "...and set-stdin is REFUSED the same way, nothing written" "$rc/$([ "$(shasum -a 256 "$OFF" | cut -d' ' -f1)" = "$b" ] && echo same)/$(printf '%s' "$o" | grep -c 'REFUSED')" "1/same/1"
facts_from "$FIX/owner-facts.production.p42-stage-legal.env"
refused_change "the switch before the cap is REFUSED even with the legal approval set" "AICC_TRIAL_SELF_SERVICE_CAP" set AICC_TRIAL_SELF_SERVICE_ENABLED true
t_rc "the ladder works: the cap first (accepted)" 0 T set AICC_TRIAL_SELF_SERVICE_CAP 25
t_rc "...then the switch (accepted: every prerequisite is already in the facts)" 0 T set AICC_TRIAL_SELF_SERVICE_ENABLED true
t_ok "...and the file equals the stage-2 fixture (as a set)" bash -c "diff <(grep -v '^#' '$OFF' | sort) <(grep -v '^#' '$FIX/owner-facts.production.p42-stage2.env' | sort)"
t_rc "backing out in the right order works: the switch first" 0 T unset AICC_TRIAL_SELF_SERVICE_ENABLED
t_rc "...then the cap" 0 T unset AICC_TRIAL_SELF_SERVICE_CAP
t_rc "...then the legal approval" 0 T unset AICC_LEGAL_REVIEW_APPROVED
t_rc "...then the site key (a facts change never needs the host state)" 0 T unset AICC_TURNSTILE_SITE_KEY
facts_from "$FIX/owner-facts.production.p42-stage2.env"; sed -i.bak '/^AICC_NOTIFY_ENABLED=/d' "$OFF"; rm -f "$OFF.bak"
t_rc "a file that is ALREADY inconsistent can still be REPAIRED (a change that adds no new problem is allowed): the switch is removed" 0 T unset AICC_TRIAL_SELF_SERVICE_ENABLED
# Cloudflare's published dummy credentials (always-pass / always-block / forced-interaction) must never be installable for production
for dk in 1x00000000000000000000AA 2x00000000000000000000AB 3x00000000000000000000FF 1x00000000000000000000BB; do
  facts_from "$FIX/owner-facts.production.p42-stage1.env"
  refused_change "the Cloudflare TEST site key $dk is REFUSED at set time" "Cloudflare test credentials are for tests only: create a real widget" set AICC_TURNSTILE_SITE_KEY "$dk"
done
facts_from "$FIX/owner-facts.production.p42-stage1.env"
t_rc "a real-shaped site key (0x4AAAAAAA...) is accepted" 0 T set AICC_TURNSTILE_SITE_KEY 0x4AAAAAAAbCdEfGhIjKlMnO
t_rc "...and so is a real site key that merely CONTAINS x0 later in the string" 0 T set AICC_TURNSTILE_SITE_KEY 0x4AAAAAAAx0x0x0x0x0x0
facts_from "$FIX/owner-facts.production.p42-stage1.env"; sed -i.bak "s/^AICC_TURNSTILE_SITE_KEY=.*/AICC_TURNSTILE_SITE_KEY=1x00000000000000000000AA/" "$OFF"; rm -f "$OFF.bak"; KEEP="$(shasum -a 256 "$OUT" | cut -d' ' -f1)"
refuses "a HAND-EDITED test site key in the facts file is refused by the renderer" "Cloudflare test credentials"
facts_from "$FIX/owner-facts.production.p42-stage1.env"
for ds in 1x0000000000000000000000000000000AA 2x0000000000000000000000000000000AA 3x0000000000000000000000000000000AA; do
  printf '%s\n' "$ds" > "$MAILD/turnstile.secret"; chmod 640 "$MAILD/turnstile.secret"
  refuses "a secret FILE holding the Cloudflare test secret $ds is refused by the renderer" "Cloudflare test credentials"
done
ts_on
t_ok "(control) with the real-shaped secret file the stage-1 set renders" R
t_summary
