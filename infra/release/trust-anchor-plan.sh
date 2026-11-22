#!/usr/bin/env bash
# PLANNING HELPER (prints only; applies NOTHING; never contacts a host) for the production trust-anchor owner fact AICC_LM_PLUGIN_SIGNING_PUBKEYS after the signing-key replacement (P45).
# The owner lost the passphrases of both OLD signing vaults, so the OLD key pairs are retired and NEW Ed25519 keys are generated on two USB sticks. This helper takes the two NEW PUBLIC keys
# (the 44-character `public key ...` lines `php bin/sign-release.php keygen` printed), checks them, and prints the exact owner-gated command block with the real values.
#
#   trust-anchor-plan.sh <primary_pub> <standby_pub> [--handover-file F [--handover-file F2]] [--local-proof]
#
#   Validation = exactly the owner-facts tool's rule (lib/owner_facts.py parse_signing_pubkeys: standard base64, 44 chars ending in '=', exactly 32 raw bytes, no duplicates), PLUS:
#     * the OLD public keys (and their fingerprints) are REFUSED, in either position, in the arguments and in a handover file: they must never become the production trust anchor;
#     * identical keys, an argument that carries two keys, a secret-key shape (64 bytes) are refused; each argument is ONE key;
#     * --handover-file F (give it once per file, at most two) says which key is the primary. F is either a key ceremony's JSON handover (kind aicc-release-signing-key-handover, schema 1, role
#       primary|standby, public_key, fingerprint: one file per key, exactly what the ceremony wrote) or a small text file of public values (PRIMARY_PUBKEY=, PRIMARY_FP=, STANDBY_PUBKEY=, STANDBY_FP=;
#       `#` comments). The arguments must match it (WRONG ORDER is refused), every fingerprint in it must equal the key's computed fingerprint, two files may not disagree, and a file that looks
#       like it holds a secret key (a private-key marker, a secret/private field name, any base64 value longer than a public key) is refused.
#   Both fingerprints are computed two ways (python hashlib and the shell's sha256 over the base64-decoded bytes) and must agree.
#   --local-proof: renders the live-SHAPED synthetic facts (fixtures/owner-facts.production.p45-live-shape.env) in a scratch directory with and without the one new fact and prints the
#     renderer's --compare (expected: added = AICC_LM_PLUGIN_SIGNING_PUBKEYS, removed -, changed -). Scratch only; removed on exit; no host is read.
# Exit codes: 0 plan printed; 2 usage; 3 refused by a rule above; 1 internal inconsistency or failed proof. Companion: stack-tests/test_p45_trustanchor.sh; procedure: cp-dark/p45/TRUST-ANCHOR-OWNER-FACT-P45.md.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; INFRA="$(cd "$HERE/.." && pwd)"; LIB="$INFRA/provision/lib/owner_facts.py"
refuse() { echo "REFUSED: $*" >&2; exit 3; }
usage() { sed -n 2,3p "${BASH_SOURCE[0]}" | cut -c3- >&2; echo "usage: $(basename "$0") <primary_pub> <standby_pub> [--handover-file F [--handover-file F2]] [--local-proof]" >&2; exit 2; }
PRIMARY=""; STANDBY=""; HANDOVERS=(); PROOF=0; NPOS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --handover-file) [ $# -ge 2 ] || usage; [ "${#HANDOVERS[@]}" -lt 2 ] || usage; HANDOVERS+=("$2"); shift 2 ;;
    --local-proof) PROOF=1; shift ;;
    -h|--help) sed -n 2,19p "${BASH_SOURCE[0]}" | cut -c3-; exit 0 ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) NPOS=$((NPOS + 1)); case "$NPOS" in 1) PRIMARY="$1" ;; 2) STANDBY="$1" ;; *) usage ;; esac; shift ;;
  esac
