#!/usr/bin/env bash
# OWNER-RUN, INTERACTIVE key ceremony for the POSSESSION-BASED, PASSWORDLESS USB signing of private Plugin releases (P45; docs/release/usb-signing-threat-model.md).
# One Ed25519 key per dedicated USB stick (Primary on one stick, Standby on a DIFFERENT stick), stored as an UNENCRYPTED file: whoever holds the stick can sign. There is no password prompt and no
# unlock step anywhere. The only thing you type is a CONFIRMATION phrase (a sentence this script prints; it is not a secret).
#
#   usb-key-ceremony.sh preflight --usb /Volumes/<X> --role primary|standby
#       read-only look (plus one probe file that is deleted again): is it a physical removable USB stick, which filesystem, are file permissions enforced, free space, volume UUID, device identity,
#       a NAMES-ONLY summary of what is already on it (old AICC-SIGNING-BACKUP vault copies are named and are NOT touched), refuses if the target folder already holds a key. Never formats anything.
#   usb-key-ceremony.sh generate  --usb /Volumes/<X> --role primary|standby --plugin-dir <Plugin checkout> --plugin-commit <sha> [--expect-handover-dir DIR]
#       preflight, then a typed confirmation, then: the Plugin's `bin/sign-release.php keygen` writes the key DIRECTLY to <stick>/AICC-RELEASE-SIGNING/aicc-release-<role>.key (libsodium randomness, umask 077),
#       a PUBLIC identity file next to it, a NON-SECRET handover file in DIR (default $HOME/AICC-KEY-HANDOVER), no `._*` sidecars left, the public key re-derived independently, an offline signing smoke test.
#       Then EJECT and RE-PLUG the stick and run `verify`: the ceremony is NOT complete before that passes after a re-plug.
#   usb-key-ceremony.sh verify    --usb /Volumes/<X> --role primary|standby --expect-pubkey <base64> [--expect-volume-uuid U] [--handover-dir DIR]
#       the unplug/replug check, usable any time: re-reads the key, re-derives the public key (libsodium + python RFC 8032 + OpenSSL when it can), compares it with the expected value, the identity file and the
#       volume UUID, signs/verifies a disposable message, confirms no `._*` sidecars; prints PASS/FAIL. Writes `ceremony_verified_after_replug` into the handover ONLY when it detects that the stick was re-mounted.
#   usb-key-ceremony.sh backup-plan
#       prints (executes nothing) the offline backup options.
#   usb-key-ceremony.sh backup    --from-usb /Volumes/<A> --to-usb /Volumes/<B> --role primary|standby [--plugin-dir ...]
#       copies ONE key to ANOTHER dedicated removable USB, only after a typed confirmation; refuses same device, a destination that holds the OTHER role's key (or any key), internal/cloud/repo paths.
#       NOT to be run by an assistant or in tests on a real device.
#
# Exit codes: 0 ok / PASS; 1 failed; 2 usage; 3 refused by a safety rule; 4 verify: the key checks passed but the stick has not been re-plugged since `generate` (ceremony NOT complete yet).
# Test seam: AICC_TEST_HARNESS=1 lets a THROWAWAY disk image mounted under the system temp dir stand in for the stick (loud banner; never accepted for /Volumes/...).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/usb-common.sh
. "$HERE/lib/usb-common.sh"
usb_hygiene

SUB="${1:-}"; [ $# -gt 0 ] && shift
USB=""; ROLE=""; PLUG=""; PLUGCOMMIT=""; HAND=""; EXPUB=""; EXPUUID=""; FROM=""; TO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --usb) USB="${2:-}"; shift 2 ;; --role) ROLE="${2:-}"; shift 2 ;; --plugin-dir) PLUG="${2:-}"; shift 2 ;; --plugin-commit) PLUGCOMMIT="${2:-}"; shift 2 ;;
    --expect-handover-dir|--handover-dir) HAND="${2:-}"; shift 2 ;; --expect-pubkey) EXPUB="${2:-}"; shift 2 ;; --expect-volume-uuid) EXPUUID="${2:-}"; shift 2 ;;
    --from-usb) FROM="${2:-}"; shift 2 ;; --to-usb) TO="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,28p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$HAND" ] || HAND="$HOME/AICC-KEY-HANDOVER"
role_ok() { case "$ROLE" in primary|standby) ;; *) echo "--role must be primary or standby" >&2; exit 2 ;; esac; }
other_role() { [ "$1" = primary ] && echo standby || echo primary; }

