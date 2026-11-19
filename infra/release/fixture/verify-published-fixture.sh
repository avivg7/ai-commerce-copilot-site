#!/usr/bin/env bash
# A DISPOSABLE Control Plane + WordPress fixture for verify-published-plugin.sh (P41 R). Loopback only, throwaway data, throwaway signing keys: it never touches a real host, key or vault.
# It uses the Control Plane's own fixture bring-up (tests/run-all.sh with AICC_LM_TEST_KEEP=1, no test files), installs the release you give it into a private release store with the REAL host installer
# (scripts/plugin-release/install-plugin-release.sh) against the throwaway PUBLIC key list, tells the fixture only that public key list, and seeds three synthetic customers (see cp-seed.php).
#
#   verify-published-fixture.sh up   --cp <CP worktree> --zip Z --manifest M --sig S --pubkeys <b64[,b64]> --dir <state dir> [--ports MYSQL,HTTP]      (default ports 9910,9911: builder R's range 9910-9919)
#   verify-published-fixture.sh down --dir <state dir>
#   verify-published-fixture.sh env  --dir <state dir>      prints the base url, paths and ports to use with verify-published-plugin.sh
# The state dir (0700) holds fixture.env (0600), creds.env (0600: AICC_VERIFY_USER/PASS of customer A), creds-b.env, creds-c.env (the revoked customer), store.env (0600: store A's activation_ref + origin, store B's ref).
# `down` shuts MySQL and the web server and removes the temp tree. Ports are refused outside 9910-9919 unless AICC_FX_PORT_MIN/MAX say otherwise, and the QA stack's ports always.
# shellcheck disable=SC2016,SC2174
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
die() { echo "verify-published-fixture: $*" >&2; exit 1; }
CMD="${1:-}"; shift || true
CP=""; ZIP=""; MAN=""; SIG=""; KEYS=""; DIR=""; PORTS="9910,9911"
while [ $# -gt 0 ]; do
  case "$1" in --cp) CP="$2"; shift 2;; --zip) ZIP="$2"; shift 2;; --manifest) MAN="$2"; shift 2;; --sig) SIG="$2"; shift 2;; --pubkeys) KEYS="$2"; shift 2;; --dir) DIR="$2"; shift 2;; --ports) PORTS="$2"; shift 2;; *) die "unknown argument $1";; esac
