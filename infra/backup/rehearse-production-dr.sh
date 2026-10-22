#!/usr/bin/env bash
# PRODUCTION-MODE backup -> off-host pull -> restore REHEARSAL in a fully ISOLATED target. Runs on the Mac only (a throwaway mysqld in a temp directory, socket only; a temp "host" tree).
# It never touches the live Droplet, the live database, any fixture or owner database, DNS or a network.
#
#   infra/backup/rehearse-production-dr.sh [--shape-dump FILE] [--report FILE] [--keep]
#
# What it exercises, with the PRODUCTION identity (AICC_ENV=production, www.copilt.org, a new id) and the production names (pull key aicc_cp_prod_offhost, production destination directory, pinned host key):
#   1  create the empty production database + accounts (create-staging-db.sh, the same script the promotion uses); load --shape-dump (a real dump of the staging host: the schema is production-shaped,
#      the DATA is staging test data and is labelled as such) or a synthetic schema
#   2  aicc-backup.sh twice (hourly cadence): dump, files archive, restore smoke into aicc_restore_check, status.json, sidecars, pointers.txt carrying the production host_identity
#   3  pull-offhost.sh --env production (ssh replaced by a local stub that runs aicc-offhost-serve.sh): checksum-verified copy into the production directory, ack written; the AICC Ops backup collector is
#      run on the result and must say: backup ok, off-host verified (the inputs of backup_stale / offhost_stale)
#   4  aicc-restore.sh verify + scratch (production flag): hashes, archive members, identity, a scratch load fingerprinted table by table against the source
#   5  DISASTER in the isolated target (database dropped, uploads and wp-config deleted) and recovery FROM THE OFF-HOST COPY with the documented manual procedure (README-backup.md): DB load, files extract,
#      strict per-table fingerprint comparison (row count + CHECKSUM TABLE, no exceptions)
# Not covered here (and said so in the report): the files-archive member checks of `aicc-restore verify` (they accept only the real host paths), `aicc-restore live` (it refuses to run anywhere but the real host; it was timed on the host as dr-drill-3.json, staging mode), systemd, the real
# filesystem layout, host hardware (timings are Mac timings), a Mac that sleeps.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; INFRA="$(cd "$HERE/.." && pwd)"
LOCALMY="$HOME/Library/Application Support/Local/lightning-services/mysql-8.4.0+2/bin/darwin-arm64/bin"
SHAPE=""; REPORT=""; KEEP=0
while [ $# -gt 0 ]; do case "$1" in --shape-dump) SHAPE="${2:-}"; shift 2 ;; --report) REPORT="${2:-}"; shift 2 ;; --keep) KEEP=1; shift ;; *) echo "unknown argument: $1" >&2; exit 2 ;; esac; done
[ -x "$LOCALMY/mysqld" ] || { echo "Local's mysql 8.4 binaries not found" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
T="$(mktemp -d "${TMPDIR:-/tmp}/aprd.XXXX")"; MPID=""
cleanup() { [ -n "$MPID" ] && kill "$MPID" 2>/dev/null && sleep 1; [ "$KEEP" = 1 ] || rm -rf "$T"; }
trap cleanup EXIT
now() { python3 -c 'import time;print("%.3f"%time.time())'; }
el() { python3 -c "print('%.2f'%($2-$1))"; }
STEPS="[]"; step() { STEPS="$(jq -c --arg n "$1" --argjson s "$2" '. + [{step:$n,seconds:$s}]' <<<"$STEPS")"; echo "  [$1] $2 s"; }

M="$T/m"; mkdir -p "$M/data"
printf '[mysqld]\ndatadir=%s/data\nbasedir=%s\nsocket=%s/s.sock\npid-file=%s/p.pid\nmysqlx-socket=%s/x.sock\nskip-networking\n' "$M" "$(dirname "$LOCALMY")" "$M" "$M" "$M" > "$M/my.cnf"
"$LOCALMY/mysqld" --defaults-file="$M/my.cnf" --initialize-insecure >"$M/init.out" 2>&1 || true
"$LOCALMY/mysqld" --defaults-file="$M/my.cnf" >"$M/run.out" 2>&1 & MPID=$!
for _ in $(seq 1 60); do [ -S "$M/s.sock" ] && break; sleep 1; done
[ -S "$M/s.sock" ] || { echo "throwaway mysqld did not start" >&2; exit 1; }
RT=("$LOCALMY/mysql" --protocol=socket --socket="$M/s.sock" -uroot -N)

HOSTROOT="$T/host"; SEC="$HOSTROOT/secrets"; BK="$HOSTROOT/backups"; SH="$HOSTROOT/shared"; EC="$HOSTROOT/edge"; BKCNF="$HOSTROOT/backup.cnf"
mkdir -p "$SEC" "$BK" "$SH/uploads" "$EC" "$HOSTROOT/rel"; chmod 700 "$SEC"
ID32="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
IDF="$HOSTROOT/aicc-stage-identity"; printf 'AICC_ENV=production\nAICC_HOSTNAME=www.copilt.org\nAICC_HOST_ROLE=control-plane-edge\nAICC_STAGE_ID=%s\n' "$ID32" > "$IDF"
echo "== 1 production database in the isolated server =="
t=$(now); env AICC_TEST_HARNESS=1 bash "$INFRA/provision/create-staging-db.sh" --socket "$M/s.sock" --secrets-dir "$SEC" --backup-cnf "$BKCNF" --mysql-bin "$LOCALMY/mysql" >/dev/null; step create_db_and_accounts "$(el "$t" "$(now)")"
SHAPE_KIND="synthetic schema"
if [ -n "$SHAPE" ]; then
  gzip -dc "$SHAPE" | "$LOCALMY/mysql" --protocol=socket --socket="$M/s.sock" -uroot --binary-mode aicc_cp; SHAPE_KIND="real staging dump $(basename "$SHAPE") (production-shaped schema; STAGING test DATA)"
else
  "${RT[@]}" -e "CREATE TABLE aicc_cp.wp_options (option_id BIGINT AUTO_INCREMENT PRIMARY KEY, option_name VARCHAR(191), option_value LONGTEXT); INSERT INTO aicc_cp.wp_options (option_name,option_value) VALUES ('siteurl','https://www.copilt.org'),('home','https://www.copilt.org');"
fi
TABLES="$("${RT[@]}" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='aicc_cp'")"
DBMB="$("${RT[@]}" -e "SELECT ROUND(SUM(data_length+index_length)/1048576,2) FROM information_schema.tables WHERE table_schema='aicc_cp'")"
for i in $(seq 1 13); do head -c $((4096 * i)) /dev/urandom > "$SH/uploads/file$i.bin"; done
echo "<?php // production wp-config placeholder for the rehearsal (no real secrets)" > "$SH/wp-config.php"; echo "# production Caddyfile placeholder" > "$EC/Caddyfile"
echo "  shape: $SHAPE_KIND; $TABLES tables, $DBMB MB"

BAK() { env AICC_TEST_HARNESS=1 AICC_IDENTITY_FILE="$IDF" MYSQL_BIN="$LOCALMY/mysql" MYSQLDUMP_BIN="$LOCALMY/mysqldump" bash "$HERE/aicc-backup.sh" --backup-dir "$BK" --shared-dir "$SH" --edge-conf-dir "$EC" --release-root "$HOSTROOT/rel" --mysql-defaults-file "$BKCNF" "$@"; }
echo "== 2 production backups (two hourly-cadence runs) =="
t=$(now); BAK --label scheduled >/dev/null; step backup_1 "$(el "$t" "$(now)")"
sleep 1
t=$(now); BAK --label scheduled >/dev/null; step backup_2 "$(el "$t" "$(now)")"
ST="$BK/status.json"
BK_OK="$(jq -r .status "$ST")"; RESTORE_SMOKE="$(jq -r .db_dump.restore_check "$ST")"; DUMP="$(jq -r .last_success.db_dump_file "$ST")"; FARC="$(jq -r .last_success.files_archive_file "$ST")"
echo "  status=$BK_OK restore_check=$RESTORE_SMOKE dump=$DUMP"
PTR_ID="$(tar -xOzf "$BK/$FARC" pointers.txt | sed -n 's/^host_identity //p')"
echo "  pointers.txt host_identity: $PTR_ID" | sed "s/$ID32/<id>/"

echo "== 3 off-host pull in production mode (stub ssh -> aicc-offhost-serve) =="
STUB="$T/stub"; mkdir -p "$STUB" "$T/home/.ssh"; CALLS="$T/calls.log"; : > "$CALLS"
cat > "$STUB/ssh" <<EOS
#!/usr/bin/env bash
echo "ssh \$*" >> "$CALLS"
cmd="\${@: -1}"
env AICC_TEST_HARNESS=1 AICC_BACKUP_DIR="$BK" AICC_IDENTITY_FILE="$IDF" bash "$HERE/aicc-offhost-serve.sh" "\$cmd"
EOS
chmod +x "$STUB/ssh"
PKEY="$T/aicc_cp_prod_offhost"; printf -- '-----BEGIN %s-----\nDUMMY\n-----END %s-----\n' "OPENSSH PRIVATE KEY" "OPENSSH PRIVATE KEY" > "$PKEY"; chmod 600 "$PKEY"
PKH="$T/known_hosts_aicc_prod_cp"; echo "203.0.113.9 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItestonlytestonlytestonlytestonlytestonlytest" > "$PKH"
DEST="$T/aicc-offhost-backups-production"
t=$(now); env HOME="$T/home" PATH="$STUB:$PATH" bash "$HERE/pull-offhost.sh" --env production --stage-ip 203.0.113.9 --expect-id "$ID32" --key "$PKEY" --known-hosts "$PKH" --dest "$DEST" > "$T/pull.out"; step offhost_pull "$(el "$t" "$(now)")"
grep -E "SUCCESS|WARNING|FAILURE" "$T/pull.out" | sed 's/^[^ ]*  //' | head -6 | sed 's/^/  /'
ACK="$BK/offhost-ack.json"
echo "  ack: $(jq -c '{verified,puller,set_ts}' "$ACK")"
COLL="$(cd "$INFRA/aicc-ops" && python3.12 - "$BK" <<'PY'
import json, sys, time
sys.path.insert(0, ".")
from aicc_ops.collectors import backups
d = sys.argv[1]
cfg = {"dir": d, "patterns": ["aicc_cp-*.sql.gz", "aicc-files-*.tar.gz"], "status_file": d + "/status.json", "offhost_ack_file": d + "/offhost-ack.json"}
m = backups.collect({}, cfg, {}, time.time()).metrics
keep = ("backup.status_ok", "backup.newest_age_s", "backup.restore_check_ok", "backup.offhost_present", "backup.offhost_verified", "backup.offhost_age_s", "backup.offhost_reason")
print(json.dumps({k: (round(m[k], 1) if isinstance(m[k], float) else m[k]) for k in keep if k in m}))
PY
)" || COLL='{"error":"collector probe failed (see report)"}'
echo "  AICC Ops backup collector -> $COLL"

