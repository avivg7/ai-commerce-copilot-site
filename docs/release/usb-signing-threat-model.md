# Passwordless USB signing: the accepted threat model (P45)

Written 2026-11-22 (UTC), builder A, P45. It describes the signing-key custody that replaces the P44 encrypted-vault custody (`docs/release/p45-superseded-p44-vault-signing.md`). Tools: `infra/release/usb-key-ceremony.sh`, `infra/release/sign-plugin-release-usb.sh`, `infra/release/render-owner-signing-command.sh`.

## 1. The model, in one paragraph

Each of the two release-signing keys (Primary, Standby) is an Ed25519 key stored as an UNENCRYPTED file, `AICC-RELEASE-SIGNING/aicc-release-<role>.key`, on its OWN dedicated USB stick. There is no password, no passphrase, no keychain item, no encrypted image and no unlock step. **Possession of the stick is the authority to sign.** The owner accepted this model because the passphrases of the previous vaults were lost: a custody scheme that depends on a memorised secret failed; a physical object the owner can keep in a safe does not depend on memory.

## 2. What an unencrypted USB stick does NOT protect against (stated plainly)

* **Anyone who physically obtains the stick can sign malicious releases.** There is no cryptographic protection against the possessor. Nothing about the file, the identity file, the volume UUID or the scripts changes that: all of those are checks against MISTAKES (wrong stick, wrong key, wrong release), not against a person who holds the key.
* **FAT32 enforces no permissions.** The sticks are `MS-DOS FAT32`, mounted `noowners`: `chmod 0600` has no effect, every local user can read the file while the stick is attached. The tools probe this and say so (`preflight`, `verify`, and a WARNING in every signing run); where a filesystem does enforce permissions (APFS/HFS+) the signing script additionally refuses a key file that is group/other readable.
* **The volume UUID is not an authenticator.** A FAT32 volume ID is trivially copied (`dd` of the stick keeps it), and these sticks report no USB serial number, so the UUID is the only per-stick identifier. It is used to catch a wrong or look-alike stick (two sticks with the same label, a copied folder), never to prove who holds the key; the signing command therefore REQUIRES `--expect-volume-uuid` from the handover. The identity proof is cryptographic: the public key derived from the private key must equal the primary key of the trusted list. The key folder must also be a real directory on the stick (a symlinked folder pointing at a Mac folder is refused), and the Plugin checkout must be pristine to git (status, ignored files, assume-unchanged and skip-worktree entries).
* **Copying is invisible.** A momentary possession (a stick left in a Mac, a stolen laptop with the stick attached, a malicious USB hub) copies the key without removing the stick. Treat any unexplained access to the stick, or to the Mac while the stick was attached, as a possible compromise (section 4).
* **Malware on the signing Mac can use the key while the stick is attached**, and can read it (no permissions). The mitigation is procedural: sign only from a CLEAN checkout at the pinned commit, with the stick attached only for the minute it takes, then eject (`--eject`) and put the stick back. The stick is never attached otherwise.
* **The tools run code from the Plugin checkout** (the signature class) while the key is readable. The checkout must be clean and at the commit the coordinator named over a second channel (the same rule as P44).

What the design DOES give you: the key never exists anywhere but the stick (no Mac disk copy, no cloud, no repo, no log: the scripts read it inside PHP/python processes, never print or pass it, and the test suite scans every output for it); a signing mistake is hard (device identity, UUID, key-equals-trusted-primary, fingerprint, commit, ZIP and manifest values, typed phrase); a wrong or old key is rejected; and nothing depends on a secret anyone must remember.

## 3. Roles and storage (physical)

