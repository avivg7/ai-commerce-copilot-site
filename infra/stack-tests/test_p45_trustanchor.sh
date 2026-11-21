#!/usr/bin/env bash
# P45 trust anchor, NEW KEYS: the planning helper infra/release/trust-anchor-plan.sh. The owner lost the passphrases of both signing vaults, so the OLD key pairs are replaced by new ones;
# the OLD public keys must NEVER become the production trust anchor. THROWAWAY keys only here (deterministic test bytes, never a real key); no host read, no ssh (a fake ssh in PATH proves the helper never calls one).
#   O  the OLD keys are refused in either position, by value and by fingerprint in a handover file (this group was written FIRST and failed before the refusal existed)
#   V  validation exactly as the owner-facts tool: secret-key shape, 31 bytes, non-base64, identical keys, an arg that smuggles a second key, wrong arity
#   H  handover file: right order accepted, wrong order refused, fingerprint mismatch refused, a secret-looking file refused, a missing file refused
#   P  the plan: both fingerprints computed two ways, the exact command block (golden), no old key in it, nothing executed
#   L  the local renderer proof: live-shaped facts + the one fact -> --compare added = the constant only, removed -, changed -; golden render with the throwaway keys
# Regenerate the goldens deliberately: AICC_UPDATE_GOLDEN=1 bash infra/stack-tests/test_p45_trustanchor.sh   (review the diff!)
# Run: bash infra/stack-tests/test_p45_trustanchor.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; INFRA="$REPO/infra"; PROV="$INFRA/provision"; FIX="$HERE/fixtures"; PLAN="$INFRA/release/trust-anchor-plan.sh"
T_SUITE="p45-trustanchor"; . "$HERE/lib/t.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ap45t.XXXX")"; trap 'rm -rf "$TMP"' EXIT
for tool in php python3 jq; do command -v "$tool" >/dev/null 2>&1 || { echo "need $tool"; exit 2; }; done
b64() { python3 -c 'import base64,sys;print(base64.b64encode(bytes(range(int(sys.argv[1]),int(sys.argv[1])+int(sys.argv[2])))).decode())' "$1" "$2"; }
fpr() { python3 -c 'import base64,hashlib,sys; r=base64.b64decode(sys.argv[1],validate=True); h=hashlib.sha256(r).hexdigest()[:16]; print("-".join(h[i:i+4] for i in range(0,16,4)))' "$1"; }
NP='yCsFX6176Ue5ZTdi4Dr99J9LFM43jXrN6Kbp13KF04Y='; NS='5p50qA1SYMTV7MXeDAWfMnNqLKVuTRDVS4FREuKuQwM='      # the OLD (lost-vault) PUBLIC keys: must be refused
OP_FP='9d49-041f-0ced-13ac'; OS_FP='be7f-3dda-cddd-d781'
A="$(b64 0 32)"; B="$(b64 1 32)"; C="$(b64 2 32)"; S64="$(b64 0 64)"; K31="$(b64 0 31)"; AFP="$(fpr "$A")"; BFP="$(fpr "$B")"
mkdir -p "$TMP/bin"; printf '#!/bin/sh\necho "$0 $*" >> "%s/ssh-called"\nexit 99\n' "$TMP" > "$TMP/bin/ssh"; cp "$TMP/bin/ssh" "$TMP/bin/pssh"; chmod +x "$TMP/bin/ssh" "$TMP/bin/pssh"
P() { env PATH="$TMP/bin:$PATH" bash "$PLAN" "$@"; }
refused() { local n="$1" needle="$2"; shift 2; local o rc=0; o="$(P "$@" 2>&1)" || rc=$?; if [ "$rc" = 3 ] && printf '%s' "$o" | grep -qi -- "$needle" && ! printf '%s' "$o" | grep -q "aicc-owner-facts set"; then t_pass "$n"; else t_bad "$n" "rc=$rc; $(printf '%s' "$o" | tail -2 | tr '\n' '|' | cut -c1-300)"; fi; }
H() { printf '%s\n' "$@" > "$TMP/handover.txt"; chmod 600 "$TMP/handover.txt"; }

