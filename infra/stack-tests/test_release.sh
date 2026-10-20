#!/usr/bin/env bash
# Tests of the release tooling in temp dirs (no network, no ssh, no server): swap atomicity, rollback, carry-forward of _next/static, refusal paths, the CP
# tarball content (no secrets / fixtures), reproducibility, stage vs production site builds, and the deploy script's guards (with stubbed ssh/rsync).
# Run: bash infra/stack-tests/test_release.sh      (about 1 minute; builds the real CP tarball twice from the CP worktree)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"; REL="$REPO/infra/release"
T_SUITE="release"; . "$HERE/lib/t.sh"
. "$REL/lib/release-common.sh"
TOOL=(python3 -I "$REL/lib/release_tool.py")
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
EPOCH0=1792500000

# ---- helpers -----------------------------------------------------------------------------------------------------------------------------------
new_root() { local r="$TMP/root.$1"; rm -rf "$r"; mkdir -p "$r"/{site,cp}/releases "$r"/shared/uploads "$r"/backups; touch "$r/.aicc-sandbox"; echo "$r"; }
# make_tree <dir> <label> <healthy:1|0> [chunk ...]    synthetic static-site tree
make_site_tree() { local d="$1" label="$2" healthy="$3"; shift 3; rm -rf "$d"; mkdir -p "$d/_next/static/chunks"
  printf '%s' "$label" > "$d/index.html"; echo 404 > "$d/404.html"; echo 50x > "$d/50x.html"; [ "$healthy" = 1 ] && echo ok > "$d/HEALTHY"
  local c; for c in "$@"; do echo "chunk $c" > "$d/_next/static/chunks/$c"; done; }
# stage_incoming <root> <kind> <treedir> <epoch>  -> prints release id; places .incoming-<id> + metadata exactly like deploy-release.sh does
stage_incoming() { local root="$1" kind="$2" tree="$3" epoch="$4" out="$TMP/pack.$RANDOM" id
  mkdir -p "$out"; id="$("${TOOL[@]}" pack --tree "$tree" --kind "$kind" --out-dir "$out" --epoch "$epoch" | python3 -c 'import json,sys;print(json.load(sys.stdin)["release_id"])')"
  cp -R "$tree" "$root/$kind/releases/.incoming-$id"; cp "$out/$kind-$id.manifest.json" "$root/$kind/releases/.incoming-$id.manifest.json"; cp "$out/$kind-$id.SHA256SUMS" "$root/$kind/releases/.incoming-$id.SHA256SUMS"
  echo "$id"; }
ACT() { bash "$REL/activate-release.sh" --root "$1" --kind "$2" --release-id "$3" --smoke-cmd 'test -f "$AICC_RELEASE_DIR/HEALTHY"' --smoke-timeout 2 --smoke-interval 1 --smoke-successes 1 "${@:4}"; }
cur() { link_target_id "$1/$2/current"; }
prev() { link_target_id "$1/$2/previous"; }
fresh_backup() { # fresh_backup <root> [age-seconds] [restore_check]
  local r="$1" age="${2:-60}" rc="${3:-ok}" now; now="$(date -u +%s)"; printf 'DUMPDATA' | gzip -c > "$r/backups/aicc_cp-test.sql.gz"
  echo "$(sha256_of_file "$r/backups/aicc_cp-test.sql.gz")  aicc_cp-test.sql.gz" > "$r/backups/aicc_cp-test.sql.gz.sha256"
  jq -n --argjson e "$((now - age))" --arg rc "$rc" '{status:"ok",last_success:{finished_epoch:$e,db_dump_file:"aicc_cp-test.sql.gz"},db_dump:{restore_check:$rc}}' > "$r/backups/status.json"; }

echo "== swap atomicity =="
R="$(new_root atom)"; mkdir -p "$R/a" "$R/b"; printf A > "$R/a/index.html"; printf B > "$R/b/index.html"; ln -s "$R/a" "$R/current"
cat > "$TMP/reader.py" <<'PY'
import errno, json, os, sys
link, stopfile = sys.argv[1], sys.argv[2]
n = enoent = partial = other = 0
while not os.path.exists(stopfile):
    n += 1
    try:
        with open(os.path.join(link, "index.html")) as f: c = f.read()
    except OSError as e:
        if e.errno == errno.ENOENT: enoent += 1      # the link (or its target) was missing for a moment: NOT atomic
        else: other += 1                              # e.g. EINVAL: see the note in the test
        continue
    if c not in ("A", "B"): partial += 1              # neither the old nor the new content
