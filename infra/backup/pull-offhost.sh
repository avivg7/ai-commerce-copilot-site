#!/usr/bin/env bash
# OFF-HOST backup pull. Runs ON THE OWNER'S MAC (not on the server). Pulls the latest database dump + files archive of the STAGING Control Plane over SSH,
# verifies the checksums, applies tiered retention (24 h hourly, daily for 14 days, weekly for 8 weeks, minimum 3 sets), and then tells the host (ack) that a verified copy exists off-host so AICC Ops can alert when the
# copies go stale. Modeled on the proven API-host pull (Backend repo docs/digitalocean-infrastructure.md section 14): a PULL, so the server holds no
# credentials for the Mac and a compromised server cannot make the Mac delete copies earlier than the time-based tier policy says (the size cap below only REFUSES; README-backup.md
# "What a compromised or runaway host can and cannot do").
#
#   infra/backup/pull-offhost.sh --stage-ip <IPV4> [--stage-host stage.copilt.org] [--key ~/.ssh/aicc_cp_stage_offhost] [--user aicc-offhost]
#                                [--dest ~/aicc-offhost-backups-stage] [--keep N] [--no-files-archive] [--no-ack] [--dry-run] [--min-free-mb N] [--max-total-mb N]
#   PRODUCTION (the staging Droplet promoted in place, docs/cutover/production-promotion.md; nothing is defaulted, every name below is different from the staging one on purpose):
#   infra/backup/pull-offhost.sh --env production --stage-ip <IPV4> --stage-host www.copilt.org --expect-id <32 hex> [--key ~/.ssh/aicc_cp_prod_offhost]
#                                [--dest ~/aicc-offhost-backups-production] [--known-hosts ~/.ssh/known_hosts_aicc_prod_cp] ...
#     production tightens only: host name exactly www.copilt.org; key file named aicc_cp_prod_offhost* (never the staging or the API Droplet's key); the host key PINNED beforehand
#     (StrictHostKeyChecking=yes, no trust on first use); the host identity must say AICC_ENV=production with this host name AND the id given in --expect-id.
#
# TRANSPORT: the default key/user is the RESTRICTED pull account (install-offhost-access.sh): sshd forces every login of that account into
# /usr/local/sbin/aicc-offhost-serve, which only understands `identity`, `status`, `get <backup file>` and `ack ...`. This script therefore sends those four
# words and never `sudo cat`. (The operator key/user `aicc` does NOT work with this script any more: use a manual `ssh` for operator tasks.)
#
# ENCRYPTION AT REST ON THE MAC (security review B, F-05): with --encrypt-to <recipient certificate.pem> every verified file is stored ONLY as CMS ciphertext
#   (`<name>.cms`, AES-256, RSA >= 3072) and the plaintext temp file is deleted at once. The certificate is a PUBLIC key; its private half must live OFF the pull path
#   (the owner's password manager / an offline USB stick), never on the Mac that pulls, so a stolen or synced Mac copy is unreadable. `--env production` REQUIRES --encrypt-to.
#   Sidecars: `<name>.cms.sha256` = the PLAINTEXT sha256 (what the host's ack and status.json know), `<name>.cms.csha256` = the ciphertext's own sha256 (detects local damage).
#   Restore: `infra/backup/decrypt-offhost.sh --key <private key> --in <name>.cms --out <name>` (checks the plaintext hash).
# Fail closed:
#   * the host is NEVER guessed: --stage-ip is required, there is no default. It must be a literal IPv4 address.
#   * refuses the production API address 139.59.157.231 (and the other public addresses in the deny list), refuses any key whose file name looks like the
#     production key (aicc_digitalocean_prod*), refuses --stage-host values other than stage*.copilt.org.
#   * only the dedicated pull key is used (ssh -i KEY -o IdentitiesOnly=yes -o BatchMode=yes); no agent keys, no default identities.
#   * refuses to continue unless the host presents /etc/aicc-stage-identity with AICC_ENV=staging (production: AICC_ENV=production + the id) and AICC_HOSTNAME equal to --stage-host.
#   * file names come from the server's status.json but are re-validated against a strict pattern before use (no path traversal from a hostile server).
#   * a copy is accepted only if: sha256 of the received bytes == the server's .sha256 sidecar == the hash recorded in status.json, and gzip -t passes.
#   * writes no secrets. Note: the files archive no longer contains the rendered wp-config.php (security review F-05); it holds uploads, plugin releases and edge/ops config, and the database dump holds customer data: dest dir is 0700, files 0600, and production encrypts both (--encrypt-to). Keep this
#     folder on an encrypted disk (FileVault). --no-files-archive pulls the database dump only.
# Output files in --dest: aicc_cp-<UTC>-<label>.sql.gz(+.sha256), aicc-files-<UTC>-<label>.tar.gz(+.sha256), pull.log.
# Schedule it yourself if you want (launchd/cron); this script does not install anything.
# FREE-SPACE GUARD AND SIZE LIMITS (Production 19):
#   * --min-free-mb N (default 3072, env AICC_PULL_MIN_FREE_MB; 0 = off): the pull refuses (exit 5, nothing transferred, nothing acknowledged) when the volume holding --dest has less free,
#     measured on the nearest existing folder BEFORE --dest is created (a first run on a full volume also answers 5), and again before each real transfer when the free space would not cover
#     that floor plus 3x the size the host declares for the file (plaintext temp + ciphertext + margin).
#   * --max-total-mb N (default 3072, env AICC_PULL_MAX_TOTAL_MB; 0 = off) is an INGEST GATE per kind of file (dumps, files archives), NEVER a pruning rule: after the normal tiered retention, if the
#     bytes already kept plus the size the host declares for the new file would exceed N MiB, the pull refuses the whole set (exit 6, nothing transferred, nothing acknowledged, NOTHING DELETED).
#     Why: a cap that deleted history would let a compromised or runaway host purge the Mac's tiers by serving a few huge but well-formed sets; refusing keeps every older copy and makes the
#     condition loud (exit 6 -> immediate macOS notification, AICC Ops offhost_stale after 36 h). The owner raises the cap on purpose once the growth is understood.
#   * a file is read at most up to its declared size + 10% + 1 MiB (never more than the 2 GiB ceiling): a host that declares little and sends more is cut off with a clear error. Declared sizes are
#     untrusted text: only 1-12 plain digits are used, anything else falls back to 256 MiB for the space estimate and to the 2 GiB ceiling for the transfer.
#   * both numeric flags are plain decimals without leading zeros (08 / 0512 are refused: bash would read them as octal).
# Exit codes: 0 ok, 1 pull/verification failed, 2 usage, 3 refused by a safety rule, 4 another pull is running (skipped), 5 the Mac's volume is too full (free-space guard), 6 hard cap reached (set refused, history untouched).
set -euo pipefail
umask 077

