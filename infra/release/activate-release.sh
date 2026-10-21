#!/usr/bin/env bash
# Activates an uploaded release ON THE HOST: verify, place, swap `current` atomically, health-gate, auto-rollback. Installed as
# /usr/local/lib/aicc/release/activate-release.sh (symlink /usr/local/sbin/aicc-activate-release). Run by deploy-release.sh over SSH with sudo; can also be run by hand.
#
#   sudo aicc-activate-release --kind site|cp --release-id <id> [options]
#
# The upload (deploy-release.sh) leaves, in /srv/aicc/<kind>/releases/:   .incoming-<id>/ (tree)   .incoming-<id>.manifest.json   .incoming-<id>.SHA256SUMS
# What happens, in this order; the first failing step stops the run with NOTHING changed unless it is stated otherwise:
#   1. root (or an explicit sandbox root), lock per kind, id format, manifest kind matches.
#   2. VERIFY: every file in the tree matches SHA256SUMS and no unlisted file exists (a transfer error or tampering cannot activate).
#   3. cp only: PRE-RELEASE DUMP GATE. Refuses unless /srv/aicc/backups/status.json shows a successful backup finished < 15 minutes ago, whose dump still
#      exists, matches its sha256 sidecar, passes gzip -t and whose restore check did not fail. There is deliberately NO bypass option.
#      cp only: /srv/aicc/shared/wp-config.php and /srv/aicc/shared/uploads must exist (the release symlinks to them).
#   4. site only: carry the previous 3 releases' _next/static chunks into the new tree (open tabs and cached HTML keep working).
#   5. ownership root:root, directories 0755, files 0644 (+x kept): releases are immutable and not writable by PHP.
#   6. place: mv .incoming-<id> <id>. Then `previous` := old `current`, `current` := new (each an atomic ln -sfn + mv -T rename).
#   7. cp: graceful PHP-FPM reload (SIGUSR2: clears OPcache and the realpath cache; opcache.validate_timestamps=0 makes this mandatory).
#   8. HEALTH GATE: the smoke command must succeed <successes> times in a row within <smoke-timeout> seconds. If it does not: AUTO-ROLLBACK
#      (current := old current, previous := old previous, reload again, smoke again). Exit 3 if rolled back, 4 if even the rollback is unhealthy (CRITICAL).
#   9. cp only: OPCACHE WARM-UP after the health gate (warm-cp.sh: a few GETs of the common pages through the edge's loopback listener; failures are logged and NEVER fail or
#      roll back the release; skipped when the health gate failed). The reload in step 7 empties OPcache; the first cold requests took 5-11 s.
#  10. prune old releases (keep the newest <keep>, never current/previous).
# Options: --root DIR (default /srv/aicc; any other root is a SANDBOX for tests: needs DIR/.aicc-sandbox, does no chown/systemctl)
#   --incoming DIR  --manifest FILE  --sums FILE   (defaults: the .incoming-<id> names above)   --keep 4   --static-keep 3
#   --smoke-cmd CMD (default smoke-<kind>.sh next to this script)  --smoke-timeout 30  --smoke-interval 2  --smoke-successes 2  --smoke-url U --smoke-resolve R
#   --allow-uninstalled   cp, FIRST INSTALL ONLY: the health gate also accepts the redirect to wp-admin/install.php (WordPress core not installed yet)
#   --warm-cmd CMD (cp; default: warm-cp.sh next to this script on the real host, none in a sandbox)  --no-warm
#   --fpm-reload-cmd CMD (default: systemctl reload php8.3-fpm)  --backup-status FILE  --backup-dir DIR  --dump-max-age 900  --dry-run
# Exit codes: 0 ok, 1 refused (nothing changed), 2 usage, 3 rolled back after a failed health gate, 4 rollback also unhealthy, 5 another activation is running.
set -euo pipefail
umask 022
self="${BASH_SOURCE[0]}"; while [ -L "$self" ]; do d="$(cd "$(dirname "$self")" && pwd)"; self="$(readlink "$self")"; case "$self" in /*) ;; *) self="$d/$self";; esac; done
HERE="$(cd "$(dirname "$self")" && pwd)"
# shellcheck source=lib/release-common.sh
. "$HERE/lib/release-common.sh"

KIND=""; ID=""; ROOT="/srv/aicc"; INCOMING=""; MANIFEST=""; SUMS=""; KEEP=4; STATIC_KEEP=3; SMOKE_CMD=""; SMOKE_TIMEOUT=30; SMOKE_INTERVAL=2; SMOKE_OK=2
SMOKE_URL=""; SMOKE_RESOLVE=""; FPM_RELOAD=""; BK_STATUS="/srv/aicc/backups/status.json"; BK_DIR="/srv/aicc/backups"; DUMP_MAX_AGE=900; DRY=0; BK_SET=0; ALLOW_UNINSTALLED=0; WARM_CMD=""; NO_WARM=0
usage() { sed -n 2,34p "$self"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --kind) KIND="${2:-}"; shift 2 ;;
    --release-id) ID="${2:-}"; shift 2 ;;
    --root) ROOT="${2:-}"; shift 2 ;;
    --incoming) INCOMING="${2:-}"; shift 2 ;;
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --sums) SUMS="${2:-}"; shift 2 ;;
    --keep) KEEP="${2:-}"; shift 2 ;;
    --static-keep) STATIC_KEEP="${2:-}"; shift 2 ;;
    --smoke-cmd) SMOKE_CMD="${2:-}"; shift 2 ;;
    --smoke-timeout) SMOKE_TIMEOUT="${2:-}"; shift 2 ;;
    --smoke-interval) SMOKE_INTERVAL="${2:-}"; shift 2 ;;
    --smoke-successes) SMOKE_OK="${2:-}"; shift 2 ;;
    --smoke-url) SMOKE_URL="${2:-}"; shift 2 ;;
    --smoke-resolve) SMOKE_RESOLVE="${2:-}"; shift 2 ;;
    --fpm-reload-cmd) FPM_RELOAD="${2:-}"; shift 2 ;;
    --warm-cmd) WARM_CMD="${2:-}"; shift 2 ;;
    --no-warm) NO_WARM=1; shift ;;
    --backup-status) BK_STATUS="${2:-}"; BK_SET=1; shift 2 ;;
    --backup-dir) BK_DIR="${2:-}"; BK_SET=1; shift 2 ;;
    --dump-max-age) DUMP_MAX_AGE="${2:-}"; shift 2 ;;
    --allow-uninstalled) ALLOW_UNINSTALLED=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done
case "$KIND" in site|cp) ;; *) echo "--kind must be site or cp" >&2; exit 2 ;; esac
[[ "$ID" =~ $RELEASE_ID_RE ]] || { echo "--release-id must look like 20261021T101500Z-1a2b3c4d" >&2; exit 2; }
for n in KEEP STATIC_KEEP SMOKE_TIMEOUT SMOKE_INTERVAL SMOKE_OK DUMP_MAX_AGE; do [[ "${!n}" =~ ^[0-9]+$ ]] || { echo "$n must be a number" >&2; exit 2; }; done
[ "$KEEP" -ge 2 ] || { echo "--keep must be >= 2 (current + previous)" >&2; exit 2; }
[[ "$ROOT" == /* ]] || { echo "--root must be absolute" >&2; exit 2; }

SANDBOX=0
if [ "$ROOT" != "/srv/aicc" ]; then
  [ -f "$ROOT/.aicc-sandbox" ] || { echo "REFUSED: --root $ROOT is not /srv/aicc and has no .aicc-sandbox marker" >&2; exit 1; }
  SANDBOX=1
elif [ "$(id -u)" != "0" ]; then echo "must run as root (sudo). Refusing." >&2; exit 2; fi
if [ "$SANDBOX" = 1 ] && [ "$BK_SET" = 0 ]; then BK_STATUS="$ROOT/backups/status.json"; BK_DIR="$ROOT/backups"; fi

KDIR="$ROOT/$KIND"; RDIR="$KDIR/releases"; CUR="$KDIR/current"; PREV="$KDIR/previous"
INCOMING="${INCOMING:-$RDIR/.incoming-$ID}"; MANIFEST="${MANIFEST:-$RDIR/.incoming-$ID.manifest.json}"; SUMS="${SUMS:-$RDIR/.incoming-$ID.SHA256SUMS}"
[ -n "$SMOKE_CMD" ] || SMOKE_CMD="$HERE/smoke-$KIND.sh"
if [ -z "$WARM_CMD" ] && [ "$SANDBOX" = 0 ] && [ "$KIND" = cp ]; then WARM_CMD="$HERE/warm-cp.sh"; fi
if [ -z "$FPM_RELOAD" ]; then if [ "$SANDBOX" = 1 ]; then FPM_RELOAD="true"; else FPM_RELOAD="systemctl reload php8.3-fpm"; fi; fi
# On the real host: a site release is also probed THROUGH the running edge (loopback, public SNI) and must carry this host's stage id.
if [ "$SANDBOX" = 0 ] && [ "$KIND" = site ] && [ -r /etc/aicc-stage-identity ]; then
  export AICC_EXPECT_STAGE_ID; AICC_EXPECT_STAGE_ID="$(sed -n 's/^AICC_STAGE_ID=//p' /etc/aicc-stage-identity | head -1)"
  idhost="$(sed -n 's/^AICC_HOSTNAME=//p' /etc/aicc-stage-identity | head -1)"
  if [ -z "$SMOKE_URL" ] && [ -n "$idhost" ] && systemctl is-active --quiet aicc-edge.service 2>/dev/null; then SMOKE_URL="https://$idhost/"; SMOKE_RESOLVE="$idhost:443:127.0.0.1"; fi
fi
mkdir -p "$RDIR"
ALOG="$KDIR/activation.log"; touch "$ALOG"
alog() { printf '%s %s %s\n' "$(rl_ts)" "$ID" "$*" >> "$ALOG"; rl_log "$*"; }

LOCKDIR="$KDIR/.release.lock"
if ! rl_lock "$LOCKDIR"; then echo "another activation of $KIND is running (lock $LOCKDIR)" >&2; exit 5; fi
trap 'rl_unlock "$LOCKDIR"' EXIT

# ---- 1/2. locate and verify ---------------------------------------------------------------------------------------------------------------
PLACED=0
if [ -d "$RDIR/$ID" ]; then
  # The release is already in place (a re-run, or the same build uploaded twice): the placed tree is the one that counts; a fresh upload of the same id is discarded.
  if [ -d "$INCOMING" ] && [ "$INCOMING" != "$RDIR/$ID" ] && [ "$DRY" = 0 ]; then rl_log "release $ID is already placed: discarding the re-uploaded copy"; rm -rf -- "${INCOMING:?}" "${MANIFEST:?}" "${SUMS:?}"; fi
  PLACED=1; INCOMING="$RDIR/$ID"; MANIFEST="$RDIR/$ID.manifest.json"; SUMS="$RDIR/$ID.SHA256SUMS"
fi
[ -d "$INCOMING" ] || rl_die "release tree not found: $INCOMING (upload it first with deploy-release.sh)" 1
[ -f "$MANIFEST" ] && [ -f "$SUMS" ] || rl_die "manifest/SHA256SUMS missing for $ID" 1
mk="$(jq -r '.kind // empty' "$MANIFEST")"; [ "$mk" = "$KIND" ] || rl_die "manifest kind '$mk' is not '$KIND'" 1
[ "$(jq -r '.release_id // empty' "$MANIFEST")" = "$ID" ] || rl_die "manifest release_id differs from --release-id" 1
rl_log "verifying $INCOMING against SHA256SUMS ..."
if [ "$PLACED" = 1 ] && [ "$KIND" = site ]; then
  # an already-placed site release also holds chunks carried forward from earlier releases (not in its own SHA256SUMS)
  verify_tree "$INCOMING" "$SUMS" "_next/static/" || rl_die "verification failed" 1
else
  verify_tree "$INCOMING" "$SUMS" || rl_die "verification failed: nothing was changed" 1
fi

# ---- 3. cp gates ----------------------------------------------------------------------------------------------------------------------------
if [ "$KIND" = cp ]; then
  msg="$(fresh_dump_ok "$BK_STATUS" "$DUMP_MAX_AGE" "$BK_DIR")" || rl_die "PRE-RELEASE DUMP GATE: $msg" 1
  rl_log "$msg"
  [ -f "$ROOT/shared/wp-config.php" ] || rl_die "$ROOT/shared/wp-config.php missing (run render-wp-config.sh)" 1
  [ -d "$ROOT/shared/uploads" ] || rl_die "$ROOT/shared/uploads missing" 1
fi

OLD_CUR="$(link_target_id "$CUR")"; OLD_PREV="$(link_target_id "$PREV")"
if [ "$DRY" = 1 ]; then
  echo "DRY-RUN: verification passed. Would: $( [ "$KIND" = site ] && echo "carry forward _next/static from the previous $STATIC_KEEP releases; ")place $ID, previous := ${OLD_CUR:-(none)}, current := $ID,"
  echo "         $( [ "$KIND" = cp ] && echo "reload PHP-FPM, ")run the health gate (${SMOKE_OK}x within ${SMOKE_TIMEOUT}s), auto-rollback on failure, prune beyond $KEEP releases."
  exit 0
fi

# ---- 4/5/6. prepare and place -------------------------------------------------------------------------------------------------------------
if [ "$PLACED" = 0 ]; then
  if [ "$KIND" = site ]; then rl_log "carry-forward: $(carry_forward "$RDIR" "$INCOMING" "$ID" "$STATIC_KEEP")"; fi
  if [ "$SANDBOX" = 0 ]; then chown -R root:root "$INCOMING"; fi
  chmod -R u+rwX,go+rX,go-w "$INCOMING"
  mv "$INCOMING" "$RDIR/$ID"
  mv -f "$MANIFEST" "$RDIR/$ID.manifest.json"; mv -f "$SUMS" "$RDIR/$ID.SHA256SUMS"
  rl_log "placed $RDIR/$ID"
fi
if [ "$OLD_CUR" = "$ID" ]; then
  alog "release $ID is already current: only re-running the health gate"
else
  [ -n "$OLD_CUR" ] && atomic_symlink "$RDIR/$OLD_CUR" "$PREV"
  atomic_symlink "$RDIR/$ID" "$CUR"
  alog "swapped: current -> $ID, previous -> ${OLD_CUR:-(none)}"
fi

reload_fpm() { if [ "$KIND" = cp ]; then rl_log "reloading PHP-FPM: $FPM_RELOAD"; bash -c "$FPM_RELOAD" || { rl_log "PHP-FPM reload FAILED"; return 1; }; fi; }
smoke_gate() { # smoke_gate <label> -> 0 when <SMOKE_OK> consecutive successes happen within the timeout
  local label="$1" deadline ok=0 now
  deadline=$(( $(date -u +%s) + SMOKE_TIMEOUT ))
  while :; do
    if AICC_RELEASE_DIR="$CUR" AICC_RELEASE_KIND="$KIND" AICC_SMOKE_URL="$SMOKE_URL" AICC_SMOKE_RESOLVE="$SMOKE_RESOLVE" AICC_SMOKE_ALLOW_UNINSTALLED="$ALLOW_UNINSTALLED" bash -c "$SMOKE_CMD"; then ok=$((ok + 1)); else ok=0; fi
    [ "$ok" -ge "$SMOKE_OK" ] && { rl_log "health gate ($label): $ok consecutive successes"; return 0; }
    now="$(date -u +%s)"; [ "$now" -lt "$deadline" ] || { rl_log "health gate ($label): FAILED (timeout ${SMOKE_TIMEOUT}s)"; return 1; }
    sleep "$SMOKE_INTERVAL"
  done
}

# ---- 7/8. reload, gate, rollback ------------------------------------------------------------------------------------------------------------
healthy=0
if reload_fpm && smoke_gate "new release $ID"; then healthy=1; fi
if [ "$healthy" = 0 ]; then
  alog "HEALTH GATE FAILED: rolling back"
  echo "failed at $(rl_ts)" > "$RDIR/$ID.FAILED"
  if [ -n "$OLD_CUR" ]; then
    atomic_symlink "$RDIR/$OLD_CUR" "$CUR"
    if [ -n "$OLD_PREV" ] && [ "$OLD_PREV" != "$OLD_CUR" ]; then atomic_symlink "$RDIR/$OLD_PREV" "$PREV"; else rm -f "$PREV"; fi
    alog "rolled back: current -> $OLD_CUR, previous -> ${OLD_PREV:-(none)}"
    reload_fpm || true
    if smoke_gate "rolled-back release $OLD_CUR"; then
      [ "$KIND" = cp ] && [ "$NO_WARM" = 0 ] && rl_warm "$WARM_CMD"
      record_deployment rolled_back "$KIND" "$ID" "$OLD_CUR" "$RDIR/$ID.manifest.json"
      echo "ROLLED BACK to $OLD_CUR; the failed release stays in $RDIR/$ID for inspection ($RDIR/$ID.FAILED)." >&2
      [ "$KIND" = cp ] && echo "NOTE: the code was rolled back, the DATABASE was not. See infra/release/README.md (migration rules); restore from the pre-release dump only if the failed release changed the schema incompatibly." >&2
      exit 3
    fi
    alog "CRITICAL: the rolled-back release is ALSO unhealthy"
    record_deployment critical "$KIND" "$ID" "$OLD_CUR" "$RDIR/$ID.manifest.json"
    exit 4
  fi
  rm -f "$CUR" "$PREV"
  alog "no earlier release: current removed (the edge preflight will refuse to start / the site is down until a good release is deployed)"
  exit 3
fi

# ---- 9. OPcache warm-up (cp only, AFTER the health gate; can never fail the release) ----------------------------------------------------------
[ "$KIND" = cp ] && [ "$NO_WARM" = 0 ] && rl_warm "$WARM_CMD"

# ---- 10. prune -----------------------------------------------------------------------------------------------------------------------------------
prune_releases "$RDIR" "$KEEP" "$ID" "$OLD_CUR" "$(link_target_id "$PREV")"
find "$RDIR" -maxdepth 1 -name '.incoming-*' -mtime +1 -exec rm -rf {} + 2>/dev/null || true
alog "OK: $KIND release $ID is live (previous: ${OLD_CUR:-none}) $(release_identity "$RDIR/$ID.manifest.json")"
record_deployment ok "$KIND" "$ID" "${OLD_CUR:-}" "$RDIR/$ID.manifest.json"
echo "current  -> $(readlink "$CUR")"
echo "previous -> $( [ -L "$PREV" ] && readlink "$PREV" || echo '(none)')"
echo "rollback: sudo aicc-rollback-release --kind $KIND"
