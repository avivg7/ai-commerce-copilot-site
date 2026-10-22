#!/usr/bin/env bash
# Install / uninstall the AICC off-host backup pull as a user LaunchAgent on the owner's Mac.
#
#   install-launchd.sh --stage-ip <IPV4>                       DRY-RUN (the default): print everything that would be done, change nothing
#   install-launchd.sh --stage-ip <IPV4> --apply               install: copy the scripts, write the plist, launchctl bootstrap gui/<uid>
#   install-launchd.sh --uninstall [--apply]                   remove the agent and the script copies (backups and logs are NEVER deleted)
# Options: --stage-host stage.copilt.org  --key ~/.ssh/aicc_cp_stage_offhost  --dest ~/aicc-offhost-backups-stage
# PRODUCTION (separate agent, separate directories, separate key; the staging agent is left alone and should be uninstalled by the operator once production is live):
#   install-launchd.sh --env production --stage-ip <IPV4> --expect-id <32 hex> [--apply]
#     label com.aicc.offhost-pull.production; host www.copilt.org; key ~/.ssh/aicc_cp_prod_offhost; dest ~/aicc-offhost-backups-production; pinned known-hosts ~/.ssh/known_hosts_aicc_prod_cp
#
# Rules: refuses to run as root. Touches only ~/Library/LaunchAgents/com.aicc.offhost-pull.plist, ~/Library/Application Support/aicc-offhost-pull/ (0700),
# ~/Library/Logs/aicc-offhost-pull/ (0700). Never creates keys. The key must already exist and must be the RESTRICTED pull key (see README-backup.md).
# The stage host/IP are never defaulted; the same refusals as pull-offhost.sh apply (production IPs/names/key).
set -euo pipefail

LABEL="com.aicc.offhost-pull"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BKP="$(cd "$HERE/.." && pwd)"
TEMPLATE="$HERE/com.aicc.offhost-pull.plist.template"
. "$BKP/../provision/lib/ip-guard.sh"

apply=0 uninstall=0 stage_ip="" stage_host="" key="" dest="" envn="stage" expect_id="" known_hosts="" encrypt_to=""
die() { echo "install-launchd: $*" >&2; exit 1; }
usage() { sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --dry-run) apply=0 ;;
    --uninstall) uninstall=1 ;;
    --stage-ip) [ $# -ge 2 ] || die "--stage-ip needs a value"; stage_ip="$2"; shift ;;
    --stage-host) [ $# -ge 2 ] || die "--stage-host needs a value"; stage_host="$2"; shift ;;
    --key) [ $# -ge 2 ] || die "--key needs a path"; key="$2"; shift ;;
    --dest) [ $# -ge 2 ] || die "--dest needs a path"; dest="$2"; shift ;;
    --env) [ $# -ge 2 ] || die "--env needs a value"; envn="$2"; shift ;;
    --expect-id) [ $# -ge 2 ] || die "--expect-id needs a value"; expect_id="$2"; shift ;;
    --known-hosts) [ $# -ge 2 ] || die "--known-hosts needs a path"; known_hosts="$2"; shift ;;
    --encrypt-to) [ $# -ge 2 ] || die "--encrypt-to needs a certificate path"; encrypt_to="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

case "$envn" in stage|production) ;; *) die "--env must be stage or production" ;; esac
if [ "$envn" = production ]; then
  LABEL="com.aicc.offhost-pull.production"; SUFFIX="-production"
  [ -n "$stage_host" ] || stage_host="www.copilt.org"; [ -n "$key" ] || key="$HOME/.ssh/aicc_cp_prod_offhost"
  [ -n "$dest" ] || dest="$HOME/aicc-offhost-backups-production"; [ -n "$known_hosts" ] || known_hosts="$HOME/.ssh/known_hosts_aicc_prod_cp"
else
  SUFFIX=""
  [ -n "$stage_host" ] || stage_host="stage.copilt.org"; [ -n "$key" ] || key="$HOME/.ssh/aicc_cp_stage_offhost"; [ -n "$dest" ] || dest="$HOME/aicc-offhost-backups-stage"