done
[ "$NPOS" = 2 ] || usage
command -v python3 >/dev/null 2>&1 || { echo "need python3" >&2; exit 1; }
[ -f "$LIB" ] || { echo "cannot find $LIB" >&2; exit 1; }

# ---- validation (python, the owner-facts validator itself) ------------------------------------------------------------------------------------------------------
VOUT="$(python3 -I - "$LIB" "$PRIMARY" "$STANDBY" ${HANDOVERS[@]+"${HANDOVERS[@]}"} <<'PY'
import base64, hashlib, importlib.util, os, re, stat, sys
lib, primary, standby = sys.argv[1:4]; handovers = sys.argv[4:]
spec = importlib.util.spec_from_file_location("owner_facts", lib); of = importlib.util.module_from_spec(spec); spec.loader.exec_module(of)
KEY = "AICC_LM_PLUGIN_SIGNING_PUBKEYS"
OLD_PUBS = ("yCsFX6176Ue5ZTdi4Dr99J9LFM43jXrN6Kbp13KF04Y=", "5p50qA1SYMTV7MXeDAWfMnNqLKVuTRDVS4FREuKuQwM=")   # the RETIRED public keys of the two lost-passphrase vaults (fingerprints 9d49-041f-0ced-13ac, be7f-3dda-cddd-d781)
def fp(b64):
    raw = base64.b64decode(b64, validate=True); h = hashlib.sha256(raw).hexdigest()[:16]; return "-".join(h[i:i + 4] for i in range(0, 16, 4))
OLD_FPS = tuple(fp(k) for k in OLD_PUBS)
def die(msg): sys.stderr.write("REFUSED: " + msg + "\n"); sys.exit(3)
def one(label, v):
    if v != v.strip() or "," in v or any(c.isspace() for c in v):
        die("the %s argument must be exactly ONE key (no comma, no blanks): the pair is built here, primary first" % label)
    try:
        ks = of.parse_signing_pubkeys(KEY, v)
    except of.OwnerFactsError as e:
        die("the %s key is not a usable public key: %s" % (label, e))
    if len(ks) != 1:
        die("the %s argument must be exactly one key" % label)
    return ks[0]
p, s = one("primary", primary), one("standby", standby)
if p == s:
    die("primary and standby are the same key: a rotation needs two different keys")
for label, k in (("primary", p), ("standby", s)):
    if k in OLD_PUBS or fp(k) in OLD_FPS:
        die("the %s key is one of the OLD (retired, lost-vault) public keys: the old keys must never be installed as the production trust anchor" % label)
B64LONG = re.compile(r"[A-Za-z0-9+/]{64,}={0,2}")
def long_b64(t):
    return any(len(t_) % 4 == 0 and len(base64.b64decode(t_, validate=False)) >= 48 for t_ in B64LONG.findall(t))
