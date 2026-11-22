# Owner key ceremony: make the two signing keys on two USB sticks (no password, anywhere)

Written 2026-11-22 (UTC), builder A, P45. OWNER-ONLY procedure. It replaces the lost-passphrase vaults of P44. Every command below was rehearsed on THROWAWAY disk images (`infra/stack-tests/test_p45_usb_signing.sh`); nothing here has been run on your real sticks, and no real key exists yet.

**There is no password in this procedure.** You never type a passphrase. The only thing you type is a short CONFIRMATION sentence that the tool prints (it is not a secret). The key is a plain file on the stick: **whoever holds the stick can sign** (`docs/release/usb-signing-threat-model.md`; read section 2 and 4 once).

How to read this: **type `bash` and press Enter first, and stay in that bash window for the whole ceremony of one key** (the Mac's default zsh does not accept `#` comment lines and treats some constructs differently; the blocks below contain no comments, but every command is meant for bash). Run each numbered paste as a SEPARATE paste, in order. If a command prints `REFUSED` or `FAILED`, STOP and send me the text (it never contains a secret).

## 0. Decide which sticks, once (the final choice is yours)

**My recommendation: use two NEW dedicated sticks (Option A) whenever you can.** Option B (KEY_1 = Primary, KEY_2 = Standby, a NEW folder only, the old vault copies untouched) is supported and tested (including a stick that carries the old vault file and its macOS `._` sidecar), but it is second best. You decide.

The existing `KEY_1` and `KEY_2` hold the OLD encrypted vault copies (folder `AICC-SIGNING-BACKUP`). Those vaults confer no trust any more and this procedure never touches, deletes or opens them (it only names top-level entries in a summary and says they are not touched). A legacy macOS `._aicc-keys-*.dmg` file at the stick's root is also never touched.

| Option | What | Trade-off |
|---|---|---|
| **A. Two NEW dedicated sticks** (recommended) | Buy/assign two new sticks; Primary on one, Standby on the other. | Cleanest: nothing legacy on the signing sticks, nothing to confuse at 2 a.m., old vaults retire separately. Costs two sticks. |
| **B. KEY_1 = Primary, KEY_2 = Standby** (supported) | The tool creates a NEW folder `AICC-RELEASE-SIGNING` next to the old folders. Old vault folders and their `._` files stay, byte for byte. | No purchase. The sticks then carry the old encrypted vaults too: losing a stick also loses those (encrypted, passphrase lost, so useless to a thief but also to you), and the legacy folder invites a wrong-folder mistake. The tool never deletes anything, so the clutter stays until YOU decide. |

**Verified read-only on 2026-11-22 (by the coordinator, with `usb_tools.py classify --usb`, no contents read, nothing written): both `KEY_1` and `KEY_2` classify as acceptable sticks** (`bus_protocol USB`, `internal False`, `removable yes`, filesystem `msdos` with `noowners`, no USB serial reported). Because no serial number is reported, the volume UUID is the ONLY per-stick identifier; it catches a wrong or look-alike stick, nothing more.

Rules for either option: Primary and Standby on DIFFERENT sticks (the tool refuses to put both on one); only ONE stick plugged in at a time during this ceremony; the label printed on the stick is only a label. **The stick is identified by the KEY on it** (the public key derived from the private key); the label, the volume UUID and the device only catch mistakes (a wrong or look-alike stick), they authenticate nobody.

Tell me your choice before you start (it changes nothing in the commands except the stick name you pass).

## 1. Prerequisites (two separate pastes)

Paste 1a, tools:

```bash
php -m | grep -iE '^(sodium|zip)$'
python3 --version
git --version
```

It must print BOTH `sodium` and `zip` (in any order), then the versions. A missing one means STOP.

Paste 1b, GitHub access (its own paste, because the clone in section 2 needs it):

```bash
gh auth status
```

It must say you are logged in to github.com. If it does not, run `gh auth login`, choose HTTPS and follow the prompts, then repeat `gh auth status`. Never put a token in a command, a file or a screenshot.

## 2. The tools and the Plugin checkout that makes the key

The key is made by the Plugin's own signing tool (`bin/sign-release.php keygen`, libsodium randomness). Use a checkout YOU fetched.

Paste 2a, variables:

```bash
SITE=/Users/avivgerman/self_projects/ai_copilot_site-worktrees/p45-usb-signing
PLUGCOMMIT=4dc755842c87628e1e0dacca6350f275150f9ee7
PLUG="$HOME/aicc-sign-plugin-$PLUGCOMMIT"
```

Paste 2b, the clone (its own paste: if git asks for credentials, answer there; no other line can be swallowed by the prompt):

```bash
if [ -d "$PLUG/.git" ]; then git -C "$PLUG" fetch --tags origin; else git clone https://github.com/avivg7/ai-commerce-copilot-plugin.git "$PLUG"; fi
```

Paste 2c, the checkout and the checks (every line prints OK or STOP):

```bash
git -C "$PLUG" checkout --detach "$PLUGCOMMIT"
[ "$(git -C "$PLUG" rev-parse HEAD)" = "$PLUGCOMMIT" ] && echo "OK: Plugin HEAD is the pinned commit" || echo "STOP: Plugin HEAD is not the pinned commit"
[ -z "$(git -C "$PLUG" status --short --ignored)" ] && echo "OK: Plugin checkout is clean" || echo "STOP: Plugin checkout is not clean"
git -C "$SITE" rev-parse HEAD
[ -z "$(git -C "$SITE" status --short)" ] && echo "OK: Site checkout is clean" || echo "STOP: Site checkout is not clean"
```

The `git -C "$SITE" rev-parse HEAD` line must print the Site commit the coordinator's message gives you; if it differs, STOP. `PLUGCOMMIT` only needs to be a commit that contains `bin/sign-release.php`; the coordinator will tell you if another one should be used.

## 3. PRIMARY key

**3.1 Plug in the PRIMARY stick only** (nothing else removable; the Standby stick stays in its place). Then:

```bash
ls /Volumes
```

Find the stick's name in the list (not `Macintosh HD`). Use it below as `STICK="/Volumes/<NAME>"` (quote it if it has spaces).

**3.2 Preflight (a look: it changes nothing on the stick except ONE temporary probe file at the stick's root, which it deletes again; it formats nothing and deletes nothing else).** The probe file (`.aicc-probe.<number>`) is how the tool checks whether the filesystem enforces permissions (a `chmod` round trip); if macOS adds a `._` sidecar for it, that is removed too.

```bash
STICK="/Volumes/<NAME>"
bash "$SITE/infra/release/usb-key-ceremony.sh" preflight --usb "$STICK" --role primary
```

Expected (values differ): `physical USB, removable : yes (diskutil: protocol USB, internal=False ...)`, the filesystem `MS-DOS FAT32 (msdos)`, the volume UUID, free space, `POSIX permissions enforced : no` followed by the SECURITY LIMITATION lines (that is the known FAT32 limitation: possession is the only control), a list of names already on the stick, and, on KEY_1/KEY_2, `this stick already holds AICC-SIGNING-BACKUP / vault copies ... NOT touched`. It ends with `PREFLIGHT OK`.

**GATE 1: stop and tell me if** it says `REFUSED` (not a physical USB, read-only, no space, a key already there, ...), if `protocol` is not `USB`, or if the stick shows content you do not recognise. Otherwise continue. (If the stick is unsuitable the tool stops; it never formats. Choosing another stick is your decision.)

If `preflight` refuses a REAL stick that you believe is fine (for KEY_1 and KEY_2 this should not happen: see the read-only verification in section 0), do not try to work around it: run `diskutil info -plist "$STICK" > /tmp/stick-facts.plist` and send me only the lines of `plutil -p /tmp/stick-facts.plist` that start with `"BusProtocol"`, `"Internal"`, `"Removable"`, `"RemovableMedia"`, `"Ejectable"`, `"FilesystemType"`, `"VolumeName"` (public hardware facts, no contents); I will adjust the tool. Never send the stick's file listing or the volume's contents.

**3.3 Generate the key** (you type one sentence; the tool prints it).

```bash
bash "$SITE/infra/release/usb-key-ceremony.sh" generate --usb "$STICK" --role primary --plugin-dir "$PLUG" --plugin-commit "$PLUGCOMMIT"
```

It asks you to type `GENERATE PRIMARY KEY ON <first 8 characters of the volume UUID>`; copy it exactly and press Enter. Expected at the end: `GENERATED`, the **public key** and **fingerprint**, `public key re-derived independently : libsodium ... = independent pure-python RFC 8032 = OpenSSL`, `offline signing smoke test : ok`, `AppleDouble (._*) sidecars on the stick: none`, the handover file path (default `~/AICC-KEY-HANDOVER/aicc-release-primary.handover.json`), then `NOT COMPLETE YET`. The key itself is never printed.

**3.4 Eject, unplug, plug in again, verify.** The ceremony is NOT complete until this passes after a re-plug.

```bash
diskutil eject "$STICK"
```

Unplug the stick, wait five seconds, plug it in again, then `ls /Volumes` (the name may change; update `STICK`) and, using the public key printed in 3.3:

```bash
PUB='<the public key printed by generate, ending with =>'
bash "$SITE/infra/release/usb-key-ceremony.sh" verify --usb "$STICK" --role primary --expect-pubkey "$PUB"
```

Expected: a list of `[ ok ]` lines (key present at the fixed path, independently re-derived, equals the expected key, signs a probe message, identity file agrees, volume UUID agrees, no `._*` files), then `PASS: every check passed AFTER a re-mount (macOS registered the stick again ...)`. That line is the only thing that completes the ceremony: it writes `ceremony_verified_after_replug` into the handover file.

* If it prints `PASS (content) but the ceremony is NOT COMPLETE: macOS has not registered an unplug/re-plug`, you did not really remove it: eject, unplug, re-plug and run it again (exit code 4).
* If it says the Mac gives no reliable evidence of a re-mount and asks you to type `I EJECTED AND RE-PLUGGED THE STICK`, type it only if you did; it is then recorded as resting on your word.
* **GATE 2: if anything prints `FAIL`, stop, do not use that stick, and tell me.**

**3.5 Physical custody now.** Eject the stick (`diskutil eject "$STICK"` if it is mounted again), unplug it, label it "AICC primary" with a pen (not the key), and put it in its storage place (section 6). Do not leave it in the Mac.

## 4. STANDBY key (a DIFFERENT stick; same four steps)

Plug in only the STANDBY stick (the primary stays in its place). Repeat 3.1 to 3.5 with these differences: `--role standby`, the phrase becomes `GENERATE STANDBY KEY ON <first 8 of the UUID>`, the handover file is `aicc-release-standby.handover.json`, and `verify --role standby --expect-pubkey '<standby public key>'`.

If the tool says the stick holds the other role's key, you grabbed the wrong stick: STOP.

## 5. What to send me (only this; it contains no key)

```bash
cat ~/AICC-KEY-HANDOVER/aicc-release-primary.handover.json ~/AICC-KEY-HANDOVER/aicc-release-standby.handover.json
```

Paste the output to me. It holds: role, public key, fingerprint, volume UUID, volume label, created time, and `ceremony_verified_after_replug` (must be a date, not `null`, for both). Safe-to-send check: a public key is 44 characters ending in `=`. If you see any line that is 80+ characters of letters and digits, do not send it and tell me. **Never send, paste, photograph or copy the stick's key file.** A screenshot of the terminal output of generate/verify is also fine (they contain no key).

## 6. Backups, storage, and what needs approval

* **No backup is required.** If the Primary stick is destroyed (not stolen), the Standby signs a rotation release (`docs/release/usb-signing-threat-model.md`, section 4). A backup only avoids that rotation, and every copy is one more stick that can be lost or stolen.
* **If you want one**: `bash "$SITE/infra/release/usb-key-ceremony.sh" backup-plan` prints the options (it executes nothing). A real backup (`... backup --from-usb <A> --to-usb <B> --role primary`) copies ONE key to ANOTHER dedicated stick after a typed confirmation, verifies the copy, and refuses the same device, an internal/cloud/repo destination, or a destination holding the other role's key. **Do not run it before telling me and getting my yes** (it is a product decision with a security cost).
* **Never**: a copy on the Mac, in iCloud/Dropbox/Google Drive, in a photo, in a password manager, in a chat or e-mail, printed on paper (not recommended without a threat model), or on the other key's stick.
* **Storage**: Primary and Standby in DIFFERENT places (for example office safe and a bank box or home safe), never together, never in the Mac, never plugged in except for a signing (a minute). If a stick is lost or you are unsure where it has been: treat it as stolen and tell me the same day (rotation plan, threat model section 4).

## 7. What remains for engineering after you send the handover (nothing for you until the signing day)

1. I bake the two new public keys into the Plugin (`release/endpoints.conf`, primary first) and rebuild 1.1.4 (new commit, new ZIP); the old keys do not appear anywhere.
2. The production trust anchor `AICC_LM_PLUGIN_SIGNING_PUBKEYS` is updated to the new pair through the owner-facts procedure (a gated production step: I will ask for your approval of that step; the publisher refuses to publish until it is done).
3. I render your ready-to-paste signing command from the facts (`infra/release/render-owner-signing-command.sh`: the real SHA-256, commit, fingerprint, volume UUID) into `OWNER-SIGNING-COMMAND-USB.md`.
4. On the signing day you plug in the PRIMARY stick, paste the block, type one confirmation phrase, eject, and send me the public `.manifest.sig`.
5. I publish with the existing tooling (dry run first, your approval of the production step), verify the customer path end to end, and the old vaults stay as legacy files.