echo "== O. the OLD keys are refused =="
refused "the old PRIMARY as the primary is refused" "old" "$NP" "$B"
refused "the old STANDBY as the standby is refused" "old" "$A" "$NS"
refused "the old primary in the standby position is refused" "old" "$A" "$NP"
refused "the old standby in the primary position is refused" "old" "$NS" "$B"
refused "both old keys together (the exact P44 value) are refused" "old" "$NP" "$NS"
H "PRIMARY_PUBKEY=$A" "PRIMARY_FP=$OP_FP" "STANDBY_PUBKEY=$B" "STANDBY_FP=$BFP"
refused "a handover that quotes an OLD fingerprint is refused (even when the keys passed are new)" "old" "$A" "$B" --handover-file "$TMP/handover.txt"
H "PRIMARY_PUBKEY=$NP" "PRIMARY_FP=$OP_FP" "STANDBY_PUBKEY=$NS" "STANDBY_FP=$OS_FP"
refused "a handover that holds the OLD keys is refused" "old" "$A" "$B" --handover-file "$TMP/handover.txt"

echo "== V. validation exactly as the owner-facts tool =="
refused "a 64-byte value (an Ed25519 SECRET key shape) is refused" "32-byte" "$S64" "$B"
refused "a 64-byte value as the standby is refused" "32-byte" "$A" "$S64"
refused "a 31-byte value is refused" "32 bytes\|32-byte" "$K31" "$B"
refused "non-base64 text is refused" "not" "not-a-key-not-a-key-not-a-key-not-a-key-12=" "$B"
refused "identical primary and standby are refused" "same key" "$A" "$A"
refused "an argument that smuggles a second key (comma) is refused" "one key" "$A,$C" "$B"
refused "an argument with a blank is refused" "" "$A " "$B"
t_rc "no arguments: usage, exit 2" 2 P
t_rc "one key only: usage, exit 2" 2 P "$A"
t_rc "three positional arguments: usage, exit 2" 2 P "$A" "$B" "$C"

echo "== H. handover file =="
H "# the owner's handover (public values only)" "PRIMARY_PUBKEY=$A" "PRIMARY_FP=$AFP" "STANDBY_PUBKEY=$B" "STANDBY_FP=$BFP"
t_rc "a matching handover is accepted" 0 P "$A" "$B" --handover-file "$TMP/handover.txt"
refused "WRONG ORDER (standby passed first) against the handover is refused" "order" "$B" "$A" --handover-file "$TMP/handover.txt"
H "PRIMARY_PUBKEY=$A" "PRIMARY_FP=$BFP" "STANDBY_PUBKEY=$B" "STANDBY_FP=$BFP"
refused "a handover fingerprint that is not the key's fingerprint is refused" "fingerprint" "$A" "$B" --handover-file "$TMP/handover.txt"
H "PRIMARY_PUBKEY=$C" "STANDBY_PUBKEY=$B"
refused "a handover naming a different primary is refused" "handover" "$A" "$B" --handover-file "$TMP/handover.txt"
H "PRIMARY_PUBKEY=$A" "STANDBY_PUBKEY=$B" "SECRET=$S64"
refused "a handover that carries a secret-key-shaped value is refused" "secret" "$A" "$B" --handover-file "$TMP/handover.txt"
H "-----BEGIN PRIV""ATE KEY-----"
refused "a handover that looks like a private key file is refused" "secret\|private" "$A" "$B" --handover-file "$TMP/handover.txt"
refused "a missing handover file is refused" "handover" "$A" "$B" --handover-file "$TMP/nope.txt"
H "PRIMARY_PUBKEY=$A" "STANDBY_PUBKEY=$B"
t_rc "a handover with the keys only (no fingerprints) is accepted" 0 P "$A" "$B" --handover-file "$TMP/handover.txt"