* **Primary** key: on stick A. **Standby** key: on a DIFFERENT stick B. The tools refuse to put both on one device, and the signing script never signs a normal release with the standby (an emergency flag with its own typed phrase exists, section 5).
* Keep each stick **disconnected except for a signing**. Never leave a stick in a Mac. Never keep A and B together: different physical places (for example A in the office safe, B at home or a bank box). Never carry them together.
* Label them physically ("AICC primary", "AICC standby") but never trust the label. The stick is identified by the KEY on it (the public key derived from the private key must equal the trusted key); the label, the volume UUID and the device only catch mistakes (a wrong or look-alike stick), they authenticate nobody.
* No photos of the stick's contents in a cloud-synced camera roll, no copies of the key file (not to the Mac, not to cloud storage, not to a password manager, not to chat, never printed). The only sanctioned copy is `usb-key-ceremony.sh backup` onto another DEDICATED stick after a typed confirmation, kept in a third place (section 6).
* If a stick is lost, assume it is stolen (section 4). Do not "wait and see".

## 4. Loss or theft: the consequences and the emergency rotation

**Loss or theft of an unencrypted USB compromises that signing key and REQUIRES a trust-chain rotation.** Installed stores trust the public keys baked into the Plugin (up to two, `UPDATE_PUBLIC_KEYS` in `release/endpoints.conf`, class `AICC_Release_Signature::MAX_KEYS = 2`) and, if defined, the `AICC_UPDATE_PUBLIC_KEYS` constant in `wp-config.php`. A store only installs an update whose manifest signature verifies against those keys. An attacker holding a trusted key therefore needs a delivery path (the Control Plane serves releases from its private release store, so they must also get a file onto it, or a man-in-the-middle position); the key alone is not enough to reach stores, but it makes a malicious release accepted by every store that still trusts it, so the key must be removed from trust quickly.

The Control Plane's own gate is `AICC_LM_PLUGIN_SIGNING_PUBKEYS` (production owner fact): a signed release is served only if it verifies against that list, and `publish-plugin-release.sh --env production --apply` refuses when the host's list does not hold the primary key (the P44 trust-anchor gate).

### 4.1 The PRIMARY stick is lost, stolen or suspected copied (the standby is intact)

Do these in this order; the first two take minutes and stop new damage. The whole scenario (rotation release signed by the old standby, then normal signing by the new primary) is rehearsed end to end on throwaway sticks in `infra/stack-tests/test_p45_usb_signing.sh`, section K.

