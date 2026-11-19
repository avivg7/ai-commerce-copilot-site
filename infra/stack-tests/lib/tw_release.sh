#!/usr/bin/env bash
# SOURCE ME (test_verify_published.sh, test_verify_published_fixture.sh). Builds, in $TMP, the Plugin release commit twice with the Plugin repo's own build script:
#   REAL  as released (the owner's PUBLIC keys baked: the 1.1.1 candidate rebuilds byte for byte), and
#   TW    the same commit with THROWAWAY public keys baked (primary + standby generated here; plus an attacker pair). No real key is read or created.
# Needs: PLUG_SRC, PLUG_COMMIT, TMP (an existing temp dir). Sets: PD (the throwaway checkout), KEYS, PRI STB ATT LIST FP FPS, V, ZIP MAN SIG(path only) SHA, RZIP RMAN RSHA, COMMIT, ZN.
# Returns 1 (and prints why) when the Plugin repo/commit or php sodium+zip is missing, so the caller can skip.
tw_release_build() {
  [ -f "$PLUG_SRC/bin/sign-release.php" ] && git -C "$PLUG_SRC" cat-file -e "$PLUG_COMMIT^{commit}" 2>/dev/null && php -r 'exit(function_exists("sodium_crypto_sign_detached")&&class_exists("ZipArchive")?0:1);' || { echo "Plugin repo/commit ($PLUG_SRC @ $PLUG_COMMIT) or php sodium+zip not available"; return 1; }
  KEYS="$TMP/keys"; mkdir "$KEYS"; chmod 700 "$KEYS"
  git clone -q --local "$PLUG_SRC" "$TMP/plug-real" && git -C "$TMP/plug-real" checkout -q --detach "$PLUG_COMMIT" || { echo "clone failed"; return 1; }
  git clone -q --local "$PLUG_SRC" "$TMP/plug-tw" && git -C "$TMP/plug-tw" checkout -q --detach "$PLUG_COMMIT"
  git -C "$TMP/plug-tw" config user.email t@example.test; git -C "$TMP/plug-tw" config user.name t
  PD="$TMP/plug-tw"; local k
  for k in primary standby attacker; do php "$PD/bin/sign-release.php" keygen --secret-out "$KEYS/$k.key" > "$KEYS/$k.out" 2>&1 || { echo "keygen failed"; return 1; }; done
  PRI="$(sed -n 's/^public key.*: //p' "$KEYS/primary.out")"; STB="$(sed -n 's/^public key.*: //p' "$KEYS/standby.out")"; ATT="$(sed -n 's/^public key.*: //p' "$KEYS/attacker.out")"
  FP="$(sed -n 's/^fingerprint: //p' "$KEYS/primary.out")"; FPS="$(sed -n 's/^fingerprint: //p' "$KEYS/standby.out")"; LIST="$PRI,$STB"
  sed -i.bak "s#^UPDATE_PUBLIC_KEYS=.*#UPDATE_PUBLIC_KEYS=$LIST#" "$PD/release/endpoints.conf" && rm -f "$PD/release/endpoints.conf.bak" && git -C "$PD" commit -qam "throwaway keys"
  mkdir -p "$TMP/real" "$TMP/tw"
  ( cd "$TMP/plug-real" && bin/build-release.sh --out "$TMP/real" >/dev/null 2>&1 ) || { echo "build (real) failed"; return 1; }
  ( cd "$PD" && bin/build-release.sh --out "$TMP/tw" >/dev/null 2>&1 ) || { echo "build (throwaway) failed"; return 1; }
  V="$(jq -r .version "$TMP/tw/"*.manifest.json)"; ZN="ai-commerce-copilot-$V.zip"
  ZIP="$TMP/tw/$ZN"; MAN="$TMP/tw/ai-commerce-copilot-$V.manifest.json"; SIG="$TMP/tw/ai-commerce-copilot-$V.manifest.sig"; SHA="$(shasum -a 256 "$ZIP" | cut -d' ' -f1)"
  RZIP="$TMP/real/$ZN"; RMAN="$TMP/real/ai-commerce-copilot-$V.manifest.json"; RSHA="$(shasum -a 256 "$RZIP" | cut -d' ' -f1)"
  COMMIT="$(git -C "$PD" rev-parse HEAD)"
  return 0
}
