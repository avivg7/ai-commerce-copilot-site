#!/usr/bin/env bash
# Promotes THIS host (the existing staging Droplet aicc-cp-stage) IN PLACE to the initial PRODUCTION Control Plane + edge host. Runs ON THE HOST, as root.
# Design, decisions and the numbered operator runbook: docs/cutover/production-promotion.md. Nothing here changes DNS; the promoted host stays "dark" (production identity,
# production database and configuration, edge rendered with `tls internal` for www/apex) until the owner's final cutover gate.
#
#   sudo promote-to-production.sh check          --expect-stage-id ID [--owner-secrets-dir D]        read-only gates, nothing is changed (also what --dry-run prints first)
#   sudo promote-to-production.sh set-owner-secret entitlement-webhook|activation-proof [--stdin]    hidden prompt -> /etc/aicc/owner-secrets-incoming/<name>.secret (0600)
#   sudo promote-to-production.sh apply          --confirm-production --expect-stage-id ID --caddyfile FILE --ops-config FILE [--dry-run] [--only s1,s2] [--bundle-dir D]
#        steps (default order): gate bundle quiesce identity secrets backups db wpconfig edge ops          services stay STOPPED except mysql/sshd/aicc-ops
#   sudo promote-to-production.sh start          [--confirm-production]                                starts php-fpm, the dark edge, cron + backup timers, restarts aicc-ops
#   sudo promote-to-production.sh wp-install     --admin-user U --admin-email E                       fresh WordPress install on the new empty database (password typed at a hidden prompt)
#   sudo promote-to-production.sh final-edge     --confirm-cutover --caddyfile FILE --expect-ip IP    CUTOVER DAY ONLY: automatic public-CA HTTPS render + restart (after DNS points here)
#   sudo promote-to-production.sh dark-edge      --caddyfile FILE                                      back to the tls-internal waiting render (cutover rollback point on the host)
#   sudo promote-to-production.sh rollback       --bundle DIR --confirm-rollback                      puts the STAGING identity/config/database back from the rollback bundle
#
# Refuses (exit 3, nothing written) unless ALL of: root (or the test harness); --confirm-production; the host identity still says AICC_ENV=staging with AICC_HOSTNAME=stage.copilt.org and
# AICC_STAGE_ID equal to --expect-stage-id (typed by the operator: proves the right machine); the OWNER-PROVIDED secrets exist in the incoming directory (entitlement webhook secret, activation
# proof key: mode 0600/0400, root-owned, >= 32 characters, >= 12 distinct characters; they are NEVER generated here); the Caddyfile is the pre-cutover production render; the AICC Ops config
# is the production one. Every destructive step happens only after the rollback bundle (identity, configuration, secrets, the whole backup directory, a fresh VERIFIED database dump) exists.
# Secrets are never printed. Test seams (flags, paths only): --socket --mysql-bin --backup-cmd --wp-bin --preflight-cmd --ops-cmd --dns-cmd; with AICC_TEST_HARNESS=1 + AICC_ROOT_PREFIX every
# absolute path is re-rooted (infra/stack-tests/test_promote.sh). Exit codes: 0 ok, 1 a step failed, 2 usage, 3 refused.
set -euo pipefail
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SELF/lib/common.sh"

ACTION="${1:-}"; [ $# -gt 0 ] && shift
CONFIRM=0; CONFIRM_CUTOVER=0; CONFIRM_ROLLBACK=0; EXPECT_ID=""; CADDYFILE=""; OPSCONF=""; ONLY=""; BUNDLE_ARG=""; STDIN=0
INCOMING_ARG=""; SOCKET="/run/mysqld/mysqld.sock"; MYSQL="mysql"; BACKUP_CMD="/usr/local/sbin/aicc-backup"; WP_BIN="/usr/local/sbin/aicc-wp"
PREFLIGHT_CMD="/usr/local/sbin/aicc-edge-preflight"; OPS_CMD="/opt/aicc-ops/bin/aicc-ops"; DNS_CMD=""; ADMIN_USER=""; ADMIN_EMAIL=""; EXPECT_IP=""; SECRET_NAME=""
STEPS_DEFAULT="gate bundle quiesce identity secrets backups db wpconfig edge ops"
case "$ACTION" in set-owner-secret) SECRET_NAME="${1:-}"; [ $# -gt 0 ] && shift ;; esac
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) AICC_DRY_RUN=1; shift ;;
    --confirm-production) CONFIRM=1; shift ;;
    --confirm-cutover) CONFIRM_CUTOVER=1; shift ;;
    --confirm-rollback) CONFIRM_ROLLBACK=1; shift ;;
    --expect-stage-id) EXPECT_ID="${2:-}"; shift 2 ;;
    --caddyfile) CADDYFILE="${2:-}"; shift 2 ;;
    --ops-config) OPSCONF="${2:-}"; shift 2 ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    --bundle-dir|--bundle) BUNDLE_ARG="${2:-}"; shift 2 ;;
    --owner-secrets-dir) INCOMING_ARG="${2:-}"; shift 2 ;;
    --stdin) STDIN=1; shift ;;
    --socket) SOCKET="${2:-}"; shift 2 ;;
    --mysql-bin) MYSQL="${2:-}"; shift 2 ;;
    --backup-cmd) BACKUP_CMD="${2:-}"; shift 2 ;;
    --wp-bin) WP_BIN="${2:-}"; shift 2 ;;
    --preflight-cmd) PREFLIGHT_CMD="${2:-}"; shift 2 ;;
    --ops-cmd) OPS_CMD="${2:-}"; shift 2 ;;
    --dns-cmd) DNS_CMD="${2:-}"; shift 2 ;;
    --admin-user) ADMIN_USER="${2:-}"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="${2:-}"; shift 2 ;;
    --expect-ip) EXPECT_IP="${2:-}"; shift 2 ;;
    -h|--help) sed -n 2,26p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done