fi
[ "$(id -u)" -ne 0 ] || die "refusing to run as root: this is a per-user LaunchAgent (run it as the logged-in user, without sudo)"
[ -n "${HOME:-}" ] && [ -d "$HOME" ] || die "HOME is not set to a directory"
case "$HOME" in /*) ;; *) die "HOME must be an absolute path" ;; esac
case "$HOME" in *[!A-Za-z0-9._/\ -]*) die "HOME contains characters this installer will not put into a plist; install by hand" ;; esac

SUPPORT="$HOME/Library/Application Support/aicc-offhost-pull$SUFFIX"
LOGDIR="$HOME/Library/Logs/aicc-offhost-pull$SUFFIX"
AGENTS="$HOME/Library/LaunchAgents"
PLIST="$AGENTS/$LABEL.plist"
DOMAIN="gui/$(id -u)"
say() { printf '%s\n' "$*"; }
bootout_quiet() { launchctl bootout "$1" >/dev/null 2>&1 || true; }
act() { local desc="$1"; shift; if [ "$apply" -eq 1 ]; then say "DO    $desc"; "$@"; else say "WOULD $desc"; fi; }

if [ "$apply" -eq 1 ]; then say "== $LABEL: APPLY =="; else say "== $LABEL: DRY-RUN (nothing is changed; add --apply to do it) =="; fi
say "launchd domain $DOMAIN; support dir $SUPPORT (0700); logs $LOGDIR (0700); plist $PLIST"

if [ "$uninstall" -eq 1 ]; then
  case "${SUPPORT##*/}" in aicc-offhost-pull|aicc-offhost-pull-production) ;; *) die "internal: unexpected support dir" ;; esac
  act "launchctl bootout $DOMAIN/$LABEL (ignore 'not loaded')" bootout_quiet "$DOMAIN/$LABEL"
  act "remove $PLIST" rm -f "$PLIST"
  act "remove $SUPPORT (script copies)" rm -rf "$SUPPORT"
  say "left in place on purpose: the backups ($dest), the logs ($LOGDIR) and the SSH key."
  [ "$apply" -eq 1 ] || say "(dry-run) re-run with --uninstall --apply"
  exit 0
fi

# ---- the same refusals as pull-offhost.sh (nothing is installed that the pull script would refuse to run) ----
[ -n "$stage_ip" ] || die "--stage-ip is required (the host is never guessed)"
[[ "$stage_ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "REFUSED: --stage-ip must be a literal IPv4 address"
for d in 139.59.157.231 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153; do [ "$stage_ip" = "$d" ] && die "REFUSED: $stage_ip is a production/public address"; done
aicc_ip_guard "$stage_ip" "--stage-ip " || exit 3
if [ "$envn" = production ]; then
  [ "$stage_host" = "www.copilt.org" ] || die "REFUSED: --env production uses the host name www.copilt.org"
  [[ "$expect_id" =~ ^[0-9a-f]{32}$ ]] || die "REFUSED: --env production needs --expect-id <32 hex> (the id in the host identity)"
  case "$(basename "$key")" in aicc_cp_prod_offhost*) ;; *) die "REFUSED: the production pull key must be named aicc_cp_prod_offhost*" ;; esac
  [ -s "$known_hosts" ] || die "REFUSED: the pinned known-hosts file $known_hosts is missing (no trust on first use in production)"
  ssh-keygen -F "$stage_ip" -f "$known_hosts" >/dev/null 2>&1 || die "REFUSED: the pinned known-hosts file has no entry for $stage_ip"