print(json.dumps({"reads": n, "enoent": enoent, "partial": partial, "other": other}))
PY
python3 "$TMP/reader.py" "$R/current" "$TMP/stop-atom" > "$TMP/reader.out" &
RPID=$!
sleep 0.3
i=0; while [ $i -lt 200 ]; do if [ $((i % 2)) = 0 ]; then atomic_symlink "$R/b" "$R/current"; else atomic_symlink "$R/a" "$R/current"; fi; i=$((i + 1)); done
touch "$TMP/stop-atom"; wait $RPID
reads="$(jq .reads "$TMP/reader.out")"; enoent="$(jq .enoent "$TMP/reader.out")"; partial="$(jq .partial "$TMP/reader.out")"; other="$(jq .other "$TMP/reader.out")"
if [ "$reads" -gt 2000 ] && [ "$enoent" = 0 ] && [ "$partial" = 0 ]; then t_pass "200 atomic swaps under a concurrent reader: $reads reads, 0 missing-link, 0 partial-content"; else t_bad "atomic swap under load" "$(cat "$TMP/reader.out")"; fi
# NOTE (honest): on macOS/APFS a reader sometimes gets a transient EINVAL while rename(2) replaces a symlink it is resolving (seen with the pure-Python os.replace
# swapper too, so it is the kernel, not the script). Linux is the target; there the expectation is other=0. Reported, and enforced only on Linux.
if [ "$(uname -s)" = "Linux" ]; then t_eq "Linux: no transient read errors at all during the swaps" "$other" "0"; else t_skip "no transient EINVAL during swaps" "Darwin kernel quirk ($other of $reads reads); must be re-checked on the Linux host"; fi
t_ok "the swap leaves no temp links behind" bash -c "[ -z \"\$(ls -A '$R' | grep 'current.tmp')\" ]"

echo "== site: activation, previous pointer, carry-forward of _next/static =="
R="$(new_root site)"
make_site_tree "$TMP/s1" "S1" 1 a1.js shared.js; ID1="$(stage_incoming "$R" site "$TMP/s1" $EPOCH0)"
t_ok "first site release activates" ACT "$R" site "$ID1"
t_eq "current -> first release" "$(cur "$R" site)" "$ID1"
t_eq "no previous yet" "$(prev "$R" site)" ""
make_site_tree "$TMP/s2" "S2" 1 b2.js shared.js; ID2="$(stage_incoming "$R" site "$TMP/s2" $((EPOCH0 + 10)))"
t_ok "second release activates" ACT "$R" site "$ID2" --keep 8
t_eq "current -> second" "$(cur "$R" site)" "$ID2"
t_eq "previous -> first" "$(prev "$R" site)" "$ID1"
t_ok "old chunk a1.js carried into the new release" test -f "$R/site/releases/$ID2/_next/static/chunks/a1.js"
t_eq "HTML comes from the new build only" "$(cat "$R/site/releases/$ID2/index.html")" "S2"
t_ok "the first release still has its own chunk (nothing was removed)" test -f "$R/site/releases/$ID1/_next/static/chunks/a1.js"
make_site_tree "$TMP/s3" "S3" 1 c3.js; ID3="$(stage_incoming "$R" site "$TMP/s3" $((EPOCH0 + 20)))"; ACT "$R" site "$ID3" --keep 8 >/dev/null
make_site_tree "$TMP/s4" "S4" 1 d4.js; ID4="$(stage_incoming "$R" site "$TMP/s4" $((EPOCH0 + 30)))"; ACT "$R" site "$ID4" --keep 8 >/dev/null
t_ok "chunk a1.js still carried 3 releases later (S4 carries from S3,S2,S1)" test -f "$R/site/releases/$ID4/_next/static/chunks/a1.js"
make_site_tree "$TMP/s5" "S5" 1 e5.js; ID5="$(stage_incoming "$R" site "$TMP/s5" $((EPOCH0 + 40)))"; ACT "$R" site "$ID5" --keep 8 >/dev/null
t_fail "chunk a1.js is dropped after exactly 3 further releases" test -f "$R/site/releases/$ID5/_next/static/chunks/a1.js"
t_ok "chunk d4.js (introduced by S4) is carried into S5" test -f "$R/site/releases/$ID5/_next/static/chunks/d4.js"
t_ok "own-chunk manifest written for each release" test -s "$R/site/releases/$ID5.static.txt"
make_site_tree "$TMP/s6" "S6" 1 f6.js; ID6="$(stage_incoming "$R" site "$TMP/s6" $((EPOCH0 + 50)))"; ACT "$R" site "$ID6" --keep 4 >/dev/null
t_eq "retention keeps the newest 4 release dirs" "$(list_releases "$R/site/releases" | wc -l | tr -d ' ')" "4"
t_ok "current and previous are never pruned" test -d "$R/site/releases/$(prev "$R" site)"
t_ok "re-activating the current release is a no-op that re-runs the gate" ACT "$R" site "$ID6" --keep 4
cp -R "$TMP/s6" "$R/site/releases/.incoming-$ID6"; cp "$R/site/releases/$ID6.manifest.json" "$R/site/releases/.incoming-$ID6.manifest.json"; cp "$R/site/releases/$ID6.SHA256SUMS" "$R/site/releases/.incoming-$ID6.SHA256SUMS"
t_ok "uploading the same release id twice discards the second copy and succeeds" ACT "$R" site "$ID6" --keep 4
t_fail "...no .incoming leftovers" test -e "$R/site/releases/.incoming-$ID6"