echo "== 4 aicc-restore verify + scratch (production flag) =="
RS() { env AICC_TEST_HARNESS=1 AICC_IDENTITY_FILE="$IDF" MYSQL_BIN="$LOCALMY/mysql" bash "$HERE/aicc-restore.sh" "$@" --production --mysql-defaults-file "$T/root.cnf"; }
printf '[client]\nuser=root\nsocket=%s/s.sock\n' "$M" > "$T/root.cnf"; chmod 600 "$T/root.cnf"
DSHA="$(shasum -a 256 "$DEST/$DUMP" | cut -d' ' -f1)"; FSHA="$(shasum -a 256 "$DEST/$FARC" | cut -d' ' -f1)"
# aicc-restore verify allows archive members only under the REAL host paths (/srv/aicc/shared, /etc/aicc-edge ...); this isolated layout uses temp directories, so only the DUMP is verified
# here (hash of the off-host copy, gzip, trailer) and the files archive is checked below by its own hash and by reading the host_identity out of pointers.txt.
t=$(now); RS verify --dump "$DEST/$DUMP" --files none --sha256 "$DSHA" >/dev/null 2>&1 && VERIFY=ok || VERIFY=FAILED; step restore_verify_dump "$(el "$t" "$(now)")"
echo "  verify of the OFF-HOST dump (sha256 given out of band, gzip -t, completion trailer): $VERIFY"
[ "$(shasum -a 256 "$DEST/$FARC" | cut -d' ' -f1)" = "$FSHA" ] && gzip -t "$DEST/$FARC" && FARC_OK=ok || FARC_OK=FAILED
ARCH_ID="$(tar -xOzf "$DEST/$FARC" pointers.txt | sed -n 's/^host_identity //p')"; [ "$ARCH_ID" = "$(tr '\n' ' ' < "$IDF" | sed 's/ *$//')" ] && ARCH_ID_OK=ok || ARCH_ID_OK=FAILED
echo "  files archive of the off-host copy: hash+gzip $FARC_OK; host_identity inside equals the production identity: $ARCH_ID_OK"
RS fingerprint --out "$T/pre.fp" >/dev/null 2>&1 || true
t=$(now); RS scratch --dump "$DEST/$DUMP" --sha256 "$DSHA" --fingerprint-out "$T/scratch.fp" >/dev/null 2>&1 || true; step restore_scratch_load_and_fingerprint "$(el "$t" "$(now)")"
SCRATCH_DIFF="$(diff "$T/pre.fp" "$T/scratch.fp" 2>/dev/null | grep -c '^[<>]' || true)"
echo "  scratch copy of the OFF-HOST dump vs the source database: $SCRATCH_DIFF differing fingerprint lines ($(wc -l < "$T/pre.fp" | tr -d ' ') tables)"

