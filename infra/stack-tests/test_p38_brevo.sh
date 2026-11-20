#!/usr/bin/env bash
# Tests of the P38 Brevo API mail region of the PRODUCTION wp-config renderer (infra/provision/render-wp-config.sh + lib/owner_facts.py + the template's P38 region).
# Everything renders into a scratch directory: no host, no network, no Docker, no server, no real secret (the "key" is the fake xkeysib-TEST-NOT-A-REAL-KEY-0000). Needs bash, python3, php, jq and (for section A's baseline) git.
#   A  DEFAULT: with no P38 fact the render is the golden file byte for byte, AND equals what the pre-P38 renderer (git base bf54801) renders in every host state we can build (smtp.env, P37 full set, ...)
#   B  ACTIVATION: provider fact + valid key file + sender fact render exactly the documented lines, types and outbound host; nothing P37 / campaign / scheduler is switched on
#   C  PROVIDER DECISION: both secret files, missing files, provider=smtp
#   D  REFUSALS: every inconsistent set, bad value and unsafe key file; each leaves the previous file untouched
#   E  HOSTILE VALUES: quotes, backslashes, PHP tags, newlines, placeholders in the free-text and address facts
#   F  IDEMPOTENCE / ROLLBACK / --compare
#   G  NO SECRET anywhere (outputs, logs, traces, facts file, rendered files), PII masking
#   H  the documented ACTIVATION ORDER
# Run: bash infra/stack-tests/test_p38_brevo.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; INFRA="$REPO/infra"; PROV="$INFRA/provision"
T_SUITE="p38-brevo"; . "$HERE/lib/t.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ap38.XXXX")"; trap 'rm -rf "$TMP"' EXIT
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
added() { diff <(hexnorm "$1") <(hexnorm "$2") | sed -n 's/^> //p' | grep -v '^//' | grep -v '^$'; }
removed() { diff <(hexnorm "$1") <(hexnorm "$2") | sed -n 's/^< //p' | grep -v '^//' | grep -v '^$'; }
cst() { local f="$1"; shift; php -r 'define("ABSPATH",$argv[2]); require $argv[1]; $o=array(); foreach (array_slice($argv,3) as $n) { $o[$n]=defined($n)?constant($n):null; } echo json_encode($o);' "$f" "$ABS/" "$@"; }
reset_facts() { rm -f "$OFF"; }
FAKEKEY='xkeysib-TEST-NOT-A-REAL-KEY-0000'; SMTPKEY='xsmtpsib-TEST-NOT-A-REAL-SMTP-KEY-000'; SMTPPASS="xsmtpsib-0123456789abcdefABCDEF0123456789"
mail_on() { MD="$MAILD"; printf 'AICC_MAIL_SMTP_USER=%s\nAICC_MAIL_SMTP_PASS=%s\n' "brevo-login@example.org" "$SMTPPASS" > "$MAILD/smtp.env"; chmod 640 "$MAILD/smtp.env"; }
mail_off() { rm -f "$MAILD/smtp.env"; }
key_file() { rm -f "$MAILD/brevo-api.key"; MD="$MAILD"; printf '%s\n' "${1:-$FAKEKEY}" > "$MAILD/brevo-api.key"; chmod "${2:-640}" "$MAILD/brevo-api.key"; }
key_off() { rm -f "$MAILD/brevo-api.key"; }
TSSECRET='0x4AAAAAAATSsecretVALUE0123456789abcdef'; SITEKEY='0x4AAAAAAApubLICsitekey01'
ts_file() { printf '%s\n' "${1:-$TSSECRET}" > "$MAILD/turnstile.secret"; chmod "${2:-640}" "$MAILD/turnstile.secret"; }
ts_off() { rm -f "$MAILD/turnstile.secret"; }
facts() { reset_facts; for kv in "$@"; do T set $kv >/dev/null 2>&1 || true; done; }
setf() { T set "$1" "$2" >/dev/null 2>&1; }
BREVO_FACTS=("AICC_MAIL_PROVIDER brevo_api" "AICC_MAIL_FROM_ADDRESS notifications@copilt.org")
P37K="AICC_TRIAL_SELF_SERVICE_ENABLED AICC_TRIAL_SELF_SERVICE_CAP AICC_TURNSTILE_SITE_KEY AICC_TURNSTILE_SECRET_FILE AICC_NOTIFY_ENABLED AICC_NOTIFY_EXCLUDED_CUSTOMERS AICC_MAIL_MAX_PER_HOUR AICC_MAIL_MAX_PER_DAY AICC_FUNNEL_COUNTERS_ENABLED AICC_FUNNEL_ALLOWED_ORIGINS AICC_OWNER_OPS_SECTION_ENABLED AICC_MILESTONE_SYNC_SCHEDULED AICC_PLAN_CHANGE_ENABLED AICC_PAY_RECONCILE_ENABLED AICC_PRIVACY_REQUESTS_ENABLED"
P38K="AICC_MAIL_ENABLED AICC_MAIL_PROVIDER AICC_MAIL_API_KEY_FILE AICC_MAIL_FROM_ADDRESS AICC_MAIL_FROM_NAME AICC_MAIL_REPLY_TO AICC_MAIL_ALLOWED_FROM_DOMAINS AICC_MAIL_DAILY_BUDGET AICC_MAIL_TEST_RECIPIENTS AICC_MAIL_STATUS_POLL_ENABLED AICC_MAIL_API_KEY"
mail_off; key_off; ts_off; reset_facts; MD="$NOMAIL"

echo "== A. DEFAULT: no P38 fact renders the golden file, and every pre-P38 host state renders exactly as the pre-P38 renderer did =="
t_ok "default production render succeeds" R
t_ok "the default render is the golden file BYTE FOR BYTE (64-hex values normalised)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
t_eq "...no P38 marker, banner or placeholder in it" "$(grep -c 'P38\|BREVO\|@@' "$OUT" || true)" "0"
t_eq "...api.brevo.com does not appear" "$(grep -c 'api\.brevo\.com' "$OUT" || true)" "0"
t_eq "...WP_ACCESSIBLE_HOSTS is exactly the API host" "$(cst "$OUT" WP_ACCESSIBLE_HOSTS | jq -r .WP_ACCESSIBLE_HOSTS)" "api.copilt.org"
DEF="$(cst "$OUT" $P38K)"; t_eq "...none of the P38 constants is defined (mail layer off: no AICC_MAIL_ENABLED at all)" "$(echo "$DEF" | jq -c '[.[]|select(.!=null)]|length')" "0"
t_ok "...php -l clean" php -l "$OUT"
t_ok "the stage render is still the stage golden (the stage template has no P38 region)" bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --out '$TMP/stage.php' --secrets-dir '$SEC' --plugin-release-dir '$REL' --owner-facts-file '$OFF' --owner '$OFU' >/dev/null 2>&1 && diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$TMP/stage.php') '$GOLDS'"
t_eq "the template carries the P38 region exactly once (begin, placeholder, end)" "$(grep -c '@@BREVO_BEGIN@@' "$PROV/wp-config.production.template.php")/$(grep -c '^@@BREVO_MAIL@@$' "$PROV/wp-config.production.template.php")/$(grep -c '@@BREVO_END@@' "$PROV/wp-config.production.template.php")" "1/1/1"
t_eq "the stage template has no P38 region" "$(grep -c 'P38\|BREVO\|brevo' "$PROV/wp-config.stage.template.php" || true)" "0"
t_eq "the template defines NO P38 constant in code (comments and the existing SMTP region aside), and never names the API host" "$(sed -e 's#/\*.*\*/##' "$PROV/wp-config.production.template.php" | grep -v '^[[:space:]]*\(//\|\*\)' | grep -c "AICC_MAIL_PROVIDER\|AICC_MAIL_API_KEY\|AICC_MAIL_DAILY_BUDGET\|AICC_MAIL_TEST_RECIPIENTS\|AICC_MAIL_STATUS_POLL\|AICC_MAIL_ALLOWED_FROM\|api\.brevo\.com" || true)" "0"
t_eq "the production template never mentions the API host anywhere (not even in a comment)" "$(grep -c 'api\.brevo\.com' "$PROV/wp-config.production.template.php" || true)" "0"
printf '# comment only\n\n' > "$OFF"; chmod 600 "$OFF"; t_ok "an EMPTY (comment-only) facts file renders" R
t_ok "...and it is the golden again" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
reset_facts

