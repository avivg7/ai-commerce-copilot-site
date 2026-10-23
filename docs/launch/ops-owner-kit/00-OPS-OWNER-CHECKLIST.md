# OPS owner checklist (kit A): keys, monitoring, 24/7 watcher. About 3 sessions, 2.5 hours in total.

Verified against heads: Site 914fade CP 7d61559 Plugin c879b4a Backend 1f99cc0 (2026-10-23).

> **WARNING (public repository):** the Site repository's `origin` on GitHub is PUBLIC. The branch `launch/integration` carries this owner kit and `infra/`, `docs/cutover/` (server and Reserved IP addresses, private repository names, ssh and backup details). It must NEVER be pushed to `origin`. The release flow publishes only the built static site export. Safe options: a PRIVATE mirror repository (create it private first), pushing only the public marketing-site commit from a branch without `infra/` and `docs/cutover/`, or keeping it local plus `git bundle`. Check `git remote -v` and the repository's visibility before any push; Claude never pushes.

Rule for every step: secrets (private keys, bot tokens, passphrases) go only into a hidden prompt, a vault or a password manager. Never into chat. Claude asks you only for PUBLIC values (public keys, fingerprints, certificate fingerprint, a yes/no that an email arrived).
Everything here is free. Nothing here touches www, the apex, api.copilt.org, the API Droplet, Neon, Render, DigitalOcean billing or DNS. Detail lives in the three packages next to this file.
Paths: `SITE=~/self_projects/ai_copilot_site-worktrees/launch-integration` (until `launch/integration` is landed; never `launch-kitA` or `launch-infra`). Every relative `infra/...` / `scripts/...` command below is run from `cd "$SITE"` (from the home directory it fails with "No such file").

## Before you start (once, 10 min)
- [ ] Two USB sticks, kept later in two different places; a password manager; Mac with FileVault ON (it is); Telegram on your phone; DigitalOcean console login; GitHub login with 2FA (only if you choose the sentinel option B).
- [ ] Decide: sentinel = **B** (public GitHub repo + Actions, recommended in `03`) or A (Mac only, "not 24/7"). Decide the first plugin version (recommend 1.1.0).

## Dependency order and time

| # | Session | Do this | Time | Needs first | Unblocks | What Claude does right after (needs only public values) |
|---|---|---|---|---|---|---|
| 1 | **Keys** (`01`) | A1-A3 two encrypted key vaults on the sticks, generate primary + standby Ed25519 straight onto them, 2nd copy in the password manager, check fingerprints | 40 min | sticks, password manager | A4, A5; promotion 6.10 | nothing yet |
| 2 | Keys | A4 put `UPDATE_PUBLIC_KEYS=<primary>,<standby>` into the Plugin `release/endpoints.conf`, commit; A5 test-sign + tamper with the REAL keys in a scratch worktree (`-dev` test build only; the first customer version, recommended 1.1.0, is YOUR decision and no tool refuses a `-dev` version at publish) | 15 min | step 1 | the updater, CP launch gate rules 5h / 5h-1 (plugin download, signed updates), signed publish | You send the 2 public keys + fingerprints: Claude commits them on a Plugin branch, bumps version/notes, reruns the Plugin build/updater/e2e suites and the Site publish tests, prepares the CP `AICC_LM_PLUGIN_SIGNING_PUBKEYS` line and the website fingerprint text |
| 3 | Keys | B1-B3 RSA 4096 backup key on a vault, copy ONLY the `.crt` to `~/.config/aicc/backup-recipient.crt`, switch the pull agent to `--encrypt-to`, run one decrypt test; B5 plaintext staging copies are NOT deleted now (rule: only at T+14 d after promotion AND after a production encrypted set decrypts) | 25 min | step 1 (vault know-how) | the production LaunchAgent (mandatory encrypt-to), restore drills | You send the certificate fingerprint + expiry: Claude records it, prints the exact production pull/installer lines for promotion, re-runs `infra:test` |
| 4 | **Monitoring** (`02`) | Two Telegram bots (Ops + Sentinel) via @BotFather, press Start on both | 5 min | Telegram | steps 5, 8 | nothing |
| 5 | Monitoring | On the host: `sudo aicc-ops-secrets set-telegram` (hidden prompt), chat-id discovery, `telegram-send-test --send`, WARNING/RECOVERED/dedupe test, leak audit | 20 min | step 4, a host ssh session (`stage-ssh` today) | live alert delivery; promotion gate "Telegram verified" | Reads the loopback alert history over read-only ssh and confirms FIRING/RECOVERED rows; updates `alerting.md` from "never delivered" to observed facts. Cannot see your Telegram inbox |
| 6 | Monitoring | DigitalOcean console: 4 policies on `aicc-cp-stage` only (CPU 85%/30m, memory 85%/10m, disk 75%/10m, load5 3/30m), temporary `aicc-test-disk` (disk > 5%, 5 min), wait for the email, delete it | 20 min (mostly waiting) | DO login | independent notification path; promotion gate | You say "email arrived, test policy deleted": Claude records it. Cannot see the console or your inbox |
| 7 | **Sentinel** (`03`) decision | Read the comparison, answer B / A | 10 min | - | step 8 | If A: Claude rewrites the docs to "Mac-only, not 24/7" |
| 8 | Sentinel (B) | `prepare-sentinel-repo.sh` -> `sentinel-phase.sh --phase stage` -> `git init` -> **`gh repo create --public` (your decision)** -> 2 secrets (hidden prompt) -> `gh workflow run aicc-sentinel -f send_test=true` -> check a scheduled run succeeded; calendar reminder every 45 days. May be done any time BEFORE the promotion. **Then, IMMEDIATELY after the promotion `apply` (production-promotion.md 6.4 / kit 05 B.3b): `sentinel-phase.sh --phase dark`, commit, push** (`apply` retires `stage.copilt.org`; until you switch, `--fail-on-down` emails you every ~10 minutes), and `--phase www` after the DNS cutover (kit 05 I.10) | 25 min | steps 4-5, GitHub login | 24/7 outside view; promotion observer step | You paste the run list (no secrets): Claude computes real scheduler skew after 24 h and updates `alerting.md`; at promotion/cutover Claude reminds you of the phase switch |

