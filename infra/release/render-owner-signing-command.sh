#!/usr/bin/env bash
# Renders the READY-TO-PASTE owner signing block (docs/release/OWNER-SIGNING-COMMAND-USB.md section "the command") from FACTS: the release manifest, the ZIP, the pinned Plugin commit and the key handover file(s).
# Prints text only; signs nothing, reads no key, touches no stick.
#
#   render-owner-signing-command.sh --manifest <...X.manifest.json> --zip <...X.zip> --handover <aicc-release-primary.handover.json> --plugin-commit <40 hex> [--standby-handover <...standby.handover.json>] [--site-dir <Site checkout>] [--site-commit <sha>]
#
# Refuses (exit 3): a manifest that is not dirty:false, not built from --plugin-commit, whose SHA-256/size differ from the ZIP; a handover that is not a P45 handover file, or whose
# `ceremony_verified_after_replug` is empty (the ceremony is not complete before the unplug/replug check passed); a standby handover that is not a standby one or is not verified either.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UT=(python3 -I "$HERE/lib/usb_tools.py")
MAN=""; ZIP=""; HO=""; HOS=""; PC=""; SITE=""; SITEC=""
while [ $# -gt 0 ]; do
  case "$1" in
    --manifest) MAN="${2:-}"; shift 2 ;; --zip) ZIP="${2:-}"; shift 2 ;; --handover) HO="${2:-}"; shift 2 ;; --standby-handover) HOS="${2:-}"; shift 2 ;; --plugin-commit) PC="${2:-}"; shift 2 ;;
    --site-dir) SITE="${2:-}"; shift 2 ;; --site-commit) SITEC="${2:-}"; shift 2 ;; --plugin-dir-var) shift 2 ;;
    -h|--help) sed -n 2,10p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 3; }
[ -n "$MAN" ] && [ -n "$ZIP" ] && [ -n "$HO" ] && [ -n "$PC" ] || { echo "usage: see the header (--manifest --zip --handover --plugin-commit are required)" >&2; exit 2; }
[[ "$PC" =~ ^[0-9a-f]{40}$ ]] || refuse "--plugin-commit must be the full 40-hex commit"
[ -f "$MAN" ] && [ -f "$ZIP" ] || refuse "the manifest or the ZIP does not exist"
[ -f "$HO" ] || refuse "the handover file does not exist: $HO"
[ -n "$SITE" ] || SITE="$(cd "$HERE/../.." && pwd)"
[ -n "$SITEC" ] || SITEC="$(git -C "$SITE" rev-parse HEAD 2>/dev/null || echo "<the Site commit the coordinator names>")"
MV="$(python3 -I - "$MAN" "$ZIP" "$PC" <<'PY'
import hashlib, json, sys
man, zp, pc = sys.argv[1:4]
m = json.load(open(man))
def no(t): sys.stderr.write("REFUSED: %s\n" % t); sys.exit(3)
if m.get("slug") != "ai-commerce-copilot": no("the manifest is not for ai-commerce-copilot")
if m.get("dirty") is not False: no("the manifest does not say dirty:false")
if m.get("built_from_commit") != pc: no("the manifest was built from %s, not from --plugin-commit %s" % (m.get("built_from_commit"), pc))
d = open(zp, "rb").read()
if hashlib.sha256(d).hexdigest() != m.get("sha256") or len(d) != m.get("size"): no("the ZIP's SHA-256/size differ from the manifest")
print("%s %s %s" % (m["version"], m["sha256"], m["size"]))
PY
)" || exit 3
V="${MV%% *}"; REST="${MV#* }"; SHA="${REST%% *}"; SIZE="${REST#* }"
[ "$("${UT[@]}" jget "$HO" kind)" = aicc-release-signing-key-handover ] && [ "$("${UT[@]}" jget "$HO" role)" = primary ] || refuse "$HO is not a PRIMARY key handover file made by usb-key-ceremony.sh"
[ -n "$("${UT[@]}" jget "$HO" ceremony_verified_after_replug)" ] || refuse "the handover says the ceremony was NOT verified after an unplug/re-plug (ceremony_verified_after_replug is empty): run 'usb-key-ceremony.sh verify' after re-plugging first"
PUB="$("${UT[@]}" jget "$HO" public_key)"; FP="$("${UT[@]}" jget "$HO" fingerprint)"; VU="$("${UT[@]}" jget "$HO" volume_uuid)"; VN="$("${UT[@]}" jget "$HO" volume_name)"
SPUB=""; SFP=""; SVU=""
if [ -n "$HOS" ]; then
  [ "$("${UT[@]}" jget "$HOS" role)" = standby ] || refuse "$HOS is not a STANDBY handover file"
  [ -n "$("${UT[@]}" jget "$HOS" ceremony_verified_after_replug)" ] || refuse "the standby handover was not verified after an unplug/re-plug either"
  SPUB="$("${UT[@]}" jget "$HOS" public_key)"; SFP="$("${UT[@]}" jget "$HOS" fingerprint)"; SVU="$("${UT[@]}" jget "$HOS" volume_uuid)"
