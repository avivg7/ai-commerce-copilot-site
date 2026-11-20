# P42: the verified activation procedure (Turnstile, notify, milestone, owner-ops, then the signup switch)

Written 2026-11-20 (UTC), P42 builder R. **Nothing in this document was run against production.** The wp-config part is proved by `bash infra/stack-tests/test_p42_activation.sh` (62 checks, golden renders of the live state and of each activation stage), the Turnstile secret installer by `bash infra/stack-tests/test_p42_turnstile_key.sh` (274 checks on a fake host with a pseudo-terminal leak scan), both on SYNTHETIC data. This document supersedes the step order of `docs/cutover/p41-activation-runbook.md` where they differ (that file keeps the full gate table).

## 1. The live state this was verified against (read-only facts gathered by the coordinator, 2026-11-19; not re-read here)

| Constant | Live |
|---|---|
| `AICC_MAIL_PROVIDER` `brevo_api`, `AICC_MAIL_FROM_ADDRESS`, `AICC_MAIL_REPLY_TO`, `AICC_MAIL_DAILY_BUDGET` 240 | set (Brevo transport active) |
| `AICC_LEGAL_SUPPORT_EMAIL` `support@copilt.org` | set (so the "Support details will be confirmed before purchases open" footer is gone; verify only) |
| `AICC_LM_TRUSTED_PROXIES` | defined as an **EMPTY array**: correct. Caddy is the public edge and gives PHP-FPM the real client address through `php_fastcgi`; a trusted-proxy list would only create a path to trust a client-supplied header. Nobody sets it. |
| `WP_HTTP_BLOCK_EXTERNAL` `true`, `WP_ACCESSIBLE_HOSTS` `api.copilt.org,api.brevo.com` | `challenges.cloudflare.com` is **NOT** allowed: the genuine `turnstile_blocked` blocker (the host itself reaches Cloudflare fine: DNS, TLS and a POST to siteverify work, egress is open) |
| The five hand-appended P35 constants | live, pinned as owner facts (`9d6290e`) |
| NOT set: `AICC_NOTIFY_ENABLED`, `AICC_TURNSTILE_SITE_KEY` + the secret file, `AICC_TRIAL_SELF_SERVICE_ENABLED`/`_CAP`, `AICC_MILESTONE_SYNC_SCHEDULED`, `AICC_OWNER_OPS_SECTION_ENABLED`, `AICC_LEGAL_REVIEW_APPROVED` | public signup is closed |

The committed fixtures `infra/stack-tests/fixtures/owner-facts.production.p42-live.env` (this state), `...p42-stage1.env` and `...p42-stage2.env` encode it; the goldens `golden/wp-config.production.p42-{live,stage1,stage2}.php` freeze the three renders.

## 2. What the tests prove (so you know what is, and is not, evidence)

| Claim | Proved by |
|---|---|
| ONE owner-facts update (Turnstile enabled + site key + the secret FILE, notify, milestone scheduling, owner-ops section) renders EXACTLY five new constants: `AICC_TURNSTILE_SITE_KEY`, `AICC_TURNSTILE_SECRET_FILE` (a path, never the secret), `AICC_NOTIFY_ENABLED`, `AICC_MILESTONE_SYNC_SCHEDULED`, `AICC_OWNER_OPS_SECTION_ENABLED`; none removed; the only live define whose value changes is `WP_ACCESSIBLE_HOSTS` | `test_p42_activation.sh` S1 (golden + set arithmetic) |
| `WP_ACCESSIBLE_HOSTS` gains `challenges.cloudflare.com` and NOTHING else (no wildcard, nothing lost): `api.copilt.org,challenges.cloudflare.com,api.brevo.com` | S1 (set difference is exactly that host) |
| Every live value, Brevo, the empty trusted-proxy array and the five P35 constants are kept byte for byte; the signup switch, the cap, `AICC_TRIAL_TURNSTILE`, commerce and the legal approval stay absent | L and S1 |
| At the very end the cap (integer `25`) and the switch (boolean `true`) are the only additions | S2 |
| `--compare` names exactly those constants at each step, prints no value, writes nothing; the trap (facts without the five P35 facts) is caught | C |
| Inconsistent sets are refused and nothing is written: switch without notify, without the site key, without `AICC_TURNSTILE_ENABLED`, without a cap, without the secret file; a cap outside 25/50/100 (at `set` time and hand-edited); the secret as a fact, the secret-file path as a fact, the bypass `AICC_TRIAL_TURNSTILE` and a trusted-proxy list as facts (all unknown keys); the SECRET pasted as the site key; a secret file with mode 0600 | R |
| The Turnstile secret is installed only through the secure file mechanism, never in an argument, environment, file, log or terminal; the public SITE key pasted as the secret is refused by the host tool | `test_p42_turnstile_key.sh` (A-G) |