done
[ -n "$DIR" ] || { [ -z "$CMD" ] && { sed -n 2,12p "${BASH_SOURCE[0]}"; exit 2; }; die "--dir is required"; }
LOCAL="$HOME/Library/Application Support/Local/lightning-services"
find_php() { local c; for c in "$LOCAL"/php-*/bin/*/bin/php; do if [ -x "$c" ] && "$c" -m 2>/dev/null | grep -q mysqli; then echo "$c"; return; fi; done; command -v php; }
find_mysqld() { local c; for c in "$LOCAL"/mysql-*/bin/*/bin/mysqld "$LOCAL"/mariadb-*/bin/*/bin/mariadbd /opt/homebrew/opt/mysql/bin/mysqld; do [ -x "$c" ] && { echo "$c"; return; }; done; }
PHPB="$(find_php)"; MYSQLD="$(find_mysqld)"; WPCLI="$(command -v wp || true)"
IFS=, read -r P_MY P_HTTP <<< "$PORTS"
case "$CMD" in
up)
  [ -d "$CP/admin/wp-content/plugins/aicc-license-manager" ] || die "--cp must be a Control Plane worktree"
  for f in "$ZIP" "$MAN" "$SIG"; do [ -f "$f" ] || die "missing $f"; done
  [ -n "$KEYS" ] || die "--pubkeys is required (the throwaway PUBLIC key list)"
  [ -n "$PHPB" ] && [ -n "$MYSQLD" ] && [ -n "$WPCLI" ] || die "need php (mysqli), mysqld and wp-cli on this Mac"
  lo="${AICC_FX_PORT_MIN:-9910}"; hi="${AICC_FX_PORT_MAX:-9919}"
  for p in "$P_MY" "$P_HTTP"; do
    case "$p" in 89[89][0-9]|9101|9102|9103|9104|911[1-4]|912[1-7]|9161|930[12]) die "port $p belongs to the QA stack";; esac
    [ "$p" -ge "$lo" ] && [ "$p" -le "$hi" ] || die "port $p outside $lo-$hi"
    "$PHPB" -r '$s=@fsockopen("127.0.0.1",(int)$argv[1],$e,$m,0.5); exit($s?0:1);' "$p" && die "port $p is already in use"
  done
  df -k /Users | awk 'NR==2 { if ($4 < 15*1024*1024) { exit 1 } }' || die "less than 15 GiB free on /Users (disk floor)"
  mkdir -p "$DIR"; chmod 700 "$DIR"; umask 077
  LOG="$DIR/cp-fixture.log"
  ( cd "$CP" && AICC_LM_TEST_KEEP=1 AICC_LM_TEST_ONLY='run_no_such_test_*' AICC_LM_TEST_PHP="$PHPB" AICC_LM_TEST_MYSQLD="$MYSQLD" AICC_LM_TEST_WP_CLI="$WPCLI" AICC_LM_TEST_MYSQL_PORT="$P_MY" AICC_LM_TEST_HTTP_PORT="$P_HTTP" bash tests/run-all.sh ) > "$LOG" 2>&1
  FIX="$(sed -n 's/.*fixture left standing at \(.*\))$/\1/p' "$LOG" | tail -1)"
  [ -n "$FIX" ] && [ -d "$FIX/wp" ] || { tail -15 "$LOG" >&2; die "the Control Plane fixture did not come up"; }
  BASE="http://127.0.0.1:$P_HTTP"
  printf 'FIX=%q\nBASE=%q\nP_MY=%q\nP_HTTP=%q\nPHPB=%q\nWPCLI=%q\n' "$FIX" "$BASE" "$P_MY" "$P_HTTP" "$PHPB" "$WPCLI" > "$DIR/fixture.env"
  WPF() { "$PHPB" -d memory_limit=1024M "$WPCLI" "$@" --path="$FIX/wp"; }
  WPF rewrite structure '/%postname%/' >/dev/null 2>&1; WPF rewrite flush >/dev/null 2>&1
  # the release store: the REAL host installer, the throwaway PUBLIC list as its trust anchor
  REL="$DIR/release-store"; mkdir -m 0750 -p "$REL"
  SHA="$(shasum -a 256 "$ZIP" | cut -d' ' -f1)"
  bash "$CP/scripts/plugin-release/install-plugin-release.sh" --release-dir "$REL" --pubkeys "$KEYS" --zip "$ZIP" --manifest "$MAN" --signature "$SIG" --expect-sha256 "$SHA" --set-current > "$DIR/install.log" 2>&1 || { tail -5 "$DIR/install.log" >&2; die "the host installer refused the release"; }
  ( cd "$CP" && AICC_E2E_STEP=release_dir AICC_E2E_RELEASE_DIR="$REL" "$PHPB" -d memory_limit=1024M "$WPCLI" eval-file tests/fixture/e2e-plugin-store.php --path="$FIX/wp" >/dev/null 2>&1 )
  WPF option update aicc_lm_test_plugin_signing_pubkeys "$KEYS" >/dev/null 2>&1
  PA="$("$PHPB" -r 'echo bin2hex(random_bytes(12));')"; PB="$("$PHPB" -r 'echo bin2hex(random_bytes(12));')"; PC="$("$PHPB" -r 'echo bin2hex(random_bytes(12));')"
  ORA="https://shop-a-$("$PHPB" -r 'echo bin2hex(random_bytes(3));').example"; ORB="https://shop-b-$("$PHPB" -r 'echo bin2hex(random_bytes(3));').example"
  ( cd "$CP" && AICC_FX_CP="$CP" AICC_FX_OUT="$DIR/seed.json" AICC_FX_PASS_A="$PA" AICC_FX_PASS_B="$PB" AICC_FX_PASS_C="$PC" AICC_FX_ORIGIN_A="$ORA" AICC_FX_ORIGIN_B="$ORB" \
      "$PHPB" -d memory_limit=1024M "$WPCLI" eval-file "$HERE/cp-seed.php" --path="$FIX/wp" ) > "$DIR/seed.log" 2>&1 || { tail -5 "$DIR/seed.log" >&2; die "seeding failed"; }
  J() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$DIR/seed.json" "$1"; }
  printf 'AICC_VERIFY_USER=%s\nAICC_VERIFY_PASS=%s\n' "$(J login_a)" "$PA" > "$DIR/creds.env"
  printf 'AICC_VERIFY_USER=%s\nAICC_VERIFY_PASS=%s\n' "$(J login_b)" "$PB" > "$DIR/creds-b.env"
  printf 'AICC_VERIFY_USER=%s\nAICC_VERIFY_PASS=%s\n' "$(J login_c)" "$PC" > "$DIR/creds-c.env"
  printf 'AICC_STORE_ACTIVATION_REF=%s\nAICC_STORE_ORIGIN=%s\nAICC_OTHER_ACTIVATION_REF=%s\nAICC_OTHER_ORIGIN=%s\n' "$(J act_a)" "$ORA" "$(J act_b)" "$ORB" > "$DIR/store.env"
  rm -f "$DIR/seed.json"
  printf 'REL=%q\n' "$REL" >> "$DIR/fixture.env"
  chmod 600 "$DIR"/*.env
  echo "fixture up: $BASE  (state $DIR; tear down with: $0 down --dir $DIR)" ;;
down)
  [ -f "$DIR/fixture.env" ] || die "no fixture.env in $DIR"
  FIX=""; P_HTTP=""; P_MY=""
  # shellcheck disable=SC1091
  . "$DIR/fixture.env"
  [ -n "$P_HTTP" ] && pkill -f "php.*-S 127.0.0.1:${P_HTTP}" 2>/dev/null
  if [ -n "$P_MY" ]; then "$PHPB" -d display_errors=0 -r 'mysqli_report(MYSQLI_REPORT_OFF); $d=@new mysqli("127.0.0.1","root","",null,(int)$argv[1]); if(!$d->connect_errno){ $d->query("SHUTDOWN"); }' "$P_MY" 2>/dev/null; fi
  sleep 2
  if [ -n "$P_MY" ]; then rm -f /tmp/aicc-lm-test-"${P_MY}"-*.sock* 2>/dev/null; fi
  if [ -n "$FIX" ] && [ -d "$FIX" ]; then rm -f "${FIX:?}/wp/wp-content/plugins/aicc-license-manager"; rm -rf "${FIX:?}"; fi
  rm -rf "${DIR:?}/release-store"; rm -f "${DIR:?}"/*.env "${DIR:?}"/*.log
  echo "fixture down" ;;
env)
  [ -f "$DIR/fixture.env" ] || die "no fixture.env in $DIR"
  grep -v '^PHPB=\|^WPCLI=' "$DIR/fixture.env" ;;
*) sed -n 2,12p "${BASH_SOURCE[0]}"; exit 2 ;;
esac
