#!/usr/bin/env bash
# Install / uninstall the AICC Sentinel user LaunchAgent on the owner's Mac.
#
#   install-launchd.sh                      DRY-RUN (the default): print everything that would be done, change nothing, run no launchctl
#   install-launchd.sh --apply              install: copy files, write the plist, launchctl bootstrap gui/<uid>
#   install-launchd.sh --uninstall          DRY-RUN of the removal
#   install-launchd.sh --uninstall --apply  remove the agent, the script copy, the targets copy, the state and the heartbeat
# Options: --python /abs/python3.12   --targets FILE (default: targets.stage.toml next to sentinel.py)
#
# Rules: refuses to run as root. Touches only ~/Library/LaunchAgents/com.aicc.sentinel.plist, ~/Library/Application Support/aicc-sentinel/ (0700),
# ~/Library/Logs/aicc-sentinel/ (0700). It NEVER creates or reads the secrets file: sentinel-secrets.sh does that, interactively, without echo.
set -euo pipefail

LABEL="com.aicc.sentinel"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SENTINEL_DIR="$(cd "$HERE/.." && pwd)"
TEMPLATE="$HERE/$LABEL.plist.template"

apply=0 uninstall=0 python="" targets="$SENTINEL_DIR/targets.stage.toml"

die() { echo "install-launchd: $*" >&2; exit 1; }
usage() { sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --dry-run) apply=0 ;;
    --uninstall) uninstall=1 ;;
    --python) [ $# -ge 2 ] || die "--python needs a path"; python="$2"; shift ;;
    --targets) [ $# -ge 2 ] || die "--targets needs a file"; targets="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

[ "$(id -u)" -ne 0 ] || die "refusing to run as root: this is a per-user LaunchAgent (run it as the logged-in user, without sudo)"
[ -n "${HOME:-}" ] && [ -d "$HOME" ] || die "HOME is not set to a directory"
case "$HOME" in
  /*) ;;
  *) die "HOME must be an absolute path" ;;
esac
case "$HOME" in
  *[!A-Za-z0-9._/\ -]*) die "HOME contains characters this installer will not put into a plist; install by hand" ;;
esac

SUPPORT="$HOME/Library/Application Support/aicc-sentinel"
LOGDIR="$HOME/Library/Logs/aicc-sentinel"
AGENTS="$HOME/Library/LaunchAgents"
PLIST="$AGENTS/$LABEL.plist"
SECRETS="$HOME/.config/aicc-sentinel/secrets.env"
UID_NUM="$(id -u)"
DOMAIN="gui/$UID_NUM"

say() { printf '%s\n' "$*"; }
bootout_quiet() { launchctl bootout "$1" >/dev/null 2>&1 || true; }
# act DESCRIPTION CMD...   dry-run: print only. apply: print and run.
act() {
  local desc="$1"; shift
  if [ "$apply" -eq 1 ]; then say "DO    $desc"; "$@"; else say "WOULD $desc"; fi
}

if [ "$apply" -eq 1 ]; then say "== $LABEL: APPLY =="; else say "== $LABEL: DRY-RUN (nothing is changed; add --apply to do it) =="; fi
say "user $(id -un) (uid $UID_NUM), launchd domain $DOMAIN"
say "support dir : $SUPPORT   (0700)"
say "log dir     : $LOGDIR   (0700)"
say "plist       : $PLIST"
say "secrets file: $SECRETS   (never created by this script)"

# ---------------------------------------------------------------------------------------------------------- uninstall
if [ "$uninstall" -eq 1 ]; then
  [ "${SUPPORT##*/}" = "aicc-sentinel" ] || die "internal: unexpected support dir"
  act "launchctl bootout $DOMAIN/$LABEL (ignore 'not loaded')" bootout_quiet "$DOMAIN/$LABEL"
  act "remove $PLIST" rm -f "$PLIST"
  act "remove $SUPPORT (script copy, targets copy, state, heartbeat)" rm -rf "$SUPPORT"
  say "left in place on purpose: $LOGDIR (logs) and $SECRETS (Telegram secrets)."
  say "  remove the secrets with:  bash \"$HERE/sentinel-secrets.sh\" --remove"
  say "  remove the logs with:     rm -rf \"$LOGDIR\""
  [ "$apply" -eq 1 ] || say "(dry-run) re-run with:  bash \"$HERE/install-launchd.sh\" --uninstall --apply"
  exit 0
fi

