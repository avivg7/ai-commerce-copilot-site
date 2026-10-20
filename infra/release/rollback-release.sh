#!/usr/bin/env bash
# Manual rollback ON THE HOST: point `current` back at `previous` (or at --to <id>) atomically, reload PHP-FPM (cp), run the health gate.
# Installed as /usr/local/lib/aicc/release/rollback-release.sh (symlink /usr/local/sbin/aicc-rollback-release).
#
#   sudo aicc-rollback-release --kind site|cp [--to <release-id>] [--dry-run]
#
# After the swap `previous` := the release that was just replaced, so running the command twice flips back and forth.
# CODE rollback is NOT a DATABASE rollback (cp): see infra/release/README.md. If the release you are leaving changed the schema in a way the older code cannot
# read, restore the pre-release dump instead (data written after the dump is lost; that loss is accepted in the owner-approved model).
# Options as activate-release.sh: --root (sandbox for tests) --fpm-reload-cmd --smoke-cmd --smoke-timeout --smoke-interval --smoke-successes --smoke-url --smoke-resolve
# Exit codes: 0 ok, 1 refused, 2 usage, 3 the target is unhealthy (swap reverted), 5 lock held.
set -euo pipefail
umask 022
self="${BASH_SOURCE[0]}"; while [ -L "$self" ]; do d="$(cd "$(dirname "$self")" && pwd)"; self="$(readlink "$self")"; case "$self" in /*) ;; *) self="$d/$self";; esac; done
HERE="$(cd "$(dirname "$self")" && pwd)"
# shellcheck source=lib/release-common.sh
. "$HERE/lib/release-common.sh"
KIND=""; TO=""; ROOT="/srv/aicc"; SMOKE_CMD=""; SMOKE_TIMEOUT=30; SMOKE_INTERVAL=2; SMOKE_OK=2; SMOKE_URL=""; SMOKE_RESOLVE=""; FPM_RELOAD=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --kind) KIND="${2:-}"; shift 2 ;; --to) TO="${2:-}"; shift 2 ;; --root) ROOT="${2:-}"; shift 2 ;;
    --smoke-cmd) SMOKE_CMD="${2:-}"; shift 2 ;; --smoke-timeout) SMOKE_TIMEOUT="${2:-}"; shift 2 ;; --smoke-interval) SMOKE_INTERVAL="${2:-}"; shift 2 ;;
    --smoke-successes) SMOKE_OK="${2:-}"; shift 2 ;; --smoke-url) SMOKE_URL="${2:-}"; shift 2 ;; --smoke-resolve) SMOKE_RESOLVE="${2:-}"; shift 2 ;;
    --fpm-reload-cmd) FPM_RELOAD="${2:-}"; shift 2 ;; --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,14p "$self"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$KIND" in site|cp) ;; *) echo "--kind must be site or cp" >&2; exit 2 ;; esac
[ -z "$TO" ] || [[ "$TO" =~ $RELEASE_ID_RE ]] || { echo "--to must be a release id" >&2; exit 2; }
SANDBOX=0
if [ "$ROOT" != "/srv/aicc" ]; then [ -f "$ROOT/.aicc-sandbox" ] || { echo "REFUSED: sandbox root without marker" >&2; exit 1; }; SANDBOX=1
elif [ "$(id -u)" != "0" ]; then echo "must run as root (sudo). Refusing." >&2; exit 2; fi
KDIR="$ROOT/$KIND"; RDIR="$KDIR/releases"; CUR="$KDIR/current"; PREV="$KDIR/previous"
[ -n "$SMOKE_CMD" ] || SMOKE_CMD="$HERE/smoke-$KIND.sh"
if [ -z "$FPM_RELOAD" ]; then if [ "$SANDBOX" = 1 ]; then FPM_RELOAD="true"; else FPM_RELOAD="systemctl reload php8.3-fpm"; fi; fi
LOCKDIR="$KDIR/.release.lock"
rl_lock "$LOCKDIR" || { echo "another release operation is running" >&2; exit 5; }
trap 'rl_unlock "$LOCKDIR"' EXIT

OLD_CUR="$(link_target_id "$CUR")"
TARGET="${TO:-$(link_target_id "$PREV")}"
[ -n "$TARGET" ] || rl_die "no previous release to roll back to" 1
[ "$TARGET" != "$OLD_CUR" ] || rl_die "release $TARGET is already current" 1
[ -d "$RDIR/$TARGET" ] || rl_die "release $TARGET does not exist in $RDIR" 1
[ -f "$RDIR/$TARGET.FAILED" ] && rl_die "release $TARGET is marked FAILED (auto-rolled back earlier): refusing to activate it" 1
if [ "$DRY" = 1 ]; then echo "DRY-RUN: would set current -> $TARGET, previous -> ${OLD_CUR:-(none)}"; exit 0; fi

[ -n "$OLD_CUR" ] && atomic_symlink "$RDIR/$OLD_CUR" "$PREV"
atomic_symlink "$RDIR/$TARGET" "$CUR"
printf '%s ROLLBACK %s: current -> %s, previous -> %s\n' "$(rl_ts)" "$KIND" "$TARGET" "${OLD_CUR:-none}" >> "$KDIR/activation.log"
rl_log "current -> $TARGET, previous -> ${OLD_CUR:-(none)}"
[ "$KIND" = cp ] && { bash -c "$FPM_RELOAD" || true; }
deadline=$(( $(date -u +%s) + SMOKE_TIMEOUT )); ok=0
while :; do
  if AICC_RELEASE_DIR="$CUR" AICC_RELEASE_KIND="$KIND" AICC_SMOKE_URL="$SMOKE_URL" AICC_SMOKE_RESOLVE="$SMOKE_RESOLVE" bash -c "$SMOKE_CMD"; then ok=$((ok + 1)); else ok=0; fi
  [ "$ok" -ge "$SMOKE_OK" ] && break
  if [ "$(date -u +%s)" -ge "$deadline" ]; then
    rl_log "target $TARGET is UNHEALTHY: reverting the swap"
    [ -n "$OLD_CUR" ] && { atomic_symlink "$RDIR/$OLD_CUR" "$CUR"; atomic_symlink "$RDIR/$TARGET" "$PREV"; }
    [ "$KIND" = cp ] && { bash -c "$FPM_RELOAD" || true; }
    exit 3
  fi
  sleep "$SMOKE_INTERVAL"
done
echo "ROLLED BACK: current -> $TARGET (healthy)."
[ "$KIND" = cp ] && echo "NOTE: the database was NOT rolled back (see infra/release/README.md)."
exit 0
