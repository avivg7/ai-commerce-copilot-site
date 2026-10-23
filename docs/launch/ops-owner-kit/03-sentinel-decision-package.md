# Package 3: 24/7 SENTINEL DECISION PACKAGE (decision 10 min; if you say yes, setup about 25 min)

Verified against heads: Site 914fade CP 7d61559 Plugin c879b4a Backend 1f99cc0 (2026-10-23).

The question: who notices, at 3 a.m., that `www.copilt.org` is unreachable (Droplet dead, DNS wrong, certificate expired, firewall mistake) when AICC Ops and the DigitalOcean policies die or stay silent with the host? Today the only thing outside the host is the Mac LaunchAgent sentinel, which does nothing while the Mac sleeps.

## Recommendation (one option)

**Option B: a small dedicated PUBLIC GitHub repository with a scheduled GitHub Actions workflow, probing one public URL every 10 minutes, with Telegram AND GitHub's own failed-run email as the two alert paths. Keep the Mac sentinel as a second observer.**

Why, in one paragraph: it is the only option that is free, independent of DigitalOcean and of your Mac, already built, and now PROVEN end to end locally (29 scenario checks against a stand-in target and a fake Telegram, plus 21 staging checks); its weaknesses are known and bounded (best-effort timing, a 60-day inactivity switch-off, a public repository whose only public facts are already public in DNS); and the extra independent email path I added removes its worst weakness (everything depended on Telegram).

## The options compared