echo "== 5 disaster in the isolated target and recovery from the off-host copy =="
UP_BEFORE="$(find "$SH/uploads" -type f | wc -l | tr -d ' ')"; UP_SUM_BEFORE="$(find "$SH/uploads" -type f | sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1)"
T0=$(now)
"${RT[@]}" -e "DROP DATABASE aicc_cp"; rm -rf "$SH/uploads" "$SH/wp-config.php"; step disaster "$(el "$T0" "$(now)")"
t=$(now); "${RT[@]}" -e "CREATE DATABASE aicc_cp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci"; gzip -dc "$DEST/$DUMP" | "$LOCALMY/mysql" --protocol=socket --socket="$M/s.sock" -uroot --binary-mode aicc_cp; step db_restore "$(el "$t" "$(now)")"
t=$(now); mkdir -p "$T/xtract"; tar -xzpf "$DEST/$FARC" -C "$T/xtract" --exclude=pointers.txt; mkdir -p "$SH"; cp -R "$T/xtract${SH}/uploads" "$SH/uploads"; cp "$T/xtract${SH}/wp-config.php" "$SH/wp-config.php"; step files_restore "$(el "$t" "$(now)")"
t=$(now); RS fingerprint --out "$T/post.fp" >/dev/null 2>&1; step fingerprint_after "$(el "$t" "$(now)")"
T1=$(now); RTO="$(el "$T0" "$T1")"
POST_DIFF="$(diff "$T/pre.fp" "$T/post.fp" 2>/dev/null | grep -c '^[<>]' || true)"
UP_AFTER="$(find "$SH/uploads" -type f | wc -l | tr -d ' ')"; UP_SUM_AFTER="$(find "$SH/uploads" -type f | sort | xargs shasum -a 256 | shasum -a 256 | cut -d' ' -f1)"
echo "  recovered database vs pre-disaster fingerprint: $POST_DIFF differing lines; uploads $UP_BEFORE -> $UP_AFTER files, content hash equal: $([ "$UP_SUM_BEFORE" = "$UP_SUM_AFTER" ] && echo yes || echo NO); wp-config.php present: $([ -s "$SH/wp-config.php" ] && echo yes || echo NO)"
echo "  isolated-target RTO (disaster -> data proven back): ${RTO}s"

