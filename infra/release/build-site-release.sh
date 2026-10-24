#!/usr/bin/env bash
# Builds an immutable STATIC-SITE release ON THE MAC from the Next.js export (output: "export").
#
#   infra/release/build-site-release.sh --target stage --stage-id <32 hex> [--site-repo PATH] [--out-dir DIR] [--stage-host stage.copilt.org]
#   infra/release/build-site-release.sh --target production [--site-repo PATH] [--out-dir DIR]
#   add  --export-dir DIR  to package an existing export (skips `npm run build`; this is how the tests run)
#   add  --public-truth  (production target only): after the tree is assembled, run `node scripts/public-truth-gate.mjs --out <tree>` and REFUSE the release on any finding: "(pending)", TODO / TBD, placeholders,
#        test sentinels, stage / loopback / apex URLs, noindex, a wrong canonical, source maps, free-trial / Shopify / WordPress.org / conversion-percentage claims ... (docs/cutover/pre-commercial.md). Recommended for every production
#        release; off by default only so that the builder's own fixture trees (which are not real exports) keep working. Needs node on the Mac.
#   add  --cp-worktree PATH  (the Control Plane worktree this release will be paired with): BEFORE building, `node scripts/sync-brand-kit.mjs --verify --strict` runs against the theme
#        COMMITTED in that worktree (git archive HEAD) and the build FAILS on any drift from this Site repo's brand kit. A production build without --cp-worktree prints a loud warning.
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
SITE_REPO="$(cd "$HERE/../.." && pwd)"; OUT="./release-out"; TARGET=""; STAGE_ID=""; STAGE_HOST="stage.copilt.org"; EXPORT=""; EPOCH=""; DRY=0; CPW=""; PUBTRUTH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;; --stage-id) STAGE_ID="${2:-}"; shift 2 ;; --stage-host) STAGE_HOST="${2:-}"; shift 2 ;;
    --site-repo) SITE_REPO="${2:-}"; shift 2 ;; --out-dir) OUT="${2:-}"; shift 2 ;; --export-dir) EXPORT="${2:-}"; shift 2 ;; --cp-worktree) CPW="${2:-}"; shift 2 ;; --epoch) EPOCH="${2:-}"; shift 2 ;; --dry-run) DRY=1; shift ;; --public-truth) PUBTRUTH=1; shift ;;
    -h|--help) sed -n 2,25p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$TARGET" in stage|production) ;; *) echo "--target must be stage or production" >&2; exit 2 ;; esac
[ "$PUBTRUTH" = 0 ] || [ "$TARGET" = production ] || { echo "--public-truth applies to --target production only (a stage tree is noindex by design)" >&2; exit 2; }
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
CPBRAND=""
if [ -n "$CPW" ]; then
  git -C "$CPW" rev-parse --git-dir >/dev/null 2>&1 || rl_die "--cp-worktree $CPW is not a git worktree" 2
  command -v node >/dev/null 2>&1 || rl_die "node is required to verify the brand kit (the builder runs on the Mac)" 1
  mkdir -p "$WORK/cp-theme"
  git -C "$CPW" archive --format=tar "HEAD:admin/wp-content/themes/aicc-admin" | tar -x -C "$WORK/cp-theme" || rl_die "cannot read the committed AICC theme from $CPW" 1
  node "$SITE_REPO/scripts/sync-brand-kit.mjs" --verify "$WORK/cp-theme" --strict >"$WORK/brand.out" 2>&1 || { cat "$WORK/brand.out" >&2; rl_die "BRAND KIT DRIFT: the theme committed in $CPW does not carry the brand kit of $SITE_REPO byte-for-byte. Re-sync (node scripts/sync-brand-kit.mjs --to <CP theme dir>) and commit in the CP repo, or build from the matching commits" 1; }
  CPBRAND="$(git -C "$CPW" rev-parse --short HEAD)"; rl_log "brand kit: $(tail -1 "$WORK/brand.out") (CP commit $CPBRAND)"
elif [ "$TARGET" = production ]; then
  echo "WARNING: no --cp-worktree: the Control Plane theme's brand kit was NOT checked against this Site build. Pass --cp-worktree <CP worktree of the paired commit> for a production release." >&2
fi
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
  if [ "$PUBTRUTH" = 1 ]; then
    command -v node >/dev/null 2>&1 || rl_die "--public-truth needs node on the Mac (the builder runs there)" 1
    [ -f "$SITE_REPO/scripts/public-truth-gate.mjs" ] || rl_die "--public-truth: $SITE_REPO/scripts/public-truth-gate.mjs not found" 1
    node "$SITE_REPO/scripts/public-truth-gate.mjs" --out "$TREE" >"$WORK/public-truth.out" 2>&1 || { cat "$WORK/public-truth.out" >&2; rl_die "PUBLIC-TRUTH GATE: the production tree shows something internal, staged or untrue (see above). Fix the source or the owner facts and rebuild; nothing was packed" 1; }
    rl_log "public-truth gate: $(head -1 "$WORK/public-truth.out")"
  fi
fi
python3 -I "$HERE/lib/release_tool.py" scan --tree "$TREE" --kind site
SHA="$(git -C "$SITE_REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
# fail closed: a build whose commit cannot be determined (not a git checkout, git missing) is NOT clean; a production deploy requires dirty == false
DIRTYF=false; [ -n "$(git -C "$SITE_REPO" status --porcelain 2>/dev/null | head -1)" ] && DIRTYF=true
[ "$SHA" != unknown ] || DIRTYF=true
META="$(python3 -I - "$TARGET" "$SHA" "$DIRTYF" "$STAGE_HOST" "$CPBRAND" <<'PY'
import json, sys
t, sha, dirty, host, cpbrand = sys.argv[1:6]
meta = {"target": t, "site_commit": sha, "dirty": dirty == "true", "host": host if t == "stage" else "www.copilt.org"}
if cpbrand:  # only when verified; a build without --cp-worktree has the manifest it always had
    meta["cp_brand_kit_verified_at"] = cpbrand
print(json.dumps(meta))
PY
)"
python3 -I "$HERE/lib/release_tool.py" pack --tree "$TREE" --kind site --out-dir "$OUT" --epoch "$EPOCH" --meta "$META"