STAGE_IP=""; STAGE_HOST=""; KEY=""; USER_NAME="aicc-offhost"; DEST=""; KEEP=""; ENVN="stage"; EXPECT_ID=""; KNOWN_HOSTS=""
WITH_FILES=1; DRY=0; ACK=1; ENC=""
MINFREE_MB="${AICC_PULL_MIN_FREE_MB:-3072}"; MAXTOTAL_MB="${AICC_PULL_MAX_TOTAL_MB:-3072}"
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
    --env) ENVN="${2:-}"; shift 2 ;;
    --expect-id) EXPECT_ID="${2:-}"; shift 2 ;;
    --known-hosts) KNOWN_HOSTS="${2:-}"; shift 2 ;;
    --no-files-archive) WITH_FILES=0; shift ;;
    --no-ack) ACK=0; shift ;;
    --encrypt-to) ENC="${2:-}"; shift 2 ;;
    --min-free-mb) [ $# -ge 2 ] || { echo "--min-free-mb needs a value" >&2; exit 2; }; MINFREE_MB="$2"; shift 2 ;;
    --max-total-mb) [ $# -ge 2 ] || { echo "--max-total-mb needs a value" >&2; exit 2; }; MAXTOTAL_MB="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,27p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 3; }
case "$ENVN" in stage|production) ;; *) echo "--env must be stage or production" >&2; exit 2 ;; esac
if [ "$ENVN" = production ]; then
  [ -n "$STAGE_HOST" ] || STAGE_HOST="www.copilt.org"
  [ -n "$KEY" ] || KEY="$HOME/.ssh/aicc_cp_prod_offhost"
  [ -n "$DEST" ] || DEST="$HOME/aicc-offhost-backups-production"
  [ -n "$KNOWN_HOSTS" ] || KNOWN_HOSTS="$HOME/.ssh/known_hosts_aicc_prod_cp"
