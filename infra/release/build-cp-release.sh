#!/usr/bin/env bash
# Builds an IMMUTABLE Control Plane release ON THE MAC: WordPress core + WooCommerce (pinned, SHA-256 verified) + the AICC theme and plugin from the CP worktree.
#
#   infra/release/build-cp-release.sh [--cp-worktree PATH] [--out-dir DIR] [--wp-tar FILE] [--wc-zip FILE] [--allow-dirty] [--epoch N] [--no-lint] [--dry-run]
#
# Inputs (all verified; the build stops on the first mismatch). Also Storefront ${STOREFRONT_VERSION}, the PARENT theme of the AICC theme:
#   WordPress ${WP_VERSION} tarball and WooCommerce ${WC_VERSION} zip: infra/release/pins.env holds the version and SHA-256. If --wp-tar/--wc-zip are not given
#     they are looked up in the cache dir ($AICC_RELEASE_CACHE or ~/.cache/aicc-release) and otherwise downloaded over HTTPS (wordpress.org / downloads.wordpress.org).
#   Theme admin/wp-content/themes/aicc-admin and plugin admin/wp-content/plugins/aicc-license-manager come from `git archive HEAD` of the CP worktree
#     (default: .../aicc-control-plane-worktrees/cp2a-14-readiness-independence), so the same commit always gives the same bytes. Uncommitted changes in those two
#     paths make the build refuse (--allow-dirty builds from the working tree and records "dirty": true).
# What the release tree contains: WordPress core without akismet/hello/older default themes/readme/license/sample config; wp-content/plugins/woocommerce (its shipped test
#   directories removed: Jest specs and vendor PHPT tests); the two AICC components without tests/VCS/editor files; symlinks wp-content/uploads -> /srv/aicc/shared/uploads and wp-config.php ->
#   /srv/aicc/shared/wp-config.php. NO database, no fixture or QA data, no .git, no wp-config with content, no secrets: `release_tool.py scan` must pass.
# Output in --out-dir (default ./release-out): cp-<id>.tar.gz (deterministic), cp-<id>.manifest.json (hashes, sources, commit), cp-<id>.SHA256SUMS.
# Reproducible: SOURCE_DATE_EPOCH defaults to the CP commit time, so two builds of one commit give identical tarball bytes (checked by infra:test).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/release-common.sh
. "$HERE/lib/release-common.sh"
# shellcheck disable=SC1091
. "$HERE/pins.env"
CP="/Users/avivgerman/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/cp2a-14-readiness-independence"
OUT="./release-out"; WPTAR=""; WCZIP=""; SFZIP=""; DIRTY=""; EPOCH=""; LINT=1; DRY=0
CACHE="${AICC_RELEASE_CACHE:-$HOME/.cache/aicc-release}"
while [ $# -gt 0 ]; do
  case "$1" in
    --cp-worktree) CP="${2:-}"; shift 2 ;; --out-dir) OUT="${2:-}"; shift 2 ;; --wp-tar) WPTAR="${2:-}"; shift 2 ;; --wc-zip) WCZIP="${2:-}"; shift 2 ;; --storefront-zip) SFZIP="${2:-}"; shift 2 ;;
    --allow-dirty) DIRTY="--allow-dirty"; shift ;; --epoch) EPOCH="${2:-}"; shift 2 ;; --no-lint) LINT=0; shift ;; --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,22p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -d "$CP/admin/wp-content/plugins/aicc-license-manager" ] || rl_die "CP worktree not found at $CP" 2
