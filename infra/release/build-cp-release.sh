#!/usr/bin/env bash
# Builds an IMMUTABLE Control Plane release ON THE MAC: WordPress core + WooCommerce (pinned, SHA-256 verified) + the AICC theme and plugin from the CP worktree.
#
#   infra/release/build-cp-release.sh --cp-worktree PATH [--out-dir DIR] [--wp-tar FILE] [--wc-zip FILE] [--storefront-zip FILE] [--with-payplus [--payplus-zip FILE]] [--environment production|staging] [--allow-dirty] [--epoch N] [--no-lint] [--dry-run]
#
#   --cp-worktree is REQUIRED (there is no default: the old default pointed at a stale worktree, so a forgotten flag silently shipped old code). Use the Control Plane worktree of the
#   approved commit, e.g. .../aicc-control-plane-worktrees/launch-integration.
#   --with-payplus (OPT-IN, off by default; the default build is byte-for-byte what it was): also packages the PINNED PayPlus Payment Gateway plugin (pins.env PAYPLUS_*, SHA-256 verified) as
#   wp-content/plugins/payplus-payment-gateway, recorded in the manifest. It is a build input, NOT an endorsement and it activates nothing: the owner still chooses the gateway, WooCommerce
#   settings and AICC_LM_PAID_GATEWAYS / AICC_EXTRA_ACCESSIBLE_HOSTS (owner facts) are separate owner steps (docs/launch/payplus-owner-kit.md).
#   --environment (default production) is recorded in the operator-only BUILD-INFO.php inside the AICC plugin (environment, CP git sha + dirty flag, SHA-256 of the theme's brand MANIFEST.json, plugin version, build time =
#   SOURCE_DATE_EPOCH so the build stays reproducible; the release id is the directory name on the host, the tree hash cannot be inside the tree). It is a PHP file that prints nothing when requested directly, so the web
#   server never serves it; wp-admin shows it to administrators only and `wp aicc-ops build-info` prints it. The same facts as plain JSON (with the release id) are written next to the tarball: cp-<id>.build-info.json.
#   Every build also runs `node scripts/sync-brand-kit.mjs --verify --strict` of THIS Site repo against the theme it just assembled and FAILS on drift (the Control Plane theme must carry the
#   Site brand kit byte-for-byte; re-sync with `node scripts/sync-brand-kit.mjs --to <theme>` in the CP worktree and commit there).
#
# Inputs (all verified; the build stops on the first mismatch). Also Storefront ${STOREFRONT_VERSION}, the PARENT theme of the AICC theme:
#   WordPress ${WP_VERSION} tarball and WooCommerce ${WC_VERSION} zip: infra/release/pins.env holds the version and SHA-256. If --wp-tar/--wc-zip are not given
#     they are looked up in the cache dir ($AICC_RELEASE_CACHE or ~/.cache/aicc-release) and otherwise downloaded over HTTPS (wordpress.org / downloads.wordpress.org).
#   Theme admin/wp-content/themes/aicc-admin and plugin admin/wp-content/plugins/aicc-license-manager come from `git archive HEAD` of the CP worktree
#     (--cp-worktree, required), so the same commit always gives the same bytes. Uncommitted changes in those two
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
CP=""
OUT="./release-out"; WPTAR=""; WCZIP=""; SFZIP=""; PPZIP=""; WITH_PP=0; ENVNAME="production"; DIRTY=""; EPOCH=""; LINT=1; DRY=0
CACHE="${AICC_RELEASE_CACHE:-$HOME/.cache/aicc-release}"
while [ $# -gt 0 ]; do
  case "$1" in
    --cp-worktree) CP="${2:-}"; shift 2 ;; --out-dir) OUT="${2:-}"; shift 2 ;; --wp-tar) WPTAR="${2:-}"; shift 2 ;; --wc-zip) WCZIP="${2:-}"; shift 2 ;; --storefront-zip) SFZIP="${2:-}"; shift 2 ;;
    --with-payplus) WITH_PP=1; shift ;; --payplus-zip) PPZIP="${2:-}"; shift 2 ;;
    --environment) ENVNAME="${2:-}"; shift 2 ;;
    --allow-dirty) DIRTY="--allow-dirty"; shift ;; --epoch) EPOCH="${2:-}"; shift 2 ;; --no-lint) LINT=0; shift ;; --dry-run) DRY=1; shift ;;
    -h|--help) sed -n 2,28p "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$CP" ] || rl_die "--cp-worktree is REQUIRED: pass the Control Plane worktree of the approved commit (there is deliberately no default; see --help)" 2