echo "== health gate and automatic rollback =="
R="$(new_root rb)"
make_site_tree "$TMP/g1" "G1" 1 g1.js; IDG1="$(stage_incoming "$R" site "$TMP/g1" $EPOCH0)"; ACT "$R" site "$IDG1" >/dev/null
make_site_tree "$TMP/g2" "G2" 1 g2.js; IDG2="$(stage_incoming "$R" site "$TMP/g2" $((EPOCH0 + 10)))"; ACT "$R" site "$IDG2" >/dev/null
make_site_tree "$TMP/bad" "BAD" 0 bad.js; IDBAD="$(stage_incoming "$R" site "$TMP/bad" $((EPOCH0 + 20)))"
t_rc "an unhealthy release is rolled back (exit 3)" 3 ACT "$R" site "$IDBAD"
t_eq "current is back on the last good release" "$(cur "$R" site)" "$IDG2"
t_eq "previous is restored" "$(prev "$R" site)" "$IDG1"
t_ok "the failed release is kept and marked for inspection" test -f "$R/site/releases/$IDBAD.FAILED"
t_ok "manual rollback command swaps to previous" bash "$REL/rollback-release.sh" --root "$R" --kind site --smoke-cmd 'test -f "$AICC_RELEASE_DIR/HEALTHY"' --smoke-timeout 2 --smoke-interval 1 --smoke-successes 1
t_eq "after rollback current = old previous" "$(cur "$R" site)" "$IDG1"
t_eq "after rollback previous = the release we left" "$(prev "$R" site)" "$IDG2"
t_rc "rollback to a FAILED release is refused" 1 bash "$REL/rollback-release.sh" --root "$R" --kind site --to "$IDBAD" --smoke-cmd true
R2="$(new_root first)"; make_site_tree "$TMP/f0" "F0" 0 f0.js; IDF0="$(stage_incoming "$R2" site "$TMP/f0" $EPOCH0)"
t_rc "a broken FIRST release exits 3" 3 ACT "$R2" site "$IDF0"
t_fail "...and leaves no current link (nothing broken is served)" test -L "$R2/site/current"
R3="$(new_root crit)"; make_site_tree "$TMP/c1" "C1" 1 c1.js; IDC1="$(stage_incoming "$R3" site "$TMP/c1" $EPOCH0)"; ACT "$R3" site "$IDC1" >/dev/null
rm "$R3/site/releases/$IDC1/HEALTHY"
make_site_tree "$TMP/c2" "C2" 0 c2.js; IDC2="$(stage_incoming "$R3" site "$TMP/c2" $((EPOCH0 + 10)))"
t_rc "a failed release whose rollback target is ALSO unhealthy exits 4 (critical)" 4 ACT "$R3" site "$IDC2"

echo "== refusal paths (nothing may change) =="
R="$(new_root ref)"
make_site_tree "$TMP/r1" "R1" 1 r1.js; IDR1="$(stage_incoming "$R" site "$TMP/r1" $EPOCH0)"; ACT "$R" site "$IDR1" >/dev/null
make_site_tree "$TMP/r2" "R2" 1 r2.js; IDR2="$(stage_incoming "$R" site "$TMP/r2" $((EPOCH0 + 10)))"
echo tampered >> "$R/site/releases/.incoming-$IDR2/index.html"
t_rc "a modified file is refused (hash mismatch)" 1 ACT "$R" site "$IDR2"
t_eq "...current unchanged" "$(cur "$R" site)" "$IDR1"
make_site_tree "$TMP/r3" "R3" 1 r3.js; IDR3="$(stage_incoming "$R" site "$TMP/r3" $((EPOCH0 + 20)))"; echo evil > "$R/site/releases/.incoming-$IDR3/extra.php"
t_rc "an extra unlisted file is refused" 1 ACT "$R" site "$IDR3"
make_site_tree "$TMP/r4" "R4" 1 r4.js; IDR4="$(stage_incoming "$R" site "$TMP/r4" $((EPOCH0 + 30)))"; rm "$R/site/releases/.incoming-$IDR4/50x.html"
t_rc "a missing file is refused" 1 ACT "$R" site "$IDR4"
make_site_tree "$TMP/r5" "R5" 1 r5.js; IDR5="$(stage_incoming "$R" site "$TMP/r5" $((EPOCH0 + 40)))"; rm "$R/site/releases/.incoming-$IDR5.SHA256SUMS"
t_rc "missing SHA256SUMS is refused" 1 ACT "$R" site "$IDR5"
t_rc "kind mismatch (site release activated as cp) is refused" 1 ACT "$R" cp "$IDR1"
t_rc "bad release id is a usage error" 2 ACT "$R" site "../../etc"
t_rc "a root without the sandbox marker is refused" 1 bash "$REL/activate-release.sh" --root "$TMP" --kind site --release-id "$IDR1"
if [ "$(id -u)" != 0 ]; then t_rc "the real root /srv/aicc requires root" 2 bash "$REL/activate-release.sh" --kind site --release-id "$IDR1"; fi
t_eq "after all refusals current is still the original" "$(cur "$R" site)" "$IDR1"

