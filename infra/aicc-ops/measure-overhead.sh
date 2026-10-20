#!/usr/bin/env bash
# Measure AICC Ops' own footprint over N minutes and write a JSON report.
#   measure-overhead.sh [-m MINUTES=10] [-i SAMPLE_SECONDS=15] [-p PID] [-d DATA_DIR=/var/lib/aicc-ops] [-o OUT.json]
# Samples: RSS, cumulative CPU time (-> average CPU %), open file count, database + WAL bytes (-> growth bytes/day).
# Works on Linux (/proc) and macOS (ps/lsof; RSS and CPU semantics differ slightly, see README). Needs python3 for the report.
set -euo pipefail
MIN=10; INT=15; PID=""; DATA="/var/lib/aicc-ops"; OUT=""
while getopts "m:i:p:d:o:h" o; do
  case "$o" in m) MIN="$OPTARG";; i) INT="$OPTARG";; p) PID="$OPTARG";; d) DATA="$OPTARG";; o) OUT="$OPTARG";;
    h) sed -n '2,6p' "$0"; exit 0;; *) exit 2;; esac
done
[[ "$MIN" =~ ^[0-9]+([.][0-9]+)?$ ]] || { echo "bad -m" >&2; exit 2; }
[[ "$INT" =~ ^[0-9]+$ ]] && [ "$INT" -ge 1 ] || { echo "bad -i" >&2; exit 2; }
if [ -z "$PID" ]; then PID="$(pgrep -f 'aicc-ops.* run' | head -n1 || true)"; fi
[[ "$PID" =~ ^[0-9]+$ ]] || { echo "AICC Ops process not found (use -p PID)" >&2; exit 1; }
kill -0 "$PID" 2>/dev/null || { echo "pid $PID not running" >&2; exit 1; }
OUT="${OUT:-aicc-ops-overhead-$(date -u +%Y%m%dT%H%M%SZ).json}"
OS="$(uname -s)"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT

rss_kb() { if [ "$OS" = Linux ]; then awk '/^VmRSS:/{print $2}' "/proc/$PID/status"; else ps -o rss= -p "$PID" | tr -d ' '; fi; }
cpu_s() {
  if [ "$OS" = Linux ]; then
    awk -v hz="$(getconf CLK_TCK)" '{print ($14+$15)/hz}' "/proc/$PID/stat"
  else
    ps -o time= -p "$PID" | awk '{n=split($1,a,":"); s=0; for(i=1;i<=n;i++) s=s*60+a[i]; print s}'
  fi
}
nfiles() { if [ "$OS" = Linux ]; then ls "/proc/$PID/fd" 2>/dev/null | wc -l | tr -d ' '; else lsof -p "$PID" 2>/dev/null | tail -n +2 | wc -l | tr -d ' '; fi; }
dbbytes() { local t=0 f s; for f in "$DATA"/*.sqlite3 "$DATA"/*.sqlite3-wal; do [ -f "$f" ] && { s=$(stat -c %s "$f" 2>/dev/null || stat -f %z "$f"); t=$((t+s)); }; done; echo "$t"; }

END=$(( $(date +%s) + $(python3 -c "print(int(float('$MIN')*60))") ))
while [ "$(date +%s)" -lt "$END" ]; do
  kill -0 "$PID" 2>/dev/null || { echo "process exited during measurement" >&2; break; }
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date +%s)" "$(rss_kb)" "$(cpu_s)" "$(nfiles)" "$(dbbytes)" >> "$TMP"
  sleep "$INT"
done

CMD="$(ps -o command= -p "$PID" 2>/dev/null | cut -c1-160 || true)"
python3 - "$TMP" "$OUT" "$PID" "$OS" "$MIN" "$CMD" <<'PY'
import json, sys
rows = [tuple(float(x) for x in l.split("\t")) for l in open(sys.argv[1]) if l.strip()]
if len(rows) < 2:
    sys.exit("not enough samples")
t, rss, cpu, fds, db = zip(*rows)
dur = t[-1] - t[0]
rep = {
    "pid": int(sys.argv[3]), "os": sys.argv[4], "process_command": sys.argv[6], "requested_minutes": float(sys.argv[5]),
    "samples": len(rows), "duration_s": dur,
    "rss_mib": {"min": min(rss) / 1024, "avg": sum(rss) / len(rss) / 1024, "max": max(rss) / 1024, "last": rss[-1] / 1024},
    "cpu_seconds_used": cpu[-1] - cpu[0],
    "cpu_percent_of_one_core_avg": 100.0 * (cpu[-1] - cpu[0]) / dur if dur else None,
    "open_files": {"min": min(fds), "max": max(fds), "last": fds[-1]},
    "db_bytes": {"first": db[0], "last": db[-1], "growth": db[-1] - db[0]},
    "db_growth_bytes_per_day_extrapolated": (db[-1] - db[0]) / dur * 86400 if dur else None,
    "targets": {"rss_mib_max": 40, "cpu_percent_avg_max": 1.0, "disk_mib_max": 150},
    "note": "Short runs under-estimate DB growth (rollups/pruning are periodic) and, on macOS, ps RSS/cputime differ from Linux /proc.",
}
rep["within_targets"] = {
    "rss": rep["rss_mib"]["max"] <= 40,
    "cpu": (rep["cpu_percent_of_one_core_avg"] or 0) < 1.0,
    "disk": rep["db_bytes"]["last"] <= 150 * 1024 * 1024,
}
json.dump(rep, open(sys.argv[2], "w"), indent=2)
print(json.dumps(rep, indent=2))
PY
