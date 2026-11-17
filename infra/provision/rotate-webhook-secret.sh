#!/usr/bin/env bash
# OWNER-RUN, on the Mac: rotates AICC_ENTITLEMENT_WEBHOOK_SECRET (the HMAC secret the Control Plane signs entitlement events with and the Backend verifies them with) on BOTH production hosts,
# in a coordinated, verified, recoverable way. NEVER ATOMIC: read "WHAT IS AND IS NOT GUARANTEED" before you run it.
#
#     infra/provision/rotate-webhook-secret.sh plan      --confirm-production                 (alias --dry-run) every read-only preflight on both hosts + the exact steps; generates nothing, changes nothing
#     infra/provision/rotate-webhook-secret.sh run       --confirm-production [--finalize]    the full rotation; stops at READY TO FINALIZE (or finalizes with --finalize)
#     infra/provision/rotate-webhook-secret.sh resume    --confirm-production [--id ID]       continue an unfinished rotation from the state recorded on the hosts
#     infra/provision/rotate-webhook-secret.sh status    --confirm-production [--id ID]       what both hosts say (never a secret)
#     infra/provision/rotate-webhook-secret.sh rollback  --confirm-production [--id ID]       BEFORE finalize only: put the OLD secret back on both hosts (it is the EXPOSED one)
#     infra/provision/rotate-webhook-secret.sh finalize  --confirm-production --id ID         verify, then RETIRE the old secret on both hosts (registry); a separate, explicit step
#     infra/provision/rotate-webhook-secret.sh verify    --confirm-production                 read-only, any time (also after ANY backup restore): same secret on both hosts, neither retired, the Backend accepts the CP's signature
#     infra/provision/rotate-webhook-secret.sh install-api-tool --confirm-production          (run does it) installs the API host tool: sha256 checked before and after
#   options: --id ID  --no-wait-drain  --drain-timeout SEC (600)  --poll-interval SEC (15)  --health-timeout SEC (90)  --preflight-cmd EXECUTABLE (read-only check run before and after)
#            --api-hostname NAME  --bystander NAME  --cp-key FILE  --api-key FILE  --known-hosts FILE  --api-known-hosts FILE  --force-new-rotation  --emergency-outside-window  --i-reinstate-a-retired-secret
#
# WHAT IS AND IS NOT GUARANTEED. The Backend knows ONE webhook secret (no previous slot), so the two hosts CANNOT change at the same instant. Between the Backend restart and the Control Plane promote
#   (target well under 60 s) every delivery of the Control Plane is answered 401 and RE-QUEUED. Events survive because the Control Plane's outbox is durable (8 attempts with exponential backoff
#   60 s .. 1 h, a requeue reconciliation, delivered_at only after a 2xx; a 401 is a failed attempt, never a drop), `event_id` is the Backend's primary key (a repeated delivery is a no-op) and the
#   Backend applies only a strictly higher `sequence`. The script PROVES it afterwards: outbox exhausted == 0 and pending back to (at or below) the baseline, within a bounded wait.
#   The exposed secret is rotated ONLY when `verify` passes after the cutover, and RETIRED only by `finalize`.
# ORDER: BACKEND FIRST, then the Control Plane (a failed Backend restart leaves the Control Plane untouched: one host to restore). Backend restart = a few seconds; the Plugin and the merchants keep
#   their licences (entitlement lives in the Backend database); only the delivery of NEW events waits.
# HOW THE SECRET TRAVELS: it is generated ON the Control Plane host (python secrets.token_hex(32)), read there by `emit-next` and written to the STDIN of a second ssh connection to the API host:
#   `ssh CP 'sudo ... emit-next --id X' | ssh API 'sudo ... stage --id X'`. It exists on THIS Mac only inside that pipe (kernel pipe buffers): never in a variable, argument, environment, file, history, log or
#   terminal; this script refuses to run with tracing on, sets umask 077 and no core dump, and only ever compares FINGERPRINTS (first 16 hex of a salted SHA-256) afterwards.
# SAFETY: --confirm-production is required; the host identity of BOTH hosts is verified before anything else (CP: stage id + host name; API: host name, the aicc-backend unit, /health); ssh is
#   isolated (-F /dev/null, only the named identity and the pinned known hosts, no forwarding, no tty). Deploy windows: UTC minutes 18-26 and 48-56 of any hour, never UTC hours 02 and 03 (mutating
#   commands only; plan / status / verify run any time). THE TOOLS NEVER DELETE A BACKUP, a retired secret or a staged secret.
# Exit codes: 0 done, 1 refused or failed (the output says whether anything live changed and the exact next command), 2 usage.
set -euo pipefail
die() { printf 'REFUSED: %s\n' "$*" >&2; exit 1; }
usage() { sed -n 2,13p "${BASH_SOURCE[0]}" >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS=0

# TEST SEAMS: AICC_TEST_HARNESS=1 swaps the ssh binary for a fake. It is refused unless AICC_TEST_SSH is an executable file under the system temp dir, and it is never silent.
under_tmp() {
  local p d t; p="$1"; [ -e "$p" ] || return 1; [ ! -L "$p" ] || return 1
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

# ---- the secret hygiene gates: before any connection (the secret is in no variable of this script; the gates are defence in depth) ------------------------------------------------------------------
case "$-" in *x*) die "shell tracing (set -x / bash -x) is on: a trace could capture a secret in transit. Run the script plainly." ;; esac
[ -z "${BASH_XTRACEFD:-}" ] || die "BASH_XTRACEFD is set: a trace could capture a secret."
case ":${SHELLOPTS:-}:" in *:xtrace:*) die "SHELLOPTS contains xtrace: a trace could capture a secret." ;; esac
[ "${PS4-+ }" = "+ " ] || die "PS4 is customised: a trace prompt could run commands or capture a secret."
[ -z "${BASH_ENV:-}" ] || die "BASH_ENV is set: another file would be executed before this script."
unset HISTFILE HISTFILESIZE; HISTSIZE=0; set +o history 2>/dev/null || true
umask 077
ulimit -c 0 2>/dev/null || true       # no core dump

