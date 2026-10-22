#!/usr/bin/env bash
# TIMED disaster-recovery drill for the STAGING Control Plane. Runs ON THE OWNER'S MAC and drives the host over SSH. It simulates the loss of the data tier
# (database, uploads, wp-config.php), then recovers it from the OFF-HOST copy that lives on the Mac, and measures every step.
#
#   infra/backup/dr-drill.sh --stage-ip <IPV4> --stage-host stage.copilt.org --stage-id <32 hex> --i-understand-this-wipes-staging-data \
#       [--key ~/.ssh/aicc_cp_stage] [--offhost-key ~/.ssh/aicc_cp_stage_offhost] [--dest ~/aicc-offhost-backups-stage] [--report FILE] [--dry-run]
#   PRODUCTION-MODE drill (the promoted host, ONLY while it holds no customer data, i.e. before launch; docs/cutover/production-promotion.md):
#   infra/backup/dr-drill.sh --env production --stage-ip <IPV4> --stage-host www.copilt.org --stage-id <32 hex> --tls dark|public --known-hosts FILE \
#       --i-understand-this-wipes-production-data --key ~/.ssh/aicc_cp_prod_operator --offhost-key ~/.ssh/aicc_cp_prod_offhost [--dest ~/aicc-offhost-backups-production]
#     refuses unless the host identity says production with this name and id, the pinned host key matches, and the database holds NO customer and NO order (checked on the host through WP-CLI;
#     if that cannot be determined the drill refuses). --tls dark = the edge still serves Caddy's internal certificate (curl -k for the two HTTP proofs), public = a public CA certificate.
#
# Phases (T = wall clock on this Mac):
#   0 prepare   verify the staging identity (host + id), refuse production addresses/names/keys, record the live state
#   1 freeze    stop the cron timer and PHP-FPM so nothing writes; take a fresh backup on the host (the ROLLBACK PATH for this drill); fingerprint the live DB
#   2 offhost   pull that backup to the Mac with the RESTRICTED key (verified checksums, ack) -- the copy the recovery will use is the one that LIVES OFF the host
#   3 disaster  DROP the database, delete uploads and wp-config.php on the host (the simulated loss)           <== RTO clock T0 starts here
#   4 recover   copy the Mac's verified copy back, `aicc-restore live` (verify, quiesce, DB, files, perms, start, health gate, sanity)
#   5 prove     fingerprint the recovered DB and compare it table by table with the pre-disaster fingerprint (rows + CHECKSUM TABLE); uploads/config present
#                                                                                                             <== RTO clock T1 stops here
#   6 clean up  remove the temporary restore-input directory and fingerprint files; report leftovers and the state of services/timers (reported in the JSON, not part of the pass condition); write the report
# The report (JSON) holds start/end times, every step in seconds, the RTO, and the fingerprints' comparison result. A failed comparison is a FAILED drill.
# Not covered (stated in README-backup.md): loss of the whole Droplet (needs a new host: install-stack + this restore), loss of the Mac copy, a corrupted
# backup that passes its checksum, point-in-time recovery (binary logging is off).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../provision/lib/ip-guard.sh"
STAGE_IP=""; STAGE_HOST=""; STAGE_ID=""; KEY=""; OKEY=""; DEST=""; REPORT=""; YES=0; DRY=0; ENVN="stage"; TLS=""; KNOWN_HOSTS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --stage-ip) STAGE_IP="${2:-}"; shift 2 ;; --stage-host) STAGE_HOST="${2:-}"; shift 2 ;; --stage-id) STAGE_ID="${2:-}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;; --offhost-key) OKEY="${2:-}"; shift 2 ;; --dest) DEST="${2:-}"; shift 2 ;; --report) REPORT="${2:-}"; shift 2 ;;
    --i-understand-this-wipes-staging-data) [ "$ENVN" = production ] && { echo "REFUSED: use --i-understand-this-wipes-production-data with --env production" >&2; exit 3; }; YES=1; shift ;;
    --i-understand-this-wipes-production-data) YES=2; shift ;; --dry-run) DRY=1; shift ;;
    --env) ENVN="${2:-}"; shift 2 ;; --tls) TLS="${2:-}"; shift 2 ;; --known-hosts) KNOWN_HOSTS="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,24p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
