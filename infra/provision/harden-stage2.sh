#!/usr/bin/env bash
# STAGE 2 hardening of SSH on the staging host: disable root SSH login and allow only the operator account.
#     sudo infra/provision/harden-stage2.sh [--dry-run] [--max-age-min 60]
# Run it from your FIRST session (the one that is already open), AFTER stage2-verify-second-session.sh succeeded in a SECOND session.
#
# What it does, in this order, and stops at the first problem (fail closed):
#   1. must be root; the marker /run/aicc/stage2-verified must exist, be 0600 root, belong to THIS boot (boot id), be younger than --max-age-min
#      (default 60), say user=aicc, and come from a DIFFERENT sshd session than this one (two sessions must really have existed).
#   2. writes /etc/ssh/sshd_config.d/05-aicc-stage2.conf with `PermitRootLogin no` and `AllowUsers aicc`.
#      The name sorts BEFORE cloud-init's 10-aicc-hardening.conf (`PermitRootLogin prohibit-password`): OpenSSH uses the FIRST value it reads.
#   3. `sshd -t` validates the whole configuration; `sshd -T` must then report permitrootlogin no and allowusers aicc. On any failure the new
#      file is removed (or the previous one restored) and sshd is NOT reloaded.
#   4. `systemctl reload ssh` (SIGHUP): existing sessions, including this one, are NOT closed. New root logins are refused from now on.
#   5. prints the rollback command. It never closes, kills or restarts any session.
# Idempotent: a second run finds the file unchanged, re-validates, and does not reload.
set -euo pipefail
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF/lib/common.sh"
. "$SELF/lib/ssh-session.sh"
MAX_AGE_MIN=60
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) AICC_DRY_RUN=1; shift ;;
    --max-age-min) MAX_AGE_MIN="${2:-}"; [[ "$MAX_AGE_MIN" =~ ^[0-9]+$ ]] || die "--max-age-min needs a number"; shift 2 ;;
    -h|--help) sed -n 2,20p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
MARKER="$STAGE2_MARKER_DEFAULT"; SSHD="sshd"; SSHD_DIR=/etc/ssh/sshd_config.d; SYSTEMCTL="systemctl"
if [ "${AICC_TEST_HARNESS:-0}" = "1" ]; then
  MARKER="${AICC_MARKER_PATH:-$MARKER}"; SSHD="${AICC_SSHD_BIN:-$SSHD}"; SSHD_DIR="${AICC_SSHD_DIR:-$SSHD_DIR}"; SYSTEMCTL="${AICC_SYSTEMCTL_BIN:-$SYSTEMCTL}"
else
  [ "$(id -u)" = "0" ] || die "must run as root (sudo). Refusing."
fi
DROPIN="$SSHD_DIR/05-aicc-stage2.conf"

# ---- 1. marker ------------------------------------------------------------------------------------------------------------------------------
[ -f "$MARKER" ] || die "no verification marker ($MARKER). Run stage2-verify-second-session.sh in a SECOND SSH session as aicc first. Refusing."
[ "$(marker_get "$MARKER" AICC_STAGE2_VERIFIED)" = "1" ] || die "marker is malformed. Refusing."
if [ "${AICC_TEST_HARNESS:-0}" != "1" ]; then
  [ "$(owner_of "$MARKER")" = "root:root" ] && [ "$(mode_of "$MARKER")" = "600" ] || die "marker must be root:root 0600 (someone else could have written it). Refusing."