# ---- defaults: the two production hosts ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
CP_IP="157.230.110.211"; CP_USER="aicc"; CP_HOSTNAME_WANT="www.copilt.org"; CP_STAGE_ID="3e897286ce82e55f4d866acf0d526a5f"
CP_KEY="$HOME/.ssh/aicc_cp_prod_operator"; KNOWN_HOSTS="$HOME/.ssh/known_hosts_aicc_prod"
API_IP="139.59.157.231"; API_USER="aicc"; API_HOSTNAME_WANT="api.copilt.org"; BYSTANDER="nourishvik-care"
API_KEY="$HOME/.ssh/aicc_digitalocean_prod"        # the production API operator identity (named here only to be offered to ssh with IdentitiesOnly)
API_KNOWN_HOSTS=""
CP_TOOL="/usr/local/sbin/aicc-rotate-webhook-secret"; API_TOOL="/usr/local/sbin/aicc-rotate-webhook-secret-api"
API_TOOL_SRC="$HERE/host/aicc-rotate-webhook-secret-api"
SUB=""; ID=""; CONFIRM=0; FINALIZE=0; WAIT_DRAIN=1; DRAIN_TIMEOUT=600; POLL=15; HEALTH_TIMEOUT=90; PREFLIGHT_CMD=""
IGNORE_WINDOW=0; EMERGENCY=0; FORCE_NEW=0; REINSTATE=0; BACKEND_URL=""
[ $# -ge 1 ] || usage
case "$1" in -h|--help) sed -n 2,40p "${BASH_SOURCE[0]}"; exit 0 ;; esac
SUB="$1"; shift
case "$SUB" in plan|--dry-run|run|resume|status|rollback|finalize|verify|install-api-tool) ;; *) echo "unknown subcommand: $SUB" >&2; usage ;; esac
[ "$SUB" != "--dry-run" ] || SUB="plan"
need_arg() { [ $# -ge 2 ] || { echo "missing value for $1" >&2; usage; }; }
harness_only() { [ "$HARNESS" = 1 ] || die "$1 exists only for the test harness (AICC_TEST_HARNESS=1)"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --confirm-production) CONFIRM=1; shift ;;
    --id) need_arg "$@"; ID="$2"; shift 2 ;;
    --finalize) FINALIZE=1; shift ;;
    --no-wait-drain) WAIT_DRAIN=0; shift ;;
    --drain-timeout) need_arg "$@"; DRAIN_TIMEOUT="$2"; shift 2 ;;
    --poll-interval) need_arg "$@"; POLL="$2"; shift 2 ;;
    --health-timeout) need_arg "$@"; HEALTH_TIMEOUT="$2"; shift 2 ;;
    --preflight-cmd) need_arg "$@"; PREFLIGHT_CMD="$2"; shift 2 ;;
    --api-hostname) need_arg "$@"; API_HOSTNAME_WANT="$2"; shift 2 ;;
    --bystander) need_arg "$@"; BYSTANDER="$2"; shift 2 ;;
    --cp-key) need_arg "$@"; CP_KEY="$2"; shift 2 ;;
    --api-key) need_arg "$@"; API_KEY="$2"; shift 2 ;;
    --known-hosts) need_arg "$@"; KNOWN_HOSTS="$2"; shift 2 ;;
    --api-known-hosts) need_arg "$@"; API_KNOWN_HOSTS="$2"; shift 2 ;;
    --force-new-rotation) FORCE_NEW=1; shift ;;
    --dry-run) [ "$SUB" = plan ] || die "--dry-run is the alias of the plan subcommand only"; shift ;;
    --emergency-outside-window) EMERGENCY=1; shift ;;
    --i-reinstate-a-retired-secret) REINSTATE=1; shift ;;
    --ignore-window) harness_only "$1"; IGNORE_WINDOW=1; shift ;;
    --cp-ip) need_arg "$@"; harness_only "$1"; CP_IP="$2"; shift 2 ;;
    --cp-user) need_arg "$@"; harness_only "$1"; CP_USER="$2"; shift 2 ;;
    --api-ip) need_arg "$@"; harness_only "$1"; API_IP="$2"; shift 2 ;;
    --api-user) need_arg "$@"; harness_only "$1"; API_USER="$2"; shift 2 ;;
    --cp-stage-id) need_arg "$@"; harness_only "$1"; CP_STAGE_ID="$2"; shift 2 ;;
    --backend-url) need_arg "$@"; harness_only "$1"; BACKEND_URL="$2"; shift 2 ;;
    -h|--help) sed -n 2,40p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done
