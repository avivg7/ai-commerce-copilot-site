# AICC external availability sentinel: design

Status: **reference implementation and design only. Not deployed anywhere. No account, token, server or DNS entry was created.**
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
| AICC Ops itself dead or stuck (OOM kill, crash loop, hung collector) | N | N (it does not talk to Ops) | N | **Residual gap.** Mitigations: systemd `Restart=` + `MemoryMax`; the optional daily digest doubles as a dead-man signal (no digest = Ops silent); DO memory alert. A true dead-man ping needs a third-party service, which is an owner decision. |

Reading the table: the three observers are complementary, none is sufficient. Local owns *why* (resource and service detail); the sentinel owns *is it reachable and correct from outside*; DO Monitoring owns *the machine's vital signs even when our own software is broken*.

## 3. (b) Where the sentinel can run: options

The sentinel must not share the target's failure domain. "Domain" = provider, region, host and network path.

| Option | Cost | Failure-domain independence | Pros | Cons / risks |
|---|---|---|---|---|
| **Owner's Mac via launchd** (`StartInterval` 60 s, `sentinel.py --once`) | Free | High (different network, different provider) | Zero infrastructure, zero accounts, works today, easy to inspect | **Not 24/7**: sleep, lid closed, travel, Wi-Fi. A silent Mac looks like "all fine". Good for the staging period only. |
| **The new staging Droplet watching api.copilt.org** | Free (already paid) | **Low**: same provider and same region (FRA1) as the thing being watched; shares the DO control plane | No change to the API host; 24/7; trivial to deploy | Provider/region outage kills both observer and target; cannot watch itself (staging) so it needs a second observer anyway; puts monitoring load and an outbound-HTTP actor on a 1 vCPU / 2 GiB box that was sized deliberately small. |
| **GitHub Actions scheduled workflow** (`schedule: cron`) | Free **for public repositories only**. Private repositories draw on a monthly minutes quota (plan-dependent, UNVERIFIED current numbers); every run bills at least one minute, so a 5-minute cadence is roughly 8,640 run-minutes per month (INFERRED), which exceeds a typical free private quota. | High (GitHub/Azure network) | No server to run; secrets in repo secrets; logs retained; free if public | **Minimum interval 5 minutes** and GitHub documents that scheduled runs can be delayed or dropped under load; schedules in public repos are auto-disabled after 60 days without repository activity (UNVERIFIED current rule); needs state between runs (cache/artifact) for N-of-M logic; requests come from shared GitHub IP ranges that a WAF may rate-limit; **repository visibility must be checked by the owner; this design does not assume the repo is public.** Putting a production-monitoring token in a repo is a trust decision. |
| **Free-tier VM at another provider** (e.g. an "always free" or trial tier) | Nominally $0 | **Highest** (different provider, different region) | 24/7, independent of DO and of the owner's laptop, `systemd` timer or the loop mode | Needs an account (often a payment card on file), free-tier terms change and some providers reclaim idle instances (UNVERIFIED for any specific provider); another credential to protect; **owner decision**. |
| **Existing API Droplet (139.59.157.231 / api.copilt.org host)** | n/a | Low for watching the API (cannot watch itself); wrong place for a staging watcher | n/a | **Requires its own explicit owner approval and is NOT done.** Nothing in this package touches that host. |

## 4. (c) Recommendation

1. **Now, while staging is being built and before real traffic: run the sentinel on the owner's Mac under launchd**, watching `stage.copilt.org` and `api.copilt.org/health`. It costs nothing, creates no new accounts, and already closes the biggest hole (a firewall/DNS/TLS/power failure that AICC Ops can never see). Its weakness (not 24/7) is acceptable while the staging host carries no customers; the Telegram message `[DOWN]` simply arrives when the Mac is awake.
2. **Enable DigitalOcean Monitoring alert policies on the new Droplet from day one** (email, and Slack if the owner uses it). They are the independent safety net for machine health and need no software of ours.
3. **Before production traffic moves to the new host (www.copilt.org cutover): add a 24/7 external observer in a different provider.** In order of preference: (i) a free-tier VM at another provider, if the owner is willing to create the account; (ii) GitHub Actions *if and only if the repository is public* (then free, at a 5-minute resolution); (iii) as a minimum fallback, a second small sentinel on the staging Droplet watching only `api.copilt.org`, accepting the weaker domain. Keep the Mac sentinel as an extra observer.
4. **Do not put the sentinel on the API Droplet** without a separate owner approval.

Reasoning: external detection of firewall, DNS, TLS and whole-host failures is the thing local monitoring cannot do, and it must not die with the host. The cheapest independent place that exists today is the owner's Mac; the proper 24/7 answer needs an owner decision about an account at another provider, so it is deferred to a decision point instead of being assumed.

### DOWN / RECOVERED flow

```
every interval_s (>= 60 s)
  for each enabled target:
    probe = GET|HEAD url   (https only, same-origin redirects only, UA AICC-Sentinel, no credentials)
            checks: status == expected, body/header substring, latency <= latency_ms, TLS verified, notAfter
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
* Suggested starting policies (provisional, tune on staging): CPU > 85% for 10 min; memory > 85% for 10 min; disk > 80%; 1-minute load > 3 for 10 min. These mirror, but never replace, the local alert rules.
* DigitalOcean also offers an uptime-check feature; its availability, regions, price and alert channels were **not verified** here and are not assumed.
* Nothing in this repository calls the DigitalOcean API. Policies are created by the owner in the console.

## 6. Synthetic design notes

* `stage.copilt.org/healthz`: the edge should answer `200` with a short text body (no `/healthz` definition was found anywhere in this repository when this was written; the edge package owner must add something like `respond /healthz "ok" 200`, and the loopback edge probe in AICC Ops uses the same path). This proves **edge + TLS + DNS + firewall**, not PHP or MySQL.
* Add a second, app-level target once a cheap read-only PHP path exists (for example a lightweight WordPress/REST path or a dedicated `/status.php` that checks DB connectivity). With `expect_body` set to text the PHP page renders, this catches "Caddy up but app broken". Keep it cheap: one request per minute.
* `api.copilt.org/health` already exists and is read-only; one GET per minute is polite.
* Never point the sentinel at login, checkout, admin or any URL with side effects; the code can only GET/HEAD, and the targets file is operator-controlled.

## 7. Threat model of the sentinel itself

* It is an outbound-only client. It listens on nothing and has no inbound commands.
* SSRF: it can only reach URLs in the targets file (operator-owned, not derived from any response); redirects off the original origin are refused, not followed.
* Served content is data: response bodies are only searched for the configured substring and never executed, parsed as instructions or forwarded.
* Secrets: Telegram token and chat id only from a protected secrets file (0600) or systemd credentials; never in the repo or the targets file. A group/world-accessible secrets file is refused.
* Politeness: minimum 60 s interval enforced; 64 KiB body cap; per-target timeout of at most 30 s; one request per target per round.