**Not proved here (needs the real world):** the real Cloudflare widget accepting the real domain, the real siteverify answer (hostname and action binding) and the browser widget rendering: that is the owner's first live self-test (step 8 of the runbook). The test keys of Cloudflare only exist in the Control Plane's own tests.

## 3. Order, and the blockers `wp aicc-trial status` shows after each step

The deployed Control Plane (release `20261119T224150Z-90da3713`, source `635ad8c`) blocks the public mode in code on: `turnstile`, `turnstile_blocked`, `notify`, `plugin_release`, `mail*`, `legal_documents`, `no_trusted_proxy` (a CLI false positive: see the note below the table).

| After | Blockers row (public mode stays `off` until the switch exists) |
|---|---|
| Today (baseline) | `turnstile`, `turnstile_blocked`, `notify`, `plugin_release` (+ `no_trusted_proxy` while the CLI false positive is flagged) |
| Steps A-C (widget, secret file, ONE facts update, render, reload) | `plugin_release` (+ the false positive) |
| Plugin signed and published (`docs/cutover/p41-plugin-publication.md`) | none (+ the false positive) |
| Step F (cap 25, then the switch) | `none`; public mode `open` |

**`no_trusted_proxy` is not an owner action.** It is reported by the CLI because any request that reaches PHP from a loopback or private address (a deploy warm-up, a smoke check, a tunnel request) leaves a 15-minute flag that WP-CLI reads. It is being fixed in the Control Plane; **fixed in CP release `<ID: the coordinator fills in>`**. Do not define `AICC_LM_TRUSTED_PROXIES`. To tell noise from real: read the public route (`curl -s https://www.copilt.org/wp-json/aicc/v1/signup/status`) and re-run `status` after 15 quiet minutes.

## 4. Getting the new Turnstile tool onto the host (targeted copy; no bundle mirror)

`infra/provision/install-stack.sh` installs `aicc-set-turnstile-secret` (and the rotation tools) from a pushed bundle, but `push-bundle.sh` MIRRORS (`--delete`) and would roll forward unrelated tooling (the P38 update copied six files by hand for that reason). Minimal safe route: one file, one hash, one `install`:

```bash
SITE=~/self_projects/ai_copilot_site-worktrees/p42-activation   # branch feat/p42-site-readiness
pssh() { ssh -i ~/.ssh/aicc_cp_prod_operator -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$HOME/.ssh/known_hosts_aicc_prod" aicc@157.230.110.211 "$@"; }
cd "$SITE" && git status --short                                   # clean
pssh 'mkdir -p -m 700 ~/p42-incoming'
scp -i ~/.ssh/aicc_cp_prod_operator -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$HOME/.ssh/known_hosts_aicc_prod" infra/provision/host/aicc-set-turnstile-secret aicc@157.230.110.211:p42-incoming/
shasum -a 256 infra/provision/host/aicc-set-turnstile-secret; pssh 'sha256sum ~/p42-incoming/aicc-set-turnstile-secret'     # the two hashes must be equal
pssh 'sudo install -o root -g root -m 0755 ~/p42-incoming/aicc-set-turnstile-secret /usr/local/sbin/aicc-set-turnstile-secret'
pssh 'sudo aicc-set-turnstile-secret status'                       # expect: absent: /etc/aicc-mail/turnstile.secret
```

Rollback: `pssh 'sudo rm -f /usr/local/sbin/aicc-set-turnstile-secret'` (nothing else changed). The tool is inert until it is run with a secret on stdin. (These host commands were NOT run; the tool itself is tested on the fake host.)

## 5. Step A: the Cloudflare Turnstile widget (owner, browser)

Cloudflare dashboard, your account, **Turnstile** (left menu), **Add widget** (labels may differ slightly; this was not clicked through here):

1. Name: for example `AICC signup (production)`.
2. **Hostnames: add `www.copilt.org`.** The Control Plane accepts a solved token only when Cloudflare reports the page's own host, which is `home_url()`'s host `www.copilt.org`. Add `copilt.org` (the apex) ONLY if the apex serves `/start/` itself rather than redirecting to `www`; if it redirects, the widget is only ever solved on `www.copilt.org`. No other hostname.
3. Widget mode **Managed**. No pre-clearance needed.
4. Create. Cloudflare then shows a **Site key** (PUBLIC, goes into an owner fact) and a **Secret key** (PRIVATE, goes only into the host file through the tool in step B). Do not paste either into chat or into a file; the secret never appears anywhere but the hidden prompt.
5. The widget's action (`signup`) is set by the page, nothing to configure. The widget works only on the registered hostname; local tests use Cloudflare's published test keys, which are never production protection.

## 6. Step B: install the secret (owner, Mac, interactive Terminal; no render yet)