# ======================================================================================================================================================================================================
# preflight <mount> <role> <fresh|existing>
usb_preflight() {
  local mp="$1" role="$2" mode="$3" probe names count kd other
  usb_classify "$mp" --serial
  mp="$U_mount_point"
  echo "== preflight: $mp (role: $role) =="
  echo "  physical USB, removable        : yes (diskutil: protocol $U_bus_protocol, internal=$U_internal, removable=$U_removable, ejectable=$U_ejectable)"
  if [ "$U_harness" = yes ]; then echo "  TEST HARNESS: a disk image stands in for the stick (never accepted for a real stick)"; else echo "  not a disk image / network / cloud / repo path : yes (checked)"; fi
  echo "  identity: the stick is identified by the KEY on it; the label, the volume UUID and the device only catch mistakes (a wrong or look-alike stick), they do not authenticate anyone"
  echo "  volume name (a LABEL: never trusted): $U_volume_name"
  echo "  volume UUID                    : $U_volume_uuid"
  echo "  device                         : $U_device_node (whole disk $U_whole_disk), media name: ${U_media_name:-(none)}"
  echo "  USB identity                   : $U_usb_identity"
  echo "  filesystem                     : $U_fs_name ($U_fs_type); mount flags: $U_mount_flags"
  echo "  size / free                    : $U_size_bytes / $U_free_bytes bytes"
  [ "$U_writable" = yes ] || usb_refuse "the volume is mounted read-only or not writable: STOPPING (nothing was changed; this tool never formats or remounts)"
  [ "${U_free_bytes:-0}" -ge 1048576 ] 2>/dev/null || usb_refuse "less than 1 MiB free on the volume: STOPPING (this tool never formats or deletes; free space yourself or use another stick)"
  probe="$(usb_perms_probe "$mp")"
  PERMS_ENFORCED="$(usb_perms_static)"
  [ "$probe" = yes ] || PERMS_ENFORCED=no
  [ "$probe" != unwritable ] || usb_refuse "cannot create a file on the volume: STOPPING (nothing was changed)"
  local noown=no; case ",$U_mount_flags," in *,noowners,*) noown=yes ;; esac
  echo "  POSIX permissions enforced     : $PERMS_ENFORCED  (mount flag noowners=$noown; chmod 0600 round-trip on a probe file: $probe)"
  if [ "$PERMS_ENFORCED" != yes ]; then
    echo "  SECURITY LIMITATION            : this filesystem ($U_fs_name) does NOT enforce file permissions. chmod 0600 has no effect: any local user, and ANYONE WHO HOLDS THE STICK, can read the key."
    echo "                                   Possession of the stick is the ONLY control. There is no cryptographic protection against the possessor (docs/release/usb-signing-threat-model.md)."
  fi
  names="$(find "$mp" -mindepth 1 -maxdepth 1 ! -name '._*' -exec basename {} \; 2>/dev/null | sort || true)"; count="$(printf '%s' "$names" | grep -c . || true)"
  echo "  existing contents (names only) : $count entries"
  [ -z "$names" ] || printf '%s\n' "$names" | sed 's/^/      - /'
  if printf '%s\n' "$names" | grep -qiE '^AICC-SIGNING-BACKUP|\.dmg$|AICCKEYS'; then
    echo "  NOTE: this stick already holds AICC-SIGNING-BACKUP / vault copies (old ENCRYPTED vaults). They are NOT touched by this tool and they confer NO trust any more."
  fi
  kd="$(usb_keydir "$mp")"
  if [ -e "$kd" ] || [ -L "$kd" ]; then usb_check_keydir "$mp" || usb_refuse "$kd is not a real directory on the stick (a symlink, or a path that leaves the stick): the key folder must live on the stick itself"; fi
  if [ "$mode" = fresh ]; then
    other="$(other_role "$role")"
    [ ! -e "$(usb_keyfile "$mp" "$other")" ] || usb_refuse "this stick holds the $other key: primary and standby must NEVER share a device"
    if [ -d "$kd" ]; then
      local keys; keys="$(find "$kd" -mindepth 1 -maxdepth 1 -name '*.key' -exec basename {} \; 2>/dev/null || true)"
      [ -z "$keys" ] || usb_refuse "$kd already holds a key ($(printf '%s' "$keys" | tr '\n' ' ')): this tool never overwrites or deletes a key. Use another stick, or move the key yourself if you are certain."
    fi
  fi
  echo "PREFLIGHT OK: nothing was formatted, erased or changed (the one temporary probe file this check creates at the stick's root was deleted again)."
}