[ "$CONFIRM" = 1 ] || die "every subcommand needs --confirm-production (this connects to the PRODUCTION hosts)"
[ -n "$API_KNOWN_HOSTS" ] || API_KNOWN_HOSTS="$KNOWN_HOSTS"
[ -z "$ID" ] || [[ "$ID" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die "--id must look like 20261117T182030Z (the UTC time the rotation started)"
[[ "$DRAIN_TIMEOUT" =~ ^[0-9]{1,5}$ ]] && [[ "$HEALTH_TIMEOUT" =~ ^[0-9]{1,3}$ ]] || die "--drain-timeout / --health-timeout must be whole seconds"
[[ "$POLL" =~ ^[0-9]{1,3}(\.[0-9]{1,2})?$ ]] || die "--poll-interval must be seconds (at most 999)"
[[ "$API_HOSTNAME_WANT" =~ ^[A-Za-z0-9.-]{1,100}$ ]] || die "--api-hostname is not a plain host name"
[[ "$BYSTANDER" =~ ^[a-z0-9][a-z0-9_.-]{0,62}$ ]] || die "--bystander is not a plain container name"
[ -z "$PREFLIGHT_CMD" ] || { [ -f "$PREFLIGHT_CMD" ] && [ -x "$PREFLIGHT_CMD" ] || die "--preflight-cmd must be an executable file (a read-only check script)"; }
[ -z "$BACKEND_URL" ] || [[ "$BACKEND_URL" =~ ^http://127\.0\.0\.1:[0-9]{2,5}$ ]] || die "--backend-url must be http://127.0.0.1:<port>"
[ -f "$API_TOOL_SRC" ] || die "the API host tool is missing from this checkout: $API_TOOL_SRC"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/aicc-rot.XXXXXX")"; trap 'rm -rf "$WORK"' EXIT
JDIR="${AICC_ROT_STATE_DIR:-$HOME/.aicc-webhook-rotation}"
jlog() { # <phase> [text]: a local, secret-free trace of the phases (the hosts' own journals are the truth)
  [ -n "${ID:-}" ] || return 0
  mkdir -p "$JDIR" 2>/dev/null && chmod 700 "$JDIR" 2>/dev/null || return 0
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "${2:-}" >> "$JDIR/$ID.log" 2>/dev/null || true
}

# ---- the connections: ONLY the named identities and the pinned host keys ---------------------------------------------------------------------------------------------------------------------------------
SSH_BIN="ssh"; [ "$HARNESS" != 1 ] || SSH_BIN="$AICC_TEST_SSH"
ssh_opts() { # <identity> <known hosts>: prints one option per line (bash 3.2 has no namerefs)
  printf '%s\n' -F /dev/null -i "$1" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes "-oUserKnownHostsFile=$2" -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no \
    -o RequestTTY=no -o ProxyCommand=none -o ProxyJump=none -o ForwardAgent=no -o ForwardX11=no -o ClearAllForwardings=yes -o ConnectTimeout=15 -o ControlMaster=no -o ControlPath=none
}
CPSSHO=(-F /dev/null -i "$CP_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes "-oUserKnownHostsFile=$KNOWN_HOSTS" -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no
        -o RequestTTY=no -o ProxyCommand=none -o ProxyJump=none -o ForwardAgent=no -o ForwardX11=no -o ClearAllForwardings=yes -o ConnectTimeout=15 -o ControlMaster=no -o ControlPath=none)
APISSHO=(-F /dev/null -i "$API_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes "-oUserKnownHostsFile=$API_KNOWN_HOSTS" -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no
         -o RequestTTY=no -o ProxyCommand=none -o ProxyJump=none -o ForwardAgent=no -o ForwardX11=no -o ClearAllForwardings=yes -o ConnectTimeout=15 -o ControlMaster=no -o ControlPath=none)
rcp() { "$SSH_BIN" "${CPSSHO[@]}" "$CP_USER@$CP_IP" "$@"; }
rapi() { "$SSH_BIN" "${APISSHO[@]}" "$API_USER@$API_IP" "$@"; }
redact() { sed -E 's/[A-Za-z0-9_+]{41,}/<long-token-hidden>/g'; }
CPOUT=""; CPRC=0; APIOUT=""; APIRC=0; QUIET=0
# cpc / apic <tool args...>: run the tool, keep the redacted output and the exit code (never aborts the script), print the output indented unless QUIET=1
cpc() {
  local out rc=0
  out="$(rcp "sudo $CP_TOOL $* --expect-stage-id $CP_STAGE_ID" </dev/null 2>&1)" || rc=$?
  CPOUT="$(printf '%s\n' "$out" | { grep -v 'TEST HARNESS ACTIVE' || true; } | redact)"; CPRC=$rc
  [ "$QUIET" = 1 ] || printf '%s\n' "$CPOUT" | sed 's/^/  [CP]  /'
  return 0
}
API_TAIL() { printf -- '--expect-hostname %s --bystander %s --health-timeout %s' "$API_HOSTNAME_WANT" "$BYSTANDER" "$HEALTH_TIMEOUT"; }
API_INST=""      # unknown / 1 installed / 0 not installed: a read-only call falls back to the checkout's file over stdin
apic() {
  local out rc=0 first="${1:-}"
  case "$first" in
    status|fingerprint|probe-new|preflight)
      if [ -z "$API_INST" ]; then if rapi "test -x $API_TOOL" </dev/null >/dev/null 2>&1; then API_INST=1; else API_INST=0; fi; fi
      if [ "$API_INST" = 0 ]; then apic_stdin "$@"; return 0; fi ;;
  esac
  out="$(rapi "sudo $API_TOOL $* $(API_TAIL)" </dev/null 2>&1)" || rc=$?
  APIOUT="$(printf '%s\n' "$out" | { grep -v 'TEST HARNESS ACTIVE' || true; } | redact)"; APIRC=$rc
  [ "$QUIET" = 1 ] || printf '%s\n' "$APIOUT" | sed 's/^/  [API] /'
  return 0
}
# the API tool run from THIS checkout's file over stdin (read-only modes only): the plan checks the host without installing anything
apic_stdin() {
  local out rc=0
  out="$(rapi "sudo python3 -I - $* $(API_TAIL)" < "$API_TOOL_SRC" 2>&1)" || rc=$?
  APIOUT="$(printf '%s\n' "$out" | { grep -v 'TEST HARNESS ACTIVE' || true; } | redact)"; APIRC=$rc
  [ "$QUIET" = 1 ] || printf '%s\n' "$APIOUT" | sed 's/^/  [API] /'
  return 0
}
field() { # <text> <LINE-TAG> <key>: the value of key=value on the last line that starts with LINE-TAG
  { printf '%s\n' "$1" | grep -E "^$2 " | tail -1 | sed -n "s/.*[ ]$3=\\([^ ]*\\).*/\\1/p"; } || true
}
banner() { printf '\n== %s ==\n' "$*"; }

# ---- the gates ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
now_hhmm() { if [ "$HARNESS" = 1 ] && [ -n "${AICC_TEST_UTC_HHMM:-}" ]; then printf '%s' "$AICC_TEST_UTC_HHMM"; else date -u +%H:%M; fi; }
in_window() {
  local t h m; t="$(now_hhmm)"; h=$((10#${t%%:*})); m=$((10#${t##*:}))
  [ "$h" -ne 2 ] && [ "$h" -ne 3 ] || return 1
  if [ "$m" -ge 18 ] && [ "$m" -le 26 ]; then return 0; fi
  if [ "$m" -ge 48 ] && [ "$m" -le 56 ]; then return 0; fi
  return 1
}
window_gate() { # <what>: mutating commands only
  [ "$IGNORE_WINDOW" = 1 ] && return 0
  in_window && return 0
  case "$1" in resume|rollback) if [ "$EMERGENCY" = 1 ]; then echo "*** --emergency-outside-window: continuing OUTSIDE the deploy window because the hosts may be half rotated (the identity gates still apply) ***"; return 0; fi ;; esac
  die "$1 is outside the deploy windows (UTC minutes 18-26 and 48-56 of any hour, never UTC hours 02 and 03; now is $(now_hhmm) UTC). Nothing was changed. Run it inside a window."
}
local_gates() {
  local f
  for f in "$CP_KEY" "$API_KEY"; do
    [ -f "$f" ] && [ ! -L "$f" ] || die "the operator key $f does not exist (or is a link)"
    case "$(stat -f '%Lp' "$f" 2>/dev/null || stat -c '%a' "$f")" in 600|400) ;; *) die "$f must be mode 0600" ;; esac
  done
  [ -s "$KNOWN_HOSTS" ] || die "the pinned host-key file $KNOWN_HOSTS is missing or empty (no trust on first use)"
  [ -s "$API_KNOWN_HOSTS" ] || die "the pinned host-key file $API_KNOWN_HOSTS is missing or empty (no trust on first use)"
  ssh-keygen -F "$CP_IP" -f "$KNOWN_HOSTS" >/dev/null 2>&1 || die "the pinned host-key file $KNOWN_HOSTS has no entry for $CP_IP"
  ssh-keygen -F "$API_IP" -f "$API_KNOWN_HOSTS" >/dev/null 2>&1 || die "the pinned host-key file $API_KNOWN_HOSTS has no entry for $API_IP"
}
verify_identity_cp() {
  local ident
  ident="$(rcp 'cat /etc/aicc-stage-identity' </dev/null 2>/dev/null)" || die "cannot read the Control Plane host identity over the pinned SSH connection (nothing was changed)"
  printf '%s\n' "$ident" | grep -q '^AICC_ENV=production$' || die "the Control Plane host does not say AICC_ENV=production (nothing was changed)"
  printf '%s\n' "$ident" | grep -q "^AICC_HOSTNAME=${CP_HOSTNAME_WANT}\$" || die "the Control Plane host identity hostname is not $CP_HOSTNAME_WANT (nothing was changed)"
  printf '%s\n' "$ident" | grep -q "^AICC_STAGE_ID=${CP_STAGE_ID}\$" || die "the Control Plane host identity id differs from the expected production id (wrong machine; nothing was changed)"
  echo "Control Plane identity verified: production, $CP_HOSTNAME_WANT, stage id ${CP_STAGE_ID:0:8}..."
}
verify_identity_api() {
  local hn act h
  hn="$(rapi 'hostname' </dev/null 2>/dev/null)" || die "cannot reach the API host over the pinned SSH connection (nothing was changed)"
  [ "$hn" = "$API_HOSTNAME_WANT" ] || die "the API host says its name is '$hn', expected '$API_HOSTNAME_WANT' (wrong machine, or pass --api-hostname; nothing was changed)"
  act="$(rapi 'systemctl is-active aicc-backend' </dev/null 2>/dev/null)" || act="no"
  [ "$act" = "active" ] || die "the API host has no active aicc-backend unit (wrong machine; nothing was changed)"
  h="$(rapi 'curl -s --max-time 5 http://127.0.0.1:8000/health' </dev/null 2>/dev/null)" || h=""
  printf '%s' "$h" | python3 -I -c 'import json,re,sys; j=json.load(sys.stdin); assert j.get("status")=="ok" and j.get("database")=="connected" and re.fullmatch(r"[0-9a-f]{40}", j.get("build","")) and j.get("entitlement_mode")' 2>/dev/null \
    || die "the API host's /health is not the expected Backend (status ok, database connected, a 40-hex build, entitlement_mode): nothing was changed"
  echo "API host identity verified: $hn, aicc-backend active, /health ok"
}
gates() { # <mutating: 0|1> <what>
  local_gates
  [ "$1" = 0 ] || window_gate "$2"
  verify_identity_cp
  verify_identity_api
}
age_seconds() { python3 -I -c 'import calendar,sys,time; print(int(time.time() - calendar.timegm(time.strptime(sys.argv[1], "%Y-%m-%dT%H:%M:%SZ"))))' "$1" 2>/dev/null || echo 999999; }

# ---- status of the hosts' journals ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
cp_phase() { QUIET=1 cpc status --id "$1"; { printf '%s\n' "$CPOUT" | grep -E "^rotation: id=$1 " | sed -n 's/.* phase=\([a-z-]*\).*/\1/p' | tail -1; } || true; }
unfinished_ids() { QUIET=1 cpc status; QUIET=1 apic status; { printf '%s\n' "$CPOUT"; printf '%s\n' "$APIOUT"; } | sed -n 's/^UNFINISHED id=\([0-9T]*Z\) .*/\1/p' | sort -u; }

# ---- install-api-tool ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
install_api_tool() {
  local want have got up_script tmp="${API_TOOL}.new"
  want="$(shasum -a 256 "$API_TOOL_SRC" | cut -d' ' -f1)"
  have="$(rapi "sha256sum $API_TOOL 2>/dev/null | cut -d' ' -f1" </dev/null 2>/dev/null)" || have=""
  if [ "$have" = "$want" ]; then API_INST=1; echo "API host tool: already installed, sha256 ${want:0:16}... matches this checkout (nothing changed)"; return 0; fi
  read -r -d '' up_script <<EOS || true
set -e; umask 077; t=$tmp; rm -f "\$t"; cat > "\$t"; chown root:root "\$t"; chmod 0755 "\$t"; sha256sum "\$t" | cut -d" " -f1
EOS
  got="$(rapi "sudo sh -c '$up_script'" < "$API_TOOL_SRC" 2>/dev/null)" || got=""
  if [ "$got" != "$want" ]; then rapi "sudo rm -f $tmp" </dev/null >/dev/null 2>&1 || true; die "the uploaded API host tool does not match this checkout (sha256 before install: '${got:0:16}' vs '${want:0:16}'); the installed tool was NOT replaced"; fi
  rapi "sudo mv -f $tmp $API_TOOL" </dev/null >/dev/null 2>&1 || die "could not move the verified API host tool into place"
  got="$(rapi "sudo sha256sum $API_TOOL | cut -d' ' -f1" </dev/null 2>/dev/null)" || got=""
  [ "$got" = "$want" ] || die "the installed API host tool does not match this checkout after the move (sha256 '${got:0:16}'): investigate before going on"
  API_INST=1
  echo "API host tool: installed $API_TOOL root:root 0755, sha256 ${want:0:16}... verified before and after"
}

# ---- the steps of a rotation ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
CHANGED="nothing live has changed"
fail_phase() { # <phase> <detail> <next>
  printf '\nFAILED in phase: %s\n  %s\n  Live change so far: %s\n  Next: %s\n' "$1" "$2" "$CHANGED" "$3" >&2
  jlog "FAILED:$1" "$2"
  exit 1
}
cmds_hint() { printf '`%s resume --confirm-production --id %s` (continue) or `%s rollback --confirm-production --id %s` (put the OLD, EXPOSED secret back on both hosts)' "$0" "$ID" "$0" "$ID"; }

preflight_both() { # <id or empty>
  local rc=0 idarg=""; [ -z "$1" ] || idarg="--id $1"
  banner "preflight: Control Plane"
  cpc preflight $idarg
  [ "$CPRC" = 0 ] || rc=1
  banner "preflight: API host (the tool of THIS checkout, run from stdin: nothing is installed by this step)"
  apic_stdin preflight $idarg
  [ "$APIRC" = 0 ] || rc=1
  return "$rc"
}

run_preflight_cmd() { # <label>
  [ -n "$PREFLIGHT_CMD" ] || return 0
  banner "external read-only preflight ($1): $PREFLIGHT_CMD"
  local out rc=0
  out="$("$PREFLIGHT_CMD" </dev/null 2>&1)" || rc=$?
  printf '%s\n' "$out" | redact | sed 's/^/  [hook] /'
  [ "$rc" = 0 ] || return 1
}

transfer_and_stage() {
  local ef="$WORK/cp.err" of="$WORK/api.out" rcs
  rm -f "$ef" "$of"
  set +e
  rcp "sudo $CP_TOOL emit-next --id $ID --expect-stage-id $CP_STAGE_ID" </dev/null 2>"$ef" | rapi "sudo $API_TOOL stage --id $ID $(API_TAIL)" >"$of" 2>&1
  rcs=("${PIPESTATUS[@]}")
  set -e
  redact < "$ef" | sed 's/^/  [CP]  /'; redact < "$of" | sed 's/^/  [API] /'
  rm -f "$ef" "$of"
  [ "${rcs[0]}" = 0 ] && [ "${rcs[1]}" = 0 ] || return 1
}

drain_wait() { # <baseline pending>
  local base="$1" start now p e
  start="$(date +%s)"
  while :; do
    QUIET=1 cpc outbox
    p="$(field "$CPOUT" OUTBOX pending)"; e="$(field "$CPOUT" OUTBOX exhausted)"
    if [ -z "$p" ] || [ -z "$e" ]; then echo "  outbox: could not be read ($(printf '%s' "$CPOUT" | tail -1))"; return 1; fi
    echo "  outbox: pending=$p (baseline $base) exhausted=$e"
    if [ "$e" != 0 ]; then echo "  EXHAUSTED EVENTS: $e. They are not deleted (the outbox keeps them) but they will not retry by themselves."; return 2; fi
    if [ "$p" -le "$base" ]; then return 0; fi
    now="$(date +%s)"
    if [ $((now - start)) -ge "$DRAIN_TIMEOUT" ]; then return 3; fi
    sleep "$POLL"
  done
}

probes() {
  local bad=0 u=""
  [ -z "$BACKEND_URL" ] || u="--backend-url $BACKEND_URL"
  banner "phase 8/10: probes (non-mutating: a deliberately malformed body signed with each secret; the Backend checks the signature BEFORE it parses the body and never touches the database)"
  cpc probe-new $u; [ "$CPRC" = 0 ] || bad=1
  cpc probe-old --id "$ID" $u; [ "$CPRC" = 0 ] || bad=1
  apic probe-old --id "$ID"; [ "$APIRC" = 0 ] || bad=1
  apic probe-new --id "$ID"; [ "$APIRC" = 0 ] || bad=1
  return "$bad"
}

fingerprints_equal() { # <cp which> <api which> [--id]: both fingerprints, compared (never a secret)
  local a b
  QUIET=1 cpc fingerprint --which "$1" ${3:+--id "$3"}; a="$CPOUT"; [ "$CPRC" = 0 ] || return 1
  QUIET=1 apic fingerprint --which "$2" ${3:+--id "$3"}; b="$APIOUT"; [ "$APIRC" = 0 ] || return 1
  [[ "$a" =~ ^[0-9a-f]{16}$ ]] && [ "$a" = "$b" ] || return 1
  FP="$a"
}

observe_checks() { # bystander + Backend build/mode compared with the baseline recorded in the API journal
  local bad=0 b0 b1 h0 h1
  QUIET=1 apic status --id "$ID"
  b0="$(printf '%s\n' "$APIOUT" | grep -E '^BASELINE ' | tail -1 || true)"
  [ -n "$b0" ] || { echo "  no baseline recorded in the API journal"; return 1; }
  b1="$(printf '%s\n' "$APIOUT" | grep -E '^BYSTANDER ' | tail -1 || true)"; h1="$(printf '%s\n' "$APIOUT" | grep -E '^HEALTH ' | tail -1 || true)"
  local want_started now_started want_build now_build want_mode now_mode
  want_started="$(field "$b0" BASELINE bystander_started_at)"; now_started="$(field "$b1" BYSTANDER started_at)"
  want_build="$(field "$b0" BASELINE build)"; now_build="$(field "$h1" HEALTH build)"
  want_mode="$(field "$b0" BASELINE mode)"; now_mode="$(field "$h1" HEALTH mode)"
  if [ "$want_started" = "$now_started" ] && [ "$(field "$b1" BYSTANDER state)" = running ]; then echo "  bystander $BYSTANDER: unchanged (StartedAt $now_started, running)"; else echo "  BYSTANDER CHANGED: StartedAt was $want_started, now $now_started (state $(field "$b1" BYSTANDER state)). This tool never touches it (read-only docker inspect); check whether an unattended upgrade restarted it."; bad=1; fi
  if [ "$want_build" = "$now_build" ] && [ "$want_mode" = "$now_mode" ]; then echo "  Backend build ${now_build:0:12} and entitlement_mode $now_mode: unchanged"; else echo "  BACKEND BUILD/MODE CHANGED: build $want_build -> $now_build, mode $want_mode -> $now_mode"; bad=1; fi
  return "$bad"
}

do_finalize_steps() {
  banner "finalize $ID: verify, then retire the old secret"
  local u=""; [ -z "$BACKEND_URL" ] || u="--backend-url $BACKEND_URL"
  fingerprints_equal live env || fail_phase finalize "the fingerprints of the Control Plane and the Backend differ (or could not be read): refusing to retire anything" "run \`$0 status --confirm-production --id $ID\`"
  echo "  both hosts hold fingerprint $FP"
  probes || fail_phase finalize "a probe failed: the old secret is NOT retired" "investigate with \`$0 status\`; \`$0 rollback --id $ID\` is still possible (not finalized)"
  apic finalize --id "$ID"; [ "$APIRC" = 0 ] || fail_phase finalize "the API host refused to finalize" "see the output above; nothing was deleted anywhere"
  cpc finalize --id "$ID"; [ "$CPRC" = 0 ] || fail_phase finalize "the Control Plane refused to finalize (the API host already did: its registry holds the retired fingerprint)" "run \`$0 finalize --confirm-production --id $ID\` again (every step is idempotent)"
  jlog finalized
  do_verify_steps 1 || exit 1
}

do_verify_steps() { # <quiet-summary-wanted>
  local bad=0 u="" all latest
  [ -z "$BACKEND_URL" ] || u="--backend-url $BACKEND_URL"
  banner "verify (read-only)"
  cpc status; [ "$CPRC" = 0 ] || bad=1
  all="$CPOUT"; latest="$(printf '%s\n' "$CPOUT" | grep -E '^LATEST ' | tail -1 || true)"
  apic status; [ "$APIRC" = 0 ] || bad=1
  all="$all
$APIOUT"
  if fingerprints_equal live env; then echo "  both hosts hold the same secret: fingerprint $FP"; else echo "  FINGERPRINT_MISMATCH: the Control Plane and the Backend do NOT hold the same secret (or a fingerprint could not be read)"; bad=1; fi
  cpc probe-new $u; [ "$CPRC" = 0 ] || bad=1
  apic probe-new; [ "$APIRC" = 0 ] || bad=1
  if [ -n "$latest" ] && [ "$(field "$latest" LATEST phase)" = "rolled-back" ]; then echo "  ROLLED_BACK_EXPOSED_SECRET_IN_SERVICE: the last rotation ($(field "$latest" LATEST id)) was rolled back: the EXPOSED secret is in service. Run the rotation again."; bad=1; fi
  if [ -n "$latest" ] && [ "$(field "$latest" LATEST phase)" = "promoted" ]; then echo "  note: rotation $(field "$latest" LATEST id) is promoted but NOT finalized: the old secret is not yet retired in the registry (\`$0 finalize --confirm-production --id $(field "$latest" LATEST id)\`)"; fi
  if [ "$bad" != 0 ]; then
    if printf '%s\n' "$all" | grep -q RETIRED_SECRET_IN_USE; then echo "VERIFY FAILED: RETIRED_SECRET_IN_USE: a retired (exposed) secret is live on at least one host. Run a new rotation: \`$0 run --confirm-production\`."; else echo "VERIFY FAILED (see the lines above). The exposed secret is NOT proven rotated."; fi
    return 1
  fi
  echo "VERIFY OK: same secret on both hosts, neither retired, the Backend accepts the Control Plane's signature. The exposed secret is rotated ONLY because this check passed after the cutover."
}

# the whole rotation for $ID; every step inspects the hosts and does nothing that is already done
do_rotation() {
  local cp_ph base_p base_e resumed="$1" window_start window_end u=""
  [ -z "$BACKEND_URL" ] || u="--backend-url $BACKEND_URL"
  jlog start "id=$ID"
  cp_ph="$(cp_phase "$ID")"
  if [ "$cp_ph" = finalized ]; then echo "id $ID is already FINALIZED: nothing to do. Run \`$0 verify --confirm-production\`."; return 0; fi
  if [ "$cp_ph" = rolled-back ]; then die "id $ID was rolled back; start a new rotation with \`$0 run --confirm-production\`"; fi

  banner "phase 1/10: preflight (both hosts, read-only)"
  preflight_both "$ID" || fail_phase preflight "a preflight check failed on a host (see FAIL lines)" "fix the cause, then \`$0 plan --confirm-production\` and \`$0 run --confirm-production\`"
  base_p="$(field "$CPOUT" OUTBOX pending)"
  QUIET=1 cpc status --id "$ID"
  if printf '%s\n' "$CPOUT" | grep -q 'baseline_pending='; then base_p="$(printf '%s\n' "$CPOUT" | sed -n 's/.*baseline_pending=\([0-9]*\).*/\1/p' | head -1)"; base_e="$(printf '%s\n' "$CPOUT" | sed -n 's/.*baseline_exhausted=\([0-9]*\).*/\1/p' | head -1)"; fi
  [ -n "$base_p" ] || fail_phase preflight "the outbox baseline could not be determined" "$(cmds_hint)"
  base_e="${base_e:-0}"
  jlog preflight-ok "baseline_pending=$base_p"

  banner "phase 2/10: install-api-tool (sha256 verified before and after)"
  install_api_tool || exit 1
  jlog api-tool-installed

  banner "phase 3/10: baseline"
  echo "  outbox baseline: pending=$base_p exhausted=$base_e (taken from the Control Plane; after the cutover pending must be back at or below $base_p and exhausted must be 0)"
  run_preflight_cmd before || fail_phase baseline "the external preflight (--preflight-cmd) failed" "fix the cause, then \`$0 run --confirm-production --id $ID\` (nothing live has changed)"
  QUIET=1 apic status --id "$ID"
  printf '%s\n' "$APIOUT" | grep -E '^(HEALTH|BYSTANDER|BASELINE) ' | sed 's/^/  [API] /' || true

  banner "phase 4/10: prepare (Control Plane): the NEW secret is generated ON the host; the live secret is unchanged"
  cpc prepare --id "$ID" --baseline-pending "$base_p" --baseline-exhausted "$base_e"
  [ "$CPRC" = 0 ] || fail_phase prepare "the Control Plane could not prepare the new secret" "$(cmds_hint)"
  jlog prepared

  banner "phase 5/10: transfer + stage (Control Plane -> this Mac's pipe -> API host); only a fingerprint is printed"
  local cpnext="" apistaged=""
  QUIET=1 cpc fingerprint --which next --id "$ID"; [ "$CPRC" != 0 ] || cpnext="$CPOUT"
  QUIET=1 apic fingerprint --which staged --id "$ID"; [ "$APIRC" != 0 ] || apistaged="$APIOUT"
  if [ -n "$apistaged" ] && { [ -z "$cpnext" ] || [ "$apistaged" = "$cpnext" ]; }; then
    echo "  already staged on the API host (fingerprint $apistaged): no transfer"
  elif [ -n "$apistaged" ]; then
    fail_phase stage "the API host has a DIFFERENT staged secret for this id (staged $apistaged, prepared $cpnext)" "roll back and start a new rotation: \`$0 rollback --confirm-production --id $ID\`"
  elif [ -z "$cpnext" ]; then
    fail_phase stage "the Control Plane no longer has a prepared secret for this id and the API host has none staged" "roll back and start a new rotation: \`$0 rollback --confirm-production --id $ID\`"
  else
    transfer_and_stage || fail_phase stage "the transfer or the staging failed (see the lines above). The pipe carried the secret only between the two ssh connections" "$(cmds_hint)"
  fi
  QUIET=1 cpc fingerprint --which next --id "$ID"; cpnext=""; [ "$CPRC" != 0 ] || cpnext="$CPOUT"
  if [ -z "$cpnext" ]; then QUIET=1 cpc fingerprint --which live; cpnext="$CPOUT"; fi
  QUIET=1 apic fingerprint --which staged --id "$ID"; apistaged="$APIOUT"
  [ "$APIRC" = 0 ] && [[ "$cpnext" =~ ^[0-9a-f]{16}$ ]] && [ "$cpnext" = "$apistaged" ] || fail_phase fingerprint "the fingerprint of the new secret differs between the hosts (CP '$cpnext', API '$apistaged')" "roll back: \`$0 rollback --confirm-production --id $ID\`"
  echo "  fingerprints equal: $cpnext (compared by fingerprint; the secret itself was never printed)"
  jlog staged "fp=$cpnext"

  banner "phase 6/10: apply (API host): complete env copy, ONLY the one line replaced, restart aicc-backend, wait for health with the SAME build"
  window_start="$(date +%s)"
  apic apply --id "$ID"
  if [ "$APIRC" != 0 ]; then
    case "$APIRC" in
      1) ;;
      3) CHANGED="UNKNOWN: the automatic restore of the Backend FAILED (see the CRITICAL lines)" ;;
      *) CHANGED="UNKNOWN: the connection to the API host or the tool itself died (exit $APIRC); the Backend env file may already hold the NEW secret (run \`$0 status --confirm-production --id $ID\`). The Control Plane was not touched" ;;
    esac
    fail_phase apply "the Backend change did not complete; when the tool ran to its end it restored the previous env file and restarted the Backend (unless it says CRITICAL). The Control Plane was not touched" "$(cmds_hint)"
  fi
  CHANGED="the Backend now runs the NEW secret; the Control Plane still runs the OLD one (its deliveries are answered 401 and re-queued until the promote)"
  jlog applied

  banner "phase 7/10: promote (Control Plane): keep the old as .prev, rename the new into place, render wp-config, reload php-fpm, confirm the rendered fingerprint"
  cpc promote --id "$ID" --backend-already-restarted
  if [ "$CPRC" != 0 ]; then
    case "$CPRC" in
      1) CHANGED="the Backend now runs the NEW secret; the Control Plane runs the OLD one again (restored)" ;;
      3) CHANGED="UNKNOWN: the automatic restore of the Control Plane FAILED (see the CRITICAL lines); the Backend runs the NEW secret" ;;
      *) CHANGED="UNKNOWN: the connection to the Control Plane or the tool itself died (exit $CPRC); the Control Plane may already hold the NEW secret (run \`$0 status --confirm-production --id $ID\`); the Backend runs the NEW secret" ;;
    esac
    fail_phase promote "the Control Plane promote failed (it restored the old secret unless it says CRITICAL). The Backend already holds the NEW secret: until you resume or roll back, every delivery is answered 401 and re-queued (nothing is lost)" "$(cmds_hint)"
  fi
  window_end="$(date +%s)"
  CHANGED="both hosts now run the NEW secret (not yet verified, not yet finalized)"
  echo "  measured mismatch window (Backend restart began -> Control Plane promoted): about $((window_end - window_start)) s (includes the Backend health wait)"
  jlog promoted "window_s=$((window_end - window_start))"

  probes || fail_phase probes "a probe failed (see FAIL above): the cutover happened but is NOT verified" "investigate with \`$0 status --confirm-production --id $ID\`; \`$0 rollback --confirm-production --id $ID\` puts the OLD secret back on both hosts"
  jlog probes-ok

  banner "phase 9/10: drain: the outbox must be back at the baseline with nothing exhausted"
  if [ "$WAIT_DRAIN" = 1 ]; then
    local drc=0; drain_wait "$base_p" || drc=$?
    case "$drc" in
      0) echo "  the outbox is back at (or below) the baseline and nothing is exhausted" ;;
      2) fail_phase drain "outbox events are EXHAUSTED after the rotation" "look at the events with \`sudo aicc-wp aicc-mail health\` on the Control Plane; do NOT finalize until they are understood; $(cmds_hint)" ;;
      3) fail_phase drain "the outbox did not drain within ${DRAIN_TIMEOUT}s (events are NOT lost: the outbox is durable and keeps retrying with backoff up to 1 h)" "wait and \`$0 resume --confirm-production --id $ID\` (it re-checks the drain), or $(cmds_hint)" ;;
      *) fail_phase drain "the outbox could not be read" "$(cmds_hint)" ;;
    esac
  else echo "  --no-wait-drain: the drain was NOT checked. Before you finalize, confirm with \`$0 status\` and \`sudo aicc-wp aicc-mail health\` that pending is at the baseline ($base_p) and exhausted is 0."; fi
  jlog drain-ok

  banner "phase 10/10: bystander + Backend build unchanged"
  observe_checks || fail_phase observe "the bystander container or the Backend build/mode differs from the baseline" "read the lines above; the rotation itself is complete and verified; decide whether this is yours: $(cmds_hint)"
  run_preflight_cmd after || fail_phase observe "the external preflight (--preflight-cmd) failed AFTER the rotation" "read its output; $(cmds_hint)"
  jlog ready
  echo
  echo "READY TO FINALIZE: id $ID. Both hosts hold the NEW secret (fingerprint $cpnext); the probes passed; the outbox drained."
  echo "NOT ATOMIC: for about $((window_end - window_start)) s the two hosts disagreed; deliveries in that window were answered 401 and re-queued (events survive: durable outbox, event_id primary key, strictly increasing sequence)."
  echo "The old secret is NOT yet retired. Look, then run: $0 finalize --confirm-production --id $ID"
  [ "$FINALIZE" != 1 ] || do_finalize_steps
}

