#!/usr/bin/env bash
# The ONLY thing the owner's Mac may do on the host. Installed as /usr/local/sbin/aicc-offhost-serve and reached through sshd's ForceCommand for the
# dedicated account `aicc-offhost` (see install-offhost-access.sh): the Mac's unattended pull key can run exactly these operations and nothing else.
#
#   identity                         prints /etc/aicc-stage-identity
#   status                           prints /srv/aicc/backups/status.json
#   get <file>                       streams one backup file or its .sha256 sidecar (names validated against a strict pattern)
#   ack <set_ts> <dump> <dump_sha256> <files|-> <files_sha256|->
#                                    records that a verified copy of that set is now OFF this host (offhost-ack.json, read by AICC Ops).
#                                    The hashes must equal the host's own .sha256 sidecars: an ack cannot name a set that does not exist.
#
# The command text arrives as ONE argument ($1 = $SSH_ORIGINAL_COMMAND). It is split on spaces, never evaluated, never passed to a shell.
# Everything is logged to the journal (tag aicc-offhost-serve): operation and file name only, never file contents.
# Test seams (only with AICC_TEST_HARNESS=1): AICC_BACKUP_DIR, AICC_IDENTITY_FILE.
set -euo pipefail
umask 022
BACKUP_DIR="/srv/aicc/backups"; IDENT="/etc/aicc-stage-identity"
if [ "${AICC_TEST_HARNESS:-0}" = "1" ]; then BACKUP_DIR="${AICC_BACKUP_DIR:-$BACKUP_DIR}"; IDENT="${AICC_IDENTITY_FILE:-$IDENT}"; fi
log() { logger -t aicc-offhost-serve -- "$*" 2>/dev/null || true; }
deny() { log "DENIED: $1"; echo "aicc-offhost-serve: refused: $1" >&2; exit 3; }

CMD="${1:-}"
[ -n "$CMD" ] || deny "no command (interactive sessions are not allowed)"
case "$CMD" in *[!A-Za-z0-9._\ -]*) deny "unexpected characters in the command" ;; esac
[ "${#CMD}" -le 400 ] || deny "command too long"
read -r -a ARGV <<<"$CMD"
OP="${ARGV[0]:-}"

NAME_RE='^(aicc_cp|aicc-files)-[0-9]{8}T[0-9]{6}Z-(scheduled|pre-release|manual)\.(sql\.gz|tar\.gz)(\.sha256)?$'
SET_RE='^[0-9]{8}T[0-9]{6}Z$'
SHA_RE='^[0-9a-f]{64}$'

case "$OP" in
  identity)
    [ "${#ARGV[@]}" -eq 1 ] || deny "identity takes no arguments"
    cat "$IDENT" ;;
  status)
    [ "${#ARGV[@]}" -eq 1 ] || deny "status takes no arguments"
    cat "$BACKUP_DIR/status.json" ;;
  get)
    [ "${#ARGV[@]}" -eq 2 ] || deny "get needs exactly one file name"
    f="${ARGV[1]}"
    [[ "$f" =~ $NAME_RE ]] || deny "file name not allowed: $f"
    [ -f "$BACKUP_DIR/$f" ] && [ ! -L "$BACKUP_DIR/$f" ] || deny "no such backup file: $f"
    log "get $f"
    cat "$BACKUP_DIR/$f" ;;
  ack)
    [ "${#ARGV[@]}" -eq 6 ] || deny "ack needs: set_ts dump dump_sha256 files|- files_sha256|-"
    set_ts="${ARGV[1]}"; dump="${ARGV[2]}"; dsha="${ARGV[3]}"; files="${ARGV[4]}"; fsha="${ARGV[5]}"
    [[ "$set_ts" =~ $SET_RE ]] || deny "bad set timestamp"
    [[ "$dump" =~ $NAME_RE && "$dump" == *.sql.gz ]] || deny "bad dump name"
    [[ "$dump" != *.sha256 ]] || deny "bad dump name"
    [[ "$dsha" =~ $SHA_RE ]] || deny "bad dump hash"
    case "$dump" in *"-$set_ts-"*) ;; *) deny "dump does not belong to set $set_ts" ;; esac
    real="$(awk '{print $1}' "$BACKUP_DIR/$dump.sha256" 2>/dev/null | head -1 || true)"
    [ "$real" = "$dsha" ] || deny "dump hash differs from the host's own sidecar"
    if [ "$files" = "-" ]; then
      [ "$fsha" = "-" ] || deny "files hash must be - when files is -"
    else
      [[ "$files" =~ $NAME_RE && "$files" == *.tar.gz && "$files" != *.sha256 ]] || deny "bad files name"
      [[ "$fsha" =~ $SHA_RE ]] || deny "bad files hash"
      case "$files" in *"-$set_ts-"*) ;; *) deny "files archive does not belong to set $set_ts" ;; esac
      realf="$(awk '{print $1}' "$BACKUP_DIR/$files.sha256" 2>/dev/null | head -1 || true)"
      [ "$realf" = "$fsha" ] || deny "files hash differs from the host's own sidecar"
    fi
    now="$(date -u +%s)"
    tmp="$(mktemp "$BACKUP_DIR/.ack.XXXXXX")"
    jq -n -c --argjson at "$now" --arg st "$set_ts" --arg d "$dump" --arg ds "$dsha" --arg f "$files" --arg fs "$fsha" \
      '{schema:1,acked_at:$at,set_ts:$st,dump:$d,dump_sha256:$ds,files:$f,files_sha256:$fs,puller:"mac-pull",verified:true}' > "$tmp"
    chmod 644 "$tmp"; mv -f "$tmp" "$BACKUP_DIR/offhost-ack.json"
    log "ack set=$set_ts"
    echo "ack recorded for set $set_ts" ;;
  *) deny "unknown operation '$OP' (allowed: identity, status, get, ack)" ;;
esac