fi
[ "$(marker_get "$MARKER" BOOT_ID)" = "$(boot_id)" ] || die "marker is from a previous boot. Re-run the verification in a second session. Refusing."
age=$(( $(date -u +%s) - $(marker_get "$MARKER" EPOCH) ))
[ "$age" -ge 0 ] && [ "$age" -le $(( MAX_AGE_MIN * 60 )) ] || die "marker is ${age}s old (limit ${MAX_AGE_MIN} min). Re-run the verification. Refusing."
[ "$(marker_get "$MARKER" USER)" = "aicc" ] || die "marker is not for user aicc. Refusing."
read -r CPID CUSER <<<"$(ssh_session_info)" || true
if [ -n "${CPID:-}" ]; then
  [ "$CPID" != "$(marker_get "$MARKER" SESSION_PID)" ] || die "this is the SAME session that wrote the marker. Run this from your FIRST session while the second stays open. Refusing."
  info "current session: sshd pid $CPID user $CUSER (will NOT be closed)"
  [ "$CUSER" = "root" ] && warn "you are in a root session: it keeps working, but no NEW root login will be possible after this"
else info "not in an SSH session (console): fine"; fi
info "marker OK: verified ${age}s ago by aicc from $(marker_get "$MARKER" PEER) (auth log check: $(marker_get "$MARKER" AUTH_LOG_CHECKED))"

# ---- 2/3. drop-in, validate, effective-config check -----------------------------------------------------------------------------------
WANT="$(cat <<'EOT'
# AICC stage 2 (written by infra/provision/harden-stage2.sh). Sorts before 10-aicc-hardening.conf on purpose: OpenSSH keeps the FIRST value.
# Rollback: remove this file, run `sshd -t`, then `systemctl reload ssh`. DigitalOcean web console always works regardless of this file.
PermitRootLogin no
AllowUsers aicc
EOT
)"
RELOAD=0
if [ -f "$DROPIN" ] && [ "$(cat "$DROPIN")" = "$WANT" ]; then info "unchanged: $DROPIN"
else
  if is_dry; then would "write $DROPIN: PermitRootLogin no, AllowUsers aicc; sshd -t; sshd -T check; systemctl reload ssh"; else
    mkdir -p "$SSHD_DIR"
    BAK=""; if [ -f "$DROPIN" ]; then BAK="$(mktemp)"; cp -p "$DROPIN" "$BAK"; fi
    printf '%s\n' "$WANT" > "$DROPIN.new"; chmod 0644 "$DROPIN.new"; mv -f "$DROPIN.new" "$DROPIN"
    revert() { if [ -n "$BAK" ]; then cp -p "$BAK" "$DROPIN"; else rm -f "$DROPIN"; fi; }
    if ! "$SSHD" -t; then revert; die "sshd -t rejected the configuration: change reverted, sshd NOT reloaded"; fi
    eff="$("$SSHD" -T -C user=aicc,host=localhost,addr=127.0.0.1 2>/dev/null || true)"
    echo "$eff" | grep -q '^permitrootlogin no$' || { revert; die "effective config still allows root login (an earlier file wins?): change reverted, sshd NOT reloaded"; }
    echo "$eff" | grep -q '^allowusers aicc$' || { revert; die "effective config lacks 'allowusers aicc': change reverted, sshd NOT reloaded"; }
    [ -n "$BAK" ] && rm -f "$BAK"
    RELOAD=1; info "validated: sshd -t OK; effective permitrootlogin no, allowusers aicc"
  fi
fi
# ---- 4. reload (never restart: SIGHUP keeps established sessions) ------------------------------------------------------------------
if [ "$RELOAD" = 1 ]; then
  "$SYSTEMCTL" reload ssh || { rm -f "$DROPIN"; die "reload failed; drop-in removed. Check: systemctl status ssh"; }
  info "sshd reloaded (existing sessions untouched)"
fi
# ---- 5. rollback instructions ---------------------------------------------------------------------------------------------------------------
cat <<EOT

DONE. Root SSH login is now refused; only 'aicc' may log in.
NOW: from your Mac open a THIRD login as aicc to confirm, and try 'ssh root@<ip>' to confirm it is refused.
ROLLBACK (from any root/sudo shell or the DigitalOcean web console):
    sudo rm $DROPIN && sudo sshd -t && sudo systemctl reload ssh
EOT