echo "== control-plane release: pre-release dump gate =="
R="$(new_root cp)"; echo "<?php // wp-config" > "$R/shared/wp-config.php"
make_cp_tree() { local d="$1" label="$2" healthy="$3"; rm -rf "$d"; mkdir -p "$d/wp-content"; echo "<?php echo '$label';" > "$d/index.php"; [ "$healthy" = 1 ] && echo ok > "$d/HEALTHY"
  ln -s /srv/aicc/shared/uploads "$d/wp-content/uploads"; ln -s /srv/aicc/shared/wp-config.php "$d/wp-config.php"; }
make_cp_tree "$TMP/cp1" CP1 1; IDCP1="$(stage_incoming "$R" cp "$TMP/cp1" $EPOCH0)"
t_rc "no backup status at all: refused" 1 ACT "$R" cp "$IDCP1"
fresh_backup "$R" 1200
t_rc "a dump older than 15 minutes (1200s) is refused" 1 ACT "$R" cp "$IDCP1"
fresh_backup "$R" 60 failed
t_rc "a dump whose restore check failed is refused" 1 ACT "$R" cp "$IDCP1"
fresh_backup "$R" 60; echo "deadbeef  aicc_cp-test.sql.gz" > "$R/backups/aicc_cp-test.sql.gz.sha256"
t_rc "a dump that does not match its sha256 sidecar is refused" 1 ACT "$R" cp "$IDCP1"
fresh_backup "$R" 60; rm "$R/backups/aicc_cp-test.sql.gz"
t_rc "a status that names a missing dump file is refused" 1 ACT "$R" cp "$IDCP1"
t_fail "...and nothing was swapped by any refusal" test -L "$R/cp/current"
fresh_backup "$R" 60; rm "$R/shared/wp-config.php"
t_rc "missing shared wp-config.php is refused" 1 ACT "$R" cp "$IDCP1"
echo "<?php" > "$R/shared/wp-config.php"; fresh_backup "$R" 60
: > "$TMP/fpm.log"
t_ok "cp release with a fresh dump activates and reloads PHP-FPM" ACT "$R" cp "$IDCP1" --fpm-reload-cmd "echo reload >> $TMP/fpm.log"
t_eq "PHP-FPM was reloaded once after the swap" "$(wc -l < "$TMP/fpm.log" | tr -d ' ')" "1"
make_cp_tree "$TMP/cp2" CP2 0; IDCP2="$(stage_incoming "$R" cp "$TMP/cp2" $((EPOCH0 + 10)))"; fresh_backup "$R" 30
: > "$TMP/fpm.log"
t_rc "an unhealthy cp release is rolled back (exit 3)" 3 ACT "$R" cp "$IDCP2" --fpm-reload-cmd "echo reload >> $TMP/fpm.log"
t_eq "cp current is back on the good release" "$(cur "$R" cp)" "$IDCP1"
t_eq "PHP-FPM was reloaded twice (after the swap and after the rollback)" "$(wc -l < "$TMP/fpm.log" | tr -d ' ')" "2"

echo "== release tool: scan, pack, unpack =="
mkdir -p "$TMP/bad1/wp-content/plugins/aicc-license-manager"; echo ok > "$TMP/bad1/index.php"
printf -- '-----BEGIN %s-----\nabc\n' "PRIVATE KEY" > "$TMP/bad1/wp-content/plugins/aicc-license-manager/key.txt"
t_fail "scan rejects a private key" "${TOOL[@]}" scan --tree "$TMP/bad1" --kind cp
rm -rf "$TMP/bad2"; mkdir -p "$TMP/bad2"; echo x > "$TMP/bad2/index.php"; echo "SECRET=1" > "$TMP/bad2/.env"
t_fail "scan rejects a .env file" "${TOOL[@]}" scan --tree "$TMP/bad2" --kind cp
rm -rf "$TMP/bad3"; mkdir -p "$TMP/bad3/.git"; echo x > "$TMP/bad3/.git/config"
t_fail "scan rejects a .git directory" "${TOOL[@]}" scan --tree "$TMP/bad3" --kind cp
rm -rf "$TMP/bad4"; mkdir -p "$TMP/bad4/wp-content/themes/aicc-admin"; echo "define('DB_PASSWORD', 'hunter2hunter2');" > "$TMP/bad4/wp-content/themes/aicc-admin/x.php"
t_fail "scan rejects a non-empty DB_PASSWORD" "${TOOL[@]}" scan --tree "$TMP/bad4" --kind cp
rm -rf "$TMP/bad5"; mkdir -p "$TMP/bad5/wp-content/plugins/aicc-license-manager"; echo "path=/Users/avivgerman/aicc-rehearsal" > "$TMP/bad5/wp-content/plugins/aicc-license-manager/a.php"
t_fail "scan rejects a rehearsal fixture marker / local path" "${TOOL[@]}" scan --tree "$TMP/bad5" --kind cp
rm -rf "$TMP/bad6"; mkdir -p "$TMP/bad6"; echo x > "$TMP/bad6/db.sql"
t_fail "scan rejects a SQL dump" "${TOOL[@]}" scan --tree "$TMP/bad6" --kind cp
rm -rf "$TMP/bad7"; mkdir -p "$TMP/bad7"; ln -s /etc/passwd "$TMP/bad7/wp-config.php"
t_fail "scan rejects a symlink pointing outside shared storage" "${TOOL[@]}" scan --tree "$TMP/bad7" --kind cp
mkdir -p "$TMP/evil"; python3 - "$TMP/evil.tar.gz" <<'PY'
import tarfile, io, sys
with tarfile.open(sys.argv[1], "w:gz") as t:
    ti = tarfile.TarInfo("../escape.txt"); ti.size = 1; t.addfile(ti, io.BytesIO(b"x"))
