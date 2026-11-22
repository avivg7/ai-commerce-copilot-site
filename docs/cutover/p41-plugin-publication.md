# Official Plugin publication: sign offline, publish, verify, roll back (owner and coordinator steps)

Written 2026-11-18 (UTC), P41 builder R. It replaces `PLUGIN-SIGN-AND-PUBLISH-STEPS.md` of the P37 evidence folder (that file named the wrong Control Plane worktree, passed `--pubkeys` AND `--zip` to a verify that then ignored the ZIP, and had no post-publication check).

**Nothing in this document has been run against production.** Every command below was run for real in dry-run or fixture mode (section 9 lists what, with the counts), with THROWAWAY keys and a build of an earlier candidate commit (1.1.1, `abdcda2`) that bakes a throwaway public key. No real signing key, vault or production host was touched.

The procedure is **version-agnostic**: the tools take the version, the ZIP's SHA-256 and the commit as ARGUMENTS and hard-code none of them. **The Plugin candidate is rebuilt by builder P (the hash changes with every rebuild): this document deliberately contains no release hash. Every value comes from the release directory builder P hands over and from the coordinator's hand-over message (section 1).** Publish the version the coordinator hands over, never one you built yourself.

> **P44 update (2026-11-21).** The Plugin's `bin/sign-release.php verify` now checks a supplied `--zip` against the manifest ALSO when `--pubkeys` is given (a tampered ZIP next to a genuine manifest and signature is refused), and `--pubkeys` is exactly the trusted set. `sign-plugin-release.sh` therefore runs a fourth, zip-aware verify (`--pubkeys <list> --zip <ZIP>`), proves with a one-byte-larger ZIP that the Plugin checkout's tool is the fixed one (an older checkout is refused, exit 1, signature removed), and `publish-plugin-release.sh` / `first-signed-release.sh` run the same strict form. The older two-form description below stays valid for checkouts before the fix; use a Plugin checkout from the P44 release line.
>
> **P44 review round (2026-11-21).** (1) The Plugin's `verify` now FAILS CLOSED with `--pubkeys` AND `--zip` when the signature does not also verify against the public keys baked into that ZIP (that release could not verify its own update), and `--zip` alone prints a stderr WARNING that it proves integrity only, not authenticity; `sign-plugin-release.sh` keeps that warning out of its printed result (the owner's list is checked by its other three forms). (2) **The production trust-anchor gate is now ENFORCED, not only documented:** `publish-plugin-release.sh --env production --apply` (publish, `--set-current` and `--point-at` alike) first runs the read-only `check-host-signing-keys.sh` check with the same owner public list; if the host's `AICC_LM_PLUGIN_SIGNING_PUBKEYS` is not defined or its PRIMARY key is absent it REFUSES (exit 3, "production trust-anchor gate FAILED ... Nothing was uploaded or changed", pointing to `TRUST-ANCHOR-OWNER-FACT.md`) before anything is uploaded. A production dry run (no `--apply`) and staging runs do not run it: the dry run stays fully offline. Section 3 below remains the way to look at the host yourself first; the publisher now also refuses on its own.


> **P45 update (2026-11-22): key custody changed.** The encrypted-vault signing of section 2 is **SUPERSEDED for custody of the signing keys** (the owner lost both vault passphrases; both keys are being replaced). Release signing is now possession-based and passwordless: the key is an unencrypted file on a dedicated USB stick, made by `infra/release/usb-key-ceremony.sh` and used only through `infra/release/sign-plugin-release-usb.sh`. Read `docs/release/usb-signing-threat-model.md` (what that does and does not protect, loss/theft rotation), `docs/release/OWNER-SIGNING-COMMAND-USB.md` (the single approved command) and `docs/release/p45-superseded-p44-vault-signing.md`. `sign-plugin-release.sh` stays for legacy/throwaway use and cannot be used with a FAT32 stick. Sections 3 to 11 (trust-anchor check, publication, verification, rollback) are unchanged: they verify the signature and the trust anchor, not how the signature was made.

## 1. The values for THIS release

Fill these in from TWO sources. The release directory `$F` is the one builder P hands over (it holds `ai-commerce-copilot-<V>.zip`, `.zip.sha256` and `.manifest.json`); the coordinator's hand-over message gives `V`, `SHA` and `COMMIT` over a SECOND channel (never copy `SHA` out of `$F`: the point is that a swapped folder cannot vouch for itself).

