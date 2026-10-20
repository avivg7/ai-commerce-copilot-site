#!/usr/bin/env bash
# Writes a per-unit status file that AICC Ops reads. NO network, NO notification channel: a file is the whole interface.
#   aicc-unit-status failed <unit>    called by aicc-notify-failure@<unit>.service (OnFailure=)
#   aicc-unit-status ok <unit>        called by ExecStartPost= of the unit after a successful start/run
# Installed as /usr/local/sbin/aicc-unit-status (root:root 0755). Output: /var/lib/aicc/status/unit-<unit>.json (0644, directory 0755 root:root).
# JSON schema (schema 1):
#   {"schema":1,"unit":"aicc-backup.service","state":"failed|ok","status":"failed|ok","since_epoch":1729500000,"since":"2026-10-21T03:30:12Z",
#    "result":"exit-code|timeout|signal|...|""  ,"exec_main_status":"1|",  "host":"aicc-cp-stage"}
# "status" duplicates "state" on purpose: AICC Ops' backup collector parses a top-level "status" key.
# The file holds no log text (journal lines can contain request data); the operator reads `journalctl -u <unit>` for the cause.
# Failure files are sticky: they are replaced only by the next "ok" for the same unit (or by another failure).
set -euo pipefail
umask 022
STATUS_DIR="${AICC_STATUS_DIR:-/var/lib/aicc/status}"
SYSTEMCTL="${AICC_SYSTEMCTL:-systemctl}"
state="${1:-}"; unit="${2:-}"
case "$state" in failed|ok) ;; *) echo "usage: $0 failed|ok <unit>" >&2; exit 2;; esac
# strict allow-list: the unit name becomes part of a file name and of JSON
if ! [[ "$unit" =~ ^[A-Za-z0-9][A-Za-z0-9._@:-]{0,127}\.(service|timer)$ ]]; then echo "refused: bad unit name" >&2; exit 2; fi
mkdir -p "$STATUS_DIR"
result=""; status=""
if [ "$state" = "failed" ]; then
  result="$("$SYSTEMCTL" show -p Result --value "$unit" 2>/dev/null | tr -cd 'A-Za-z0-9._-' | head -c 40 || true)"
  status="$("$SYSTEMCTL" show -p ExecMainStatus --value "$unit" 2>/dev/null | tr -cd '0-9' | head -c 5 || true)"
fi
now="$(date -u +%s)"
iso="$(date -u -d "@$now" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$now" +%Y-%m-%dT%H:%M:%SZ)"
host="$(hostname 2>/dev/null | tr -cd 'A-Za-z0-9.-' | head -c 63 || echo unknown)"
tmp="$(mktemp "$STATUS_DIR/.unit.XXXXXX")"
printf '{"schema":1,"unit":"%s","state":"%s","status":"%s","since_epoch":%s,"since":"%s","result":"%s","exec_main_status":"%s","host":"%s"}\n' \
  "$unit" "$state" "$state" "$now" "$iso" "$result" "$status" "$host" > "$tmp"
chmod 0644 "$tmp"
mv -f "$tmp" "$STATUS_DIR/unit-$unit.json"
echo "status: $unit -> $state"
