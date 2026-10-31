#!/usr/bin/env bash
# THE DAY THE OWNER SUPPLIES THE TWO PUBLIC KEYS: build -> offline sign (owner) -> verify -> publish DRY RUN -> apply -> set current. One script, run stage by stage, with STOP markers.
# Prepared 2026-10-24 (round 3, launchprep) against Site cdffa3c, CP 072504c, Plugin 638991f. It is a SKELETON in the sense that every stage after 3 changes a live host and therefore needs the
# owner's explicit go; nothing here runs a stage on its own and no stage runs without its STOP confirmation being typed (or --yes-i-have-the-owners-go for the stages marked LIVE).
#
#   first-signed-release.sh <stage> [--yes-i-have-the-owners-go]
#   stages:  0 preconditions   1 build   2 offline-sign (prints the owner's commands; the PRIVATE key is never used here)   3 verify   4 publish-dry-run
#            5 apply (LIVE: uploads the signed release into the production store, NOT current)   6 set-current (LIVE: the one line that decides what customers and stores receive)
#            7 verify-live (read-only: launch gate 5h / 5h-1, update-check shape, account download)
#
# Inputs (environment; none is a secret; the private signing keys never touch this machine's disk except on the owner's encrypted vault at stage 2):
#   PLUG       Plugin worktree on a CLEAN commit that contains the owner's two PUBLIC keys in release/endpoints.conf (UPDATE_PUBLIC_KEYS=<primary>,<standby>) and the chosen version (e.g. 1.1.0)
#   CPW        Control Plane worktree (holds scripts/plugin-release/install-plugin-release.sh)
#   VERSION    the first customer version, X.Y.Z (a -dev/-rc version is refused here and by publish-plugin-release.sh --env production)
#   PRIMARY_PUB, STANDBY_PUB   the two PUBLIC keys (44 characters each, base64) as the owner reported them, PRIMARY_FP the primary's fingerprint (xxxx-xxxx-xxxx-xxxx) the owner read from keygen
#   OUT        output directory for the build (default ~/aicc-release-$VERSION)
#   For stages 4-7 (production): HOSTIP (production IPv4), NEWID (the 32-hex AICC_STAGE_ID of the promoted host), PKEY (default ~/.ssh/aicc_cp_prod_operator, in the ssh-agent),
#   KNOWN (default ~/.ssh/known_hosts_aicc_prod), SITE (this repo's worktree; default: the repo containing this script)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE="${SITE:-$(cd "$HERE/../.." && pwd)}"
STAGE="${1:-}"; GO=0; [ "${2:-}" = "--yes-i-have-the-owners-go" ] && GO=1
die()  { echo "FIRST-SIGNED-RELEASE: $*" >&2; exit 1; }
need() { for v in "$@"; do [ -n "${!v:-}" ] || die "set $v (see the header of this script)"; done; }
stop() { # STOP marker: the lead must read the text and type the word; a non-interactive run stops here with exit 10
  echo; echo "=================== STOP ==================="; printf '%s\n' "$1"; echo "============================================"
  if [ -t 0 ]; then read -r -p "type  go  to continue (anything else aborts): " a; [ "$a" = go ] || die "aborted at a STOP marker"; else echo "(non-interactive: stopping here; re-run interactively)"; exit 10; fi
}
live_gate() { [ "$GO" = 1 ] || die "stage $STAGE changes the production host: re-run with --yes-i-have-the-owners-go after the owner's explicit approval of this step (production-promotion.md 6.10)"; }
OUT="${OUT:-$HOME/aicc-release-${VERSION:-unset}}"
ZIP="$OUT/ai-commerce-copilot-${VERSION:-x}.zip"; MAN="${ZIP%.zip}.manifest.json"; SIG="${ZIP%.zip}.manifest.sig"; SHAF="$ZIP.sha256"
PKEY="${PKEY:-$HOME/.ssh/aicc_cp_prod_operator}"; KNOWN="${KNOWN:-$HOME/.ssh/known_hosts_aicc_prod}"
INSTALLER="${CPW:-}/scripts/plugin-release/install-plugin-release.sh"
publish() { # publish <extra args...>: production, fully pinned
  bash "$SITE/infra/release/publish-plugin-release.sh" --env production --installer "$INSTALLER" --stage-host www.copilt.org --stage-ip "$HOSTIP" --stage-id "$NEWID" \
    --key "$PKEY" --known-hosts "$KNOWN" --confirm-production "$VERSION" --pubkeys "$PRIMARY_PUB,$STANDBY_PUB" "$@"
}
case "$STAGE" in
0) need PLUG CPW VERSION PRIMARY_PUB STANDBY_PUB PRIMARY_FP
   [[ "$VERSION" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$ ]] || die "VERSION must be X.Y.Z (no -dev/-rc suffix): $VERSION"
   [[ "$PRIMARY_PUB" =~ ^[A-Za-z0-9+/]{43}=$ ]] && [[ "$STANDBY_PUB" =~ ^[A-Za-z0-9+/]{43}=$ ]] || die "PRIMARY_PUB / STANDBY_PUB must be 44-character base64 public keys"
   [ "$PRIMARY_PUB" != "$STANDBY_PUB" ] || die "primary and standby must differ"
   [ -z "$(git -C "$PLUG" status --porcelain)" ] || die "the Plugin worktree is not clean: a release is built only from a clean commit"
   conf="$(sed -n 's/^UPDATE_PUBLIC_KEYS=//p' "$PLUG/release/endpoints.conf")"
   [ "$conf" = "$PRIMARY_PUB,$STANDBY_PUB" ] || die "release/endpoints.conf UPDATE_PUBLIC_KEYS is '${conf:-(empty)}', expected exactly '<primary>,<standby>' (primary FIRST) as the owner reported them"
   hv="$(grep -m1 -E '^[[:space:]]*\*[[:space:]]*Version:' "$PLUG/ai-commerce-copilot.php" | sed -E 's/.*Version:[[:space:]]*//' | tr -d '[:space:]')"
   cv="$(grep -m1 -E "define\([[:space:]]*'AICC_VERSION'" "$PLUG/ai-commerce-copilot.php" | sed -E "s/.*define\([[:space:]]*'AICC_VERSION'[[:space:]]*,[[:space:]]*'([^']*)'.*/\1/")"
   [ "$hv" = "$VERSION" ] && [ "$cv" = "$VERSION" ] || die "the Plugin's Version header is '$hv' and AICC_VERSION is '$cv', expected $VERSION (bump both; bin/build-release.sh enforces they agree)"
   if [ -f "$PLUG/readme.txt" ]; then grep -Eq "^Stable tag:[[:space:]]*${VERSION}[[:space:]]*\$" "$PLUG/readme.txt" || die "readme.txt Stable tag is not $VERSION"; fi
   [ -f "$PLUG/release/notes/$VERSION.md" ] || die "release/notes/$VERSION.md is missing (customer-facing release note)"
   [ -f "$INSTALLER" ] || die "installer not found: $INSTALLER"
   php -r 'exit(function_exists("sodium_crypto_sign_detached")?0:1);' || die "php-sodium is not available"
   echo "stage 0 OK: clean Plugin commit $(git -C "$PLUG" rev-parse --short HEAD), version $VERSION, both public keys in endpoints.conf" ;;
