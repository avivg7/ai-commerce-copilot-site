#!/usr/bin/env bash
# Hourly security-update job. WHY: Ubuntu's own apt-daily-upgrade runs once a day (~06:00 UTC); on 2026-10-21 a critical PHP RCE fix (USN-8948-1) was published and the host
# would have waited up to ~24 h. This job refreshes the package lists and runs unattended-upgrade EVERY HOUR (same Allowed-Origins policy: only the distribution and its
# -security pockets), then proves the RUNNING services are patched (a service that still maps a replaced binary or library is reloaded when it is safe: PHP-FPM only) and
# writes numbers for AICC Ops (no package versions in alerts, no log text): /var/lib/aicc/status/security-updates.json.
# It never reboots (Automatic-Reboot stays false: reboots are planned, AICC Ops already warns about a pending one) and never touches MySQL or Caddy by itself.
# Installed as /usr/local/sbin/aicc-security-updates, run by aicc-security-updates.timer.
# Output (0644): {"schema":1,"ts":N,"finished_epoch":N,"ok":bool,"update_rc":N,"upgrade_rc":N,"upgraded":["pkg",...],"pending_count":N,"pending_oldest_epoch":N|null,
#                 "stale_services":["php8.3-fpm"],"reloaded":["php8.3-fpm"],"reboot_required":bool}
# Test seams (never set in production): AICC_APT_GET, AICC_UNATTENDED_UPGRADE, AICC_SYSTEMCTL, AICC_PROC_ROOT, AICC_REBOOT_FILE, AICC_STATUS_DIR, AICC_STATE_DIR, AICC_NOW.
set -uo pipefail
umask 022
APT_GET="${AICC_APT_GET:-/usr/bin/apt-get}"
UU="${AICC_UNATTENDED_UPGRADE:-/usr/bin/unattended-upgrade}"
SYSTEMCTL="${AICC_SYSTEMCTL:-/usr/bin/systemctl}"
PROC_ROOT="${AICC_PROC_ROOT:-/proc}"
REBOOT_FILE="${AICC_REBOOT_FILE:-/var/run/reboot-required}"
DIR="${AICC_STATUS_DIR:-/var/lib/aicc/status}"
STATE="${AICC_STATE_DIR:-/var/lib/aicc}"
NOW="${AICC_NOW:-$(date -u +%s)}"
[[ "$NOW" =~ ^[0-9]+$ ]] || { echo "bad AICC_NOW" >&2; exit 2; }
mkdir -p "$DIR" "$STATE"
chmod 0755 "$DIR"
exec 9>"$STATE/security-updates.lock"
# flock is util-linux (always present on the host); without it we still run: apt/dpkg serialise on their own lock
if command -v flock >/dev/null 2>&1; then flock -n 9 || { echo "another run is in progress" >&2; exit 0; }; fi
work="$(mktemp -d "$STATE/.secupd.XXXXXX")"
trap 'rm -rf "$work"' EXIT

lock_opts=(-o DPkg::Lock::Timeout=600)

# 1. refresh the lists (one retry: mirrors blip)
update_rc=0
"$APT_GET" -qq "${lock_opts[@]}" update >"$work/update.log" 2>&1 || { sleep "${AICC_RETRY_SLEEP:-20}"; "$APT_GET" -qq "${lock_opts[@]}" update >>"$work/update.log" 2>&1; } || update_rc=$?

# 2. what a security upgrade would install, BEFORE and AFTER (simulation, no lock needed)
simulate() { "$APT_GET" -s -o Debug::NoLocking=1 upgrade 2>/dev/null | awk '/^Inst /{ if ($0 ~ /-security/) print $2 }' | sort -u; }
simulate >"$work/before.txt" || true

# 3. install (unattended-upgrade applies the Allowed-Origins policy; its own exit code is recorded, not hidden)
upgrade_rc=0
"$UU" "${lock_opts[@]}" >"$work/uu.log" 2>&1 || upgrade_rc=$?
simulate >"$work/after.txt" || true