PY
t_fail "unpack rejects a path-traversal tarball" "${TOOL[@]}" unpack --tarball "$TMP/evil.tar.gz" --dest "$TMP/evil-out"

echo "== real Control Plane tarball (built from the CP worktree) =="
CPOUT1="$TMP/cp-out1"; CPOUT2="$TMP/cp-out2"
if [ -f "$HOME/.cache/aicc-release/wordpress-7.1.3.tar.gz" ] && [ -f "$HOME/.cache/aicc-release/woocommerce-10.9.4.zip" ] && [ -d "/Users/avivgerman/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/cp2a-14-readiness-independence/admin" ]; then
  t_ok "build-cp-release.sh builds (pinned WP 7.1.3 + WC 10.9.4 + theme + plugin)" bash "$REL/build-cp-release.sh" --out-dir "$CPOUT1"
  t_ok "second build succeeds" bash "$REL/build-cp-release.sh" --out-dir "$CPOUT2"
  TB1="$(ls "$CPOUT1"/cp-*.tar.gz 2>/dev/null | head -1)"; TB2="$(ls "$CPOUT2"/cp-*.tar.gz 2>/dev/null | head -1)"
  t_eq "REPRODUCIBLE: two builds give byte-identical tarballs" "$(sha256_of_file "$TB1")" "$(sha256_of_file "$TB2")"
  MAN1="${TB1%.tar.gz}.manifest.json"
  t_eq "manifest records the tarball hash" "$(jq -r '.tarball.sha256' "$MAN1")" "$(sha256_of_file "$TB1")"
  t_eq "manifest pins WordPress 7.1.3" "$(jq -r '.sources.wordpress.version' "$MAN1")" "7.1.3"
  t_eq "manifest pins WooCommerce 10.9.4" "$(jq -r '.sources.woocommerce.version' "$MAN1")" "10.9.4"
  t_eq "manifest records the WordPress source SHA-256" "$(jq -r '.sources.wordpress.tarball_sha256' "$MAN1")" "d2a09acb6a15e3b9c471d72557753c266d6f41a79ed19bfe04cbfe49e283b2a5"
  t_eq "manifest records the WooCommerce source SHA-256" "$(jq -r '.sources.woocommerce.zip_sha256' "$MAN1")" "6e58fc3ba9b18d1c9aee6b0227d3c3c09e4fe2c1332823bd2e0ac54ffcff64a9"
  t_eq "the AICC components come from a clean commit" "$(jq -r '.sources.dirty' "$MAN1")" "false"
  LIST="$(tar tzf "$TB1")"
  t_eq "tarball has no .git, tests, node_modules, .env, *.sql, *.log, fixtures" "$(printf '%s\n' "$LIST" | grep -cE '(^|/)(\.git|\.github|tests?|Tests|__tests__|node_modules|fixtures|test-store)(/|$)|(^|/)\.env|\.sql(\.gz)?$|\.log$|\.sqlite3?$|\.DS_Store' || true)" "0"
  t_eq "no real wp-config.php (only the symlink into shared storage)" "$(tar tvzf "$TB1" | grep -E ' wp-config\.php( |$)' | grep -c '^l' || true)" "1"
  t_contains "uploads is a symlink to shared storage" "$(tar tvzf "$TB1" | grep 'wp-content/uploads ')" "-> /srv/aicc/shared/uploads"
  t_ok "tarball contains the AICC plugin" bash -c "tar tzf '$TB1' | grep -q '^wp-content/plugins/aicc-license-manager/aicc-license-manager.php\$'"
  t_ok "tarball contains the AICC theme" bash -c "tar tzf '$TB1' | grep -q '^wp-content/themes/aicc-admin/style.css\$'"
  t_ok "tarball contains Storefront (the parent theme of the AICC theme)" bash -c "tar tzf '$TB1' | grep -q '^wp-content/themes/storefront/style.css\$'"
  t_eq "manifest pins Storefront 4.6.2 with its SHA-256" "$(jq -r '.sources.storefront.version + " " + .sources.storefront.zip_sha256' "$MAN1")" "4.6.2 163b5bf217dad76a823432d8c01598ab3dc3f15cbdd69067b98f5a6ddf05c1c4"
  t_ok "the AICC theme declares Template: storefront and Storefront is present" bash -c "tar xzOf '$TB1' wp-content/themes/aicc-admin/style.css | grep -q '^Template:.*storefront'"
  t_ok "tarball contains WooCommerce" bash -c "tar tzf '$TB1' | grep -q '^wp-content/plugins/woocommerce/woocommerce.php\$'"
  t_fail "readme.html (WordPress version disclosure) is not shipped" bash -c "tar tzf '$TB1' | grep -qx 'readme.html'"
  mkdir -p "$TMP/cp-unpack"; "${TOOL[@]}" unpack --tarball "$TB1" --dest "$TMP/cp-unpack/tree" >/dev/null
  t_ok "unpacked tree passes the secret/fixture scan again" "${TOOL[@]}" scan --tree "$TMP/cp-unpack/tree" --kind cp
  t_ok "unpacked tree verifies against SHA256SUMS" verify_tree "$TMP/cp-unpack/tree" "${TB1%.tar.gz}.SHA256SUMS"
  t_fail "a dirty worktree is refused unless --allow-dirty (tool-level check)" bash -c "cd '$TMP' && git init -q fakecp && mkdir -p fakecp/admin/wp-content/themes/aicc-admin fakecp/admin/wp-content/plugins/aicc-license-manager && cd fakecp && echo a > admin/wp-content/themes/aicc-admin/a.php && echo b > admin/wp-content/plugins/aicc-license-manager/b.php && git add . && git -c user.email=t@t -c user.name=t commit -qm i && echo c >> admin/wp-content/themes/aicc-admin/a.php && bash '$REL/build-cp-release.sh' --cp-worktree '$TMP/fakecp' --out-dir '$TMP/cp-dirty'"
  t_fail "a wrong pinned hash is refused" bash -c "echo junk > '$TMP/wp-wrong.tar.gz'; bash '$REL/build-cp-release.sh' --wp-tar '$TMP/wp-wrong.tar.gz' --out-dir '$TMP/cp-wrong'"