else
  [[ "$stage_host" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || die "REFUSED: --stage-host must be a stage*.copilt.org name"
  case "$(basename "$key")" in aicc_cp_prod*) die "REFUSED: the production key is not used for staging" ;; esac
fi
case "$key" in *aicc_digitalocean_prod*) die "REFUSED: never use the production key" ;; esac
if [ "$envn" = production ] && [ -z "$encrypt_to" ]; then die "REFUSED: --env production requires --encrypt-to <recipient certificate.pem> (the Mac must hold only ciphertext; the private key stays off this Mac)"; fi
if [ -n "$encrypt_to" ]; then
  [[ "$encrypt_to" == /* ]] || die "--encrypt-to must be an absolute path"
  [ -f "$encrypt_to" ] && grep -q 'BEGIN CERTIFICATE' "$encrypt_to" || die "REFUSED: $encrypt_to is not a PEM certificate"
  if grep -q 'PRIVATE KEY' "$encrypt_to"; then die "REFUSED: $encrypt_to contains a PRIVATE KEY; give the agent the certificate only"; fi
fi
case "$key$dest$known_hosts$encrypt_to" in *[!A-Za-z0-9._/\ -]*) die "key/dest contain characters this installer will not put into a plist" ;; esac
[[ "$dest" == /* && "$key" == /* ]] || die "--key and --dest must be absolute paths"
[ -f "$key" ] || die "key file not found: $key (create the restricted pull key first; see README-backup.md)"
grep -q "PRIVATE KEY" "$key" || die "$key is not a private key file"
[ -f "$TEMPLATE" ] && [ -f "$BKP/pull-offhost.sh" ] && [ -f "$HERE/offhost-pull-runner.sh" ] || die "incomplete source tree"
say "stage host $stage_host at $stage_ip; key $key; destination $dest"

DST_PULL="$SUPPORT/pull-offhost.sh"; DST_RUNNER="$SUPPORT/offhost-pull-runner.sh"
render_plist() {
  local t; t="$(cat "$TEMPLATE")"
  t="${t//@RUNNER@/$DST_RUNNER}"; t="${t//@PULL@/$DST_PULL}"; t="${t//@STAGE_IP@/$stage_ip}"; t="${t//@STAGE_HOST@/$stage_host}"
  t="${t//@KEY@/$key}"; t="${t//@DEST@/$dest}"; t="${t//@LOGDIR@/$LOGDIR}"; t="${t//@LABEL@/$LABEL}"
  if [ "$envn" = production ]; then t="${t//@EXTRA_ARGS@/<string>--env</string><string>production</string><string>--expect-id</string><string>$expect_id</string><string>--known-hosts</string><string>$known_hosts</string>}"
  else t="${t//@EXTRA_ARGS@/}"; fi
  if [ -n "$encrypt_to" ]; then t="${t//@ENC_ARGS@/<string>--encrypt-to</string><string>$encrypt_to</string>}"; else t="${t//@ENC_ARGS@/}"; fi
  printf '%s\n' "$t"
}
say "-- rendered plist (contains no secret) --"; render_plist; say "-- end plist --"

act "create $SUPPORT (0700)" install -d -m 700 "$SUPPORT"
act "create $LOGDIR (0700)" install -d -m 700 "$LOGDIR"
act "create $AGENTS (0755)" install -d -m 755 "$AGENTS"
# pull-offhost.sh sources ../provision/lib/ip-guard.sh: keep that relative layout inside the support dir
act "copy ip-guard helpers" install -d -m 700 "$SUPPORT/provision/lib" "$SUPPORT/backup"
act "copy ip-guard.sh" install -m 600 "$BKP/../provision/lib/ip-guard.sh" "$SUPPORT/provision/lib/ip-guard.sh"
act "copy ip-guard.py" install -m 600 "$BKP/../provision/lib/ip-guard.py" "$SUPPORT/provision/lib/ip-guard.py"
DST_PULL="$SUPPORT/backup/pull-offhost.sh"
act "copy pull-offhost.sh" install -m 700 "$BKP/pull-offhost.sh" "$DST_PULL"
DST_RUNNER="$SUPPORT/backup/offhost-pull-runner.sh"
act "copy offhost-pull-runner.sh" install -m 700 "$HERE/offhost-pull-runner.sh" "$DST_RUNNER"
if [ "$apply" -eq 1 ]; then
  tmp="$(mktemp "$AGENTS/.$LABEL.XXXXXX")"; trap 'rm -f "$tmp"' EXIT
  render_plist > "$tmp"
  if command -v plutil >/dev/null 2>&1; then plutil -lint "$tmp" >/dev/null || die "rendered plist is not valid"; fi
  chmod 644 "$tmp"; say "DO    write $PLIST (0644, after plutil -lint)"; mv -f "$tmp" "$PLIST"; trap - EXIT
  [ "$(uname -s)" = "Darwin" ] || die "launchctl bootstrap needs macOS"
else say "WOULD write $PLIST (0644, after plutil -lint)"; fi
act "launchctl bootout $DOMAIN/$LABEL (idempotent re-install)" bootout_quiet "$DOMAIN/$LABEL"
act "launchctl bootstrap $DOMAIN $PLIST" launchctl bootstrap "$DOMAIN" "$PLIST"
act "launchctl enable $DOMAIN/$LABEL" launchctl enable "$DOMAIN/$LABEL"
act "launchctl kickstart $DOMAIN/$LABEL (first run now)" launchctl kickstart "$DOMAIN/$LABEL"
say "Logs: $LOGDIR/pull.out.log   Pull log: $dest/pull.log   Last verified pull: $dest/.last-ok"
say "Reminder: a Mac that sleeps does not pull (this is NOT 24/7). The host alerts (AICC Ops offhost_stale) when no verified copy was acknowledged for 36 h."
[ "$apply" -eq 1 ] || say "(dry-run) nothing was changed."