def load_handover(path):
    """-> {PRIMARY_PUBKEY|PRIMARY_FP|STANDBY_PUBKEY|STANDBY_FP: value} from a JSON ceremony handover or the text format."""
    if not os.path.isfile(path) or os.path.islink(path):
        die("--handover-file %s is not a regular file (the handover file is required to exist)" % path)
    if os.path.getsize(path) > 8192:
        die("the handover file %s is larger than 8 KiB: it must hold public values only" % path)
    text = open(path, encoding="utf-8", errors="replace").read()
    if re.search(r"PRIVATE KEY|BEGIN [A-Z ]*KEY", text, re.I):
        die("the handover file %s looks like it holds a secret (private) key: it must hold PUBLIC values only. Keep the secret offline" % path)
    out = {}
    if text.lstrip().startswith("{"):
        import json
        try:
            d = json.loads(text)
        except ValueError:
            die("the handover file %s is not valid JSON (and not the text format): check the file the ceremony wrote" % path)
        if not isinstance(d, dict):
            die("the handover file %s is not a JSON object" % path)
        for name, val in d.items():
            if re.search(r"secret|private|passphrase|password", str(name), re.I):
                die("the handover file %s has a field named '%s': it looks like it holds a secret; it must hold PUBLIC values only" % (path, name))
            if isinstance(val, str) and long_b64(val):
                die("the handover file %s field '%s' holds a base64 value longer than a public key: it looks like a secret key; the file must hold PUBLIC values only" % (path, name))
        if d.get("kind") != "aicc-release-signing-key-handover" or str(d.get("schema")) != "1":
            die("the handover file %s is not an aicc-release-signing-key-handover (schema 1): wrong kind/schema" % path)
        role = d.get("role")
        if role not in ("primary", "standby"):
            die("the handover file %s has role '%s': the role must be primary or standby" % (path, role))
        pk = d.get("public_key")
        if not isinstance(pk, str) or not pk:
            die("the handover file %s has no public_key" % path)
        out[role.upper() + "_PUBKEY"] = pk
        if d.get("fingerprint"):
            out[role.upper() + "_FP"] = str(d["fingerprint"])
        return out
    if re.search(r"SECRET", text, re.I) or long_b64(text):
        die("the handover file %s looks like it holds a secret key (the word secret, or a base64 value longer than a public key): it must hold PUBLIC values only. Remove it from this file and keep the secret offline" % path)
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.fullmatch(r"(PRIMARY_PUBKEY|PRIMARY_FP|STANDBY_PUBKEY|STANDBY_FP)=(\S+)", line)
        if m:
            out[m.group(1)] = m.group(2)
    if not out:
        die("the handover file %s is neither a ceremony JSON handover nor the PRIMARY_PUBKEY=/STANDBY_PUBKEY= text format" % path)
    return out
if handovers:
    h = {}
    for path in handovers:
        for name, val in load_handover(path).items():
            if name in h and h[name] != val:
                die("two handover files disagree about %s (both claim the same role with different values): conflict" % name)
            h[name] = val
    for name, val in h.items():
        if name.endswith("_FP") and val in OLD_FPS:
            die("the handover quotes an OLD fingerprint (%s): the old keys must never be installed as the production trust anchor" % val)
        if name.endswith("_PUBKEY") and val in OLD_PUBS:
            die("the handover holds an OLD public key (%s): the old keys must never be installed as the production trust anchor" % name)
    hp, hs = h.get("PRIMARY_PUBKEY"), h.get("STANDBY_PUBKEY")
    if hp is None and hs is None:
        die("the handover file(s) name no PRIMARY_PUBKEY / STANDBY_PUBKEY: they cannot say which key is the primary")
    if hp is not None and hs is not None and hp == hs:
        die("the handover files give the same key for primary and standby: conflict")
    if (hp is not None and hp == s) or (hs is not None and hs == p):
        die("WRONG ORDER: the handover says the primary is the key you passed as the standby (and the other way round): pass the primary first")
    if (hp is not None and hp != p) or (hs is not None and hs != s):
        die("the keys passed do not match the handover file(s) (PRIMARY_PUBKEY / STANDBY_PUBKEY): check you are using the owner's handover for these keys")
    for label, k in (("PRIMARY", p), ("STANDBY", s)):
        if label + "_FP" in h and h[label + "_FP"] != fp(k):
            die("the handover's %s_FP (%s) is not the fingerprint of the %s key (%s): a typo or the wrong key" % (label, h[label + "_FP"], label.lower(), fp(k)))
