#!/usr/bin/env bash
# OWNER-RUN, on the Mac, in an interactive Terminal: places / rotates / revokes / inspects the Cloudflare TURNSTILE SECRET FILE on the PRODUCTION host without the secret ever being typed into a chat, a command line or a log.
#
#     infra/provision/set-turnstile-secret.sh [install] [--then-check] [--dry-run]
#     infra/provision/set-turnstile-secret.sh rotate   [--then-check] [--dry-run]     (replaces the secret; then let the OLD one expire / invalidate it in Cloudflare)
#     infra/provision/set-turnstile-secret.sh revoke   [--dry-run]                    (removes the file; the secret must also be rolled in Cloudflare)
#     infra/provision/set-turnstile-secret.sh status                                  (stat + shape check of the host file, never its content)
#
# HOW THE SECRET TRAVELS: you paste it ONCE at a hidden prompt (read -rs from /dev/tty, nothing is echoed) and once more to confirm; the two entries are compared by SHA-256 locally and the digest is not shown. It is
#   validated locally (the shape the Control Plane requires: 8-256 printable characters, no space) and then written to the STDIN of one SSH connection. The remote command is
#   `sudo /usr/local/sbin/aicc-set-turnstile-secret <mode> --expect-stage-id <id>`: it contains NO secret. The secret is never in an argument, an environment variable, a temporary file, the process list, your shell history,
#   a trace or a log; this script refuses to run with tracing on (set -x, BASH_XTRACEFD, a custom PS4, SHELLOPTS=xtrace), without a terminal, or with a history file.
#   THE SITE KEY IS NOT THE SECRET: the Cloudflare widget shows a public SITE key and a private SECRET key. Paste the SECRET. (The host refuses a value equal to the site key owner fact once that fact is set; set the secret first
#   and the site key second, or the other way round: the render refuses the same slip either way.)
# BEFORE ANYTHING IS SENT: the pinned identity/host-key gates of the production deploy tooling. The ssh key must be ~/.ssh/aicc_cp_prod_operator, the host key must be pinned in ~/.ssh/known_hosts_aicc_prod (no trust on
#   first use), and the host must READ production: AICC_ENV=production, AICC_HOSTNAME=www.copilt.org, AICC_STAGE_ID=3e897286ce82e55f4d866acf0d526a5f. The remote script checks the same id again in the connection that
#   carries the secret. Only the address 157.230.110.211 can be reached by this script.
# --dry-run: runs every LOCAL check and prints the exact commands (no connection, no prompt, no secret).
# --then-check (install / rotate only): after the secret is placed, shows which constants a render would change (names only), asks before it renders + reloads PHP-FPM, then runs the read-only `aicc-wp aicc-trial status`
#   (the blockers row must no longer say `turnstile`). Output is reduced to what the tools print; anything long and token-shaped is hidden.
# Exit codes: 0 done, 1 a gate or the host refused (nothing was placed unless the output says so), 2 usage.
set -euo pipefail
HARNESS=0
die() { printf 'REFUSED: %s\n' "$*" >&2; exit 1; }
usage() { sed -n 2,6p "${BASH_SOURCE[0]}" >&2; exit 2; }