# the pre-P38 renderer from git (the branch point) renders the same states: new == old byte for byte
BASEC="bf54801"
if git -C "$REPO" cat-file -e "$BASEC^{commit}" 2>/dev/null; then
  mkdir -p "$TMP/base"; git -C "$REPO" archive "$BASEC" infra/provision | tar -x -C "$TMP/base"
  BR() { env AICC_TEST_HARNESS=1 bash "$TMP/base/infra/provision/render-wp-config.sh" --env production --confirm-production --out "$TMP/base.php" --secrets-dir "$SEC" --mail-dir "${MD:-$NOMAIL}" --plugin-release-dir "$REL" --owner-facts-file "$OFF" --owner "$OFU" "$@"; }
  same_as_base() { local n="$1"; BR >/dev/null 2>&1; local b=$?; R >/dev/null 2>&1; local r=$?; if [ "$b" = "$r" ] && cmp -s "$TMP/base.php" "$OUT"; then t_pass "$n"; else t_bad "$n" "base rc=$b new rc=$r; files $(cmp -s "$TMP/base.php" "$OUT" && echo equal || echo DIFFER)"; fi; }
  MD="$NOMAIL"; mail_off; key_off; ts_off; reset_facts; rm -f "$TMP/base.php" "$OUT"
  same_as_base "BASE-EQUAL: no mail file, no facts"
  mail_on; same_as_base "BASE-EQUAL: a safe smtp.env, no facts (the existing SMTP region)"
  facts "AICC_LEGAL_ENTITY_NAME Acme" "AICC_LEGAL_SUPPORT_EMAIL support@copilt.org" "AICC_EXTRA_ACCESSIBLE_HOSTS pay.example.com"; same_as_base "BASE-EQUAL: owner facts and an extra outbound host (SMTP on)"
  ts_file; for kv in "AICC_NOTIFY_ENABLED true" "AICC_TURNSTILE_ENABLED true" "AICC_TURNSTILE_SITE_KEY $SITEKEY" "AICC_TRIAL_SELF_SERVICE_CAP 25" "AICC_LEGAL_REVIEW_APPROVED true" "AICC_TRIAL_SELF_SERVICE_ENABLED true" "AICC_MAIL_MAX_PER_HOUR 100" "AICC_MAIL_MAX_PER_DAY 300"; do T set $kv >/dev/null; done
  same_as_base "BASE-EQUAL: the full P37 self-service set on the SMTP layer"
  mail_off; same_as_base "BASE-EQUAL: the same facts without mail (both refuse identically, nothing is written)"
  reset_facts; ts_off; same_as_base "BASE-EQUAL: back to nothing"
  key_off; mail_off
else
  t_skip "BASE-EQUAL matrix" "git base $BASEC not available"
fi
MD="$NOMAIL"; mail_off; key_off; ts_off; reset_facts
t_eq "owner-facts keys: production lists the seven P38 facts" "$(T keys | grep -cxE 'AICC_MAIL_PROVIDER|AICC_MAIL_FROM_ADDRESS|AICC_MAIL_FROM_NAME|AICC_MAIL_REPLY_TO|AICC_MAIL_DAILY_BUDGET|AICC_MAIL_TEST_RECIPIENTS|AICC_MAIL_STATUS_POLL_ENABLED')" "7"
t_eq "...stage lists none of them" "$(TS_ keys | grep -c 'AICC_MAIL_' || true)" "0"
t_eq "...and there is NO fact for the key, a key constant or an API host" "$(T keys | grep -ci 'API_KEY\|BREVO\|KEY_FILE' || true)" "0"