refuse() { echo "REFUSED: $*" >&2; exit 3; }
case "$ENVN" in stage|production) ;; *) echo "--env must be stage or production" >&2; exit 2 ;; esac
if [ "$ENVN" = production ]; then
  [ -n "$OKEY" ] || OKEY="$HOME/.ssh/aicc_cp_prod_offhost"; [ -n "$DEST" ] || DEST="$HOME/aicc-offhost-backups-production"
  [ -n "$KEY" ] || { echo "--env production needs --key (the production operator key, aicc_cp_prod*)" >&2; exit 2; }
  case "$TLS" in dark|public) ;; *) echo "--env production needs --tls dark|public" >&2; exit 2 ;; esac
else
  [ -n "$KEY" ] || KEY="$HOME/.ssh/aicc_cp_stage"; [ -n "$OKEY" ] || OKEY="$HOME/.ssh/aicc_cp_stage_offhost"; [ -n "$DEST" ] || DEST="$HOME/aicc-offhost-backups-stage"
fi
[ -n "$STAGE_IP" ] && [ -n "$STAGE_HOST" ] && [ -n "$STAGE_ID" ] || { echo "usage: --stage-ip --stage-host --stage-id (nothing is defaulted)" >&2; exit 2; }
[[ "$STAGE_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || refuse "--stage-ip must be a literal IPv4 address"
for d in 139.59.157.231 185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153; do [ "$STAGE_IP" = "$d" ] && refuse "$STAGE_IP is a production/public address"; done
aicc_ip_guard "$STAGE_IP" "--stage-ip " || exit 3
if [ "$ENVN" = production ]; then
  [ "$STAGE_HOST" = "www.copilt.org" ] || refuse "--env production needs --stage-host www.copilt.org"
  case "$(basename "$KEY")" in aicc_cp_prod*) ;; *) refuse "the production operator key must be named aicc_cp_prod*" ;; esac
  case "$(basename "$OKEY")" in aicc_cp_prod_offhost*) ;; *) refuse "the production pull key must be named aicc_cp_prod_offhost*" ;; esac
  case "$KEY$OKEY" in *aicc_digitalocean_prod*|*aicc_cp_stage*) refuse "never use the API Droplet's or the staging key for a production drill" ;; esac
  [ -s "$KNOWN_HOSTS" ] || refuse "--env production needs --known-hosts FILE (the pinned host key)"
  ssh-keygen -F "$STAGE_IP" -f "$KNOWN_HOSTS" >/dev/null 2>&1 || refuse "the pinned known-hosts file has no entry for $STAGE_IP"
  [ "$YES" = 2 ] || [ "$DRY" = 1 ] || refuse "this drill DELETES the PRODUCTION database, uploads and wp-config.php before restoring them: pass --i-understand-this-wipes-production-data (only valid before the first customer)"