# ---------------------------------------------------------------------------------------------------------- python
pick_python() {
  local c
  if [ -n "$python" ]; then echo "$python"; return 0; fi
  for c in python3.13 python3.12 python3.11; do
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return 0; fi
  done
  for c in /opt/homebrew/bin/python3.12 /usr/local/bin/python3.12 /opt/homebrew/bin/python3.13 /opt/homebrew/bin/python3.11; do
    if [ -x "$c" ]; then echo "$c"; return 0; fi
  done
  return 1
}
PY_OK=0
if py="$(pick_python)"; then
  case "$py" in
    /*) ;;
    *) die "python path must be absolute (launchd has no useful PATH): $py" ;;
  esac
  case "$py" in
    *[!A-Za-z0-9._/@+\ -]*) die "python path contains unusual characters: $py" ;;
  esac
  if [ -x "$py" ] && PYTHONDONTWRITEBYTECODE=1 "$py" -c 'import sys, tomllib; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
    PY_OK=1
  fi
else
  py="/ABSOLUTE/PATH/TO/python3.12"
fi
if [ "$PY_OK" -eq 1 ]; then
  say "python      : $py (>= 3.11 with tomllib: ok)"
else
  say "python      : $py  ** NOT USABLE ** Python 3.11+ is required (macOS /usr/bin/python3 is too old). Install one (e.g. brew install python@3.12) or pass --python /abs/path."
  [ "$apply" -eq 0 ] || die "no usable Python 3.11+"
fi

# ---------------------------------------------------------------------------------------------------------- inputs
[ -f "$SENTINEL_DIR/sentinel.py" ] || die "sentinel.py not found next to this script"
[ -f "$targets" ] || die "targets file not found: $targets"
[ -f "$TEMPLATE" ] || die "plist template not found: $TEMPLATE"
say "targets     : $targets"
if [ "$PY_OK" -eq 1 ]; then
  say "-- sentinel --plan (opens no socket) --"
  PYTHONDONTWRITEBYTECODE=1 "$py" "$SENTINEL_DIR/sentinel.py" --config "$targets" --plan || die "the targets file does not validate"
  say "--"
fi

DST_SCRIPT="$SUPPORT/sentinel.py"
DST_TARGETS="$SUPPORT/targets.toml"
STATE="$SUPPORT/state.json"
HEARTBEAT="$SUPPORT/last-run.json"

render_plist() {
  local t; t="$(cat "$TEMPLATE")"
  t="${t//@PYTHON@/$py}"
  t="${t//@SCRIPT@/$DST_SCRIPT}"
  t="${t//@TARGETS@/$DST_TARGETS}"
  t="${t//@STATE@/$STATE}"
  t="${t//@HEARTBEAT@/$HEARTBEAT}"
  t="${t//@LOGDIR@/$LOGDIR}"
  printf '%s\n' "$t"
}

say "-- rendered plist (contains no secret) --"
render_plist
say "-- end plist --"

# ---------------------------------------------------------------------------------------------------------- do it
act "create $SUPPORT (0700)" install -d -m 700 "$SUPPORT"
act "create $LOGDIR (0700)" install -d -m 700 "$LOGDIR"
act "create $AGENTS (0755)" install -d -m 755 "$AGENTS"
act "copy sentinel.py -> $DST_SCRIPT (0600)" install -m 600 "$SENTINEL_DIR/sentinel.py" "$DST_SCRIPT"
act "copy targets -> $DST_TARGETS (0600)" install -m 600 "$targets" "$DST_TARGETS"
if [ "$apply" -eq 1 ]; then
  tmp="$(mktemp "$AGENTS/.$LABEL.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  render_plist > "$tmp"
  if command -v plutil >/dev/null 2>&1; then plutil -lint "$tmp" >/dev/null || die "rendered plist is not valid"; fi
  chmod 644 "$tmp"
  say "DO    write $PLIST (0644, after plutil -lint)"
  mv -f "$tmp" "$PLIST"
  trap - EXIT
  [ "$(uname -s)" = "Darwin" ] || die "launchctl bootstrap needs macOS"
else
  say "WOULD write $PLIST (0644, after plutil -lint)"
fi
act "launchctl bootout $DOMAIN/$LABEL (ignore 'not loaded'; makes a re-install idempotent)" bootout_quiet "$DOMAIN/$LABEL"
act "launchctl bootstrap $DOMAIN $PLIST" launchctl bootstrap "$DOMAIN" "$PLIST"
act "launchctl enable $DOMAIN/$LABEL" launchctl enable "$DOMAIN/$LABEL"
act "launchctl kickstart $DOMAIN/$LABEL (first run now)" launchctl kickstart "$DOMAIN/$LABEL"

# ---------------------------------------------------------------------------------------------------------- follow-up
if [ -e "$SECRETS" ]; then
  say "secrets file exists (not read here). Check it with: bash \"$HERE/sentinel-secrets.sh\" --check"
else
  say "NO secrets file: Telegram is DISABLED. Events go to the log and to macOS notifications only."
  say "  Create it (silent prompts, nothing echoed, nothing on the command line):  bash \"$HERE/sentinel-secrets.sh\""
fi
say "Check it is alive:   $py \"$SENTINEL_DIR/sentinel.py\" --status"
say "Logs:                $LOGDIR/sentinel.out.log"
say "Reminder: a Mac that sleeps is not watching. See infra/sentinel/README.md (what this does and does not cover)."
[ "$apply" -eq 1 ] || say "(dry-run) nothing was changed. To install:  bash \"$HERE/install-launchd.sh\" --apply"