1) need PLUG VERSION PRIMARY_PUB STANDBY_PUB; "$0" 0
   mkdir -p "$OUT"; ( cd "$PLUG" && bin/build-release.sh --out "$OUT" ) || die "build failed"
   python3 -I - "$MAN" "$ZIP" "$PRIMARY_PUB" "$STANDBY_PUB" <<'PY' || die "build check failed"
import json, re, sys, zipfile
man, zp, p, s = sys.argv[1:5]
m = json.load(open(man))
assert m["dirty"] is False and re.fullmatch(r"[0-9a-f]{40}", m["built_from_commit"]), "manifest not from a clean commit"
d = zipfile.ZipFile(zp).read("ai-commerce-copilot/includes/aicc-release-defaults.php").decode()
k = re.search(r"const PUBLIC_KEYS = '([^']*)';", d).group(1)
assert k == p + "," + s, "the baked key list is '%s'" % k
print("build check OK: dirty:false, baked keys = primary,standby, version %s, sha256 %s" % (m["version"], m["sha256"]))
PY
   ( cd "$OUT" && shasum -a 256 -c "$(basename "$SHAF")" )
   stop "The release is BUILT (not signed). Give the owner, over TWO channels, the manifest AND the ZIP (the signer refuses a manifest without the ZIP next to it) and the ZIP's SHA-256:
   $MAN
   $ZIP
   sha256 of the ZIP: $(cut -d' ' -f1 "$SHAF")