# ======================================================================================================================================================================================================
GEN_KEY=""; GEN_ID=""; GEN_HF=""; GEN_DIR=""; GEN_DONE=0
gen_cleanup() {  # EXIT trap of generate: undo only what THIS run created
  local rc=$? did=""
  trap - EXIT INT TERM HUP
  if [ "$GEN_DONE" != 1 ]; then
    if [ -n "$GEN_KEY" ] && [ -f "$GEN_KEY" ]; then rm -f "$GEN_KEY"; did=1; fi
    [ -z "$GEN_ID" ] || rm -f "$GEN_ID"
    [ -z "$GEN_HF" ] || rm -f "$GEN_HF"
    [ -z "$GEN_DIR" ] || rmdir "$GEN_DIR" 2>/dev/null || true
    [ -z "$did" ] || echo "CLEANUP: removed the key this run created (and only what this run created): the stick is as it was before and can be used for a new ceremony." >&2
  fi
  exit "$rc"
}
cmd_generate() {
  [ -n "$USB" ] || { echo "usage: generate --usb /Volumes/<X> --role primary|standby --plugin-dir D --plugin-commit SHA [--expect-handover-dir DIR]" >&2; exit 2; }
  role_ok
  [ -n "$PLUG" ] && [ -n "$PLUGCOMMIT" ] || { echo "generate needs --plugin-dir (a CLEAN checkout of the Plugin) and --plugin-commit (its pinned commit): the Plugin's code makes the key" >&2; exit 2; }
  [[ "$PLUGCOMMIT" =~ ^[0-9a-f]{7,40}$ ]] || usb_refuse "--plugin-commit must be 7-40 hex characters"
  local tool="$PLUG/bin/sign-release.php" head why
  [ -f "$tool" ] && [ -f "$PLUG/includes/class-aicc-release-signature.php" ] || usb_refuse "--plugin-dir is not a Plugin checkout (no bin/sign-release.php)"
  git -C "$PLUG" rev-parse --git-dir >/dev/null 2>&1 || usb_refuse "--plugin-dir is not a git checkout"
  head="$(git -C "$PLUG" rev-parse HEAD)"
  case "$head" in "$PLUGCOMMIT"*) ;; *) usb_refuse "the Plugin checkout is at ${head:0:12}, not at the pinned commit $PLUGCOMMIT" ;; esac
  why="$(usb_git_pristine "$PLUG")" || usb_refuse "$why (the key is made by code from it)"
  usb_need_tools
  usb_preflight "$USB" "$ROLE" fresh
  local mp="$U_mount_point" kd kf idf hf
  usb_check_handover_dir "$HAND" "$mp"; HAND="$USB_HANDOVER_REAL"
  hf="$HAND/aicc-release-$ROLE.handover.json"
  [ ! -e "$hf" ] || usb_refuse "$hf already exists: a handover file is never overwritten (it belongs to an earlier key; move it away only if you are certain that key is not in use)"
  kd="$(usb_keydir "$mp")"; kf="$(usb_keyfile "$mp" "$ROLE")"; idf="$(usb_idfile "$mp" "$ROLE")"
  echo
  echo "About to create the $(usb_upper "$ROLE") signing key ON THIS STICK ($U_volume_name, UUID $U_volume_uuid), UNENCRYPTED, with no password."
  echo "Anyone who holds this stick will be able to sign releases. It is not backed up anywhere. Nothing is written anywhere else except the non-secret handover file $hf."
  usb_confirm "GENERATE $(usb_upper "$ROLE") KEY ON $(usb_uuid8 "$U_volume_uuid")"
  # ---- from here until the handover is written, an interruption or a failure removes ONLY what THIS run created (never a pre-existing file), so the stick never keeps an unrevealed key
  trap gen_cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 129' HUP
  if [ ! -e "$kd" ]; then ( umask 077; mkdir "$kd" ) || usb_fail "cannot create $kd"; GEN_DIR="$kd"; fi
  chmod 700 "$kd" 2>/dev/null || true
  usb_check_keydir "$mp" || usb_fail "the key folder is not a real directory on the stick"
  [ ! -e "$kf" ] && [ ! -L "$kf" ] || usb_fail "a key file appeared at $kf: nothing was overwritten"
  local kout krc=0
  GEN_KEY="$kf"
  kout="$(php "$tool" keygen --secret-out "$kf" 2>&1)" || krc=$?
  if [ "$krc" != 0 ] || [ ! -f "$kf" ]; then
    usb_fail "the Plugin's keygen failed: ${kout%%$'\n'*}"
  fi
  local pub fp
  pub="$(printf '%s\n' "$kout" | sed -n 's/^public key.*: //p')"; fp="$(printf '%s\n' "$kout" | sed -n 's/^fingerprint: //p')"
  [[ "$pub" =~ ^[A-Za-z0-9+/]{43}=$ ]] && [[ "$fp" =~ ^[0-9a-f]{4}(-[0-9a-f]{4}){3}$ ]] || usb_fail "keygen printed no usable public key"
  chmod 0600 "$kf" 2>/dev/null || true
  [ "$(usb_size_of "$kf")" = 89 ] || usb_fail "the key file has an unexpected size"
  # ---- independent verification of the public key
  usb_derive "$kf" --independent
  [ "$K_PUB" = "$pub" ] && [ "$K_FP" = "$fp" ] || usb_fail "the public key derived from the key file differs from the one keygen printed"
  php "$USB_PHP" smoke --key-file "$kf" >/dev/null || usb_fail "the offline signing smoke test failed"
  # ---- public identity file on the stick (NO secret)
  local created; created="$(usb_utc)"
  [ ! -e "$idf" ] && GEN_ID="$idf"
  "${USB_PY[@]}" jwrite "$idf" "schema=1" "kind=aicc-release-signing-key-identity" "role=$ROLE" "public_key=$pub" "fingerprint=$fp" "created_utc=$created" "volume_uuid=$U_volume_uuid" \
    "volume_name=$U_volume_name" "filesystem=$U_fs_name" "device_media_name=$U_media_name" "usb_identity=$U_usb_identity" "tool=usb-key-ceremony.sh (P45) with Plugin bin/sign-release.php keygen @ ${head:0:12}" \
    "note=PUBLIC file: no secret. Possession of the stick is the authority to sign." || usb_fail "could not write the identity file"
  # ---- sidecars caused by us: remove, then verify
  sync; usb_sidecars_remove_ours "$mp"; sync
  local sc; sc="$(usb_sidecars_list "$mp")"
  [ -z "$sc" ] || usb_fail "AppleDouble sidecar files remain on the stick: $(printf '%s' "$sc" | tr '\n' ' ')"
  # ---- non-secret handover file (outside any git repo / cloud path)
  GEN_HF="$hf"
  "${USB_PY[@]}" jwrite "$hf" "schema=1" "kind=aicc-release-signing-key-handover" "role=$ROLE" "public_key=$pub" "fingerprint=$fp" "volume_uuid=$U_volume_uuid" "volume_name=$U_volume_name" \
    "created_utc=$created" "ceremony_verified_after_replug=null" "ceremony_replug_evidence=null" "session_io_marker=$U_io_marker" "session_device_node=$U_device_node" "session_boot_time=$U_boot_time" \
    "note=NON-SECRET: public key, fingerprint, volume UUID. Send this to engineering; it contains no key material." || usb_fail "could not write the handover file"
  GEN_DONE=1; trap - EXIT INT TERM HUP
  sync
  echo
  echo "GENERATED: the $ROLE key is on the stick; it was not printed and not copied anywhere."
  echo "  key file (a secret, on the stick only): $kf"
  echo "  public identity file (public)         : $idf"
  echo "  public key                            : $pub"
  echo "  fingerprint                           : $fp"
  echo "  volume UUID / label                   : $U_volume_uuid / $U_volume_name"
  echo "  public key re-derived independently   : $K_INDEP"
  echo "  offline signing smoke test            : ok (a disposable message was signed and verified; a changed message was rejected)"
  echo "  AppleDouble (._*) sidecars on the stick: none"
  echo "  handover file (NON-SECRET, send this) : $hf"
  [ "$PERMS_ENFORCED" = yes ] || echo "  REMINDER: this filesystem does not enforce permissions: possession of the stick is the only protection."
  echo
  echo "NOT COMPLETE YET. Now: EJECT the stick (diskutil eject $mp), unplug it, plug it in again, and run:"
  echo "  bash $0 verify --usb /Volumes/<the stick's name> --role $ROLE --expect-pubkey '$pub'"
  echo "The ceremony counts as complete only when that prints PASS after the re-plug."
}

