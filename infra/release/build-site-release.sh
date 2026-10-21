#!/usr/bin/env bash
# Builds an immutable STATIC-SITE release ON THE MAC from the Next.js export (output: "export").
#
#   infra/release/build-site-release.sh --target stage --stage-id <32 hex> [--site-repo PATH] [--out-dir DIR] [--stage-host stage.copilt.org]
#   infra/release/build-site-release.sh --target production [--site-repo PATH] [--out-dir DIR]
#   add  --export-dir DIR  to package an existing export (skips `npm run build`; this is how the tests run)
#
# --target stage:
#     build:  AICC_DIST_DIR=<tmp> AICC_BASE_PATH="" SITE_URL=https://stage.copilt.org npm run build   (the repo's own out/ is NOT overwritten)
#     then:   <meta name="robots" content="noindex, nofollow, noarchive, nosnippet"> injected into EVERY html file, robots.txt = "Disallow: /", sitemap.xml removed,
#             /.well-known/aicc-stage-identity = {"env":"staging","host":"stage.copilt.org","id":"<id>"} (the shape of the Caddyfile's own identity route) added. The stage id is created ON THE HOST by
#             install-stack.sh (grep AICC_STAGE_ID /etc/aicc-stage-identity) and deploy-release.sh refuses a target whose identity differs from the one in this build.
# --target production:
#     build:  AICC_BASE_PATH="" SITE_URL=https://www.copilt.org npm run build ; NO noindex, NO identity file, robots.txt untouched; a --stage-id is REFUSED.
#     The result is checked: `site-check --target production` fails the build if the tree carries noindex, a blanket Disallow or any stage identity.
# Both: docs/cutover/50x.html is copied to 50x.html (the edge preflight requires index.html, 404.html and 50x.html).
# Output in --out-dir (default ./release-out): site-<id>.tar.gz, site-<id>.manifest.json, site-<id>.SHA256SUMS.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/release-common.sh
. "$HERE/lib/release-common.sh"
SITE_REPO="$(cd "$HERE/../.." && pwd)"; OUT="./release-out"; TARGET=""; STAGE_ID=""; STAGE_HOST="stage.copilt.org"; EXPORT=""; EPOCH=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;; --stage-id) STAGE_ID="${2:-}"; shift 2 ;; --stage-host) STAGE_HOST="${2:-}"; shift 2 ;;
    --site-repo) SITE_REPO="${2:-}"; shift 2 ;; --out-dir) OUT="${2:-}"; shift 2 ;; --export-dir) EXPORT="${2:-}"; shift 2 ;; --epoch) EPOCH="${2:-}"; shift 2 ;; --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,22p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$TARGET" in stage|production) ;; *) echo "--target must be stage or production" >&2; exit 2 ;; esac
if [ "$TARGET" = stage ]; then
  [[ "$STAGE_ID" =~ ^[0-9a-f]{32}$ ]] || { echo "--target stage needs --stage-id <32 lowercase hex> (from the host's /etc/aicc-stage-identity)" >&2; exit 2; }
  [[ "$STAGE_HOST" =~ ^stage[a-z0-9-]*\.copilt\.org$ ]] || { echo "REFUSED: --stage-host must be a stage*.copilt.org name" >&2; exit 3; }
else
  [ -z "$STAGE_ID" ] || { echo "REFUSED: a production build must not carry a stage id" >&2; exit 3; }
fi
[ -f "$SITE_REPO/docs/cutover/50x.html" ] || rl_die "site repo not found at $SITE_REPO" 2
[[ "$EPOCH" =~ ^[0-9]*$ ]] || rl_die "bad --epoch" 2
[ -n "$EPOCH" ] || EPOCH="$(date -u +%s)"
if [ "$DRY" = 1 ]; then echo "DRY-RUN: would build a $TARGET site release from $SITE_REPO ${EXPORT:+(existing export $EXPORT) }into $OUT"; exit 0; fi
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
if [ -z "$EXPORT" ]; then
  # Next resolves distDir RELATIVE to the repo (an absolute path is re-rooted under it), so build into a relative, git-ignored directory and copy out
  REL_EXPORT=".release-build-$$"; EXPORT="$SITE_REPO/$REL_EXPORT"; trap 'rm -rf "$WORK" "$SITE_REPO/$REL_EXPORT"' EXIT
  SITE_URL="https://www.copilt.org"; [ "$TARGET" = stage ] && SITE_URL="https://$STAGE_HOST"
  rl_log "building the static export for $SITE_URL (AICC_BASE_PATH=\"\", AICC_DIST_DIR=$EXPORT) ..."
  ( cd "$SITE_REPO" && AICC_DIST_DIR="$REL_EXPORT" AICC_BASE_PATH="" SITE_URL="$SITE_URL" npm run build )
fi
[ -f "$EXPORT/index.html" ] || rl_die "no index.html in the export $EXPORT" 1
TREE="$WORK/tree"; mkdir -p "$TREE"
rsync -a --exclude '.DS_Store' "$EXPORT"/ "$TREE"/
cp "$SITE_REPO/docs/cutover/50x.html" "$TREE/50x.html"
# a stage transform must never be applied to a tree that already is a stage tree, nor a production tree contain one
if [ "$TARGET" = stage ]; then
  [ ! -e "$TREE/.well-known/aicc-stage-identity" ] || rl_die "the export already contains a stage identity file" 1
  python3 -I "$HERE/lib/release_tool.py" site-stage --tree "$TREE" --stage-id "$STAGE_ID" --host "$STAGE_HOST"
  python3 -I "$HERE/lib/release_tool.py" site-check --tree "$TREE" --target stage --stage-id "$STAGE_ID"
else
  python3 -I "$HERE/lib/release_tool.py" site-check --tree "$TREE" --target production
fi
python3 -I "$HERE/lib/release_tool.py" scan --tree "$TREE" --kind site
SHA="$(git -C "$SITE_REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
# fail closed: a build whose commit cannot be determined (not a git checkout, git missing) is NOT clean; a production deploy requires dirty == false
DIRTYF=false; [ -n "$(git -C "$SITE_REPO" status --porcelain 2>/dev/null | head -1)" ] && DIRTYF=true
[ "$SHA" != unknown ] || DIRTYF=true
META="$(python3 -I - "$TARGET" "$SHA" "$DIRTYF" "$STAGE_HOST" <<'PY'
import json, sys
t, sha, dirty, host = sys.argv[1:5]
print(json.dumps({"target": t, "site_commit": sha, "dirty": dirty == "true", "host": host if t == "stage" else "www.copilt.org"}))
PY
)"
python3 -I "$HERE/lib/release_tool.py" pack --tree "$TREE" --kind site --out-dir "$OUT" --epoch "$EPOCH" --meta "$META"