The owner signs OFFLINE (stage 2 prints the exact commands). Do not continue until the .manifest.sig is back in $OUT." ;;
2) need PLUG VERSION PRIMARY_FP
   cat <<EOF
OWNER'S COMMANDS (offline, on the owner's Mac, with the primary vault attached; the lead never sees the private key):
  hdiutil attach <the PRIMARY vault image: the verified USB copy /Volumes/<STICK-1>/aicc-keys-primary.dmg, or until it exists the Mac copy (its location is in the owner's private key notes)>
  cd <a Plugin checkout at the same commit: git -C "$PLUG" rev-parse HEAD = $(git -C "$PLUG" rev-parse HEAD 2>/dev/null)>
  AICC_RELEASE_SIGNING_KEY_FILE=/Volumes/AICCKEYS-PRIMARY/aicc-release-primary.key php bin/sign-release.php sign --manifest <path to ${MAN##*/}> --zip <path to ${ZIP##*/}>   # (or keep both files in one folder)
  hdiutil detach /Volumes/AICCKEYS-PRIMARY
  -> it prints the key fingerprint: it must equal $PRIMARY_FP
Then copy ONLY ${SIG##*/} back to $OUT (the signature is not secret).
EOF
   stop "Wait for the owner: ${SIG##*/} must be in $OUT, and the fingerprint the owner read out must equal $PRIMARY_FP." ;;
3) need PLUG VERSION PRIMARY_PUB STANDBY_PUB PRIMARY_FP
   [ -f "$SIG" ] && [ ! -L "$SIG" ] || die "no signature file $SIG"
   ( cd "$PLUG" && php bin/sign-release.php verify --manifest "$MAN" --sig "$SIG" --zip "$ZIP" --pubkeys "$PRIMARY_PUB,$STANDBY_PUB" ) | tee "$OUT/verify.txt"
   grep -q "$PRIMARY_FP" "$OUT/verify.txt" || die "verified, but not by the primary key $PRIMARY_FP (signed with the standby? that is only for an emergency)"
   # the key_id printed above is a hint taken from the .sig file: prove the PRIMARY public key itself verifies it
   ( cd "$PLUG" && php bin/sign-release.php verify --manifest "$MAN" --sig "$SIG" --zip "$ZIP" --pubkeys "$PRIMARY_PUB" >/dev/null ) || die "the signature does NOT verify with the primary public key alone (signed with the standby, or the key_id was edited)"
   # tamper control: a flipped bit in a COPY of the manifest must NOT verify
   t="$(mktemp -d)"; python3 -I - "$MAN" "$t/m.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1])); m["size"] = int(m["size"]) + 1; json.dump(m, open(sys.argv[2], "w"))
PY
   if ( cd "$PLUG" && php bin/sign-release.php verify --manifest "$t/m.json" --sig "$SIG" --pubkeys "$PRIMARY_PUB,$STANDBY_PUB" >/dev/null 2>&1 ); then rm -rf "$t"; die "a TAMPERED manifest verified: stop and investigate"; fi; rm -rf "$t"
   echo "stage 3 OK: the signature verifies with the owner's primary key; a tampered copy is rejected" ;;
4) need PLUG CPW VERSION HOSTIP NEWID PRIMARY_PUB STANDBY_PUB
   echo "-- publish DRY RUN (no network; local verification + the plan; --env production without --apply is a dry run) --"
   publish --zip "$ZIP" --manifest "$MAN" --sha256-file "$SHAF" --signature "$SIG" --plugin-dir "$PLUG" | tee "$OUT/publish-dry-run.txt"
   grep -q "signature verified locally" "$OUT/publish-dry-run.txt" || die "the dry run did not verify the signature locally"
   stop "Show the owner the dry-run plan above (version $VERSION, sha256 $(cut -d' ' -f1 "$SHAF"), signature verified locally, target www.copilt.org). Stages 5 and 6 change the PRODUCTION host: continue only with the owner's explicit go for production-promotion.md 6.10." ;;
5) need PLUG CPW VERSION HOSTIP NEWID PRIMARY_PUB STANDBY_PUB; live_gate
   echo "-- LIVE: upload the signed release into the production store (installed, NOT current) --"
   publish --apply --zip "$ZIP" --manifest "$MAN" --sha256-file "$SHAF" --signature "$SIG" --plugin-dir "$PLUG" | tee "$OUT/publish-apply.txt"
   stop "$VERSION is INSTALLED in the production store but NOT current: customers and stores still receive nothing. Check the host-side lines above (signature verified by the installer against the owner's key list, immutable directory). BEFORE stage 6 set the host's trust anchor (sudo aicc-owner-facts set AICC_LM_PLUGIN_SIGNING_PUBKEYS '<primary>,<standby>', re-render, reload PHP-FPM; see stage 6). Continue to stage 6 only on the owner's go." ;;