git -C "$CP" rev-parse --git-dir >/dev/null 2>&1 || rl_die "$CP is not a git worktree" 2
mkdir -p "$CACHE"
fetch() { # fetch <url> <dest>
  case "$1" in https://wordpress.org/*|https://downloads.wordpress.org/*) ;; *) rl_die "refusing to download from $1" ;; esac
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --max-time 600 -o "$2.partial" "$1" && mv "$2.partial" "$2"
}
[ -n "$WPTAR" ] || { WPTAR="$CACHE/wordpress-$WP_VERSION.tar.gz"; [ -f "$WPTAR" ] || { rl_log "downloading WordPress $WP_VERSION"; fetch "$WP_TARBALL_URL" "$WPTAR"; }; }
[ -n "$WCZIP" ] || { WCZIP="$CACHE/woocommerce-$WC_VERSION.zip"; [ -f "$WCZIP" ] || { rl_log "downloading WooCommerce $WC_VERSION"; fetch "$WC_ZIP_URL" "$WCZIP"; }; }
[ -n "$SFZIP" ] || { SFZIP="$CACHE/storefront-$STOREFRONT_VERSION.zip"; [ -f "$SFZIP" ] || { rl_log "downloading Storefront $STOREFRONT_VERSION"; fetch "$STOREFRONT_ZIP_URL" "$SFZIP"; }; }
[ -n "$EPOCH" ] || EPOCH="$(git -C "$CP" log -1 --format=%ct HEAD)"
[[ "$EPOCH" =~ ^[0-9]+$ ]] || rl_die "bad --epoch" 2
if [ "$DRY" = 1 ]; then
  echo "DRY-RUN: would build WordPress $WP_VERSION ($WPTAR) + WooCommerce $WC_VERSION ($WCZIP) + Storefront $STOREFRONT_VERSION ($SFZIP) + AICC theme/plugin from $CP (commit $(git -C "$CP" rev-parse --short HEAD)) into $OUT (SOURCE_DATE_EPOCH $EPOCH)"
  exit 0
fi

mkdir -p "$OUT"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
TREE="$WORK/tree"
rl_log "assembling WordPress $WP_VERSION + WooCommerce $WC_VERSION + AICC theme/plugin ..."
INFO="$(python3 -I "$HERE/lib/release_tool.py" assemble-cp --wp-tar "$WPTAR" --wc-zip "$WCZIP" --cp-repo "$CP" --out-tree "$TREE" \
  --sf-zip "$SFZIP" --sf-sha256 "$STOREFRONT_ZIP_SHA256" --sf-version "$STOREFRONT_VERSION" \
  --wp-sha256 "$WP_TARBALL_SHA256" --wc-sha256 "$WC_ZIP_SHA256" --wp-version "$WP_VERSION" --wc-version "$WC_VERSION" $DIRTY)"
python3 -I "$HERE/lib/release_tool.py" scan --tree "$TREE" --kind cp
if [ "$LINT" = 1 ] && command -v php >/dev/null 2>&1; then
  bad=0
  while IFS= read -r f; do php -l "$f" >/dev/null 2>"$WORK/lint.err" || { echo "php -l failed: $f"; cat "$WORK/lint.err"; bad=1; }; done < <(find "$TREE/wp-content/plugins/aicc-license-manager" "$TREE/wp-content/themes/aicc-admin" -name '*.php' -type f | sort)
  [ "$bad" = 0 ] || rl_die "PHP syntax errors in the AICC components" 1
  rl_log "php -l: AICC plugin and theme parse (local PHP $(php -r 'echo PHP_VERSION;'); the host runs 8.3)"
fi
PLUGIN_V="$(sed -n 's/^ \* Version:[[:space:]]*//p' "$TREE/wp-content/plugins/aicc-license-manager/aicc-license-manager.php" | head -1)"
THEME_V="$(sed -n 's/^Version:[[:space:]]*//p' "$TREE/wp-content/themes/aicc-admin/style.css" | head -1)"
META="$(python3 -I - "$INFO" "$WP_VERSION" "$WP_TARBALL_SHA256" "$WC_VERSION" "$WC_ZIP_SHA256" "$PLUGIN_V" "$THEME_V" "$STOREFRONT_VERSION" "$STOREFRONT_ZIP_SHA256" <<'PY'
import json, sys
info = json.loads(sys.argv[1])
print(json.dumps({"wordpress": {"version": sys.argv[2], "tarball_sha256": sys.argv[3]}, "woocommerce": {"version": sys.argv[4], "zip_sha256": sys.argv[5]},
                  "storefront": {"version": sys.argv[8], "zip_sha256": sys.argv[9]}, "aicc_plugin": {"version": sys.argv[6]}, "aicc_theme": {"version": sys.argv[7]}, "cp_commit": info["cp_commit"], "dirty": info["dirty"],
                  "vendor_test_files_pruned": info["vendor_test_files_pruned"]}))
PY
)"
python3 -I "$HERE/lib/release_tool.py" pack --tree "$TREE" --kind cp --out-dir "$OUT" --epoch "$EPOCH" --meta "$META"