```bash
F=<the P-plugin release directory handed over by the coordinator>      # e.g. .../AICC-launch-evidence/execution-reset/cp-dark/p41/P-plugin/<release folder>
V=<X.Y.Z from the hand-over message>      # no -dev/-rc suffix (production refuses a pre-release)
SHA=<64 hex from the hand-over message>   # the ZIP's SHA-256, second channel
COMMIT=<7-40 hex from the hand-over message>   # the Plugin commit it was built from
# cross-check what the folder says against what you were told (all three must print equal pairs; if not, STOP and ask the coordinator):
jq -r '.version, .sha256, .built_from_commit' "$F/ai-commerce-copilot-$V.manifest.json"   # expect: $V, $SHA, a 40-hex commit that starts with $COMMIT
PLUG=<a CLEAN checkout YOU fetched, at $COMMIT>   # git -C "$PLUG" rev-parse HEAD (starts with $COMMIT) ; git -C "$PLUG" status --short (prints nothing)
SITE=~/self_projects/ai_copilot_site-worktrees/p41-release-tools     # any Site worktree that contains infra/release/sign-plugin-release.sh (the merged P41 Site line once the coordinator has merged it)
CP="$HOME/Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/p40-pricing"   # the DEPLOYED Control Plane line; after the coordinator deploys the merged P41 CP, that worktree. NOT p37-integrated.
PRIMARY_FP=9d49-041f-0ced-13ac            # the primary key's fingerprint (you read it from keygen; it is also in the plugin's release/endpoints.conf comment)
SSHK=~/.ssh/aicc_cp_prod_operator; KNOWN=~/.ssh/known_hosts_aicc_prod; HOSTIP=157.230.110.211; STAGEID=3e897286ce82e55f4d866acf0d526a5f
```

The CP worktree is used for ONE file only, `scripts/plugin-release/install-plugin-release.sh`, which the publisher uploads and runs as root on the host; that file has the same SHA-256 (`aec6f188...`) in the p37, p40 and p41 CP worktrees today. The publisher prints its SHA-256 and re-checks it on the host before running it.

Baked update-signing PUBLIC keys of the release builds so far (`release/endpoints.conf` `UPDATE_PUBLIC_KEYS`, primary FIRST):

| Public key | Fingerprint | Role |
|---|---|---|
| `yCsFX6176Ue5ZTdi4Dr99J9LFM43jXrN6Kbp13KF04Y=` | `9d49-041f-0ced-13ac` | primary: sign with this one |
| `5p50qA1SYMTV7MXeDAWfMnNqLKVuTRDVS4FREuKuQwM=` | `be7f-3dda-cddd-d781` | standby, kept offline, for rotation or an emergency |

Every later build must carry the same two keys; the wrapper below refuses a ZIP that bakes anything else than the list in the checkout's `release/endpoints.conf`.

## 2. Sign offline (owner, vault Mac) - the minimal safe procedure (P44 vault path: SUPERSEDED for custody, see the P45 update above)

```bash
# 1. the artifacts are exactly what the coordinator announced (second channel)
( cd "$F" && shasum -a 256 -c "ai-commerce-copilot-$V.zip.sha256" )          # must print: ai-commerce-copilot-<V>.zip: OK
shasum -a 256 "$F/ai-commerce-copilot-$V.zip" | cut -d' ' -f1                 # must equal $SHA from the hand-over message, character for character

# 2. attach the PRIMARY vault, sign, detach
hdiutil attach <the primary vault image: the verified USB copy /Volumes/<STICK-1>/aicc-keys-primary.dmg, or the Mac copy>
AICC_RELEASE_SIGNING_KEY_FILE=/Volumes/AICCKEYS-PRIMARY/aicc-release-primary.key \
  bash "$SITE/infra/release/sign-plugin-release.sh" \
    --plugin-dir "$PLUG" --zip "$F/ai-commerce-copilot-$V.zip" --manifest "$F/ai-commerce-copilot-$V.manifest.json" \
    --version "$V" --sha256 "$SHA" --commit "$COMMIT" --primary-fp "$PRIMARY_FP"
hdiutil detach /Volumes/AICCKEYS-PRIMARY
```

Expected output (the times differ):

```
SIGNED  <V>  key 9d49-041f-0ced-13ac  (the primary)
  verified: <V> signed 2026-11-18T19:58:27Z by key 9d49-041f-0ced-13ac
  verified: <V> signed 2026-11-18T19:58:27Z by key 9d49-041f-0ced-13ac
  verified: <V> signed 2026-11-18T19:58:27Z by key 9d49-041f-0ced-13ac
  tamper control: a manifest one byte larger is NOT accepted by this signature
  signature file (public, not secret): .../ai-commerce-copilot-<V>.manifest.sig
  sha256 of the signature file: ...
```

