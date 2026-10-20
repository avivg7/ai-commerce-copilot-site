#!/usr/bin/env bash
# OFF-HOST backup pull. Runs ON THE OWNER'S MAC (not on the server). Pulls the latest database dump + files archive of the STAGING Control Plane over SSH,
# verifies the checksums, keeps the 14 newest copies. Modeled on the proven API-host pull (Backend repo docs/digitalocean-infrastructure.md section 14,
# ~/aicc-offhost-backup-pull.sh): a PULL, so the server holds no credentials for the Mac and a compromised server cannot delete the Mac's copies.
#
#   infra/backup/pull-offhost.sh --stage-ip <IPV4> [--stage-host stage.copilt.org] [--key ~/.ssh/aicc_cp_stage] [--user aicc]
#                                [--dest ~/aicc-offhost-backups-stage] [--keep 14] [--no-files-archive] [--dry-run]
#
# Fail closed:
#   * the host is NEVER guessed: --stage-ip is required, there is no default. It must be a literal IPv4 address.
#   * refuses the production API address 139.59.157.231 (and the other public addresses in the deny list), refuses any key whose file name looks like the
#     production key (aicc_digitalocean_prod*), refuses --stage-host values other than stage*.copilt.org.
#   * only the dedicated stage key is used (ssh -i KEY -o IdentitiesOnly=yes -o BatchMode=yes); no agent keys, no default identities.
#   * refuses to continue unless the host presents /etc/aicc-stage-identity with AICC_ENV=staging (and AICC_HOSTNAME equal to --stage-host).
#   * file names come from the server's status.json but are re-validated against a strict pattern before use (no path traversal from a hostile server).
#   * a copy is accepted only if: sha256 of the received bytes == the server's .sha256 sidecar == the hash recorded in status.json, and gzip -t passes.
#   * writes no secrets. Note: the files archive contains the host's wp-config.php (DB password, salts) and uploads: dest dir is 0700, files 0600. Keep this
#     folder on an encrypted disk (FileVault). --no-files-archive pulls the database dump only.
# Output files in --dest: aicc_cp-<UTC>-<label>.sql.gz(+.sha256), aicc-files-<UTC>-<label>.tar.gz(+.sha256), pull.log.
# Schedule it yourself if you want (launchd/cron); this script does not install anything.
# Exit codes: 0 ok, 1 pull/verification failed, 2 usage, 3 refused by a safety rule.
set -euo pipefail
umask 077

STAGE_IP=""; STAGE_HOST="stage.copilt.org"; KEY="$HOME/.ssh/aicc_cp_stage"; USER_NAME="aicc"; DEST="$HOME/aicc-offhost-backups-stage"; KEEP=14
WITH_FILES=1; DRY=0; REMOTE_DIR="/srv/aicc/backups"
DENY_IPS="139.59.157.231 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153"
while [ $# -gt 0 ]; do
  case "$1" in
    --stage-ip) STAGE_IP="${2:-}"; shift 2 ;;
    --stage-host) STAGE_HOST="${2:-}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;;
    --user) USER_NAME="${2:-}"; shift 2 ;;
    --dest) DEST="${2:-}"; shift 2 ;;
    --keep) KEEP="${2:-}"; shift 2 ;;
    --no-files-archive) WITH_FILES=0; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,24p "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 3; }
