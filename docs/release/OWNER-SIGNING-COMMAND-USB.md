# Sign a Plugin release with the PRIMARY USB stick: the single approved command (owner)

Written 2026-11-22 (UTC), builder A, P45. Passwordless: you type no password and no passphrase; the only thing you type is the confirmation sentence the tool prints. **This file is a TEMPLATE until the rebuilt 1.1.4 exists**: every `<...>` below is filled from facts by `infra/release/render-owner-signing-command.sh` (section 3); do not run it with placeholders. The key ceremony (`OWNER-KEY-CEREMONY-PASSWORDLESS-USB.md`) must be complete first (both handover files show `ceremony_verified_after_replug`).

## 1. The release (placeholders: filled from the rebuilt candidate and the handover)

| Item | Value |
|---|---|
| Version | `<VERSION>` (e.g. 1.1.4) |
| Plugin commit (full, 40 hex) | `<PLUGIN_COMMIT>`: the rebuilt candidate's commit (it bakes the NEW keys; it is NOT 4dc7558, which baked the old keys) |
| ZIP, manifest | `<RELEASE_DIR>/ai-commerce-copilot-<VERSION>.zip` and `.manifest.json` |
| ZIP SHA-256 (full) | `<ZIP_SHA256>` |
| Primary key | fingerprint `<PRIMARY_FP>`, public key `<NEW_PRIMARY_PUBKEY>`, from the primary handover file |
| Standby key (emergency or rotation only; never for a normal release) | fingerprint `<STANDBY_FP>`, public key `<NEW_STANDBY_PUBKEY>` |
| Primary stick volume UUID (from the handover) | `<PRIMARY_VOLUME_UUID>` |
| Site tools commit | `<SITE_COMMIT>` (branch `feat/p45-usb-signing`) |

Reference to the generated candidate: `<PATH TO THE GENERATED CANDIDATE FOLDER>`. If your computed SHA-256 differs from the table or from the coordinator's message by one character: STOP.

## 2. The command shape (this is the only signing command)

```
bash "$SITE/infra/release/sign-plugin-release-usb.sh" \
  --usb "/Volumes/<STICK NAME>" --role primary --plugin-dir "$PLUG" \
  --zip "$F/ai-commerce-copilot-$V.zip" --manifest "$F/ai-commerce-copilot-$V.manifest.json" \
  --version "$V" --sha256 "$SHA" --commit "$COMMIT" \
  --primary-fp "$PRIMARY_FP" --expect-volume-uuid "$VOLUME_UUID" --eject
```

Plug in the PRIMARY stick only. The rendered block (section 3) has three pastes: variables + clean checkout (with its checks), find the stick (`ls /Volumes`, `diskutil info` shows the Volume UUID and Protocol USB), the command. The trusted public-key list is read from the checkout's `release/endpoints.conf` (primary first); the baked list of the ZIP must equal it.

What the command proves before it signs (any failure: `REFUSED`, exit 3, nothing written): the volume is a physical removable USB stick judged by the device and not the label; the volume UUID equals the stick's identity file AND `--expect-volume-uuid`; the key file is at the fixed path (a regular file, not a symlink); the public key derived from the private key equals the PRIMARY key of the list (a standby key is refused) and its fingerprint equals the identity file and `--primary-fp`; the Plugin checkout is clean at exactly `--commit`; the ZIP's size and SHA-256 and the manifest's values equal the approved release, and the manifest was built from that commit; no signature exists yet. It then asks for the typed phrase `SIGN <VERSION> <first 8 of the ZIP SHA-256>`, signs, verifies with the zip-aware strict verify, runs the tamper controls and a wrong-key control, prints the signature file path and SHA-256, and ejects the stick (`--eject`).

Expected output (times and values differ):

```
== USB signing: <VERSION>, role primary ==
  stick: physical USB (diskutil: USB), label '<name>' (NOT trusted), volume UUID <uuid>, device /dev/diskNsM, filesystem MS-DOS FAT32
  WARNING: this filesystem (MS-DOS FAT32, mount flags: ...noowners...) does NOT enforce file permissions: anyone who holds this stick can sign releases. Possession is the ONLY protection.
  key: the public key derived from the private key is the primary key of the trusted list (fingerprint <PRIMARY_FP>); the identity file agrees
  To continue, type exactly this phrase and press Enter (anything else stops here):
      SIGN <VERSION> <sha8>
  >
SIGNED  <VERSION>  key <PRIMARY_FP>  (the primary, from the USB stick)
  verified: <VERSION> signed <UTC time> by key <PRIMARY_FP>      (four lines)
  tamper control: a manifest one byte larger is NOT accepted by this signature; a ZIP one byte larger is NOT accepted by the zip-aware verify
  wrong-key control: a signature by a throwaway key is NOT accepted against the trusted list
  signature file (public, not secret): <RELEASE_DIR>/ai-commerce-copilot-<VERSION>.manifest.sig
  sha256 of the signature file: <SIGFILE-SHA>
Next: hand ONLY the .manifest.sig to the coordinator. The stick was only read; nothing was written to it.
Ejected /Volumes/<name>: unplug the stick and put it back in its place.
```

The WARNING line is expected on FAT32. Afterwards unplug the stick and put it back in its place; send me ONLY the `.manifest.sig` (public).

If it prints `REFUSED`: read the reason, fix nothing by guessing, and send me the text. Never edit the stick, the checkout or the ZIP to "make it pass". Do not run it twice for the same release (a second run refuses: a signature already exists).

## 3. Render the ready-to-paste block from facts (engineering step, once the rebuild exists)

```
bash infra/release/render-owner-signing-command.sh \
  --manifest <RELEASE_DIR>/ai-commerce-copilot-<VERSION>.manifest.json --zip <RELEASE_DIR>/ai-commerce-copilot-<VERSION>.zip \
  --handover ~/AICC-KEY-HANDOVER/aicc-release-primary.handover.json --standby-handover ~/AICC-KEY-HANDOVER/aicc-release-standby.handover.json \
  --plugin-commit <PLUGIN_COMMIT> [--site-dir <Site checkout>] [--site-commit <sha>]
```

It prints the whole block with the real fingerprint, SHA-256, commit and volume UUID. It refuses (exit 3) a manifest that is not `dirty:false` or was not built from `--plugin-commit`, a ZIP that differs from the manifest, and a handover whose `ceremony_verified_after_replug` is empty (the ceremony must be complete first). Paste its output into the final owner package; the only value the owner substitutes is the stick's mount name (`/Volumes/<NAME>`), and the command checks the stick's UUID, not its name.

## 4. Emergency (not part of a normal release)

Only with my explicit instruction (primary lost, stolen or destroyed): `--role standby --emergency-standby --standby-fp <STANDBY_FP> --emergency-reason "<why>"` with the STANDBY stick; it has its own typed phrase (`SIGN <VERSION> <sha8> WITH THE STANDBY KEY`) and prints EMERGENCY in its result. The rotation procedure is in `docs/release/usb-signing-threat-model.md`, section 4.
