#!/usr/bin/env bash
# P44 trust anchor: the ONE owner-facts update that gives the production Control Plane its Plugin-release trust anchor, AICC_LM_PLUGIN_SIGNING_PUBKEYS (the owner's two PUBLIC Ed25519 keys, primary first).
# SYNTHETIC fixtures only (infra/stack-tests/fixtures/), no host read. The keys are THROWAWAY public test values (deterministic bytes 100..131 and 140..171, fingerprints e3e1-6780-becf-601d, c494-7fda-ceb8-8f1e), NOT any real signing key; the RETIRED P44 pair is only used by the refusal tests in group R (P45).
#   F  the two fingerprints are recomputed here with an independent implementation (python hashlib; the Control Plane's rule: first 16 hex of SHA-256 over the 32 raw bytes, groups of four)
#   L  the live-shaped facts (p42-live) render WITHOUT the constant (equal to the p42-live golden); with the one new fact the render equals golden/wp-config.production.p44-trustanchor.php byte for byte
#   C  --compare of the new facts against the live-shaped file: exit 4, added = AICC_LM_PLUGIN_SIGNING_PUBKEYS, removed -, changed -; no value printed; nothing written; IDENTICAL after the render
#   B  the same single addition on top of a second base (the p42 stage-1 facts): added = that one name only
#   U  rollback: `unset` + render returns the live-shaped render byte for byte; --compare before that names the constant as REMOVED
#   R  what the tool REFUSES (empty entry, three keys, a duplicate, a 64-byte secret-key shape, 31 bytes, non-base64, PHP injection) and what it does NOT (one key, reversed order: documented, not enforced)
# Regenerate the golden deliberately: AICC_UPDATE_GOLDEN=1 bash infra/stack-tests/test_p44_trustanchor.sh   (review the diff!)
# Run: bash infra/stack-tests/test_p44_trustanchor.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; INFRA="$REPO/infra"; PROV="$INFRA/provision"; FIX="$HERE/fixtures"
T_SUITE="p44-trustanchor"; . "$HERE/lib/t.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ap44t.XXXX")"; trap 'rm -rf "$TMP"' EXIT
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
FIVE="AICC_EA_LAUNCH_OFFER_MODE AICC_OWNER_DASHBOARD_USER_IDS AICC_OWNER_METRICS_BASE AICC_OWNER_METRICS_TOKEN_FILE AICC_OWNER_OPS_SNAPSHOT_FILE"
brevo_on() { printf '%s\n' 'xkeysib-TEST-NOT-A-REAL-KEY-0000' > "$MAILD/brevo-api.key"; chmod 640 "$MAILD/brevo-api.key"; }
GOLD_LIVE="$HERE/golden/wp-config.production.p42-live.php"; GOLD_TA="$HERE/golden/wp-config.production.p44-trustanchor.php"
PRIMARY='ZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1+f4CBgoM='; STANDBY='jI2Oj5CRkpOUlZaXmJmam5ydnp+goaKjpKWmp6ipqqs='; CONST=AICC_LM_PLUGIN_SIGNING_PUBKEYS
cmp_field() { printf '%s' "$1" | sed -n "s/^  $2 *: //p" | tr -d ','; }
fpr() { python3 -c 'import base64,hashlib,sys; r=base64.b64decode(sys.argv[1],validate=True); assert len(r)==32; h=hashlib.sha256(r).hexdigest()[:16]; print("-".join(h[i:i+4] for i in range(0,16,4)))' "$1"; }