else
  [[ "$STAGE_HOST" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || refuse "--stage-host must be a stage*.copilt.org name"
  case "$KEY$OKEY" in *aicc_digitalocean_prod*|*aicc_cp_prod*) refuse "never use a production key" ;; esac
  [ "$YES" = 1 ] || [ "$DRY" = 1 ] || refuse "this drill DELETES the staging database, uploads and wp-config.php before restoring them: pass --i-understand-this-wipes-staging-data"
fi
[[ "$STAGE_ID" =~ ^[0-9a-f]{32}$ ]] || refuse "--stage-id must be 32 hex characters"
[ -f "$KEY" ] && [ -f "$OKEY" ] || { echo "key files not found" >&2; exit 2; }
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; [ -n "$REPORT" ] || REPORT="$HOME/Downloads/AICC-cutover-evidence/linux-stage/dr-drill-$STAMP.json"
if [ "$ENVN" = production ]; then KH="$KNOWN_HOSTS"; SHK=yes; else KH="$HOME/.ssh/known_hosts_aicc_stage"; SHK=accept-new; fi
SSHO=(-i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking="$SHK" -o UserKnownHostsFile="$KH" -o NumberOfPasswordPrompts=0)
if [ "$ENVN" = production ]; then RFLAG="--production"; WANT_ENV=production; CURLK=""; [ "$TLS" = dark ] && CURLK="-k"; else RFLAG=""; WANT_ENV=staging; CURLK=""; fi
rem() { ssh "${SSHO[@]}" "aicc@$STAGE_IP" "$@"; }
if [ "$DRY" = 1 ]; then echo "DRY-RUN: would run phases 0-6 against $STAGE_HOST ($STAGE_IP); report $REPORT. Nothing sent."; exit 0; fi

now() { python3 -c 'import time;print("%.3f"%time.time())'; }
el() { python3 -c "print('%.1f'%($2-$1))"; }
STEPS="[]"; step() { STEPS="$(jq -c --arg n "$1" --argjson s "$2" '. + [{step:$n,seconds:$s}]' <<<"$STEPS")"; echo "  [$1] $2 s"; }
T_ALL0="$(now)"
echo "== phase 0: prepare =="
ident="$(rem 'cat /etc/aicc-stage-identity')" || { echo "cannot read the host identity" >&2; exit 1; }
echo "$ident" | grep -q "^AICC_ENV=${WANT_ENV}\$" || refuse "host does not say AICC_ENV=$WANT_ENV"
echo "$ident" | grep -q "^AICC_HOSTNAME=${STAGE_HOST}\$" || refuse "host identity hostname differs"
echo "$ident" | grep -q "^AICC_STAGE_ID=${STAGE_ID}\$" || refuse "host identity id differs"
if [ "$ENVN" = production ]; then
  # a production drill is only legitimate while the database holds no customer and no order; fail closed when the answer cannot be read
  CUST="$(rem 'sudo /usr/local/sbin/aicc-wp user list --role=customer --format=count' 2>/dev/null | tr -d ' \r\n')" || CUST=""
  ORD="$(rem 'sudo bash -s' 2>/dev/null <<'EOS' | tr -d ' \r\n'
set -e
n=$(mysql --no-defaults -N -e "SELECT COUNT(*) FROM aicc_cp.wp_posts WHERE post_type IN ('shop_order','shop_order_refund')")
if [ "$(mysql --no-defaults -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='aicc_cp' AND table_name='wp_wc_orders'")" = 1 ]; then h=$(mysql --no-defaults -N -e "SELECT COUNT(*) FROM aicc_cp.wp_wc_orders"); else h=0; fi
echo $((n + h))
EOS
)" || ORD=""
  [[ "$CUST" =~ ^[0-9]+$ && "$ORD" =~ ^[0-9]+$ ]] || refuse "cannot determine whether the production database holds customers or orders: the drill refuses"
  [ "$CUST" = 0 ] && [ "$ORD" = 0 ] || refuse "the production database holds $CUST customer(s) and $ORD order row(s): a destructive drill is only allowed before the first customer"
fi
echo "identity verified; services: $(rem 'systemctl is-active aicc-edge php8.3-fpm mysql aicc-ops | tr "\n" " "')"
rem 'sudo mkdir -p /srv/aicc/restore-in && sudo chmod 700 /srv/aicc/restore-in'