print("%s %s" % (p, fp(p))); print("%s %s" % (s, fp(s))); print("handover=%s" % ("checked (%d)" % len(handovers) if handovers else "none"))
PY
)" || exit $?
P="$(printf '%s\n' "$VOUT" | sed -n 1p | cut -d' ' -f1)"; PFP="$(printf '%s\n' "$VOUT" | sed -n 1p | cut -d' ' -f2)"
S="$(printf '%s\n' "$VOUT" | sed -n 2p | cut -d' ' -f1)"; SFP="$(printf '%s\n' "$VOUT" | sed -n 2p | cut -d' ' -f2)"; HSTATE="$(printf '%s\n' "$VOUT" | sed -n 3p | cut -d= -f2)"
fp2() { printf '%s' "$1" | { base64 -d 2>/dev/null || base64 -D; } | { sha256sum 2>/dev/null || shasum -a 256; } | cut -c1-16 | sed -E 's/(....)(....)(....)(....)/\1-\2-\3-\4/'; }
[ "$(fp2 "$P")" = "$PFP" ] && [ "$(fp2 "$S")" = "$SFP" ] || { echo "INTERNAL: the two fingerprint computations disagree (python $PFP/$SFP, shell $(fp2 "$P")/$(fp2 "$S")): do not use these values" >&2; exit 1; }
VALUE="$P,$S"

# ---- the plan ---------------------------------------------------------------------------------------------------------------------------------------------------
cat <<TXT
TRUST-ANCHOR PLAN (P45): NOTHING HAS BEEN APPLIED. This text only prints commands; run them yourself, one step at a time, after the owner has approved, inside a deploy window.

KEYS (public; validated exactly as the owner-facts tool does; the OLD keys are refused)
  primary  $PFP  (python hashlib = shell sha256: agree)   $P
  standby  $SFP  (python hashlib = shell sha256: agree)   $S
  handover file(s): $HSTATE
  value to set (primary first, no blanks): $VALUE
  CHECK BY EYE: these two fingerprints must be the ones keygen printed for the two new USB keys, in this order.

WINDOW: start only at :18-:26 or :48-:56 UTC; NEVER 02:00-04:00 UTC. Access: P=~/aicc-promotion/pssh (production only; the operator key).

0. PRE-FLIGHT (read-only; every line must match, else STOP)
P=~/aicc-promotion/pssh
\$P 'grep -E "^AICC_(ENV|HOSTNAME|STAGE_ID)=" /etc/aicc-stage-identity'      # production / www.copilt.org / 3e897286ce82e55f4d866acf0d526a5f
\$P 'sudo aicc-owner-facts check'                                             # ok: N value(s) valid for production
\$P 'sudo aicc-owner-facts list | cut -d= -f1 | grep -c SIGNING_PUBKEYS'     # 0
\$P 'sudo aicc-render-wp-config --env production --confirm-production --compare'   # IDENTICAL, else STOP

0b. OPTIONAL backup of the rendered configuration (root-only copy; it holds secrets: never print it)
\$P "sudo bash -c 'umask 077; cp -p /srv/aicc/shared/wp-config.php /srv/aicc/backups/wp-config.php.pre-trustanchor-\\\$(date -u +%Y%m%dT%H%M%SZ)'"

1. SET THE ONE FACT
\$P "sudo aicc-owner-facts set AICC_LM_PLUGIN_SIGNING_PUBKEYS '$VALUE'"
\$P 'sudo aicc-owner-facts check'

2. COMPARE (read-only). MUST be exactly this, exit 4; anything else: STOP and roll back (step 7)
\$P 'sudo aicc-render-wp-config --env production --confirm-production --compare'
#   DIFFERENT from /srv/aicc/shared/wp-config.php: a render would change it. Constants by NAME only (values are never shown):
#     added  : AICC_LM_PLUGIN_SIGNING_PUBKEYS
#     removed: -
#     changed: -

3. DRY RUN (writes nothing)
\$P 'sudo aicc-render-wp-config --env production --confirm-production --dry-run'

4. RENDER AND RELOAD
\$P 'sudo aicc-render-wp-config --env production --confirm-production'
\$P 'sudo systemctl reload php8.3-fpm'

5. COMPARE AGAIN: must say IDENTICAL (exit 0)
\$P 'sudo aicc-render-wp-config --env production --confirm-production --compare'

