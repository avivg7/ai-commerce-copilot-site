#!/usr/bin/env bash
# Tests of the P37 self-service region of the PRODUCTION wp-config renderer (infra/provision/render-wp-config.sh + lib/owner_facts.py + the template's P37 region).
# Everything renders into a scratch directory: no host, no network, no Docker, no server. Needs bash, python3, php (php -l and constant evaluation) and jq, like test_provision.sh.
#   A  DEFAULT: no P37 fact and no Turnstile secret file renders the golden (pre-P37) file byte for byte; nothing P37 is defined; stage is untouched
#   B  EACH TOGGLE renders exactly the expected line(s) (diff against the default render, comments filtered), with the exact PHP types the Control Plane reads
#   C  REFUSALS: an inconsistent set, a bad value, an unsafe secret file; each leaves the previous file untouched and names the problem
#   D  IDEMPOTENT: a re-render is "unchanged"; removing a fact or the file returns to the default
#   E  NO SECRET can be rendered: the Turnstile secret and the SMTP credentials appear in no output, no log line, no facts file and no rendered file
#   F  ACTIVATION ORDER: the documented sequence (docs/cutover/p37-self-service-wp-config.md) is accepted step by step, and the wrong order is refused
# Run: bash infra/stack-tests/test_p37_wpconfig.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; INFRA="$REPO/infra"; PROV="$INFRA/provision"
T_SUITE="p37-wpconfig"; . "$HERE/lib/t.sh"
mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ap37.XXXX")"; trap 'rm -rf "$TMP"' EXIT
for tool in php python3 jq; do command -v "$tool" >/dev/null 2>&1 || { echo "need $tool"; exit 2; }; done

SEC="$TMP/sec"; REL="$TMP/rel"; MAILD="$TMP/mail"; ABS="$TMP/abs"; OUT="$TMP/prod.php"; OFF="$TMP/owner-facts.env"; NOMAIL="$TMP/nomail"
mkdir -p "$SEC" "$REL" "$MAILD" "$ABS"; chmod 700 "$SEC"; chmod 750 "$REL" "$MAILD"; echo '<?php' > "$ABS/wp-settings.php"
HEX="$(printf 'ab12%.0s' $(seq 16))"; OFU="$(id -un):$(id -gn)"
printf 'golden_db_pass_0001\n' > "$SEC/db-cp.pass"
{ for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT; do printf '%s=SALTVALUE_%s\n' "$k" "$k"; done; printf 'AICC_ACTIVATION_PROOF_SECRET=%s\nAICC_ENTITLEMENT_WEBHOOK_SECRET=%s\n' "$HEX" "$HEX"; } > "$SEC/wp-secrets.env"; chmod 600 "$SEC/wp-secrets.env"
printf 'WEBHOOK-test-0123456789-0123456789-abcdef\n' > "$SEC/entitlement-webhook.secret"; printf 'PROOF-test-0123456789-0123456789-abcdefgh\n' > "$SEC/activation-proof.secret"; chmod 600 "$SEC/"*.secret

