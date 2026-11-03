#!/usr/bin/env bash
# launchd wrapper around pull-offhost.sh: runs the pull, keeps a consecutive-failure counter and, when the Mac has had no verified pull for a long time,
# shows ONE macOS notification (fixed text: no host, no path, no secret) at most every 12 hours. The server-side alert (AICC Ops offhost_stale) is the
# primary signal; this only helps when the Mac is awake but cannot reach the host.
# pull-offhost.sh exit 5 (Mac volume too full) and 6 (size cap reached: set refused, nothing deleted) are notified at once, with the same 12 h limit.
#   offhost-pull-runner.sh --pull-script PATH --stage-ip IP --stage-host H --key FILE --dest DIR [--notify-after-h 26] [--env production --expect-id ID --known-hosts FILE]
set -euo pipefail
PULL=""; IP=""; HOST=""; KEY=""; DEST=""; AFTER_H=26; ENVN="stage"; EXPECT_ID=""; KNOWN_HOSTS=""; ENC=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pull-script) PULL="${2:-}"; shift 2 ;; --stage-ip) IP="${2:-}"; shift 2 ;; --stage-host) HOST="${2:-}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;; --dest) DEST="${2:-}"; shift 2 ;; --notify-after-h) AFTER_H="${2:-26}"; shift 2 ;;
    --env) ENVN="${2:-}"; shift 2 ;; --expect-id) EXPECT_ID="${2:-}"; shift 2 ;; --known-hosts) KNOWN_HOSTS="${2:-}"; shift 2 ;; --encrypt-to) ENC="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -f "$PULL" ] && [ -n "$IP" ] && [ -n "$HOST" ] && [ -n "$KEY" ] && [ -n "$DEST" ] || { echo "missing arguments" >&2; exit 2; }
# best effort: on a full volume the folder may not be creatable yet, and the pull itself must still run so that it can answer exit 5 (a first run on a full volume)
mkdir -p "$DEST" 2>/dev/null || true; chmod 700 "$DEST" 2>/dev/null || true
FAILS="$DEST/.consecutive-failures"; NOTIFIED="$DEST/.last-notified"; LASTOK="$DEST/.last-ok"
now="$(date -u +%s)"
# the 12 h notification limit is kept in the MODIFICATION TIME of stamp files (touching an existing file needs no free disk space, writing contents does). Two stamps: one in the backup folder and one
# in $TMPDIR (a second path, in case the folder is unwritable). They are created with an epoch-0 time while the disk still works, so a later full volume can still update them.
STAMPS=("$NOTIFIED" "${TMPDIR:-/tmp}/aicc-offhost-pull-notified.$(printf '%s' "$DEST" | cksum | awk '{print $1}')")
mtime_of() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0; }
for st in "${STAMPS[@]}"; do [ -e "$st" ] || { { : > "$st" && touch -t 197001020000 "$st"; } 2>/dev/null || true; }; done
EXTRA=(); [ "$ENVN" = production ] && EXTRA=(--env production --expect-id "$EXPECT_ID" --known-hosts "$KNOWN_HOSTS")
[ -z "$ENC" ] || EXTRA+=(--encrypt-to "$ENC")
rc=0
bash "$PULL" --stage-ip "$IP" --stage-host "$HOST" --key "$KEY" --dest "$DEST" ${EXTRA[@]+"${EXTRA[@]}"} || rc=$?
if [ "$rc" -eq 0 ]; then
  rm -f "$FAILS"; exit 0
fi
# on a full volume these small state files cannot be written: that must not stop the notification below (set -e), so every write here is best effort
n=$(( $(cat "$FAILS" 2>/dev/null || echo 0) + 1 )); { echo "$n" > "$FAILS"; } 2>/dev/null || true
last_ok="$(cat "$LASTOK" 2>/dev/null || echo 0)"; age_h=$(( (now - last_ok) / 3600 ))
last_n=0
for st in "${STAMPS[@]}"; do t="$(mtime_of "$st")"; [[ "$t" =~ ^[0-9]+$ ]] || t=0; [ "$t" -le "$last_n" ] || last_n="$t"; done
msg=""
# exit 5 = the pull's free-space guard (the disk is too full for the next set, or the host declares an unusually large one); exit 6 = the hard cap on the backup folder was reached or the host sent an unusually
# large set: the set was refused and NOTHING was deleted. Both are local, owner-fixable conditions, so they are not held back for 26 h or 3 failures.
if [ "$rc" -eq 5 ]; then msg="The Mac disk is too full for the next backup (or the host announces an unusually large one): backups are NOT being copied. Free space and read the pull log."
elif [ "$rc" -eq 6 ]; then msg="The backup folder reached its size cap or the host sent an unusually large backup: new backups are NOT being taken. Nothing was deleted. Check the host and the pull log."
elif [ "$n" -ge 3 ] && [ "$age_h" -ge "$AFTER_H" ]; then msg="No verified off-host backup pull for over a day. Check network, key and the host."; fi
if [ -n "$msg" ] && [ $(( now - last_n )) -ge 43200 ]; then
  for st in "${STAMPS[@]}"; do { touch "$st" || : > "$st"; } 2>/dev/null || true; done
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$msg\" with title \"AICC backup pull\"" >/dev/null 2>&1 || true
  fi
fi
exit 1