echo "== F. the fingerprints, recomputed independently =="
t_eq "primary fingerprint" "$(fpr "$PRIMARY")" "e3e1-6780-becf-601d"
t_eq "standby fingerprint" "$(fpr "$STANDBY")" "c494-7fda-ceb8-8f1e"
t_eq "the fixture holds exactly primary,standby (primary first)" "$(sed -n "s/^$CONST=//p" "$FIX/owner-facts.production.p44-trustanchor.env")" "$PRIMARY,$STANDBY"
t_eq "the new fixture is the p42-live fixture plus that ONE line (nothing else differs)" "$(diff <(grep -v '^#' "$FIX/owner-facts.production.p42-live.env") <(grep -v '^#' "$FIX/owner-facts.production.p44-trustanchor.env") | grep -c '^[<>]')/$(diff <(grep -v '^#' "$FIX/owner-facts.production.p42-live.env") <(grep -v '^#' "$FIX/owner-facts.production.p44-trustanchor.env") | grep '^>' | cut -c3-32)" "1/$CONST"

echo "== L. the live-shaped render, and the render with the one new fact =="
brevo_on; facts_from "$FIX/owner-facts.production.p42-live.env"
t_ok "the p42-live facts render" R
t_ok "...equal to the p42-live golden (the trust-anchor step has not changed today's render)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD_LIVE'"
t_eq "...and the constant is NOT defined" "$(cst "$OUT" $CONST)" '{"AICC_LM_PLUGIN_SIGNING_PUBKEYS":null}'
cp "$OUT" "$TMP/live.php"; cp "$OUT" "$TMP/live-file.php"; chmod 640 "$TMP/live-file.php"; H0="$(shasum -a 256 "$TMP/live-file.php" | cut -d' ' -f1)"
facts_from "$FIX/owner-facts.production.p44-trustanchor.env"
t_ok "the facts with AICC_LM_PLUGIN_SIGNING_PUBKEYS render" R
t_ok "...php -l clean" php -l "$OUT"
if [ "${AICC_UPDATE_GOLDEN:-0}" = 1 ]; then sed -E 's/[0-9a-f]{64}/HEX64/g' "$OUT" > "$GOLD_TA"; echo "golden regenerated: $GOLD_TA"; fi
t_ok "...equal to golden/wp-config.production.p44-trustanchor.php byte for byte (64-hex values normalised)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUT') '$GOLD_TA'"
t_eq "...the constant is exactly '<primary>,<standby>' (a string)" "$(cst "$OUT" $CONST | jq -r .$CONST)" "$PRIMARY,$STANDBY"
t_eq "...as ONE define line" "$(grep -c "^define( '$CONST'" "$OUT")" "1"
t_eq "...relative to the live-shaped render it ADDS exactly that constant" "$(comm -13 <(defnames "$TMP/live.php") <(defnames "$OUT") | tr '\n' ' ')" "$CONST "
t_eq "...removes none" "$(comm -23 <(defnames "$TMP/live.php") <(defnames "$OUT") | wc -l | tr -d ' ')" "0"
t_eq "...and no live define changes its value (every other line is byte for byte the live line)" "$(comm -23 <(deflines "$TMP/live.php") <(deflines "$OUT") | wc -l | tr -d ' ')" "0"
t_eq "...the five P35 constants and the Brevo mail constants are unchanged" "$(cst "$OUT" $FIVE AICC_MAIL_PROVIDER AICC_MAIL_DAILY_BUDGET WP_ACCESSIBLE_HOSTS | jq -S -c .)" "$(cst "$TMP/live.php" $FIVE AICC_MAIL_PROVIDER AICC_MAIL_DAILY_BUDGET WP_ACCESSIBLE_HOSTS | jq -S -c .)"
t_eq "...and no commerce, trial-signup or legal-approval constant appears" "$(cst "$OUT" AICC_COMMERCE_OPEN AICC_TRIAL_SELF_SERVICE_ENABLED AICC_TRIAL_SELF_SERVICE_CAP AICC_LEGAL_REVIEW_APPROVED | jq -c '[.[]]')" '[null,null,null,null]'
cp "$OUT" "$TMP/ta.php"

echo "== C. --compare names only, writes nothing =="
CMP="$(R --compare --out "$TMP/live-file.php" 2>&1)"; crc=$?
t_eq "new facts vs the live-shaped file: DIFFERENT (exit 4)" "$crc" "4"
t_eq "...added = AICC_LM_PLUGIN_SIGNING_PUBKEYS only; removed -; changed -" "$(cmp_field "$CMP" added)/$(cmp_field "$CMP" removed)/$(cmp_field "$CMP" changed)" "$CONST/-/-"
t_not_contains "...no key value is printed (primary)" "$CMP" "$PRIMARY"
t_not_contains "...no key value is printed (standby)" "$CMP" "$STANDBY"
t_eq "...the file compared against is untouched" "$(shasum -a 256 "$TMP/live-file.php" | cut -d' ' -f1)" "$H0"
[ "${AICC_SHOW_COMPARE:-0}" = 1 ] && { echo "---- --compare output (new facts vs the live-shaped file) ----"; printf '%s\n' "$CMP"; echo "----"; }
cp "$TMP/ta.php" "$TMP/ta-file.php"; chmod 640 "$TMP/ta-file.php"
CMP="$(R --compare --out "$TMP/ta-file.php" 2>&1)"; crc=$?
t_eq "after the render and the reload: --compare is IDENTICAL (exit 0)" "$crc/$(printf '%s' "$CMP" | grep -c 'IDENTICAL')" "0/1"

echo "== B. the same single addition on a second base (the p42 stage-1 facts) =="
facts_from "$FIX/owner-facts.production.p42-stage1.env"; ts_on() { printf '%s\n' '0x4AAAAAAATSsecretVALUE0123456789abcdef' > "$MAILD/turnstile.secret"; chmod 640 "$MAILD/turnstile.secret"; }; ts_on
t_ok "stage-1 facts render" R
cp "$OUT" "$TMP/s1-file.php"; chmod 640 "$TMP/s1-file.php"
t_ok "...the stage-1 facts plus the one fact: set accepted" T set $CONST "$PRIMARY,$STANDBY"
CMP="$(R --compare --out "$TMP/s1-file.php" 2>&1)"; crc=$?
t_eq "...--compare: exit 4, added = the constant only, removed -, changed -" "$crc/$(cmp_field "$CMP" added)/$(cmp_field "$CMP" removed)/$(cmp_field "$CMP" changed)" "4/$CONST/-/-"

echo "== U. rollback =="
rm -f "$MAILD/turnstile.secret"
facts_from "$FIX/owner-facts.production.p44-trustanchor.env"
t_ok "unset removes the fact" T unset $CONST
t_not_contains "...it is gone from the list" "$(T list)" "$CONST"
CMP="$(R --compare --out "$TMP/ta-file.php" 2>&1)"; crc=$?
t_eq "--compare of the unset facts vs the file that HAS the constant: exit 4, added -, removed = the constant, changed -" "$crc/$(cmp_field "$CMP" added)/$(cmp_field "$CMP" removed)/$(cmp_field "$CMP" changed)" "4/-/$CONST/-"
t_ok "...the rollback render succeeds" R
t_ok "...and equals the live-shaped render byte for byte" cmp -s "$OUT" "$TMP/live.php"

echo "== R. what the owner-facts tool refuses and what it does not =="
facts_from "$FIX/owner-facts.production.p42-live.env"
SECRET64="$(python3 -c 'import base64;print(base64.b64encode(bytes(range(64))).decode())')"; K31="$(python3 -c 'import base64;print(base64.b64encode(bytes(range(31))).decode())')"; THIRD="$(python3 -c 'import base64;print(base64.b64encode(bytes(range(7,39))).decode())')"
rc_keep() { local n="$1" want="$2"; shift 2; local h1 h2; h1="$(shasum -a 256 "$OFF" | cut -d' ' -f1)"; t_rc "$n" "$want" "$@"; h2="$(shasum -a 256 "$OFF" | cut -d' ' -f1)"; [ "$want" = 0 ] || t_eq "   ...and the facts file is unchanged" "$h2" "$h1"; }
rc_keep "a 64-byte value (an Ed25519 SECRET key shape) is REFUSED" 1 T set $CONST "$SECRET64"
rc_keep "a secret-key-shaped value as the second entry is REFUSED" 1 T set $CONST "$PRIMARY,$SECRET64"
rc_keep "a 31-byte value is REFUSED" 1 T set $CONST "$K31"
rc_keep "a stray trailing comma is REFUSED" 1 T set $CONST "$PRIMARY,"
rc_keep "three keys are REFUSED (the Control Plane reads at most two)" 1 T set $CONST "$PRIMARY,$STANDBY,$THIRD"
rc_keep "the same key twice is REFUSED" 1 T set $CONST "$PRIMARY,$PRIMARY"
rc_keep "non-base64 text is REFUSED" 1 T set $CONST "not-a-key-not-a-key-not-a-key-not-a-key-12="
rc_keep "a value with a quote and PHP is REFUSED" 1 T set $CONST "$PRIMARY');phpinfo();//"
OLDP='yCsFX6176Ue5ZTdi4Dr99J9LFM43jXrN6Kbp13KF04Y='; OLDS='5p50qA1SYMTV7MXeDAWfMnNqLKVuTRDVS4FREuKuQwM='     # the RETIRED (P45) lost-vault PUBLIC keys: refused, never accepted as a trust anchor
retired_refused() { local n="$1"; shift; local h1 h2 o rc=0; h1="$(shasum -a 256 "$OFF" | cut -d' ' -f1)"; o="$(T "$@" 2>&1)" || rc=$?; h2="$(shasum -a 256 "$OFF" | cut -d' ' -f1)"
  if [ "$rc" = 1 ] && printf '%s' "$o" | grep -qi "retired" && [ "$h1" = "$h2" ]; then t_pass "$n"; else t_bad "$n" "rc=$rc, wanted 1 + 'retired' + facts file unchanged: $(printf '%s' "$o" | tail -2 | tr '\n' '|')"; fi; }
retired_refused "the RETIRED old primary alone is REFUSED, naming it retired (P45)" set $CONST "$OLDP"
retired_refused "the RETIRED old standby alone is REFUSED" set $CONST "$OLDS"
retired_refused "the retired old PAIR (the exact P44 value) is REFUSED" set $CONST "$OLDP,$OLDS"
retired_refused "a retired key beside a NEW key is REFUSED (OLD+NEW would keep the retired key co-trusted)" set $CONST "$PRIMARY,$OLDP"
retired_refused "a NEW key beside the retired old standby is REFUSED (either position)" set $CONST "$OLDS,$PRIMARY"
t_contains "the refusal message names the retired fingerprint and the date of the rule" "$(T set $CONST "$OLDP" 2>&1)" "9d49-041f-0ced-13ac"
rc_keep "ONE key (the primary alone) is ACCEPTED (the Control Plane serves with one key; the standby is optional)" 0 T set $CONST "$PRIMARY"
t_eq "...stored as given" "$(T list | sed -n "s/^$CONST=//p")" "$PRIMARY"
rc_keep "the REVERSED order (standby first) is ACCEPTED: the tool does not know which key is the primary; the order is the owner's to get right (the Control Plane tries every key, so it is not a security issue, but it is wrong for the records)" 0 T set $CONST "$STANDBY,$PRIMARY"
t_eq "...and stored reversed, as given" "$(T list | sed -n "s/^$CONST=//p")" "$STANDBY,$PRIMARY"
rc_keep "blanks around the comma are accepted and the stored value is canonical (no blanks)" 0 T set $CONST "$PRIMARY , $STANDBY"
t_eq "...stored canonically" "$(T list | sed -n "s/^$CONST=//p")" "$PRIMARY,$STANDBY"
t_summary