R() { env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --env production --confirm-production --out "$OUT" --secrets-dir "$SEC" --mail-dir "${MD:-$NOMAIL}" --plugin-release-dir "$REL" --owner-facts-file "$OFF" --owner "$OFU" "$@"; }
RS() { env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --out "$TMP/stage.php" --secrets-dir "$SEC" --plugin-release-dir "$REL" --owner-facts-file "$OFF" --owner "$OFU" "$@"; }
T() { env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production "$@"; }
TS_() { env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env stage "$@"; }
hexnorm() { sed -E 's/[0-9a-f]{64}/HEX64/g' "$1"; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
GOLD="$HERE/golden/wp-config.production.no-owner-facts.php"; GOLDS="$HERE/golden/wp-config.stage.no-owner-facts.php"
# the define() lines the current render adds relative to a baseline render (comments are filtered: only behaviour is compared)
added() { diff <(hexnorm "$1") <(hexnorm "$2") | sed -n 's/^> //p' | grep -v '^//' | grep -v '^$'; }
removed() { diff <(hexnorm "$1") <(hexnorm "$2") | sed -n 's/^< //p'; }
cst() { local f="$1"; shift; php -r 'define("ABSPATH",$argv[2]); require $argv[1]; $o=array(); foreach (array_slice($argv,3) as $n) { $o[$n]=defined($n)?constant($n):null; } echo json_encode($o);' "$f" "$ABS/" "$@"; }
reset_facts() { rm -f "$OFF"; }
mail_on() { MD="$MAILD"; printf 'AICC_MAIL_SMTP_USER=%s\nAICC_MAIL_SMTP_PASS=%s\n' "brevo-login@example.org" "xsmtpsib-0123456789abcdefABCDEF0123456789" > "$MAILD/smtp.env"; chmod 640 "$MAILD/smtp.env"; }
mail_off() { rm -f "$MAILD/smtp.env"; MD="$NOMAIL"; }
TSSECRET='0x4AAAAAAATSsecretVALUE0123456789abcdef'; SITEKEY='0x4AAAAAAApubLICsitekey01'
ts_file() { printf '%s\n' "${1:-$TSSECRET}" > "$MAILD/turnstile.secret"; chmod "${2:-640}" "$MAILD/turnstile.secret"; }
ts_off() { rm -f "$MAILD/turnstile.secret"; }
P37K="AICC_TRIAL_SELF_SERVICE_ENABLED AICC_TRIAL_SELF_SERVICE_CAP AICC_TURNSTILE_SITE_KEY AICC_TURNSTILE_SECRET_FILE AICC_NOTIFY_ENABLED AICC_NOTIFY_EXCLUDED_CUSTOMERS AICC_MAIL_MAX_PER_HOUR AICC_MAIL_MAX_PER_DAY AICC_FUNNEL_COUNTERS_ENABLED AICC_FUNNEL_ALLOWED_ORIGINS AICC_OWNER_OPS_SECTION_ENABLED AICC_MILESTONE_SYNC_SCHEDULED AICC_PLAN_CHANGE_ENABLED AICC_PAY_RECONCILE_ENABLED AICC_PRIVACY_REQUESTS_ENABLED"
mail_off; reset_facts; ts_off

echo "== A. DEFAULT: no P37 fact, no secret file =="
t_ok "default production render succeeds" R
t_ok "the default render is the pre-P37 golden file BYTE FOR BYTE (64-hex values normalised)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
t_eq "...it carries no P37 region marker, banner, placeholder or comment" "$(grep -c 'P37\|@@' "$OUT" || true)" "0"
t_ok "...php -l clean" php -l "$OUT"
DEF="$(cst "$OUT" $P37K)"
t_eq "...none of the 15 P37 constants is defined (every switch OFF, no cap, no key, no secret file)" "$(echo "$DEF" | jq -c '[.[]|select(.!=null)]|length')" "0"
printf '# comment only\n\n' > "$OFF"; chmod 600 "$OFF"; t_ok "an EMPTY (comment-only) facts file renders" R
t_ok "...and it is the golden again" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
rm -f "$OFF"
t_ok "stage render succeeds" RS
t_ok "...and is the stage golden byte for byte (the stage template has no P37 region)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$TMP/stage.php') '$GOLDS'"
t_eq "the template carries the region exactly once (begin, placeholder, end)" "$(grep -c '@@P37_BEGIN@@' "$PROV/wp-config.production.template.php")/$(grep -c '^@@P37_SELF_SERVICE@@$' "$PROV/wp-config.production.template.php")/$(grep -c '@@P37_END@@' "$PROV/wp-config.production.template.php")" "1/1/1"
t_eq "the stage template has no P37 region" "$(grep -c 'P37' "$PROV/wp-config.stage.template.php" || true)" "0"
t_eq "the template defines NO P37 constant in code (comments only)" "$(sed -e 's#/\*.*\*/##' "$PROV/wp-config.production.template.php" | grep -v '^[[:space:]]*\(//\|\*\)' | grep -c "AICC_TRIAL_\|AICC_NOTIFY_\|AICC_TURNSTILE_\|AICC_FUNNEL_\|AICC_OWNER_OPS\|AICC_MILESTONE\|AICC_PLAN_CHANGE\|AICC_PAY_RECONCILE\|AICC_PRIVACY_REQ\|AICC_MAIL_MAX" || true)" "0"
BASE_NOMAIL_SHA="$(sha "$OUT")"; R >/dev/null 2>&1; BASE_PLAIN="$TMP/base-plain.php"; cp "$OUT" "$BASE_PLAIN"
t_eq "production keys list all 14 P37 facts" "$(T keys | grep -cxE 'AICC_TRIAL_SELF_SERVICE_ENABLED|AICC_TRIAL_SELF_SERVICE_CAP|AICC_TURNSTILE_SITE_KEY|AICC_NOTIFY_ENABLED|AICC_NOTIFY_EXCLUDED_CUSTOMERS|AICC_MAIL_MAX_PER_HOUR|AICC_MAIL_MAX_PER_DAY|AICC_FUNNEL_COUNTERS_ENABLED|AICC_FUNNEL_ALLOWED_ORIGINS|AICC_OWNER_OPS_SECTION_ENABLED|AICC_MILESTONE_SYNC_SCHEDULED|AICC_PLAN_CHANGE_ENABLED|AICC_PAY_RECONCILE_ENABLED|AICC_PRIVACY_REQUESTS_ENABLED')" "14"
t_eq "stage keys list none of them" "$(TS_ keys | grep -c 'TRIAL_SELF\|NOTIFY\|MAIL_MAX\|FUNNEL\|OWNER_OPS\|MILESTONE\|PLAN_CHANGE\|PAY_RECONCILE\|PRIVACY_REQ\|SITE_KEY' || true)" "0"

echo "== B. EACH TOGGLE renders exactly its expected line(s) =="
# standalone switches (no prerequisite): the diff against the default render is EXACTLY the one define, plus comments
for pair in "AICC_OWNER_OPS_SECTION_ENABLED" "AICC_MILESTONE_SYNC_SCHEDULED" "AICC_PLAN_CHANGE_ENABLED" "AICC_PRIVACY_REQUESTS_ENABLED" "AICC_FUNNEL_COUNTERS_ENABLED"; do
  reset_facts; T set "$pair" true >/dev/null; t_ok "$pair=true renders" R
  t_eq "...the ONLY added code line is define( '$pair', true )" "$(added "$BASE_PLAIN" "$OUT")" "define( '$pair', true );"
  t_eq "...nothing was removed from the default render but the markers' absence (no removed line)" "$(removed "$BASE_PLAIN" "$OUT" | wc -l | tr -d ' ')" "0"
  t_eq "...PHP reads it as the boolean true" "$(cst "$OUT" "$pair" | jq -c ".$pair")" "true"
  t_ok "...php -l clean" php -l "$OUT"
  T unset "$pair" >/dev/null; R >/dev/null 2>&1; t_ok "...unset + re-render is the default again" bash -c "diff '$OUT' '$BASE_PLAIN'"
done
reset_facts; T set AICC_NOTIFY_EXCLUDED_CUSTOMERS "2, 7" >/dev/null; R >/dev/null 2>&1
t_eq "AICC_NOTIFY_EXCLUDED_CUSTOMERS '2, 7' renders as the normalised string (notify may stay OFF: the exclusion is a safe first step)" "$(added "$BASE_PLAIN" "$OUT")" "define( 'AICC_NOTIFY_EXCLUDED_CUSTOMERS', '2,7' );"
reset_facts; T set AICC_FUNNEL_COUNTERS_ENABLED true >/dev/null; T set AICC_FUNNEL_ALLOWED_ORIGINS "https://copilt.org, HTTPS://Www.Example.com:8443" >/dev/null; R >/dev/null 2>&1
t_eq "funnel counters + origins render both lines (origins normalised to lower case, exact origins)" "$(added "$BASE_PLAIN" "$OUT" | tr '\n' ' ')" "define( 'AICC_FUNNEL_COUNTERS_ENABLED', true ); define( 'AICC_FUNNEL_ALLOWED_ORIGINS', 'https://copilt.org,https://www.example.com:8443' ); "
reset_facts; T set AICC_LM_PAYMENT_EVIDENCE_PROVIDER payplus >/dev/null; T set AICC_LM_PAID_GATEWAYS payplus-gateway >/dev/null; R >/dev/null 2>&1; GW_BASE="$TMP/gw-base.php"; cp "$OUT" "$GW_BASE"
T set AICC_PAY_RECONCILE_ENABLED true >/dev/null; R >/dev/null 2>&1
t_eq "AICC_PAY_RECONCILE_ENABLED=true (with a configured payment path) renders exactly its one line" "$(added "$GW_BASE" "$OUT")" "define( 'AICC_PAY_RECONCILE_ENABLED', true );"
# with the mail layer on
mail_on; reset_facts; R >/dev/null 2>&1; MAIL_BASE="$TMP/mail-base.php"; cp "$OUT" "$MAIL_BASE"
t_eq "(mail layer on, no P37 fact: the render differs from the default by exactly the 8 existing AICC_MAIL_ lines)" "$(added "$BASE_PLAIN" "$MAIL_BASE" | grep -c "^define( 'AICC_MAIL_")" "8"
T set AICC_NOTIFY_ENABLED true >/dev/null; R >/dev/null 2>&1
t_eq "AICC_NOTIFY_ENABLED=true (mail on) renders exactly its one line" "$(added "$MAIL_BASE" "$OUT")" "define( 'AICC_NOTIFY_ENABLED', true );"
t_eq "...PHP reads the boolean true" "$(cst "$OUT" AICC_NOTIFY_ENABLED | jq -c .AICC_NOTIFY_ENABLED)" "true"
reset_facts; T set AICC_MAIL_MAX_PER_HOUR 180 >/dev/null; R >/dev/null 2>&1
t_eq "AICC_MAIL_MAX_PER_HOUR 180 renders as an INTEGER literal" "$(added "$MAIL_BASE" "$OUT")" "define( 'AICC_MAIL_MAX_PER_HOUR', 180 );"
T set AICC_MAIL_MAX_PER_DAY 300 >/dev/null; R >/dev/null 2>&1
t_eq "...with the day cap both lines, in a fixed order" "$(added "$MAIL_BASE" "$OUT" | tr '\n' ' ')" "define( 'AICC_MAIL_MAX_PER_HOUR', 180 ); define( 'AICC_MAIL_MAX_PER_DAY', 300 ); "
t_eq "...PHP reads two integers" "$(cst "$OUT" AICC_MAIL_MAX_PER_HOUR AICC_MAIL_MAX_PER_DAY | jq -c '[.AICC_MAIL_MAX_PER_HOUR,.AICC_MAIL_MAX_PER_DAY]')" "[180,300]"
# Turnstile: key + secret file
reset_facts; ts_file; T set AICC_TURNSTILE_SITE_KEY "$SITEKEY" >/dev/null; R >/dev/null 2>&1
t_eq "a valid secret file + the site key render the key and the FILE PATH constant" "$(added "$MAIL_BASE" "$OUT" | tr '\n' ' ')" "define( 'AICC_TURNSTILE_SITE_KEY', '$SITEKEY' ); define( 'AICC_TURNSTILE_SECRET_FILE', '/etc/aicc-mail/turnstile.secret' ); "
t_eq "...PHP reads them as strings" "$(cst "$OUT" AICC_TURNSTILE_SITE_KEY AICC_TURNSTILE_SECRET_FILE | jq -c '[.AICC_TURNSTILE_SITE_KEY,.AICC_TURNSTILE_SECRET_FILE]')" "[\"$SITEKEY\",\"/etc/aicc-mail/turnstile.secret\"]"
reset_facts; R >/dev/null 2>&1
t_eq "the secret file alone (no site key fact) renders only the FILE PATH constant" "$(added "$MAIL_BASE" "$OUT")" "define( 'AICC_TURNSTILE_SECRET_FILE', '/etc/aicc-mail/turnstile.secret' );"
ts_off; mail_off
# the full self-service set
mail_on; ts_file; reset_facts
for kv in "AICC_NOTIFY_ENABLED true" "AICC_TURNSTILE_ENABLED true" "AICC_TURNSTILE_SITE_KEY $SITEKEY" "AICC_TRIAL_SELF_SERVICE_CAP 25" "AICC_LEGAL_REVIEW_APPROVED true" "AICC_TRIAL_SELF_SERVICE_ENABLED true"; do T set $kv >/dev/null; done
t_ok "the full self-service set (switch, cap 25, key, secret file, turnstile host, notify, mail) renders" R
FULL="$TMP/full.php"; cp "$OUT" "$FULL"
t_eq "...the added code lines are EXACTLY the legal approval the switch now requires (P42) and the five self-service constants, in the fixed order" "$(added "$MAIL_BASE" "$FULL" | grep -v WP_ACCESSIBLE | tr '\n' ' ')" "define( 'AICC_LEGAL_REVIEW_APPROVED', true ); define( 'AICC_TRIAL_SELF_SERVICE_ENABLED', true ); define( 'AICC_TRIAL_SELF_SERVICE_CAP', 25 ); define( 'AICC_TURNSTILE_SITE_KEY', '$SITEKEY' ); define( 'AICC_NOTIFY_ENABLED', true ); define( 'AICC_TURNSTILE_SECRET_FILE', '/etc/aicc-mail/turnstile.secret' ); "
t_eq "...plus the Turnstile host on the outbound allow-list (the existing AICC_TURNSTILE_ENABLED machinery)" "$(grep -c "define( 'WP_ACCESSIBLE_HOSTS', 'api.copilt.org,challenges.cloudflare.com' );" "$FULL")" "1"
CF="$(cst "$FULL" AICC_TRIAL_SELF_SERVICE_ENABLED AICC_TRIAL_SELF_SERVICE_CAP AICC_NOTIFY_ENABLED AICC_MAIL_ENABLED)"
t_eq "...PHP: switch === true, cap === 25 (an integer: a string reads as 0), notify === true, mail enabled === true" "$(echo "$CF" | jq -c '[.AICC_TRIAL_SELF_SERVICE_ENABLED,.AICC_TRIAL_SELF_SERVICE_CAP,.AICC_NOTIFY_ENABLED,.AICC_MAIL_ENABLED]')" "[true,25,true,true]"
t_eq "...the region is delimited: its begin banner and end banner each appear once" "$(grep -c '^// ---- P37 self-service (Trial signup' "$FULL")/$(grep -c '^// ---- end P37 self-service ----$' "$FULL")" "1/1"
t_eq "...no marker or placeholder is left" "$(grep -c '@@' "$FULL" || true)" "0"
t_ok "...php -l clean" php -l "$FULL"
for cap in 50 100; do T set AICC_TRIAL_SELF_SERVICE_CAP "$cap" >/dev/null; R >/dev/null 2>&1; t_eq "cap $cap renders as the integer $cap" "$(cst "$OUT" AICC_TRIAL_SELF_SERVICE_CAP | jq -c .AICC_TRIAL_SELF_SERVICE_CAP)" "$cap"; done
# the whole optional set on top
for kv in "AICC_NOTIFY_EXCLUDED_CUSTOMERS 2" "AICC_MAIL_MAX_PER_HOUR 180" "AICC_MAIL_MAX_PER_DAY 300" "AICC_FUNNEL_COUNTERS_ENABLED true" "AICC_FUNNEL_ALLOWED_ORIGINS https://copilt.org" "AICC_OWNER_OPS_SECTION_ENABLED true" "AICC_MILESTONE_SYNC_SCHEDULED true" "AICC_PLAN_CHANGE_ENABLED true" "AICC_PRIVACY_REQUESTS_ENABLED true" "AICC_LM_PAYMENT_EVIDENCE_PROVIDER payplus" "AICC_LM_PAID_GATEWAYS payplus-gateway" "AICC_PAY_RECONCILE_ENABLED true"; do T set $kv >/dev/null; done
t_ok "every P37 fact at once renders" R
ALLP="$(cst "$OUT" $P37K)"
t_eq "...PHP: all 15 P37 constants are defined" "$(echo "$ALLP" | jq -c '[.[]|select(.!=null)]|length')" "15"
t_eq "...the booleans are booleans" "$(echo "$ALLP" | jq -c '[.AICC_TRIAL_SELF_SERVICE_ENABLED,.AICC_NOTIFY_ENABLED,.AICC_FUNNEL_COUNTERS_ENABLED,.AICC_OWNER_OPS_SECTION_ENABLED,.AICC_MILESTONE_SYNC_SCHEDULED,.AICC_PLAN_CHANGE_ENABLED,.AICC_PRIVACY_REQUESTS_ENABLED]|unique')" "[true]"
t_eq "...the integers are integers" "$(echo "$ALLP" | jq -c '[.AICC_TRIAL_SELF_SERVICE_CAP,.AICC_MAIL_MAX_PER_HOUR,.AICC_MAIL_MAX_PER_DAY]|map(type)|unique')" '["number"]'
t_eq "...the P37 region defines exactly the expected names and nothing else (no AICC_TRIAL_TURNSTILE, no test-delivery hatch, no dashboard user list)" "$(grep -o "^define( 'AICC_[A-Z_]*'" "$OUT" | sed "s/define( '//;s/'//" | grep -E 'TRIAL|NOTIFY|TURNSTILE|MAIL_MAX|FUNNEL|OWNER_OPS|MILESTONE|PLAN_CHANGE|PAY_RECON|PRIVACY|DASHBOARD' | sort | tr '\n' ' ')" "AICC_FUNNEL_ALLOWED_ORIGINS AICC_FUNNEL_COUNTERS_ENABLED AICC_MAIL_MAX_PER_DAY AICC_MAIL_MAX_PER_HOUR AICC_MILESTONE_SYNC_SCHEDULED AICC_NOTIFY_ENABLED AICC_NOTIFY_EXCLUDED_CUSTOMERS AICC_OWNER_OPS_SECTION_ENABLED AICC_PAY_RECONCILE_ENABLED AICC_PLAN_CHANGE_ENABLED AICC_PRIVACY_REQUESTS_ENABLED AICC_TRIAL_SELF_SERVICE_CAP AICC_TRIAL_SELF_SERVICE_ENABLED AICC_TURNSTILE_SECRET_FILE AICC_TURNSTILE_SITE_KEY "
t_eq "...WP_ACCESSIBLE_HOSTS is the API host plus ONLY the Turnstile host" "$(echo "$(cst "$OUT" WP_ACCESSIBLE_HOSTS | jq -r .WP_ACCESSIBLE_HOSTS)")" "api.copilt.org,challenges.cloudflare.com"
STAGE_ONLY="$TMP/stage-facts.env"; for k in $(echo "AICC_TRIAL_SELF_SERVICE_ENABLED AICC_NOTIFY_ENABLED AICC_TURNSTILE_SITE_KEY AICC_MAIL_MAX_PER_HOUR AICC_FUNNEL_COUNTERS_ENABLED AICC_PLAN_CHANGE_ENABLED"); do
  t_rc "stage refuses the P37 fact $k" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$STAGE_ONLY" --env stage set "$k" true
done
t_ok "...and wrote no stage facts file" test ! -e "$STAGE_ONLY"
mail_off; ts_off; reset_facts

echo "== C. REFUSALS: inconsistent sets, bad values, unsafe secret file (nothing is written; the previous file stays) =="
R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
refused() { # refused <name> <expected-text-in-message>   (the facts/secret files are already prepared)
  local n="$1" want="$2" out rc=0; out="$(R 2>&1)" || rc=$?
  if [ "$rc" = 1 ] && printf '%s' "$out" | grep -qF -- "$want" && [ "$(sha "$OUT")" = "$KEEP" ]; then t_pass "$n"; else t_bad "$n" "rc=$rc want 1 + '$want' + file untouched ($( [ "$(sha "$OUT")" = "$KEEP" ] && echo untouched || echo CHANGED)): $(printf '%s' "$out" | tail -2 | cut -c1-260)"; fi
}
facts() { reset_facts; for kv in "$@"; do T set $kv >/dev/null 2>&1 || true; done; }
# P42 review: the facts TOOL now refuses an edit that breaks the signup-switch rules (see test_p42_activation.sh, section RV), so these tests build the inconsistent files the way a HAND EDIT or an older tool would: by editing the file itself. The renderer must still refuse them.
hand_unset() { grep -v "^$1=" "$OFF" > "$OFF.n"; mv "$OFF.n" "$OFF"; chmod 600 "$OFF"; }
hand_set() { printf '%s=%s\n' "$1" "$2" >> "$OFF"; chmod 600 "$OFF"; }
full_set() { mail_on; ts_file; facts "AICC_NOTIFY_ENABLED true" "AICC_TURNSTILE_ENABLED true" "AICC_TURNSTILE_SITE_KEY $SITEKEY" "AICC_TRIAL_SELF_SERVICE_CAP 25" "AICC_LEGAL_REVIEW_APPROVED true" "AICC_TRIAL_SELF_SERVICE_ENABLED true"; }
full_set; t_ok "(the complete set is accepted: baseline of the refusal tests)" R; R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
# one prerequisite removed at a time from a complete set
full_set; hand_unset AICC_TRIAL_SELF_SERVICE_CAP; refused "self-service ON without a cap is REFUSED" "needs AICC_TRIAL_SELF_SERVICE_CAP"
full_set; hand_unset AICC_TURNSTILE_SITE_KEY; refused "self-service ON without the Turnstile site key is REFUSED" "needs AICC_TURNSTILE_SITE_KEY"
full_set; hand_unset AICC_TURNSTILE_ENABLED; refused "self-service ON without AICC_TURNSTILE_ENABLED (the outbound host) is REFUSED" "AICC_TURNSTILE_ENABLED=true"
full_set; hand_unset AICC_NOTIFY_ENABLED; refused "self-service ON with the notify switch OFF (campaign mail expected) is REFUSED" "needs AICC_NOTIFY_ENABLED=true"
full_set; ts_off; refused "self-service ON without the Turnstile SECRET FILE is REFUSED" "Turnstile secret file"
full_set; mail_off; refused "self-service ON without the mail layer (no safe smtp.env) is REFUSED" "needs the mail layer"
full_set; refused_all="$(hand_unset AICC_TRIAL_SELF_SERVICE_CAP; hand_unset AICC_NOTIFY_ENABLED; R 2>&1 || true)"
t_contains "a file with several problems names them all in one refusal (cap and notify)" "$refused_all" "needs AICC_TRIAL_SELF_SERVICE_CAP"
t_contains "...(second problem)" "$refused_all" "needs AICC_NOTIFY_ENABLED=true"
full_set; T unset AICC_TRIAL_SELF_SERVICE_ENABLED >/dev/null; R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
# notify / key / caps without their layer
mail_off; ts_off; facts "AICC_NOTIFY_ENABLED true"; refused "the notify switch without mail is REFUSED" "AICC_NOTIFY_ENABLED needs the mail layer"
mail_off; ts_off; facts "AICC_MAIL_MAX_PER_HOUR 100"; refused "a mail cap without the mail layer is REFUSED" "mail layer is not enabled"
mail_on; ts_off; facts "AICC_TURNSTILE_SITE_KEY $SITEKEY"; refused "a Turnstile site key without the secret file is REFUSED" "no Turnstile secret file"
mail_on; ts_off; facts "AICC_MAIL_MAX_PER_HOUR 400" "AICC_MAIL_MAX_PER_DAY 300"; refused "an hourly mail cap above the daily cap is REFUSED" "is above AICC_MAIL_MAX_PER_DAY"
mail_off; facts "AICC_FUNNEL_ALLOWED_ORIGINS https://copilt.org"; refused "funnel origins without the funnel switch are REFUSED" "AICC_FUNNEL_COUNTERS_ENABLED is not"
mail_off; facts "AICC_PAY_RECONCILE_ENABLED true"; refused "the payment reconcile without a configured payment path is REFUSED" "needs a configured payment path"
facts "AICC_NOTIFY_ENABLED true"; t_ok "(a notify switch with no mail layer passes the fact-only \`check\`: the host state is the renderer's to judge, and the renderer refused it above)" env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production check
reset_facts; hand_set AICC_TRIAL_SELF_SERVICE_ENABLED true; t_rc "...whereas a self-service switch without its facts is refused by the fact-only \`check\` too" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production check
t_rc "...and the renderer's dry-run refuses it as well (no write, no surprise at the real render)" 1 R --dry-run
# bad values, refused when set
mail_off; reset_facts
for bad in 0 24 26 30 75 101 200 025 25.0 " 0x19" "-25" "all" "true" "twenty-five" "250"; do
  t_rc "cap '$bad' (not exactly 25, 50 or 100) is REFUSED at set time" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production set AICC_TRIAL_SELF_SERVICE_CAP "$bad"
done
t_contains "...the refusal names the approved stages" "$(env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production set AICC_TRIAL_SELF_SERVICE_CAP 30 2>&1)" "25, 50 or 100"
for k in AICC_TRIAL_SELF_SERVICE_ENABLED AICC_NOTIFY_ENABLED AICC_FUNNEL_COUNTERS_ENABLED AICC_OWNER_OPS_SECTION_ENABLED AICC_MILESTONE_SYNC_SCHEDULED AICC_PLAN_CHANGE_ENABLED AICC_PAY_RECONCILE_ENABLED AICC_PRIVACY_REQUESTS_ENABLED; do
  for bad in false 1 yes True TRUE ""; do t_rc "$k='$bad' is REFUSED (only the exact word true; to turn a switch off, unset it)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production set "$k" "$bad"; done
done
for bad in short "has space0123" "quote'key012345" 'back\slash0123' "<script>0000" "a@@b0123456789" "$(printf 'a%.0s' $(seq 65))"; do
  t_rc "site key '$bad' is REFUSED" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production set AICC_TURNSTILE_SITE_KEY "$bad"
done
for bad in 0 -1 1.5 abc 2001 100000 "1e3"; do t_rc "hourly mail cap '$bad' is REFUSED" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production set AICC_MAIL_MAX_PER_HOUR "$bad"; done
for bad in 0 20001 x; do t_rc "daily mail cap '$bad' is REFUSED" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production set AICC_MAIL_MAX_PER_DAY "$bad"; done
for bad in "http://copilt.org" "https://copilt.org/" "https://copilt.org/path" "https://*.copilt.org" "https://127.0.0.1" "https://localhost" "https://a.test" "copilt.org" "https://copilt.org:99999" "https://a.example.com,https://a.example.com" "https://x.example.com,"; do
  t_rc "funnel origin '$bad' is REFUSED" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production set AICC_FUNNEL_ALLOWED_ORIGINS "$bad"
done
for bad in 0 abc "2,2" "2,,3" "-3" "$(printf 'ab12%.0s' $(seq 16))" "1.5" "2 3"; do t_rc "excluded customer list '$bad' is REFUSED (positive user ids only; an address hash is personal data)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production set AICC_NOTIFY_EXCLUDED_CUSTOMERS "$bad"; done
t_ok "...and none of those refusals wrote a facts file" test ! -e "$OFF"
# a HAND-EDITED facts file is validated the same way (the renderer never trusts the file because the tool wrote it)
printf 'AICC_TRIAL_SELF_SERVICE_CAP=30\n' > "$OFF"; chmod 600 "$OFF"; refused "a hand-edited cap of 30 is REFUSED by the renderer" "25, 50 or 100"
printf 'AICC_TRIAL_SELF_SERVICE_ENABLED=yes\n' > "$OFF"; refused "a hand-edited switch 'yes' is REFUSED by the renderer" "exactly 'true'"
# secret file safety
mail_on; facts "AICC_TURNSTILE_SITE_KEY $SITEKEY"; ts_file; R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
for m in 600 644 660 664 666 400 604 620; do ts_file "$TSSECRET" "$m"; refused "a Turnstile secret file with mode 0$m is REFUSED" "must be mode 0640"; done
ts_file "$TSSECRET" 640; t_ok "(mode 0640 passes)" R; ts_file "$TSSECRET" 440; t_ok "(mode 0440 passes)" R; ts_file "$TSSECRET" 640; R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
rm -f "$MAILD/turnstile.secret"; printf '%s\n' "$TSSECRET" > "$MAILD/real-secret"; chmod 640 "$MAILD/real-secret"; ln -s "$MAILD/real-secret" "$MAILD/turnstile.secret"; refused "a symbolic link as the secret file is REFUSED" "not a regular file"
rm -f "$MAILD/turnstile.secret" "$MAILD/real-secret"; mkdir "$MAILD/turnstile.secret"; refused "a directory as the secret file is REFUSED" "not a regular file"; rmdir "$MAILD/turnstile.secret"
ts_file "short" 640; refused "a secret shorter than 8 bytes is REFUSED" "must be 8-1024 bytes"
ts_file "has a space inside" 640; refused "a secret whose first line has a space is REFUSED (the Control Plane would read it as no secret)" "first line must be the Turnstile secret"
printf '\n0x4AAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n' > "$MAILD/turnstile.secret"; chmod 640 "$MAILD/turnstile.secret"; refused "a secret whose FIRST line is empty is REFUSED" "first line must be the Turnstile secret"
head -c 1200 /dev/zero | tr '\0' 'x' > "$MAILD/turnstile.secret"; chmod 640 "$MAILD/turnstile.secret"; refused "a secret over 1024 bytes is REFUSED" "8-1024 bytes"
ts_file "$SITEKEY" 640; EQ_OUT="$(R 2>&1 || true)"; t_contains "the SECRET entered as the SITE KEY (identical value) is REFUSED" "$EQ_OUT" "equals the Turnstile secret"
t_not_contains "...and the refusal does not print the value" "$EQ_OUT" "$SITEKEY"
ts_file "$TSSECRET" 640; R >/dev/null 2>&1
printf '%s\n' "$SITEKEY" > "$TMP/eq-secret"; chmod 640 "$TMP/eq-secret"; t_rc "owner_facts check --context with a secret equal to the site key is refused" 1 python3 -I "$PROV/lib/owner_facts.py" check --file "$OFF" --env production --context --mail-ready --turnstile-secret-file "$TMP/eq-secret"
# without a P37 fact the secret file alone is still validated
reset_facts; ts_file "short" 640; refused "an invalid secret file is refused even with NO owner-facts file" "must be 8-1024 bytes"
ts_file "$TSSECRET" 666; refused "...and an unsafe-mode one too" "must be mode 0640"
ts_off; mail_off
# production only
t_rc "a stage render with a Turnstile secret file next to it does not render it (stage never carries the region)" 0 bash -c "mkdir -p '$TMP/stm' && printf '%s\n' '$TSSECRET' > '$TMP/stm/turnstile.secret' && chmod 640 '$TMP/stm/turnstile.secret' && env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --out '$TMP/stage2.php' --secrets-dir '$SEC' --mail-dir '$TMP/stm' --plugin-release-dir '$REL' --owner-facts-file '$TMP/none-facts' --owner '$OFU' >/dev/null 2>&1"
t_eq "...the stage render carries no P37 constant" "$(grep -c "AICC_TURNSTILE_SECRET_FILE\|AICC_TRIAL_" "$TMP/stage2.php" || true)" "0"

echo "== D. IDEMPOTENT re-render; removing a fact or the file returns to the default =="
full_set; R >/dev/null 2>&1; S1="$(sha "$OUT")"; M1="$(stat -c %Y "$OUT" 2>/dev/null || stat -f %m "$OUT")"
t_contains "a second render says unchanged" "$(R 2>&1)" "unchanged"
t_eq "...and the file is byte-identical" "$(sha "$OUT")" "$S1"
R >/dev/null 2>&1; R >/dev/null 2>&1; t_eq "...also after many renders" "$(sha "$OUT")" "$S1"
T unset AICC_TRIAL_SELF_SERVICE_ENABLED >/dev/null
R >/dev/null 2>&1; t_ok "unsetting the switch keeps the rest rendered (cap, key, notify, secret path) and the file changes" test "$(sha "$OUT")" != "$S1"
t_eq "...the switch constant is gone" "$(grep -c "^define( 'AICC_TRIAL_SELF_SERVICE_ENABLED'" "$OUT" || true)" "0"
t_eq "...the cap and the key stay (inert without the switch)" "$(grep -c "define( 'AICC_TRIAL_SELF_SERVICE_CAP', 25 );\|define( 'AICC_TURNSTILE_SITE_KEY'" "$OUT")" "2"
t_ok "...php -l clean" php -l "$OUT"
reset_facts; ts_off; mail_off; R >/dev/null 2>&1
t_ok "removing every fact and the secret file returns the DEFAULT render byte for byte (golden)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
# --force-salts changes only keys; the P37 lines survive a re-render with a new salt (a re-render never loses a fact)
full_set; R >/dev/null 2>&1; R --force-salts >/dev/null 2>&1
t_eq "a re-render with --force-salts keeps every P37 constant (facts are in the facts file, never in the config)" "$(grep -c "define( 'AICC_TRIAL_SELF_SERVICE_ENABLED', true );" "$OUT")/$(grep -c "^define( 'AICC_TURNSTILE_SECRET_FILE'" "$OUT")" "1/1"
# restore fixed salts for the byte comparisons below
{ for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT; do printf '%s=SALTVALUE_%s\n' "$k" "$k"; done; printf 'AICC_ACTIVATION_PROOF_SECRET=%s\nAICC_ENTITLEMENT_WEBHOOK_SECRET=%s\n' "$HEX" "$HEX"; } > "$SEC/wp-secrets.env"; chmod 600 "$SEC/wp-secrets.env"
t_ok "a dry-run changes nothing and prints no secret" bash -c "S0=\$(shasum '$OUT'); env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --dry-run --out '$OUT' --secrets-dir '$SEC' --mail-dir '$MAILD' --plugin-release-dir '$REL' --owner-facts-file '$OFF' --owner '$OFU' >/dev/null 2>&1; [ \"\$S0\" = \"\$(shasum '$OUT')\" ]"
t_contains "...and the dry-run says the Turnstile secret file is valid" "$(R --dry-run 2>&1)" "turnstile secret file valid"

echo "== E. NO SECRET can reach the rendered file, the logs or the facts =="
full_set; ts_file "$TSSECRET" 640
T set AICC_MAIL_MAX_PER_HOUR 180 >/dev/null; T set AICC_NOTIFY_EXCLUDED_CUSTOMERS 2 >/dev/null
LOGS="$(R 2>&1; R --dry-run 2>&1; T list 2>&1; T export 2>&1; T check 2>&1; T keys 2>&1)"
R >/dev/null 2>&1
SMTPPASS="xsmtpsib-0123456789abcdefABCDEF0123456789"
t_not_contains "the Turnstile secret is in no render/dry-run/list/export/check output" "$LOGS" "$TSSECRET"
t_not_contains "the SMTP password is in none of them either" "$LOGS" "$SMTPPASS"
t_eq "the Turnstile secret is NOT in the rendered wp-config.php" "$(grep -cF "$TSSECRET" "$OUT" || true)" "0"
t_eq "the SMTP password is NOT in the rendered wp-config.php" "$(grep -cF "$SMTPPASS" "$OUT" || true)" "0"
t_eq "...nor any fragment of the Turnstile secret (its tail)" "$(grep -c "secretVALUE0123456789abcdef" "$OUT" || true)" "0"
t_eq "the Turnstile secret is NOT in the owner-facts file" "$(grep -cF "$TSSECRET" "$OFF" || true)" "0"
t_eq "the rendered file carries the secret's PATH only" "$(grep -c "define( 'AICC_TURNSTILE_SECRET_FILE', '/etc/aicc-mail/turnstile.secret' );" "$OUT")" "1"
t_eq "...and no constant is named *_SECRET or *_PASS with a literal value other than the two shared secrets the production template always had" "$(grep -E "^define\( 'AICC_[A-Z_]*(SECRET|PASS|PASSWORD|TOKEN|API_KEY)[A-Z_]*', '" "$OUT" | grep -v "_FILE'" | sed -E "s/^define\( '([A-Z_]+)'.*/\1/" | sort | tr '\n' ' ')" "AICC_ACTIVATION_PROOF_SECRET AICC_ENTITLEMENT_WEBHOOK_SECRET "
t_eq "...(the only constant ending in _FILE defined by P37 holds a path under /etc/aicc-mail)" "$(grep -oE "define\( 'AICC_TURNSTILE_SECRET_FILE', '[^']*'" "$OUT" | sed -E "s/.*, '//;s/'//")" "/etc/aicc-mail/turnstile.secret"
# every validator refuses a value that looks like a secret where only a public value is allowed
for k in AICC_TRIAL_SELF_SERVICE_ENABLED AICC_NOTIFY_ENABLED AICC_FUNNEL_COUNTERS_ENABLED; do t_rc "$k refuses a secret-looking value" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set "$k" "$TSSECRET"; done
t_rc "the site key slot refuses the secret when it has a quote or space" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_TURNSTILE_SITE_KEY "$TSSECRET'; define('X',1);//"
t_rc "there is NO fact key for the secret itself (AICC_TURNSTILE_SECRET_FILE is not settable)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_TURNSTILE_SECRET_FILE /etc/passwd
t_rc "...nor the SMTP credentials" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_SMTP_PASS hunter2hunter2
t_rc "...nor the dev bootstrap, the test fixture, the turnstile bypass or the test-delivery hatch" 1 bash -c "for k in AICC_LM_ALLOW_DEV_SECRET_BOOTSTRAP AICC_LM_TEST_FIXTURE AICC_TRIAL_TURNSTILE AICC_NOTIFY_ALLOW_TEST_ACCOUNT_DELIVERY AICC_OWNER_DASHBOARD_USER_IDS; do env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$TMP/x.env' --env production set \$k true >/dev/null 2>&1 && exit 0; done; exit 1"
t_ok "...(and none of them is in the rendered file)" bash -c "! grep -q 'AICC_LM_ALLOW_DEV_SECRET_BOOTSTRAP\|AICC_LM_TEST_FIXTURE\|AICC_TRIAL_TURNSTILE\|AICC_NOTIFY_ALLOW_TEST\|AICC_OWNER_DASHBOARD' <(sed -e '/^\\/\\//d' '$OUT')"
t_eq "the renderer code never prints, writes or substitutes the secret (it is read only to compare it with the site key)" "$(cat "$PROV/lib/owner_facts.py" "$PROV/render-wp-config.sh" | grep -c 'print(sec\|write(sec\|replace([^)]*sec)\|echo "\$tsout\|cat "\$TSF"' || true)" "0"
mail_off; ts_off; reset_facts

echo "== F. ACTIVATION ORDER (docs/cutover/p37-self-service-wp-config.md): each documented step renders; the wrong order is refused =="
reset_facts; R >/dev/null 2>&1
t_ok "step 0: default render (nothing P37)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
mail_on;                                 t_ok "step 1: smtp.env placed, render: the existing mail region only" R
T set AICC_NOTIFY_EXCLUDED_CUSTOMERS 2 >/dev/null; t_ok "step 2: exclusion list first (owner's own test customer), render" R
T set AICC_MAIL_MAX_PER_HOUR 180 >/dev/null; T set AICC_MAIL_MAX_PER_DAY 300 >/dev/null; t_ok "step 3: mail caps matched to the relay plan, render" R
T set AICC_NOTIFY_ENABLED true >/dev/null; t_ok "step 4: notification switch (mail is ready), render" R
T set AICC_LEGAL_REVIEW_APPROVED true >/dev/null; T set AICC_TRIAL_SELF_SERVICE_CAP 25 >/dev/null
t_rc "step 5 TOO EARLY: the facts tool itself refuses the switch while its Turnstile prerequisites are missing (P42 review)" 1 T set AICC_TRIAL_SELF_SERVICE_ENABLED true
hand_set AICC_TRIAL_SELF_SERVICE_ENABLED true      # a hand-edited file: the RENDERER must still refuse it
KEEP="$(sha "$OUT")"; refused "step 5 TOO EARLY: switch + cap before Turnstile is REFUSED (no key, no host, no secret file)" "needs AICC_TURNSTILE_SITE_KEY"
T set AICC_TURNSTILE_ENABLED true >/dev/null; T set AICC_TURNSTILE_SITE_KEY "$SITEKEY" >/dev/null; refused "step 5 still too early: no secret file yet" "Turnstile secret file"
ts_file;                                   t_ok "step 5: Turnstile secret file placed, key + host facts set: the whole set renders" R
t_eq "...and the rendered file is the self-service-OPEN configuration" "$(cst "$OUT" AICC_TRIAL_SELF_SERVICE_ENABLED AICC_TRIAL_SELF_SERVICE_CAP | jq -c '[.AICC_TRIAL_SELF_SERVICE_ENABLED,.AICC_TRIAL_SELF_SERVICE_CAP]')" "[true,25]"
T set AICC_TRIAL_SELF_SERVICE_CAP 50 >/dev/null; t_ok "step 6: raising the cap to the next approved stage (one approval per stage) re-renders" R
T set AICC_OWNER_OPS_SECTION_ENABLED true >/dev/null; T set AICC_FUNNEL_COUNTERS_ENABLED true >/dev/null; T set AICC_MILESTONE_SYNC_SCHEDULED true >/dev/null; t_ok "step 7: dashboard section, funnel counters, milestone sync (any time after step 4)" R
T set AICC_PLAN_CHANGE_ENABLED true >/dev/null; T set AICC_PRIVACY_REQUESTS_ENABLED true >/dev/null; t_ok "step 8: plan change and privacy requests (owner decisions, independent)" R
# kill switch / rollback
T unset AICC_TRIAL_SELF_SERVICE_ENABLED >/dev/null; t_ok "rollback: unset the switch and re-render" R
t_eq "...the switch is gone, signup reads mode off" "$(cst "$OUT" AICC_TRIAL_SELF_SERVICE_ENABLED | jq -c .AICC_TRIAL_SELF_SERVICE_ENABLED)" "null"
T unset AICC_NOTIFY_ENABLED >/dev/null; t_ok "rollback: notify off with self-service already off is allowed" R
rm -f "$OFF"; ts_off; mail_off; reset_facts

t_summary