# Whatever happens after this point, bring the services back (the freeze must never leave staging down) -- unless the DISASTER phase has started: then the recovery is the job.
DISASTER_STARTED=0
unfreeze() {
  [ "$DISASTER_STARTED" = 1 ] && return 0
  rem 'sudo systemctl start php8.3-fpm aicc-wp-cron.timer aicc-backup.timer' >/dev/null 2>&1 || true
}
trap unfreeze EXIT
echo "== phase 1: freeze + fresh backup (the rollback path) + fingerprint =="
# the hourly backup timer is stopped for the drill: a scheduled run at :17 would otherwise become 'the newest set' and break the drill's manual-set check
t=$(now); rem 'sudo systemctl stop aicc-backup.timer aicc-wp-cron.timer aicc-wp-cron.service php8.3-fpm'; step freeze_writers "$(el "$t" "$(now)")"
# a marker file with random content proves that UPLOADED DATA (not just an empty directory) comes back byte for byte
MARK="dr-marker-$STAMP.txt"; MARK_SUM="$(openssl rand -hex 24)"
printf '%s\n' "$MARK_SUM" | rem "sudo -u aicc-cp tee /srv/aicc/shared/uploads/$MARK >/dev/null"
MARK_BEFORE="$(rem "sudo sha256sum /srv/aicc/shared/uploads/$MARK | cut -d' ' -f1")"
UPLOADS_BEFORE="$(rem 'sudo find /srv/aicc/shared/uploads -type f | wc -l' | tr -d ' ')"
t=$(now); rem 'sudo /usr/local/sbin/aicc-backup --label manual' >/dev/null 2>&1; step fresh_backup "$(el "$t" "$(now)")"
t=$(now); rem "sudo /usr/local/sbin/aicc-restore fingerprint $RFLAG --out /srv/aicc/restore-in/pre.fp" >/dev/null 2>&1; step fingerprint_before "$(el "$t" "$(now)")"
PRE_TABLES="$(rem 'sudo sh -c "wc -l < /srv/aicc/restore-in/pre.fp"' | tr -d ' ')"

echo "== phase 2: off-host pull to the Mac (restricted key) =="
t=$(now)
if [ "$ENVN" = production ]; then bash "$HERE/pull-offhost.sh" --env production --expect-id "$STAGE_ID" --known-hosts "$KNOWN_HOSTS" --stage-ip "$STAGE_IP" --stage-host "$STAGE_HOST" --key "$OKEY" --dest "$DEST" >/dev/null
else bash "$HERE/pull-offhost.sh" --stage-ip "$STAGE_IP" --stage-host "$STAGE_HOST" --key "$OKEY" --dest "$DEST" >/dev/null; fi
step offhost_pull "$(el "$t" "$(now)")"
STATUS="$(rem 'sudo cat /srv/aicc/backups/status.json')"
DUMP="$(jq -r '.last_success.db_dump_file' <<<"$STATUS")"; FARC="$(jq -r '.last_success.files_archive_file' <<<"$STATUS")"
# names from the host are validated with the same strict patterns the pull uses BEFORE they touch a path or a remote command
[[ "$DUMP" =~ ^aicc_cp-[0-9]{8}T[0-9]{6}Z-manual\.sql\.gz$ ]] || { echo "the newest backup is not the drill's manual one" >&2; exit 1; }
[[ "$FARC" =~ ^aicc-files-[0-9]{8}T[0-9]{6}Z-manual\.tar\.gz$ ]] || { echo "the newest files archive name is not the drill's manual one" >&2; exit 1; }
[ -f "$DEST/$DUMP" ] && [ -f "$DEST/$FARC" ] || { echo "the Mac does not hold the drill's backup set" >&2; exit 1; }
LOCAL_D="$(shasum -a 256 "$DEST/$DUMP" | cut -d' ' -f1)"; LOCAL_F="$(shasum -a 256 "$DEST/$FARC" | cut -d' ' -f1)"
echo "the Mac holds $DUMP ($LOCAL_D) and $FARC"

echo "== phase 3: DISASTER (RTO clock starts) =="
DISASTER_STARTED=1
T0="$(now)"; T0_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
rem 'sudo bash -s' <<'EOS'
set -e
mysql --no-defaults -e "DROP DATABASE aicc_cp"
rm -rf /srv/aicc/shared/uploads /srv/aicc/shared/wp-config.php
echo "data tier destroyed: database dropped, uploads and wp-config.php removed"
EOS
step disaster "$(el "$T0" "$(now)")"