Hand ONLY `ai-commerce-copilot-$V.manifest.sig` back to the coordinator (it is public). Back it up. The key file is only ever the file named by the environment variable: it is not an argument, not printed, not copied.

**What the wrapper refuses (exit 3, nothing written):** no `AICC_RELEASE_SIGNING_KEY_FILE`; a key file that is a symlink, not yours or readable/writable by group or other; a Plugin checkout that is not at `--commit` or not clean; a manifest that is not `dirty:false`, not for `--version`, not built from the checkout's commit; a ZIP whose SHA-256/size differs from the manifest or from `--sha256`; a ZIP whose baked public keys are not exactly the list in `release/endpoints.conf`; a `--primary-fp` that is not the FIRST key of that list; an existing `.manifest.sig` (it never overwrites); a pre-release version. If the key you attached is not the primary, or not a key the ZIP carries, the Plugin's own signing tool refuses (exit 1) or the wrapper removes the result: a signature made by the standby is never left behind (it is for an emergency only).

**Trust in the signing step, stated plainly.** The wrapper runs PHP code from `$PLUG` (`bin/sign-release.php` and the signature class) with the NAME of your key file in its environment, so a tampered checkout could read the key. What protects you: `$PLUG` must be a clean checkout that YOU fetched (not a folder somebody sent you) whose `git rev-parse HEAD` starts with the `COMMIT` from the coordinator's second channel; the manifest must have been built from exactly that commit; and `--primary-fp` is the fingerprint you read yourself from keygen, so a signature by any other key is removed. The wrapper removes its temporary files (the unverified signature, the tamper-control copy) on every exit, including a refusal.

**The ZIP cross-check, stated exactly.** `bin/sign-release.php verify` uses the ZIP ONLY when `--pubkeys` is absent (`bin/sign-release.php` lines 208-210: `$keys = isset( $a['pubkeys'] ) ? ... : array(); if ( ! $keys && isset( $a['zip'] ) ) { ... srl_check_zip ... }`). The old example passed `--pubkeys` AND `--zip`; the `--zip` was silently ignored, so a swapped ZIP next to a genuine manifest and signature verified. Measured on 2026-11-18: `verify --pubkeys <list> --zip <ZIP with one byte appended>` prints `verified` (exit 0); `verify --zip <same ZIP>` fails with `the ZIP does not match the manifest`. Therefore:

* the wrapper runs THREE verifications: `--pubkeys <list>`, `--zip <ZIP>` (re-hashes the ZIP and verifies with the keys it bakes) and `--pubkeys <primary alone>` (the `key_id` in the file is only a hint), plus a tamper control;
* `first-signed-release.sh` stage 3 and `publish-plugin-release.sh` now run the `--zip` form as well (`publish` additionally keeps its own SHA-256/size/baked-key checks);
* `verify-published-plugin.sh` (section 6) runs both forms on the local ZIP and on the DOWNLOADED ZIP.

The raw equivalent, if you ever need it without the wrapper (run from `$PLUG`):

```bash
php bin/sign-release.php sign   --manifest "$F/ai-commerce-copilot-$V.manifest.json" --zip "$F/ai-commerce-copilot-$V.zip"        # key via AICC_RELEASE_SIGNING_KEY_FILE
php bin/sign-release.php verify --manifest "$F/ai-commerce-copilot-$V.manifest.json" --sig "$F/ai-commerce-copilot-$V.manifest.sig" --pubkeys 'yCsFX6176Ue5ZTdi4Dr99J9LFM43jXrN6Kbp13KF04Y=,5p50qA1SYMTV7MXeDAWfMnNqLKVuTRDVS4FREuKuQwM='
php bin/sign-release.php verify --manifest "$F/ai-commerce-copilot-$V.manifest.json" --sig "$F/ai-commerce-copilot-$V.manifest.sig" --zip "$F/ai-commerce-copilot-$V.zip"       # NOT combined with --pubkeys
# expected, both: verified: <V> signed <UTC time> by key 9d49-041f-0ced-13ac
```

Recommended one-line hardening for the Plugin repo (builder P; not done here because this builder does not edit the Plugin): in the `verify` branch run `srl_check_zip` whenever `--zip` is given and, when `--pubkeys` is also given, require the baked keys to be a subset of that list.

## 3. Confirm the host's trust anchor BEFORE touching the store (read-only; the value is not printed)