6) need PLUG CPW VERSION HOSTIP NEWID PRIMARY_PUB STANDBY_PUB; live_gate
   echo "-- LIVE: move the current pointer (roll back later with: publish --point-at <previous> --apply, or this stage with the previous version) --"
   echo "   PRECONDITION (production 8): the host's trust anchor is set BEFORE this stage: sudo aicc-owner-facts set AICC_LM_PLUGIN_SIGNING_PUBKEYS '<primary>,<standby>' (the owner's PUBLIC keys, from the owner's own records); sudo aicc-render-wp-config --env production --confirm-production; sudo systemctl reload php8.3-fpm; sudo aicc-owner-facts export > owner-facts-\$(date +%F).env. The launch gate (stage 7) blocks while it is unset."
   # the key list the installer re-verifies the installed signature against: the same release/endpoints.conf list the signature was checked against at stage 4/5
   publish --apply --point-at "$VERSION" --plugin-dir "$PLUG" | tee "$OUT/publish-set-current.txt"
   echo "stage 6 done. Now: stage 7 (verify-live). Stage 7 must show no AICC_LM_PLUGIN_SIGNING_PUBKEYS blocker: the host's trust anchor was a precondition of this stage (a production host serves nothing without it)." ;;
7) need HOSTIP NEWID PRIMARY_FP
   PSSH="ssh -i $PKEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$KNOWN aicc@$HOSTIP"
   echo "-- read-only: the launch gate's Plugin lines (5h download available, 5h-1 signed) --"
   $PSSH 'sudo env AICC_PRODUCTION=1 aicc-wp eval-file /var/lib/aicc-cp/seed/check-launch-blockers.php' | grep -i -E 'plugin (download|release)|update-signing|signature|release store' || echo "(no Plugin line printed: read the whole gate output)"
   echo "Then, by a person: sign in as a test customer with an active plan, open Plans & Stores, download the ZIP, compare its SHA-256 with the page; run the updater check from a connected test store (it must report the signature, key_id = $PRIMARY_FP)." ;;
*) sed -n 2,13p "${BASH_SOURCE[0]}"; exit 2 ;;
esac