6. HOSTKEYS VERIFICATION (read-only; prints only the entry count, fingerprints and PRESENT/ABSENT; never the constant)
SNIP=\$(cat <<'PHP'
\$want = array_map( "trim", explode( ",", "$VALUE" ) );
if ( ! defined( "AICC_LM_PLUGIN_SIGNING_PUBKEYS" ) || ! is_string( AICC_LM_PLUGIN_SIGNING_PUBKEYS ) || "" === trim( AICC_LM_PLUGIN_SIGNING_PUBKEYS ) ) { echo "HOSTKEYS not-defined\n"; return; }
\$have = array_values( array_filter( array_map( "trim", explode( ",", AICC_LM_PLUGIN_SIGNING_PUBKEYS ) ), "strlen" ) );
\$fp = function ( \$b64 ) { \$raw = base64_decode( \$b64, true ); return ( false !== \$raw && 32 === strlen( \$raw ) ) ? implode( "-", str_split( substr( hash( "sha256", \$raw ), 0, 16 ), 4 ) ) : "unusable"; };
echo "HOSTKEYS defined entries=" . count( \$have ) . " fingerprints=" . implode( ",", array_map( \$fp, \$have ) ) . "\n";
foreach ( \$want as \$i => \$k ) { echo "HOSTKEYS " . ( 0 === \$i ? "primary" : "standby" ) . " " . \$fp( \$k ) . " " . ( in_array( \$k, \$have, true ) ? "PRESENT" : "ABSENT" ) . "\n"; }
PHP
)
B=\$(printf '%s' "\$SNIP" | base64 | tr -d '\n')
\$P "sudo aicc-wp eval \"\\\$(echo \$B | base64 -d)\""
#   expected:
#   HOSTKEYS defined entries=2 fingerprints=$PFP,$SFP
#   HOSTKEYS primary $PFP PRESENT
#   HOSTKEYS standby $SFP PRESENT

