#!/usr/bin/env bash
# AICC Control Plane RESTORE (staging host now, production later). Installed as /usr/local/sbin/aicc-restore. Runs ON THE HOST as root.
# The documented restore procedure (README-backup.md) as one verified, TIMED tool, so a disaster-recovery drill measures real steps and the same
# command is what an operator types in a real incident.
#
#   sudo aicc-restore fingerprint --out FILE                      per-table row count + CHECKSUM TABLE of the live database (data-correctness proof)
#   sudo aicc-restore verify   --dump FILE [--files FILE] --sha256 H [--files-sha256 H]       checks only (hashes, gzip, trailer, archive member types/paths/identity); changes nothing
#   sudo aicc-restore scratch  --dump FILE [--sha256 H] [--scratch-db aicc_dr_scratch] [--fingerprint-out FILE]
#                                                                 load the dump into a SCRATCH database next to the live one, fingerprint it, drop it.
#                                                                 The live database, files and services are never touched.
#   sudo aicc-restore live --dump FILE --files FILE|none --sha256 H --files-sha256 H --yes-replace-live
#                          [--report FILE] [--no-safety-backup] [--no-health-gate] [--trust-sidecar] [--allow-no-identity] [--allow-new-host-id]
#   PRODUCTION HOST (identity AICC_ENV=production): every action needs --production, `live` also needs --confirm-production-restore. The tool is otherwise identical; the flag exists so that
#   a restore typed from staging muscle memory (no flag) is refused on the production host, and a --production restore is refused on a staging host.
#                                                                 REPLACES the live database (and files): see the steps below.
#
# TRUST: for `live` the two hashes MUST be given out of band (--sha256, --files-sha256: take them from the copy that lives OFF the host, e.g. the Mac's
# .sha256 files). A sidecar next to the data proves nothing against someone who can alter the data (--trust-sidecar accepts it anyway, loudly).
# live steps (each is timed; the report is JSON):
#   verify          sha256, gzip -t, "-- Dump completed" trailer; archive listing: only regular files and directories under the allowed roots (no links, devices, absolute or ..
#                   names); the archive must say it was taken on THIS host (host_identity in pointers.txt); a scratch load of the dump into aicc_dr_live_check BEFORE anything is dropped
#   safety_backup   aicc-backup --label manual  (what exists now is never destroyed without a copy; --no-safety-backup only for a drill that already has one)
#   quiesce         stop aicc-wp-cron.timer/service and php8.3-fpm (no writer while the database is replaced)
#   db_restore      DROP/CREATE the database, load the dump as root over the socket (definers kept), re-grant the application user
#   files_restore   extract uploads, plugin-releases (only if the archive has them), /etc/aicc-edge and /etc/aicc-ops/aicc-ops.toml from the archive (paths are checked first: only those four roots are accepted; pointers.txt is read, never extracted)
#   wpconfig        wp-config.php is NEVER taken from an archive (F-05); when it is missing it is re-rendered by aicc-render-wp-config from /etc/aicc/secrets + the template of this host's environment (--production: the production template)
#   perms           ownership, modes, setgid, ACLs exactly as install-stack.sh creates them
#   start           start php8.3-fpm and the cron timer
#   health_gate     smoke-cp.sh (PHP + wp-config + DB + WordPress + WooCommerce + plugin), loopback /healthz through the edge, WordPress siteurl read back
#   sanity          options table has rows, at least one administrator exists
# Exit codes: 0 ok, 1 a step failed (the report says which; services are brought back up where possible), 2 usage, 3 refused.
# Test seams (AICC_TEST_HARNESS=1): AICC_RESTORE_ROOT is NOT supported on purpose: this tool refuses to run unless it is the real host (or a --fixture database).
set -euo pipefail
umask 077