echo "== P. the plan =="
ST0="$(git -C "$REPO" status --porcelain 2>/dev/null | shasum -a 256)"
OUT="$(P "$A" "$B" 2>&1)"; rc=$?
t_eq "plan exits 0 for two valid throwaway keys" "$rc" "0"
t_contains "...prints the primary fingerprint computed two ways (and says they agree)" "$OUT" "primary  $AFP  (python hashlib = shell sha256: agree)"
t_contains "...prints the standby fingerprint computed two ways" "$OUT" "standby  $BFP  (python hashlib = shell sha256: agree)"
t_contains "...the exact set command with the real values, primary first" "$OUT" "sudo aicc-owner-facts set AICC_LM_PLUGIN_SIGNING_PUBKEYS '$A,$B'"
t_not_contains "...no OLD key in the block (primary)" "$OUT" "$NP"
t_not_contains "...no OLD key in the block (standby)" "$OUT" "$NS"
t_not_contains "...no OLD fingerprint in the block" "$OUT" "$OP_FP"
t_contains "...carries the expected compare diff" "$OUT" "added  : AICC_LM_PLUGIN_SIGNING_PUBKEYS"
t_contains "...says nothing was applied" "$OUT" "NOTHING HAS BEEN APPLIED"
t_eq "...never called ssh/pssh (the helper only prints)" "$(ls "$TMP/ssh-called" 2>/dev/null | wc -l | tr -d ' ')" "0"
GOLD_PLAN="$HERE/golden/trust-anchor-plan.p45-throwaway.txt"
if [ "${AICC_UPDATE_GOLDEN:-0}" = 1 ]; then printf '%s\n' "$OUT" > "$GOLD_PLAN"; echo "golden regenerated: $GOLD_PLAN"; fi
t_ok "...the whole plan equals golden/trust-anchor-plan.p45-throwaway.txt byte for byte" bash -c "diff <(printf '%s\n' \"\$1\") '$GOLD_PLAN'" _ "$OUT"
t_eq "...the plan is deterministic (a second run is identical)" "$(P "$A" "$B" 2>&1 | shasum -a 256)" "$(printf '%s\n' "$OUT" | shasum -a 256)"
t_eq "...the working tree is untouched by the helper (status before = after)" "$(git -C "$REPO" status --porcelain 2>/dev/null | shasum -a 256)" "$ST0"