7. ROLLBACK (restores today's file; safe at any time while nothing is published)
\$P 'sudo aicc-owner-facts unset AICC_LM_PLUGIN_SIGNING_PUBKEYS'
\$P 'sudo aicc-render-wp-config --env production --confirm-production --compare'    # rc=4; removed: AICC_LM_PLUGIN_SIGNING_PUBKEYS only
\$P 'sudo aicc-render-wp-config --env production --confirm-production'
\$P 'sudo systemctl reload php8.3-fpm'
\$P 'sudo aicc-render-wp-config --env production --confirm-production --compare'    # IDENTICAL

NOTE: this sets only the Control Plane's trust anchor. A release must ALSO be built with these same two keys baked in (Plugin release/endpoints.conf UPDATE_PUBLIC_KEYS) and signed by the primary:
the launch gate refuses a release whose signing key is not in BOTH the host list and the shipped build.
TXT

# ---- optional local renderer proof (scratch only) ---------------------------------------------------------------------------------------------------------------
if [ "$PROOF" = 1 ]; then
  command -v php >/dev/null 2>&1 || { echo "need php for --local-proof" >&2; exit 1; }
  FIXF="$INFRA/stack-tests/fixtures/owner-facts.production.p45-live-shape.env"; [ -f "$FIXF" ] || { echo "missing fixture $FIXF" >&2; exit 1; }
  W="$(mktemp -d "${TMPDIR:-/tmp}/aicc-trust-plan.XXXXXX")"; trap 'rm -rf "$W"' EXIT
  SEC="$W/sec"; REL="$W/rel"; MAILD="$W/mail"; OFF="$W/owner-facts.env"; OUT="$W/live-file.php"; OFU="$(id -un):$(id -gn)"
  mkdir -p "$SEC" "$REL" "$MAILD"; chmod 700 "$SEC"; chmod 750 "$REL" "$MAILD"
  HEX="$(printf 'ab12%.0s' $(seq 16))"; printf 'proof_db_pass_0001\n' > "$SEC/db-cp.pass"
  { for k in AUTH_KEY SECURE_AUTH_KEY LOGGED_IN_KEY NONCE_KEY AUTH_SALT SECURE_AUTH_SALT LOGGED_IN_SALT NONCE_SALT; do printf '%s=SALTVALUE_%s\n' "$k" "$k"; done; printf 'AICC_ACTIVATION_PROOF_SECRET=%s\nAICC_ENTITLEMENT_WEBHOOK_SECRET=%s\n' "$HEX" "$HEX"; } > "$SEC/wp-secrets.env"; chmod 600 "$SEC/wp-secrets.env"
  printf 'WEBHOOK-test-0123456789-0123456789-abcdef\n' > "$SEC/entitlement-webhook.secret"; printf 'PROOF-test-0123456789-0123456789-abcdefgh\n' > "$SEC/activation-proof.secret"; chmod 600 "$SEC/"*.secret
  printf 'xkeysib-TEST-NOT-A-REAL-KEY-0000\n' > "$MAILD/brevo-api.key"; printf '0x4AAAAAAATSsecretVALUE0123456789abcdef\n' > "$MAILD/turnstile.secret"; chmod 640 "$MAILD/"*
  R() { env AICC_TEST_HARNESS=1 bash "$INFRA/provision/render-wp-config.sh" --env production --confirm-production --out "$OUT" --secrets-dir "$SEC" --mail-dir "$MAILD" --plugin-release-dir "$REL" --owner-facts-file "$OFF" --owner "$OFU" "$@"; }
  cp "$FIXF" "$OFF"; chmod 600 "$OFF"
  R >/dev/null 2>&1 || { echo "LOCAL PROOF FAILED: the live-shaped facts did not render" >&2; exit 1; }
  cp "$OUT" "$W/before.php"
  echo
  echo "LOCAL PROOF (scratch only; synthetic live-shaped facts = the 16 production names + the ONE new fact; no host read; values never shown)"
  env AICC_TEST_HARNESS=1 bash "$INFRA/provision/owner-facts.sh" --file "$OFF" --env production set AICC_LM_PLUGIN_SIGNING_PUBKEYS "$VALUE" >/dev/null
  rc=0; CMP="$(R --compare 2>&1)" || rc=$?
  echo "compare exit $rc"
  printf '%s\n' "$CMP" | grep -E '^  (added  |removed|changed): '
  [ "$rc" = 4 ] || { echo "LOCAL PROOF FAILED: expected compare exit 4" >&2; exit 1; }
  R >/dev/null 2>&1 || { echo "LOCAL PROOF FAILED: the render with the new fact failed" >&2; exit 1; }
  KEEP=""; for c in AICC_TURNSTILE_SITE_KEY AICC_TURNSTILE_SECRET_FILE AICC_NOTIFY_ENABLED; do for f in "$W/before.php" "$OUT"; do grep -q "^define( '$c'" "$f" || { echo "LOCAL PROOF FAILED: $c is missing from a render" >&2; exit 1; }; done; KEEP="$KEEP $c"; done
  for f in "$W/before.php" "$OUT"; do grep -E "^define\( 'WP_ACCESSIBLE_HOSTS'.*challenges\.cloudflare\.com" "$f" >/dev/null || { echo "LOCAL PROOF FAILED: challenges.cloudflare.com is missing from WP_ACCESSIBLE_HOSTS in a render (Turnstile enabled)" >&2; exit 1; }; done
  echo "preserved in BOTH renders:$KEEP (+ challenges.cloudflare.com in WP_ACCESSIBLE_HOSTS: Turnstile enabled)"
  rc2=0; CMP2="$(R --compare 2>&1)" || rc2=$?
  if [ "$rc2" = 0 ] && printf '%s' "$CMP2" | grep -q IDENTICAL; then echo "second compare: IDENTICAL (exit 0)"; else echo "LOCAL PROOF FAILED: second compare was not IDENTICAL" >&2; exit 1; fi
fi
