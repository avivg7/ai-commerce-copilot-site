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
