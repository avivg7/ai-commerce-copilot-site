#!/usr/bin/env bash
# OFF-HOST backup pull. Runs ON THE OWNER'S MAC (not on the server). Pulls the latest database dump + files archive of the STAGING Control Plane over SSH,
# verifies the checksums, applies tiered retention (24 h hourly, daily for 14 days, weekly for 8 weeks, minimum 3 sets), and then tells the host (ack) that a verified copy exists off-host so AICC Ops can alert when the
# copies go stale. Modeled on the proven API-host pull (Backend repo docs/digitalocean-infrastructure.md section 14): a PULL, so the server holds no
# credentials for the Mac and a compromised server cannot delete the Mac's copies.
#
#   infra/backup/pull-offhost.sh --stage-ip <IPV4> [--stage-host stage.copilt.org] [--key ~/.ssh/aicc_cp_stage_offhost] [--user aicc-offhost]
#                                [--dest ~/aicc-offhost-backups-stage] [--keep N] [--no-files-archive] [--no-ack] [--dry-run]
#
# TRANSPORT: the default key/user is the RESTRICTED pull account (install-offhost-access.sh): sshd forces every login of that account into
# /usr/local/sbin/aicc-offhost-serve, which only understands `identity`, `status`, `get <backup file>` and `ack ...`. This script therefore sends those four
# words and never `sudo cat`. (The operator key/user `aicc` does NOT work with this script any more: use a manual `ssh` for operator tasks.)
#
# Fail closed:
#   * the host is NEVER guessed: --stage-ip is required, there is no default. It must be a literal IPv4 address.
#   * refuses the production API address 139.59.157.231 (and the other public addresses in the deny list), refuses any key whose file name looks like the
#     production key (aicc_digitalocean_prod*), refuses --stage-host values other than stage*.copilt.org.
#   * only the dedicated pull key is used (ssh -i KEY -o IdentitiesOnly=yes -o BatchMode=yes); no agent keys, no default identities.
#   * refuses to continue unless the host presents /etc/aicc-stage-identity with AICC_ENV=staging (and AICC_HOSTNAME equal to --stage-host).
#   * file names come from the server's status.json but are re-validated against a strict pattern before use (no path traversal from a hostile server).
#   * a copy is accepted only if: sha256 of the received bytes == the server's .sha256 sidecar == the hash recorded in status.json, and gzip -t passes.
#   * writes no secrets. Note: the files archive contains the host's wp-config.php (DB password, salts) and uploads: dest dir is 0700, files 0600. Keep this
#     folder on an encrypted disk (FileVault). --no-files-archive pulls the database dump only.
# Output files in --dest: aicc_cp-<UTC>-<label>.sql.gz(+.sha256), aicc-files-<UTC>-<label>.tar.gz(+.sha256), pull.log.
# Schedule it yourself if you want (launchd/cron); this script does not install anything.
# Exit codes: 0 ok, 1 pull/verification failed, 2 usage, 3 refused by a safety rule, 4 another pull is running (skipped).
set -euo pipefail
umask 077

STAGE_IP=""; STAGE_HOST="stage.copilt.org"; KEY="$HOME/.ssh/aicc_cp_stage_offhost"; USER_NAME="aicc-offhost"; DEST="$HOME/aicc-offhost-backups-stage"; KEEP=""
WITH_FILES=1; DRY=0; ACK=1
DENY_IPS="139.59.157.231 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../provision/lib/ip-guard.sh"   # strict address check (security review L5)
while [ $# -gt 0 ]; do
  case "$1" in
    --stage-ip) STAGE_IP="${2:-}"; shift 2 ;;
    --stage-host) STAGE_HOST="${2:-}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;;
    --user) USER_NAME="${2:-}"; shift 2 ;;
    --dest) DEST="${2:-}"; shift 2 ;;
    --keep) KEEP="${2:-}"; shift 2 ;;
    --no-files-archive) WITH_FILES=0; shift ;;
    --no-ack) ACK=0; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,27p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 3; }