ACTION="${1:-}"; [ $# -gt 0 ] && shift
DUMP=""; FILES=""; SHA=""; FSHA=""; REPORT=""; YES=0; SAFETY=1; HEALTH=1; OUT=""; SCRATCH="aicc_dr_scratch"; FPOUT=""
DB="aicc_cp"; DBUSER="aicc_cp"; MYSQL_BIN="${MYSQL_BIN:-mysql}"; MY_CNF=""; SHARED="/srv/aicc/shared"; TRUST_SIDECAR=0; NO_IDENT=0; NEW_HOST_ID=0; IDENT_FILE="/etc/aicc-stage-identity"; PRODUCTION=0; CONFIRM_PROD_RESTORE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dump) DUMP="${2:-}"; shift 2 ;; --files) FILES="${2:-}"; shift 2 ;; --sha256) SHA="${2:-}"; shift 2 ;; --files-sha256) FSHA="${2:-}"; shift 2 ;;
    --report) REPORT="${2:-}"; shift 2 ;; --yes-replace-live) YES=1; shift ;; --no-safety-backup) SAFETY=0; shift ;; --no-health-gate) HEALTH=0; shift ;; --trust-sidecar) TRUST_SIDECAR=1; shift ;; --allow-no-identity) NO_IDENT=1; shift ;; --allow-new-host-id) NEW_HOST_ID=1; shift ;; --production) PRODUCTION=1; shift ;; --confirm-production-restore) CONFIRM_PROD_RESTORE=1; shift ;;
    --out) OUT="${2:-}"; shift 2 ;; --scratch-db) SCRATCH="${2:-}"; shift 2 ;; --fingerprint-out) FPOUT="${2:-}"; shift 2 ;;
    --db) DB="${2:-}"; shift 2 ;; --mysql-defaults-file) MY_CNF="${2:-}"; shift 2 ;; --shared-dir) SHARED="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,28p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$ACTION" in fingerprint|scratch|verify|live) ;; *) sed -n 2,13p "${BASH_SOURCE[0]}" >&2; exit 2 ;; esac
refuse() { echo "REFUSED: $*" >&2; exit 3; }
log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2 || true; }   # a closed stderr (dropped ssh) must never abort a restore half way
[[ "$DB" =~ ^aicc_[a-z0-9_]+$ ]] || refuse "database name must match ^aicc_[a-z0-9_]+\$"
[[ "$SCRATCH" =~ ^aicc_dr_[a-z0-9_]+$ ]] || refuse "scratch database must be named aicc_dr_*"
[ "$SCRATCH" != "$DB" ] || refuse "scratch database equals the live one"
if [ "${AICC_TEST_HARNESS:-0}" = "1" ]; then IDENT_FILE="${AICC_IDENTITY_FILE:-$IDENT_FILE}"; fi
if [ "${AICC_TEST_HARNESS:-0}" != "1" ]; then
  [ "$(id -u)" = "0" ] || { echo "must run as root (sudo). Refusing." >&2; exit 2; }
  if [ "$PRODUCTION" = 1 ]; then
    grep -q '^AICC_ENV=production$' /etc/aicc-stage-identity 2>/dev/null || refuse "--production was given but /etc/aicc-stage-identity does not say AICC_ENV=production"
    [ "$ACTION" != live ] || [ "$CONFIRM_PROD_RESTORE" = 1 ] || refuse "restoring the PRODUCTION database needs --confirm-production-restore (take a fresh backup first; this replaces the live data)"
  else
    grep -q '^AICC_ENV=staging$' /etc/aicc-stage-identity 2>/dev/null || refuse "/etc/aicc-stage-identity does not say AICC_ENV=staging; on the production host pass --production"
  fi
fi
# `--binary-mode` turns off the client's interpretation of backslash commands (\! system, \. source) in a piped dump: a dump is data, never a script for a shell
mysql_load() { local d="$1"; if [ -n "$MY_CNF" ]; then "$MYSQL_BIN" --defaults-extra-file="$MY_CNF" --binary-mode --database="$d"; else "$MYSQL_BIN" --no-defaults --binary-mode --database="$d"; fi; }
my() { if [ -n "$MY_CNF" ]; then "$MYSQL_BIN" --defaults-extra-file="$MY_CNF" --batch --skip-column-names "$@"; else "$MYSQL_BIN" --no-defaults --batch --skip-column-names "$@"; fi; }
now() { date +%s.%N 2>/dev/null | grep -E '^[0-9]+\.[0-9]+$' || date +%s; }
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN{printf "%.2f", b-a}'; }

