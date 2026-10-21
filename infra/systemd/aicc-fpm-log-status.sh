#!/usr/bin/env bash
# Counts how often PHP-FPM reported "server reached pm.max_children" in the last 5 and 15 minutes and writes the NUMBERS (no log text) for AICC Ops.
# Why: the pool status page needs a FastCGI client on the PHP socket (a privilege AICC Ops must not have: owner decision), but the master's log is root-only and rotated.
# This root-run, sandboxed oneshot (timer, every minute) is the narrow bridge. Installed as /usr/local/sbin/aicc-fpm-log-status.
# Output: /var/lib/aicc/status/fpm-log.json (0644; directory 0755 root): {"schema":1,"ts":N,"events_5m":N,"events_15m":N,"log_present":true}
# Test seams: AICC_FPM_LOG, AICC_STATUS_DIR, AICC_NOW (epoch).
set -euo pipefail
umask 022
LOG="${AICC_FPM_LOG:-/var/log/php8.3-fpm.log}"; DIR="${AICC_STATUS_DIR:-/var/lib/aicc/status}"; NOW="${AICC_NOW:-$(date -u +%s)}"
[[ "$NOW" =~ ^[0-9]+$ ]] || { echo "bad AICC_NOW" >&2; exit 2; }
mkdir -p "$DIR"
tmp="$(mktemp "$DIR/.fpmlog.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
python3 -I - "$LOG" "$NOW" > "$tmp" <<'PY'
import calendar, json, os, re, sys, time
log, now = sys.argv[1], int(sys.argv[2])
present = os.path.isfile(log)
e5 = e15 = 0
if present:
    try:
        with open(log, "rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            fh.seek(max(0, size - 262144))                 # the last 256 KiB is far more than 15 minutes of a quiet pool
            text = fh.read().decode("utf-8", "replace")
    except OSError:
        present = False
        text = ""
    rx = re.compile(r"^\[(\d{2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2})\] WARNING: \[pool [^\]]{1,40}\] server reached pm\.max_children setting")
    for line in text.splitlines():
        m = rx.match(line)
        if not m:
            continue
        try:
            ts = calendar.timegm(time.strptime(m.group(1), "%d-%b-%Y %H:%M:%S"))
        except ValueError:
            continue
        age = now - ts
        if 0 <= age <= 900:
            e15 += 1
            if age <= 300:
                e5 += 1
print(json.dumps({"schema": 1, "ts": now, "events_5m": e5, "events_15m": e15, "log_present": present}))
PY
chmod 644 "$tmp"; mv -f "$tmp" "$DIR/fpm-log.json"; trap - EXIT