echo "== L. the local renderer proof (live-shaped facts + the ONE fact) =="
LP="$(P "$A" "$B" --local-proof 2>&1)"; lrc=$?
t_eq "--local-proof exits 0" "$lrc" "0"
t_contains "...--compare exit 4 (a render would change the live-shaped file)" "$LP" "compare exit 4"
t_eq "...added = the constant only" "$(printf '%s' "$LP" | sed -n 's/^  added  : //p')" "AICC_LM_PLUGIN_SIGNING_PUBKEYS"
t_eq "...removed -" "$(printf '%s' "$LP" | sed -n 's/^  removed: //p')" "-"
t_eq "...changed -" "$(printf '%s' "$LP" | sed -n 's/^  changed: //p')" "-"
t_contains "...a re-compare after the render is IDENTICAL" "$LP" "second compare: IDENTICAL"
t_not_contains "...no key value in the proof output beyond the command block" "$(printf '%s' "$LP" | sed -n '/^LOCAL PROOF/,$p')" "$A"
t_eq "...no scratch directory is left behind" "$(ls -d "${TMPDIR:-/tmp}"/aicc-trust-plan.* 2>/dev/null | wc -l | tr -d ' ')" "0"
# the golden render with THROWAWAY keys: the live-shaped facts + the one fact
SEC="$TMP/sec"; REL="$TMP/rel"; MAILD="$TMP/mail"; ABS="$TMP/abs"; OUTP="$TMP/prod.php"; OFF="$TMP/owner-facts.env"
mkdir -p "$SEC" "$REL" "$MAILD" "$ABS"; chmod 700 "$SEC"; chmod 750 "$REL" "$MAILD"; echo '<?php' > "$ABS/wp-settings.php"
HEX="$(printf 'ab12%.0s' $(seq 16))"; OFU="$(id -un):$(id -gn)"
printf 'golden_db_pass_0001\n' > "$SEC/db-cp.pass"
{ for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT; do printf '%s=SALTVALUE_%s\n' "$k" "$k"; done; printf 'AICC_ACTIVATION_PROOF_SECRET=%s\nAICC_ENTITLEMENT_WEBHOOK_SECRET=%s\n' "$HEX" "$HEX"; } > "$SEC/wp-secrets.env"; chmod 600 "$SEC/wp-secrets.env"
printf 'WEBHOOK-test-0123456789-0123456789-abcdef\n' > "$SEC/entitlement-webhook.secret"; printf 'PROOF-test-0123456789-0123456789-abcdefgh\n' > "$SEC/activation-proof.secret"; chmod 600 "$SEC/"*.secret
printf 'xkeysib-TEST-NOT-A-REAL-KEY-0000\n' > "$MAILD/brevo-api.key"; chmod 640 "$MAILD/brevo-api.key"; printf '0x4AAAAAAATSsecretVALUE0123456789abcdef\n' > "$MAILD/turnstile.secret"; chmod 640 "$MAILD/turnstile.secret"
R() { env AICC_TEST_HARNESS=1 bash "$PROV/render-wp-config.sh" --env production --confirm-production --out "${OUTF:-$OUTP}" --secrets-dir "$SEC" --mail-dir "$MAILD" --plugin-release-dir "$REL" --owner-facts-file "$OFF" --owner "$OFU" "$@"; }
T() { env AICC_TEST_HARNESS=1 bash "$PROV/owner-facts.sh" --file "$OFF" --env production "$@"; }
cst() { local f="$1"; shift; php -r 'define("ABSPATH",$argv[2]); require $argv[1]; $o=array(); foreach (array_slice($argv,3) as $n) { $o[$n]=defined($n)?constant($n):null; } echo json_encode($o);' "$f" "$ABS/" "$@"; }
defnames() { sed -n "s/^define( '\([A-Za-z0-9_]*\)'.*/\1/p" "$1" | sort; }
deflines() { grep -E "^define\( '" "$1" | sort; }
cp "$FIX/owner-facts.production.p45-live-shape.env" "$OFF"; chmod 600 "$OFF"
t_ok "the live-shaped facts (16 names) render" R
cp "$OUTP" "$TMP/live.php"; cp "$OUTP" "$TMP/live-file.php"; chmod 640 "$TMP/live-file.php"
t_ok "...Turnstile and notify are in the live-shaped render (they must survive)" bash -c "grep -q \"^define( 'AICC_TURNSTILE_SITE_KEY'\" '$TMP/live.php' && grep -q \"^define( 'AICC_NOTIFY_ENABLED'\" '$TMP/live.php'"
t_ok "set the throwaway fact" T set AICC_LM_PLUGIN_SIGNING_PUBKEYS "$A,$B"
t_ok "...and render" R
GOLD_R="$HERE/golden/wp-config.production.p45-trustanchor.php"
if [ "${AICC_UPDATE_GOLDEN:-0}" = 1 ]; then sed -E 's/[0-9a-f]{64}/HEX64/g' "$OUTP" > "$GOLD_R"; echo "golden regenerated: $GOLD_R"; fi
t_ok "...equal to golden/wp-config.production.p45-trustanchor.php byte for byte (throwaway keys, 64-hex normalised)" bash -c "diff <(sed -E 's/[0-9a-f]{64}/HEX64/g' '$OUTP') '$GOLD_R'"
t_eq "...adds exactly the one constant, removes none, changes none" "$(comm -13 <(defnames "$TMP/live.php") <(defnames "$OUTP") | tr '\n' ' ')/$(comm -23 <(defnames "$TMP/live.php") <(defnames "$OUTP") | wc -l | tr -d ' ')/$(comm -23 <(deflines "$TMP/live.php") <(deflines "$OUTP") | wc -l | tr -d ' ')" "AICC_LM_PLUGIN_SIGNING_PUBKEYS /0/0"
t_eq "...the constant holds the throwaway pair, primary first" "$(cst "$OUTP" AICC_LM_PLUGIN_SIGNING_PUBKEYS | jq -r .AICC_LM_PLUGIN_SIGNING_PUBKEYS)" "$A,$B"
t_not_contains "...the golden holds no OLD key" "$(cat "$GOLD_R")" "$NP"
t_summary