echo "== phase 4: recover from the Mac's copy =="
t=$(now)
# stream the Mac's verified copy back through ssh into the root-only restore directory (no world-writable /tmp staging path)
for f in "$DUMP" "$FARC"; do rem "sudo tee /srv/aicc/restore-in/$f >/dev/null && sudo chmod 600 /srv/aicc/restore-in/$f" < "$DEST/$f"; done
step copy_back_to_host "$(el "$t" "$(now)")"
t=$(now)
rem "sudo /usr/local/sbin/aicc-restore scratch $RFLAG --dump /srv/aicc/restore-in/$DUMP --sha256 $LOCAL_D --fingerprint-out /srv/aicc/restore-in/scratch.fp" >/dev/null 2>&1 || echo "WARNING: scratch load of the Mac copy failed" >&2
step offhost_copy_scratch_check "$(el "$t" "$(now)")"
STRICT_DIFF="$(rem 'sudo diff /srv/aicc/restore-in/pre.fp /srv/aicc/restore-in/scratch.fp | grep -c "^[<>]" || true')"
t=$(now)
RC=0
rem "sudo /usr/local/sbin/aicc-restore live $RFLAG $([ "$ENVN" = production ] && echo --confirm-production-restore) --dump /srv/aicc/restore-in/$DUMP --sha256 $LOCAL_D --files /srv/aicc/restore-in/$FARC --files-sha256 $LOCAL_F --yes-replace-live --no-safety-backup --report /srv/aicc/restore-in/restore-report.json" >/dev/null || RC=$?
step aicc_restore_live "$(el "$t" "$(now)")"
REPORT_REMOTE="$(rem 'sudo cat /srv/aicc/restore-in/restore-report.json')"

echo "== phase 5: prove the data came back =="
t=$(now); rem "sudo /usr/local/sbin/aicc-restore fingerprint $RFLAG --out /srv/aicc/restore-in/post.fp" >/dev/null 2>&1; step fingerprint_after "$(el "$t" "$(now)")"
DIFFN="$(rem 'sudo diff /srv/aicc/restore-in/pre.fp /srv/aicc/restore-in/post.fp | grep -c "^[<>]" || true')"
DIFF_TABLES="$(rem 'sudo diff /srv/aicc/restore-in/pre.fp /srv/aicc/restore-in/post.fp | grep "^[<>]" | cut -f1 | sed "s/^[<>] //" | sort -u | tr "\n" " "')"
# Tables the APPLICATION itself rewrites on its first requests after start-up (cron schedule, transients, sessions, scheduler logs, operational counters): allowed to differ
# in the LIVE comparison only. Everything else must match exactly, and the scratch comparison of the off-host copy (above) has NO exceptions.
VOLATILE='^(wp_options|wp_actionscheduler_(actions|claims|groups|logs)|wp_woocommerce_sessions|wp_usermeta|wp_aicc_ops_counters|wp_aicc_[a-z_]*(throttle|counter|log)[a-z_]*)$'
UNEXPECTED="$(for t in $DIFF_TABLES; do if printf '%s\n' "$t" | grep -Evq "$VOLATILE"; then printf '%s ' "$t"; fi; done; true)"
POST_TABLES="$(rem 'sudo sh -c "wc -l < /srv/aicc/restore-in/post.fp"' | tr -d ' ')"
UPLOADS_AFTER="$(rem 'sudo find /srv/aicc/shared/uploads -type f | wc -l' | tr -d ' ')"
FILES_OK="$(rem 'sudo test -s /srv/aicc/shared/wp-config.php && echo yes || echo no')"
MARK_AFTER="$(rem "sudo sha256sum /srv/aicc/shared/uploads/$MARK 2>/dev/null | cut -d' ' -f1")"
[ -n "$MARK_BEFORE" ] && [ "$MARK_BEFORE" = "$MARK_AFTER" ] || FILES_OK=no          # the marker file is byte-identical after the recovery
[ "$UPLOADS_BEFORE" = "$UPLOADS_AFTER" ] || FILES_OK=no          # the same NUMBER of uploaded files must be back, not just an empty directory
HEALTH="$(curl -s $CURLK -o /dev/null -w '%{http_code}' --max-time 20 --resolve "$STAGE_HOST:443:$STAGE_IP" "https://$STAGE_HOST/healthz")"
APP="$(curl -s $CURLK -o /dev/null -w '%{http_code}' --max-time 30 --resolve "$STAGE_HOST:443:$STAGE_IP" "https://$STAGE_HOST/pricing/")"
T1="$(now)"; T1_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RTO="$(el "$T0" "$T1")"