The production Control Plane serves no release unless its `AICC_LM_PLUGIN_SIGNING_PUBKEYS` (the owner's PUBLIC keys, primary + standby) holds the key that signed it; the launch gate blocks otherwise. Before step 5, one read-only call asks the host (step 5's `--apply` runs the same check itself and refuses when it is not OK; the standalone call lets you see the answer first) and prints only `defined`, the entry count, each entry's FINGERPRINT and whether each key of your list is present (never the constant, never `wp-config.php`):

```bash
bash "$SITE/infra/release/check-host-signing-keys.sh" --plugin-dir "$PLUG" \
  --stage-host www.copilt.org --stage-ip "$HOSTIP" --stage-id "$STAGEID" --key "$SSHK" --known-hosts "$KNOWN"
```

Expected:

```
host identity OK (www.copilt.org, id matches)
HOSTKEYS defined entries=2 fingerprints=9d49-041f-0ced-13ac,be7f-3dda-cddd-d781
HOSTKEYS primary 9d49-041f-0ced-13ac PRESENT
HOSTKEYS standby be7f-3dda-cddd-d781 PRESENT
OK: the primary signing key is configured on the host's AICC_LM_PLUGIN_SIGNING_PUBKEYS (the value itself was not printed).
```

Exit 0 means the primary is configured (a missing standby only adds a NOTE). Exit 1 (`HOSTKEYS not-defined`, or the primary `ABSENT`): STOP. The store would refuse to serve the release. Fixing it is a separate, approved host step and the only one that touches `wp-config`:

```bash
sudo aicc-owner-facts set AICC_LM_PLUGIN_SIGNING_PUBKEYS '<primary>,<standby>'     # the PUBLIC keys; validated
sudo aicc-render-wp-config --env production --confirm-production --compare          # MUST say IDENTICAL or list ONLY AICC_LM_PLUGIN_SIGNING_PUBKEYS as "added"; anything else: STOP (docs/cutover/p41-wpconfig-lineage.md)
sudo aicc-render-wp-config --env production --confirm-production --dry-run
sudo aicc-render-wp-config --env production --confirm-production
sudo systemctl reload php8.3-fpm
```

Never re-render before `--compare` has been read: the host's wp-config carries five constants first appended by hand (owner metrics token file/base/user ids, launch-offer announce mode, ops snapshot file); they survive only when they are pinned as owner facts (`docs/cutover/p41-wpconfig-lineage.md`).

## 4. Production dry run (local verification, no network)

Production without `--apply` is a dry run by the script's own rule. With the signature file in `$F`:

```bash
bash "$SITE/infra/release/publish-plugin-release.sh" --env production \
  --zip "$F/ai-commerce-copilot-$V.zip" --manifest "$F/ai-commerce-copilot-$V.manifest.json" --sha256-file "$F/ai-commerce-copilot-$V.zip.sha256" \
  --signature "$F/ai-commerce-copilot-$V.manifest.sig" --plugin-dir "$PLUG" \
  --installer "$CP/scripts/plugin-release/install-plugin-release.sh" \
  --stage-host www.copilt.org --stage-ip "$HOSTIP" --stage-id "$STAGEID" \
  --key "$SSHK" --known-hosts "$KNOWN" --confirm-production "$V" --set-current
```

Expected (verified on the throwaway release; the hashes differ for yours):

```
signature verified locally (verified: <V> signed <time> by key 9d49-041f-0ced-13ac)
DRY-RUN plan (production; local verification passed; nothing sent):
  1. ssh aicc@157.230.110.211 ...: read /etc/aicc-stage-identity, require production + www.copilt.org + 3e897286...
  2. rsync the installer (sha256 aec6f188...), the ZIP and the manifest, the signature ai-commerce-copilot-<V>.manifest.sig -> ~aicc/plugin-incoming/<V>/ (0700)
  3. ssh: re-check the installer's sha256 on the host, then: sudo ~aicc/plugin-incoming/<V>/install-plugin-release.sh --release-dir /srv/aicc/shared/plugin-releases --group aicc-cp --zip ... --manifest ... --expect-sha256 <$SHA> --set-current --signature ... --pubkeys <the two keys>
  4. ssh: read the store back through WordPress (AICC_LM_Release_Store::configuration_problem() must be empty), remove ~aicc/plugin-incoming/<V>
  action: publish <V> (ai-commerce-copilot-<V>.zip, sha256 <first 16 of $SHA>...) and make it current
  (production: add --apply to run it)
```

