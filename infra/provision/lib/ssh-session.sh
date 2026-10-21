#!/usr/bin/env bash
# Helpers for the two-session lockout protection (sourced by stage2-verify-second-session.sh and harden-stage2.sh).
# They answer: "which SSH session am I in?" by walking the process tree up to the first `sshd` ancestor (the per-session sshd process,
# command line "sshd: <user>@pts/N" or "sshd: <user>@notty"). Linux only (/proc). Under sudo the environment is reset, so SSH_CONNECTION
# cannot be trusted; the process tree can.
#
# Test seam (honoured ONLY with AICC_TEST_HARNESS=1): AICC_TEST_SSH_ANCESTOR="<pid>:<user>" replaces the /proc walk.

ssh_session_info() { # prints "<pid> <user>" of the nearest sshd ancestor, or nothing when not in an SSH session (e.g. DigitalOcean web console)
  if [ "${AICC_TEST_HARNESS:-0}" = "1" ] && [ -n "${AICC_TEST_SSH_ANCESTOR:-}" ]; then
    [ "$AICC_TEST_SSH_ANCESTOR" = "none" ] && return 0
    printf '%s %s\n' "${AICC_TEST_SSH_ANCESTOR%%:*}" "${AICC_TEST_SSH_ANCESTOR#*:}"; return 0
  fi
  local pid=$$ comm cmd user
  while [ "$pid" -gt 1 ] 2>/dev/null; do
    comm="$(cat "/proc/$pid/comm" 2>/dev/null || true)"
    if [ "$comm" = "sshd" ]; then
      cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
      case "$cmd" in
        "sshd: "*"@"*) user="${cmd#sshd: }"; user="${user%%@*}"; printf '%s %s\n' "$pid" "$user"; return 0 ;;
      esac
    fi
    pid="$(sed -e 's/^.*) //' "/proc/$pid/stat" 2>/dev/null | awk '{print $2}')"
    [ -n "$pid" ] || return 0
  done
  return 0
}

# ssh_session_peer: "ip port" of the client of THIS session, taken from SSH_CONNECTION in the environment of the nearest ancestor that has it (sshd sets it for the login shell;
# `sudo` resets the environment of its own child, so the ancestors are read through /proc, as root). Prints nothing when none has it. Informational cross-check, not a security boundary:
# it protects against operator mistakes (wrong session), not against a user who edits his own shell environment.
ssh_session_peer() {
  local pid=$$ v
  while [ "$pid" -gt 1 ] 2>/dev/null; do
    v="$({ tr '\0' '\n' < "/proc/$pid/environ"; } 2>/dev/null | sed -n 's/^SSH_CONNECTION=//p' | head -1)"
    if [ -n "$v" ]; then printf '%s\n' "$v" | awk '{print $1, $2}'; return 0; fi
    pid="$(sed -e 's/^.*) //' "/proc/$pid/stat" 2>/dev/null | awk '{print $2}')"
    [ -n "$pid" ] || return 0
  done
  return 0
}

boot_id() { cat "${AICC_BOOT_ID_FILE:-/proc/sys/kernel/random/boot_id}" 2>/dev/null; }

# Marker format (KEY=VALUE, no secrets): written by the verify step into a tmpfs directory, so it cannot survive a reboot by construction.
STAGE2_MARKER_DEFAULT=/run/aicc/stage2-verified
marker_get() { sed -n "s/^$2=//p" "$1" | head -1; }

# require_second_session_marker <marker file> <max age minutes> : the shared two-session safeguard (same rules as harden-stage2.sh): the verification marker written by
# stage2-verify-second-session.sh must exist, be root:root 0600 (outside the test harness), come from THIS boot, be younger than the limit, be for user aicc and come from a
# DIFFERENT sshd session than the current one. Calls die() on any problem. Used by harden-stage3.sh (harden-stage2.sh keeps its own copy of the same checks).
require_second_session_marker() {
  local marker="$1" max_min="$2" age cpid cuser
  [ -f "$marker" ] || die "no verification marker ($marker). Run stage2-verify-second-session.sh in a SECOND SSH session as aicc first. Refusing."
  [ "$(marker_get "$marker" AICC_STAGE2_VERIFIED)" = "1" ] || die "marker is malformed. Refusing."
  if [ "${AICC_TEST_HARNESS:-0}" != "1" ]; then
    [ "$(owner_of "$marker")" = "root:root" ] && [ "$(mode_of "$marker")" = "600" ] || die "marker must be root:root 0600 (someone else could have written it). Refusing."
  fi
  [ "$(marker_get "$marker" BOOT_ID)" = "$(boot_id)" ] || die "marker is from a previous boot. Re-run the verification in a second session. Refusing."
  age=$(( $(date -u +%s) - $(marker_get "$marker" EPOCH) ))
  [ "$age" -ge 0 ] && [ "$age" -le $(( max_min * 60 )) ] || die "marker is ${age}s old (limit ${max_min} min). Re-run the verification. Refusing."
  [ "$(marker_get "$marker" USER)" = "aicc" ] || die "marker is not for user aicc. Refusing."
  read -r cpid cuser <<<"$(ssh_session_info)" || true
  if [ -n "${cpid:-}" ]; then
    [ "$cpid" != "$(marker_get "$marker" SESSION_PID)" ] || die "this is the SAME session that wrote the marker. Run this from your FIRST session while the second stays open. Refusing."
    info "current session: sshd pid $cpid user $cuser (will NOT be closed)"
  else info "not in an SSH session (console): fine"; fi
  info "marker OK: verified ${age}s ago by aicc"
}