| Criterion | A. Mac-only (as built) | B. Public repo + Actions (RECOMMENDED) | C. Alternatives already available (no new paid) |
|---|---|---|---|
| Independence from DigitalOcean | yes | yes (GitHub-hosted runners) | C1 private-repo Actions: yes. C2 sentinel on the CP/staging Droplet: NO (same provider, dies with the host). C3 run `sentinel.py` in loop mode on another always-on machine you own: yes, but you must have and maintain one |
| Uptime of the observer | NOT 24/7: asleep/shut/offline Mac = blind; an outage that starts and ends while it sleeps is never seen; FileVault pre-login or logout stops LaunchAgents | best effort: GitHub says the schedule "can be delayed during periods of high loads of GitHub Actions workflow runs", shortest interval 5 min, runs only from the default branch. Real skew is UNKNOWN until it runs (measure after 24 h) | C1 same as B but a billing quota. C3 as good as the machine |
| Detection time | ~6 min when awake (120 s probe, 3 of 5) | nominal 20 min (2 of last 3 runs at a 10-minute cadence), realistic 20-40 min. A "down for a while" alarm, not an SLA | C1 at a 30-min cadence: 60-90 min |
| Privacy / repository exposure | local only | the repo, `targets.toml` (host name, Reserved IP, one URL: all public DNS facts) and run logs (state changes only) are PUBLIC. I found and fixed one leak while proving it: the owner guide `infra/sentinel/github/README.md` names the private repos and the old-site rollback tag and was being copied as the public README; the staged repo now ships a short `PUBLIC-README.md` instead (checked: no local path, name or secret in any of its 5 files) | C1: private (nothing public). C2/C3: none |
| Secrets | `~/.config/aicc-sentinel/secrets.env` (0600) on the Mac | two Actions secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`); not in the repo, not in forks (workflow has no pull_request/issues/push trigger), masked in logs; proven: the token never appears in run output or state | same as the chosen host |
| Reliability facts | simple, proven | state window kept in `actions/cache` (if evicted, a DOWN can be delayed by a couple of runs; a false DOWN cannot be created); failed Telegram delivery does not break the run | C1: when the free quota (2,000 min/month on GitHub Free) is used up, usage is blocked without a payment method, and BILLED ($0.006/min for Linux) with one: do not use C1 if a card is on the account |
| Maintenance | none, but the Mac must stay awake and logged in | GitHub disables schedules of a PUBLIC repo after 60 days without repository activity ("In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days"); the docs do not say whether you are told. Day-45 calendar reminder (one empty commit, or `gh workflow enable`), pinned action SHAs re-pinned deliberately once a year | C1: no 60-day rule (public-only), but the quota |
| Telegram dependency | yes (plus macOS notification) | Telegram message AND the workflow run FAILS while a target is DOWN, so GitHub emails you (workflow notifications go to the user who created the workflow; email/web; you can limit them to failures: docs.github.com "Notifications for workflow runs", read 2026-10-23). Check your GitHub notification settings once (UNVERIFIED for your account) | same as B for C1 |
| Owner burden | 0 now; ongoing: keep the Mac awake | once: 25 min; yearly: re-pin; every 45 days: 2 min | C2: 30 min on the host (and it still has the single-provider flaw); C3: a machine you do not have |
| Cost | $0 | $0 (GitHub: "GitHub Actions usage is free for ... public repositories that use standard GitHub-hosted runners", billing docs read 2026-10-23) | $0 / quota |

Not evaluated in depth (new third-party accounts, nothing in the repo supports them): UptimeRobot, Better Stack, Healthchecks.io (`alerting.md` section 4 has the 2026-10-22 notes; terms/channels unverified). Rejected: the existing public site repo `avivg7/ai-commerce-copilot-site` (already past the 60-day mark and its `main` is the live old site: a push there can redeploy www) and the private AICC repos.

If you refuse any public repository: take A plus "Mac plugged in, never sleeps" (`sudo pmset -c sleep 0` on a desktop/always-on Mac; your decision) and write down that a whole-host outage while the Mac is off is detected by nothing external except DigitalOcean's missing metrics.

## What I changed to make B good (merged into Site `launch/integration`, all tested)

1. `infra/sentinel/github/aicc-sentinel.workflow.yml`: `--fail-on-down` (the run fails, GitHub emails you, independent of Telegram; repeats each run while down, ~6/hour; delete the flag if you prefer Telegram only) and a manual `send_test` input (`gh workflow run aicc-sentinel -f send_test=true` sends ONE `[TEST]` message and probes nothing: proves the two secrets without waiting for an outage).
2. `infra/sentinel/github/PUBLIC-README.md` + `prepare-sentinel-repo.sh` installs it as the public README (see above).
3. `scripts/sentinel-phase.sh` (kit): rewrites the single target per phase so the sentinel is useful from day one and never pages for a URL that is not live yet: `stage` (today: `https://stage.copilt.org/healthz`, answers 200 `ok`, Reserved IP) -> `dark` (during dark production: `https://api.copilt.org/health`) -> `www` (after the DNS cutover). Each switch is one commit (which also counts as repository activity for the 60-day rule).

