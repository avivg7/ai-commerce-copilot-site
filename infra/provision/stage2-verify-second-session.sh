#!/usr/bin/env bash
# STEP 1 of stage 2 (lockout protection). Run ON THE HOST, in a SECOND SSH session opened as user `aicc` with the dedicated key, via sudo:
#     sudo ~/aicc-infra-bundle/infra/provision/stage2-verify-second-session.sh
# It proves, from inside that second session, that the operator account really works without root:
#   - the session is an SSH session of user `aicc` (found via the sshd ancestor process, not via spoofable environment variables),
#   - it was authenticated by PUBLIC KEY (sshd's own log line for this very connection), unless --skip-auth-log-check is given,
#   - passwordless sudo works, ~aicc/.ssh/authorized_keys has at least one ed25519 key with safe permissions,
#   - sshd's effective config forbids passwords and allows keys.
# Only then does it write the marker /run/aicc/stage2-verified (tmpfs: gone after a reboot) holding the boot id, time, user, session pid and peer.
# harden-stage2.sh refuses to do anything without a fresh marker from THIS boot. Changes nothing else. Supports --dry-run (checks, writes no marker).
# Procedure and rollback: infra/provision/stage2-verify-second-session.md
set -euo pipefail
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF/lib/common.sh"
. "$SELF/lib/ssh-session.sh"
SKIP_AUTH_LOG=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) AICC_DRY_RUN=1; shift ;;
    --skip-auth-log-check) SKIP_AUTH_LOG=1; shift ;;
    -h|--help) sed -n 2,14p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
MARKER="${STAGE2_MARKER_DEFAULT}"
SSHD="${SSHD_BIN:-sshd}"; AUTH_USER="aicc"; HOME_DIR="/home/aicc"
if [ "${AICC_TEST_HARNESS:-0}" = "1" ]; then MARKER="${AICC_MARKER_PATH:-$MARKER}"; SSHD="${AICC_SSHD_BIN:-$SSHD}"; HOME_DIR="${AICC_TEST_AICC_HOME:-$HOME_DIR}"; fi

if [ "${AICC_TEST_HARNESS:-0}" != "1" ]; then
  [ "$(id -u)" = "0" ] || die "run with sudo from the aicc account (sudo $0). Refusing."
  [ "${SUDO_USER:-}" = "$AUTH_USER" ] || die "this must be run as: sudo ... from the '$AUTH_USER' account (SUDO_USER='${SUDO_USER:-}'). Refusing."
fi
fail=0
ok() { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; fail=$((fail + 1)); }

read -r SPID SUSER <<<"$(ssh_session_info)" || true
if [ -z "${SPID:-}" ]; then bad "not inside an SSH session (the web console cannot prove that SSH login works)"
elif [ "$SUSER" != "$AUTH_USER" ]; then bad "this SSH session belongs to '$SUSER', not '$AUTH_USER': open the second session as $AUTH_USER"
else ok "SSH session pid $SPID belongs to $AUTH_USER"; fi

# peer address of this session: SSH_CONNECTION of the nearest ancestor (read via /proc), else the TCP peer `ss` lists for the session's sshd processes
PEER=""
if [ "${AICC_TEST_HARNESS:-0}" != "1" ] && [ -n "${SPID:-}" ]; then
  read -r PIP PPORT <<<"$(ssh_session_peer)" || true
  [ -n "${PIP:-}" ] && PEER="${PIP}:${PPORT}"
  if [ -z "$PEER" ] && command -v ss >/dev/null 2>&1; then
    PPID_S="$(sed -e 's/^.*) //' "/proc/$SPID/stat" | awk '{print $2}')"
    PEER="$(ss -Htnp state established 2>/dev/null | grep -E "pid=($SPID|$PPID_S)," | awk '{print $4}' | head -1 || true)"
  fi
fi
if [ "$SKIP_AUTH_LOG" = 1 ]; then warn "--skip-auth-log-check: NOT proving that this session used public-key authentication"
elif [ "${AICC_TEST_HARNESS:-0}" = "1" ]; then ok "auth log check (harness)"
elif [ -z "$PEER" ]; then bad "could not find this session's TCP peer with ss (use --skip-auth-log-check only if you checked the login method yourself)"
else
  ip="${PEER%:*}"; port="${PEER##*:}"; ip="${ip#[}"; ip="${ip%]}"
  if journalctl _COMM=sshd --since "-3h" --no-pager 2>/dev/null | grep -q "Accepted publickey for $AUTH_USER from ${ip} port ${port} "; then ok "sshd logged 'Accepted publickey for $AUTH_USER' for this connection ($ip:$port)"
  else bad "no 'Accepted publickey for $AUTH_USER from $ip port $port' in the last 3 hours of sshd's journal: this session was not authenticated by key"; fi
fi

if [ "${AICC_TEST_HARNESS:-0}" = "1" ] || sudo -l -U "$AUTH_USER" 2>/dev/null | grep -q 'NOPASSWD: ALL'; then ok "passwordless sudo is configured for $AUTH_USER (and this script itself runs through it)"; else bad "$AUTH_USER has no NOPASSWD sudo rule"; fi
AK="$HOME_DIR/.ssh/authorized_keys"
if [ -s "$AK" ] && grep -Eq '^(ssh-ed25519|sk-ssh-ed25519@openssh.com) ' "$AK"; then ok "authorized_keys has an ed25519 key"; else bad "$AK missing, empty or without an ed25519 key"; fi
if [ -f "$AK" ]; then m="$(mode_of "$AK")"; case "$m" in 600|640|644) ok "authorized_keys mode $m";; *) bad "authorized_keys mode $m is unexpected";; esac; fi
eff="$("$SSHD" -T 2>/dev/null || true)"
if [ -n "$eff" ]; then
  echo "$eff" | grep -q '^pubkeyauthentication yes$' && ok "sshd: pubkeyauthentication yes" || bad "sshd: pubkeyauthentication is not yes"
  echo "$eff" | grep -q '^passwordauthentication no$' && ok "sshd: passwordauthentication no" || bad "sshd: passwordauthentication is not no"
else bad "sshd -T printed nothing (cannot read the effective sshd configuration)"; fi

if [ "$fail" -gt 0 ]; then echo; echo "$fail check(s) FAILED: no marker written, harden-stage2.sh will refuse. Fix the above and re-run from the second session." >&2; exit 1; fi
if is_dry; then echo "DRY-RUN: all checks passed; marker $MARKER would be written"; exit 0; fi
mkdir -p "$(dirname "$MARKER")"; chmod 755 "$(dirname "$MARKER")"
tmp="$(mktemp "$(dirname "$MARKER")/.marker.XXXXXX")"
{
  echo "AICC_STAGE2_VERIFIED=1"
  echo "BOOT_ID=$(boot_id)"
  echo "EPOCH=$(date -u +%s)"
  echo "ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "USER=$AUTH_USER"
  echo "SESSION_PID=${SPID:-0}"
  echo "PEER=${PEER:-unknown}"
  echo "AUTH_LOG_CHECKED=$([ "$SKIP_AUTH_LOG" = 1 ] && echo skipped || echo yes)"
} > "$tmp"
chmod 600 "$tmp"; mv -f "$tmp" "$MARKER"
echo
echo "Marker written: $MARKER (valid for this boot only). Now go back to your FIRST session and run: sudo infra/provision/harden-stage2.sh"
echo "Keep THIS session open until the hardening has finished and you have opened a third login to confirm."
