# AICC external availability sentinel: design

Status (2026-10-21): **implemented and tested locally; INSTALLED as a LaunchAgent on the owner's Mac (running since 2026-10-21, all four targets UP, Telegram DISABLED: no secrets file yet); the GitHub Actions variant is NOT enabled.** The code, the staging targets file, the macOS LaunchAgent installer and the GitHub Actions example are in this directory; creating the Telegram secrets and enabling the workflow are the remaining owner steps (section 4.3). No account, token, server or DNS entry was created by this work.
Labels used below: **VERIFIED** (tested locally in this repo), **INFERRED** (follows from how the pieces work, not tested against the real host), **UNVERIFIED** (depends on a provider's current terms or on infrastructure that does not exist yet).

## 1. Why a second observer

AICC Ops runs on the same Droplet it watches. Anything that kills or isolates that Droplet (power loss, kernel panic, network, firewall, DNS, region outage) also silences AICC Ops and its Telegram path. The sentinel is a separate, tiny program (`sentinel.py`, standard library only) that must run in a different failure domain and only ever makes polite, read-only HTTPS requests to the public URLs.

## 2. (a) Failure modes versus who can detect them

`Y` = detects it, `P` = partially / only as a symptom, `N` = cannot. "DO" = DigitalOcean Monitoring alert policies (Droplet agent metrics; notifications by **email and Slack only**, per DigitalOcean's documentation).

| Failure mode | Local AICC Ops | External sentinel | DO Monitoring | What each CANNOT see |
|---|---|---|---|---|
| Single process crash (PHP-FPM, MySQL, fail2ban, wp-cron timer) | **Y** (systemd ActiveState, NRestarts, restart alerts) | P (only if users hit it: 5xx / body mismatch) | N | Sentinel: crashes of non-user-facing units. DO: has no per-process view. |
| Edge (Caddy) crash | **Y** (unit state, loopback HTTPS probe, admin metrics) | **Y** (connection refused / timeout on the public URL) | N | Local: nothing if the whole host is gone. |
| Upstream / PHP / MySQL down while Caddy is up | **Y** (fpm.up, mysql.up, 5xx rate, DB pressure) | **Y, but only with a synthetic that reaches PHP/DB** (a static `/healthz` answered by Caddy proves the edge only) | N | Sentinel with a static health path is blind to this. Use an app-level path (see section 6). |
| High RAM / swap / CPU / disk | **Y** (graphs, sustained alerts, capacity verdict) | P (latency or errors as a late symptom) | **Y** (CPU, memory, disk, load policies) | Sentinel cannot see resource pressure before users do. |
| Certificate expiry | **Y** (reads the served cert on loopback) | **Y** (what the public actually receives, including chain problems) | N | Local cannot see a different cert on the public path (e.g. wrong SNI routing, CDN, DNS to another server). |
| DNS failure or misconfiguration (wrong record, expired domain, TTL mistakes) | **N** (loopback bypasses DNS) | **Y** (resolves from outside; only from the sentinel's resolver view) | N | Sentinel sees one resolver's view; a regional or resolver-specific problem can be missed or false-alarmed. |
| TLS failure on the public path (handshake, SNI, protocol) | P (loopback handshake can succeed while the public path fails) | **Y** | N | Local: anything between the internet and the NIC. |
| Whole Droplet powered off / crashed / kernel panic | **N** (dead) | **Y** | P (INFERRED: metrics stop arriving; whether an alert policy fires on missing data is UNVERIFIED, do not rely on it) | Local and DO's agent metrics cannot report their own absence reliably. |
| Host network outage (uplink, routing, NIC) | **N**, and its Telegram send also fails | **Y** | P (agent cannot report) | Local cannot even say it is unreachable. |
| Firewall misconfiguration (UFW or Cloud Firewall blocks 443) | **N**, may look perfectly healthy because it checks loopback | **Y** | N | Local is blind by construction. This is the classic "all green inside, dead outside" case. |
| DigitalOcean region (FRA1) outage | **N** | **Y only if the sentinel is NOT in that region/provider** | P (DO status page; their own alerting path may share the region: UNVERIFIED) | A sentinel on another Droplet in FRA1 goes down with it and cannot tell "target down" from "I am down". |
| Caddy up but application broken (PHP fatal, WordPress white screen, bad DB credentials, bad deploy) | P (5xx rate, fpm/mysql state) | **Y with `expect_body` on a PHP-rendered page** | N | Needs a synthetic that exercises the real stack; static health paths hide it. |
| Host out of disk, so monitoring cannot write | P (AICC Ops refuses to write below 10% free and raises a CRITICAL `monitoring_write_blocked` alert before the disk is full; at 100% everything may fail anyway) | P (symptoms: 5xx, timeouts) | **Y** (disk policy, if the threshold is set below the danger zone) | Local: cannot persist anything at 100%. External: sees only symptoms. |
| AICC Ops itself dead or stuck (OOM kill, crash loop, hung collector) | N | N (it does not talk to Ops) | N | **Residual gap.** Mitigations: systemd `Restart=` + `MemoryMax`; a daily digest could double as a dead-man signal (no digest = Ops silent) but it is OFF by default (`telegram.digest_enabled = false`), so today it is NOT a mitigation; DO memory alert. A true dead-man ping needs a third-party service, which is an owner decision. |

Reading the table: the three observers are complementary, none is sufficient. Local owns *why* (resource and service detail); the sentinel owns *is it reachable and correct from outside*; DO Monitoring owns *the machine's vital signs even when our own software is broken*.

## 3. (b) Where the sentinel can run: options

The sentinel must not share the target's failure domain. "Domain" = provider, region, host and network path.

| Option | Cost | Failure-domain independence | Pros | Cons / risks |
|---|---|---|---|---|
| **Owner's Mac via launchd** (**implemented**: user LaunchAgent, `StartInterval` 120 s, `sentinel.py --once --due-only`; `macos/`) | Free | High (different network, different provider) | Zero infrastructure, zero accounts, works today, easy to inspect, `--status` heartbeat | **Not 24/7**: sleep, lid closed, travel, Wi-Fi. A silent Mac looks like "all fine" (the heartbeat shows when it last ran, but only when you look). Good for the staging period only. |
| **The new staging Droplet watching api.copilt.org** | Free (already paid) | **Low**: same provider and same region (FRA1) as the thing being watched; shares the DO control plane | No change to the API host; 24/7; trivial to deploy | Provider/region outage kills both observer and target; cannot watch itself (staging) so it needs a second observer anyway; puts monitoring load and an outbound-HTTP actor on a 1 vCPU / 2 GiB box that was sized deliberately small. |
| **GitHub Actions scheduled workflow** (`schedule: cron`; **example written, not enabled**: `examples/github-actions-sentinel.yml.example`) | Free **for public repositories only**. Private repositories draw on a monthly minutes quota (plan-dependent, UNVERIFIED current numbers); every run bills at least one minute, so a 5-minute cadence is roughly 8,640 run-minutes per month (INFERRED), which exceeds a typical free private quota. | High (GitHub/Azure network) | No server to run; secrets in repo secrets; logs retained; free if public | **Minimum interval 5 minutes** and GitHub documents that scheduled runs can be delayed or dropped under load; schedules in public repos are auto-disabled after 60 days without repository activity (UNVERIFIED current rule); needs state between runs (cache/artifact) for N-of-M logic; requests come from shared GitHub IP ranges that a WAF may rate-limit; **repository visibility must be checked by the owner; this design does not assume the repo is public.** Putting a production-monitoring token in a repo is a trust decision. |
| **Free-tier VM at another provider** (e.g. an "always free" or trial tier) | Nominally $0 | **Highest** (different provider, different region) | 24/7, independent of DO and of the owner's laptop, `systemd` timer or the loop mode | Needs an account (often a payment card on file), free-tier terms change and some providers reclaim idle instances (UNVERIFIED for any specific provider); another credential to protect; **owner decision**. |
| **Existing API Droplet (139.59.157.231 / api.copilt.org host)** | n/a | Low for watching the API (cannot watch itself); wrong place for a staging watcher | n/a | **Requires its own explicit owner approval and is NOT done.** Nothing in this package touches that host. |

## 4. (c) Recommendation and what is implemented

### 4.1 Recommendation (unchanged in substance)

1. **Now, while staging is being built and before real traffic: run the sentinel on the owner's Mac under launchd**, watching `stage.copilt.org` and `api.copilt.org/health`. It costs nothing, creates no new accounts, and closes the biggest hole (a firewall/DNS/TLS/power failure that AICC Ops can never see). Its weakness (not 24/7) is acceptable while the staging host carries no customers.
2. **Enable DigitalOcean Monitoring alert policies on the new Droplet from day one** (email, and Slack if the owner uses it): the independent safety net for machine health, no software of ours.
3. **Before production traffic moves to the new host (www.copilt.org cutover): add a 24/7 external observer in a different provider.** In order of preference: (i) a free-tier VM at another provider, if the owner is willing to create the account; (ii) GitHub Actions *if and only if the repository is public*; (iii) as a minimum fallback, a second small sentinel on the staging Droplet watching only `api.copilt.org`, accepting the weaker domain. Keep the Mac sentinel as an extra observer.
4. **Do not put the sentinel on the API Droplet** without a separate owner approval.

### 4.2 Implemented state (VERIFIED = unit-tested with loopback fakes in `tests/`; the real hosts and the real launchd were NOT contacted)

| Area | State |
|---|---|
| Checks, in this order, each failure tagged with the failing part (`dns`, `connect`, `tls`, `http`, `body`, `header`, `latency`) in the DOWN message and log | DNS through the **system resolver** (hard timeout) with optional `expect_ip` (a string or list; any resolved address outside the list, or none, fails at `dns` and **no request is sent**); TCP connect; TLS verification + `notAfter` (days to expiry; warning below `tls_warn_days`, not a DOWN); HTTP status; `expect_body` (a string **or a list, all required**; plain substrings, no JSON parsing); `expect_header`; latency ceiling (covers DNS+connect+TLS+response). VERIFIED |
| Identity check | `stage-identity` = `expect_body` with two substrings (`"host":"stage.copilt.org"` and the id). Works with the compact JSON the edge serves; tested against the exact documented body. VERIFIED (the live route UNVERIFIED offline) |
| Transient failures never page | N-of-M window (default 3 of 5, `--fail-n/--window-m` override), cooldown, RECOVERED only after K good checks **and** only if a DOWN notice was actually sent. Tests: every 3rd check failing, one failure of each stage, a real flapping server, sustained alternation (one page, not many). A DOWN whose Telegram delivery failed is retried next round. VERIFIED |
| Sleep/skip safety | An "up" target not checked for `stale_after_s` (1800) starts a fresh window, so two failures before a night's sleep plus one after cannot page. VERIFIED |
| Observer-offline guard | After a `dns`/`connect` failure only, one bare TCP+TLS handshake to `control_host` (`api.telegram.org`, a host the sentinel already talks to). If that fails too, the machine looks offline: the round is **discarded**, not counted. Cost: a Telegram-only outage hides a simultaneous target outage (nothing could be delivered anyway). VERIFIED (logic); real offline behaviour UNVERIFIED |
| Per-target `interval_s` (>= 60) and `--due-only` | The Mac timer ticks every 120 s; the 300 s targets run on the first tick at or after 300 s (about 360 s). VERIFIED |
| One-shot with state | `--once --state-file PATH` (alias `--state`): state is read and written atomically (0600, directory 0700), so N-of-M and the cooldown persist across separate invocations. `--fail-on-down` optional exit code. VERIFIED (two and five separate invocations in tests) |
| Heartbeat and `--status` | `--heartbeat PATH` writes `last-run.json` (timestamp, per-target status/stage/reason/latency; no secrets, 0600). `--status` prints it with its age and exits 0/1/2 (alive, stale-or-down, missing). Default path `~/Library/Application Support/aicc-sentinel/last-run.json`. VERIFIED |
| Notifications | Log line `EVENT ...` always. Telegram if the secrets exist (file `~/.config/aicc-sentinel/secrets.env` that is **0600**, a group/world-readable file is ignored; or `CREDENTIALS_DIRECTORY`; or the env vars `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, used by CI). Opt-in `--macos-notify`: a fixed-text `osascript` notification, only when Telegram is absent or failed (never carries a URL, target name or secret; details are in the log). `--test-notify` sends one `[TEST]` message. VERIFIED with fakes; that macOS shows the notification (it may need a one-time permission in System Settings > Notifications) is UNVERIFIED |
| macOS delivery (`macos/`) | `com.aicc.sentinel.plist.template`, `install-launchd.sh` (dry-run default, `--apply`, `--uninstall`, refuses root, never touches the secrets), `sentinel-secrets.sh` (silent prompts, atomic 0600). VERIFIED: plist validity (`plutil -lint` + plistlib), script behaviour in a temp HOME against a stub `launchctl`. **UNVERIFIED and unverifiable offline: real launchd scheduling, what happens across sleep/wake, notification permission.** |
| Targets | `targets.stage.toml` (committed, no secrets): `stage-edge` (`/healthz`, expects `ok`, expects IP 206.189.248.204, 120 s), `stage-identity` (300 s), `stage-app` (`/pricing/`, 300 s), `api-health` (read-only, 300 s). `targets.production.example.toml`: every target `enabled = false`, "NOT ACTIVE until cutover", referenced by nothing. |

Why a user LaunchAgent with `StartInterval` and not `KeepAlive`: each run is a short process, so nothing is left holding stale sockets or timers after sleep or a network change; launchd runs a missed interval once at wake; a crash cannot leave a dead loop; all memory is in the state file. `KeepAlive` would only help against crashes, which a per-run process cannot suffer.

Do not probe: `/wp-login.php` (403 publicly by design), `/wp-admin/`, `/wp-cron.php`, cart, checkout, my-account. A test fails if a committed target URL contains any of them.

### 4.3 Failure-domain independence (honest table)

| Observer | Independent of DigitalOcean? | Independent of the owner's Mac? | Cost | Can see | Cannot see | At 02:00 |
|---|---|---|---|---|---|---|
| **Mac LaunchAgent** | Yes (home/office network, different provider) | No (it **is** the Mac) | Free, no account | Everything an outside client sees: DNS answer, firewall, TLS cert and expiry, Caddy, PHP-rendered page, identity route | Anything while the Mac sleeps, is shut, travels or has no network; resource pressure inside the host | **Asleep = blind.** launchd runs one catch-up round at wake, and an outage that started and ended while the Mac slept is never seen. An outage that is still going at wake is reported after about 3 failed rounds (roughly 6 minutes) **at the earliest**, because the stale window is discarded. No alert is sent while it sleeps. `--status` shows the last run time. |
| **GitHub Actions** (`*/10`) | Yes (GitHub/Azure) | Yes | Free **only if the repo is public**; a private repo uses a monthly minutes quota (UNVERIFIED current numbers) | Same outside view as above, 24/7 at roughly 10-minute resolution | Sub-10-minute outages; resource pressure inside the host; anything if GitHub skips runs (best effort, delays of many minutes are normal) | **Watches.** Typical detection 20-40 minutes after the start of a sustained outage (2 of the last 3 runs). The schedule is **disabled after 60 days without repository activity**, which silently turns the observer off. |
| DigitalOcean Monitoring (policies) | No (same provider) | Yes | Free | Droplet agent metrics | Public reachability, DNS, TLS; alerts go to email/Slack only | Watches machine vitals only. |

Both sentinels can only alert through Telegram, which needs the secrets; without them the Mac one still logs and (opt-in) pops a local notification, and the Actions one only logs (visible in the Actions tab).

### 4.4 Owner decisions and the minimal steps

**Decision (i): accept Mac-only, intermittent coverage for the staging period.**
1. `bash infra/sentinel/macos/install-launchd.sh` (dry-run, read what it prints), then `... --apply`.
2. Optional but recommended: create a Telegram bot with @BotFather and `bash infra/sentinel/macos/sentinel-secrets.sh` (two silent prompts). Without it you get log lines and macOS pop-ups only.
3. Check: `python3.12 infra/sentinel/sentinel.py --status`.

**Decision (ii): also enable the Actions variant (24/7, ~10-minute resolution).**
1. Confirm the repository is **public** (Settings > General > Danger Zone shows the visibility). If it is private, either make it public (a business decision: the staging identity id, hostnames and the tooling become visible) or skip (ii).
2. Copy `infra/sentinel/examples/github-actions-sentinel.yml.example` to `.github/workflows/aicc-sentinel.yml` and merge it into the **default branch** (schedules run only from there). Pin the three `uses:` lines to full commit SHAs first (see the comments in the file).
3. In Settings > Secrets and variables > Actions add two **repository secrets**: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
4. Run the workflow once from the Actions tab (`workflow_dispatch`) and read the log.
5. Remember the 60-day inactivity rule.

Both can run side by side; they keep separate state and may each send a `[DOWN]` for the same outage (the message says `observer: mac-launchd` or `github-actions`).

Reasoning: external detection of firewall, DNS, TLS and whole-host failures is the thing local monitoring cannot do, and it must not die with the host. The cheapest independent place that exists today is the owner's Mac; the proper 24/7 answer needs an owner decision (a public repo, or an account at another provider), so it is a decision point, not an assumption.

### DOWN / RECOVERED flow

```
every interval_s (>= 60 s; a target may set its own, e.g. 120 s edge / 300 s app)
  for each enabled, due target:
    probe = DNS (system resolver, optional expect_ip) -> connect -> TLS verified (+ notAfter)
            -> GET|HEAD url   (https only, same-origin redirects only, UA AICC-Sentinel, no credentials)
            -> status == expected -> body substring(s) -> header -> latency <= latency_ms
            (the first failing part is named in the message: dns / connect / tls / http / body / header / latency)
    dns/connect failure and the control handshake also fails?  -> this machine is offline: discard the round
    window = last M results (default 5)

  state UP:
    failures_in_window >= N (default 3 of 5)?  --no-->  stay UP        (one-off blips are ignored)
        | yes
        v
    state := DOWN, since := now
    last DOWN notice older than cooldown_s?  --yes-->  Telegram "[DOWN] <target>: <reason> (3 of last 5 checks failed)"
                                             --no--->  remember; send when the cooldown ends if still failing

  state DOWN:
    K consecutive successes (default 2)?  --yes-->  state := UP, window cleared
                                                    Telegram "[RECOVERED] <target>: back up after X min"
                                                    (only if a DOWN notice was actually sent)
    still failing and remind_s elapsed?   --yes-->  Telegram "[DOWN, still] ..."  (default every 6 h)

  separately, any successful TLS probe with notAfter - now < tls_warn_days:
    Telegram "[WARNING] <target>: TLS certificate expires in N days"   (at most once per 8 x cooldown)
```

If Telegram secrets are absent the sentinel logs once and keeps working without sending; `--dry-run` prints exactly what would be sent and never contacts Telegram; `--plan` prints the targets and opens no socket at all.

## 5. (d) DigitalOcean Monitoring remains the independent safety net

* DigitalOcean Monitoring alert policies watch the Droplet's agent metrics (CPU, memory, disk, load, bandwidth) from outside our software. They keep working if AICC Ops or the sentinel is broken.
* Their notification channels are **email and Slack only** (per DigitalOcean's documentation). **Telegram is reachable only through AICC Ops and the sentinel**; do not expect DO alerts in Telegram.
* Starting policies: see `docs/cutover/alerting.md` section 3 (CPU 85 % / 15 min, memory 85 % / 10 min, disk 75 % / 5 min, 5-minute load average above 3 / 15 min), derived from the measured capacity of the staging host. These mirror, but never replace, the local alert rules.
* DigitalOcean also offers an uptime-check feature; its availability, regions, price and alert channels were **not verified** here and are not assumed.
* Nothing in this repository calls the DigitalOcean API. Policies are created by the owner in the console.
* Implemented state of this section: nothing to implement in code. It remains an owner console task, and it is the only observer here that sees machine vitals; the sentinel sees only what an outside client sees.

## 6. Synthetic design notes

* `stage.copilt.org/healthz`: **now defined**. `docs/cutover/Caddyfile.edge.template` (snippet `aicc_health`) answers it itself: `respond "ok" 200` with `Cache-Control: no-store`, same in every render (stage and production). The target expects the body substring `ok`. It proves **edge + TLS + DNS + firewall**, not PHP or MySQL.
* `stage-identity` proves *which* host answers (a DNS change that points the name at another server of ours, or a stage render replaced by something else, fails here) and that the stage render is the one running. The id is an identifier the stage tooling already pins, not an authentication secret; it is still committed in `targets.stage.toml`, which becomes public if the repo is public.
* `stage-app` (`/pricing/`) is the PHP/WordPress-level synthetic. How its `expect_body` was chosen: `/pricing/` is a WordPress virtual route of the Control Plane theme (`docs/cutover/redirect-matrix.md` rule 9; the static copy is shadowed, so the answer comes through Caddy -> PHP-FPM -> WordPress). The theme's source is not in this repository, so the page text could not be read directly. The word `Studio` was chosen because it is a plan name that the page lists and that the repository itself relies on in several places (the static copy of the page: "Solo $99, Studio $199, Agency $499"; the browser flows add "the Studio plan" from this page; WooCommerce products "AICC Solo/Studio/...") and because none of the failure pages (Caddy 421/50x, WordPress critical-error page, maintenance page) contains it. **UNVERIFIED against the live page**: run `curl -s https://stage.copilt.org/pricing/ | grep -c Studio` once before relying on it; if it prints 0, change `expect_body` in `targets.stage.toml`. The request sends no cookie, so the default language (English) is rendered.
* `api.copilt.org/health` already exists and is read-only; one GET per 300 s is polite. No `expect_body` because its body was not verified.
* Never point the sentinel at login, checkout, admin or any URL with side effects; the code can only GET/HEAD, and the targets file is operator-controlled.

## 7. Threat model of the sentinel itself

* It is an outbound-only client. It listens on nothing and has no inbound commands.
* SSRF: it can only reach URLs in the targets file (operator-owned, not derived from any response); redirects off the original origin are refused, not followed.
* Served content is data: response bodies are only searched for the configured substring and never executed, parsed as instructions or forwarded.
* Secrets: Telegram token and chat id only from a protected secrets file (0600) or systemd credentials; never in the repo or the targets file. A group/world-accessible secrets file is refused.
* Extra contact, only after a dns/connect failure and only if `control_host` is set: one bare TCP+TLS handshake (no HTTP request) to that host. The committed targets set it to `api.telegram.org`, which the sentinel contacts anyway.
* Local files: state and heartbeat are written atomically with mode 0600 in 0700 directories and contain no secrets (statuses, fixed reason strings, timestamps). The launchd plist, its arguments and the logs never contain the Telegram values. `--macos-notify` passes only fixed text to `osascript`.
* Politeness: minimum 60 s interval enforced; 64 KiB body cap; per-target timeout of at most 30 s; one request per target per round.