# ---- the subcommands -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
cmd_plan() {
  local rc=0 w="CLOSED" base_p
  banner "PLAN (read-only: nothing is generated, installed or changed)"
  local_gates
  verify_identity_cp; verify_identity_api
  in_window && w="OPEN" || true
  echo "Deploy window right now: $w (UTC $(now_hhmm); windows are minutes 18-26 and 48-56, never UTC hours 02/03). A mutating command refuses outside a window."
  preflight_both "" || rc=1
  base_p="$(field "$CPOUT" OUTBOX pending)"
  local have want
  want="$(shasum -a 256 "$API_TOOL_SRC" | cut -d' ' -f1)"; have="$(rapi "sha256sum $API_TOOL 2>/dev/null | cut -d' ' -f1" </dev/null 2>/dev/null)" || have=""
  banner "the API host tool"
  if [ "$have" = "$want" ]; then echo "  installed and identical to this checkout (sha256 ${want:0:16}...)"; elif [ -n "$have" ]; then echo "  installed but DIFFERENT: run would replace it (verified before and after)"; else echo "  not installed: run would install it root:root 0755 (verified before and after)"; fi
  banner "what run would do (nothing below has happened)"
  cat <<EOF
  1  preflight both hosts (what you just saw) ........ read-only
  2  install-api-tool ................................ API host: /usr/local/sbin/$(basename "$API_TOOL") (root 0755, sha256 checked twice)
  3  baseline ....................................... outbox pending=${base_p:-?} / exhausted, Backend build + entitlement_mode, bystander $BYSTANDER StartedAt${PREFLIGHT_CMD:+, then $PREFLIGHT_CMD}
  4  prepare (Control Plane) ........................ NEW 64-hex secret generated ON the host as <live>.next-<ID> (root 0600); live secret unchanged
  5  transfer + stage ............................... ssh CP emit-next | ssh API stage: the secret exists on this Mac only inside the pipe; API: /etc/aicc/webhook-rotation/<ID>/next.secret (0600)
  6  apply (API host) ............................... complete copy /etc/aicc/backend.env.pre-webhook-rotation-<ID>; ONLY the ENTITLEMENT_WEBHOOK_SECRET line replaced; systemctl restart aicc-backend
                                                       (a few seconds; Plugin/merchant licences untouched: they live in the Backend database); automatic restore on ANY failure
  7  promote (Control Plane) ........................ old kept as .prev-<ID>; new renamed live; aicc-render-wp-config; reload php8.3-fpm; rendered fingerprint checked; automatic restore on ANY failure
                                                       FROM STEP 6 TO 7 THE HOSTS DISAGREE (target < 60 s): deliveries get 401 and wait in the outbox (NOT ATOMIC, NOT LOSSY)
  8  probes ......................................... CP (PHP, running constant) accepted 400; old secret rejected 401 from the CP host and locally on the API host
  9  drain .......................................... outbox exhausted == 0 and pending <= baseline within ${DRAIN_TIMEOUT}s
  10 observe ........................................ bystander StartedAt/state unchanged, Backend build + mode unchanged  ->  READY TO FINALIZE
  then, separately:  finalize --id <ID>  records the OLD fingerprint in /etc/aicc/webhook-secret-retired.fp on BOTH hosts and renames .prev -> .retired (nothing is deleted)
  and:  verify  (any time, also after any backup restore) fails RETIRED_SECRET_IN_USE if a retired secret is live anywhere
EOF
  if [ "$rc" != 0 ]; then echo; echo "PLAN: at least one preflight check FAILED: run would refuse. Nothing was changed."; exit 1; fi
  echo; echo "PLAN OK: every preflight passed. Nothing was changed. Next: $0 run --confirm-production   (inside a deploy window)"
}