Any `REFUSED:` line is a safety rule (exit 3) and nothing happened. What the local verification covers: the ZIP name/version/SHA-256/size equal the manifest and the `.sha256` file; `dirty:false` with a 40-hex commit; the `.sig` is well formed and named for the version; `sign-release.php verify` passes against the key list of `--plugin-dir/release/endpoints.conf` in BOTH forms (list and ZIP); every public key baked into the ZIP is on that list; the installer is the Control Plane's `install-plugin-release.sh`; production names, key name, pinned host key; the API Droplet and GitHub Pages addresses are refused; `--confirm-production` equals the version.

## 5. Apply (the production step; owner's approval of THIS step first)

Identical to step 4 plus `--apply`:

```bash
bash "$SITE/infra/release/publish-plugin-release.sh" --env production --apply \
  --zip "$F/ai-commerce-copilot-$V.zip" --manifest "$F/ai-commerce-copilot-$V.manifest.json" --sha256-file "$F/ai-commerce-copilot-$V.zip.sha256" \
  --signature "$F/ai-commerce-copilot-$V.manifest.sig" --plugin-dir "$PLUG" --installer "$CP/scripts/plugin-release/install-plugin-release.sh" \
  --stage-host www.copilt.org --stage-ip "$HOSTIP" --stage-id "$STAGEID" --key "$SSHK" --known-hosts "$KNOWN" --confirm-production "$V" --set-current
```

It reads `/etc/aicc-stage-identity` over ssh and requires `AICC_ENV=production`, `AICC_HOSTNAME=www.copilt.org` and the stage id BEFORE uploading; uploads installer, ZIP, manifest and signature to `~aicc/plugin-incoming/$V/`; re-checks the installer's SHA-256 on the host; runs it as root with `--expect-sha256`, `--signature` and the owner's public key list (the host installer verifies against that list, never against the keys inside the ZIP); then reads `current` back and asks WordPress `AICC_LM_Release_Store::configuration_problem()`. Success line: `VERIFIED through WordPress: the release store is valid, current = <version>`. An installed version is never overwritten. No PHP-FPM reload is needed (the store is read on every request).

**Safer two-step variant:** drop `--set-current` (the release is only staged in `/srv/aicc/shared/plugin-releases/$V/`, nothing is offered), inspect, then flip with `--point-at "$V"` (dry run first, then `--apply`; `--point-at` needs `--plugin-dir` or `--pubkeys` because the installer re-verifies the installed signature against the same list):

```bash
bash "$SITE/infra/release/publish-plugin-release.sh" --env production --point-at "$V" --plugin-dir "$PLUG" \
  --installer "$CP/scripts/plugin-release/install-plugin-release.sh" --stage-host www.copilt.org --stage-ip "$HOSTIP" --stage-id "$STAGEID" \
  --key "$SSHK" --known-hosts "$KNOWN" --confirm-production "$V"          # add --apply to run it
```

## 6. Verify after publication (the launch gate and the real customer path)

### 6.1 The launch gate on the host (read-only)

```bash
ssh -i "$SSHK" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KNOWN" aicc@"$HOSTIP" \
  'sudo env AICC_PRODUCTION=1 aicc-wp eval-file /var/lib/aicc-cp/seed/check-launch-blockers.php' | grep -i -E 'plugin (download|release)|update-signing|signature|release store'
```

Expected notes (no matching blocker): `Plugin download: current release <V>, <bytes> bytes, sha256 <$SHA> (verified now).` and `Plugin release <V> is signed (key 9d49-041f-0ced-13ac, <time>), verifies against AICC_LM_PLUGIN_SIGNING_PUBKEYS on this host and against the key baked into the shipped build.` Then the two Control Plane signup checks (P41 builds): `ssh ... 'sudo aicc-wp aicc-trial status'` must no longer list `plugin_release` among the blockers, and `ssh ... 'sudo aicc-wp aicc-ops journeys blockers'` must print `Success: No journey blocker: a signed plugin release is published and the Backend mirror is fresh.` (exit 0). A `WARNING:` line about the Backend milestone mirror is not a publication problem: run `sudo aicc-wp aicc-ops milestones sync` (activation runbook step 3). A `BLOCKER:` line (`No signed plugin release is published: ...`) means the store does not serve a signed release: go back to section 3 or 7.

A blocker line mentioning `AICC_LM_PLUGIN_SIGNING_PUBKEYS`, an unsigned release or a failed integrity check means: roll back (section 7) and fix.

### 6.2 The customer path, as the owner's own test account (`verify-published-plugin.sh`)