export AICC_DRY_RUN
refuse() { printf '%s  REFUSED %s\n' "$(_ts)" "$*" >&2; exit 3; }
fail() { printf '%s  FAILED  %s\n' "$(_ts)" "$*" >&2; exit 1; }

# ---- paths (the contract with install-stack.sh, backup, release and the edge) ------------------------------------------------------------
IDENT=/etc/aicc-stage-identity            # the file name is historical; it carries AICC_ENV=staging|production
SECRETS=/etc/aicc/secrets
INCOMING="${INCOMING_ARG:-/etc/aicc/owner-secrets-incoming}"
BKCNF=/etc/aicc/backup.cnf
WPCFG=/srv/aicc/shared/wp-config.php
EDGE_DIR=/etc/aicc-edge
OPS_TOML=/etc/aicc-ops/aicc-ops.toml
BACKUPS=/srv/aicc/backups
BUNDLE_ROOT=/var/backups/aicc-promotion
STATE_DIR=/var/lib/aicc/promotion
DROPIN_DIR=/etc/systemd/system/aicc-edge.service.d
DROPIN=$DROPIN_DIR/10-production.conf
DROPIN_SRC="$SELF/../systemd/production/aicc-edge.service.d/10-production.conf"
CERT_DROPIN_SRC="$SELF/../systemd/production/aicc-cert-expiry.service.d/10-production.conf"
PROD_HOST=www.copilt.org
STAGE_HOST=stage.copilt.org
SECRET_NAMES="entitlement-webhook activation-proof"

mode_of_file() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
owner_uid() { stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1"; }
ident_val() { sed -n "s/^$1=//p" "$(P "$IDENT")" 2>/dev/null | head -1; }
ident_env() { ident_val AICC_ENV; }
codeonly() { grep -v '^[[:space:]]*#' "$1" || true; }
# NOTE: pipelines into `grep -q` are avoided on purpose (set -o pipefail turns grep's early exit into SIGPIPE = a FALSE "no match" / false PASS).
is_precut() { case "$(head -n 1 "$1")" in "# PRE-CUTOVER"*) return 0 ;; *) return 1 ;; esac; }
has_code() { local pat="$1" f="$2" n; n="$(codeonly "$f" | grep -cE -- "$pat" || true)"; [ "${n:-0}" -gt 0 ]; }
need_root() { [ -n "$AICC_PREFIX" ] && return 0; [ "$(id -u)" = "0" ] || { if is_dry; then warn "not root: continuing only because --dry-run changes nothing"; return 0; fi; refuse "must run as root (sudo)"; }; }
secret_file_ok() { # secret_file_ok <path> -> prints a reason on failure (never the value)
  local f="$1" m v
  [ -f "$f" ] && [ ! -L "$f" ] || { echo "missing or not a regular file: $f"; return 1; }
  m="$(mode_of_file "$f")"; case "$m" in 600|400) ;; *) echo "$f must be mode 0600 (is $m)"; return 1 ;; esac
  if [ -z "$AICC_PREFIX" ]; then [ "$(owner_uid "$f")" = "0" ] || { echo "$f must be owned by root"; return 1; }; fi
  v="$(tr -d '\n' < "$f")"
  python3 -I - "$v" <<'PY' || return 1
import re, sys
v = sys.argv[1]
if not re.fullmatch(r"[A-Za-z0-9._~+/=-]{32,}", v):
    print("a secret must be at least 32 characters from [A-Za-z0-9._~+/=-]"); sys.exit(1)
if len(set(v)) < 12:
    print("a secret must have at least 12 distinct characters (not a placeholder)"); sys.exit(1)
PY
}

# ================================================================ set-owner-secret ================================================================
cmd_set_owner_secret() {
  case " $SECRET_NAMES " in *" $SECRET_NAME "*) ;; *) echo "usage: $0 set-owner-secret entitlement-webhook|activation-proof [--stdin]" >&2; exit 2 ;; esac
  need_root
  local dir f tmp v
  dir="$(P "$INCOMING")"; f="$dir/$SECRET_NAME.secret"
  if [ "$STDIN" = 1 ]; then IFS= read -r v || true
  else
    [ -t 0 ] || refuse "no terminal: the value is read from a hidden prompt (ssh -t); pipe it with --stdin from a password manager instead"
    printf 'Paste the %s secret (hidden, not echoed): ' "$SECRET_NAME" >&2; IFS= read -rs v; printf '\n' >&2
  fi
  v="${v%$'\r'}"
  umask 077; mkdir -p "$dir"; chmod 700 "$dir"
  tmp="$(mktemp "$dir/.new.XXXXXX")"; printf '%s' "$v" > "$tmp"; unset v; chmod 600 "$tmp"
  if ! r="$(secret_file_ok "$tmp")"; then rm -f "$tmp"; die "not stored: $r"; fi
  mv -f "$tmp" "$f"; info "stored $INCOMING/$SECRET_NAME.secret (0600); the value was not printed. It is installed into /etc/aicc/secrets by the 'secrets' step."
}

# ================================================================ steps ================================================================
BUNDLE=""
done_mark() { printf '%s/%s' "$(P "$STATE_DIR")" "done.$1"; }
is_done() { [ -f "$(done_mark "$1")" ]; }
mark_done() { is_dry && return 0; mkdir -p "$(P "$STATE_DIR")"; chmod 700 "$(P "$STATE_DIR")"; date -u +%Y-%m-%dT%H:%M:%SZ > "$(done_mark "$1")"; }
state_bundle() { cat "$(P "$STATE_DIR")/bundle" 2>/dev/null || true; }