else t_skip "real CP tarball tests" "pinned sources not cached in ~/.cache/aicc-release or CP worktree missing"; fi

echo "== site builds: stage vs production =="
SID="0123456789abcdef0123456789abcdef"
if [ -f "$REPO/out/index.html" ]; then EXPORT="$REPO/out"; else EXPORT="$TMP/mini-export"; mkdir -p "$EXPORT/_next/static" "$EXPORT/404"; for p in index.html 404.html 404/index.html; do printf '<!doctype html><html><head><title>x</title></head><body>p</body></html>' > "$EXPORT/$p"; done; printf 'User-agent: *\nAllow: /\n' > "$EXPORT/robots.txt"; echo c > "$EXPORT/_next/static/c.js"; fi
t_ok "stage build succeeds" bash "$REL/build-site-release.sh" --target stage --stage-id "$SID" --export-dir "$EXPORT" --out-dir "$TMP/site-stage"
t_ok "production build succeeds" bash "$REL/build-site-release.sh" --target production --export-dir "$EXPORT" --out-dir "$TMP/site-prod"
SS="$(ls "$TMP"/site-stage/site-*.tar.gz | head -1)"; SP="$(ls "$TMP"/site-prod/site-*.tar.gz | head -1)"
mkdir -p "$TMP/u-stage" "$TMP/u-prod"; "${TOOL[@]}" unpack --tarball "$SS" --dest "$TMP/u-stage/t" >/dev/null; "${TOOL[@]}" unpack --tarball "$SP" --dest "$TMP/u-prod/t" >/dev/null
t_ok "stage tree carries /.well-known/aicc-stage-identity with the stage id" grep -q "\"id\":\"$SID\"" "$TMP/u-stage/t/.well-known/aicc-stage-identity"
t_eq "stage: EVERY html file has the noindex meta" "$(grep -rL 'noindex, nofollow, noarchive, nosnippet' --include='*.html' "$TMP/u-stage/t" | wc -l | tr -d ' ')" "0"
t_contains "stage robots.txt disallows everything" "$(cat "$TMP/u-stage/t/robots.txt")" "Disallow: /"
t_fail "stage tree has no sitemap.xml" test -e "$TMP/u-stage/t/sitemap.xml"
t_fail "PRODUCTION build has NO identity file" test -e "$TMP/u-prod/t/.well-known/aicc-stage-identity"
t_eq "PRODUCTION build has no stage noindex marker anywhere" "$(grep -rl 'noindex, nofollow, noarchive, nosnippet' "$TMP/u-prod/t" 2>/dev/null | wc -l | tr -d ' ')" "0"
t_eq "PRODUCTION build has no reference to aicc-stage-identity anywhere" "$(grep -rl 'aicc-stage-identity' "$TMP/u-prod/t" 2>/dev/null | wc -l | tr -d ' ')" "0"
t_fail "PRODUCTION robots.txt is not a blanket Disallow" grep -Eq '^Disallow:[[:space:]]*/[[:space:]]*$' "$TMP/u-prod/t/robots.txt"
t_eq "production content pages carry no noindex (only the error pages may)" "$(grep -rlE '<meta[^>]+name="robots"[^>]*noindex' --include='*.html' "$TMP/u-prod/t" | grep -vE '/(404\.html|50x\.html|404/index\.html|_not-found/index\.html)$' | wc -l | tr -d ' ')" "0"
t_ok "50x.html is in both trees (edge preflight requires it)" bash -c "[ -s '$TMP/u-stage/t/50x.html' ] && [ -s '$TMP/u-prod/t/50x.html' ]"
t_rc "stage build without --stage-id is a usage error" 2 bash "$REL/build-site-release.sh" --target stage --export-dir "$EXPORT" --out-dir "$TMP/x1"
t_rc "production build with a --stage-id is REFUSED" 3 bash "$REL/build-site-release.sh" --target production --stage-id "$SID" --export-dir "$EXPORT" --out-dir "$TMP/x2"
t_rc "stage build for a production host name is REFUSED" 3 bash "$REL/build-site-release.sh" --target stage --stage-id "$SID" --stage-host www.copilt.org --export-dir "$EXPORT" --out-dir "$TMP/x3"
# the checker itself must detect a poisoned production tree
cp -R "$TMP/u-prod/t" "$TMP/poison"; mkdir -p "$TMP/poison/.well-known"; echo '{}' > "$TMP/poison/.well-known/aicc-stage-identity"
t_fail "site-check detects an identity file inside a production tree" "${TOOL[@]}" site-check --tree "$TMP/poison" --target production
cp -R "$TMP/u-prod/t" "$TMP/poison2"; sed -i.bak 's#<head>#<head><meta name="robots" content="noindex"/>#' "$TMP/poison2/index.html" 2>/dev/null; rm -f "$TMP/poison2/index.html.bak"
if grep -q 'noindex' "$TMP/poison2/index.html"; then t_fail "site-check detects noindex on a production content page" "${TOOL[@]}" site-check --tree "$TMP/poison2" --target production; else t_skip "noindex poison" "index.html has no plain <head> tag"; fi