# ======================================================================================================================================================================================================
cmd_verify() {
  [ -n "$USB" ] && [ -n "$EXPUB" ] || { echo "usage: verify --usb /Volumes/<X> --role primary|standby --expect-pubkey <base64> [--expect-volume-uuid U] [--handover-dir DIR]" >&2; exit 2; }
  role_ok
  [[ "$EXPUB" =~ ^[A-Za-z0-9+/]{43}=$ ]] || usb_refuse "--expect-pubkey must be one base64 32-byte key"
  usb_need_tools
  usb_classify "$USB" --serial
  local mp="$U_mount_point" kf idf bad="" other hf rep="unknown" evidence=""
  kf="$(usb_keyfile "$mp" "$ROLE")"; idf="$(usb_idfile "$mp" "$ROLE")"; other="$(other_role "$ROLE")"
  if [ -e "$(usb_keydir "$mp")" ] || [ -L "$(usb_keydir "$mp")" ]; then usb_check_keydir "$mp" || usb_refuse "$(usb_keydir "$mp") is not a real directory on the stick (a symlink, or a path that leaves the stick): a key that is not on the stick is never used"; fi
  echo "== verify: $mp (role: $ROLE) =="
  echo "  physical USB stick: yes ($U_bus_protocol); label '$U_volume_name' (not trusted); volume UUID $U_volume_uuid; device $U_device_node; filesystem $U_fs_name"
  chk() { if [ "$2" = ok ]; then echo "  [ ok ] $1"; else echo "  [FAIL] $1: $3"; bad="$bad;$1"; fi; }
  [ -f "$kf" ] && [ ! -L "$kf" ] && chk "key file present at the fixed path (regular file, not a symlink)" ok || chk "key file present at the fixed path (regular file, not a symlink)" no "missing, a symlink or not a regular file: $kf"
  [ ! -e "$(usb_keyfile "$mp" "$other")" ] && chk "the $other key is NOT on this stick (primary and standby never share a device)" ok || chk "the $other key is NOT on this stick (primary and standby never share a device)" no "found"
  if [ -f "$kf" ] && [ ! -L "$kf" ]; then
    local dout=""
    if dout="$(php "$USB_PHP" derive --key-file "$kf" 2>&1)"; then
      K_PUB="$(printf '%s\n' "$dout" | sed -n 's/^pub=//p')"; K_FP="$(printf '%s\n' "$dout" | sed -n 's/^fp=//p')"
      local ind
      if ind="$("${USB_PY[@]}" ed25519 --openssl < "$kf" 2>&1)"; then
        local pyp opp; pyp="$(printf '%s\n' "$ind" | sed -n 's/^pub_python\t//p')"; opp="$(printf '%s\n' "$ind" | sed -n 's/^pub_openssl\t//p')"
        if [ "$pyp" = "$K_PUB" ] && { [ "$opp" = "$K_PUB" ] || [ "$opp" = unavailable ] || [ -z "$opp" ]; }; then chk "public key re-derived from the private key by independent implementations" ok; else chk "public key re-derived from the private key by independent implementations" no "implementations disagree"; fi
      else chk "public key re-derived from the private key by independent implementations" no "the independent derivation failed"; fi
      [ "$K_PUB" = "$EXPUB" ] && chk "derived public key equals the expected public key" ok || chk "derived public key equals the expected public key" no "the key on this stick is NOT the expected one (derived fingerprint $K_FP)"
      php "$USB_PHP" smoke --key-file "$kf" >/dev/null 2>&1 && chk "signs and verifies a disposable message" ok || chk "signs and verifies a disposable message" no "smoke test failed"
    else chk "the key file is a valid Ed25519 secret key" no "${dout#usb_sign: }"; fi
  fi
  if [ -f "$idf" ]; then
    local ipub ifp iuuid irole
    ipub="$("${USB_PY[@]}" jget "$idf" public_key)"; ifp="$("${USB_PY[@]}" jget "$idf" fingerprint)"; iuuid="$("${USB_PY[@]}" jget "$idf" volume_uuid)"; irole="$("${USB_PY[@]}" jget "$idf" role)"
    [ "$irole" = "$ROLE" ] && chk "identity file role = $ROLE" ok || chk "identity file role = $ROLE" no "it says '$irole'"
    [ -n "${K_PUB:-}" ] && [ "$ipub" = "$K_PUB" ] && [ "$ifp" = "${K_FP:-x}" ] && chk "identity file public key and fingerprint equal the key's" ok || chk "identity file public key and fingerprint equal the key's" no "differ"
    [ "$iuuid" = "$U_volume_uuid" ] && chk "identity file volume UUID equals this volume's UUID" ok || chk "identity file volume UUID equals this volume's UUID" no "identity says $iuuid, this volume is $U_volume_uuid (a copy on another stick, or a reformatted stick)"
  else chk "identity file present" no "missing: $idf"; fi
  if [ -n "$EXPUUID" ]; then
    [ "$(printf '%s' "$EXPUUID" | tr '[:lower:]' '[:upper:]')" = "$(printf '%s' "$U_volume_uuid" | tr '[:lower:]' '[:upper:]')" ] && chk "volume UUID equals the expected volume UUID" ok || chk "volume UUID equals the expected volume UUID" no "expected $EXPUUID, this is $U_volume_uuid"
  fi
  local sc; sc="$(usb_sidecars_list "$mp")"
  [ -z "$sc" ] && chk "no AppleDouble (._*) sidecar files in the key folder" ok || chk "no AppleDouble (._*) sidecar files in the key folder" no "$(printf '%s' "$sc" | tr '\n' ' ')"
  case "$(usb_perms_static)" in yes) ;; *) echo "  NOTE: this filesystem ($U_fs_type, flags: $U_mount_flags) does not enforce permissions: possession of the stick is the only protection." ;; esac
  # ---- the replug evidence (a handover file written by `generate`, in --handover-dir)
  hf="$HAND/aicc-release-$ROLE.handover.json"
  if [ -f "$hf" ]; then
    local hpub huuid hdone omark oboot
    hpub="$("${USB_PY[@]}" jget "$hf" public_key)"; huuid="$("${USB_PY[@]}" jget "$hf" volume_uuid)"; hdone="$("${USB_PY[@]}" jget "$hf" ceremony_verified_after_replug)"
    [ "$hpub" = "$EXPUB" ] && chk "handover file public key equals the expected key" ok || chk "handover file public key equals the expected key" no "differs"
    [ "$huuid" = "$U_volume_uuid" ] && chk "handover file volume UUID equals this volume's UUID" ok || chk "handover file volume UUID equals this volume's UUID" no "handover says $huuid"
    omark="$("${USB_PY[@]}" jget "$hf" session_io_marker)"; oboot="$("${USB_PY[@]}" jget "$hf" session_boot_time)"
    if [ -n "$hdone" ]; then rep=already
    elif [ -n "$omark" ] && [ -n "$U_io_marker" ]; then
      if [ "$omark" != "$U_io_marker" ]; then rep=yes; evidence="macOS registered the stick again (IORegistry media entry $omark -> $U_io_marker)"; else rep=no; fi
    elif [ -n "$oboot" ] && [ -n "$U_boot_time" ] && [ "$oboot" != "$U_boot_time" ]; then rep=yes; evidence="the Mac rebooted since generate (boot time changed)"
    fi
  else
    echo "  (no handover file $hf here: the content checks run, but the unplug/replug record cannot be kept on this Mac)"
    rep=untracked
  fi
  echo
  if [ -n "$bad" ]; then
    echo "FAIL: $(printf '%s' "${bad#;}" | tr ';' '\n' | wc -l | tr -d ' ') check(s) failed. Do NOT use this stick for signing."
    exit 1
  fi
  case "$rep" in
    yes)
      "${USB_PY[@]}" jset "$hf" "ceremony_verified_after_replug=$(usb_utc)" "ceremony_replug_evidence=$evidence"
      echo "PASS: every check passed AFTER a re-mount ($evidence). ceremony_verified_after_replug recorded in $hf."
      ;;
    no)
      echo "PASS (content) but the ceremony is NOT COMPLETE: macOS has not registered an unplug/re-plug since 'generate' (the media entry is unchanged)."
      echo "Eject the stick (diskutil eject $mp), unplug it, plug it in again and run this command once more. Nothing was recorded."
      exit 4
      ;;
    unknown)
      echo "PASS (content). This Mac gives no reliable evidence of a re-mount for this device (no IORegistry marker, same boot)."
      usb_confirm "I EJECTED AND RE-PLUGGED THE STICK"
      "${USB_PY[@]}" jset "$hf" "ceremony_verified_after_replug=$(usb_utc)" "ceremony_replug_evidence=typed confirmation (re-mount could not be detected on this Mac)"
      echo "PASS: recorded with a typed confirmation of the re-plug (the re-mount itself could not be detected here: this rests on your word)."
      ;;
    already) echo "PASS (the unplug/replug check was already recorded: $("${USB_PY[@]}" jget "$hf" ceremony_verified_after_replug))." ;;
    untracked) echo "PASS (content checks)." ;;
  esac
}