gate_checks() { # prints PASS/FAIL lines; returns the number of failures
  local fails=0 f e h i n
  pass() { printf 'PASS  %s\n' "$*"; }
  bad() { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
  [ "$CONFIRM" = 1 ] && pass "--confirm-production given" || bad "--confirm-production is required (this converts the host)"
  if [ -n "$AICC_PREFIX" ] || [ "$(id -u)" = "0" ]; then pass "root (or the test harness)"; else bad "not root"; fi
  e="$(ident_env)"; h="$(ident_val AICC_HOSTNAME)"; i="$(ident_val AICC_STAGE_ID)"
  if [ -n "$(state_bundle)" ]; then
    [ "$e" = production ] && pass "promotion in progress: identity already production (resuming)" || bad "a promotion state exists but the identity says '$e'"
  else
    [ "$e" = staging ] && pass "identity says AICC_ENV=staging" || bad "identity says AICC_ENV='$e' (this converts a STAGING host only)"
    [ "$h" = "$STAGE_HOST" ] && pass "identity hostname is $STAGE_HOST" || bad "identity hostname is '$h', expected $STAGE_HOST"
    [[ "$EXPECT_ID" =~ ^[0-9a-f]{32}$ ]] || bad "--expect-stage-id must be the 32-hex id of THIS host (read it on the host: grep AICC_STAGE_ID $IDENT)"
    [ -n "$EXPECT_ID" ] && [ "$i" = "$EXPECT_ID" ] && pass "AICC_STAGE_ID equals --expect-stage-id" || bad "AICC_STAGE_ID does not equal --expect-stage-id (wrong machine?)"
  fi
  if is_done secrets; then pass "owner secrets already installed by an earlier run (resuming)"; else
  for n in $SECRET_NAMES; do
    f="$(P "$INCOMING")/$n.secret"
    if r="$(secret_file_ok "$f")"; then pass "owner-provided $n secret present and well-formed (value not shown)"; else bad "owner secret $n: $r"; fi
  done
  if [ -d "$(P "$INCOMING")" ] && [ ! -L "$(P "$INCOMING")" ]; then
    [ "$(mode_of_file "$(P "$INCOMING")")" = 700 ] && pass "incoming directory is 0700" || bad "incoming directory must be 0700"
  else bad "incoming directory $INCOMING missing"; fi
  fi
  if [ -n "$CADDYFILE" ] && [ -r "$CADDYFILE" ]; then
    if is_precut "$CADDYFILE"; then pass "Caddyfile is the pre-cutover (tls internal) render"; else bad "Caddyfile is not a pre-cutover render (render-edge.mjs --mode production --pre-cutover)"; fi
    has_code 'aicc-stage-identity' "$CADDYFILE" && bad "Caddyfile carries the stage identity route" || pass "Caddyfile has no identity route"
    has_code '[Ss][Tt][Aa][Gg][Ee]\.copilt\.org' "$CADDYFILE" && bad "Caddyfile names the staging host in code" || pass "Caddyfile names no staging host"
    has_code 'X-Robots-Tag' "$CADDYFILE" && bad "Caddyfile carries X-Robots-Tag (staging-only)" || pass "Caddyfile carries no noindex header"
    has_code '^[[:space:]]*tls[[:space:]]+internal' "$CADDYFILE" && pass "tls internal present (no public-CA request before DNS)" || bad "pre-cutover Caddyfile has no 'tls internal'"
    has_code 'acme-staging' "$CADDYFILE" && bad "Caddyfile points at an ACME staging directory" || true
  else bad "--caddyfile FILE is required (render on the Mac: node scripts/ops/render-edge.mjs --mode production --pre-cutover)"; fi
  if [ -n "$OPSCONF" ] && [ -r "$OPSCONF" ]; then
    grep -Eq '^host_label = "aicc-cp-prod \(production\)"' "$OPSCONF" && pass "AICC Ops config carries the production host label" || bad "AICC Ops config host_label is not the production one"
    grep -q 'stage\.copilt\.org' "$OPSCONF" && bad "AICC Ops config names the staging host" || pass "AICC Ops config names no staging host"
  else bad "--ops-config FILE is required (infra/aicc-ops/config/aicc-ops.production.toml)"; fi
  command -v jq >/dev/null 2>&1 && pass "jq available" || bad "jq is required"
  if [ -z "$AICC_PREFIX" ]; then
    local free; free="$(df -Pk / | awk 'NR==2{printf "%d", ($4*100)/($3+$4)}')"
    [ "$free" -ge 30 ] && pass "${free}% disk free" || bad "only ${free}% free"
  fi
  return "$fails"
}

step_gate() {
  step "gate (read-only)"
  local out rc=0
  out="$(gate_checks)" || rc=$?
  printf '%s\n' "$out"
  [ "$rc" = 0 ] || refuse "$rc gate check(s) failed; nothing was changed"
}

step_bundle() {
  step "rollback bundle (identity, configuration, secrets, the whole backup directory, a fresh verified database dump)"
  if is_done bundle; then info "already done: $(state_bundle)"; BUNDLE="$(state_bundle)"; return 0; fi
  local ts d dump sums
  ts="$(date -u +%Y%m%dT%H%M%SZ)"; d="${BUNDLE_ARG:-$BUNDLE_ROOT/$ts}"
  [ ! -e "$(P "$d")" ] || refuse "bundle directory $d already exists"
  if is_dry; then would "create $d (0700 root): copies of $IDENT, $EDGE_DIR/edge.env, $EDGE_DIR/Caddyfile, $WPCFG, $OPS_TOML, $BKCNF, a tar of $SECRETS, then '$BACKUP_CMD --label manual' and a verified copy of that dump"; BUNDLE="$d"; return 0; fi
  umask 077; mkdir -p "$(P "$d")"; chmod 700 "$(P "$d")" "$(P "$BUNDLE_ROOT")"
  mkdir -p "$(P "$STATE_DIR")"; chmod 700 "$(P "$STATE_DIR")"; printf '%s' "$d" > "$(P "$STATE_DIR")/bundle"
  local f
  for f in "$IDENT" "$EDGE_DIR/edge.env" "$EDGE_DIR/Caddyfile" "$WPCFG" "$OPS_TOML" "$BKCNF"; do
    [ -f "$(P "$f")" ] && cp -p "$(P "$f")" "$(P "$d")/$(echo "$f" | tr '/' '_' | sed 's/^_//')" || warn "not present, not bundled: $f"
  done
  [ -d "$(P "$SECRETS")" ] && tar -C "$(P /)" -cf "$(P "$d")/secrets-stage.tar" "$(echo "${SECRETS#/}")" || warn "no secrets directory to bundle"
  chmod 600 "$(P "$d")"/* 2>/dev/null || true
  # a fresh dump of the staging database that is VERIFIED before anything is dropped
  if [ -x "$BACKUP_CMD" ] || [ -x "$(P "$BACKUP_CMD")" ]; then "$BACKUP_CMD" --label manual >/dev/null || fail "pre-promotion backup failed: nothing was changed beyond the bundle directory"; else fail "backup command $BACKUP_CMD not found"; fi
  local sj dumpf trailer
  sj="$(P "$BACKUPS")/status.json"; [ -f "$sj" ] || fail "no $BACKUPS/status.json after the backup"
  [ "$(jq -r '.status' "$sj")" = ok ] || fail "the pre-promotion backup did not finish ok"
  dumpf="$(jq -r '.last_success.db_dump_file' "$sj")"; [[ "$dumpf" =~ ^aicc_cp-[0-9]{8}T[0-9]{6}Z-[a-z-]+\.sql\.gz$ ]] || fail "unexpected dump file name in status.json"
  gzip -t "$(P "$BACKUPS")/$dumpf" || fail "the dump does not pass gzip -t"
  [ "$(sha256_of "$(P "$BACKUPS")/$dumpf")" = "$(awk '{print $1}' "$(P "$BACKUPS")/$dumpf.sha256")" ] || fail "the dump does not match its sha256 sidecar"
  trailer="$(gzip -dc "$(P "$BACKUPS")/$dumpf" | tail -c 400)"; case "$trailer" in *"-- Dump completed"*) ;; *) fail "the dump has no completion trailer" ;; esac
  cp -p "$(P "$BACKUPS")/$dumpf" "$(P "$d")/staging-db.sql.gz"; printf '%s\n' "$dumpf" > "$(P "$d")/staging-db.name"
  ( cd "$(P "$d")" && for f in *; do [ "$f" = MANIFEST.sha256 ] || printf '%s  %s\n' "$(sha256_of "$f")" "$f"; done > MANIFEST.sha256 )
  BUNDLE="$d"; mark_done bundle; info "rollback bundle: $d (root-only, contains the STAGING secrets: delete it after the rollback window)"
}

stop_unit() { is_dry && { would "systemctl stop $1"; return 0; }; svc stop "$1" || true; }
step_quiesce() {
  step "quiesce (nothing writes while the host changes identity)"
  # the bundle step must have run in this invocation or earlier
  [ -n "$BUNDLE" ] || BUNDLE="$(state_bundle)"
  local u; for u in aicc-edge aicc-backup.timer aicc-wp-cron.timer aicc-backup.service aicc-wp-cron.service php8.3-fpm; do stop_unit "$u"; done
  mark_done quiesce
}

step_identity() {
  step "identity (AICC_ENV=production, $PROD_HOST, new random id)"
  if [ "$(ident_env)" = production ]; then info "unchanged: identity already says production ($(ident_val AICC_HOSTNAME))"; mark_done identity; return 0; fi
  local id; id="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
  printf '%s\n' "AICC_ENV=production" "AICC_HOSTNAME=$PROD_HOST" "AICC_HOST_ROLE=control-plane-edge" \
    "# PRODUCTION Control Plane + edge. Promoted in place from the staging Droplet $(date -u +%Y-%m-%d); the file name /etc/aicc-stage-identity is historical." \
    "# The id is an identifier, not a secret: deploy-release.sh, the backup pull and the restore tool compare it. Never point www/api traffic at a host that does not say production." \
    "AICC_STAGE_ID=$id" | { if is_dry; then cat >/dev/null; would "write $IDENT (0644 root): AICC_ENV=production AICC_HOSTNAME=$PROD_HOST AICC_STAGE_ID=<new random 32 hex>"; else install_text "$IDENT" 0644 root:root; fi; }
  # deployment records continue in the SAME file; one boundary record makes `aicc-deploy-status` show where staging ended and production began
  if is_dry; then would "append a promotion boundary record to /var/lib/aicc/deployments.jsonl"; else
    mkdir -p "$(P /var/lib/aicc)"
    jq -n -c --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg op "${SUDO_USER:-root}" --arg h "$(hostname 2>/dev/null || echo host)" \
      '{ts:$ts,outcome:"promoted_to_production",kind:"host",release_id:"-",previous:"-",operator:$op,tarball_sha256:"-",source_commit:"-",target:"production",host:$h}' >> "$(P /var/lib/aicc/deployments.jsonl)"
  fi
  mark_done identity
}

step_secrets() {
  step "secrets (rotate everything regenerable; install the two OWNER-provided values)"
  if is_done secrets; then info "already done"; return 0; fi
  local n s
  if is_dry; then would "move the old $SECRETS content into the bundle (already tar'd), create a fresh $SECRETS (0700), install entitlement-webhook.secret and activation-proof.secret from $INCOMING (0600), remove them from $INCOMING; db passwords and WordPress salts are regenerated by the db and wpconfig steps"; return 0; fi
  umask 077
  s="$(P "$SECRETS")"
  [ -f "$(P "$(state_bundle)")/secrets-stage.tar" ] || [ ! -d "$s" ] || fail "refusing to rotate: the bundle has no secrets tar"
  rm -rf "$s"; mkdir -p "$s"; chmod 700 "$s"
  for n in $SECRET_NAMES; do
    secret_file_ok "$(P "$INCOMING")/$n.secret" >/dev/null || fail "owner secret $n is no longer valid"
    install -m 600 "$(P "$INCOMING")/$n.secret" "$s/$n.secret"
    rm -f "$(P "$INCOMING")/$n.secret"
  done
  rmdir "$(P "$INCOMING")" 2>/dev/null || true
  # mail credentials live in /etc/aicc-mail (the PHP user cannot traverse /etc/aicc); the DIRECTORY is prepared here, the owner places smtp.env afterwards (section 8 of the runbook). Never touched if present.
  mkdir -p "$(P /etc/aicc-mail)"; chmod 750 "$(P /etc/aicc-mail)"; [ -n "$AICC_PREFIX" ] || chown root:aicc-cp /etc/aicc-mail
  rm -f "$(P "$BKCNF")"          # rewritten (new password) by create-staging-db.sh
  mark_done secrets; info "secrets rotated; the staging DB passwords, salts and wp-admin password are only in the bundle now"
}

step_backups() {
  step "backups (staging sets leave the pull path; production starts clean; ack reset)"
  if is_done backups; then info "already done"; return 0; fi
  local b d; b="$(P "$BACKUPS")"; d="$(P "$(state_bundle)")/backups-stage"
  if is_dry; then would "move $BACKUPS (all staging dumps, archives, status.json, offhost-ack.json) to $(state_bundle)/backups-stage and create an empty $BACKUPS (0751 root)"; return 0; fi
  if [ -d "$b" ]; then mv "$b" "$d"; chmod -R go-rwx "$d"; fi
  mkdir -p "$b"; chmod 751 "$b"
  mark_done backups; info "the Mac's restricted pull now sees an empty set until the first PRODUCTION backup; the old sets are in the bundle only"
}

step_db() {
  step "database (clean replacement: drop the staging database, create an empty one, new account passwords)"
  if is_done db; then info "already done"; return 0; fi
  local bd; bd="$(state_bundle)"
  if is_dry; then would "verify $bd/staging-db.sql.gz, DROP DATABASE aicc_cp (and aicc_restore_check), then create-staging-db.sh (empty aicc_cp, NEW random passwords for aicc_cp and aicc_backup, $BKCNF rewritten)"; return 0; fi
  [ -s "$(P "$bd")/staging-db.sql.gz" ] || fail "no verified dump in the bundle: refusing to drop anything"
  gzip -t "$(P "$bd")/staging-db.sql.gz" || fail "bundle dump fails gzip -t"
  [ -S "$SOCKET" ] || [ -S "$(P "$SOCKET")" ] || fail "MySQL socket not found"
  local MY=("$MYSQL" --protocol=socket --socket="$SOCKET" -uroot)
  printf 'DROP DATABASE IF EXISTS `aicc_cp`;\nDROP DATABASE IF EXISTS `aicc_restore_check`;\n' | "${MY[@]}"
  AICC_TEST_HARNESS="${AICC_TEST_HARNESS:-0}" bash "$SELF/create-staging-db.sh" --socket "$SOCKET" --secrets-dir "$(P "$SECRETS")" --backup-cnf "$(P "$BKCNF")" --mysql-bin "$MYSQL"
  mark_done db
}

step_wpconfig() {
  step "wp-config (production template; new salts; owner-provided plugin secrets)"
  if is_done wpconfig; then info "already done"; return 0; fi
  # the private Plugin release store the wp-config points at: created (never emptied) if missing; its content is NOT part of the staging state that is replaced
  if is_dry; then would "ensure /srv/aicc/shared/plugin-releases exists (root:aicc-cp 0750; contents untouched)"; else
    mkdir -p "$(P /srv/aicc/shared/plugin-releases)"; chmod 750 "$(P /srv/aicc/shared/plugin-releases)"; [ -n "$AICC_PREFIX" ] || chown root:aicc-cp /srv/aicc/shared/plugin-releases
  fi
  local args=(--env production --confirm-production)
  is_dry && args+=(--dry-run)
  if [ -n "$AICC_PREFIX" ]; then args+=(--out "$(P "$WPCFG")" --secrets-dir "$(P "$SECRETS")" --mail-dir "$(P /etc/aicc-mail)" --plugin-release-dir "$(P /srv/aicc/shared/plugin-releases)" --owner-facts-file "$(P /etc/aicc/owner-facts.env)" --owner "$(id -un):$(id -gn)"); fi
  AICC_TEST_HARNESS="${AICC_TEST_HARNESS:-0}" bash "$SELF/render-wp-config.sh" "${args[@]}"
  mark_done wpconfig
}

edge_env_text() { # edge_env_text dark|final <acme-email>
  local kind="$1" mail="$2"
  printf '%s\n' "# /etc/aicc-edge/edge.env for the PRODUCTION host ($kind render). 0640 root:aicc-edge. NO secrets. Written by promote-to-production.sh; the stage-only identity variables are gone (the production preflight refuses them)." \
    "AICC_EDGE_MODE=production" "AICC_PUBLIC_HOST=$PROD_HOST" "AICC_STATIC_ROOT=/srv/aicc/site/current" "AICC_WP_ROOT=/srv/aicc/cp/current" \
    "AICC_PHP_FPM_SOCKET=unix//run/php/aicc-cp.sock" "AICC_ACME_EMAIL=$mail" "AICC_LOG_DIR=/var/log/aicc-edge" "AICC_ADMIN_ADDR=127.0.0.1:12019" "AICC_OPERATOR_PORT=8443" "AICC_WP_TIMEOUT=60s" \
    "# The production render is refused by the preflight without this flag; it is set from the day of promotion (the host is dark) and stays." "AICC_ALLOW_PRODUCTION_MODE=1"
  if [ "$kind" = dark ]; then
    printf '%s\n' "# DARK PRODUCTION ONLY: the tls-internal waiting render needs this override. REMOVED by 'final-edge' on cutover day (the preflight then refuses internal certificates again)." "AICC_ALLOW_INTERNAL_TLS=1"
  fi
}
acme_email() { local m; m="$(sed -n 's/^AICC_ACME_EMAIL=//p' "$(P "$EDGE_DIR/edge.env")" 2>/dev/null | head -1)"; [ -n "$m" ] && printf '%s' "$m" || printf 'ops@copilt.org'; }

install_edge() { # install_edge dark|final <caddyfile>
  local kind="$1" cf="$2" mail
  mail="$(acme_email)"
  if [ "$kind" = dark ]; then is_precut "$cf" || refuse "$cf is not a pre-cutover render"
  else
    is_precut "$cf" && refuse "$cf is a pre-cutover render: the final render is render-edge.mjs --mode production (no --pre-cutover)"
    has_code '^[[:space:]]*tls[[:space:]]+internal' "$cf" && refuse "$cf contains tls internal"
  fi
  has_code 'aicc-stage-identity' "$cf" && refuse "$cf carries the stage identity route"
  has_code '[Ss][Tt][Aa][Gg][Ee]\.copilt\.org' "$cf" && refuse "$cf names the staging host"
  has_code 'X-Robots-Tag' "$cf" && refuse "$cf carries a noindex header"
  has_code "$PROD_HOST" "$cf" || refuse "$cf does not name $PROD_HOST"
  if is_dry; then would "install $EDGE_DIR/Caddyfile ($kind), $EDGE_DIR/edge.env ($kind, no stage id), $DROPIN (preflight + reload in --mode production), the cert-expiry drop-in (www + apex; timer $([ "$kind" = dark ] && echo OFF || echo ON)); the edge is NOT started"; return 0; fi
  edge_env_text "$kind" "$mail" | install_text "$EDGE_DIR/edge.env" 0640 root:aicc-edge
  install_file "$cf" "$EDGE_DIR/Caddyfile" 0640 root:aicc-edge
  [ -r "$DROPIN_SRC" ] || fail "missing $DROPIN_SRC"
  install_file "$DROPIN_SRC" "$DROPIN" 0644 root:root
  [ -r "$CERT_DROPIN_SRC" ] || fail "missing $CERT_DROPIN_SRC"
  install_file "$CERT_DROPIN_SRC" "/etc/systemd/system/aicc-cert-expiry.service.d/10-production.conf" 0644 root:root
  [ -n "$AICC_PREFIX" ] || systemctl daemon-reload
  # certificate-expiry timer: OFF while the edge serves the 12-hour internal certificate, ON with the public one
  if [ "$kind" = dark ]; then svc disable --now aicc-cert-expiry.timer 2>/dev/null || true; else svc enable --now aicc-cert-expiry.timer || true; fi
  if [ -x "$PREFLIGHT_CMD" ] || [ -x "$(P "$PREFLIGHT_CMD")" ]; then
    local flags=(--mode production --caddyfile "$(P "$EDGE_DIR/Caddyfile")" --env-file "$(P "$EDGE_DIR/edge.env")" --quiet)
    [ -z "$AICC_PREFIX" ] && flags+=(--caddy /usr/local/bin/caddy)
    "$PREFLIGHT_CMD" "${flags[@]}" || fail "the edge preflight refused the production configuration; nothing is started"
  elif [ -z "$AICC_PREFIX" ]; then fail "$PREFLIGHT_CMD not found"; fi
}

step_edge() {
  step "edge (pre-cutover production render, production edge.env, unit drop-in; NOT started)"
  [ -n "$CADDYFILE" ] || refuse "--caddyfile is required"
  install_edge dark "$CADDYFILE"; mark_done edge
}

step_ops() {
  step "AICC Ops config (production thresholds, labels and hostnames)"
  [ -n "$OPSCONF" ] || refuse "--ops-config is required"
  if is_dry; then would "install $OPS_TOML from $OPSCONF (0640 root:aicc-ops); the old file is kept in /var/backups/aicc-config; restart happens in 'start'"; return 0; fi
  if [ -x "$OPS_CMD" ] && [ -z "$AICC_PREFIX" ]; then "$OPS_CMD" --config "$OPSCONF" check-config >/dev/null || fail "AICC Ops rejects the production config"; fi
  install_file "$OPSCONF" "$OPS_TOML" 0640 root:aicc-ops
  mark_done ops
}

summary_next() {
  cat <<EOF

================================================================================================
PROMOTION APPLIED (host is DARK: production identity + empty production database + dark edge, services stopped).
Next, in this order (docs/cutover/production-promotion.md section 6):
  sudo promote-to-production.sh start --confirm-production
  sudo promote-to-production.sh wp-install --admin-user <name> --admin-email <addr>      (hidden prompt for the password)
  seed products / checkout policy / legal documents, then the first production backup:  sudo aicc-backup --label manual
Rollback to the STAGING state:  sudo promote-to-production.sh rollback --bundle $(state_bundle) --confirm-rollback
STOP: nothing above touches DNS. Public cutover is a separate owner approval (section 9).
================================================================================================
EOF
}

cmd_apply() {
  [ "$CONFIRM" = 1 ] || refuse "apply needs --confirm-production"
  need_root
  local steps="${ONLY:-$STEPS_DEFAULT}" s
  for s in ${steps//,/ }; do case " $STEPS_DEFAULT " in *" $s "*) ;; *) echo "unknown step: $s (valid: $STEPS_DEFAULT)" >&2; exit 2 ;; esac; done
  # gate ALWAYS runs first, whatever --only says (a partial run must satisfy the same refusals)
  step_gate
  case " ${steps//,/ } " in *" bundle "*) ;; *) [ -n "$(state_bundle)" ] || refuse "--only without 'bundle' needs an existing promotion state (run the full apply first)" ;; esac
  BUNDLE="$(state_bundle)"
  for s in ${steps//,/ }; do
    [ "$s" = gate ] && continue
    "step_$s"
  done
  if is_dry; then echo; echo "dry-run: nothing changed. STOP: owner approval is required before the real run."; else summary_next; fi
}

cmd_check() { local out rc=0; out="$(gate_checks)" || rc=$?; printf '%s\n' "$out"; [ "$rc" = 0 ] && echo "ALL GATES PASS (nothing changed)" || echo "$rc gate(s) failing"; exit "$([ "$rc" = 0 ] && echo 0 || echo 3)"; }

cmd_start() {
  need_root
  [ "$(ident_env)" = production ] || refuse "identity does not say production: run 'apply' first"
  [ "$CONFIRM" = 1 ] || refuse "start needs --confirm-production"
  [ -f "$(P "$WPCFG")" ] || refuse "no production wp-config.php (run the wpconfig step)"
  step "start (dark production)"
  local u
  for u in mysql php8.3-fpm aicc-edge aicc-wp-cron.timer aicc-backup.timer; do if is_dry; then would "systemctl start $u"; else svc start "$u"; fi; done
  if is_dry; then would "systemctl restart aicc-ops"; else svc restart aicc-ops; fi
  info "started. The edge answers only for $PROD_HOST/copilt.org with Caddy's INTERNAL CA; nobody resolves those names to this host yet."
}

cmd_wp_install() {
  need_root
  [ "$(ident_env)" = production ] || refuse "identity does not say production"
  [[ "$ADMIN_USER" =~ ^[a-z][a-z0-9._-]{4,30}$ ]] || refuse "--admin-user must be 5-31 characters [a-z0-9._-] starting with a letter"
  case "$ADMIN_USER" in admin|administrator|root|aicc|wpadmin|test|demo) refuse "--admin-user '$ADMIN_USER' is a guessable name" ;; esac
  [[ "$ADMIN_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || refuse "--admin-email is not an address"
  if [ -z "$AICC_PREFIX" ] && [ ! -t 0 ]; then refuse "no terminal: the admin password is typed at a hidden prompt (ssh -t); it is never read from a file or an argument"; fi
  step "wp-install (empty production database)"
  if is_dry; then would "$WP_BIN core install --url=https://$PROD_HOST --title='AI Commerce Copilot' --admin_user=$ADMIN_USER --admin_email=$ADMIN_EMAIL --prompt=admin_password --skip-email; plugin activate woocommerce aicc-license-manager; theme activate aicc-admin; permalinks; keep WooCommerce 'coming soon' ON until a real gateway exists"; return 0; fi
  "$WP_BIN" core install --url="https://$PROD_HOST" --title="AI Commerce Copilot" --admin_user="$ADMIN_USER" --admin_email="$ADMIN_EMAIL" --prompt=admin_password --skip-email
  "$WP_BIN" plugin activate woocommerce aicc-license-manager
  "$WP_BIN" theme activate aicc-admin
  "$WP_BIN" option update permalink_structure '/%postname%/'
  "$WP_BIN" rewrite flush
  [ "$("$WP_BIN" option get home)" = "https://$PROD_HOST" ] || fail "WordPress home is not https://$PROD_HOST"
  [ "$("$WP_BIN" option get siteurl)" = "https://$PROD_HOST" ] || fail "WordPress siteurl is not https://$PROD_HOST"
  [ "$("$WP_BIN" option get blog_public)" != "0" ] || fail "blog_public is 0 (noindex): production must not hide itself"
  info "installed. Next: seed the commercial products / checkout policy / legal documents from the Control Plane scripts (docs/cutover/production-promotion.md section 6), then take the first production backup."
}

strip_dark_ops() { # remove the DARK-PRODUCTION OVERRIDES region (cert_expiry off while the edge serves a 12-hour internal certificate) from the installed AICC Ops config
  local f; f="$(P "$OPS_TOML")"
  [ -f "$f" ] || { warn "no $OPS_TOML: nothing to strip"; return 0; }
  if is_dry; then would "remove the DARK-PRODUCTION OVERRIDES region from $OPS_TOML, then restart aicc-ops"; return 0; fi
  python3 -I - "$f" <<'PY'
import os, re, shutil, sys, tempfile
p = sys.argv[1]
t = open(p).read()
n = re.sub(r"# BEGIN DARK-PRODUCTION OVERRIDES.*?# END DARK-PRODUCTION OVERRIDES\n", "", t, flags=re.S)
if n != t:
    st = os.stat(p)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p)); os.close(fd)
    open(tmp, "w").write(n); shutil.copymode(p, tmp)
    try: os.chown(tmp, st.st_uid, st.st_gid)
    except OSError: pass
    os.replace(tmp, p); print("dark-production overrides removed")
else: print("no dark-production overrides present")
PY
  svc restart aicc-ops || true
}

cmd_final_edge() {
  need_root
  [ "$CONFIRM_CUTOVER" = 1 ] || refuse "final-edge needs --confirm-cutover (STOP: owner approval; DNS must already point at this host)"
  [ "$(ident_env)" = production ] || refuse "identity does not say production"
  [ -n "$CADDYFILE" ] && [ -r "$CADDYFILE" ] || refuse "--caddyfile FILE (the FINAL production render) is required"
  [[ "$EXPECT_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || refuse "--expect-ip must be this host's public IPv4 (the reserved IP): asking a public CA before DNS points here burns failed validations (5 per hour per name)"
  local got
  if [ -n "$DNS_CMD" ]; then got="$("$DNS_CMD" "$PROD_HOST" 2>/dev/null | head -1)"
  else got="$(dig +short +time=3 +tries=1 @1.1.1.1 "$PROD_HOST" A 2>/dev/null | grep -E '^[0-9.]+$' | head -1)"; fi
  [ "$got" = "$EXPECT_IP" ] || refuse "$PROD_HOST resolves to '${got:-nothing}', not $EXPECT_IP: DNS has not moved (or the resolver still caches the old answer). Do not start public certificate issuance yet"
  step "final-edge (automatic public-CA HTTPS for $PROD_HOST and the apex)"
  install_edge final "$CADDYFILE"
  strip_dark_ops
  if is_dry; then would "systemctl restart aicc-edge"; else svc restart aicc-edge; fi
  info "restarted (a RESTART, not a reload: edge.env changed). Watch: journalctl -u aicc-edge -f ; curl -sI https://$PROD_HOST/healthz"
}

cmd_dark_edge() {
  need_root
  [ "$(ident_env)" = production ] || refuse "identity does not say production"
  [ -n "$CADDYFILE" ] && [ -r "$CADDYFILE" ] || refuse "--caddyfile FILE (the pre-cutover render) is required"
  step "dark-edge (back to the tls-internal waiting render)"
  install_edge dark "$CADDYFILE"
  if [ -n "$OPSCONF" ]; then
    if is_dry; then would "reinstall the dark-production AICC Ops config"; else install_file "$OPSCONF" "$OPS_TOML" 0640 root:aicc-ops; svc restart aicc-ops || true; fi
  else warn "--ops-config not given: the AICC Ops cert_expiry rule stays ENABLED and will fire on the 12-hour internal certificate"; fi
  if is_dry; then would "systemctl restart aicc-edge"; else svc restart aicc-edge; fi
}

cmd_rollback() {
  need_root
  [ "$CONFIRM_ROLLBACK" = 1 ] || refuse "rollback needs --confirm-rollback"
  local b; b="$(P "${BUNDLE_ARG:-}")"
  [ -n "$BUNDLE_ARG" ] && [ -d "$b" ] && [ -s "$b/MANIFEST.sha256" ] || refuse "--bundle DIR (with MANIFEST.sha256) is required"
  ( cd "$b" && while read -r h f; do [ "$(sha256_of "$f")" = "$h" ] || { echo "bundle file $f does not match its hash"; exit 1; }; done < MANIFEST.sha256 ) || refuse "the bundle is damaged: nothing was changed"
  grep -q '^AICC_ENV=staging$' "$b/etc_aicc-stage-identity" || refuse "the bundle's identity is not the staging one"
  step "rollback to the STAGING state from $BUNDLE_ARG"
  if is_dry; then would "stop services, restore identity/edge/wp-config/ops config/secrets, drop the production database, recreate the staging one from the bundle dump, restore the old backup directory, start services"; return 0; fi
  local u; for u in aicc-edge aicc-backup.timer aicc-wp-cron.timer php8.3-fpm; do svc stop "$u" || true; done
  umask 077
  cp -p "$b/etc_aicc-stage-identity" "$(P "$IDENT")"; chmod 644 "$(P "$IDENT")"
  [ -f "$b/etc_aicc-edge_edge.env" ] && cp -p "$b/etc_aicc-edge_edge.env" "$(P "$EDGE_DIR/edge.env")"
  [ -f "$b/etc_aicc-edge_Caddyfile" ] && cp -p "$b/etc_aicc-edge_Caddyfile" "$(P "$EDGE_DIR/Caddyfile")"
  rm -f "$(P "$DROPIN")" "$(P "/etc/systemd/system/aicc-cert-expiry.service.d/10-production.conf")"; [ -n "$AICC_PREFIX" ] || systemctl daemon-reload
  svc enable --now aicc-cert-expiry.timer 2>/dev/null || true
  [ -f "$b/srv_aicc_shared_wp-config.php" ] && cp -p "$b/srv_aicc_shared_wp-config.php" "$(P "$WPCFG")"
  [ -f "$b/etc_aicc-ops_aicc-ops.toml" ] && cp -p "$b/etc_aicc-ops_aicc-ops.toml" "$(P "$OPS_TOML")"
  rm -rf "$(P "$SECRETS")"; tar -C "$(P /)" -xf "$b/secrets-stage.tar"
  [ -f "$b/etc_aicc_backup.cnf" ] && cp -p "$b/etc_aicc_backup.cnf" "$(P "$BKCNF")"
  local MY=("$MYSQL" --protocol=socket --socket="$SOCKET" -uroot)
  printf 'DROP DATABASE IF EXISTS `aicc_cp`;\n' | "${MY[@]}"
  AICC_TEST_HARNESS="${AICC_TEST_HARNESS:-0}" bash "$SELF/create-staging-db.sh" --socket "$SOCKET" --secrets-dir "$(P "$SECRETS")" --backup-cnf "$(P "$BKCNF")" --mysql-bin "$MYSQL"
  gzip -dc "$b/staging-db.sql.gz" | "$MYSQL" --protocol=socket --socket="$SOCKET" -uroot --binary-mode aicc_cp
  if [ -d "$b/backups-stage" ]; then rm -rf "$(P "$BACKUPS")"; mv "$b/backups-stage" "$(P "$BACKUPS")"; fi
  rm -rf "$(P "$STATE_DIR")"
  jq -n -c --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg op "${SUDO_USER:-root}" --arg h "$(hostname 2>/dev/null || echo host)" \
    '{ts:$ts,outcome:"demoted_to_staging",kind:"host",release_id:"-",previous:"-",operator:$op,tarball_sha256:"-",source_commit:"-",target:"stage",host:$h}' >> "$(P /var/lib/aicc/deployments.jsonl)" || true
  for u in mysql php8.3-fpm aicc-edge aicc-wp-cron.timer aicc-backup.timer; do svc start "$u" || true; done
  svc restart aicc-ops || true
  info "rolled back to staging (identity, configuration, secrets, database, backup directory). The bundle is kept: $BUNDLE_ARG"
}

case "$ACTION" in
  check) cmd_check ;;
  set-owner-secret) cmd_set_owner_secret ;;
  apply) cmd_apply ;;
  start) cmd_start ;;
  wp-install) cmd_wp_install ;;
  final-edge) cmd_final_edge ;;
  dark-edge) cmd_dark_edge ;;
  rollback) cmd_rollback ;;
  ""|-h|--help) sed -n 2,26p "${BASH_SOURCE[0]}"; exit 2 ;;
  *) echo "unknown action: $ACTION" >&2; exit 2 ;;
esac