```bash
cd "$SITE"
bash infra/provision/set-turnstile-secret.sh --dry-run     # local gates + the exact remote command; no connection, no prompt, no secret
bash infra/provision/set-turnstile-secret.sh               # hidden prompt, twice: paste the SECRET key (not the site key)
```

Expected: `host identity verified: production, www.copilt.org, stage id 3e897286...`, then `installed: /etc/aicc-mail/turnstile.secret root:aicc-cp 640 <size>`, `fingerprint: sha256:<8 hex> (first 8 hex of the key's SHA-256: a rotation fingerprint, not the key)` and `fingerprint matches what you typed`. Check: `pssh 'sudo aicc-set-turnstile-secret status'` prints `present: /etc/aicc-mail/turnstile.secret root:aicc-cp 640 <n> bytes; mode/owner ok; shape: ok`.

What the tool guarantees (all tested): the secret travels on the stdin of ONE pinned SSH connection (the remote command has no secret); the host writes a 0400 temp file in `/etc/aicc-mail`, sets root:aicc-cp 0640, fsyncs, renames atomically (a crash leaves the old secret or nothing); it keeps no copy of a previous secret; it touches no other file; it journals `aicc-turnstile-secret action=... fingerprint_prefix=<8 hex>` only. **It refuses a value equal to the public site key** once `AICC_TURNSTILE_SITE_KEY` is set (the classic slip), and the renderer refuses the same slip either way round. `rotate` replaces the secret (then invalidate the old one in Cloudflare; use its grace period if offered); `revoke` removes the file (the signup then reads `paused`, blocker `turnstile`).

**Do NOT use `--then-check` for the first install:** it offers a render right after the secret, before the facts exist, and that render would add `AICC_TURNSTILE_SECRET_FILE` alone (verified). Do the facts first (step C).

## 7. Step C: ONE owner-facts update, compare, render, reload (owner/coordinator, host)

```bash
# 0. precondition (read-only): the live file equals what a render writes today
pssh 'sudo aicc-render-wp-config --env production --confirm-production --compare'
#    must print a line ending: IDENTICAL: the render equals /srv/aicc/shared/wp-config.php byte for byte (nothing would change)   (exit 0)
#    if DIFFERENT: read the constant NAMES (never values) and STOP. removed: = a live constant that is not a fact (the five P35 constants) ...

# 1. the five facts (the secret FILE is not a fact: it exists since step B and is judged by the renderer)
pssh 'sudo aicc-owner-facts set AICC_TURNSTILE_ENABLED true'
pssh 'sudo aicc-owner-facts set AICC_TURNSTILE_SITE_KEY <the PUBLIC site key from Cloudflare>'
pssh 'sudo aicc-owner-facts set AICC_NOTIFY_ENABLED true'
pssh 'sudo aicc-owner-facts set AICC_MILESTONE_SYNC_SCHEDULED true'
pssh 'sudo aicc-owner-facts set AICC_OWNER_OPS_SECTION_ENABLED true'

# 2. compare BEFORE rendering
pssh 'sudo aicc-render-wp-config --env production --confirm-production --compare'
#    expect (exit 4):   DIFFERENT ...
#      added  : AICC_MILESTONE_SYNC_SCHEDULED, AICC_NOTIFY_ENABLED, AICC_OWNER_OPS_SECTION_ENABLED, AICC_TURNSTILE_SECRET_FILE, AICC_TURNSTILE_SITE_KEY
#      removed: -
#      changed: WP_ACCESSIBLE_HOSTS
#    anything else under removed/changed, or another name under added: STOP, do not render.

# 3. dry run, render, reload, compare again
pssh 'sudo aicc-render-wp-config --env production --confirm-production --dry-run'        # ... turnstile secret file valid (constant rendered, content never read into the output)
pssh 'sudo aicc-render-wp-config --env production --confirm-production && sudo systemctl reload php8.3-fpm'
pssh 'sudo aicc-render-wp-config --env production --confirm-production --compare'        # expect: IDENTICAL (exit 0)
```

A refusal at the render names the missing piece (no secret file, no site key, no notify ...) and writes nothing. The notify switch needs the Notification Center tables and the working mail transport (Brevo is live). `AICC_NOTIFY_EXCLUDED_CUSTOMERS` (the operator test account) is optional and not part of this update; if you want it, set it BEFORE `AICC_NOTIFY_ENABLED` (the runbook step 2).

Verify (read-only):

