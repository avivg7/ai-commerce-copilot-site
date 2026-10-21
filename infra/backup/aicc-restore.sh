#!/usr/bin/env bash
# AICC Control Plane RESTORE (staging host now, production later). Installed as /usr/local/sbin/aicc-restore. Runs ON THE HOST as root.
# The documented restore procedure (README-backup.md) as one verified, TIMED tool, so a disaster-recovery drill measures real steps and the same
# command is what an operator types in a real incident.
#
#   sudo aicc-restore fingerprint --out FILE                      per-table row count + CHECKSUM TABLE of the live database (data-correctness proof)
#   sudo aicc-restore scratch  --dump FILE [--sha256 H] [--scratch-db aicc_dr_scratch] [--fingerprint-out FILE]
#                                                                 load the dump into a SCRATCH database next to the live one, fingerprint it, drop it.
#                                                                 The live database, files and services are never touched.
#   sudo aicc-restore live --dump FILE --files FILE|none [--sha256 H] [--files-sha256 H] --yes-replace-live
#                          [--report FILE] [--no-safety-backup] [--no-health-gate]
#                                                                 REPLACES the live database (and files): see the steps below.
#
# live steps (each is timed; the report is JSON):
#   verify          sha256 (sidecar next to the dump, or --sha256), gzip -t, "-- Dump completed" trailer, archive listing
#   safety_backup   aicc-backup --label manual  (what exists now is never destroyed without a copy; --no-safety-backup only for a drill that already has one)
#   quiesce         stop aicc-wp-cron.timer/service and php8.3-fpm (no writer while the database is replaced)
#   db_restore      DROP/CREATE the database, load the dump as root over the socket (definers kept), re-grant the application user
#   files_restore   extract uploads, wp-config.php and /etc/aicc-edge from the archive (paths are checked first: only those three roots are accepted)
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
DB="aicc_cp"; DBUSER="aicc_cp"; MYSQL_BIN="${MYSQL_BIN:-mysql}"; MY_CNF=""; SHARED="/srv/aicc/shared"
while [ $# -gt 0 ]; do
  case "$1" in
    --dump) DUMP="${2:-}"; shift 2 ;; --files) FILES="${2:-}"; shift 2 ;; --sha256) SHA="${2:-}"; shift 2 ;; --files-sha256) FSHA="${2:-}"; shift 2 ;;
    --report) REPORT="${2:-}"; shift 2 ;; --yes-replace-live) YES=1; shift ;; --no-safety-backup) SAFETY=0; shift ;; --no-health-gate) HEALTH=0; shift ;;
    --out) OUT="${2:-}"; shift 2 ;; --scratch-db) SCRATCH="${2:-}"; shift 2 ;; --fingerprint-out) FPOUT="${2:-}"; shift 2 ;;
    --db) DB="${2:-}"; shift 2 ;; --mysql-defaults-file) MY_CNF="${2:-}"; shift 2 ;; --shared-dir) SHARED="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,28p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$ACTION" in fingerprint|scratch|live) ;; *) sed -n 2,13p "${BASH_SOURCE[0]}" >&2; exit 2 ;; esac
refuse() { echo "REFUSED: $*" >&2; exit 3; }
log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
[[ "$DB" =~ ^aicc_[a-z0-9_]+$ ]] || refuse "database name must match ^aicc_[a-z0-9_]+\$"
[[ "$SCRATCH" =~ ^aicc_dr_[a-z0-9_]+$ ]] || refuse "scratch database must be named aicc_dr_*"
[ "$SCRATCH" != "$DB" ] || refuse "scratch database equals the live one"
if [ "${AICC_TEST_HARNESS:-0}" != "1" ]; then
  [ "$(id -u)" = "0" ] || { echo "must run as root (sudo). Refusing." >&2; exit 2; }
  grep -q '^AICC_ENV=staging$' /etc/aicc-stage-identity 2>/dev/null || refuse "/etc/aicc-stage-identity does not say AICC_ENV=staging (production restores are a separate, owner-gated procedure)"
fi
my() { if [ -n "$MY_CNF" ]; then "$MYSQL_BIN" --defaults-extra-file="$MY_CNF" --batch --skip-column-names "$@"; else "$MYSQL_BIN" --no-defaults --batch --skip-column-names "$@"; fi; }
now() { date +%s.%N 2>/dev/null | grep -E '^[0-9]+\.[0-9]+$' || date +%s; }
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN{printf "%.2f", b-a}'; }