echo "== phase 6: clean up =="
rem 'sudo rm -rf /srv/aicc/restore-in'
rem "sudo rm -f /srv/aicc/shared/uploads/$MARK"
rem 'sudo systemctl start aicc-backup.timer' >/dev/null 2>&1 || true
LEFT="$(rem 'sudo ls /srv/aicc/restore-in 2>/dev/null | wc -l | tr -d " "; sudo mysql --no-defaults -N -e "SHOW DATABASES" 2>/dev/null | grep -c "^aicc_dr" || true' | tr '\n' ' ')"
UNITS="$(rem 'systemctl is-active php8.3-fpm mysql aicc-edge aicc-ops aicc-wp-cron.timer aicc-backup.timer | tr "\n" " "')"

OK=true; { [ "$RC" = 0 ] && [ "$STRICT_DIFF" = 0 ] && [ -z "$UNEXPECTED" ] && [ "$PRE_TABLES" = "$POST_TABLES" ] && [ "$FILES_OK" = yes ] && [ "$HEALTH" = 200 ] && [ "$APP" = 200 ]; } || OK=false
mkdir -p "$(dirname "$REPORT")"
jq -n --arg envn "$ENVN" --arg ok "$OK" --arg t0 "$T0_ISO" --arg t1 "$T1_ISO" --argjson rto "$RTO" --argjson steps "$STEPS" --argjson restore "$REPORT_REMOTE" \
  --arg pre "$PRE_TABLES" --arg post "$POST_TABLES" --arg diffn "$DIFFN" --arg strict "$STRICT_DIFF" --arg dtabs "$DIFF_TABLES" --arg unexp "$UNEXPECTED" --arg files "$FILES_OK" --arg health "$HEALTH" --arg app "$APP" --arg units "$UNITS" --arg left "$LEFT" \
  --arg dump "$DUMP" --arg farc "$FARC" --arg dsha "$LOCAL_D" --arg fsha "$LOCAL_F" --argjson total "$(el "$T_ALL0" "$(now)")" --argjson ub "${UPLOADS_BEFORE:-0}" --argjson ua "${UPLOADS_AFTER:-0}" \
  '{drill:($envn + " data-tier loss, recovery from the OFF-HOST (Mac) copy"),environment:$envn,passed:($ok=="true"),disaster_declared_at:$t0,recovered_and_proven_at:$t1,rto_seconds:$rto,drill_total_seconds:$total,
    backup_set:{dump:$dump,files:$farc,dump_sha256:$dsha,files_sha256:$fsha},data_correctness:{tables_before:($pre|tonumber),tables_after:($post|tonumber),offhost_copy_vs_before_strict_differing_lines:($strict|tonumber),live_after_recovery_differing_lines:($diffn|tonumber),live_after_recovery_differing_tables:$dtabs,unexpected_differing_tables:$unexp},
    uploads_and_wpconfig_present:$files,uploads_files_before:$ub,uploads_files_after:$ua,healthz_http:$health,pricing_http:$app,services_after:$units,leftovers:$left,steps:$steps,aicc_restore_report:$restore}' > "$REPORT"
echo; echo "DRILL $([ "$OK" = true ] && echo PASSED || echo FAILED): RTO ${RTO}s (disaster declared $T0_ISO, proven $T1_ISO); off-host copy vs before (strict): $STRICT_DIFF differing lines; live after recovery differs in: ${DIFF_TABLES:-none} (unexpected: ${UNEXPECTED:-none}); report: $REPORT"
[ "$OK" = true ]