[ -n "$STAGE_IP" ] || { echo "usage: $0 --stage-ip <ipv4> [options]  (the host is never guessed)" >&2; exit 2; }
[[ "$STAGE_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || refuse "--stage-ip must be a literal IPv4 address"
for d in $DENY_IPS; do [ "$STAGE_IP" = "$d" ] && refuse "$STAGE_IP is a production/public address, not the staging Droplet."; done
aicc_ip_guard "$STAGE_IP" "--stage-ip " || exit 3
[[ "$STAGE_HOST" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || refuse "--stage-host must look like stage.copilt.org (production names are refused)"
case "$STAGE_HOST" in www.copilt.org|copilt.org|api.copilt.org) refuse "$STAGE_HOST is a production hostname." ;; esac
case "$(basename "$KEY")" in aicc_digitalocean_prod*) refuse "never use the production key." ;; esac
case "$KEY" in *aicc_digitalocean_prod*) refuse "never use the production key." ;; esac
[ -f "$KEY" ] || { echo "no such key file: $KEY" >&2; exit 2; }
grep -q "PRIVATE KEY" "$KEY" 2>/dev/null || refuse "$KEY is not a private key file"
[[ "$USER_NAME" =~ ^[a-z][a-z0-9_-]{0,31}$ ]] || refuse "bad --user"
[ -z "$KEEP" ] || { [[ "$KEEP" =~ ^[0-9]+$ ]] && [ "$KEEP" -ge 2 ]; } || { echo "--keep must be a number >= 2" >&2; exit 2; }
[[ "$DEST" == /* ]] || { echo "--dest must be an absolute path" >&2; exit 2; }

KH="$HOME/.ssh/known_hosts_aicc_stage"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KH" -o ServerAliveInterval=15 "$USER_NAME@$STAGE_IP")
rem() { "${SSH[@]}" "$@"; }
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
LOG="$DEST/pull.log"
# everything the server can influence is printable ASCII only and short before it reaches a log (no escape sequences, no log injection)
clean() { printf '%s' "$*" | LC_ALL=C tr -cd '\040-\176' | cut -c1-300; }
say() { local m; m="$(clean "$*")"; echo "$(ts)  $m"; [ "$DRY" = 1 ] || echo "$(ts)  $m" >> "$LOG"; }
MAX_BYTES=$((2 * 1024 * 1024 * 1024)); case "${AICC_PULL_MAX_BYTES:-}" in ""|*[!0-9]*) ;; *) MAX_BYTES="$AICC_PULL_MAX_BYTES" ;; esac   # the variable can only LOWER the ceiling in practice (tests)   # a backup set member larger than this is refused (a hostile host cannot fill the Mac's disk)
# bounded transfer: at most MAX_BYTES and at most 900 s wall clock (perl alarm when available; ssh ServerAlive* already kills a dead link)
bounded() { if command -v perl >/dev/null 2>&1; then perl -e 'alarm 900; exec @ARGV' -- "$@" | head -c "$MAX_BYTES"; else "$@" | head -c "$MAX_BYTES"; fi; }
sha_of() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; else sha256sum "$1" | awk '{print $1}'; fi; }

if [ "$DRY" = 1 ]; then
  echo "DRY-RUN: would ssh $USER_NAME@$STAGE_IP with key $KEY, verify the staging identity ($STAGE_HOST), read the backup status,"
  echo "         pull the newest dump$([ $WITH_FILES = 1 ] && echo ' and files archive') with sha256 verification into $DEST, keep $KEEP copies."
  exit 0
fi
mkdir -p "$DEST"; chmod 700 "$DEST"; : >> "$LOG"; chmod 600 "$LOG"
# one run at a time (launchd may start a run while a slow one is still going); a stale lock of a dead pid is taken over
LOCK="$DEST/.pull.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  lp="$(cat "$LOCK/pid" 2>/dev/null || true)"
  lage=$(( $(date -u +%s) - $(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null || echo 0) ))
  # a live pid younger than 3 hours is a real concurrent pull; an older lock is stale even if the pid was reused by an unrelated process
  if [ -n "$lp" ] && kill -0 "$lp" 2>/dev/null && [ "$lage" -lt 10800 ]; then say "another pull is running (pid $lp): skipped"; exit 4; fi
  rm -rf "$LOCK"; mkdir "$LOCK"
fi
echo $$ > "$LOCK/pid"; trap 'rm -rf "$LOCK"' EXIT

ident="$(rem 'identity' 2>/dev/null)" || { say "FAILURE cannot ssh to the staging host"; exit 1; }
echo "$ident" | grep -q '^AICC_ENV=staging$' || refuse "host does not present AICC_ENV=staging in /etc/aicc-stage-identity"
echo "$ident" | grep -q "^AICC_HOSTNAME=${STAGE_HOST}\$" || refuse "host identity AICC_HOSTNAME does not equal $STAGE_HOST"

status="$(rem "status" 2>/dev/null)" || { say "FAILURE cannot read status.json"; exit 1; }
if [ "$(echo "$status" | jq -r '.status | tostring')" != "ok" ]; then
  # the newest RUN failed, but last_success still names a complete, verified set: pull that one (a failing host must not also stop the off-host copies), and say so loudly
  [ -n "$(echo "$status" | jq -r '.last_success.db_dump_file // empty')" ] || { say "FAILURE latest backup run on the host did not finish ok and no earlier success is recorded: $(echo "$status" | jq -r '.reason | tostring' | cut -c1-200)"; exit 1; }
  say "WARNING the host's latest backup run FAILED ($(echo "$status" | jq -r '.reason | tostring' | cut -c1-120)); pulling the last good set"
fi
dump="$(echo "$status" | jq -r '.last_success.db_dump_file // empty')"
farc="$(echo "$status" | jq -r '.last_success.files_archive_file // empty')"
[[ "$dump" =~ ^aicc_cp-[0-9]{8}T[0-9]{6}Z-(scheduled|pre-release|manual)\.sql\.gz$ ]] || { say "FAILURE unexpected dump file name from server: '$dump'"; exit 1; }
if [ "$WITH_FILES" = 1 ]; then [[ "$farc" =~ ^aicc-files-[0-9]{8}T[0-9]{6}Z-(scheduled|pre-release|manual)\.tar\.gz$ ]] || { say "FAILURE unexpected archive file name from server: '$farc'"; exit 1; }; fi
# EVERY server-derived value is validated against a strict pattern BEFORE it is used in arithmetic, a path, a comparison or a remote command (bash evaluates the
# value of a variable inside $(( )) as an expression, so an unvalidated string from the server would be code execution on this Mac).
fin="$(echo "$status" | jq -r '.last_success.finished_epoch | tostring')"
[[ "$fin" =~ ^[0-9]{9,11}$ ]] || { say "FAILURE bad finished_epoch from the server"; exit 1; }
now_e="$(date -u +%s)"; age=$(( now_e - fin ))
[ "$fin" -le $(( now_e + 86400 )) ] || { say "FAILURE the server's backup time is in the future"; exit 1; }
say "server's latest good backup is ${age}s old ($dump)"
[ "$age" -le $((26 * 3600)) ] || say "WARNING that backup is older than 26 hours: the server's backup job may be stale"
# the timestamp in the file names must be plausible too: a hostile host cannot outrank genuine copies with far-future names
for nm in "$dump" "$([ "$WITH_FILES" = 1 ] && echo "$farc")"; do
  [ -n "$nm" ] || continue
  nts="$(echo "$nm" | sed -n 's/.*-\([0-9]\{8\}\)T\([0-9]\{6\}\)Z-.*/\1\2/p')"
  nep="$(date -u -j -f '%Y%m%d%H%M%S' "$nts" +%s 2>/dev/null || date -u -d "${nts:0:8} ${nts:8:2}:${nts:10:2}:${nts:12:2}" +%s 2>/dev/null || echo 0)"
  [[ "$nep" =~ ^[0-9]+$ ]] && [ "$nep" -gt 1700000000 ] && [ "$nep" -le $(( now_e + 86400 )) ] || { say "FAILURE implausible timestamp in file name from the server: $nm"; exit 1; }
done

# the server records the sha256 of every file it wrote; pick it for the dump (and the archive) from status.json
want_dump="$(echo "$status" | jq -r --arg f "$dump" 'if .db_dump.file == $f then (.db_dump.sha256 | tostring) else empty end')"
want_farc="$(echo "$status" | jq -r --arg f "$farc" 'if .files_archive.file == $f then (.files_archive.sha256 | tostring) else empty end')"
[[ -z "$want_dump" || "$want_dump" =~ ^[0-9a-f]{64}$ ]] || { say "FAILURE bad dump hash in status.json"; exit 1; }
[[ -z "$want_farc" || "$want_farc" =~ ^[0-9a-f]{64}$ ]] || { say "FAILURE bad archive hash in status.json"; exit 1; }

pull_one() { # pull_one <name> <sha-from-status>
  local name="$1" want="$2" tmp="$DEST/$1.partial" side got sc
  if [ -f "$DEST/$name" ] && [ -f "$DEST/$name.sha256" ] && [ "$(sha_of "$DEST/$name")" = "$want" ]; then say "already have $name (checksum verified)"; return 0; fi
  bounded "${SSH[@]}" "get $name" > "$tmp" || { rm -f "$tmp"; say "FAILURE transfer of $name"; return 1; }
  if [ "$(wc -c < "$tmp" | tr -d ' ')" -ge "$MAX_BYTES" ]; then rm -f "$tmp"; say "FAILURE $name reached the size ceiling"; return 1; fi
  side="$(rem "get $name.sha256" 2>/dev/null | head -c 200 | awk '{print $1}' | head -1)"
  [[ "$side" =~ ^[0-9a-f]{64}$ ]] || { rm -f "$tmp"; say "FAILURE bad sidecar hash for $name"; return 1; }
  got="$(sha_of "$tmp")"
  if [ "$got" != "$side" ]; then rm -f "$tmp"; say "FAILURE checksum mismatch for $name (received $got, server sidecar '${side:-none}')"; return 1; fi
  if [ -n "$want" ] && [ "$got" != "$want" ]; then rm -f "$tmp"; say "FAILURE $name differs from the hash recorded in status.json"; return 1; fi
  gzip -t "$tmp" || { rm -f "$tmp"; say "FAILURE gzip -t failed for $name"; return 1; }
  mv -f "$tmp" "$DEST/$name"; chmod 600 "$DEST/$name"
  printf '%s  %s\n' "$got" "$name" > "$DEST/$name.sha256"; chmod 600 "$DEST/$name.sha256"
  sc="$(wc -c < "$DEST/$name" | tr -d ' ')"
  say "SUCCESS pulled $name ($sc bytes), checksum verified"
}
pull_one "$dump" "$want_dump" || exit 1
if [ "$WITH_FILES" = 1 ]; then pull_one "$farc" "$want_farc" || exit 1; fi

# Tell the host a verified copy now exists off-host (AICC Ops alerts when this ack goes stale). The host re-checks the hashes against its own sidecars.
set_ts="$(echo "$dump" | sed -n 's/^aicc_cp-\([0-9]\{8\}T[0-9]\{6\}Z\)-.*/\1/p')"
if [ "$ACK" = 1 ]; then
  dsha="$(sha_of "$DEST/$dump")"; if [ "$WITH_FILES" = 1 ]; then fname="$farc"; fsha="$(sha_of "$DEST/$farc")"; else fname="-"; fsha="-"; fi
  if rem "ack $set_ts $dump $dsha $fname $fsha" >/dev/null 2>&1; then say "SUCCESS host acknowledged the off-host copy of set $set_ts"
  else say "FAILURE the host did not accept the ack (the copy itself is verified and kept)"; exit 1; fi
fi
date -u +%s > "$DEST/.last-ok"; chmod 600 "$DEST/.last-ok"

# retention. Default (tiered, matches an HOURLY backup): every set of the last 24 h, the newest set of each UTC day for 14 days, the newest of each ISO week for 8 weeks, and
# never fewer than the newest 3. `--keep N` = simply the newest N of each kind. Only files matching our name patterns are touched; the timestamp in the name decides.
python3 -I - "$DEST" "$KEEP" > "$DEST/.prune.list" <<'PY'
import datetime, glob, os, re, sys, time
d, keep = sys.argv[1], sys.argv[2]
now = datetime.datetime.now(datetime.timezone.utc)
rx = re.compile(r"-(\d{8}T\d{6}Z)-")
for pat in ("aicc_cp-*.sql.gz", "aicc-files-*.tar.gz"):
    files = sorted(glob.glob(os.path.join(d, pat)), reverse=True)
    items = []
    for f in files:
        m = rx.search(os.path.basename(f))
        if not m:
            continue
        t = datetime.datetime.strptime(m.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
        items.append((f, t))
    if keep:
        keepset = {f for f, _ in items[: int(keep)]}
    else:
        keepset = {f for f, _ in items[:3]}
        days, weeks = set(), set()
        for f, t in items:                       # newest first
            age = now - t
            if age <= datetime.timedelta(hours=24):
                keepset.add(f)
                continue
            day = t.strftime("%Y%m%d"); wk = "%d-%02d" % t.isocalendar()[:2]
            if age <= datetime.timedelta(days=14) and day not in days:
                days.add(day); keepset.add(f)
            if age <= datetime.timedelta(weeks=8) and wk not in weeks:
                weeks.add(wk); keepset.add(f)
    for f, _ in items:
        if f not in keepset:
            print(f)
PY
while IFS= read -r old; do
  [ -n "$old" ] || continue
  case "$(basename "$old")" in aicc_cp-*.sql.gz|aicc-files-*.tar.gz) rm -f -- "$old" "$old.sha256"; say "pruned $(basename "$old")" ;; esac
done < "$DEST/.prune.list"
rm -f "$DEST/.prune.list"
say "off-host pull finished ok"