fingerprint() { # fingerprint <db> <outfile>: "table<TAB>rows<TAB>checksum" sorted, comparable between databases (the schema name is not part of it)
  local d="$1" o="$2" t
  : > "$o.tmp"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    printf '%s\t%s\t%s\n' "$t" "$(my -e "SELECT COUNT(*) FROM \`$d\`.\`$t\`")" "$(my -e "CHECKSUM TABLE \`$d\`.\`$t\`" | awk '{print $2}')" >> "$o.tmp"
  done < <(my -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$d' AND table_type='BASE TABLE' ORDER BY table_name")
  LC_ALL=C sort "$o.tmp" > "$o"; rm -f "$o.tmp"
}

verify_dump() {
  [ -f "$DUMP" ] || { echo "no such dump: $DUMP" >&2; return 1; }
  local want="$SHA" got
  if [ -z "$want" ] && [ -f "$DUMP.sha256" ]; then want="$(awk '{print $1}' "$DUMP.sha256" | head -1)"; fi
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || { echo "no usable sha256 for the dump (give --sha256 or keep the .sha256 sidecar)" >&2; return 1; }
  got="$(sha256sum "$DUMP" | awk '{print $1}')"; [ "$got" = "$want" ] || { echo "dump sha256 mismatch" >&2; return 1; }
  gzip -t "$DUMP" || { echo "gzip -t failed on the dump" >&2; return 1; }
  gzip -dc "$DUMP" | tail -n 1 | grep -q '^-- Dump completed' || { echo "dump has no completion trailer" >&2; return 1; }
}
verify_files() {
  [ "$FILES" = "none" ] && return 0
  [ -f "$FILES" ] || { echo "no such files archive: $FILES" >&2; return 1; }
  local want="$FSHA" got
  if [ -z "$want" ] && [ -f "$FILES.sha256" ]; then want="$(awk '{print $1}' "$FILES.sha256" | head -1)"; fi
  [[ "$want" =~ ^[0-9a-f]{64}$ ]] || { echo "no usable sha256 for the files archive" >&2; return 1; }
  got="$(sha256sum "$FILES" | awk '{print $1}')"; [ "$got" = "$want" ] || { echo "files archive sha256 mismatch" >&2; return 1; }
  gzip -t "$FILES" || return 1
  # only these roots may be written (uploads, wp-config.php, /etc/aicc-edge, the AICC Ops toml); no absolute paths, no .., no links pointing outside
  if tar -tzf "$FILES" | grep -vE '^(srv/aicc/shared/(uploads|wp-config\.php)|etc/aicc-edge|etc/aicc-ops/aicc-ops\.toml|pointers\.txt)(/|$)' | grep -q .; then echo "the archive contains paths outside the allowed roots" >&2; return 1; fi
  if tar -tzf "$FILES" | grep -qE '(^|/)\.\.(/|$)|^/'; then echo "the archive contains unsafe paths" >&2; return 1; fi
}

if [ "$ACTION" = fingerprint ]; then
  [ -n "$OUT" ] || { echo "--out FILE is required" >&2; exit 2; }
  fingerprint "$DB" "$OUT"; log "fingerprint of $DB: $(wc -l < "$OUT" | tr -d ' ') tables -> $OUT"; exit 0
fi

if [ "$ACTION" = scratch ]; then
  [ -n "$DUMP" ] || { echo "--dump is required" >&2; exit 2; }
  verify_dump || exit 1
  t0="$(now)"
  my -e "DROP DATABASE IF EXISTS \`$SCRATCH\`; CREATE DATABASE \`$SCRATCH\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci"
  trap 'my -e "DROP DATABASE IF EXISTS \`$SCRATCH\`" >/dev/null 2>&1 || true' EXIT
  # a scratch load has no business creating definers for other accounts: strip them (same rule as the backup's own restore smoke)
  gzip -dc "$DUMP" | LC_ALL=C sed -e 's/DEFINER=`[^`]*`@`[^`]*`//g' | { if [ -n "$MY_CNF" ]; then "$MYSQL_BIN" --defaults-extra-file="$MY_CNF" --database="$SCRATCH"; else "$MYSQL_BIN" --no-defaults --database="$SCRATCH"; fi; }
  t1="$(now)"
  fp="${FPOUT:-/tmp/aicc-dr-scratch.fp}"
  fingerprint "$SCRATCH" "$fp"
  log "scratch restore ok: $(wc -l < "$fp" | tr -d ' ') tables in $(elapsed "$t0" "$t1") s; fingerprint -> $fp; scratch database dropped on exit"
  exit 0
fi

# ---- live ------------------------------------------------------------------------------------------------------------------------------------------------
[ "$YES" = 1 ] || refuse "live restore REPLACES the live database: pass --yes-replace-live (and read the steps in --help first)"
[ -n "$DUMP" ] && [ -n "$FILES" ] || { echo "--dump and --files (a file, or the word none) are required" >&2; exit 2; }
[ -n "$REPORT" ] || REPORT="/srv/aicc/backups/restore-report-$(date -u +%Y%m%dT%H%M%SZ).json"
STEPS="[]"; T_START="$(now)"; FAILED=""
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
s_safety() { [ "$SAFETY" = 0 ] && return 0; /usr/local/sbin/aicc-backup --label manual >/dev/null; }
s_quiesce() { systemctl stop aicc-wp-cron.timer aicc-wp-cron.service 2>/dev/null || true; systemctl stop php8.3-fpm; }
s_db() {
  my -e "DROP DATABASE IF EXISTS \`$DB\`; CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci"
  gzip -dc "$DUMP" | { if [ -n "$MY_CNF" ]; then "$MYSQL_BIN" --defaults-extra-file="$MY_CNF" --database="$DB"; else "$MYSQL_BIN" --no-defaults --database="$DB"; fi; }
  my -e "GRANT ALL PRIVILEGES ON \`$DB\`.* TO '$DBUSER'@'localhost'" 2>/dev/null || true
}
s_files() {
  [ "$FILES" = "none" ] && return 0
  rm -rf "$SHARED/uploads"; rm -f "$SHARED/wp-config.php"
  tar -xzpf "$FILES" -C / --no-same-owner --exclude=pointers.txt
}
s_perms() {
  [ "$FILES" = "none" ] && return 0
  mkdir -p "$SHARED/uploads"
  chown -R aicc-cp:aicc-edge "$SHARED/uploads"; chmod 2750 "$SHARED/uploads"
  setfacl -m "u:aicc:rx,g:aicc-edge:rx" "$SHARED/uploads"; setfacl -d -m "u:aicc:rx,g:aicc-edge:rx,o::---" "$SHARED/uploads"
  [ -f "$SHARED/wp-config.php" ] && { chown root:aicc-cp "$SHARED/wp-config.php"; chmod 640 "$SHARED/wp-config.php"; }
  chown -R root:aicc-edge /etc/aicc-edge 2>/dev/null || true
  chown root:aicc-ops /etc/aicc-ops/aicc-ops.toml 2>/dev/null && chmod 640 /etc/aicc-ops/aicc-ops.toml || true
  chmod 750 /etc/aicc-edge 2>/dev/null || true
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
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host/healthz")" = 200 ] || { echo "/healthz through the edge is not 200" >&2; return 1; }
  [ "$(/usr/local/sbin/aicc-wp option get siteurl 2>/dev/null)" = "https://$host" ] || { echo "WordPress siteurl is not https://$host" >&2; return 1; }
}
s_sanity() {
  local n a
  n="$(my -e "SELECT COUNT(*) FROM \`$DB\`.wp_options")"; [ "${n:-0}" -ge 1 ] || { echo "wp_options is empty" >&2; return 1; }
  a="$(/usr/local/sbin/aicc-wp user list --role=administrator --field=ID 2>/dev/null | wc -l | tr -d ' ')"; [ "${a:-0}" -ge 1 ] || { echo "no administrator user after the restore" >&2; return 1; }
}

run_step verify s_verify || { finish 1; exit 1; }
run_step safety_backup s_safety || { finish 1; exit 1; }
run_step quiesce s_quiesce || { finish 1; exit 1; }
rc=0
run_step db_restore s_db || rc=1
if [ $rc = 0 ]; then run_step files_restore s_files || rc=1; fi
if [ $rc = 0 ]; then run_step perms s_perms || rc=1; fi
run_step start s_start || rc=1     # always try to bring the application back, even after a failed step
if [ $rc = 0 ]; then run_step health_gate s_health || rc=1; fi
if [ $rc = 0 ]; then run_step sanity s_sanity || rc=1; fi
finish $rc
exit $rc