fi
FD="$(cd "$(dirname "$ZIP")" && pwd)"
cat <<EOF
# ===== AI Commerce Copilot $V: sign with the PRIMARY USB stick (generated from facts; passwordless; nothing to type except one confirmation phrase) =====
# Facts (all public): version $V, ZIP $SIZE bytes, plugin commit $PC
#   primary key  fingerprint $FP   public $PUB
$( [ -z "$SPUB" ] || echo "#   standby key  fingerprint $SFP   public $SPUB   (volume UUID $SVU; emergency only: do NOT use it)" )
#   primary stick volume UUID $VU   (label '$VN' is only a label: the command checks the UUID)

# ---- paste 1: variables and the clean checkout (bash; keep this window for paste 2)
F='$FD'
V=$V
SHA=$SHA
COMMIT=$PC
PRIMARY_FP=$FP
VOLUME_UUID=$VU
SITE='$SITE'
PLUG="\$HOME/aicc-sign-plugin-\$COMMIT"
git -C "\$SITE" rev-parse HEAD                     # must print: $SITEC
git -C "\$SITE" status --short                     # must print nothing
if [ -d "\$PLUG/.git" ]; then git -C "\$PLUG" fetch --tags origin; else git clone https://github.com/avivg7/ai-commerce-copilot-plugin.git "\$PLUG"; fi
git -C "\$PLUG" checkout --detach "\$COMMIT"
[ "\$(git -C "\$PLUG" rev-parse HEAD)" = "\$COMMIT" ] && echo "HEAD is the pinned commit (correct)" || echo "STOP: HEAD is not the pinned commit: do NOT sign"
git -C "\$PLUG" status --short                     # must print nothing
shasum -a 256 "\$F/ai-commerce-copilot-\$V.zip" | cut -d' ' -f1     # must equal \$SHA above, character for character
ls "\$F"/*.sig 2>/dev/null && echo "STOP: a .sig already exists" || echo "no signature yet (correct)"

# ---- paste 2: plug in the PRIMARY stick ONLY (the standby stick stays where it is), then find its mount path
ls /Volumes                                         # the stick's name; use it below as /Volumes/<NAME>
diskutil info "/Volumes/<NAME>" | grep -E 'Volume UUID|Protocol'    # Volume UUID must equal $VU ; Protocol: USB

# ---- paste 3: THE signing command (you type only the confirmation phrase it prints: SIGN $V ${SHA:0:8})
bash "\$SITE/infra/release/sign-plugin-release-usb.sh" \\
  --usb "/Volumes/<NAME>" --role primary --plugin-dir "\$PLUG" \\
  --zip "\$F/ai-commerce-copilot-\$V.zip" --manifest "\$F/ai-commerce-copilot-\$V.manifest.json" \\
  --version "\$V" --sha256 "\$SHA" --commit "\$COMMIT" \\
  --primary-fp "\$PRIMARY_FP" --expect-volume-uuid "\$VOLUME_UUID" --eject

# ---- afterwards: unplug the stick, put it back in its place. Send ONLY the public file:  \$F/ai-commerce-copilot-\$V.manifest.sig
EOF
