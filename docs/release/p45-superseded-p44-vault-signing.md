# SUPERSEDED for key custody: the P44 encrypted-vault signing path (P45)

Written 2026-11-22 (UTC), P45.

**Status: the P44 encrypted-DMG vault is SUPERSEDED for custody of the release-signing keys.** The owner lost both vault passphrases, so both signing keys are being replaced. Custody is now the possession-based, passwordless USB model (`docs/release/usb-signing-threat-model.md`); the approved signing command is `infra/release/sign-plugin-release-usb.sh` (`docs/release/OWNER-SIGNING-COMMAND-USB.md`); keys are made by `infra/release/usb-key-ceremony.sh`.

What this means:

* Do NOT use `hdiutil attach` on the old vaults for signing, do not search for their passphrases, and do not add the old public keys (`yCsFX6176Ue5...` primary, `5p50qA1SYMTV...` standby) to any new trust anchor, Plugin build or handover. The old keys confer no trust any more; a build that bakes the new keys rejects a signature made by an old key (tested in `infra/stack-tests/test_p45_usb_signing.sh`, section F).
* The old vault files (`aicc-keys-primary.dmg`, `aicc-keys-standby.dmg`, the copies in `AICC-SIGNING-BACKUP` on the old sticks) stay where they are, untouched, as legacy artifacts.
* `infra/release/sign-plugin-release.sh` (the P44 wrapper) stays in the repository for LEGACY and THROWAWAY use: it signs with a key FILE named by `AICC_RELEASE_SIGNING_KEY_FILE` and keeps its refusals (mode 0600 and owned by you, clean checkout at the pinned commit, ZIP/manifest values, no overwrite). It is not the owner's signing command any more, and it cannot be used with a FAT32 stick (it refuses a key file whose mode is not 0600, which FAT32 cannot provide). The tests that use it (`test_verify_published.sh`) are unchanged.
* The publication tooling is unchanged and needs no change: `publish-plugin-release.sh` (including the production trust-anchor gate), `verify-published-plugin.sh`, `first-signed-release.sh`, `check-host-signing-keys.sh` and `yank-plugin-release.sh` verify the SIGNATURE and the TRUST ANCHOR, not how the signature was produced. The suite proves it: the offline release verifier accepts a USB-made signature.
* The P44 owner package `OWNER-SIGNING-PACKAGE-1.1.4.md` (vault steps) is superseded by the P45 owner documents; it must not be run.