fingerprint() { # fingerprint <db> <outfile>: "table<TAB>rows<TAB>checksum" sorted, comparable between databases (the schema name is not part of it)
  local d="$1" o="$2" t
  : > "$o.tmp"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    # a table name comes from the database (WordPress plugins can create tables): refuse anything that is not a plain identifier before it is placed in SQL run as root
    [[ "$t" =~ ^[A-Za-z0-9_$]+$ ]] || { echo "REFUSED: table name with unexpected characters in $d: $(printf '%s' "$t" | LC_ALL=C tr -cd '[:print:]' | cut -c1-60)" >&2; return 1; }
    printf '%s\t%s\t%s\n' "$t" "$(my -e "SELECT COUNT(*) FROM \`$d\`.\`$t\`")" "$(my -e "CHECKSUM TABLE \`$d\`.\`$t\`" | awk '{print $2}')" >> "$o.tmp"
  done < <(my -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$d' AND table_type='BASE TABLE' ORDER BY table_name")
  LC_ALL=C sort "$o.tmp" > "$o"; rm -f "$o.tmp"
}

verify_dump() {
  [ -f "$DUMP" ] || { echo "no such dump: $DUMP" >&2; return 1; }
  local want="$SHA" got
  if [ -z "$want" ] && [ "$TRUST_SIDECAR" = 1 ] && [ -f "$DUMP.sha256" ]; then want="$(awk '{print $1}' "$DUMP.sha256" | head -1)"; log "WARNING: trusting the sidecar next to the dump (no out-of-band hash)"; fi
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || { echo "no usable sha256 for the dump (give --sha256 from the OFF-HOST copy; --trust-sidecar accepts the sidecar next to it)" >&2; return 1; }
  got="$(sha256sum "$DUMP" | awk '{print $1}')"; [ "$got" = "$want" ] || { echo "dump sha256 mismatch" >&2; return 1; }
  gzip -t "$DUMP" || { echo "gzip -t failed on the dump" >&2; return 1; }
  gzip -dc "$DUMP" | tail -n 1 | grep -q '^-- Dump completed' || { echo "dump has no completion trailer" >&2; return 1; }
}
verify_files() {
  [ "$FILES" = "none" ] && return 0
  [ -f "$FILES" ] || { echo "no such files archive: $FILES" >&2; return 1; }
  local want="$FSHA" got
  if [ -z "$want" ] && [ "$TRUST_SIDECAR" = 1 ] && [ -f "$FILES.sha256" ]; then want="$(awk '{print $1}' "$FILES.sha256" | head -1)"; log "WARNING: trusting the sidecar next to the files archive"; fi
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || { echo "no usable sha256 for the files archive" >&2; return 1; }
  got="$(sha256sum "$FILES" | awk '{print $1}')"; [ "$got" = "$want" ] || { echo "files archive sha256 mismatch" >&2; return 1; }
  gzip -t "$FILES" || return 1
  # Only regular files and directories under these roots may be written: no links (a hardlink to /etc/shadow would be re-owned by the perms step, a symlink would redirect later
  # members), no devices, no absolute or .. names. `tar -tvz` prefixes every member with its type character.
  local listing; listing="$(tar -tvzf "$FILES")" || return 1
  if printf '%s\n' "$listing" | cut -c1 | grep -qvE '^[-d]$'; then echo "the archive contains members that are not plain files or directories (links, devices...)" >&2; return 1; fi
  if tar -tzf "$FILES" | grep -vE '^(srv/aicc/shared/(uploads|plugin-releases|wp-config\.php)|etc/aicc-edge|etc/aicc-ops/aicc-ops\.toml|pointers\.txt)(/|$)' | grep -q .; then echo "the archive contains paths outside the allowed roots" >&2; return 1; fi
  if tar -tzf "$FILES" | grep -qE '(^|/)\.\.(/|$)|^/'; then echo "the archive contains unsafe paths" >&2; return 1; fi
  # the archive must have been taken on THIS host: a files archive from another environment would replace wp-config.php with that environment's configuration
  local want_id have_id
  want_id="$(tr '\n' ' ' < "$IDENT_FILE" 2>/dev/null | sed 's/ *$//')"
  have_id="$(tar -xOzf "$FILES" pointers.txt 2>/dev/null | sed -n 's/^host_identity //p' | head -1)"
  if [ -z "$have_id" ]; then
    [ "$NO_IDENT" = 1 ] || { echo "the archive carries no host_identity (taken before that was recorded): pass --allow-no-identity to accept it knowingly" >&2; return 1; }
  elif [ "$have_id" != "$want_id" ]; then
    # a REBUILT host of the same environment has a new random stage id: --allow-new-host-id accepts that (same AICC_ENV and AICC_HOSTNAME, id may differ); never another environment
    local we wh he hh
    we="$(printf '%s' "$want_id" | tr ' ' '\n' | sed -n 's/^AICC_ENV=//p')"; wh="$(printf '%s' "$want_id" | tr ' ' '\n' | sed -n 's/^AICC_HOSTNAME=//p')"
    he="$(printf '%s' "$have_id" | tr ' ' '\n' | sed -n 's/^AICC_ENV=//p')"; hh="$(printf '%s' "$have_id" | tr ' ' '\n' | sed -n 's/^AICC_HOSTNAME=//p')"
    if [ "$NEW_HOST_ID" = 1 ] && [ -n "$we" ] && [ "$we" = "$he" ] && [ -n "$wh" ] && [ "$wh" = "$hh" ]; then log "WARNING: archive from a previous incarnation of this host (same environment and name, different id): accepted by --allow-new-host-id"
    else echo "the archive was taken on a different host/environment (identity differs): refusing" >&2; return 1; fi
  fi
}

# scratch_load <dump> <scratch-db>: create the scratch database and load the dump into it as a DATA file: no client commands (--binary-mode), DEFINER clauses stripped so nothing in
# the dump can create objects owned by another account. The caller drops the database.
scratch_load() {
  local dump="$1" sdb="$2"
  my -e "DROP DATABASE IF EXISTS \`$sdb\`; CREATE DATABASE \`$sdb\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci" || return 1
  gzip -dc "$dump" | LC_ALL=C sed -e 's/DEFINER=`[^`]*`@`[^`]*`//g' | mysql_load "$sdb" || return 1
}

if [ "$ACTION" = fingerprint ]; then
  [ -n "$OUT" ] || { echo "--out FILE is required" >&2; exit 2; }
  fingerprint "$DB" "$OUT"; log "fingerprint of $DB: $(wc -l < "$OUT" | tr -d ' ') tables -> $OUT"; exit 0
fi

if [ "$ACTION" = verify ]; then
  [ -n "$DUMP" ] || { echo "--dump is required" >&2; exit 2; }
  [ -n "$FILES" ] || FILES=none
  verify_dump || exit 1
  verify_files || exit 1
  log "verify ok"; exit 0
fi

if [ "$ACTION" = scratch ]; then
  [ -n "$DUMP" ] || { echo "--dump is required" >&2; exit 2; }
  [ -n "$SHA" ] || TRUST_SIDECAR=1        # a scratch load touches no live data and loads the dump as data only
  verify_dump || exit 1
  t0="$(now)"
  trap 'my -e "DROP DATABASE IF EXISTS \`$SCRATCH\`" >/dev/null 2>&1 || true' EXIT
  scratch_load "$DUMP" "$SCRATCH" || { echo "the dump did not load into the scratch database" >&2; exit 1; }
  t1="$(now)"
  fp="${FPOUT:-$(mktemp)}"
  fingerprint "$SCRATCH" "$fp"
  log "scratch restore ok: $(wc -l < "$fp" | tr -d ' ') tables in $(elapsed "$t0" "$t1") s; fingerprint -> $fp; scratch database dropped on exit"
  exit 0
fi

# ---- live ------------------------------------------------------------------------------------------------------------------------------------------------
[ "$YES" = 1 ] || refuse "live restore REPLACES the live database: pass --yes-replace-live (and read the steps in --help first)"
[ -n "$DUMP" ] && [ -n "$FILES" ] || { echo "--dump and --files (a file, or the word none) are required" >&2; exit 2; }
if [ "$TRUST_SIDECAR" = 0 ]; then
  [ -n "$SHA" ] || refuse "live restore needs --sha256 of the dump from the OFF-HOST copy (or --trust-sidecar, which accepts the sidecar next to the data)"
  [ "$FILES" = none ] || [ -n "$FSHA" ] || refuse "live restore needs --files-sha256 of the files archive from the OFF-HOST copy (or --trust-sidecar)"
fi
[ -n "$REPORT" ] || REPORT="/srv/aicc/backups/restore-report-$(date -u +%Y%m%dT%H%M%SZ).json"
STEPS="[]"; T_START="$(now)"; FAILED=""
# a dropped ssh session must not kill a restore half way (SIGHUP/SIGPIPE): ignore both and keep going; the report is written either way
trap '' HUP PIPE
step_done() { STEPS="$(jq -c --arg n "$1" --arg s "$2" --argjson d "$3" '. + [{step:$n,status:$s,seconds:$d}]' <<<"$STEPS")"; }
run_step() { # run_step <name> <function>
  local n="$1" f="$2" a b
  a="$(now)"; log "step $n ..."
  if "$f"; then b="$(now)"; step_done "$n" ok "$(elapsed "$a" "$b")"; log "step $n ok ($(elapsed "$a" "$b") s)"; return 0; fi
  b="$(now)"; step_done "$n" failed "$(elapsed "$a" "$b")"; FAILED="$n"; log "step $n FAILED"; return 1
}
finish() {
  local rc=$1 t; t="$(now)"
  jq -n -c --arg a live --arg st "$([ "$rc" = 0 ] && echo ok || echo failed)" --arg f "$FAILED" --argjson s "$STEPS" --argjson tot "$(elapsed "$T_START" "$t")" \
     --arg h "$(hostname | tr -cd 'A-Za-z0-9.-')" --arg d "$(basename "$DUMP")" --arg fl "$(basename "$FILES")" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     '{schema:1,action:$a,status:$st,failed_step:$f,total_seconds:$tot,host:$h,dump:$d,files:$fl,finished_at:$at,steps:$s}' > "$REPORT.tmp"
  chmod 644 "$REPORT.tmp"; mv -f "$REPORT.tmp" "$REPORT"; log "report: $REPORT (total $(elapsed "$T_START" "$t") s, status $([ "$rc" = 0 ] && echo ok || echo failed))"
}

s_verify() { verify_dump && verify_files; }
# the dump must load into a scratch database BEFORE anything live is dropped; a dump that cannot load aborts the restore with nothing changed
s_preload() {
  local fp ok=0; fp="$(mktemp)"
  if scratch_load "$DUMP" aicc_dr_live_check && fingerprint aicc_dr_live_check "$fp"; then ok=1; fi
  my -e "DROP DATABASE IF EXISTS aicc_dr_live_check" >/dev/null 2>&1 || true
  [ "$ok" = 1 ] || { rm -f "$fp"; echo "the dump does not load (scratch check failed): nothing was changed" >&2; return 1; }
  [ "$(wc -l < "$fp" | tr -d ' ')" -ge 1 ] || { rm -f "$fp"; echo "the dump holds no tables" >&2; return 1; }
  rm -f "$fp"
}
s_safety() { [ "$SAFETY" = 0 ] && return 0; /usr/local/sbin/aicc-backup --label manual >/dev/null; }
s_quiesce() { systemctl stop aicc-wp-cron.timer aicc-wp-cron.service 2>/dev/null || true; systemctl stop php8.3-fpm || return 1; }
# NOTE: run_step calls these inside `if`, where errexit is suppressed: every command that matters carries an explicit `|| return 1`.
s_db() {
  my -e "DROP DATABASE IF EXISTS \`$DB\`; CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci" || return 1
  gzip -dc "$DUMP" | mysql_load "$DB" || return 1          # pipefail: a failed decompression or a failed load fails the step
  my -e "GRANT ALL PRIVILEGES ON \`$DB\`.* TO '$DBUSER'@'localhost'" || return 1
}
s_files() {
  [ "$FILES" = "none" ] && return 0
  rm -rf "$SHARED/uploads" || return 1      # wp-config.php is NOT touched here and NOT taken from an archive (F-05): the next step re-renders it when it is missing
  # the Plugin release store is replaced only when the archive carries one (an archive taken before it existed must not delete the live store)
  if tar -tzf "$FILES" | grep -q '^srv/aicc/shared/plugin-releases/'; then rm -rf "$SHARED/plugin-releases" || return 1; fi
  # --exclude wp-config.php: archives taken before 2026-10-23 carry the rendered file (with every secret in it); it is never extracted, the renderer below is the only writer
  tar -xzpf "$FILES" -C / --no-same-owner --exclude=pointers.txt --exclude=srv/aicc/shared/wp-config.php || return 1
}
s_wpconfig() { # the rendered wp-config.php is re-created from /etc/aicc/secrets + the template of this host's environment when it is missing (a deleted file, a rebuilt host)
  [ -f "$SHARED/wp-config.php" ] && return 0
  local r=/usr/local/sbin/aicc-render-wp-config
  [ -x "$r" ] || { echo "wp-config.php is missing and $r is not installed (install-stack.sh --only scripts)" >&2; return 1; }
  if [ "$PRODUCTION" = 1 ]; then "$r" --env production --confirm-production || return 1; else "$r" --env stage || return 1; fi
  [ -s "$SHARED/wp-config.php" ] || { echo "the renderer did not produce $SHARED/wp-config.php" >&2; return 1; }
}
s_perms() {
  [ "$FILES" = "none" ] && return 0
  mkdir -p "$SHARED/uploads" || return 1
  find "$SHARED/uploads" -perm /6000 ! -type d -exec chmod ug-s {} + || return 1        # a setuid/setgid file from an archive is never kept
  chown -R aicc-cp:aicc-edge "$SHARED/uploads" || return 1; chmod 2750 "$SHARED/uploads" || return 1
  setfacl -m "u:aicc:rx,g:aicc-edge:rx" "$SHARED/uploads" || return 1; setfacl -d -m "u:aicc:rx,g:aicc-edge:rx,o::---" "$SHARED/uploads" || return 1
  if [ -d "$SHARED/plugin-releases" ]; then   # root:aicc-cp 0750 dirs / 0640 files: PHP reads, nothing but the installer writes
    chown -R root:aicc-cp "$SHARED/plugin-releases" || return 1; find "$SHARED/plugin-releases" -type d -exec chmod 750 {} + || return 1; find "$SHARED/plugin-releases" -type f -exec chmod 640 {} + || return 1
  fi
  if [ -f "$SHARED/wp-config.php" ]; then chown root:aicc-cp "$SHARED/wp-config.php" || return 1; chmod 640 "$SHARED/wp-config.php" || return 1; fi
  chown -R root:aicc-edge /etc/aicc-edge || return 1; chmod 750 /etc/aicc-edge || return 1
  if [ -f /etc/aicc-ops/aicc-ops.toml ]; then chown root:aicc-ops /etc/aicc-ops/aicc-ops.toml && chmod 640 /etc/aicc-ops/aicc-ops.toml || return 1; fi
}
s_start() { systemctl start php8.3-fpm; systemctl start aicc-wp-cron.timer 2>/dev/null || true; }
s_health() {
  [ "$HEALTH" = 0 ] && return 0
  local host i ok=0
  host="$(sed -n 's/^AICC_HOSTNAME=//p' /etc/aicc-stage-identity | head -1)"
  for i in 1 2 3 4 5; do
    if AICC_RELEASE_DIR=/srv/aicc/cp/current AICC_SMOKE_HOST="$host" /usr/local/lib/aicc/release/smoke-cp.sh >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  [ "$ok" = 1 ] || { echo "smoke-cp never became healthy" >&2; return 1; }
  # -k: a loopback self-check of our own edge (--resolve to 127.0.0.1); the dark-production edge presents Caddy's internal certificate, which no client trusts
  [ "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host/healthz")" = 200 ] || { echo "/healthz through the edge is not 200" >&2; return 1; }
  [ "$(/usr/local/sbin/aicc-wp option get siteurl 2>/dev/null)" = "https://$host" ] || { echo "WordPress siteurl is not https://$host" >&2; return 1; }
}
s_sanity() {
  local n a
  n="$(my -e "SELECT COUNT(*) FROM \`$DB\`.wp_options")"; [ "${n:-0}" -ge 1 ] || { echo "wp_options is empty" >&2; return 1; }
  a="$(/usr/local/sbin/aicc-wp user list --role=administrator --field=ID 2>/dev/null | wc -l | tr -d ' ')"; [ "${a:-0}" -ge 1 ] || { echo "no administrator user after the restore" >&2; return 1; }
}

run_step verify s_verify || { finish 1; exit 1; }
run_step preload_check s_preload || { finish 1; exit 1; }
run_step safety_backup s_safety || { finish 1; exit 1; }
run_step quiesce s_quiesce || { finish 1; exit 1; }
rc=0
run_step db_restore s_db || rc=1
if [ $rc = 0 ]; then run_step files_restore s_files || rc=1; fi
run_step wpconfig s_wpconfig || rc=1   # after the files, before the permissions/start: a restore never needs the archive to carry the secrets
run_step perms s_perms || rc=1      # even after a failed extraction: ownership/setuid cleanup must not be skipped
run_step start s_start || rc=1     # always try to bring the application back, even after a failed step
if [ $rc = 0 ]; then run_step health_gate s_health || rc=1; fi
if [ $rc = 0 ]; then run_step sanity s_sanity || rc=1; fi
finish $rc
exit $rc