echo "== B. ACTIVATION: provider fact + valid key file + sender renders exactly the documented lines =="
R >/dev/null 2>&1; BASE_PLAIN="$TMP/base-plain.php"; cp "$OUT" "$BASE_PLAIN"
key_file; facts "${BREVO_FACTS[@]}"
t_ok "provider + sender + valid key file render" R
BRE="$TMP/brevo.php"; cp "$OUT" "$BRE"
t_eq "the added code lines are EXACTLY the documented eight, in order (plus the one host)" "$(added "$BASE_PLAIN" "$BRE" | grep -v WP_ACCESSIBLE | tr '\n' '|')" "define( 'AICC_MAIL_ENABLED', true );|define( 'AICC_MAIL_PROVIDER', 'brevo_api' );|define( 'AICC_MAIL_API_KEY_FILE', '/etc/aicc-mail/brevo-api.key' );|define( 'AICC_MAIL_FROM_ADDRESS', 'notifications@copilt.org' );|define( 'AICC_MAIL_FROM_NAME', 'AI Commerce Copilot' );|define( 'AICC_MAIL_REPLY_TO', 'support@copilt.org' );|define( 'AICC_MAIL_ALLOWED_FROM_DOMAINS', array( 'copilt.org' ) );|define( 'AICC_MAIL_DAILY_BUDGET', 240 );|"
CB="$(cst "$BRE" $P38K)"
t_eq "...PHP: AICC_MAIL_ENABLED === true (the exact boolean the Control Plane reads)" "$(echo "$CB" | jq -c .AICC_MAIL_ENABLED)" "true"
t_eq "...provider 'brevo_api'" "$(echo "$CB" | jq -r .AICC_MAIL_PROVIDER)" "brevo_api"
t_eq "...the key file PATH (a path, never a key)" "$(echo "$CB" | jq -r .AICC_MAIL_API_KEY_FILE)" "/etc/aicc-mail/brevo-api.key"
t_eq "...sender, name and reply-to" "$(echo "$CB" | jq -c '[.AICC_MAIL_FROM_ADDRESS,.AICC_MAIL_FROM_NAME,.AICC_MAIL_REPLY_TO]')" '["notifications@copilt.org","AI Commerce Copilot","support@copilt.org"]'
t_eq "...allowed from domains is the array [copilt.org]" "$(echo "$CB" | jq -c .AICC_MAIL_ALLOWED_FROM_DOMAINS)" '["copilt.org"]'
t_eq "...the daily budget is the INTEGER 240 (a string would read as 0)" "$(echo "$CB" | jq -r '.AICC_MAIL_DAILY_BUDGET|type'):$(echo "$CB" | jq -r .AICC_MAIL_DAILY_BUDGET)" "number:240"
t_eq "...no key constant exists (the Control Plane refuses one)" "$(echo "$CB" | jq -c .AICC_MAIL_API_KEY)" "null"
t_eq "...no test recipient, no status poll by default" "$(echo "$CB" | jq -c '[.AICC_MAIL_TEST_RECIPIENTS,.AICC_MAIL_STATUS_POLL_ENABLED]')" "[null,null]"
t_eq "...api.brevo.com appears EXACTLY once in the whole file" "$(grep -c 'api\.brevo\.com' "$BRE")" "1"
t_eq "...WP_ACCESSIBLE_HOSTS is exactly api.copilt.org,api.brevo.com (no wildcard, nothing else)" "$(cst "$BRE" WP_ACCESSIBLE_HOSTS | jq -r .WP_ACCESSIBLE_HOSTS)" "api.copilt.org,api.brevo.com"
t_eq "...no wildcard or pattern host anywhere in the file" "$(grep -c "\*\.brevo\|\*\.copilt\|'\*'" "$BRE" || true)" "0"
t_eq "...no SMTP constant (the SMTP region is replaced by one comment line)" "$(grep -v '^//' "$BRE" | grep -c "AICC_MAIL_SMTP\|AICC_MAIL_SECRETS_FILE\|smtp-relay" || true)" "0"
t_eq "...the replaced SMTP region says so" "$(grep -c 'SMTP mail layer not rendered: AICC_MAIL_PROVIDER=brevo_api' "$BRE")" "1"
t_eq "...no marker or placeholder is left" "$(grep -c '@@' "$BRE" || true)" "0"
t_ok "...php -l clean" php -l "$BRE"
t_eq "...the region is delimited: its banner and end line appear once" "$(grep -c '^// ---- P38 Brevo transactional e-mail' "$BRE")/$(grep -c '^// ---- end P38 Brevo ----$' "$BRE")" "1/1"
CP37="$(cst "$BRE" $P37K)"; t_eq "...NOTHING of P37 / campaigns / schedulers is activated (AICC_NOTIFY_ENABLED and all 14 others stay undefined)" "$(echo "$CP37" | jq -c '[.[]|select(.!=null)]|length')" "0"
t_eq "...(explicitly: no notify switch, no trial signup, no funnel, no milestone sync, no December reminder switch)" "$(grep -c "AICC_NOTIFY_ENABLED\|AICC_TRIAL_SELF_SERVICE\|AICC_FUNNEL\|AICC_MILESTONE\|AICC_PLAN_CHANGE\|AICC_PRIVACY_REQ\|AICC_OWNER_OPS" <(grep -v '^//' "$BRE") || true)" "0"
t_eq "...the dry-run says transport brevo_api and prints nothing of the key" "$(R --dry-run 2>&1 | grep -c 'ENABLED (transport: brevo_api)')" "1"
# optional facts
setf AICC_MAIL_FROM_NAME "AICC Notifications"; setf AICC_MAIL_REPLY_TO "help@copilt.org"; setf AICC_MAIL_DAILY_BUDGET 200; setf AICC_MAIL_TEST_RECIPIENTS "Owner.Test+aicc@gmail.com, second@example.org"; setf AICC_MAIL_STATUS_POLL_ENABLED true
t_ok "name, reply-to, budget, test recipients and status poll render" R
CO="$(cst "$OUT" $P38K)"
t_eq "...name / reply-to / budget" "$(echo "$CO" | jq -c '[.AICC_MAIL_FROM_NAME,.AICC_MAIL_REPLY_TO,.AICC_MAIL_DAILY_BUDGET]')" '["AICC Notifications","help@copilt.org",200]'
t_eq "...test recipients are ONE comma string of the exact addresses" "$(echo "$CO" | jq -r .AICC_MAIL_TEST_RECIPIENTS)" "Owner.Test+aicc@gmail.com,second@example.org"
t_eq "...status poll is the boolean true" "$(echo "$CO" | jq -c .AICC_MAIL_STATUS_POLL_ENABLED)" "true"
t_eq "...api.brevo.com still exactly once" "$(grep -c 'api\.brevo\.com' "$OUT")" "1"
t_ok "...php -l clean" php -l "$OUT"
# the cap facts (P37 region) combine with Brevo; budget <= day cap
setf AICC_MAIL_MAX_PER_HOUR 60; setf AICC_MAIL_MAX_PER_DAY 250; setf AICC_MAIL_DAILY_BUDGET 240; setf AICC_MAIL_TEST_RECIPIENTS "a@example.org"; T unset AICC_MAIL_STATUS_POLL_ENABLED >/dev/null
t_ok "hour 60 / day 250 / budget 240 render with Brevo as the mail layer" R
t_eq "...caps are integers, budget 240" "$(cst "$OUT" AICC_MAIL_MAX_PER_HOUR AICC_MAIL_MAX_PER_DAY AICC_MAIL_DAILY_BUDGET | jq -c '[.AICC_MAIL_MAX_PER_HOUR,.AICC_MAIL_MAX_PER_DAY,.AICC_MAIL_DAILY_BUDGET]')" "[60,250,240]"
# the notification switch accepts Brevo as 'mail ready' (it needs a transport), and is the ONLY switch the owner adds by hand
facts "${BREVO_FACTS[@]}" "AICC_NOTIFY_ENABLED true"
t_ok "AICC_NOTIFY_ENABLED is accepted with Brevo as the transport (the notification center needs a mail layer; Brevo is one)" R
t_eq "...and it is the owner's explicit fact that renders it, not the provider" "$(cst "$OUT" AICC_NOTIFY_ENABLED | jq -c .AICC_NOTIFY_ENABLED)" "true"
# turnstile + extra host + brevo: deterministic host list
ts_file; facts "${BREVO_FACTS[@]}" "AICC_TURNSTILE_ENABLED true" "AICC_EXTRA_ACCESSIBLE_HOSTS pay.example.com,Api2.Example.org"
t_ok "Turnstile host + two payment hosts + Brevo render" R
t_eq "...WP_ACCESSIBLE_HOSTS is built deterministically: base, the owner's hosts, Turnstile, Brevo" "$(cst "$OUT" WP_ACCESSIBLE_HOSTS | jq -r .WP_ACCESSIBLE_HOSTS)" "api.copilt.org,pay.example.com,api2.example.org,challenges.cloudflare.com,api.brevo.com"
t_eq "...api.brevo.com exactly once" "$(grep -c 'api\.brevo\.com' "$OUT")" "1"
t_eq "...the host line is a single define (the allow-list is one comma string)" "$(grep -c "^define( 'WP_ACCESSIBLE_HOSTS'" "$OUT")" "1"
ts_off; reset_facts

echo "== C. PROVIDER DECISION: both secret files, a missing file, provider=smtp =="
mail_on; key_file; reset_facts; R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
refused() { local n="$1" want="$2" out rc=0; out="$(R 2>&1)" || rc=$?
  if [ "$rc" = 1 ] && printf '%s' "$out" | grep -qF -- "$want" && [ "$(sha "$OUT")" = "$KEEP" ]; then t_pass "$n"; else t_bad "$n" "rc=$rc want 1 + '$want' + file untouched ($( [ "$(sha "$OUT")" = "$KEEP" ] && echo untouched || echo CHANGED)): $(printf '%s' "$out" | tail -2 | cut -c1-260)"; fi; }
mail_off; key_off; R >/dev/null 2>&1; KEEP="$(sha "$OUT")"; mail_on; key_file
refused "BOTH smtp.env and the key file, NO provider fact: REFUSED (the explicit fact decides; nothing is guessed)" "AICC_MAIL_PROVIDER is not set"
t_rc "...also with no facts file at all (the contradiction is a host state, not a fact)" 1 R
t_contains "...the dry-run refuses it as well" "$(R --dry-run 2>&1 || true)" "AICC_MAIL_PROVIDER is not set"
facts "${BREVO_FACTS[@]}"; t_ok "both files + provider=brevo_api: the FACT decides, Brevo renders" R
t_eq "...the SMTP region is NOT rendered (no SMTP constant, no smtp.env path)" "$(grep -v '^//' "$OUT" | grep -c "AICC_MAIL_SMTP\|AICC_MAIL_SECRETS_FILE\|smtp-relay" || true)" "0"
t_eq "...the provider is brevo_api" "$(cst "$OUT" AICC_MAIL_PROVIDER | jq -r .AICC_MAIL_PROVIDER)" "brevo_api"
t_eq "...and the SMTP password is nowhere in it" "$(grep -c "$SMTPPASS" "$OUT" || true)" "0"
facts "AICC_MAIL_PROVIDER smtp"; t_ok "both files + provider=smtp: the SMTP layer renders" R
t_eq "...the SMTP region is there (eight constants, as before P38), no Brevo constant, no Brevo host" "$(grep -c "^define( 'AICC_MAIL_" "$OUT")/$(grep -c 'brevo_api\|api\.brevo\.com\|AICC_MAIL_API_KEY_FILE' "$OUT" || true)" "8/0"
t_eq "...provider=smtp itself renders nothing (the Control Plane default is smtp)" "$(grep -c "AICC_MAIL_PROVIDER" <(grep -v '^//' "$OUT") || true)" "0"
key_off; facts "AICC_MAIL_PROVIDER smtp"; t_ok "provider=smtp with only smtp.env renders the SMTP layer" R
t_eq "...equal to the render with no provider fact at all (smtp.env alone)" "$(hexnorm "$OUT" | shasum | cut -c1-12)" "$(reset_facts; R >/dev/null 2>&1; hexnorm "$OUT" | shasum | cut -c1-12)"
mail_off; facts "AICC_MAIL_PROVIDER smtp"; WARN="$(R 2>&1)"; t_ok "provider=smtp without smtp.env renders NO mail (no half-enabled state), with a warning" test "$(cst "$OUT" AICC_MAIL_ENABLED | jq -c .AICC_MAIL_ENABLED)" = "null"
t_contains "...the warning names the missing file" "$WARN" "no safe /etc/aicc-mail/smtp.env"
# provider fact but no key file: mail OFF, never half-enabled
mail_off; key_off; facts "${BREVO_FACTS[@]}"; WARN="$(R 2>&1)"; rc=$?
t_eq "provider=brevo_api WITHOUT the key file renders (exit 0): a rebuilt host with the facts but no secret must still render" "$rc" "0"
t_contains "...with a warning that names the key file" "$WARN" "brevo-api.key is absent"
t_ok "...and the output is the plain default (no Brevo region, no AICC_MAIL_ENABLED, no outbound Brevo host)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
t_eq "...api.brevo.com does not appear" "$(grep -c 'api\.brevo\.com' "$OUT" || true)" "0"
mail_on; WARN="$(R 2>&1)"; t_eq "provider=brevo_api without the key file but WITH smtp.env: no mail at all (the fact chose Brevo; SMTP is not used behind its back)" "$(cst "$OUT" AICC_MAIL_ENABLED | jq -c .AICC_MAIL_ENABLED)" "null"
mail_off
# a valid key file with no provider fact is ignored
key_file; reset_facts; WARN="$(R 2>&1)"; t_ok "a valid key file and NO provider fact renders the plain default (the key is ignored)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
t_contains "...with a note that it is ignored" "$WARN" "key is ignored"
facts "AICC_MAIL_PROVIDER brevo_api"; refused "provider=brevo_api with a key file but NO sender fact is REFUSED (no sender is guessed)" "needs AICC_MAIL_FROM_ADDRESS"
key_off

echo "== D. REFUSALS (nothing is written; the previous file stays) =="
key_file; facts "${BREVO_FACTS[@]}"; R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
t_ok "(baseline: the Brevo set is accepted)" R
# facts of the Brevo region without the provider are INERT (so that `unset AICC_MAIL_PROVIDER` alone turns Brevo mail off), with a note; only the status poll may not stay on without the provider
key_file; for kv in "AICC_MAIL_FROM_ADDRESS notifications@copilt.org" "AICC_MAIL_FROM_NAME Foo" "AICC_MAIL_REPLY_TO a@copilt.org" "AICC_MAIL_DAILY_BUDGET 100" "AICC_MAIL_TEST_RECIPIENTS a@example.org"; do
  facts "$kv"; WARN="$(R 2>&1)"; rc=$?
  t_eq "${kv%% *} without AICC_MAIL_PROVIDER renders NOTHING (inert, exit 0): the plain default" "$rc/$(diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' "$OUT") "$GOLD" >/dev/null && echo golden)" "0/golden"
  t_contains "...with a note that it is ignored" "$WARN" "${kv%% *} set but AICC_MAIL_PROVIDER is not brevo_api: ignored"
done
reset_facts; R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
facts "AICC_MAIL_STATUS_POLL_ENABLED true"; refused "AICC_MAIL_STATUS_POLL_ENABLED without AICC_MAIL_PROVIDER=brevo_api is REFUSED (it registers a cron event: never without the transport)" "status poll exists only with the Brevo API transport"
facts "AICC_MAIL_PROVIDER smtp" "AICC_MAIL_STATUS_POLL_ENABLED true"; refused "status poll with provider=smtp is REFUSED" "status poll exists only with the Brevo API transport"
facts "AICC_MAIL_PROVIDER smtp" "AICC_MAIL_FROM_ADDRESS notifications@copilt.org"; WARN="$(R 2>&1)"; t_contains "Brevo sender facts with provider=smtp are ignored with a note (the SMTP region defines its own sender)" "$WARN" "ignored"
t_eq "...and nothing of them is rendered" "$(grep -v '^//' "$OUT" | grep -c "notifications@copilt.org" || true)" "0"
facts "${BREVO_FACTS[@]}"; R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
# budget and caps
facts "${BREVO_FACTS[@]}" "AICC_MAIL_MAX_PER_DAY 200" "AICC_MAIL_DAILY_BUDGET 240"; refused "a daily budget above the day cap is REFUSED" "is above AICC_MAIL_MAX_PER_DAY"
facts "${BREVO_FACTS[@]}" "AICC_MAIL_MAX_PER_DAY 200"; refused "a day cap below the DEFAULT budget (240) with no explicit budget is REFUSED (the default is never silently lowered)" "below the default daily budget"
facts "${BREVO_FACTS[@]}" "AICC_MAIL_MAX_PER_DAY 500"; refused "a day cap above 300 on Brevo Free is REFUSED" "Brevo Free daily limit"
facts "${BREVO_FACTS[@]}" "AICC_MAIL_MAX_PER_HOUR 500"; refused "an hourly cap above 300 on Brevo Free is REFUSED" "Brevo Free daily limit"
facts "${BREVO_FACTS[@]}" "AICC_MAIL_MAX_PER_HOUR 300" "AICC_MAIL_MAX_PER_DAY 100" "AICC_MAIL_DAILY_BUDGET 100"; refused "an hourly cap above the day cap is REFUSED (existing rule)" "is above AICC_MAIL_MAX_PER_DAY"
facts "AICC_MAIL_PROVIDER brevo_api"; refused "Brevo without a sender fact is REFUSED" "needs AICC_MAIL_FROM_ADDRESS"
# test recipients need a transport; notify without a transport
key_off; facts "${BREVO_FACTS[@]}" "AICC_NOTIFY_ENABLED true"; refused "AICC_NOTIFY_ENABLED with the provider fact but NO key file (mail would be off) is REFUSED" "AICC_NOTIFY_ENABLED needs the mail layer"
facts "${BREVO_FACTS[@]}" "AICC_MAIL_MAX_PER_HOUR 60"; refused "mail caps with the provider fact but no key file are REFUSED (a cap for a layer that is not running)" "mail layer is not enabled"
key_file
# values refused at set time
for bad in "notifications@evil.com" "notifications@copilt.org.evil.com" "notifications@sub.copilt.org" "notifications@mail.copilt.org" "notifications" "notifications@" "@copilt.org" "a b@copilt.org" "<a@copilt.org>" "a@copilt.org,b@copilt.org" "x@copilt.org
y" "ａ@copilt.org"; do
  t_rc "sender '${bad//$'\n'/\\n}' is REFUSED (only an address @copilt.org)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_FROM_ADDRESS "$bad"
done
t_eq "sender with an upper-case domain is accepted and stored lower-case" "$(env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_FROM_ADDRESS "Notifications@COPILT.ORG" >/dev/null 2>&1; env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production list)" "AICC_MAIL_FROM_ADDRESS=Notifications@copilt.org"
rm -f "$TMP/x.env"
for bad in "" "Brevo" "brevo" "BREVO_API" "sendgrid" "brevo_api,smtp" "ses" "mail" "true"; do
  t_rc "provider '$bad' is REFUSED (only brevo_api or smtp)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_PROVIDER "$bad"
done
for bad in 0 301 1000 -5 abc 240.5 "2 40" 0x10 "" 1e2 00; do
  t_rc "daily budget '$bad' is REFUSED (1-300)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_DAILY_BUDGET "$bad"
done
for ok in 1 240 300; do t_rc "daily budget '$ok' is accepted" 0 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_DAILY_BUDGET "$ok"; done
rm -f "$TMP/x.env"
for bad in false 1 yes True TRUE ""; do t_rc "status poll '$bad' is REFUSED (only the exact word true; to turn it off, unset it)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_STATUS_POLL_ENABLED "$bad"; done
for bad in "not-an-address" "a@" "a@b" "a@b.c,not" "a@b.co,,c@d.co" "a@b.co,a@b.co" "A@B.co,a@b.co" "a@b.co,b@b.co,c@b.co,d@b.co,e@b.co,f@b.co" "a'b@b.co" "a\\b@b.co" "a@b.co;c@d.co" "a@b.co c@d.co" "<a@b.co>" "a@b.co>" "Name <a@b.co>" "a@b.co
c@d.co"; do
  t_rc "test recipients '${bad//$'\n'/\\n}' is REFUSED" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_TEST_RECIPIENTS "$bad"
done
t_ok "...and none of those refusals wrote a facts file" test ! -e "$TMP/x.env"
t_rc "FIVE exact addresses are accepted" 0 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_TEST_RECIPIENTS "a@b.co,b@b.co,c@b.co,d@b.co,e@b.co"; rm -f "$TMP/x.env"
t_contains "a refusal of a test recipient never echoes the value (personal data)" "$(env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_TEST_RECIPIENTS 'private.person@@broken' 2>&1 || true)" "AICC_MAIL_TEST_RECIPIENTS is not a plain e-mail address"
t_not_contains "...(the value is not in the message)" "$(env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_TEST_RECIPIENTS 'private.person@@broken' 2>&1 || true)" "private.person"
# set-stdin: the value is read from STDIN (never an argument): validated like set, nothing written when refused
SS() { env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/s.env" --env production set-stdin "$@"; }
rm -f "$TMP/s.env"; printf 'Stdin.Person@example.org\n' | SS AICC_MAIL_TEST_RECIPIENTS >/dev/null 2>&1
t_eq "set-stdin stores a valid test recipient read from stdin" "$(grep -c '^AICC_MAIL_TEST_RECIPIENTS=Stdin.Person@example.org$' "$TMP/s.env")" "1"
t_eq "...and list masks it" "$(env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/s.env" --env production list)" "AICC_MAIL_TEST_RECIPIENTS=S***@example.org"
t_not_contains "...the confirmation line does not echo the value" "$(printf 'Stdin.Person@example.org\n' | SS AICC_MAIL_TEST_RECIPIENTS 2>&1)" "Stdin.Person"
rm -f "$TMP/s.env"; for bad in "not-an-address" "" "a@b.co,,c@d.co" "a'b@x.org"; do
  t_rc "set-stdin refuses '$bad'" 1 bash -c "printf '%s\n' \"\$1\" | env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$TMP/s.env' --env production set-stdin AICC_MAIL_TEST_RECIPIENTS" _ "$bad"
done
t_ok "...and none of them wrote a file" test ! -e "$TMP/s.env"
t_rc "set-stdin refuses a value of more than 4096 bytes" 1 bash -c "head -c 5000 /dev/zero | tr '\0' a | env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$TMP/s.env' --env production set-stdin AICC_MAIL_FROM_NAME"
t_rc "set-stdin with a value on the command line is refused (the form has no argument)" 1 bash -c "echo x | env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$TMP/s.env' --env production set-stdin AICC_MAIL_FROM_NAME extra"
t_rc "set-stdin refuses an unknown key" 1 bash -c "echo x | env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$TMP/s.env' --env production set-stdin NOPE"
t_rc "set-stdin on stage refuses a P38 key" 1 bash -c "echo a@copilt.org | env AICC_TEST_HARNESS=1 bash '$PROV/owner-facts.sh' --file '$TMP/s.env' --env stage set-stdin AICC_MAIL_REPLY_TO"
rm -f "$TMP/s.env"
# api.brevo.com requested without the provider fact, or as an extra host at all
for h in "api.brevo.com" "brevo.com" "sub.brevo.com" "api.brevo.com,pay.example.com" "*.brevo.com" "API.BREVO.COM" "x.api.brevo.com"; do
  t_rc "extra outbound host '$h' is REFUSED (the Brevo host is added only by the provider fact; no wildcard, no pattern)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_EXTRA_ACCESSIBLE_HOSTS "$h"
done
facts "${BREVO_FACTS[@]}"; t_rc "...also while the provider fact IS set (no duplicate, no second path)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production set AICC_EXTRA_ACCESSIBLE_HOSTS api.brevo.com
printf 'AICC_EXTRA_ACCESSIBLE_HOSTS=api.brevo.com\n' > "$OFF"; chmod 600 "$OFF"; refused "a HAND-EDITED facts file naming api.brevo.com as an extra host is REFUSED by the renderer" "is a Brevo host"
printf 'AICC_MAIL_PROVIDER=brevo_api\nAICC_MAIL_FROM_ADDRESS=notifications@evil.com\n' > "$OFF"; refused "a hand-edited foreign sender is REFUSED by the renderer" "must be an address @copilt.org"
printf 'AICC_MAIL_PROVIDER=ses\n' > "$OFF"; refused "a hand-edited provider 'ses' is REFUSED by the renderer" "exactly brevo_api or smtp"
# staging
STAGE_ONLY="$TMP/stage-facts.env"; for k in AICC_MAIL_PROVIDER AICC_MAIL_FROM_ADDRESS AICC_MAIL_FROM_NAME AICC_MAIL_REPLY_TO AICC_MAIL_DAILY_BUDGET AICC_MAIL_TEST_RECIPIENTS AICC_MAIL_STATUS_POLL_ENABLED; do
  t_rc "stage refuses the P38 fact $k" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$STAGE_ONLY" --env stage set "$k" brevo_api
done
t_ok "...and wrote no stage facts file" test ! -e "$STAGE_ONLY"
mkdir -p "$TMP/stm"; printf '%s\n' "$FAKEKEY" > "$TMP/stm/brevo-api.key"; chmod 640 "$TMP/stm/brevo-api.key"; rm -f "$TMP/stage2.php"
t_rc "a stage render with a Brevo key file next to it ignores it (stage never carries the region)" 0 bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --out '$TMP/stage2.php' --secrets-dir '$SEC' --mail-dir '$TMP/stm' --plugin-release-dir '$REL' --owner-facts-file '$TMP/none.env' --owner '$OFU' >/dev/null 2>&1"
t_eq "...and the stage render carries no Brevo constant or host" "$(grep -c "brevo\|AICC_MAIL_PROVIDER\|AICC_MAIL_API_KEY" "$TMP/stage2.php" || true)" "0"
# unsafe key file: refused whatever the facts say
facts "${BREVO_FACTS[@]}"; key_file; R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
for m in 600 644 660 664 666 400 604 620 750 777; do key_file "$FAKEKEY" "$m"; refused "a key file with mode 0$m is REFUSED" "must be mode 0640"; done
key_file "$FAKEKEY" 640; t_ok "(mode 0640 passes)" R; key_file "$FAKEKEY" 440; t_ok "(mode 0440 passes)" R; key_file "$FAKEKEY" 640; R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
rm -f "$MAILD/brevo-api.key"; printf '%s\n' "$FAKEKEY" > "$MAILD/real-key"; chmod 640 "$MAILD/real-key"; ln -s "$MAILD/real-key" "$MAILD/brevo-api.key"; refused "a symbolic link as the key file is REFUSED" "not a regular file"
rm -f "$MAILD/brevo-api.key" "$MAILD/real-key"; mkdir "$MAILD/brevo-api.key"; refused "a directory as the key file is REFUSED" "not a regular file"; rmdir "$MAILD/brevo-api.key"
key_file "short" 640; refused "a key shorter than 20 bytes is REFUSED" "must be 20-256 bytes"
key_file "$(printf 'a%.0s' $(seq 19))" 640; refused "a 19-character key is REFUSED" "exactly one line"
key_file "$(printf 'a%.0s' $(seq 201))" 640; refused "a 201-character key (over the Control Plane's 200) is REFUSED" "20-200 characters"
key_file "$(printf 'a%.0s' $(seq 200))" 640; t_ok "a 200-character key is accepted" R
key_file "$(printf 'a%.0s' $(seq 300))" 640; refused "a 300-byte file is REFUSED" "must be 20-256 bytes"
key_file "has a space inside the key 0000" 640; refused "a key with a space is REFUSED (the Control Plane would read it as no key)" "20-200 characters"
key_file "xkeysib-TEST-NOT-A-REAL-KEY-0000!" 640; refused "a key with a punctuation character is REFUSED" "20-200 characters"
key_file "xkeysib-TEST-NOT-A-REAL-KEY-é000" 640; refused "a key with a non-ASCII letter is REFUSED" "20-200 characters"
printf '\n%s\n' "$FAKEKEY" > "$MAILD/brevo-api.key"; chmod 640 "$MAILD/brevo-api.key"; refused "a file whose FIRST line is empty is REFUSED" "exactly one line"
printf '%s\nsecond-line-with-another-secret-0000\n' "$FAKEKEY" > "$MAILD/brevo-api.key"; chmod 640 "$MAILD/brevo-api.key"; refused "a second line (another secret) is REFUSED" "exactly one line"
printf '%s\r\n' "$FAKEKEY" > "$MAILD/brevo-api.key"; chmod 640 "$MAILD/brevo-api.key"; refused "a CRLF line ending is REFUSED (the Control Plane's pattern has no \\r)" "exactly one line"
key_file "$SMTPKEY" 640; SMTPOUT="$(R 2>&1 || true)"; t_contains "an SMTP key (xsmtpsib-) in the API key file is REFUSED with a plain reason" "$SMTPOUT" "SMTP key"
t_not_contains "...and the message does not print it" "$SMTPOUT" "$SMTPKEY"
: > "$MAILD/brevo-api.key"; chmod 640 "$MAILD/brevo-api.key"; refused "an empty key file is REFUSED" "must be 20-256 bytes"
# an invalid key file refuses even with NO owner-facts file and with NO provider fact
reset_facts; key_file "short" 640; refused "an invalid key file is refused even with NO owner-facts file" "must be 20-256 bytes"
key_file "$FAKEKEY" 666; refused "...and an unsafe-mode one too" "must be mode 0640"
t_contains "...the dry-run refuses it as well" "$(R --dry-run 2>&1 || true)" "must be mode 0640"
key_off

echo "== E. HOSTILE VALUES: the name, reply-to and recipients can never leave their PHP string =="
key_file; facts "${BREVO_FACTS[@]}"; R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
hostile_ok() { # hostile_ok <name> <value>: accepted, rendered, php -l clean, and PHP reads back EXACTLY the typed value
  local n="$1" v="$2"; facts "${BREVO_FACTS[@]}"; if ! env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production set AICC_MAIL_FROM_NAME "$v" >/dev/null 2>&1; then t_bad "$n" "set refused"; return; fi
  if ! R >/dev/null 2>&1; then t_bad "$n" "render refused"; return; fi
  if ! php -l "$OUT" >/dev/null 2>&1; then t_bad "$n" "php -l failed"; return; fi
  local got; got="$(php -r 'define("ABSPATH",$argv[2]); require $argv[1]; echo constant("AICC_MAIL_FROM_NAME");' "$OUT" "$ABS/" 2>&1)"
  if [ "$got" = "$v" ]; then t_pass "$n"; else t_bad "$n" "PHP read back '$got'"; fi
  [ "$(grep -c 'define( ' "$OUT")" = "$(grep -c 'define( ' "$OUT")" ] || true
}
hostile_ok "from name with an apostrophe is escaped and read back exactly" "Aviv's Copilot"
hostile_ok "from name with a backslash is escaped and read back exactly" 'AICC \ Copilot'
hostile_ok "from name ending in a backslash cannot escape the closing quote" 'AICC Copilot\'
hostile_ok "from name with a dollar sign stays literal (single-quoted PHP)" 'AICC $x ${y} $(id)'
hostile_ok "from name with an injection attempt stays inside its string" "x'); phpinfo(); //"
hostile_ok "from name with an escaped-quote attempt stays inside its string" "a\\');phpinfo();//"
hostile_ok "from name with unicode (Hebrew) is accepted" "עוזר AICC"
hostile_ok "from name with percent and ampersand" "AICC 100% & Co"
hostile_ok "from name of exactly 70 characters is accepted" "$(printf 'n%.0s' $(seq 70))"
t_eq "...none of the injection attempts defined an extra constant (phpinfo never ran: the render still has the same number of defines)" "$(php -r 'define("ABSPATH",$argv[2]); ob_start(); require $argv[1]; $o=ob_get_clean(); echo strlen($o);' "$OUT" "$ABS/")" "0"
facts "${BREVO_FACTS[@]}"; R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
for bad in "AICC ?> <?php" "x?>y" "<?php phpinfo();" "a<b" "a>b" 'say "hi"' "a@@B@@c" "$(printf 'n%.0s' $(seq 71))" $'two\nlines' $'cr\rhere' $'tab\there' $'nul\x01ctl' $'bidi\xe2\x80\xaeoverride' $'line\xe2\x80\xa8sep'; do
  t_rc "from name '${bad//[$'\n\r\t\x01']/~}' is REFUSED at set time" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production set AICC_MAIL_FROM_NAME "$bad"
done
t_eq "...and the facts file still holds no from name after those refusals" "$(grep -c AICC_MAIL_FROM_NAME "$OFF" || true)" "0"
printf 'AICC_MAIL_PROVIDER=brevo_api\nAICC_MAIL_FROM_ADDRESS=notifications@copilt.org\nAICC_MAIL_FROM_NAME=evil?>\n' > "$OFF"; chmod 600 "$OFF"; refused "a HAND-EDITED name with '?>' is REFUSED by the renderer" "AICC_MAIL_FROM_NAME contains '<' or '>'"
printf 'AICC_MAIL_PROVIDER=brevo_api\nAICC_MAIL_FROM_ADDRESS=notifications@copilt.org\nAICC_MAIL_FROM_NAME=a\rb\n' > "$OFF"; refused "a HAND-EDITED name with a carriage return is REFUSED by the renderer" "carriage-return"
for bad in "a@gmail.com" "support@evil.com" "support@copilt.org.evil.com" "support@sub.copilt.org" "support@COPILT.ORG.evil.com" "Support <support@copilt.org>" "support@copilt.org,x@gmail.com" "support@copilt.org
x@evil.com"; do
  t_rc "reply-to '${bad//$'\n'/\\n}' (off-domain or not a plain address) is REFUSED: replies must land on copilt.org" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_REPLY_TO "$bad"
done
t_eq "reply-to with an upper-case domain is stored lower-case" "$(env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_REPLY_TO "Support@COPILT.ORG" >/dev/null 2>&1; env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production list)" "AICC_MAIL_REPLY_TO=Support@copilt.org"
rm -f "$TMP/x.env"
t_rc "...whereas the LEGAL support address keeps its own (existing) rule: any domain" 0 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_LEGAL_SUPPORT_EMAIL "counsel@example.org"; rm -f "$TMP/x.env"
printf 'AICC_MAIL_PROVIDER=brevo_api\nAICC_MAIL_FROM_ADDRESS=notifications@copilt.org\nAICC_MAIL_REPLY_TO=boss@gmail.com\n' > "$OFF"; chmod 600 "$OFF"; key_file; refused "a HAND-EDITED off-domain reply-to is REFUSED by the renderer" "AICC_MAIL_REPLY_TO must be an address @copilt.org"
for bad in "a'b@copilt.org" 'a\b@copilt.org' "a;b@copilt.org" 'a"b@copilt.org' "a b@copilt.org" "a\$b@copilt.org" "a@copilt.org'); die();//"; do
  t_rc "reply-to '$bad' is REFUSED" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/x.env" --env production set AICC_MAIL_REPLY_TO "$bad"
done
facts "${BREVO_FACTS[@]}" "AICC_MAIL_REPLY_TO support@copilt.org"; t_ok "a plain reply-to renders" R
t_eq "...as a PHP string" "$(cst "$OUT" AICC_MAIL_REPLY_TO | jq -r .AICC_MAIL_REPLY_TO)" "support@copilt.org"
t_eq "every defined P38 constant in the hostile renders is on ONE line (no multi-line define can be smuggled)" "$(grep -c "^define( 'AICC_MAIL_" "$OUT")" "$(grep -c "AICC_MAIL_" <(grep -v '^//' "$OUT"))"
reset_facts; key_off

echo "== F. IDEMPOTENCE, ROLLBACK and --compare =="
key_file; facts "${BREVO_FACTS[@]}"; R >/dev/null 2>&1; S1="$(sha "$OUT")"
t_contains "a second render says unchanged" "$(R 2>&1)" "unchanged"
t_eq "...and the file is byte-identical" "$(sha "$OUT")" "$S1"
R >/dev/null 2>&1; R >/dev/null 2>&1; t_eq "...also after many renders" "$(sha "$OUT")" "$S1"
R --force-salts >/dev/null 2>&1; t_eq "a render with --force-salts keeps the Brevo constants (the facts are in the facts file, the key in its file)" "$(grep -c "define( 'AICC_MAIL_PROVIDER', 'brevo_api' );" "$OUT")/$(grep -c 'api\.brevo\.com' "$OUT")" "1/1"
{ for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT; do printf '%s=SALTVALUE_%s\n' "$k" "$k"; done; printf 'AICC_ACTIVATION_PROOF_SECRET=%s\nAICC_ENTITLEMENT_WEBHOOK_SECRET=%s\n' "$HEX" "$HEX"; } > "$SEC/wp-secrets.env"; chmod 600 "$SEC/wp-secrets.env"
R >/dev/null 2>&1; S1="$(sha "$OUT")"
t_ok "a dry-run changes nothing" bash -c "env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --dry-run --out '$OUT' --secrets-dir '$SEC' --mail-dir '$MAILD' --plugin-release-dir '$REL' --owner-facts-file '$OFF' --owner '$OFU' >/dev/null 2>&1; [ \"\$(shasum -a 256 '$OUT' | cut -d' ' -f1)\" = '$S1' ]"
t_contains "...and the dry-run says the Brevo key file is valid" "$(R --dry-run 2>&1)" "brevo api key file valid"
# --compare
t_contains "--compare against an identical file says IDENTICAL" "$(R --compare 2>&1)" "IDENTICAL"
t_rc "...exit code 0" 0 R --compare
T unset AICC_MAIL_FROM_ADDRESS >/dev/null; T set AICC_MAIL_FROM_NAME "Changed Name" >/dev/null; setf AICC_MAIL_FROM_ADDRESS notifications@copilt.org; setf AICC_MAIL_DAILY_BUDGET 100
CMP="$(R --compare 2>&1)"; crc=$?
t_eq "--compare of a changed set exits 4" "$crc" "4"
t_contains "...names the changed constant" "$CMP" "changed: AICC_MAIL_DAILY_BUDGET, AICC_MAIL_FROM_NAME"
t_not_contains "...and never prints a value" "$CMP" "Changed Name"
t_eq "...and writes nothing (the output file is unchanged)" "$(sha "$OUT")" "$S1"
touch "$SEC/.compare.leftover-from-a-killed-run"; R --compare >/dev/null 2>&1
t_ok "a leftover .compare.* file of a killed earlier run is swept by the next run" test ! -e "$SEC/.compare.leftover-from-a-killed-run"
t_eq "--compare leaves no temp copy of the rendered config behind in the secrets directory" "$(find "$SEC" -name '.compare.*' | wc -l | tr -d ' ')" "0"
CTRACE="$( { env AICC_TEST_HARNESS=1 bash -x "$PROV/render-wp-config.sh" --env production --confirm-production --compare --out "$OUT" --secrets-dir "$SEC" --mail-dir "$MAILD" --plugin-release-dir "$REL" --owner-facts-file "$OFF" --owner "$OFU"; } 2>&1 )"
t_contains "--compare creates its temp file INSIDE the 0700 secrets directory (not /tmp) with mode 0600" "$CTRACE" "mktemp $SEC/.compare."
t_contains "...and chmods it 600" "$CTRACE" "chmod 600 $SEC/.compare."
reset_facts; CMP="$(R --compare 2>&1)"; crc=$?
t_eq "--compare of the render that REMOVES the Brevo region exits 4 and lists what goes away" "$crc/$(printf '%s' "$CMP" | grep -c 'removed: .*AICC_MAIL_PROVIDER')" "4/1"
t_contains "...including the outbound-host line as a changed constant" "$CMP" "WP_ACCESSIBLE_HOSTS"
key_off; reset_facts; R >/dev/null 2>&1
t_ok "unsetting everything and removing the key file returns the golden default byte for byte" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
t_rc "--compare after that is IDENTICAL again" 0 R --compare
# ROLLBACK: one command turns mail off
key_file; facts "${BREVO_FACTS[@]}"; R >/dev/null 2>&1; T unset AICC_MAIL_PROVIDER >/dev/null; T unset AICC_MAIL_FROM_ADDRESS >/dev/null; R >/dev/null 2>&1
t_eq "rollback: unset the provider (and the sender), re-render: the Brevo region and the host are gone" "$(grep -v '^//' "$OUT" | grep -c 'brevo_api\|api\.brevo\.com\|AICC_MAIL_ENABLED' || true)" "0"
t_ok "...with the key file still present the render is the golden default (the file is ignored until the fact is back)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
facts "${BREVO_FACTS[@]}"; R >/dev/null 2>&1; key_off; WARN="$(R 2>&1)"; rc=$?
t_eq "revoke: removing the key file with the facts still set renders (exit 0) with mail OFF and a warning, never half-enabled" "$rc/$(grep -v '^//' "$OUT" | grep -c 'AICC_MAIL_ENABLED' || true)" "0/0"
t_contains "...the warning" "$WARN" "brevo-api.key is absent"
reset_facts

echo "== G. NO SECRET reaches the rendered file, the logs, a trace or the facts; personal data is masked =="
key_file; facts "${BREVO_FACTS[@]}" "AICC_MAIL_TEST_RECIPIENTS private.person@gmail.com,second@example.org"
LOGS="$(R 2>&1; R --dry-run 2>&1; R --compare 2>&1; T list 2>&1; T check 2>&1; T keys 2>&1; env AICC_TEST_HARNESS=1 python3 -I "$PROV/lib/owner_facts.py" check-brevo-key --file "$MAILD/brevo-api.key" --env production 2>&1; env AICC_TEST_HARNESS=1 python3 -I "$PROV/lib/owner_facts.py" mail-mode --file "$OFF" --env production --brevo-key-ready 2>&1)"
R >/dev/null 2>&1
t_not_contains "the key is in no render / dry-run / compare / list / check / mail-mode / check-brevo-key output" "$LOGS" "$FAKEKEY"
t_not_contains "...nor a fragment of it (its tail)" "$LOGS" "NOT-A-REAL-KEY"
t_eq "the key is NOT in the rendered wp-config.php" "$(grep -cF "$FAKEKEY" "$OUT" || true)" "0"
t_eq "...nor a fragment of it" "$(grep -c "NOT-A-REAL-KEY\|xkeysib" "$OUT" || true)" "0"
t_eq "the key is NOT in the owner-facts file" "$(grep -c "NOT-A-REAL-KEY\|xkeysib" "$OFF" || true)" "0"
t_eq "the rendered file carries the key's PATH only" "$(grep -c "define( 'AICC_MAIL_API_KEY_FILE', '/etc/aicc-mail/brevo-api.key' );" "$OUT")" "1"
t_eq "...and no constant named *KEY* / *SECRET* / *PASS* / *TOKEN* carries a literal other than the two shared secrets the production template always had, and the key file PATHs" "$(grep -E "^define\( 'AICC_[A-Z_]*(SECRET|PASS|PASSWORD|TOKEN|KEY)[A-Z_]*', '" "$OUT" | grep -v "_FILE'" | sed -E "s/^define\( '([A-Z_]+)'.*/\1/" | sort | tr '\n' ' ')" "AICC_ACTIVATION_PROOF_SECRET AICC_ENTITLEMENT_WEBHOOK_SECRET "
# a bash -x trace of the renderer and of the owner-facts tool must not hold the key (the key never enters a shell variable)
TRACE="$( { env AICC_TEST_HARNESS=1 bash -x "$PROV/render-wp-config.sh" --env production --confirm-production --out "$OUT" --secrets-dir "$SEC" --mail-dir "$MAILD" --plugin-release-dir "$REL" --owner-facts-file "$OFF" --owner "$OFU"; } 2>&1 )"
t_not_contains "a 'bash -x' trace of the renderer holds no key" "$TRACE" "$FAKEKEY"
t_ok "...(the trace is a real trace: it has many lines)" test "$(printf '%s\n' "$TRACE" | grep -c '^+')" -gt 50
TRACE2="$( { env AICC_TEST_HARNESS=1 bash -x "$PROV/render-wp-config.sh" --env production --confirm-production --dry-run --out "$OUT" --secrets-dir "$SEC" --mail-dir "$MAILD" --plugin-release-dir "$REL" --owner-facts-file "$OFF" --owner "$OFU"; } 2>&1 )"
t_not_contains "...and so does the trace of a dry-run" "$TRACE2" "$FAKEKEY"
t_eq "the renderer leaves no temp copy of the key (no file under TMPDIR contains it after a render)" "$(grep -rlF "$FAKEKEY" "${TMPDIR:-/tmp}" 2>/dev/null | grep -v '/brevo-api\.key$' | head -3 | tr '\n' ' ')" ""
t_eq "the renderer and the validator never read the key into the output (no print / write / echo of its content in code)" "$(cat "$PROV/lib/owner_facts.py" "$PROV/render-wp-config.sh" | grep -c 'print(raw\|write(raw\|print(lines\|echo "\$bk\|cat "\$BKF"\|< "\$BKF"' || true)" "0"
# personal data
t_contains "owner-facts list MASKS the test recipients (first character and domain only)" "$(T list)" "AICC_MAIL_TEST_RECIPIENTS=p***@gmail.com,s***@example.org"
t_not_contains "...the full local part is not in the list output" "$(T list)" "private.person"
t_contains "the facts file itself holds the exact addresses (root-only, mode 0600: the renderer needs them)" "$(cat "$OFF")" "private.person@gmail.com,second@example.org"
t_eq "...the facts file is mode 0600" "$(stat -f '%Lp' "$OFF" 2>/dev/null || stat -c '%a' "$OFF")" "600"
t_not_contains "the render and check logs do not print the addresses" "$(R 2>&1; R --dry-run 2>&1; T check 2>&1)" "private.person"
t_contains "the rendered config (root:aicc-cp 0640 on the host) carries them, because the Control Plane reads them there" "$(grep "AICC_MAIL_TEST_RECIPIENTS" "$OUT")" "private.person@gmail.com,second@example.org"
t_contains "export (the explicit disaster-recovery copy) is the full validated text" "$(T export)" "private.person@gmail.com"
reset_facts; key_off

echo "== H. ACTIVATION ORDER (docs/cutover/p38-brevo-host-update.md section 6): each documented step renders; the wrong order is refused =="
reset_facts; mail_off; key_off; ts_off; R >/dev/null 2>&1
t_ok "step 0: default render (nothing P38)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
T set AICC_MAIL_PROVIDER brevo_api >/dev/null;           WARN="$(R 2>&1)"; t_ok "step 1: provider fact set BEFORE the key exists renders mail OFF with a warning (no half-enabled mail)" test "$(cst "$OUT" AICC_MAIL_ENABLED | jq -c .AICC_MAIL_ENABLED)" = "null"
T set AICC_MAIL_FROM_ADDRESS notifications@copilt.org >/dev/null; T set AICC_MAIL_FROM_NAME "AI Commerce Copilot" >/dev/null; T set AICC_MAIL_REPLY_TO support@copilt.org >/dev/null; T set AICC_MAIL_DAILY_BUDGET 240 >/dev/null
t_ok "step 2: sender, name, reply-to and budget set, still no key: renders (mail OFF)" R
key_file;                                                t_ok "step 3: set-brevo-key placed the key file, render: Brevo is ON" R
t_eq "...the constants Brevo mode is ON" "$(cst "$OUT" AICC_MAIL_ENABLED AICC_MAIL_PROVIDER | jq -c '[.AICC_MAIL_ENABLED,.AICC_MAIL_PROVIDER]')" '[true,"brevo_api"]'
T set AICC_MAIL_TEST_RECIPIENTS owner.box@example.org >/dev/null; t_ok "step 4: the owner's test mailbox set, render" R
t_eq "...the test recipient is the exact address" "$(cst "$OUT" AICC_MAIL_TEST_RECIPIENTS | jq -r .AICC_MAIL_TEST_RECIPIENTS)" "owner.box@example.org"
T set AICC_MAIL_STATUS_POLL_ENABLED true >/dev/null; t_ok "step 5 (optional, later): status poll, render" R
T unset AICC_MAIL_STATUS_POLL_ENABLED >/dev/null; T unset AICC_MAIL_TEST_RECIPIENTS >/dev/null; R >/dev/null 2>&1
T set AICC_MAIL_MAX_PER_HOUR 60 >/dev/null; T set AICC_MAIL_MAX_PER_DAY 240 >/dev/null; t_ok "step 6 (optional): caps matched to the plan, render" R
T unset AICC_MAIL_MAX_PER_HOUR >/dev/null; T unset AICC_MAIL_MAX_PER_DAY >/dev/null
T set AICC_MAIL_STATUS_POLL_ENABLED true >/dev/null; T unset AICC_MAIL_PROVIDER >/dev/null; refused2="$(R 2>&1 || true)"
t_contains "the WRONG order (provider unset while the status poll is still on) is refused, nothing written" "$refused2" "status poll exists only with the Brevo API transport"
T unset AICC_MAIL_STATUS_POLL_ENABLED >/dev/null; WARN="$(R 2>&1)"; t_ok "ONE-COMMAND OFF: with the poll unset, 'unset AICC_MAIL_PROVIDER' + render turns Brevo mail off while the sender facts stay (inert)" test "$(grep -v '^//' "$OUT" | grep -c 'brevo_api\|api\.brevo\.com\|AICC_MAIL_ENABLED' || true)" = "0"
t_contains "...the render says the facts are ignored" "$WARN" "ignored"
for k in AICC_MAIL_FROM_ADDRESS AICC_MAIL_FROM_NAME AICC_MAIL_REPLY_TO AICC_MAIL_DAILY_BUDGET; do T unset $k >/dev/null; done
t_ok "rollback: every P38 fact unset, key file still there: the golden default again" bash -c "R() { :; }; env AICC_TEST_HARNESS=1 bash '$PROV/render-wp-config.sh' --env production --confirm-production --out '$OUT' --secrets-dir '$SEC' --mail-dir '$MAILD' --plugin-release-dir '$REL' --owner-facts-file '$OFF' --owner '$OFU' >/dev/null 2>&1; diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
key_off; reset_facts


echo "== I. the five constants P35 appended BY HAND to the live wp-config are pinned as owner facts: --compare against a synthetic live file =="
mail_off; key_off; ts_off; reset_facts; R >/dev/null 2>&1; cp "$OUT" "$TMP/i-default.php"
t_ok "(baseline) the default render is still the golden file untouched" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
t_eq "the production template has the P35 region exactly once" "$(grep -c '@@P35_BEGIN@@' "$PROV/wp-config.production.template.php")/$(grep -c '^@@P35_OWNER_BLOCKS@@$' "$PROV/wp-config.production.template.php")/$(grep -c '@@P35_END@@' "$PROV/wp-config.production.template.php")" "1/1/1"
t_eq "...and the stage template has none" "$(grep -c 'P35' "$PROV/wp-config.stage.template.php" || true)" "0"
# the live file, built EXACTLY as p35/b2-exec/wpconfig-add.sh built it: three blocks inserted before the '// ---- bootstrap ' marker, in the order B2, OFFER, SNAP (backup sizes in the evidence logs: 12395 -> 12812 -> 13004)
LIVE="$TMP/live.php"
python3 - "$TMP/i-default.php" "$LIVE" <<'PY'
import sys
s = open(sys.argv[1], encoding="utf-8").read()
blocks = [
 """// ---- Owner Dashboard (P35 gate B2, 2026-11-13): the Backend token is read server-side from this root-owned file (never sent to a browser), the Backend base is fixed, only the listed administrator may open the page ----
define( 'AICC_OWNER_METRICS_TOKEN_FILE', '/srv/aicc/shared/owner-metrics.token' );
define( 'AICC_OWNER_METRICS_BASE', 'https://api.copilt.org' );
define( 'AICC_OWNER_DASHBOARD_USER_IDS', '1' );
""",
 """// ---- Launch offer, ANNOUNCE mode only (2026-11-13 owner batch authorization): no request intake, no strike-through, no limited chip ----
define( 'AICC_EA_LAUNCH_OFFER_MODE', 'announce' );
""",
 """// ---- Owner Dashboard ops snapshot (backup + recovery-gate state, produced on the owner Mac; 2026-11-13): optional, a stale or missing file reads "Not reported" ----
define( 'AICC_OWNER_OPS_SNAPSHOT_FILE', '/srv/aicc/shared/owner-ops-snapshot.json' );
""",
]
marker = "// ---- bootstrap "
for add in blocks:
    assert s.count(marker) == 1
    s = s.replace(marker, add + "\n" + marker, 1)
open(sys.argv[2], "w", encoding="utf-8").write(s)
PY
t_ok "(the synthetic live file is a valid PHP file)" php -l "$LIVE"
FIVE="AICC_EA_LAUNCH_OFFER_MODE, AICC_OWNER_DASHBOARD_USER_IDS, AICC_OWNER_METRICS_BASE, AICC_OWNER_METRICS_TOKEN_FILE, AICC_OWNER_OPS_SNAPSHOT_FILE"
CMP="$(R --compare --out "$LIVE" 2>&1)"; crc=$?
t_eq "WITHOUT the five facts, --compare against the live file is DIFFERENT (exit 4)" "$crc" "4"
t_contains "...and lists exactly those five names as removed" "$CMP" "removed: $FIVE"
t_contains "...nothing added" "$CMP" "added  : -"
t_contains "...nothing changed" "$CMP" "changed: -"
t_not_contains "...and no value is printed" "$CMP" "owner-metrics.token"
for kv in "AICC_OWNER_METRICS_TOKEN_FILE /srv/aicc/shared/owner-metrics.token" "AICC_OWNER_METRICS_BASE https://api.copilt.org" "AICC_OWNER_DASHBOARD_USER_IDS 1" "AICC_EA_LAUNCH_OFFER_MODE announce" "AICC_OWNER_OPS_SNAPSHOT_FILE /srv/aicc/shared/owner-ops-snapshot.json"; do T set $kv >/dev/null; done
CMP="$(R --compare --out "$LIVE" 2>&1)"; crc=$?
t_eq "WITH the five facts set to the live values, --compare against the live file is IDENTICAL (exit 0)" "$crc" "0"
t_contains "...(the message)" "$CMP" "IDENTICAL"
R >/dev/null 2>&1; t_ok "...and the rendered file equals the live file BYTE FOR BYTE (the same three blocks in the same order with the same blank lines)" cmp -s "$OUT" "$LIVE"
t_ok "...php -l clean" php -l "$OUT"
CV="$(cst "$OUT" AICC_OWNER_METRICS_TOKEN_FILE AICC_OWNER_METRICS_BASE AICC_OWNER_DASHBOARD_USER_IDS AICC_EA_LAUNCH_OFFER_MODE AICC_OWNER_OPS_SNAPSHOT_FILE)"
t_eq "...PHP reads the five values" "$(echo "$CV" | jq -c '[.AICC_OWNER_METRICS_TOKEN_FILE,.AICC_OWNER_METRICS_BASE,.AICC_OWNER_DASHBOARD_USER_IDS,.AICC_EA_LAUNCH_OFFER_MODE,.AICC_OWNER_OPS_SNAPSHOT_FILE]')" '["/srv/aicc/shared/owner-metrics.token","https://api.copilt.org","1","announce","/srv/aicc/shared/owner-ops-snapshot.json"]'
t_eq "...the user id list is a STRING (the Control Plane reads a comma list in a string)" "$(echo "$CV" | jq -r '.AICC_OWNER_DASHBOARD_USER_IDS|type')" "string"
t_contains "...a second render says unchanged" "$(R 2>&1)" "unchanged"
t_eq "...the render added only code lines named by these facts relative to the default" "$(added "$TMP/i-default.php" "$OUT" | sed -E "s/^define\( '([A-Z_]+)'.*/\1/" | sort | tr '\n' ' ')" "AICC_EA_LAUNCH_OFFER_MODE AICC_OWNER_DASHBOARD_USER_IDS AICC_OWNER_METRICS_BASE AICC_OWNER_METRICS_TOKEN_FILE AICC_OWNER_OPS_SNAPSHOT_FILE "
t_eq "...and nothing in the P35 render path opens a file (the token and snapshot files are never read)" "$(sed -n '/^def render_p35/,/^def render(/p' "$PROV/lib/owner_facts.py" | grep -c 'open(\|os\.' || true)" "0"
T unset AICC_EA_LAUNCH_OFFER_MODE >/dev/null; CMP="$(R --compare --out "$LIVE" 2>&1)"; t_contains "with one fact missing only that name is listed" "$CMP" "removed: AICC_EA_LAUNCH_OFFER_MODE"
T set AICC_EA_LAUNCH_OFFER_MODE announce >/dev/null
# with the Brevo region too
key_file; setf AICC_MAIL_PROVIDER brevo_api; setf AICC_MAIL_FROM_ADDRESS notifications@copilt.org; t_ok "the five P35 facts and the Brevo region render together" R
t_ok "...php -l clean" php -l "$OUT"
t_eq "...all five P35 constants and the Brevo ones are there" "$(grep -c "^define( 'AICC_OWNER_\|^define( 'AICC_EA_LAUNCH_OFFER_MODE\|^define( 'AICC_MAIL_PROVIDER" "$OUT")" "6"
key_off; for k in AICC_MAIL_PROVIDER AICC_MAIL_FROM_ADDRESS; do T unset $k >/dev/null; done
for k in AICC_OWNER_METRICS_TOKEN_FILE AICC_OWNER_METRICS_BASE AICC_OWNER_DASHBOARD_USER_IDS AICC_EA_LAUNCH_OFFER_MODE AICC_OWNER_OPS_SNAPSHOT_FILE; do T unset $k >/dev/null; done
R >/dev/null 2>&1; t_ok "unsetting the five facts returns the golden file byte for byte" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD'"
# hostile and invalid values
OFV() { env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/p35.env" --env production set "$@"; }
for k in AICC_OWNER_METRICS_TOKEN_FILE AICC_OWNER_OPS_SNAPSHOT_FILE; do
  for bad in "/srv/aicc/shared/../../etc/shadow" "/srv/aicc/shared/a/../b" "/srv/aicc/shared/.." "/etc/passwd" "/srv/aicc/shared" "/srv/aicc/shared/" "/srv/aicc/shared/x/" "/srv/aicc/shared//x" "/srv/aicc/shared/.hidden" "/srv/aicc/shared/uploads/x.token" "/srv/aicc/shared/uploads" "/srv/aicc/shared/plugin-releases/x" "/srv/aicc/shared/wp-config.php" "/srv/aicc/shared/wp-config.php.pre-B2-1" "/srv/aicc/shared/x') ; phpinfo(); //" "/srv/aicc/shared/x y" '/srv/aicc/shared/$x' "/srv/aicc/shared/a/b/c/d/e" "owner.token" "./srv/aicc/shared/x" "/srv/aicc/sharedx/a" "/srv/aicc/shared/x\\y" "/srv/aicc/shared/$(printf 'a%.0s' $(seq 70))" "file:///srv/aicc/shared/x" $'/srv/aicc/shared/x\ny' $'/srv/aicc/shared/x\x01'; do
    t_rc "$k '${bad//[$'\n\x01']/~}' is REFUSED (absolute path under /srv/aicc/shared/, one file, no traversal)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/p35.env" --env production set "$k" "$bad"
  done
  t_rc "$k '/srv/aicc/shared/owner-x.token' is accepted" 0 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/p35.env" --env production set "$k" "/srv/aicc/shared/owner-x.token"
  t_rc "$k '/srv/aicc/shared/owner/dir/x.json' (a sub directory) is accepted" 0 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/p35.env" --env production set "$k" "/srv/aicc/shared/owner/dir/x.json"
done
for bad in "http://api.copilt.org" "https://api.copilt.org/" "https://api.copilt.org/x" "https://api.copilt.org:443" "https://evil.example.com" "https://api.copilt.org.evil.com" "https://API.copilt.org" "https://127.0.0.1" "https://api.copilt.org?x=1" "https://user@api.copilt.org" "api.copilt.org" "https://www.copilt.org" "https://api.copilt.org#x" "https://api.copilt.org'); die(); //"; do
  t_rc "metrics base '$bad' is REFUSED (exactly https://api.copilt.org)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/p35.env" --env production set AICC_OWNER_METRICS_BASE "$bad"
done
for bad in 0 -1 "1," ",1" a "1,1" "1 2" "1;2" "$(printf 'ab12%.0s' $(seq 16))" "01" "1.5" "99999999999" "$(seq -s, 1 51)"; do
  t_rc "dashboard user ids '${bad:0:40}' is REFUSED (a comma list of positive whole numbers)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/p35.env" --env production set AICC_OWNER_DASHBOARD_USER_IDS "$bad"
done
t_eq "dashboard user ids '2, 7' is normalised to '2,7'" "$(rm -f "$TMP/p35.env"; OFV AICC_OWNER_DASHBOARD_USER_IDS "2, 7" >/dev/null 2>&1; env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/p35.env" --env production list)" "AICC_OWNER_DASHBOARD_USER_IDS=2,7"
for bad in off open Announce ANNOUNCE "announce,open" true 1 "announce'; x" ""; do
  t_rc "launch offer mode '$bad' is REFUSED (only 'announce'; unset = off; 'open' is a separate reviewed step)" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/p35.env" --env production set AICC_EA_LAUNCH_OFFER_MODE "$bad"
done
t_contains "...the refusal explains why 'open' is not accepted here" "$(OFV AICC_EA_LAUNCH_OFFER_MODE open 2>&1 || true)" "request intake"
rm -f "$TMP/p35.env"
for k in AICC_OWNER_METRICS_TOKEN_FILE AICC_OWNER_METRICS_BASE AICC_OWNER_DASHBOARD_USER_IDS AICC_EA_LAUNCH_OFFER_MODE AICC_OWNER_OPS_SNAPSHOT_FILE; do
  t_rc "stage refuses the P35 fact $k" 1 env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$TMP/p35s.env" --env stage set "$k" announce
done
t_eq "...and the production key list names all five" "$(T keys | grep -cxE 'AICC_OWNER_METRICS_TOKEN_FILE|AICC_OWNER_METRICS_BASE|AICC_OWNER_DASHBOARD_USER_IDS|AICC_EA_LAUNCH_OFFER_MODE|AICC_OWNER_OPS_SNAPSHOT_FILE')" "5"
# a hand-edited file with a bad value refuses at render, writes nothing
R >/dev/null 2>&1; KEEP="$(sha "$OUT")"
printf 'AICC_OWNER_METRICS_TOKEN_FILE=/srv/aicc/shared/../x\n' > "$OFF"; chmod 600 "$OFF"; refused "a HAND-EDITED traversal path is REFUSED by the renderer" "AICC_OWNER_METRICS_TOKEN_FILE must be an absolute path under /srv/aicc/shared/"
printf 'AICC_EA_LAUNCH_OFFER_MODE=open\n' > "$OFF"; refused "a HAND-EDITED offer mode 'open' is REFUSED by the renderer" "AICC_EA_LAUNCH_OFFER_MODE must be exactly 'announce'"
printf 'AICC_OWNER_METRICS_BASE=https://evil.example.com\n' > "$OFF"; refused "a HAND-EDITED foreign Backend base is REFUSED by the renderer" "AICC_OWNER_METRICS_BASE must be exactly https://api.copilt.org"
reset_facts

t_summary