cmd_run() {
  gates 1 "run"
  local latest lid lph lat
  if [ -n "$ID" ]; then
    local ph; ph="$(cp_phase "$ID")"
    [ -z "$ph" ] || echo "id $ID exists on the Control Plane (phase $ph): continuing it (same as resume)"
    do_rotation 1; return
  fi
  QUIET=1 cpc status
  latest="$(printf '%s\n' "$CPOUT" | grep -E '^LATEST ' | tail -1 || true)"
  if [ -n "$latest" ] && [ "$FORCE_NEW" != 1 ]; then
    lid="$(field "$latest" LATEST id)"; lph="$(field "$latest" LATEST phase)"; lat="$(field "$latest" LATEST at)"
    if { [ "$lph" = promoted ] || [ "$lph" = finalized ]; } && [ "$(age_seconds "$lat")" -lt 86400 ]; then
      echo "NO-OP: rotation $lid reached phase '$lph' at $lat (less than 24 h ago). Nothing was changed."
      echo "  Run \`$0 verify --confirm-production\`$([ "$lph" = promoted ] && echo "; it is not finalized yet: \`$0 finalize --confirm-production --id $lid\`")."
      echo "  To rotate again on purpose: --force-new-rotation."
      return 0
    fi
  fi
  local ufin; ufin="$(unfinished_ids)"
  if [ -n "$ufin" ]; then die "an earlier rotation is UNFINISHED: $(printf '%s' "$ufin" | tr '\n' ' '). Use \`$0 resume --confirm-production --id <ID>\` or \`rollback\`. Nothing was changed."; fi
  ID="$(date -u +%Y%m%dT%H%M%SZ)"
  echo "new rotation id: $ID"
  do_rotation 0
}

cmd_resume() {
  gates 1 "resume"
  if [ -z "$ID" ]; then
    local u; u="$(unfinished_ids)"
    [ -n "$u" ] || { echo "nothing to resume: no unfinished rotation on either host. (A failure before the first host step leaves nothing behind: run \`$0 run --confirm-production\`.)"; return 0; }
    [ "$(printf '%s\n' "$u" | wc -l | tr -d ' ')" = 1 ] || die "more than one unfinished rotation ($(printf '%s' "$u" | tr '\n' ' ')): name one with --id"
    ID="$u"
  fi
  echo "resuming rotation $ID"
  do_rotation 1
}

cmd_status() {
  local_gates; verify_identity_cp; verify_identity_api
  banner "Control Plane"; cpc status ${ID:+--id "$ID"}; local a="$CPRC"
  banner "API host"; apic status ${ID:+--id "$ID"}; local b="$APIRC"
  if [ "$a" != 0 ] || [ "$b" != 0 ]; then echo; echo "STATUS: problems reported (exit codes CP $a, API $b)"; printf '%s\n%s\n' "$CPOUT" "$APIOUT" | grep -q RETIRED_SECRET_IN_USE && echo "RETIRED_SECRET_IN_USE: see above"; exit 1; fi
  QUIET=1 cpc outbox; echo; echo "STATUS OK. $(printf '%s' "$CPOUT" | tail -1)"
}

cmd_rollback() {
  gates 1 "rollback"
  if [ -z "$ID" ]; then
    local u; u="$(unfinished_ids)"
    [ -n "$u" ] || die "no unfinished rotation to roll back (a FINALIZED one needs --id and --i-reinstate-a-retired-secret). Nothing was changed."
    [ "$(printf '%s\n' "$u" | wc -l | tr -d ' ')" = 1 ] || die "more than one unfinished rotation ($(printf '%s' "$u" | tr '\n' ' ')): name one with --id"
    ID="$u"
  fi
  local ph; ph="$(cp_phase "$ID")"
  [ -n "$ph" ] || die "the Control Plane has no rotation with id $ID"
  if [ "$ph" = finalized ] && [ "$REINSTATE" != 1 ]; then die "rotation $ID is FINALIZED: its old secret is RETIRED (it was exposed). Rolling back would put an exposed secret back in service. If you really must, a manual decision: --i-reinstate-a-retired-secret (verify then keeps failing RETIRED_SECRET_IN_USE until a new rotation). Nothing was changed."; fi
  local re=""; [ "$REINSTATE" != 1 ] || re="--i-reinstate-a-retired-secret"
  banner "rollback $ID: Control Plane first, then the Backend"
  cpc rollback --id "$ID" $re
  [ "$CPRC" = 0 ] || fail_phase rollback "the Control Plane rollback failed" "run \`$0 status --confirm-production --id $ID\`; the tools never delete a backup, restore by hand from the .prev file"
  apic rollback --id "$ID" $re
  [ "$APIRC" = 0 ] || fail_phase rollback "the API host rollback failed (the Control Plane is already back on the OLD secret)" "run \`$0 rollback --confirm-production --id $ID\` again (idempotent) or restore /etc/aicc/backend.env from the .pre-webhook-rotation-$ID copy and restart aicc-backend"
  jlog rolled-back
  local u=""; [ -z "$BACKEND_URL" ] || u="--backend-url $BACKEND_URL"
  cpc probe-new $u; apic probe-new
  if [ "$WAIT_DRAIN" = 1 ]; then local drc=0; QUIET=1 cpc status --id "$ID"; local bp; bp="$(printf '%s\n' "$CPOUT" | sed -n 's/.*baseline_pending=\([0-9]*\).*/\1/p' | head -1)"; drain_wait "${bp:-0}" || drc=$?; [ "$drc" = 0 ] || echo "  (the outbox has not drained yet: events are not lost; check \`$0 status\` later)"; fi
  echo
  echo "ROLLED BACK. THE OLD SECRET IS BACK IN SERVICE ON BOTH HOSTS, AND THAT SECRET IS THE EXPOSED ONE. THE ROTATION IS NOT DONE: RE-RUN \`$0 run --confirm-production\` AS SOON AS THE CAUSE IS FIXED."
}

cmd_finalize() {
  [ -n "$ID" ] || die "finalize needs --id ID (run prints it)"
  gates 1 "finalize"
  do_finalize_steps
}

cmd_verify() {
  local_gates; verify_identity_cp; verify_identity_api
  do_verify_steps 0 || exit 1
}

cmd_install() {
  gates 1 "install-api-tool"
  install_api_tool
}

case "$SUB" in
  plan) cmd_plan ;;
  run) cmd_run ;;
  resume) cmd_resume ;;
  status) cmd_status ;;
  rollback) cmd_rollback ;;
  finalize) cmd_finalize ;;
  verify) cmd_verify ;;
  install-api-tool) cmd_install ;;
esac