1. **Remove the compromised key from the Control Plane trust anchor now.** Set the production owner fact `AICC_LM_PLUGIN_SIGNING_PUBKEYS` to the STANDBY key alone (`sudo aicc-owner-facts set AICC_LM_PLUGIN_SIGNING_PUBKEYS '<standby public key>'`, render, reload PHP-FPM; `docs/cutover/p41-plugin-publication.md` section 3.2). From now on the Control Plane serves nothing signed by the lost key. Verify with `check-host-signing-keys.sh`.
2. **Stop serving anything you cannot vouch for.** If any release signed by the lost key is published and you have any doubt about it, yank it (`yank-plugin-release.sh`, section 7 of the publication document) or `--point-at` an earlier good version. Check the release store's file times for anything you did not publish.
3. **Make the NEW primary.** On a NEW dedicated stick run the normal ceremony as a PRIMARY: `usb-key-ceremony.sh generate --role primary ... --expect-handover-dir ~/AICC-KEY-HANDOVER/rotation-<date>` (a handover file is never overwritten, so the rotation gets its own directory) and verify it after a re-plug. This stick is from now on THE primary.
4. **Rotation build.** Bake `UPDATE_PUBLIC_KEYS=<new primary>,<old standby>`: the new primary FIRST (the primary is always the first key), the old standby second. The old standby must be baked because it signs this release (the Plugin refuses to sign a build that does not carry the signer's public key); the lost key is dropped, which is the point (two keys at most).
5. **Sign the rotation release with the OLD STANDBY stick, through the emergency path:** `sign-plugin-release-usb.sh --role standby --emergency-standby --standby-fp <fp> --emergency-reason "<why>" --expect-volume-uuid <the standby stick's UUID> ...` (it asks for its own typed phrase and prints EMERGENCY in the result). The script accepts the standby's key in ANY position of the trusted list, so the order in the list does not matter for this step.
6. **Publish it:** first set `AICC_LM_PLUGIN_SIGNING_PUBKEYS` to `<new primary>,<old standby>` (the publisher's gate checks that the FIRST key of the build's list is on the host), then publish and verify with `verify-published-plugin.sh`. Installed stores update through the standby-signed release and from then on no longer trust the lost key.
7. **After the rotation, how the sticks sign:** nothing is promoted or renamed. The NEW stick is the PRIMARY and signs every normal release with `--role primary` (its own handover file makes `render-owner-signing-command.sh` work as before). The old standby stays the STANDBY on its own stick in its own place and is used only on the emergency path. The lost key and its stick are out of every list; keep its handover file out of use (move it to an `archived-` name).
8. **Residual window:** until a store has applied the rotation release it still trusts the lost key. Mitigation is step 1 (the Control Plane no longer serves it) and communication: tell customers to update promptly; for a store that cannot wait, set `AICC_UPDATE_PUBLIC_KEYS` in its `wp-config.php` to the new list (this constant replaces the baked list).
9. **Retire the lost key** in the records (the handover file, the owner package, the trust-anchor documentation), update the stick inventory (which sticks exist, where), and write the incident down. **Append the lost or stolen PUBLIC key to `release/retired-public-keys.txt` in the Plugin repository (the denylist) so `set-release-keys` can never re-bake it**, and the production owner-facts tool (`parse_signing_pubkeys`) must be taught the same value (it already refuses the two P44 keys, retired in P45). The Control Plane gate (`check-host-signing-keys.sh`) is strict: the host constant must contain only the owner's keys, at most two, with the primary present, and with the key that signed the release present.

### 4.2 The STANDBY stick is lost, stolen or suspected copied (the primary is intact)

1. Remove the standby from `AICC_LM_PLUGIN_SIGNING_PUBKEYS` (leave the primary alone).
2. Generate a new key on a new dedicated stick as the new STANDBY (`generate --role standby ... --expect-handover-dir ~/AICC-KEY-HANDOVER/rotation-<date>`; the old standby handover file is never overwritten) and verify it after a re-plug.
3. Bake `<primary>,<new standby>`, build the next release and sign it with the primary through the normal command. Publish with the trust anchor updated first, verify.
4. Until stores have updated, they still trust the lost standby key; the Control Plane no longer does (step 1). Same communication and `AICC_UPDATE_PUBLIC_KEYS` remedy as above.

### 4.3 BOTH sticks are lost or compromised

No key that installed stores trust is safe, so no update can carry a trusted key change. The only remedies are out of band:

* Immediately set `AICC_LM_PLUGIN_SIGNING_PUBKEYS` to a NEW key pair generated on new sticks, so the Control Plane stops serving anything signed by the compromised keys.
* For each store: the `AICC_UPDATE_PUBLIC_KEYS` constant in `wp-config.php` (replaces the baked list) with the new public keys, or a manual re-install of a build that bakes the new keys. Installed stores otherwise keep trusting the old keys.
* Yank every release signed by the compromised keys; publish a new release baking the new pair; communicate with customers (what happened, what to do, which version is safe). This is a customer-visible incident: treat it as one.

### 4.4 Other triggers that call for the same procedure

A stick found in an unexpected place or state; the Mac was compromised while a stick was attached; a stick given to a repair shop or an unknown person; a `verify` that FAILS on a stick that worked before (different key, different UUID); a signature file you did not make. When in doubt, rotate: a rotation costs a release, a stolen key costs the trust chain.

## 5. Emergency signing with the standby (not for rotation convenience)

The standby never signs a normal release: `sign-plugin-release-usb.sh --role standby` is refused without `--emergency-standby --standby-fp <fp> --emergency-reason "<text>"`, requires its own typed phrase (`SIGN <version> <sha8> WITH THE STANDBY KEY`) and prints the reason in the result. Use it only for a rotation release (section 4.1) or when the primary stick is destroyed (not stolen) and a release is urgent: in that case a standby-signed release should also rotate trust (a new primary first in the list), so that the standby does not become the everyday key. The standby's key is accepted in any position of the trusted list on this path; the primary is always the FIRST key and is the only key that signs normal releases.

## 6. Backups

A backup is another copy of the same unencrypted key: more sticks that can be lost or stolen. The design already has two different keys, so a destroyed (not stolen) primary is recoverable through the standby and a rotation; a backup only avoids that rotation. `usb-key-ceremony.sh backup-plan` prints the options. If a backup is wanted: one extra dedicated stick PER key, made by `usb-key-ceremony.sh backup` (typed confirmation; refuses the same device, internal/cloud/repo destinations, and any destination holding the other role's key), stored in a third place. Paper/QR copies are not recommended without a written threat model. Never a cloud, never the other key's stick.

## 7. The old encrypted vaults

The P44 encrypted vaults (`aicc-keys-primary.dmg`, `aicc-keys-standby.dmg`, and their copies in `AICC-SIGNING-BACKUP` on the old sticks) stay where they are, untouched, as LEGACY ARTIFACTS. The owner lost both passphrases; the keys inside are being replaced. **They confer no trust any more:** the old public keys must not appear in any new trust anchor, new Plugin build or new handover, and a signature by an old key must be rejected (the test suite proves a build that bakes the new keys rejects an old-key signature). Do not search for the passphrases, do not delete the vault files in a hurry (the owner may want them later for forensics or auditing), and do not reuse an old stick's old-vault folder for anything.

## 7b. The standby key is exactly as powerful as the primary

Installed stores and the Control Plane accept a signature by EITHER key of the trusted list. "The standby signs only in an emergency" is a PROCEDURAL rule, enforced by the signing script (`--role standby` needs `--emergency-standby`, a reason and its own typed phrase) and by custody, NOT by cryptography: whoever holds the standby stick can sign a release that every store and the Control Plane accept, exactly like the primary. The two sticks must be protected equally, and a lost standby is a trust-chain event too (section 4.2).

**The key alone does not reach stores.** A thief with a signing key still needs a DELIVERY PATH to get a malicious release to merchant stores: a file in the Control Plane's private release store (server access), or a network position on the update endpoint (and TLS to the Control Plane stands in the way). That makes the Control Plane's own access control and the trust-anchor gate part of the defence, and it is why section 4 starts by removing the lost key from the Control Plane's trust anchor. It does not make the key harmless: stores that still trust it accept anything signed by it that reaches them.

## 8. Residual risks, in order of likelihood

1. A stick lost, stolen or left attached (physical custody failures): section 4 is the plan.
2. Malware or an untrusted USB hub on the signing Mac while the stick is attached (the key is readable): sign from a clean checkout and a trusted Mac, eject at once.
3. A tampered Plugin checkout (code runs while the key is readable): the checkout must be clean at the pinned commit.
4. The owner signs the wrong release: guarded by the pinned ZIP SHA-256 from a second channel, the manifest/commit checks and the typed phrase.
5. A silent filesystem problem on the stick (FAT32 corruption, a failing flash chip): `verify` re-reads the key and signs a probe; run it after each re-plug and after storage periods; keep the standby as the recovery path.
6. N6: a ZIP with a duplicate member name could be read differently by Python's `zipfile` and PHP's `ZipArchive`. The SHA-256 pin from the second channel is the main defence; the signing script also refuses a ZIP with duplicate member names.
7. N3 and N5 (low-severity review notes) are recorded in the P45 review record; they do not change the procedure.
8. A Plugin checkout with ignored extra files, assume-unchanged or skip-worktree entries is refused (plain `git status` can be fooled by them): always use a fresh clone of the pinned commit.
9. The detection of a "re-plug" on this Mac relies on macOS registering the stick again (a new IORegistry entry); where that is not available the tool asks for a typed confirmation and records that it rests on the owner's word.