[ "$WITH_PP" = 1 ] || [ -z "$PPZIP" ] || rl_die "--payplus-zip only makes sense together with --with-payplus" 2
case "$ENVNAME" in production|staging) ;; *) rl_die "--environment must be production or staging" 2 ;; esac
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
if [ "$WITH_PP" = 1 ]; then
  [ -n "$PPZIP" ] || { PPZIP="$CACHE/payplus-payment-gateway-$PAYPLUS_VERSION.zip"; [ -f "$PPZIP" ] || { rl_log "downloading PayPlus Payment Gateway $PAYPLUS_VERSION (opt-in, pinned)"; fetch "$PAYPLUS_ZIP_URL" "$PPZIP"; }; }
fi
[ -n "$EPOCH" ] || EPOCH="$(git -C "$CP" log -1 --format=%ct HEAD)"
[[ "$EPOCH" =~ ^[0-9]+$ ]] || rl_die "bad --epoch" 2
if [ "$DRY" = 1 ]; then
  echo "DRY-RUN: would build WordPress $WP_VERSION ($WPTAR) + WooCommerce $WC_VERSION ($WCZIP) + Storefront $STOREFRONT_VERSION ($SFZIP)$([ "$WITH_PP" = 1 ] && echo " + PayPlus Payment Gateway $PAYPLUS_VERSION ($PPZIP; opt-in, not an endorsement)") + AICC theme/plugin from $CP (commit $(git -C "$CP" rev-parse --short HEAD)) into $OUT (SOURCE_DATE_EPOCH $EPOCH)"
  exit 0
fi

mkdir -p "$OUT"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
TREE="$WORK/tree"
rl_log "assembling WordPress $WP_VERSION + WooCommerce $WC_VERSION + AICC theme/plugin ..."
PPARGS=(); [ "$WITH_PP" = 1 ] && PPARGS=(--pp-zip "$PPZIP" --pp-sha256 "$PAYPLUS_ZIP_SHA256" --pp-version "$PAYPLUS_VERSION")
INFO="$(python3 -I "$HERE/lib/release_tool.py" assemble-cp --wp-tar "$WPTAR" --wc-zip "$WCZIP" --cp-repo "$CP" --out-tree "$TREE" \
  --sf-zip "$SFZIP" --sf-sha256 "$STOREFRONT_ZIP_SHA256" --sf-version "$STOREFRONT_VERSION" \
  --wp-sha256 "$WP_TARBALL_SHA256" --wc-sha256 "$WC_ZIP_SHA256" --wp-version "$WP_VERSION" --wc-version "$WC_VERSION" ${PPARGS[@]+"${PPARGS[@]}"} $DIRTY)"
python3 -I "$HERE/lib/release_tool.py" scan --tree "$TREE" --kind cp
# The brand kit in the packaged theme must equal THIS Site repo's kit (the Control Plane theme is never hand-edited; a stale or locally modified copy would ship another brand).
command -v node >/dev/null 2>&1 || rl_die "node is required to verify the brand kit of the packaged theme (the builder runs on the Mac)" 1
SITE_ROOT="$(cd "$HERE/../.." && pwd)"
node "$SITE_ROOT/scripts/sync-brand-kit.mjs" --verify "$TREE/wp-content/themes/aicc-admin" --strict >"$WORK/brand.out" 2>&1 || { cat "$WORK/brand.out" >&2; rl_die "BRAND KIT DRIFT: the packaged theme (CP worktree $CP) does not carry the brand kit of $SITE_ROOT byte-for-byte. Build from the matching Site and CP commits, or re-sync: node $SITE_ROOT/scripts/sync-brand-kit.mjs --to <CP theme dir> (then commit in the CP repo)" 1; }
rl_log "brand kit: $(tail -1 "$WORK/brand.out")"
# Operator-only build identification (see the header). Built from the facts assemble-cp recorded; deterministic.
BI_SHA="$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["cp_commit"])' "$INFO")"
BI_DIRTY=(); [ "$(python3 -I -c 'import json,sys; print(int(json.loads(sys.argv[1])["dirty"]))' "$INFO")" = 1 ] && BI_DIRTY=(--dirty)
python3 -I "$HERE/lib/release_tool.py" build-info --plugin-dir "$TREE/wp-content/plugins/aicc-license-manager" --theme-dir "$TREE/wp-content/themes/aicc-admin" \
  --environment "$ENVNAME" --cp-sha "$BI_SHA" --epoch "$EPOCH" --json-out "$WORK/build-info.json" ${BI_DIRTY[@]+"${BI_DIRTY[@]}"} >/dev/null
