#!/usr/bin/env bash
# launchd wrapper around pull-offhost.sh: runs the pull, keeps a consecutive-failure counter and, when the Mac has had no verified pull for a long time,
# shows ONE macOS notification (fixed text: no host, no path, no secret) at most every 12 hours. The server-side alert (AICC Ops offhost_stale) is the
# primary signal; this only helps when the Mac is awake but cannot reach the host.
#   offhost-pull-runner.sh --pull-script PATH --stage-ip IP --stage-host H --key FILE --dest DIR [--notify-after-h 26] [--env production --expect-id ID --known-hosts FILE]
set -euo pipefail
PULL=""; IP=""; HOST=""; KEY=""; DEST=""; AFTER_H=26; ENVN="stage"; EXPECT_ID=""; KNOWN_HOSTS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pull-script) PULL="${2:-}"; shift 2 ;; --stage-ip) IP="${2:-}"; shift 2 ;; --stage-host) HOST="${2:-}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;; --dest) DEST="${2:-}"; shift 2 ;; --notify-after-h) AFTER_H="${2:-26}"; shift 2 ;;
    --env) ENVN="${2:-}"; shift 2 ;; --expect-id) EXPECT_ID="${2:-}"; shift 2 ;; --known-hosts) KNOWN_HOSTS="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -f "$PULL" ] && [ -n "$IP" ] && [ -n "$HOST" ] && [ -n "$KEY" ] && [ -n "$DEST" ] || { echo "missing arguments" >&2; exit 2; }
mkdir -p "$DEST"; chmod 700 "$DEST"
FAILS="$DEST/.consecutive-failures"; NOTIFIED="$DEST/.last-notified"; LASTOK="$DEST/.last-ok"
now="$(date -u +%s)"
EXTRA=(); [ "$ENVN" = production ] && EXTRA=(--env production --expect-id "$EXPECT_ID" --known-hosts "$KNOWN_HOSTS")
if bash "$PULL" --stage-ip "$IP" --stage-host "$HOST" --key "$KEY" --dest "$DEST" ${EXTRA[@]+"${EXTRA[@]}"}; then
  rm -f "$FAILS"; exit 0
fi
n=$(( $(cat "$FAILS" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAILS"
last_ok="$(cat "$LASTOK" 2>/dev/null || echo 0)"; age_h=$(( (now - last_ok) / 3600 ))
last_n="$(cat "$NOTIFIED" 2>/dev/null || echo 0)"
if [ "$n" -ge 3 ] && [ "$age_h" -ge "$AFTER_H" ] && [ $(( now - last_n )) -ge 43200 ]; then
  echo "$now" > "$NOTIFIED"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e 'display notification "No verified off-host backup pull for over a day. Check network, key and the host." with title "AICC backup pull"' >/dev/null 2>&1 || true
  fi
fi
exit 1