Suggested sessions: **Session 1** = rows 1-3 (80 min). **Session 2** = rows 4-6 (45 min; row 6's wait overlaps row 5). **Session 3** = rows 7-8 (35 min).
Hard dependencies only: 4 before 5 and 8; 1 before 2 and 3; everything else is independent.

## Where each result is required later (so you know the deadline)
- Before `production-promotion.md` T-3d: rows 4-6 (Telegram verified + DO policies confirmed by the test email: `production-promotion.md` section 6 item 1 and its final checklist row 10).
- Before step 6.10 / kit 05 D (first signed plugin release) and before launch: rows 1-2 (NOT before the promotion `apply`; without them no store is offered updates and the CP launch gate rules 5h / 5h-1 block).
- Before step 6.8 / kit 05 F (the production LaunchAgent and first Mac pull): row 3 (production refuses to run without `--encrypt-to`).
- Right after the promotion `apply`: switch the sentinel repo to `--phase dark` (row 8). After step 6.8: REPEAT the Telegram check on the production host (REQUIRED, row 5 steps 5 and 7, label `aicc-cp-prod (production)`).
- Before the DNS cutover: row 8 (or the explicit decision that nothing external watches while the Mac sleeps), then `--phase www` after the cutover.

## Done means
- [ ] 2 public keys committed in `release/endpoints.conf`; real test-sign verified and 3 tamper checks rejected; both secrets exist in 2 places each (stick vault + password manager), sticks in different places.
- [ ] Backup certificate on the Mac (no private key on the Mac: `grep -c PRIVATE ~/.config/aicc/backup-recipient.crt` prints 0), one `.cms` decrypted successfully, the Mac's plaintext STAGING copies still there (deleted only at T+14 d after promotion and after a production encrypted set decrypts).
- [ ] `[TEST]`, `[WARNING]`, `[RECOVERED]` received in Telegram; leak audit `RESULT: CLEAN`; four DO policies listed, test policy deleted, email received.
- [ ] Sentinel: `[TEST]` received from GitHub Actions, scheduled runs green, day-45 reminder set (or the written decision to run Mac-only).

## What stays open after this kit (not in this checklist)
A second always-on backup copy (the Mac copy is only as available as the Mac), real SMTP/SPF/DKIM, payments, DNS, Backend/Neon cutover gates G0-G12, production promotion approval: see `~/Downloads/AICC-launch-evidence/integration/LAUNCH-READINESS-2026-10-23.md`.