Use an account YOU own that has an ACTIVE plan (never a real customer's). Create the credentials file once, hidden prompt, mode 0600 (the password is never an argument, never printed, never written to a report):

```bash
( umask 077; printf 'Test account login (e-mail or user name): '; read -r u; printf 'Password: '; stty -echo; read -r p; stty echo; echo
  printf 'AICC_VERIFY_USER=%s\nAICC_VERIFY_PASS=%s\n' "$u" "$p" > ~/aicc-verify-creds.env; unset u p ); ls -l ~/aicc-verify-creds.env      # -rw-------
```

Then (`--previous-version` only when an earlier release was current; for the first release omit it):

```bash
bash "$SITE/infra/release/verify-published-plugin.sh" --mode production --base-url https://www.copilt.org \
  --version "$V" --sha256 "$SHA" --manifest "$F/ai-commerce-copilot-$V.manifest.json" --sig "$F/ai-commerce-copilot-$V.manifest.sig" \
  --plugin-dir "$PLUG" --expect-key-id "$PRIMARY_FP" --local-zip "$F/ai-commerce-copilot-$V.zip" \
  --credentials-file ~/aicc-verify-creds.env --out ~/aicc-verify-$V-$(date -u +%Y%m%dT%H%M%SZ)
```

`--out` must not exist or must be an EMPTY directory (the tool never deletes, overwrites or re-permissions files you already have; an existing empty directory keeps its mode and the work happens in a fresh 0700 subdirectory): use a new path each run, as above.

What it proves (each line prints `PASS` or `FAIL`; exit 0 only when all pass: 30 checks on production without a store file or a second account, 31 with `--previous-version`; the JSON report is `verify-report.json` in `--out`):

| Block | Checks |
|---|---|
| R1-R6 release record (offline) | manifest clean and equal to the second-channel SHA-256; signature well formed; verifies against the owner's public keys with the Plugin's own tool; `key_id` belongs to exactly one key and that key alone verifies it (the hint is not trusted); equals `--expect-key-id`; strictly newer than `--previous-version`; the local ZIP re-hashed and verified in the `--zip` form; Version header = `AICC_VERSION` = manifest version; baked keys on the owner's list |
| C1-C7 customer path | sign in through the My Account form; Plans & Stores shows the version, the SHA-256 and the signing-key fingerprint; download through the page's own nonce link: HTTP 200, `application/zip`, size and SHA-256 equal the SIGNED manifest, `X-AICC-SHA256`, nosniff, no-store; the DOWNLOADED ZIP verifies with its baked keys; version header/constant/manifest agree |
| U1-U9 uniform refusals | signed-out request and a stale nonce are refused (302 / 403) with no ZIP and no `X-AICC-SHA256`; unknown or traversal version 404; update-check with unknown, malformed or query-string proofs answers byte-identically `{"update":false}`; package answers `404 {"error":"not_available"}` |
| D1 download safety | a connection cut half way, a flipped byte and a shorter ZIP are each detected (size / SHA-256 / ZIP structure) and leave NOTHING under the final name, so nothing can be installed |
| U10-U20 (only with `--store-file`) | a connected store of an active plan: older store is offered a release whose version/SHA-256/size/key_id/signature equal the signed one, the answer's own signature verifies, the Plugin's `validate_offer`/`verify_offer` accept it from an older version and refuse the same version, a downgrade (9.9.9) and a foreign baked key; wrong ORIGIN and another TENANT's ref get the uniform refusal; `--package-download` also pulls the ZIP through the updater route |
| U21-U22 (only with `--other-credentials-file`) | a SECOND test customer: this session with the other customer's nonce link, and the reverse, are both refused (403, no ZIP): the download nonce is bound to the session that rendered the page |

Skipped by default on production: `--other-credentials-file` (a second account of yours with an active plan), `--store-file` (omit it unless you have your own connected TEST store: the file is `AICC_STORE_ACTIVATION_REF=` / `AICC_STORE_ORIGIN=`, mode 0600; it uses update-check only) and `--package-download` (it would be logged as a system download).

**State changes on production, all of them to YOUR test account or counters:** the sign-in session; the account download (the Control Plane logs `plugin_downloaded` for that account and sets its onboarding milestone `plugin_downloaded_at`, like any download); the fabricated-proof POSTs (`--no-updater-probes` skips them) only count against the rate limiter. Run it at most a few times an hour (30 account downloads per customer per hour, 60 update checks per address per hour).

If a check fails: `R*` the record or your arguments are wrong (do not continue); `C1` credentials, login throttle or Turnstile on sign-in; `C2` the page shows no release (store refuses it: run 6.1, check the trust anchor); `C4` the store refused to serve (integrity/signature: 6.1); `U*` a refusal is not uniform: treat as a security finding and roll back; `D1` the client routine itself is broken.

### 6.3 Locally, before production: the same tool against a disposable Control Plane

```bash
AICC_VERIFY_FIXTURE=1 bash "$SITE/infra/stack-tests/test_verify_published_fixture.sh"        # ~70 s; needs mysqld, php (mysqli) and wp-cli on this Mac; ports 9910-9911; throwaway keys
bash "$SITE/infra/stack-tests/test_verify_published.sh"                                       # ~60 s; mock Control Plane, signing wrapper, host check, yank, negative controls
```

The fixture brings up WordPress + WooCommerce + the real `aicc-license-manager` of `AICC_CP_DIR`, installs a THROWAWAY-signed build of the release commit with the Control Plane's real host installer, seeds three synthetic customers (active, other tenant, revoked) and runs the verifier through the real routes.

## 7. Roll back a bad publish

Decide by what exists:

| Situation | Action |
|---|---|
| An EARLIER good version is installed in the store | `publish-plugin-release.sh --env production --point-at <earlier> ...` (section 5 form; dry run first, then `--apply`). `current` is one atomic rename; nothing is deleted; the installer re-verifies the installed bytes and signature first. Then re-run 6.1. |
| This was the FIRST release (nothing to point at), or the release itself is bad | **Yank it**: `yank-plugin-release.sh` sets `"yanked": true` in that version's manifest on the host (root-owned file, same owner/group/mode, atomic; the signed fields are untouched so the signature still verifies; nothing is deleted). A yanked release is never offered to a store, never shown on the account page, and the rollback list skips it; with `current` on it nothing is offered at all. |
| The signature, key or ZIP of an installed version is wrong | Releases are immutable: sign and publish a corrected release under a NEW version number, then `--point-at` it (or `--set-current` while publishing). Never edit files in the store. |

```bash
bash "$SITE/infra/release/yank-plugin-release.sh" --version "$V" --stage-host www.copilt.org --stage-ip "$HOSTIP" --stage-id "$STAGEID" \
  --key "$SSHK" --known-hosts "$KNOWN" --confirm-production "$V"            # DRY RUN; add --apply to run it (the owner's approval of that step)
# expected after --apply: VERIFIED through WordPress: <V> is now YANKED. Nothing was deleted; the signature is unaffected.
# undo: the same command with --unyank
```

After either rollback, re-run 6.1: the gate must show no Plugin blocker (with the only release yanked the gate says the download is not available: that is the intended stop state). Stores that already installed the bad version are never downgraded by the updater (it only offers a HIGHER version): to go back, a merchant uploads the older ZIP from the account page (Plugins, Add New, Upload) or the corrected higher version is published.

## 8. `AICC_EA_PLUGIN_RELEASE_SHA256` (the Site's launch-offer identity gate)

`npm run launch:check` in `announce` and `open` Site builds requires `AICC_EA_PLUGIN_RELEASE_SHA256` = the SHA-256 of the Plugin ZIP distributed with the launch offer, and accepts only a hash listed under `allowed` in `scripts/data/ea-plugin-releases.json` (never a `superseded` one, never 64 zeros; the Site build never reads the value or any file). Signing does not change the ZIP, so **the value is the same SHA-256 before and after signing**; what changes is the entry's status. Today the file lists only the old unsigned candidate `3f7a85ea...c1b6`, so a Site announce/open build with the hash of ANY later candidate (it changes with every rebuild) is refused until an entry is added.

Procedure (owner/coordinator, AFTER step 5 and 6 passed for the version): add one `allowed` entry `{ "sha256": "<$SHA>", "status": "signed release <V> (key <PRIMARY_FP>)", "note": "..." }` to `scripts/data/ea-plugin-releases.json` in its own commit (a conscious act, per that file's `_doc`; this builder's scope excludes `scripts/`), then build the Site with `AICC_EA_PLUGIN_RELEASE_SHA256=<$SHA>`. Do not set it to a hash that is not the one the Control Plane serves: compare with the SHA-256 shown on the account page (check C2 does exactly that).

## 9. What was verified by running, and what was not

Run for real, locally, with throwaway keys (evidence: `AICC-launch-evidence/execution-reset/cp-dark/p41/R-release/`):

| What | Result |
|---|---|
| `bash infra/stack-tests/test_verify_published.sh` (signing wrapper S, release record A, --out handling O, mock Control Plane B with one fault per negative control, host check H, `first-signed-release.sh` stage 3 F, guards G, yank Y) | 152 passed, 0 failed |
| `AICC_VERIFY_FIXTURE=1 bash infra/stack-tests/test_verify_published_fixture.sh` (real WordPress + WooCommerce + `aicc-license-manager` of the p40 CP worktree, real host installer, real routes; F1-F7) | 21 passed, 0 failed (48 of 48 verifier checks pass for the active customer, including the updater and package routes and the cross-tenant download) |
| `bash infra/stack-tests/test_plugin_publish.sh` (after the `--zip` verify was added to `publish-plugin-release.sh`) | 140 passed, 0 failed (unchanged) |
| `infra/release/publish-plugin-release.sh --env production ...` dry runs (publish + set current, stage only, `--point-at`, wrong `--confirm-production`) against the throwaway-signed 1.1.1 with throwaway key files | plans printed, refusal exit 3 as documented (`logs/publish-dry-run-throwaway.txt`) |
| The EARLIER 1.1.1 candidate rebuilt from `abdcda2` (the test default; override with `AICC_PLUGIN_DIR`/`AICC_PLUGIN_COMMIT` to point the suites at the rebuilt candidate) | byte-identical to the 1.1.1 ZIP evidence; a throwaway key cannot sign it (the ZIP bakes the owner's keys), a record check against a throwaway key list fails at R6d |

NOT run, by design: anything against `www.copilt.org` or the Droplet; any real signing key; the `--apply` forms; `check-host-signing-keys.sh` and `yank-plugin-release.sh` against a real host (their tests use an ssh stub that runs the real PHP/python on scratch data); the production-mode customer check (needs the owner's account).

## 10. What the customer sees, before and after

| Where | Before publication (today: nothing published) | After step 5 and 6 pass |
|---|---|---|
| Account, Plans & Stores, customer with an active (or expired) plan | A "Get the AICC plugin" box that says "The plugin download is not available right now. If this continues, write to <support> from your account email." | The same box shows Current version, File size, Needs (WordPress, WooCommerce, PHP minimums), SHA-256, "Signed with key 9d49-041f-0ced-13ac (<UTC time>)", a button "Download AICC plugin <V>", the four install steps, "Check that the file is intact" (the `shasum -a 256` / `certutil` lines), and "Updates and older versions" (older non-yanked releases, up to two before current) |
| Account, a registered account that never had a plan, a revoked or suspended plan | nothing (the box is not rendered) | nothing (unchanged: revoked and suspended plans can no longer download) |
| A connected store of an active plan running an OLDER version | no update offer | WordPress shows the update under Dashboard, Updates; the offer carries the signature, which the store verifies against the key baked into its build before it installs; nothing updates by itself |
| A store already on this version, an expired/revoked/suspended plan, an unconnected store | no offer | no offer (uniform `{"update":false}`) |
| Anyone signed out, or a wrong origin / unknown store | refused (302 to sign-in, 403, 404, `{"update":false}`) | identical refusals: they reveal nothing about other tenants or why |
| New customers (public signup, P41 Control Plane) | the signup would answer `open` while nobody could get the plugin | while no signed release is downloadable the signup reads `paused` (`plugin_release` blocker); with one published it can open |
| After a yank (section 7) | n/a | the box falls back to the "not available right now" text; no offer is made; new signups read `paused` (`plugin_release`) |

## 11. Deviations and open items (read before the owner step)

1. `bin/sign-release.php` (Plugin repo) still ignores `--zip` when `--pubkeys` is given. It was NOT edited (Plugin repo, builder P); the tools in this repo work around it (both verify forms). Recommended Plugin-side one-line fix is in section 2.
2. `scripts/data/ea-plugin-releases.json` has no entry for the rebuilt candidate (section 8); out of this builder's scope.
3. `AICC_LM_PLUGIN_SIGNING_PUBKEYS` on the live host: not read here (no production access). Step 3 reads it safely before the store is touched. If it is unset, adding it needs a wp-config render: do `--compare` first (section 3).
4. The rebuilt successor must carry the same two baked keys; if it does not, `sign-plugin-release.sh` refuses it (the ZIP's baked list must equal `release/endpoints.conf`).
5. First release: there is no earlier version to point at; the rollback is the yank in section 7.
6. The host bundle of the production Droplet is older than this repo (the P38 update copied six files only): `check-host-signing-keys.sh`, `yank-plugin-release.sh`, `verify-published-plugin.sh` and `sign-plugin-release.sh` run on the OWNER'S MAC, not on the host; nothing here needs a host bundle update.