```bash
pssh 'sudo aicc-wp aicc-trial status'
#   turnstile mode | required        (the Control Plane requires it in production, always)
#   blockers       | plugin_release  (+ no_trusted_proxy while the CLI false positive is flagged)     <- turnstile, turnstile_blocked and notify are gone
#   public mode    | off             (the switch is not set)
pssh 'sudo aicc-wp aicc-trial issue-test'                    # a DRY RUN by default: the readiness checks and what a run would do (never executes on production)
pssh 'sudo aicc-wp aicc-notify status'                       # "enabled": true, "mail_ready": true
pssh 'sudo aicc-wp cron event list --fields=hook,next_run_relative | grep aicc_lm_backend_milestones_sync'   # the hourly milestone event is scheduled
pssh 'sudo aicc-wp aicc-ops milestones sync'                 # first mirror: a counts table, exit 0 (clears the "mirror never ran" warning)
```

Rollback: `pssh 'sudo aicc-owner-facts unset <KEY>'` for each, `--compare` (the names under `removed:` are the rollback preview), render, reload. Unsetting `AICC_NOTIFY_ENABLED` is refused while the signup switch is still set (that is the rule). The secret file may stay.

## 8. Step D: the Plugin (blocker `plugin_release`)

Sign offline and publish as in `docs/cutover/p41-plugin-publication.md`, then `pssh 'sudo aicc-wp aicc-trial status'` must no longer list `plugin_release` and `pssh 'sudo aicc-wp aicc-ops journeys blockers'` must print `Success: No journey blocker: ...`.

## 9. Step F: open, at the very end (explicit owner authorization)

```bash
pssh 'sudo aicc-owner-facts set AICC_TRIAL_SELF_SERVICE_CAP 25'          # 25, 50 or 100 only; refused otherwise
pssh 'sudo aicc-owner-facts set AICC_TRIAL_SELF_SERVICE_ENABLED true'
pssh 'sudo aicc-render-wp-config --env production --confirm-production --compare'      # expect added: AICC_TRIAL_SELF_SERVICE_CAP, AICC_TRIAL_SELF_SERVICE_ENABLED; removed: -; changed: -
pssh 'sudo aicc-render-wp-config --env production --confirm-production && sudo systemctl reload php8.3-fpm'
pssh 'sudo aicc-render-wp-config --env production --confirm-production --compare'      # IDENTICAL
pssh 'sudo aicc-wp aicc-trial status'
#   switch (AICC_TRIAL_SELF_SERVICE_ENABLED) | ON ; cap (AICC_TRIAL_SELF_SERVICE_CAP) | 25 ; paused | no ; policy mode | open ; public mode | open ; turnstile mode | required ; blockers | none
curl -s https://www.copilt.org/wp-json/aicc/v1/signup/status     # "open":true,"mode":"open", a coarse cap_bucket, never an exact number
curl -s -o /dev/null -w '%{http_code}\n' https://www.copilt.org/start/       # 200
```

Then the owner's first live self-test with the owner's own mailbox (runbook step 8). That is the first time the real Cloudflare siteverify is exercised: if the form shows "paused" or the widget fails, pause (below) and read `status`.

## 10. The kill switch and the rollbacks

| Need | Command | Effect |
|---|---|---|
| Stop new signups now (no deploy) | `pssh 'sudo aicc-wp aicc-trial pause --reason="owner stop: <8-300 characters, no e-mail address>"'` -> `Success: Paused. Mode is now paused.` | public mode `paused`; existing accounts and trials untouched |
| Resume | `pssh 'sudo aicc-wp aicc-trial resume --reason="<why>"'` | open again (if no blocker) |
| Close it in the configuration | `unset AICC_TRIAL_SELF_SERVICE_ENABLED`, `--compare` (removed: that constant), render, reload | mode `off` |
| Remove the Turnstile secret | `bash infra/provision/set-turnstile-secret.sh revoke` (then roll the secret in Cloudflare) | signup `paused` (blocker `turnstile`) |

## 11. What could not be verified, and deviations

* Everything on the real hosts (the targeted tool install, the Cloudflare dashboard labels, the real siteverify, `aicc-trial issue-test` output) was not run; expected outputs come from the p40/p41 Control Plane source and the renderer's own behaviour on scratch directories.
* The live facts are the coordinator's read-only report; the fixtures encode them. If the host's facts file carries anything else, `--compare` (step C.0) is the arbiter and must say IDENTICAL before any change.
* `AICC_TURNSTILE_ENABLED` is an owner FACT that renders no constant of its own (it only extends `WP_ACCESSIBLE_HOSTS`); the Control Plane has no constant of that name. The "secret file path" is not a fact either (fixed `/etc/aicc-mail/turnstile.secret`, rendered only when the file passes every check).
* Only the Control Plane's deploy-window rules apply to config changes by habit (`:18-:26` and `:48-:56` UTC, never 02:00-04:00 UTC); a wp-config render and a PHP-FPM reload are not a deploy but follow the same discipline. Do not run them during a webhook-secret rotation (`docs/cutover/p42-webhook-rotation-owner-package.md`): finish the rotation first.
