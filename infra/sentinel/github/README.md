# AICC sentinel on GitHub Actions: the only free, Mac-independent 24/7 observer (prepared, NOT published)

Nothing here has been published, enabled or pushed. Creating the repository and storing two secrets is **one owner gate**. Facts below were checked on 2026-10-22: the GitHub documentation pages quoted in the workflow header, and read-only `gh` calls (`gh auth status`, `gh repo view`, `gh repo list`, `gh api` for the action SHAs).

## What it is

A scheduled workflow in its **own small public repository** runs `sentinel.py` (the same standard-library sentinel the Mac LaunchAgent runs) every 10 minutes against **one public URL**, `https://www.copilt.org/healthz` (answered by Caddy itself: DNS + firewall + TLS certificate + the edge; no PHP, no database, no cookies). It expects HTTP 200, body `ok` and the Reserved IPv4 `206.189.248.204` in DNS, so a rollback of DNS to GitHub Pages or a hijack also shows up (stage `dns`). It sends `[DOWN]` / `[RECOVERED]` / certificate-expiry messages to Telegram through the repository's Actions secrets. DOWN needs 2 of the last 3 runs to fail (not necessarily consecutive), so one blip never pages. While a target is DOWN the workflow run itself FAILS (`--fail-on-down`), so GitHub also sends its own workflow-failure notification: a second alert path that does not depend on Telegram. A second DOWN within the 60-minute cooldown of the previous notice sends no second Telegram message (the failed run still notifies).

## Why a new repository and not `avivg7/ai-commerce-copilot-site`

| Fact (read-only `gh`, 2026-10-22) | Consequence |
|---|---|
| `avivg7/ai-commerce-copilot-site` is **PUBLIC**, default branch `main`, last push **2026-08-19** (64 days ago) | A scheduled workflow only runs from the default branch, and GitHub disables schedules of a public repository after 60 days without activity: this repo is already past that mark. |
| `main` of that repository is the **live old www site** (GitHub Pages deploy workflow) and the rollback artifact `old-site-rollback-815350b` | Pushing anything to its `main` can redeploy the live site. The cutover rules say never to merge into it. A sentinel commit there would be a change to the thing we are protecting. |
| The other repositories (`aicc-backend`, `aicc-control-plane`, `ai-commerce-copilot-plugin`, `aicc-recommendation-service`) are **PRIVATE** | A private repository's Actions minutes come from a quota (GitHub Free: 2,000 minutes per month): a 10-minute cadence is about 4,400 runs a month and would not fit; the free scheduled-minutes argument only holds for a public repository. Do not use them. |

So: a dedicated public repository, containing only `sentinel.py`, `targets.toml`, the workflow, a short **public** `README.md` (`PUBLIC-README.md` here; this owner guide names private repositories and must never be published) and `SHA256SUMS`. `prepare-sentinel-repo.sh --out DIR` stages exactly that directory (no network, no publishing).

## What is public (and what is not)

Public: the workflow file, `targets.toml` (the host name `www.copilt.org`, the Reserved IP, the URL `/healthz`), `sentinel.py`, and **the run logs** (public repository = public logs). Logs show state changes only (`--quiet-ok`) and the sentinel never prints a token, a chat id, a cookie or a response body. All of the public facts are already public through DNS and the site itself. Secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) are repository Actions secrets: not in the repository, not in forks, not in logs (GitHub masks them), reachable only by workflows of this repository. The workflow has no `pull_request*`/`issues`/`push` trigger, `permissions: contents: read`, and both actions are pinned to full commit SHAs.

Recommended: use a **separate Telegram bot** for the sentinel (BotFather `/newbot`, 1 minute), so revoking the GitHub-held token never touches AICC Ops, and the other way round.

## Owner steps (about 5 minutes; STOP: nothing is created before you run them)

```bash
bash infra/sentinel/github/prepare-sentinel-repo.sh --out ~/aicc-sentinel-repo      # local only
cd ~/aicc-sentinel-repo && git init -b main && git add -A && git commit -m "AICC external sentinel"
gh repo create avivg7/aicc-sentinel --public --source . --push                      # creates the PUBLIC repository
gh secret set TELEGRAM_BOT_TOKEN --repo avivg7/aicc-sentinel                       # hidden prompt, paste, Enter
gh secret set TELEGRAM_CHAT_ID   --repo avivg7/aicc-sentinel
gh workflow run aicc-sentinel --repo avivg7/aicc-sentinel -f send_test=true       # ONE [TEST] Telegram message, no probe: proves the two secrets
gh workflow run aicc-sentinel --repo avivg7/aicc-sentinel                           # first real run now
gh run list --repo avivg7/aicc-sentinel --limit 3                                   # expect: completed / success
```
Before the cutover `www.copilt.org/healthz` is the old site (404), so stage the repository for the CURRENT phase first (`docs/launch/ops-owner-kit/scripts/sentinel-phase.sh --repo ~/aicc-sentinel-repo --phase stage|dark|www`: `stage` watches `https://stage.copilt.org/healthz` until promotion, `dark` watches `https://api.copilt.org/health` while production is dark, `www` after the DNS cutover). Otherwise **do not enable the workflow until the cutover day** (section 10 of `docs/cutover/production-promotion.md`), or run the first test with the Mac-only dry run `python3.12 infra/sentinel/sentinel.py --config infra/sentinel/github/targets.github.toml --plan`. Account hygiene: 2FA on the GitHub account (the account holds every secret in this repository) and no collaborators.

Remove it: `gh repo delete avivg7/aicc-sentinel` (or disable the workflow in the Actions tab). The workflow stores nothing else.

## Honest limits

* **Not instant.** The schedule is best effort ("can be delayed during periods of high loads"); the shortest interval is 5 minutes. Expect detection in roughly 20 to 40 minutes. This is a "the site has been down for a while" alarm, not an uptime SLA.
* **60-day rule.** GitHub disables scheduled workflows in a public repository after 60 days without repository activity. The repository is created at cutover, so it is active; put a recurring reminder in the owner's calendar for day 45 (one commit, or re-enable in the Actions tab). A silent observer looks exactly like a healthy one. Whether a commit made by the workflow itself counts as activity is UNVERIFIED, so the workflow makes none.
* **Telegram is a single point.** AICC Ops, the Mac sentinel and this workflow all use Telegram. A muted chat or a revoked token blinds the notification path of all three; DigitalOcean's email alerts are the only independent notification channel.
* **Shared account.** The repository, the secrets and the Droplet's DigitalOcean account are controlled by the same person; independence is of infrastructure (GitHub-hosted runners, versus DigitalOcean and the Mac), not of ownership.
* The Mac LaunchAgent sentinel is **not 24/7**: it does not run while the Mac sleeps, is shut or is offline. Keep it as a second observer, never as the only one.