[ -n "$STAGE_IP" ] || { echo "usage: $0 --stage-ip <ipv4> [options]  (the host is never guessed)" >&2; exit 2; }
[[ "$STAGE_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || refuse "--stage-ip must be a literal IPv4 address"
for d in $DENY_IPS; do [ "$STAGE_IP" = "$d" ] && refuse "$STAGE_IP is a production/public address, not the staging Droplet."; done
[[ "$STAGE_HOST" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || refuse "--stage-host must look like stage.copilt.org (production names are refused)"
case "$STAGE_HOST" in www.copilt.org|copilt.org|api.copilt.org) refuse "$STAGE_HOST is a production hostname." ;; esac
case "$(basename "$KEY")" in aicc_digitalocean_prod*) refuse "never use the production key." ;; esac
case "$KEY" in *aicc_digitalocean_prod*) refuse "never use the production key." ;; esac
[ -f "$KEY" ] || { echo "no such key file: $KEY" >&2; exit 2; }
grep -q "PRIVATE KEY" "$KEY" 2>/dev/null || refuse "$KEY is not a private key file"
[[ "$USER_NAME" =~ ^[a-z][a-z0-9_-]{0,31}$ ]] || refuse "bad --user"
[[ "$KEEP" =~ ^[0-9]+$ ]] && [ "$KEEP" -ge 2 ] || { echo "--keep must be a number >= 2" >&2; exit 2; }
[[ "$DEST" == /* ]] || { echo "--dest must be an absolute path" >&2; exit 2; }

KH="$HOME/.ssh/known_hosts_aicc_stage"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$KH" -o ServerAliveInterval=15 "$USER_NAME@$STAGE_IP")
rem() { "${SSH[@]}" "$@"; }
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
LOG="$DEST/pull.log"
say() { echo "$(ts)  $*"; [ "$DRY" = 1 ] || echo "$(ts)  $*" >> "$LOG"; }
sha_of() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'; else sha256sum "$1" | awk '{print $1}'; fi; }

if [ "$DRY" = 1 ]; then
  echo "DRY-RUN: would ssh $USER_NAME@$STAGE_IP with key $KEY, verify the staging identity ($STAGE_HOST), read $REMOTE_DIR/status.json,"
  echo "         pull the newest dump$([ $WITH_FILES = 1 ] && echo ' and files archive') with sha256 verification into $DEST, keep $KEEP copies."
  exit 0
fi
mkdir -p "$DEST"; chmod 700 "$DEST"; : >> "$LOG"; chmod 600 "$LOG"

ident="$(rem 'cat /etc/aicc-stage-identity' 2>/dev/null)" || { say "FAILURE cannot ssh to the staging host"; exit 1; }
echo "$ident" | grep -q '^AICC_ENV=staging$' || refuse "host does not present AICC_ENV=staging in /etc/aicc-stage-identity"
echo "$ident" | grep -q "^AICC_HOSTNAME=${STAGE_HOST}\$" || refuse "host identity AICC_HOSTNAME does not equal $STAGE_HOST"

status="$(rem "sudo cat $REMOTE_DIR/status.json" 2>/dev/null)" || { say "FAILURE cannot read status.json"; exit 1; }
[ "$(echo "$status" | jq -r '.status')" = "ok" ] || { say "FAILURE latest backup run on the host did not finish ok: $(echo "$status" | jq -r '.reason')"; exit 1; }
dump="$(echo "$status" | jq -r '.last_success.db_dump_file // empty')"
farc="$(echo "$status" | jq -r '.last_success.files_archive_file // empty')"
[[ "$dump" =~ ^aicc_cp-[0-9]{8}T[0-9]{6}Z-(scheduled|pre-release|manual)\.sql\.gz$ ]] || { say "FAILURE unexpected dump file name from server: '$dump'"; exit 1; }
if [ "$WITH_FILES" = 1 ]; then [[ "$farc" =~ ^aicc-files-[0-9]{8}T[0-9]{6}Z-(scheduled|pre-release|manual)\.tar\.gz$ ]] || { say "FAILURE unexpected archive file name from server: '$farc'"; exit 1; }; fi
if [ "$status" != "" ]; then
  fin="$(echo "$status" | jq -r '.last_success.finished_epoch // 0')"; age=$(( $(date -u +%s) - fin ))
  say "server's latest good backup is ${age}s old ($dump)"
  [ "$age" -le $((26 * 3600)) ] || say "WARNING that backup is older than 26 hours: the server's backup job may be stale"
fi

# the server records the sha256 of every file it wrote; pick it for the dump (and the archive) from status.json
want_dump="$(echo "$status" | jq -r 'if .db_dump.file == "'"$dump"'" then .db_dump.sha256 else empty end')"
want_farc="$(echo "$status" | jq -r 'if .files_archive.file == "'"$farc"'" then .files_archive.sha256 else empty end')"

pull_one() { # pull_one <name> <sha-from-status>
  local name="$1" want="$2" tmp="$DEST/$1.partial" side got sc
  if [ -f "$DEST/$name" ] && [ -f "$DEST/$name.sha256" ] && [ "$(sha_of "$DEST/$name")" = "$want" ]; then say "already have $name (checksum verified)"; return 0; fi
  rem "sudo cat $REMOTE_DIR/$name" > "$tmp" || { rm -f "$tmp"; say "FAILURE transfer of $name"; return 1; }
  side="$(rem "sudo cat $REMOTE_DIR/$name.sha256" 2>/dev/null | awk '{print $1}' | head -1)"
  got="$(sha_of "$tmp")"
  if [ -z "$side" ] || [ "$got" != "$side" ]; then rm -f "$tmp"; say "FAILURE checksum mismatch for $name (received $got, server sidecar '${side:-none}')"; return 1; fi
  if [ -n "$want" ] && [ "$got" != "$want" ]; then rm -f "$tmp"; say "FAILURE $name differs from the hash recorded in status.json"; return 1; fi
  gzip -t "$tmp" || { rm -f "$tmp"; say "FAILURE gzip -t failed for $name"; return 1; }
  mv -f "$tmp" "$DEST/$name"; chmod 600 "$DEST/$name"
  printf '%s  %s\n' "$got" "$name" > "$DEST/$name.sha256"; chmod 600 "$DEST/$name.sha256"
  sc="$(wc -c < "$DEST/$name" | tr -d ' ')"
  say "SUCCESS pulled $name ($sc bytes), checksum verified"
}
pull_one "$dump" "$want_dump" || exit 1
if [ "$WITH_FILES" = 1 ]; then pull_one "$farc" "$want_farc" || exit 1; fi

# retention: newest $KEEP of each kind (names sort chronologically because of the UTC timestamp); only files matching our patterns are touched
prune() { # prune <pattern>
  # shellcheck disable=SC2012
  { ls -1 "$DEST"/$1 2>/dev/null || true; } | sort -r | tail -n +$((KEEP + 1)) | while IFS= read -r old; do rm -f -- "$old" "$old.sha256"; say "pruned $(basename "$old")"; done
}
prune 'aicc_cp-*.sql.gz'
prune 'aicc-files-*.tar.gz'
say "off-host pull finished ok"