rl_log "build info: environment=$ENVNAME cp=${BI_SHA:0:12}"
if [ "$LINT" = 1 ] && command -v php >/dev/null 2>&1; then
  bad=0
  while IFS= read -r f; do php -l "$f" >/dev/null 2>"$WORK/lint.err" || { echo "php -l failed: $f"; cat "$WORK/lint.err"; bad=1; }; done < <(find "$TREE/wp-content/plugins/aicc-license-manager" "$TREE/wp-content/themes/aicc-admin" -name '*.php' -type f | sort)
  [ "$bad" = 0 ] || rl_die "PHP syntax errors in the AICC components" 1
  rl_log "php -l: AICC plugin and theme parse (local PHP $(php -r 'echo PHP_VERSION;'); the host runs 8.3)"
fi
PLUGIN_V="$(sed -n 's/^ \* Version:[[:space:]]*//p' "$TREE/wp-content/plugins/aicc-license-manager/aicc-license-manager.php" | head -1)"
THEME_V="$(sed -n 's/^Version:[[:space:]]*//p' "$TREE/wp-content/themes/aicc-admin/style.css" | head -1)"
META="$(python3 -I - "$INFO" "$WP_VERSION" "$WP_TARBALL_SHA256" "$WC_VERSION" "$WC_ZIP_SHA256" "$PLUGIN_V" "$THEME_V" "$STOREFRONT_VERSION" "$STOREFRONT_ZIP_SHA256" "$PAYPLUS_VERSION" "$PAYPLUS_ZIP_SHA256" <<'PY'
import json, sys
info = json.loads(sys.argv[1])
meta = {"wordpress": {"version": sys.argv[2], "tarball_sha256": sys.argv[3]}, "woocommerce": {"version": sys.argv[4], "zip_sha256": sys.argv[5]},
        "storefront": {"version": sys.argv[8], "zip_sha256": sys.argv[9]}, "aicc_plugin": {"version": sys.argv[6]}, "aicc_theme": {"version": sys.argv[7]}, "cp_commit": info["cp_commit"], "dirty": info["dirty"],
        "vendor_test_files_pruned": info["vendor_test_files_pruned"]}
if "payplus_version" in info:  # only an opt-in build (--with-payplus) records the plugin; the manifest of a default build is unchanged
    meta["payplus_payment_gateway"] = {"version": info["payplus_version"], "zip_sha256": sys.argv[11], "note": "pinned build input, not an endorsement; not activated"}
print(json.dumps(meta))
PY
)"
PACKED="$(python3 -I "$HERE/lib/release_tool.py" pack --tree "$TREE" --kind cp --out-dir "$OUT" --epoch "$EPOCH" --meta "$META")"
# plain-JSON copy of the build facts with the release id, OUTSIDE the document root (next to the tarball)
python3 -I - "$PACKED" "$WORK/build-info.json" "$OUT" <<'PY'
import json, os, sys
packed = json.loads(sys.argv[1]); info = json.load(open(sys.argv[2])); info["release_id"] = packed["release_id"]
with open(os.path.join(sys.argv[3], "cp-%s.build-info.json" % packed["release_id"]), "w") as f:
    json.dump(info, f, indent=2, sort_keys=True); f.write("\n")
PY
echo "$PACKED"