# 4. are the RUNNING services patched? A deleted main binary or a deleted mapped library means the process still runs replaced code.
stale_of() {   # $1 = unit name -> prints the unit name if its main process maps a deleted executable/library
  local unit="$1" pid
  pid="$("$SYSTEMCTL" show -p MainPID --value "$unit" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] && [ "$pid" -gt 1 ] || return 0
  if [ -L "$PROC_ROOT/$pid/exe" ] && readlink "$PROC_ROOT/$pid/exe" 2>/dev/null | grep -q ' (deleted)$'; then echo "$unit"; return 0; fi
  if [ -r "$PROC_ROOT/$pid/maps" ] && grep -E ' (/usr/lib|/lib|/usr/sbin|/usr/bin)[^ ]*(\.so[^ ]*|php-fpm[0-9.]*|mysqld|sshd) \(deleted\)$' "$PROC_ROOT/$pid/maps" >/dev/null 2>&1; then echo "$unit"; fi
}
: >"$work/stale.txt"; : >"$work/reloaded.txt"
for u in php8.3-fpm mysql ssh; do stale_of "$u.service" >>"$work/stale.txt"; done
# PHP-FPM is the one public-facing service we re-exec ourselves (graceful: USR2 re-executes the master binary, workers finish their requests).
if grep -qx 'php8.3-fpm.service' "$work/stale.txt" && [ -z "${AICC_NO_RELOAD:-}" ]; then
  if "$SYSTEMCTL" reload php8.3-fpm.service >/dev/null 2>&1; then
    echo "php8.3-fpm" >>"$work/reloaded.txt"; sleep "${AICC_RELOAD_SETTLE:-3}"
    : >"$work/stale.txt"; for u in php8.3-fpm mysql ssh; do stale_of "$u.service" >>"$work/stale.txt"; done
  fi
fi

# 5. the status file (numbers and package NAMES only; first-seen times of pending updates persist in a root-only state file so their AGE is known)
python3 -I - "$work" "$STATE/security-updates.pending.json" "$NOW" "$update_rc" "$upgrade_rc" "$REBOOT_FILE" >"$work/status.json" <<'PY'
import json, os, sys
work, pend_file, now, update_rc, upgrade_rc, reboot = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), sys.argv[6]
def lines(n):
    try:
        with open(os.path.join(work, n)) as fh:
            return [l.strip() for l in fh if l.strip()]
    except OSError:
        return []
before, after = set(lines("before.txt")), lines("after.txt")
upgraded = sorted(before - set(after))
try:
    with open(pend_file) as fh:
        seen = json.load(fh)
    seen = seen if isinstance(seen, dict) else {}
except (OSError, ValueError):
    seen = {}
seen = {k: v for k, v in seen.items() if k in after and isinstance(v, int)}      # drop what is no longer pending
for p in after:
    seen.setdefault(p, now)
tmp = pend_file + ".tmp"
with open(tmp, "w") as fh:
    json.dump(seen, fh)
os.chmod(tmp, 0o600); os.replace(tmp, pend_file)
ok = update_rc == 0 and upgrade_rc == 0
print(json.dumps({
    "schema": 1, "ts": now, "finished_epoch": now, "ok": ok, "update_rc": update_rc, "upgrade_rc": upgrade_rc,
    "upgraded": upgraded[:50], "pending_count": len(after),
    "pending_oldest_epoch": min(seen.values()) if seen else None,
    "stale_services": sorted({s.replace(".service", "") for s in lines("stale.txt")}),
    "reloaded": lines("reloaded.txt"), "reboot_required": os.path.exists(reboot),
}))
PY
chmod 644 "$work/status.json"
mv -f "$work/status.json" "$DIR/security-updates.json"
# a failed refresh or upgrade is a failed unit (OnFailure= records it for AICC Ops); the status file above is written either way
[ "$update_rc" -eq 0 ] && [ "$upgrade_rc" -eq 0 ]