# TEST SEAMS: AICC_TEST_HARNESS=1 swaps the ssh binary for a fake. It is refused unless AICC_TEST_SSH is an executable file under the system temp dir, and it is never silent.
under_tmp() {   # is the real path of an existing file or directory below $TMPDIR, /tmp, /var/tmp or macOS /private/var/folders?
  local p d t; p="$1"; [ -e "$p" ] || return 1; [ ! -L "$p" ] || return 1     # a symlink that merely LIVES in the temp dir proves nothing
  if [ -d "$p" ]; then d="$(cd "$p" && pwd -P)"; else d="$(cd "$(dirname "$p")" && pwd -P)/$(basename "$p")"; fi
  for t in "${TMPDIR:-}" /tmp /var/tmp; do [ -n "$t" ] || continue; t="$(cd "$t" 2>/dev/null && pwd -P)" || continue; case "$d/" in "$t"/*) return 0 ;; esac; done
  case "$d/" in /private/var/folders/*) return 0 ;; esac
  return 1
}
if [ "${AICC_TEST_HARNESS:-0}" = "1" ]; then
  [ -n "${AICC_TEST_SSH:-}" ] && [ -x "${AICC_TEST_SSH:-}" ] && under_tmp "$AICC_TEST_SSH" || die "AICC_TEST_HARNESS=1 needs AICC_TEST_SSH to be an executable file under the system temp dir (the seam is for tests only)"
  HARNESS=1
  printf '*** TEST HARNESS ACTIVE: ssh is replaced by %s. Never set AICC_TEST_HARNESS on the Mac you use for production. ***\n' "$AICC_TEST_SSH" >&2
fi

# ---- the secret hygiene gates: before any prompt (the tracing checks come first: nothing above them touches a secret) ----------------------------------------------------------------------------------
case "$-" in *x*) die "shell tracing (set -x / bash -x) is on: the key would be traced. Run the script plainly." ;; esac
[ -z "${BASH_XTRACEFD:-}" ] || die "BASH_XTRACEFD is set: a trace could capture the key."
case ":${SHELLOPTS:-}:" in *:xtrace:*) die "SHELLOPTS contains xtrace: a trace could capture the key." ;; esac
[ "${PS4-+ }" = "+ " ] || die "PS4 is customised: a trace prompt could run commands or capture the key."
[ -z "${BASH_ENV:-}" ] || die "BASH_ENV is set: another file would be executed before this script."
unset HISTFILE HISTFILESIZE; HISTSIZE=0; set +o history 2>/dev/null || true
umask 077
ulimit -c 0 2>/dev/null || true       # no core dump that could hold the key

HOSTIP="157.230.110.211"; HOSTNAME_WANT="www.copilt.org"; STAGE_ID="3e897286ce82e55f4d866acf0d526a5f"; REMOTE_USER="aicc"
KEY_FILE="$HOME/.ssh/aicc_cp_prod_operator"; KNOWN_HOSTS="$HOME/.ssh/known_hosts_aicc_prod"
REMOTE_TOOL="/usr/local/sbin/aicc-set-turnstile-secret"
MODE="install"; DRY=0; THEN_CHECK=0; MODE_SET=0
while [ $# -gt 0 ]; do
  case "$1" in
    install|rotate|revoke|status) [ "$MODE_SET" = 0 ] || usage; MODE="$1"; MODE_SET=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --then-check) THEN_CHECK=1; shift ;;
    -h|--help) sed -n 2,26p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done
{ [ "$MODE" = install ] || [ "$MODE" = rotate ]; } || [ "$THEN_CHECK" = 0 ] || die "--then-check applies to install and rotate only"

# ---- the connection: ONLY the production operator identity and the pinned host key ----------------------------------------------------------------------------------------------------------------
SSH_BIN="ssh"; [ "$HARNESS" != 1 ] || SSH_BIN="$AICC_TEST_SSH"
# ISOLATED from the owner's ~/.ssh/config and the system config (-F /dev/null): no ProxyCommand/ProxyJump, no agent or X11 forwarding, no global known hosts, no host-key updates, no multiplexing, no tty. Only the named identity and the PINNED host key file.
SSHO=(-F /dev/null -i "$KEY_FILE" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes "-oUserKnownHostsFile=$KNOWN_HOSTS" -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no
      -o RequestTTY=no -o ProxyCommand=none -o ProxyJump=none -o ForwardAgent=no -o ForwardX11=no -o ClearAllForwardings=yes -o ConnectTimeout=15 -o ControlMaster=no -o ControlPath=none)
rssh() { "$SSH_BIN" "${SSHO[@]}" "$REMOTE_USER@$HOSTIP" "$@"; }
REMOTE_CMD="sudo $REMOTE_TOOL $MODE --expect-stage-id $STAGE_ID"
local_gates() {
  [ -f "$KEY_FILE" ] && [ ! -L "$KEY_FILE" ] || die "the production operator key $KEY_FILE does not exist (or is a link)"
  case "$(stat -f '%Lp' "$KEY_FILE" 2>/dev/null || stat -c '%a' "$KEY_FILE")" in 600|400) ;; *) die "$KEY_FILE must be mode 0600" ;; esac
  [ -s "$KNOWN_HOSTS" ] || die "the pinned host-key file $KNOWN_HOSTS is missing or empty (no trust on first use)"
  ssh-keygen -F "$HOSTIP" -f "$KNOWN_HOSTS" >/dev/null 2>&1 || die "the pinned host-key file $KNOWN_HOSTS has no entry for $HOSTIP"
}
need_tty() {
  [ -t 0 ] || die "stdin is not a terminal: run this in an interactive Terminal window (the key is typed at a hidden prompt, never piped)"
  { : </dev/tty; } 2>/dev/null || die "no controlling terminal (/dev/tty): run this in an interactive Terminal window"
}
verify_identity() {
  local ident
  ident="$(rssh 'cat /etc/aicc-stage-identity' </dev/null 2>/dev/null)" || die "cannot read the host identity over the pinned SSH connection (nothing was sent)"
  printf '%s\n' "$ident" | grep -q '^AICC_ENV=production$' || die "the host does not say AICC_ENV=production (nothing was sent)"
  printf '%s\n' "$ident" | grep -q "^AICC_HOSTNAME=${HOSTNAME_WANT}\$" || die "the host identity hostname is not $HOSTNAME_WANT (nothing was sent)"
  printf '%s\n' "$ident" | grep -q "^AICC_STAGE_ID=${STAGE_ID}\$" || die "the host identity id differs from the expected production id (wrong machine; nothing was sent)"
  echo "host identity verified: production, $HOSTNAME_WANT, stage id ${STAGE_ID:0:8}..."
}
# redact(): anything key-shaped is hidden before it reaches the terminal (defence in depth: the remote tools never print a key)
redact() { sed -E 's/[A-Za-z0-9_-]{32,}/<long-token-hidden>/g'; }

# ---- dry run ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
local_gates
if [ "$DRY" = 1 ]; then
  echo "DRY RUN (no connection, no prompt, no secret). Local gates passed: no tracing, no history, umask 077, operator key and pinned host key present."
  if { [ "$MODE" = install ] || [ "$MODE" = rotate ]; } && { [ -t 0 ] && { : </dev/tty; } 2>/dev/null; }; then echo "terminal: available (the key prompt would work here)"; else echo "terminal: NOT available (install/rotate would refuse here)"; fi
  echo "would verify the host identity: ssh ${SSHO[*]} $REMOTE_USER@$HOSTIP 'cat /etc/aicc-stage-identity'   (expects AICC_ENV=production, AICC_HOSTNAME=$HOSTNAME_WANT, AICC_STAGE_ID=$STAGE_ID)"
  echo "would run:             ssh ${SSHO[*]} $REMOTE_USER@$HOSTIP '$REMOTE_CMD'"
  case "$MODE" in install|rotate) echo "  with the key on that connection's STDIN (hidden prompt, shape-checked locally, confirmed by SHA-256 comparison; never in the command above)" ;; esac
  if [ "$THEN_CHECK" = 1 ]; then
    echo "then (--then-check): aicc-render-wp-config --compare (constant names only), [confirm] render + reload php8.3-fpm, aicc-wp aicc-trial status (read-only)"
  fi
  exit 0
fi

# ---- the terminal and the host identity: BEFORE anything is sent or asked ---------------------------------------------------------------------------------------------------------------------------------
[ "$MODE" = status ] || need_tty
verify_identity
if [ "$MODE" = status ]; then rc=0; rssh "sudo $REMOTE_TOOL status --expect-stage-id $STAGE_ID" </dev/null 2>&1 | redact || rc="${PIPESTATUS[0]}"; exit "$rc"; fi
if [ "$MODE" = revoke ]; then
  printf 'This REMOVES /etc/aicc-mail/turnstile.secret on %s. The signup reads paused (blocker turnstile) until a secret is placed again.\nType REVOKE to continue: ' "$HOSTNAME_WANT" >/dev/tty
  IFS= read -r ans </dev/tty || ans=""
  [ "$ans" = "REVOKE" ] || die "not confirmed; nothing was changed"
  rc=0; rssh "$REMOTE_CMD" </dev/null 2>&1 | redact || rc="${PIPESTATUS[0]}"
  echo "REMINDER: the secret itself is still valid in Cloudflare until YOU roll it there (Turnstile, the widget, Rotate secret key)."
  exit "$rc"
fi

# ---- install / rotate: the hidden prompt -----------------------------------------------------------------------------------------------------------------------------------------------------------
KEY_RE='^[!-~]+$'     # printable ASCII, no space (the {8,256} length bound is checked below: bash regex repetition is capped at 255)
sha8() { printf '%s' "$1" | shasum -a 256 | cut -c1-8; }
printf 'Turnstile SECRET key (input hidden; paste once, then Enter): ' >/dev/tty
IFS= read -rs k1 </dev/tty || k1=""; printf '\n' >/dev/tty
if ! [[ "$k1" =~ $KEY_RE ]] || [ "${#k1}" -lt 8 ] || [ "${#k1}" -gt 256 ]; then n=${#k1}; k1=""; die "the entry does not have the shape of a Turnstile secret key (8-256 printable characters, no space; yours has $n). Nothing was sent."; fi
printf 'Paste the same secret again to confirm (input hidden): ' >/dev/tty
IFS= read -rs k2 </dev/tty || k2=""; printf '\n' >/dev/tty
if [ "$(printf '%s' "$k1" | shasum -a 256)" != "$(printf '%s' "$k2" | shasum -a 256)" ]; then k1=""; k2=""; die "the two entries differ (compared by SHA-256, nothing shown). Nothing was sent."; fi
k2=""
case "$k1" in 0x4*|1x0*|2x0*|3x0*) ;; *) echo "note: the value does not start with 0x4 / 1x0 / 2x0 / 3x0 (the usual Turnstile key prefixes); accepted because the shape is valid." ;; esac
LOCAL_FP="$(sha8 "$k1")"
echo "sending on the SSH connection's standard input (the remote command has no secret): $REMOTE_CMD"
out="$(printf '%s\n' "$k1" | rssh "$REMOTE_CMD" 2>&1)" && rc=0 || rc=$?
k1=""
printf '%s\n' "$out" | redact
[ "$rc" = 0 ] || { echo "the host reported a failure or the connection dropped (exit $rc). STATE UNKNOWN: the host may have committed the key before the failure. Run \`$0 status\` (it never shows the key) before you retry or rotate." >&2; exit 1; }
REMOTE_FP="$(printf '%s\n' "$out" | sed -n 's/^fingerprint: sha256:\([0-9a-f]\{8\}\).*/\1/p' | head -1)"
if [ "$REMOTE_FP" = "$LOCAL_FP" ]; then echo "fingerprint matches what you typed: sha256:$LOCAL_FP (first 8 hex)"; else echo "WARNING: the fingerprint on the host (${REMOTE_FP:-none}) differs from the one computed here ($LOCAL_FP). Do not continue; run status and re-run rotate." >&2; exit 1; fi
[ "$MODE" != rotate ] || echo "NOW: the previous secret is GONE from the host (no copy is kept) but is STILL VALID in Cloudflare until you invalidate it there (Turnstile, the widget, Rotate secret key)."
[ "$THEN_CHECK" = 1 ] || { echo "Done. Next: docs/cutover/p42-activation-steps.md (re-run with --then-check, or the activation runbook)."; exit 0; }

# ---- --then-check ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
echo "---- what a render would change (constant names only, no values) ----"
rssh 'sudo aicc-render-wp-config --env production --confirm-production --compare' </dev/null 2>&1 | redact || true
printf 'Render the configuration and reload PHP-FPM now? [y/N]: ' >/dev/tty
IFS= read -r ans </dev/tty || ans=""
if [ "$ans" = y ] || [ "$ans" = Y ]; then
  rssh 'sudo aicc-render-wp-config --env production --confirm-production && sudo systemctl reload php8.3-fpm' </dev/null 2>&1 | redact || die "the render failed or was refused (see above); nothing further was run"
else echo "skipped: the configuration was not rendered"; fi
echo "---- read-only check (the blockers row must no longer say turnstile) ----"
rssh 'sudo aicc-wp aicc-trial status' </dev/null 2>&1 | redact || true
echo "Done. Next: docs/cutover/p42-activation-steps.md."