else
  [ -n "$STAGE_HOST" ] || STAGE_HOST="stage.copilt.org"
  [ -n "$KEY" ] || KEY="$HOME/.ssh/aicc_cp_stage_offhost"
  [ -n "$DEST" ] || DEST="$HOME/aicc-offhost-backups-stage"
fi
[ -n "$STAGE_IP" ] || { echo "usage: $0 --stage-ip <ipv4> [options]  (the host is never guessed)" >&2; exit 2; }
[[ "$STAGE_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || refuse "--stage-ip must be a literal IPv4 address"
for d in $DENY_IPS; do [ "$STAGE_IP" = "$d" ] && refuse "$STAGE_IP is a production/public address, not the staging Droplet."; done
aicc_ip_guard "$STAGE_IP" "--stage-ip " || exit 3
if [ "$ENVN" = production ]; then
  [ "$STAGE_HOST" = "www.copilt.org" ] || refuse "--env production pulls from the host named exactly www.copilt.org (got $STAGE_HOST)"
  [[ "$EXPECT_ID" =~ ^[0-9a-f]{32}$ ]] || refuse "--env production needs --expect-id <the 32-hex id from the host identity>: it binds the pull to THIS machine"
  case "$(basename "$KEY")" in aicc_cp_prod_offhost*) ;; *) refuse "the production pull key must be named aicc_cp_prod_offhost* (got $(basename "$KEY"))" ;; esac
  [ -s "$KNOWN_HOSTS" ] || refuse "--env production needs a PINNED known-hosts file ($KNOWN_HOSTS): no trust on first use for the host that holds customer data"
  ssh-keygen -F "$STAGE_IP" -f "$KNOWN_HOSTS" >/dev/null 2>&1 || refuse "the pinned known-hosts file has no entry for $STAGE_IP"
else
  [[ "$STAGE_HOST" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || refuse "--stage-host must look like stage.copilt.org (production names are refused)"
  case "$STAGE_HOST" in www.copilt.org|copilt.org|api.copilt.org) refuse "$STAGE_HOST is a production hostname." ;; esac
  case "$(basename "$KEY")" in aicc_cp_prod*) refuse "the production pull key is not used for staging." ;; esac