OK=true; { [ "$BK_OK" = ok ] && [ "$RESTORE_SMOKE" = ok ] && [ "$VERIFY" = ok ] && [ "$FARC_OK" = ok ] && [ "$ARCH_ID_OK" = ok ] && [ "$SCRATCH_DIFF" = 0 ] && [ "$POST_DIFF" = 0 ] && [ "$UP_BEFORE" = "$UP_AFTER" ] && [ "$UP_SUM_BEFORE" = "$UP_SUM_AFTER" ] && [ -s "$SH/wp-config.php" ] && jq -e '.verified == true' "$ACK" >/dev/null; } || OK=false
OUTR="${REPORT:-/dev/stdout}"
jq -n --arg ok "$OK" --arg shape "$SHAPE_KIND" --argjson tables "$TABLES" --arg mb "$DBMB" --argjson steps "$STEPS" --arg dump "$DUMP" --arg coll "$COLL" --arg rto "$RTO" --arg verify "$VERIFY" --arg farc "$FARC_OK" --arg aid "$ARCH_ID_OK" \
  --arg sd "$SCRATCH_DIFF" --arg pd "$POST_DIFF" --arg ptr "$(echo "$PTR_ID" | sed "s/$ID32/<id>/")" \
  '{rehearsal:"production-mode backup -> off-host pull -> restore, isolated throwaway target (Mac)",passed:($ok=="true"),identity_used:"AICC_ENV=production, AICC_HOSTNAME=www.copilt.org, random id",pointers_host_identity:$ptr,
    data_shape:$shape,tables:$tables,db_size_mb:($mb|tonumber),backup_file:$dump,aicc_ops_backup_collector:($coll|fromjson? // $coll),restore_verify_offhost_dump:$verify,files_archive_hash_and_identity:($farc + "/" + $aid),
    scratch_copy_vs_source_differing_lines:($sd|tonumber),recovered_vs_pre_disaster_differing_lines:($pd|tonumber),isolated_rto_seconds:($rto|tonumber),steps:$steps,
    not_covered:["aicc-restore live and the archive-member checks of aicc-restore verify (real host paths only; live was timed as dr-drill-3.json in staging mode)","systemd, filesystem layout and host hardware (these are Mac timings)","a Mac that sleeps","loss of the whole Droplet"]}' > "$OUTR"
[ -z "$REPORT" ] || echo "report: $REPORT"
echo "REHEARSAL $([ "$OK" = true ] && echo PASSED || echo FAILED)"
[ "$OK" = true ]