Findings from the proof worth knowing (they are the sentinel's real behaviour, not bugs): DOWN means "2 of the last 3 runs failed", NOT "2 in a row" (blip, ok, fail inside 30 minutes DOES page); a second outage within the 60-minute cooldown of the previous DOWN notice sends NO second Telegram `[DOWN]` (flap protection) but the run still fails and GitHub still emails you; a single blip never pages.

## Proven vs not

PROVEN locally (`proof/sentinel-e2e-selftest.log`, re-run: `bash scripts/sentinel-e2e-selftest.sh --site-repo <Site checkout>`): the official `prepare-sentinel-repo.sh` output (5 files, checksums, no `.git`, byte-identical `sentinel.py`, no secret/path/name); `actionlint` clean; workflow structure (only schedule + workflow_dispatch, `contents: read`, both actions pinned to 40-hex SHAs, secrets only through `env:`, cron gaps >= 5 min); the exact workflow command line against a local stand-in target and a local fake api.telegram.org: healthy = silence, blip = silence, 2-of-3 = one `[DOWN]` with the failing stage and `observer: github-actions`, no repeat (cooldown), `[RECOVERED]`, 404 (the old site, pre-cutover) = DOWN at `http`, wrong body = DOWN at `body`, Telegram refusing = no crash and exit code 1, no secrets configured = exit code 1, `send_test` = one `[TEST]`, the fake token/chat id never in output, state or any file; three phase files all valid. Repo tests at Site 914fade: `npm run sentinel:test` 85/85, `ops:test` 339/339 (see SUMMARY).
NOT proven (needs your account and the internet): GitHub actually firing the cron and its real skew, the runner image's Python 3.12 (the workflow comment says ubuntu-24.04 ships it; unverified here), `actions/cache` across runs, GitHub's failure email reaching you, real Telegram delivery, the cron being switched off at day 60.

## If you say yes: the 25-minute setup (STOP markers: nothing here is done for you)

Prerequisites: a Telegram bot for the sentinel (package 2, BotFather) and your chat id (a private chat's id is the same for every bot you start; press **Start** on the new bot first), `gh` logged in, 2FA on the GitHub account (it will hold both secrets), no collaborators.
```bash
SITE=~/self_projects/ai_copilot_site-worktrees/launch-integration      # until launch/integration is landed
cd "$SITE"
bash "$SITE/infra/sentinel/github/prepare-sentinel-repo.sh" --out ~/aicc-sentinel-repo          # local only; or copy the pre-staged ~/Downloads/AICC-launch-evidence/owner-kit/A-ops/sentinel-repo-staged
bash "$SITE/docs/launch/ops-owner-kit/scripts/sentinel-phase.sh" --repo ~/aicc-sentinel-repo --phase stage    # watch stage.copilt.org until promotion
cd ~/aicc-sentinel-repo && git init -b main && git add -A && git commit -m "AICC external sentinel"
# STOP: next line creates a PUBLIC repository under your account (your decision, your name)
gh repo create <your-github-user>/aicc-sentinel --public --source . --push
gh secret set TELEGRAM_BOT_TOKEN --repo <your-github-user>/aicc-sentinel      # hidden prompt, paste the SENTINEL bot token, Enter
gh secret set TELEGRAM_CHAT_ID   --repo <your-github-user>/aicc-sentinel
gh workflow run aicc-sentinel --repo <your-github-user>/aicc-sentinel -f send_test=true       # expect the [TEST] message in Telegram
gh run list --repo <your-github-user>/aicc-sentinel --limit 3                                  # expect: completed / success; scheduled runs follow every ~10 min
```
Then: GitHub -> Settings -> Notifications -> Actions: make sure failed-run email/web is on (optionally "only failed workflows"). Add a calendar reminder every 45 days: "Actions tab shows green scheduled runs within the last hour; if it says disabled, re-enable and commit". Prove the DOWN path once (optional, 10 min): run `sentinel-phase.sh --phase stage` with a deliberately wrong URL path, commit, wait 25-40 minutes, expect `[DOWN]` and a failure email, then restore the phase and commit (expect `[RECOVERED]`). **ONE rule (same in production-promotion.md 6.4/10.2 and kit 05 B.3b/I.10):** the repository may be created any time before the promotion, on `--phase stage`. The promotion step `apply` RETIRES `stage.copilt.org`, so IMMEDIATELY after `apply` run `bash "$SITE/docs/launch/ops-owner-kit/scripts/sentinel-phase.sh" --repo ~/aicc-sentinel-repo --phase dark`, then `git -C ~/aicc-sentinel-repo commit -am "phase: dark" && git -C ~/aicc-sentinel-repo push`; if you skip this, the workflow (`--fail-on-down`) reports `stage-edge` DOWN and GitHub emails you about every 10 minutes. After the DNS cutover (kit 05 I steps 5 and 8 green): the same with `--phase www`. If you create the repository only after `apply`, start it on `--phase dark`. Remove everything: `gh repo delete <user>/aicc-sentinel`.

## After your steps: what Claude does immediately
Using only your report ("repo created", run URLs without secrets): checks via `gh run list --json` ONLY if you ask and approve the call (Claude does not hold your GitHub credentials); computes the real scheduler skew from run timestamps you paste; updates `alerting.md` sections 3-4 and the production-promotion observer step with the observed facts; if you decline B, rewrites those sections to the "Mac-only, not 24/7" wording.