fi
case "$(basename "$KEY")" in aicc_digitalocean_prod*) refuse "never use the production key." ;; esac
case "$KEY" in *aicc_digitalocean_prod*) refuse "never use the production key." ;; esac
[ -f "$KEY" ] || { echo "no such key file: $KEY" >&2; exit 2; }
grep -q "PRIVATE KEY" "$KEY" 2>/dev/null || refuse "$KEY is not a private key file"
[[ "$USER_NAME" =~ ^[a-z][a-z0-9_-]{0,31}$ ]] || refuse "bad --user"
if [ "$ENVN" = production ] && [ -z "$ENC" ]; then refuse "--env production requires --encrypt-to <recipient certificate>: customer data and licence records must not rest in plaintext on the Mac (generate the key pair OFF the Mac; docs: infra/backup/README-backup.md 'Encrypted off-host copies')"; fi
if [ -n "$ENC" ]; then
  [ -f "$ENC" ] && grep -q 'BEGIN CERTIFICATE' "$ENC" || refuse "--encrypt-to must be a PEM certificate file"
  if grep -q 'PRIVATE KEY' "$ENC"; then refuse "$ENC contains a PRIVATE KEY: the private half must never be on the pull path (give only the certificate)"; fi
  command -v openssl >/dev/null 2>&1 || refuse "openssl is required for --encrypt-to"
  openssl x509 -in "$ENC" -noout -checkend 86400 >/dev/null 2>&1 || refuse "the recipient certificate is unreadable or expires within a day"
  bits="$(openssl x509 -in "$ENC" -noout -text 2>/dev/null | sed -n 's/.*Public-Key: (\([0-9]*\) bit).*/\1/p' | head -1)"
  { [ -n "$bits" ] && [ "$bits" -ge 3072 ] && openssl x509 -in "$ENC" -noout -text 2>/dev/null | grep -q 'rsaEncryption'; } || refuse "the recipient certificate must hold an RSA key of at least 3072 bits (has '${bits:-unknown}')"
  case "$ENC" in /*) ;; *) refuse "--encrypt-to must be an absolute path" ;; esac
fi
[ -z "$KEEP" ] || { [[ "$KEEP" =~ ^[0-9]+$ ]] && [ "$KEEP" -ge 2 ]; } || { echo "--keep must be a number >= 2" >&2; exit 2; }
[[ "$MINFREE_MB" =~ ^(0|[1-9][0-9]{0,8})$ ]] || { echo "--min-free-mb must be a plain decimal number without leading zeros (MiB; 0 = guard off)" >&2; exit 2; }
[[ "$MAXTOTAL_MB" =~ ^(0|[1-9][0-9]{0,8})$ ]] || { echo "--max-total-mb must be a plain decimal number without leading zeros (MiB; 0 = no cap)" >&2; exit 2; }
[[ "$DEST" == /* ]] || { echo "--dest must be an absolute path" >&2; exit 2; }

if [ "$ENVN" = production ]; then KH="$KNOWN_HOSTS"; SHK=yes; else KH="$HOME/.ssh/known_hosts_aicc_stage"; SHK=accept-new; fi
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking="$SHK" -o UserKnownHostsFile="$KH" -o ServerAliveInterval=15 "$USER_NAME@$STAGE_IP")
rem() { "${SSH[@]}" "$@"; }
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
LOG="$DEST/pull.log"
# everything the server can influence is printable ASCII only and short before it reaches a log (no escape sequences, no log injection)
clean() { printf '%s' "$*" | LC_ALL=C tr -cd '\040-\176' | cut -c1-300; }
say() { local m; m="$(clean "$*")"; echo "$(ts)  $m"; [ "$DRY" = 1 ] || echo "$(ts)  $m" >> "$LOG"; }
MAX_BYTES=$((2 * 1024 * 1024 * 1024)); case "${AICC_PULL_MAX_BYTES:-}" in ""|*[!0-9]*) ;; *) MAX_BYTES="$AICC_PULL_MAX_BYTES" ;; esac   # the variable can only LOWER the ceiling in practice (tests)   # a backup set member larger than this is refused (a hostile host cannot fill the Mac's disk)
# bounded transfer: at most MAX_BYTES and at most 900 s wall clock (perl alarm when available; ssh ServerAlive* already kills a dead link)
bounded() { local lim="$1"; shift; if command -v perl >/dev/null 2>&1; then perl -e 'alarm 900; exec @ARGV' -- "$@" | head -c "$lim"; else "$@" | head -c "$lim"; fi; }
sha_of() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; else sha256sum "$1" | awk '{print $1}'; fi; }

# retention. Default (tiered, matches an HOURLY backup): every set of the last 24 h, the newest set of each UTC day for 14 days, the newest of each ISO week for 8 weeks, and
# never fewer than the newest 3. `--keep N` = simply the newest N of each kind. Only files matching our name patterns are touched; the timestamp in the name decides.
# Names are matched with fnmatch on a directory listing (never glob on the path), so a --dest containing [ ] * ? is pruned like any other. Runs before the transfer (so the cap sees only what the
# policy keeps; it depends on time only, not on the new set) and after the ack.
prune_old() {
python3 -I - "$DEST" "$KEEP" > "$DEST/.prune.list" <<'PY'
import datetime, fnmatch, os, re, sys
d, keep = sys.argv[1], sys.argv[2]
now = datetime.datetime.now(datetime.timezone.utc)
rx = re.compile(r"-(\d{8}T\d{6}Z)-")
names = os.listdir(d)
for pat in ("aicc_cp-*.sql.gz", "aicc_cp-*.sql.gz.cms", "aicc-files-*.tar.gz", "aicc-files-*.tar.gz.cms"):
    files = sorted((os.path.join(d, n) for n in names if fnmatch.fnmatchcase(n, pat)), reverse=True)
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
  case "$(basename "$old")" in aicc_cp-*.sql.gz|aicc-files-*.tar.gz|aicc_cp-*.sql.gz.cms|aicc-files-*.tar.gz.cms) rm -f -- "$old" "$old.sha256" "${old%.cms}.cms.csha256" "$old.csha256"; say "pruned $(basename "$old")" ;; esac
done < "$DEST/.prune.list"
rm -f "$DEST/.prune.list"
}
# bytes already stored for one kind of file (arguments = fnmatch patterns); python only lists the folder, no glob on the path
kind_bytes() {
python3 -I - "$DEST" "$@" <<'PY'
import fnmatch, os, sys
d, t = sys.argv[1], 0
for n in os.listdir(d):
    if any(fnmatch.fnmatchcase(n, p) for p in sys.argv[2:]):
        try:
            t += os.path.getsize(os.path.join(d, n))
        except OSError:
            pass
print(t)
PY
}
# INGEST GATE (not a pruning rule): taking this file must not push its kind over --max-total-mb. Refuses with exit 6 and deletes NOTHING.
cap_check() { # cap_check <name> <declared bytes>
  local name="$1" eb="${2:-}" store="$1" cur p1 p2
  [ "$MAXTOTAL_MB" -gt 0 ] || return 0
  [ -z "$ENC" ] || store="$1.cms"
  [ ! -f "$DEST/$store" ] || return 0                       # already stored: adds nothing
  [[ "$eb" =~ ^[0-9]{1,12}$ ]] || eb=268435456
  case "$name" in aicc_cp-*) p1='aicc_cp-*.sql.gz'; p2='aicc_cp-*.sql.gz.cms' ;; *) p1='aicc-files-*.tar.gz'; p2='aicc-files-*.tar.gz.cms' ;; esac
  cur="$(kind_bytes "$p1" "$p2")"
  if [ $(( cur + eb )) -gt $(( MAXTOTAL_MB * 1024 * 1024 )) ]; then
    say "FAILURE hard cap reached for this kind of file: $(( cur / 1048576 )) MiB already kept + $(( eb / 1048576 )) MiB declared for $name > $MAXTOTAL_MB MiB. The set was NOT taken, nothing was deleted, nothing acknowledged. Check the host for a runaway dump; raise --max-total-mb only on purpose"
    exit 6
  fi
}
if [ "$DRY" = 1 ]; then
  echo "DRY-RUN: would ssh $USER_NAME@$STAGE_IP with key $KEY, verify the $ENVN identity ($STAGE_HOST), read the backup status,"
  echo "         pull the newest dump$([ $WITH_FILES = 1 ] && echo ' and files archive') with sha256 verification into $DEST, keep $KEEP copies."
  exit 0
fi
# free space on the volume that holds --dest (KiB), read on the nearest EXISTING folder so a first run on a full volume is judged before mkdir; empty when df cannot tell (the guard then stays silent
# rather than blocking every pull)
free_kb() { local p="$DEST"; while [ ! -e "$p" ] && [ "$p" != "/" ]; do p="$(dirname "$p")"; done; df -Pk "$p" 2>/dev/null | awk 'NR==2 && $4 ~ /^[0-9]+$/ {print $4}'; }
if [ "$MINFREE_MB" -gt 0 ]; then   # checked BEFORE mkdir, the lock and ssh: on a 100% full volume even the lock directory cannot be created
  fk="$(free_kb)"
  if [ -n "$fk" ] && [ "$fk" -lt $(( MINFREE_MB * 1024 )) ]; then
    m="FAILURE the Mac volume holding $DEST has $(( fk / 1024 )) MiB free, below the floor of $MINFREE_MB MiB: nothing was pulled and nothing acknowledged (free space, then re-run)"
    echo "$(ts)  $m" >&2; { [ ! -f "$LOG" ] || echo "$(ts)  $m" >> "$LOG"; } 2>/dev/null || true; exit 5
  fi
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

ident="$(rem 'identity' 2>/dev/null)" || { say "FAILURE cannot ssh to the $ENVN host"; exit 1; }
if [ "$ENVN" = production ]; then WANT_ENV=production; else WANT_ENV=staging; fi
echo "$ident" | grep -q "^AICC_ENV=${WANT_ENV}\$" || refuse "host does not present AICC_ENV=$WANT_ENV in /etc/aicc-stage-identity"
echo "$ident" | grep -q "^AICC_HOSTNAME=${STAGE_HOST}\$" || refuse "host identity AICC_HOSTNAME does not equal $STAGE_HOST"
if [ "$ENVN" = production ]; then echo "$ident" | grep -q "^AICC_STAGE_ID=${EXPECT_ID}\$" || refuse "host identity id does not equal --expect-id (a different machine, or a host that was re-provisioned)"; fi

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

dbytes="$(echo "$status" | jq -r --arg f "$dump" 'if .db_dump.file == $f then (.db_dump.bytes | tostring) else empty end')"
fbytes="$(echo "$status" | jq -r --arg f "$farc" 'if .files_archive.file == $f then (.files_archive.bytes | tostring) else empty end')"
# the cap is judged on what the TIER POLICY keeps (prune first), for both members of the set before either is transferred, so a refusal never leaves half a set
prune_old
cap_check "$dump" "$dbytes"
if [ "$WITH_FILES" = 1 ]; then cap_check "$farc" "$fbytes"; fi
PULLED_SHA=""
pull_one() { # pull_one <name> <sha-from-status> <bytes-from-status>; sets PULLED_SHA = the PLAINTEXT sha256 of what is stored
  local name="$1" want="$2" tmp="$DEST/$1.partial" side got sc store="$1" csha xrc decl="${3:-}" eb fk need_kb lim="$MAX_BYTES" l2
  [[ "$decl" =~ ^[0-9]{1,12}$ ]] || decl=""
  eb="${decl:-268435456}"      # the host's declared size is untrusted text: only plain digits are used, else 256 MiB is assumed for the space estimate
  [ -z "$ENC" ] || store="$1.cms"
  if [ -z "$ENC" ]; then
    if [ -f "$DEST/$name" ] && [ -f "$DEST/$name.sha256" ] && [ "$(sha_of "$DEST/$name")" = "$want" ]; then PULLED_SHA="$want"; say "already have $name (checksum verified)"; return 0; fi
  else
    if [ -f "$DEST/$store" ] && [ -f "$DEST/$store.sha256" ] && [ -f "$DEST/$store.csha256" ] && [ -n "$want" ] && [ "$(awk '{print $1}' "$DEST/$store.sha256")" = "$want" ] \
       && [ "$(sha_of "$DEST/$store")" = "$(awk '{print $1}' "$DEST/$store.csha256")" ]; then PULLED_SHA="$want"; say "already have $name (encrypted copy, ciphertext checksum verified)"; return 0; fi
  fi
  if [ -n "$decl" ]; then l2=$(( decl + decl / 10 + 1048576 )); [ "$l2" -ge "$lim" ] || lim="$l2"; fi   # never read more than declared + 10% + 1 MiB (nor the 2 GiB ceiling)
  if [ "$MINFREE_MB" -gt 0 ]; then
    need_kb=$(( MINFREE_MB * 1024 + 3 * (eb / 1024 + 1) )); fk="$(free_kb)"
    if [ -n "$fk" ] && [ "$fk" -lt "$need_kb" ]; then say "FAILURE not enough free space for $name: $(( fk / 1024 )) MiB free, need $(( need_kb / 1024 )) MiB (floor $MINFREE_MB MiB + 3x the declared size); nothing transferred"; exit 5; fi
  fi
  # the reader stops at $lim bytes, which makes the sending ssh fail with SIGPIPE: judge by the size first, so the error says what really happened
  xrc=0; bounded "$lim" "${SSH[@]}" "get $name" > "$tmp" || xrc=$?
  if [ "$(wc -c < "$tmp" 2>/dev/null | tr -d ' ' || true)" -ge "$lim" ] 2>/dev/null; then rm -f "$tmp"; say "FAILURE $name reached its size limit of $lim bytes (declared ${decl:-unknown} + 10% + 1 MiB, at most the 2 GiB ceiling): cut off, nothing kept"; return 1; fi
  if [ "$xrc" -ne 0 ]; then rm -f "$tmp"; say "FAILURE transfer of $name"; return 1; fi
  side="$(rem "get $name.sha256" 2>/dev/null | head -c 200 | awk '{print $1}' | head -1)"
  [[ "$side" =~ ^[0-9a-f]{64}$ ]] || { rm -f "$tmp"; say "FAILURE bad sidecar hash for $name"; return 1; }
  got="$(sha_of "$tmp")"
  if [ "$got" != "$side" ]; then rm -f "$tmp"; say "FAILURE checksum mismatch for $name (received $got, server sidecar '${side:-none}')"; return 1; fi
  if [ -n "$want" ] && [ "$got" != "$want" ]; then rm -f "$tmp"; say "FAILURE $name differs from the hash recorded in status.json"; return 1; fi
  gzip -t "$tmp" || { rm -f "$tmp"; say "FAILURE gzip -t failed for $name"; return 1; }
  if [ -z "$ENC" ]; then
    mv -f "$tmp" "$DEST/$name"; chmod 600 "$DEST/$name"
    printf '%s  %s\n' "$got" "$name" > "$DEST/$name.sha256"; chmod 600 "$DEST/$name.sha256"
  else
    # verified plaintext -> ciphertext, then the plaintext temp is destroyed; only the PUBLIC certificate is needed here
    if ! openssl cms -encrypt -binary -aes-256-cbc -outform DER -in "$tmp" -out "$DEST/$store.partial" "$ENC" 2>/dev/null || [ ! -s "$DEST/$store.partial" ]; then rm -f "$tmp" "$DEST/$store.partial"; say "FAILURE encryption of $name"; return 1; fi
    rm -f "$tmp"
    chmod 600 "$DEST/$store.partial"; mv -f "$DEST/$store.partial" "$DEST/$store"
    csha="$(sha_of "$DEST/$store")"
    printf '%s  %s\n' "$got" "$name" > "$DEST/$store.sha256"; chmod 600 "$DEST/$store.sha256"
    printf '%s  %s\n' "$csha" "$store" > "$DEST/$store.csha256"; chmod 600 "$DEST/$store.csha256"
  fi
  PULLED_SHA="$got"
  sc="$(wc -c < "$DEST/$store" | tr -d ' ')"
  say "SUCCESS pulled $name ($sc bytes$([ -n "$ENC" ] && echo ', stored encrypted')), checksum verified"
}
pull_one "$dump" "$want_dump" "$dbytes" || exit 1; DSHA_P="$PULLED_SHA"
if [ "$WITH_FILES" = 1 ]; then pull_one "$farc" "$want_farc" "$fbytes" || exit 1; FSHA_P="$PULLED_SHA"; fi

# Tell the host a verified copy now exists off-host (AICC Ops alerts when this ack goes stale). The host re-checks the hashes against its own sidecars.
set_ts="$(echo "$dump" | sed -n 's/^aicc_cp-\([0-9]\{8\}T[0-9]\{6\}Z\)-.*/\1/p')"
if [ "$ACK" = 1 ]; then
  dsha="$DSHA_P"; if [ "$WITH_FILES" = 1 ]; then fname="$farc"; fsha="$FSHA_P"; else fname="-"; fsha="-"; fi
  if rem "ack $set_ts $dump $dsha $fname $fsha" >/dev/null 2>&1; then say "SUCCESS host acknowledged the off-host copy of set $set_ts"
  else say "FAILURE the host did not accept the ack (the copy itself is verified and kept)"; exit 1; fi
fi
date -u +%s > "$DEST/.last-ok"; chmod 600 "$DEST/.last-ok"

prune_old
say "off-host pull finished ok"