echo "== deploy-release.sh guards (ssh/rsync are stubs; nothing leaves this machine) =="
STUB="$TMP/stubbin"; mkdir -p "$STUB"; CALLS="$TMP/calls.log"
cat > "$STUB/ssh" <<EOS
#!/usr/bin/env bash
echo "ssh \$*" >> "$CALLS"
case "\$*" in
  *"cat /etc/aicc-stage-identity"*) printf 'AICC_ENV=staging\nAICC_HOSTNAME=%s\nAICC_STAGE_ID=%s\n' "\${STUB_HOSTNAME:-stage.copilt.org}" "\${STUB_STAGE_ID:-$SID}" ;;
  *aicc-activate-release*) exit "\${STUB_ACTIVATE_RC:-0}" ;;
esac
exit 0
EOS
cat > "$STUB/rsync" <<EOS
#!/usr/bin/env bash
echo "rsync \$*" >> "$CALLS"; exit 0
EOS
cat > "$STUB/curl" <<EOS
#!/usr/bin/env bash
echo "curl \$*" >> "$CALLS"; exit 0
EOS
chmod +x "$STUB"/*
FAKEKEY="$TMP/fake_stage_key"; printf -- '-----BEGIN %s-----\nDUMMY-NOT-A-REAL-KEY\n-----END %s-----\n' "OPENSSH PRIVATE KEY" "OPENSSH PRIVATE KEY" > "$FAKEKEY"; chmod 600 "$FAKEKEY"
PRODKEY="$TMP/aicc_digitalocean_prod"; cp "$FAKEKEY" "$PRODKEY"
DEP() { PATH="$STUB:$PATH" bash "$REL/deploy-release.sh" --key "$FAKEKEY" "$@"; }
SITEART="$SS"
: > "$CALLS"
t_rc "missing required flags -> usage error" 2 DEP --kind site --artifact "$SITEART"
t_rc "production API IP 139.59.157.231 is REFUSED" 3 DEP --kind site --artifact "$SITEART" --stage-host stage.copilt.org --stage-ip 139.59.157.231 --stage-id "$SID"
t_rc "www.copilt.org is REFUSED" 3 DEP --kind site --artifact "$SITEART" --stage-host www.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID"
t_rc "copilt.org is REFUSED" 3 DEP --kind site --artifact "$SITEART" --stage-host copilt.org --stage-ip 203.0.113.9 --stage-id "$SID"
t_rc "api.copilt.org is REFUSED" 3 DEP --kind site --artifact "$SITEART" --stage-host api.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID"
t_rc "an arbitrary host name is REFUSED" 3 DEP --kind site --artifact "$SITEART" --stage-host example.com --stage-ip 203.0.113.9 --stage-id "$SID"
t_rc "a non-IP --stage-ip is REFUSED" 3 DEP --kind site --artifact "$SITEART" --stage-host stage.copilt.org --stage-ip stage.copilt.org --stage-id "$SID"
t_rc "the production key is REFUSED" 3 env PATH="$STUB:$PATH" bash "$REL/deploy-release.sh" --key "$PRODKEY" --kind site --artifact "$SITEART" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID"
t_rc "a malformed stage id is REFUSED" 3 DEP --kind site --artifact "$SITEART" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id nothex
t_rc "a PRODUCTION site build can never be deployed to staging" 3 DEP --kind site --artifact "$SP" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID"
t_rc "a stage build made for another stage id is REFUSED" 3 DEP --kind site --artifact "$SS" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id ffffffffffffffffffffffffffffffff
t_rc "kind mismatch is REFUSED" 3 DEP --kind cp --artifact "$SS" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID"
cp "$SS" "$TMP/tampered.tar.gz"; cp "${SS%.tar.gz}.manifest.json" "$TMP/tampered.manifest.json"; cp "${SS%.tar.gz}.SHA256SUMS" "$TMP/tampered.SHA256SUMS"
TID="$(jq -r .release_id "$TMP/tampered.manifest.json")"; mkdir -p "$TMP/tam"; cp "$SS" "$TMP/tam/site-$TID.tar.gz"; cp "$TMP/tampered.manifest.json" "$TMP/tam/site-$TID.manifest.json"; cp "$TMP/tampered.SHA256SUMS" "$TMP/tam/site-$TID.SHA256SUMS"; printf 'x' >> "$TMP/tam/site-$TID.tar.gz"
t_rc "a tampered tarball is REFUSED" 3 DEP --kind site --artifact "$TMP/tam/site-$TID.tar.gz" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID"
t_eq "no ssh/rsync/curl was ever invoked by any refusal above" "$(wc -l < "$CALLS" | tr -d ' ')" "0"
t_ok "--dry-run prints the plan" DEP --kind site --artifact "$SS" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --dry-run
t_eq "--dry-run made no network call" "$(wc -l < "$CALLS" | tr -d ' ')" "0"
STUB_STAGE_ID=ffffffffffffffffffffffffffffffff t_rc "a host with a DIFFERENT stage id is refused before any upload" 3 DEP --kind site --artifact "$SS" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID"
STUB_HOSTNAME=www.copilt.org t_rc "a host that claims another hostname is refused" 3 DEP --kind site --artifact "$SS" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID"
t_eq "...only the read-only identity check ran (no rsync)" "$(grep -c '^rsync' "$CALLS" || true)" "0"
: > "$CALLS"
t_ok "--check-only passes with a matching host and uploads nothing" DEP --kind site --artifact "$SS" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --check-only
t_eq "...check-only: zero rsync calls" "$(grep -c '^rsync' "$CALLS" || true)" "0"
: > "$CALLS"
t_ok "site deploy happy path (stubs)" DEP --kind site --artifact "$SS" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID"
t_eq "site deploy: three rsync calls (tree, manifest, sums)" "$(grep -c '^rsync' "$CALLS")" "3"
t_eq "site deploy: no pre-release backup for a static site" "$(grep -c 'aicc-backup' "$CALLS" || true)" "0"
t_contains "site deploy: activation command is sent" "$(cat "$CALLS")" "sudo /usr/local/sbin/aicc-activate-release --kind site --release-id"
t_eq "EVERY ssh/rsync call used only the dedicated key and IdentitiesOnly" "$(grep -E '^(ssh|rsync)' "$CALLS" | grep -vc "$FAKEKEY.*IdentitiesOnly=yes" || true)" "0"
t_eq "no call mentions the production IP or key" "$(grep -c '139.59.157.231\|aicc_digitalocean_prod' "$CALLS" || true)" "0"
# a synthetic cp artifact
make_cp_tree "$TMP/dcp" DCP 1; mkdir -p "$TMP/dcp-out"; "${TOOL[@]}" pack --tree "$TMP/dcp" --kind cp --out-dir "$TMP/dcp-out" --epoch $EPOCH0 >/dev/null; CPART="$(ls "$TMP"/dcp-out/cp-*.tar.gz | head -1)"
: > "$CALLS"
t_ok "cp deploy happy path (stubs)" DEP --kind cp --artifact "$CPART" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID"
t_not_contains "cp deploy: a normal deploy never passes --allow-uninstalled" "$(cat "$CALLS")" "allow-uninstalled"
t_contains "cp deploy: takes the pre-release dump first" "$(cat "$CALLS")" "sudo /usr/local/sbin/aicc-backup --label pre-release"
t_eq "cp deploy: backup happens BEFORE the first rsync" "$(grep -nE 'aicc-backup|^rsync' "$CALLS" | head -1 | grep -c aicc-backup)" "1"
: > "$CALLS"
t_ok "cp --first-install deploy (stubs)" DEP --kind cp --artifact "$CPART" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID" --first-install
t_contains "--first-install passes --allow-uninstalled to the activation" "$(cat "$CALLS")" "--allow-uninstalled"
: > "$CALLS"
STUB_ACTIVATE_RC=3 t_rc "a rolled-back activation makes deploy exit 3" 3 DEP --kind cp --artifact "$CPART" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID"
STUB_ACTIVATE_RC=4 t_rc "a critical activation makes deploy exit 4" 4 DEP --kind cp --artifact "$CPART" --stage-host stage.copilt.org --stage-ip 203.0.113.9 --stage-id "$SID"

t_summary