# ======================================================================================================================================================================================================
cmd_backup_plan() {
  cat <<'EOF'
OFFLINE BACKUP OPTIONS for an unencrypted signing key (printed only; nothing is executed). Read docs/release/usb-signing-threat-model.md first.

 What a backup IS: a second copy of the SAME key. Every extra copy is another stick that can be lost or stolen, and loss of ANY copy compromises the key (it is unencrypted).
 So a backup is optional, and the first question is whether you need one at all: the design already has TWO different keys (Primary and Standby). If the Primary stick is destroyed (not stolen), the
 Standby signs one release that rotates the trust to a new Primary; no backup of the Primary is required for that. A backup only avoids that rotation.

 Recommended, if you decide to keep a backup:
  1. One additional DEDICATED stick PER key (a Primary backup stick, a Standby backup stick), made with `usb-key-ceremony.sh backup` after a typed confirmation, kept in a DIFFERENT physical place
     (e.g. a safe at another address) from the original stick. Its volume UUID differs: record it, `verify` it, and use its UUID with `--expect-volume-uuid` if you ever sign from it.
  2. Never put the Primary and the Standby on the same stick, never keep the two sticks together, and never back one key up onto the other key's stick (the tool refuses this).
  3. Never in the cloud, never in a photo, never in a password manager or a chat, never on the Mac's disk, never in a repository, never printed.

 Not recommended (no threat model supports it): paper or QR codes of the key. A printed key is readable by anyone who sees it and cannot be revoked quietly; if you want paper, decide it in writing first.
 Never: a copy on an internal disk, a cloud-synced folder, the other key's stick.

 To make a backup (needs your typed confirmation; refuses the same device, an internal/cloud/repo path, a destination that already holds a key, and any destination that holds the OTHER role's key):
   bash infra/release/usb-key-ceremony.sh backup --from-usb /Volumes/<SOURCE> --to-usb /Volumes/<NEW DEDICATED STICK> --role primary|standby
EOF
}

BK_KEY=""; BK_ID=""; BK_DIR=""; BK_DONE=0
bk_cleanup() {  # EXIT trap of backup: undo only what THIS run created
  local rc=$? did=""
  trap - EXIT INT TERM HUP
  if [ "$BK_DONE" != 1 ]; then
    if [ -n "$BK_KEY" ] && [ -f "$BK_KEY" ]; then rm -f "$BK_KEY"; did=1; fi
    [ -z "$BK_ID" ] || rm -f "$BK_ID"
    [ -z "$BK_DIR" ] || rmdir "$BK_DIR" 2>/dev/null || true
    [ -z "$did" ] || echo "CLEANUP: removed the key copy this run created (and only what this run created)." >&2
  fi
  exit "$rc"
}
cmd_backup() {
  [ -n "$FROM" ] && [ -n "$TO" ] || { echo "usage: backup --from-usb /Volumes/<A> --to-usb /Volumes/<B> --role primary|standby [--handover-dir DIR]" >&2; exit 2; }
  role_ok
  usb_need_tools
  local fmp skey dkey fuuid fwhole fpub ffp dmp
  usb_classify "$FROM"; fmp="$U_mount_point"; fuuid="$U_volume_uuid"; fwhole="$U_whole_disk"
  skey="$(usb_keyfile "$fmp" "$ROLE")"
  usb_check_keydir "$fmp" || usb_refuse "the source's key folder is not a real directory on the stick"
  [ -f "$skey" ] && [ ! -L "$skey" ] || usb_refuse "the source stick has no $ROLE key at $skey (or it is a symlink)"
  usb_derive "$skey" --independent; fpub="$K_PUB"; ffp="$K_FP"
  [ ! -e "$(usb_keyfile "$fmp" "$(other_role "$ROLE")")" ] || usb_refuse "the source stick holds the other role's key too: primary and standby must never share a device; fix that first"
  local fidf; fidf="$(usb_idfile "$fmp" "$ROLE")"
  [ "$("${USB_PY[@]}" jget "$fidf" volume_uuid)" = "$fuuid" ] || usb_refuse "the source stick's identity file does not belong to this volume: it is not the original stick"
  local fres; fres="$fmp"
  U_volume_uuid=""; U_whole_disk=""
  usb_classify "$TO"; dmp="$U_mount_point"
  [ "$dmp" != "$fres" ] || usb_refuse "--from-usb and --to-usb are the same volume"
  [ "$U_volume_uuid" != "$fuuid" ] && [ "$U_whole_disk" != "$fwhole" ] || usb_refuse "--from-usb and --to-usb are the same device"
  local ddir; ddir="$(usb_keydir "$dmp")"
  if [ -e "$ddir" ] || [ -L "$ddir" ]; then usb_check_keydir "$dmp" || usb_refuse "the destination's key folder is not a real directory on the stick"; fi
  local duuid="$U_volume_uuid" dname="$U_volume_name" dmedia="$U_media_name" dfs="$U_fs_name" dfree="$U_free_bytes" dwr="$U_writable"
  [ "$dwr" = yes ] || usb_refuse "the destination is read-only"
  [ "${dfree:-0}" -ge 1048576 ] 2>/dev/null || usb_refuse "the destination has less than 1 MiB free"
  dkey="$(usb_keyfile "$dmp" "$ROLE")"
  [ ! -e "$(usb_keyfile "$dmp" "$(other_role "$ROLE")")" ] || usb_refuse "the destination already holds the $(other_role "$ROLE") key: primary and standby must NEVER share a device"
  [ ! -e "$dkey" ] || usb_refuse "the destination already holds a $ROLE key: never overwritten"
  ls "$(usb_keydir "$dmp")"/*.key >/dev/null 2>&1 && usb_refuse "the destination's key folder already holds a key: use an empty dedicated stick"
  echo "== backup: $ROLE key  $fres ($fuuid)  ->  $dmp ($duuid, '$dname', $dfs) =="
  echo "  The copy is UNENCRYPTED, like the original. It is another stick that can be lost or stolen. Keep it in a DIFFERENT place from the original."
  usb_confirm "COPY $(usb_upper "$ROLE") KEY FROM $(usb_uuid8 "$fuuid") TO $(usb_uuid8 "$duuid")"
  # from here a failure or an interrupt removes ONLY what THIS run created (a key created exclusively by this run, its identity file, a folder it made)
  trap bk_cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 129' HUP
  if [ ! -e "$ddir" ]; then ( umask 077; mkdir "$ddir" ) || usb_fail "cannot create the folder on the destination"; BK_DIR="$ddir"; fi
  usb_check_keydir "$dmp" || usb_fail "the destination's key folder is not a real directory on the stick"
  ( umask 077; set -C; : > "$dkey" ) 2>/dev/null || usb_refuse "the destination key file already exists or cannot be created: nothing was changed or deleted"
  BK_KEY="$dkey"
  ( umask 077; cat "$skey" >| "$dkey" ) || usb_fail "the copy failed"
  chmod 0600 "$dkey" 2>/dev/null || true
  usb_derive "$dkey" --independent
  if [ "$K_PUB" != "$fpub" ] || [ "$K_FP" != "$ffp" ]; then usb_fail "the copy's fingerprint differs from the source's"; fi
  [ ! -e "$(usb_idfile "$dmp" "$ROLE")" ] && BK_ID="$(usb_idfile "$dmp" "$ROLE")"
  "${USB_PY[@]}" jwrite "$(usb_idfile "$dmp" "$ROLE")" "schema=1" "kind=aicc-release-signing-key-identity" "role=$ROLE" "public_key=$fpub" "fingerprint=$ffp" "created_utc=$(usb_utc)" "volume_uuid=$duuid" "volume_name=$dname" \
    "filesystem=$dfs" "device_media_name=$dmedia" "is_backup=true" "backup_of_volume_uuid=$fuuid" "tool=usb-key-ceremony.sh backup (P45)" "note=PUBLIC file: no secret. A BACKUP COPY of the $ROLE key." || usb_fail "could not write the destination's identity file"
  sync; usb_sidecars_remove_ours "$dmp"; sync
  local sc; sc="$(usb_sidecars_list "$dmp")"; [ -z "$sc" ] || usb_fail "sidecar files remain on the destination: $(printf '%s' "$sc" | tr '\n' ' ')"
  BK_DONE=1; trap - EXIT INT TERM HUP
  echo "BACKUP DONE: fingerprint $ffp is identical on both sticks (re-derived from the copy; the key was not printed)."
  echo "  destination volume UUID: $duuid. Record it. Eject, re-plug and run: verify --usb <destination> --role $ROLE --expect-pubkey '$fpub'"
  echo "  Store the destination in a DIFFERENT place from the source."
}

case "$SUB" in
  preflight) [ -n "$USB" ] || { echo "usage: preflight --usb /Volumes/<X> --role primary|standby" >&2; exit 2; }; role_ok; usb_need_tools; usb_preflight "$USB" "$ROLE" fresh ;;
  generate) cmd_generate ;;
  verify) cmd_verify ;;
  backup-plan) cmd_backup_plan ;;
  backup) cmd_backup ;;
  ""|-h|--help) sed -n 2,28p "${BASH_SOURCE[0]}"; [ -n "$SUB" ] || exit 2 ;;
  *) echo "unknown subcommand: $SUB (preflight | generate | verify | backup-plan | backup)" >&2; exit 2 ;;
esac
