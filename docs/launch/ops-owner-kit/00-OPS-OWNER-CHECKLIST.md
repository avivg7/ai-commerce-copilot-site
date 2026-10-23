# OPS owner checklist (kit A): keys, monitoring, 24/7 watcher. About 3 sessions, 2.5 hours in total.

Rule for every step: secrets (private keys, bot tokens, passphrases) go only into a hidden prompt, a vault or a password manager. Never into chat. Claude asks you only for PUBLIC values (public keys, fingerprints, certificate fingerprint, a yes/no that an email arrived).
Everything here is free. Nothing here touches www, the apex, api.copilt.org, the API Droplet, Neon, Render, DigitalOcean billing or DNS. Detail lives in the three packages next to this file.

## Before you start (once, 10 min)
- [ ] Two USB sticks, kept later in two different places; a password manager; Mac with FileVault ON (it is); Telegram on your phone; DigitalOcean console login; GitHub login with 2FA (only if you choose the sentinel option B).
- [ ] Decide: sentinel = **B** (public GitHub repo + Actions, recommended in `03`) or A (Mac only, "not 24/7"). Decide the first plugin version (recommend 1.1.0).

## Dependency order and time

| # | Session | Do this | Time | Needs first | Unblocks | What Claude does right after (needs only public values) |
|---|---|---|---|---|---|---|
| 1 | **Keys** (`01`) | A1-A3 two encrypted key vaults on the sticks, generate primary + standby Ed25519 straight onto them, 2nd copy in the password manager, check fingerprints | 40 min | sticks, password manager | A4, A5; promotion 6.10 | nothing yet |
| 2 | Keys | A4 put `UPDATE_PUBLIC_KEYS=<primary>,<standby>` into the Plugin `release/endpoints.conf`, commit; A5 test-sign + tamper with the REAL keys on a scratch build | 15 min | step 1 | the updater, CP launch gate 5g, signed publish | You send the 2 public keys + fingerprints: Claude commits them on a Plugin branch, bumps version/notes, reruns the Plugin build/updater/e2e suites and the Site publish tests, prepares the CP `AICC_LM_PLUGIN_SIGNING_PUBKEYS` line and the website fingerprint text |
| 3 | Keys | B1-B3 RSA 4096 backup key on a vault, copy ONLY the `.crt` to `~/.config/aicc/backup-recipient.crt`, switch the pull agent to `--encrypt-to`, run one decrypt test; B5 clean old plaintext copies | 25 min | step 1 (vault know-how) | the production LaunchAgent (mandatory encrypt-to), restore drills | You send the certificate fingerprint + expiry: Claude records it, prints the exact production pull/installer lines for promotion, re-runs `infra:test` |
| 4 | **Monitoring** (`02`) | Two Telegram bots (Ops + Sentinel) via @BotFather, press Start on both | 5 min | Telegram | steps 5, 8 | nothing |
| 5 | Monitoring | On the host: `sudo aicc-ops-secrets set-telegram` (hidden prompt), chat-id discovery, `telegram-send-test --send`, WARNING/RECOVERED/dedupe test, leak audit | 20 min | step 4, a host ssh session (`stage-ssh` today) | live alert delivery; promotion gate "Telegram verified" | Reads the loopback alert history over read-only ssh and confirms FIRING/RECOVERED rows; updates `alerting.md` from "never delivered" to observed facts. Cannot see your Telegram inbox |
| 6 | Monitoring | DigitalOcean console: 4 policies on `aicc-cp-stage` only (CPU 85%/30m, memory 85%/10m, disk 75%/10m, load5 3/30m), temporary `aicc-test-disk` (disk > 5%, 5 min), wait for the email, delete it | 20 min (mostly waiting) | DO login | independent notification path; promotion gate | You say "email arrived, test policy deleted": Claude records it. Cannot see the console or your inbox |
| 7 | **Sentinel** (`03`) decision | Read the comparison, answer B / A | 10 min | - | step 8 | If A: Claude rewrites the docs to "Mac-only, not 24/7" |
| 8 | Sentinel (B) | `prepare-sentinel-repo.sh` -> `sentinel-phase.sh --phase stage` -> `git init` -> **`gh repo create --public` (your decision)** -> 2 secrets (hidden prompt) -> `gh workflow run aicc-sentinel -f send_test=true` -> check a scheduled run succeeded; calendar reminder every 45 days | 25 min | steps 4-5, GitHub login | 24/7 outside view; promotion observer step | You paste the run list (no secrets): Claude computes real scheduler skew after 24 h and updates `alerting.md`; at promotion/cutover Claude names the phase switch (`--phase dark` / `--phase www`) |

Suggested sessions: **Session 1** = rows 1-3 (80 min). **Session 2** = rows 4-6 (45 min; row 6's wait overlaps row 5). **Session 3** = rows 7-8 (35 min).
Hard dependencies only: 4 before 5 and 8; 1 before 2 and 3; everything else is independent.

## Where each result is required later (so you know the deadline)
- Before `production-promotion.md` T-3d: rows 4-6 (Telegram verified + DO policies confirmed by the test email: `production-promotion.md` section 6 item 1 and its final checklist row 10).
- Before step 6.10 (first signed plugin release) and before launch: rows 1-2 (without them no store is offered updates and the CP launch gate blocks).
- Before the production LaunchAgent is installed: row 3 (production refuses to run without `--encrypt-to`).
- Before the DNS cutover: row 8 (or the explicit decision that nothing external watches while the Mac sleeps).

## Done means
- [ ] 2 public keys committed in `release/endpoints.conf`; real test-sign verified and 3 tamper checks rejected; both secrets exist in 2 places each (stick vault + password manager), sticks in different places.
- [ ] Backup certificate on the Mac (no private key on the Mac: `grep -c PRIVATE ~/.config/aicc/backup-recipient.crt` prints 0), one `.cms` decrypted successfully, old plaintext copies removed.
- [ ] `[TEST]`, `[WARNING]`, `[RECOVERED]` received in Telegram; leak audit `RESULT: CLEAN`; four DO policies listed, test policy deleted, email received.
- [ ] Sentinel: `[TEST]` received from GitHub Actions, scheduled runs green, day-45 reminder set (or the written decision to run Mac-only).

## What stays open after this kit (not in this checklist)
A second always-on backup copy (the Mac copy is only as available as the Mac), real SMTP/SPF/DKIM, payments, DNS, Backend/Neon cutover gates G0-G12, production promotion approval: see `~/Downloads/AICC-launch-evidence/integration/LAUNCH-READINESS-2026-10-23.md`.
