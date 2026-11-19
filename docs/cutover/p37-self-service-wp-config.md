# P37 self-service: the production wp-config region, its switches and the activation order

Written 2026-11-14 (UTC). Nothing in this file has been run against a host. Everything here is the behaviour of `infra/provision/render-wp-config.sh`, `infra/provision/lib/owner_facts.py` and the P37 region of `infra/provision/wp-config.production.template.php`, proved by `infra/stack-tests/test_p37_wpconfig.sh` (scratch directories only).

## 1. What this is

The Control Plane (P37 build) reads a set of wp-config constants that open the Trial signup, the notification mails, the owner dashboard section and a few schedulers. Until this region existed the renderer had no line for them, and a hand-added line is lost at the next render (the renderer rewrites the whole file). The P37 region fixes that without changing today's file:

* **DEFAULT OFF, byte-identical.** With no P37 owner fact and no Turnstile secret file, the region (template text included) is removed and the render is exactly the golden file of the render before P37 (`stack-tests/golden/wp-config.production.no-owner-facts.php`). Every P37 constant is then ABSENT, which is OFF for the Control Plane. Nothing is rendered as `false`, because absent is safer and keeps the default render unchanged.
* **Owner facts drive it.** The same root-only file as every other launch fact, `/etc/aicc/owner-facts.env`, edited with `sudo aicc-owner-facts set|unset|list` and applied by an explicit `sudo aicc-render-wp-config --env production --confirm-production`. A re-render never loses a value (the renderer never writes that file).
* **Two secrets stay out of the config.** The Turnstile SECRET and the SMTP credentials are FILES. wp-config carries only their PATH (`AICC_TURNSTILE_SECRET_FILE`, `AICC_MAIL_SECRETS_FILE`). Only public values are facts (site key, origins, caps, user ids).
* **Production only.** Staging refuses every P37 fact (`aicc-owner-facts keys` for stage lists none) and its template has no region.
* **Refuses an inconsistent set.** Nothing is written when the set contradicts the Control Plane's own readiness rules (section 5).

## 2. The constants (names and semantics verified against the Control Plane source, worktree `p37-integrated`)

"true" below means the exact PHP boolean `true`. The Control Plane treats the string `"true"`, `1` and `"yes"` as OFF. The renderer writes the boolean for every switch.

| Constant | Owner fact (production) | Rendered when | Default | Control Plane reading (file) |
|---|---|---|---|---|
| `AICC_TRIAL_SELF_SERVICE_ENABLED` | same name, value `true` | fact set | absent (OFF, signup mode `off`) | `true === constant` (`class-aicc-lm-trial.php` `switch_enabled`) |
| `AICC_TRIAL_SELF_SERVICE_CAP` | same name, `25` or `50` or `100` | fact set | absent (cap 0 = `off`) | integer only, a string such as "25" reads as 0; 25/50/100 are the approved stages (`APPROVED_CAP_STAGES`); mode is `off` unless switch AND cap >= 1 (`class-aicc-lm-trial.php`). Rendered as an integer literal |
| `AICC_MAIL_ENABLED` and the other `AICC_MAIL_*` identity lines | (not a fact) | existing mail region, when `/etc/aicc-mail/smtp.env` is valid | absent | `true === AICC_MAIL_ENABLED` (`class-aicc-lm-mail.php`). Unchanged by P37 |
| `AICC_NOTIFY_ENABLED` | same name, `true` | fact set (and mail ready, section 5) | absent (no outbox, no scheduler, no lifecycle mail) | `true === constant` (`class-aicc-lm-notify.php` `enabled`) |
| `AICC_NOTIFY_EXCLUDED_CUSTOMERS` | same name, comma list of positive user ids | fact set | absent (nobody listed) | **Not in `p37-integrated` yet**: the constant exists in the `p37-policy` worktree (`class-aicc-lm-notify-exclusion.php`: comma separated; a digit token is a user id, a 64-hex token is an address hash). This renderer accepts user ids only (a hash of an address is personal data in a config file); it renders a string such as `'2,7'`. Harmless in a build that does not read it |
| `AICC_TURNSTILE_SITE_KEY` | same name, the PUBLIC key | fact set (and secret file valid) | absent | `^[A-Za-z0-9_-]{8,64}$` (`class-aicc-lm-ea-requests-turnstile.php` `site_key`) |
| `AICC_TURNSTILE_SECRET_FILE` | (not a fact: a file) | `/etc/aicc-mail/turnstile.secret` exists and passes every check | absent | absolute path, regular file, not a symlink, readable by PHP, no "other" bit, not writable by group or other, 8-1024 bytes, first line trimmed = 8-256 printable ASCII (`read_secret`). The renderer applies the same rules and refuses 0600 (PHP could not read it) |
| `AICC_MAIL_MAX_PER_HOUR` | same name, 1-2000 | fact set (and mail ready) | absent (code default 60; verification mail is a third of it, reset mail a sixth) | `(int)`, `class-aicc-lm-mail.php`. Rendered as an integer |
| `AICC_MAIL_MAX_PER_DAY` | same name, 1-20000 | fact set (and mail ready) | absent (code default 300; verification a third) | same. The hour cap may not exceed the day cap |
| `AICC_FUNNEL_COUNTERS_ENABLED` | same name, `true` | fact set | absent (no counter, no route) | `true === constant` (`class-aicc-lm-funnel.php`) |
| `AICC_FUNNEL_ALLOWED_ORIGINS` | same name, comma list of exact https origins | fact set (and the counters switch) | absent (the site's own origins only) | string list; an entry that is not `https://host[:port]` is ignored by the Control Plane, so the renderer refuses it instead. Rendered as one comma string |
| `AICC_OWNER_OPS_SECTION_ENABLED` | same name, `true` | fact set | absent (the P35 page byte for byte) | `true === constant` (`class-aicc-lm-owner-ops.php`) |
| `AICC_MILESTONE_SYNC_SCHEDULED` | same name, `true` | fact set | absent (CLI only) | `true === constant`; registers an hourly WP-Cron event (`class-aicc-lm-backend-milestones.php`). The sync also needs the Backend owner token, which is NOT rendered here (it is a secret) |
| `AICC_PLAN_CHANGE_ENABLED` | same name, `true` | fact set | absent (no screens, routes or hooks) | `true === constant` (`class-aicc-lm-plan-change.php`) |
| `AICC_PAY_RECONCILE_ENABLED` | same name, `true` | fact set (and `AICC_LM_PAID_GATEWAYS` set) | absent | `true === config(...)` AND a non-empty `AICC_PAY_ENABLED_PROVIDERS` array (`class-aicc-lm-payments.php`). The providers array is NOT rendered (Commerce is closed, Part B), so the switch is inert until a provider exists |
| `AICC_PRIVACY_REQUESTS_ENABLED` | same name, `true` | fact set | absent | `true === constant` (`class-aicc-lm-privacy.php`) |

Deliberately NOT rendered, and refused as owner facts: `AICC_TRIAL_TURNSTILE` (the Control Plane honours `off` only on a non-production host; production always requires Turnstile), `AICC_NOTIFY_ALLOW_TEST_ACCOUNT_DELIVERY` (a one-user test escape hatch), `AICC_OWNER_DASHBOARD_USER_IDS` (since P38 it IS an owner fact, with the other four constants P35 appended by hand: see `docs/cutover/p38-brevo-host-update.md` step 0), `AICC_PAY_ENABLED_PROVIDERS`, the SMTP credentials and the dev/test constants.

The existing fact `AICC_TURNSTILE_ENABLED=true` (P32) is unchanged: it renders no constant, it adds `challenges.cloudflare.com` to `WP_ACCESSIBLE_HOSTS` so the server-side verification call is allowed. Self-service needs it (blocker `turnstile_blocked` otherwise).

## 3. Placing the Turnstile secret (host step, owner, hidden prompt; never in chat, git or shell history)

The secret file lives next to `smtp.env`, in the directory the promotion already created (`/etc/aicc-mail`, `root:aicc-cp 0750`, which the PHP user can traverse; `/etc/aicc` it cannot). No new directory is needed on the host. The renderer checks the file and never reads it into the output.

```bash
# on the production host, as root (same pattern as docs/cutover/production-promotion.md section 8.2):
sudo bash -c 'umask 027; read -rsp "Turnstile secret key: " k; echo; install -o root -g aicc-cp -m 0640 /dev/null /etc/aicc-mail/turnstile.secret; printf "%s\n" "$k" > /etc/aicc-mail/turnstile.secret; unset k'
sudo stat -c '%U:%G %a %s' /etc/aicc-mail/turnstile.secret      # expect root:aicc-cp 640 and a size of the key + 1
```

Rules enforced at render time: regular file, not a symlink, mode 0640 or 0440 (0600 is refused: root-only, PHP could not read it and the signup would silently read `paused`), `root:aicc-cp` in a `root:aicc-cp 0750` directory, 8-1024 bytes, first line 8-256 printable characters with no space. A file that exists but fails makes the renderer REFUSE (nothing written), exactly like an unsafe `smtp.env`. If the SITE KEY fact equals the secret (the secret was pasted into the wrong slot) the render is refused without printing the value.

## 4. Activation order (each step is one `set` plus one render; each rendered file passes `php -l`)

```bash
sudo aicc-owner-facts set KEY VALUE            # validated, atomic, mode 0600
sudo aicc-render-wp-config --env production --confirm-production [--dry-run]
sudo systemctl reload php8.3-fpm
```

| # | Action | Constants that appear | Check on the host (owner guide A4) |
|---|---|---|---|
| 0 | Default. Nothing P37 | none | `aicc-owner-facts list` shows no P37 key |
| 1 | `/etc/aicc-mail/smtp.env` placed (owner guide A1 steps 6-7), render | the existing eight `AICC_MAIL_*` | `wp aicc-mail check`, `send-test`, `health --strict` |
| 2 | `set AICC_NOTIFY_EXCLUDED_CUSTOMERS 2` (the owner's own test customer id) BEFORE the notify switch | `AICC_NOTIFY_EXCLUDED_CUSTOMERS` (only in a build that reads it) | none (inert) |
| 3 | optional: `set AICC_MAIL_MAX_PER_HOUR 180`, `set AICC_MAIL_MAX_PER_DAY 300` (decision D4 in `docs/p37-open-decisions.md`; never above the relay plan's own limit) | the two caps | re-run the Control Plane burst measurement |
| 4 | `set AICC_NOTIFY_ENABLED true` (needs step 1) | `AICC_NOTIFY_ENABLED` | `wp aicc-notify status`, one `wp aicc-notify run` |
| 5 | Turnstile: place the secret file (section 3), `set AICC_TURNSTILE_ENABLED true`, `set AICC_TURNSTILE_SITE_KEY <public site key>` | `AICC_TURNSTILE_SITE_KEY`, `AICC_TURNSTILE_SECRET_FILE`, plus `challenges.cloudflare.com` in `WP_ACCESSIBLE_HOSTS` | `wp aicc-trial status`: `turnstile mode: required`, no `turnstile` / `turnstile_blocked` blocker |
| 6 | after Backend, edge route and Plugin approvals: `set AICC_TRIAL_SELF_SERVICE_CAP 25` then `set AICC_TRIAL_SELF_SERVICE_ENABLED true` | `AICC_TRIAL_SELF_SERVICE_CAP`, `AICC_TRIAL_SELF_SERVICE_ENABLED` | `wp aicc-trial status`: switch ON, cap 25, mode `open`, blockers none |
| 7 | raising the cap: `set AICC_TRIAL_SELF_SERVICE_CAP 50` (then 100), one approval per stage | the cap | status as above |
| 8 | owner dashboard / measurement, any time after step 4: `AICC_OWNER_OPS_SECTION_ENABLED`, `AICC_FUNNEL_COUNTERS_ENABLED` (+ `AICC_FUNNEL_ALLOWED_ORIGINS` only if the Site posts from another origin), `AICC_MILESTONE_SYNC_SCHEDULED` | each | section F reads sensibly |
| 9 | owner decisions, independent: `AICC_PLAN_CHANGE_ENABLED`, `AICC_PRIVACY_REQUESTS_ENABLED` (only after the retention schedule is confirmed with counsel), `AICC_PAY_RECONCILE_ENABLED` (Commerce, Part B) | each | per the owner guide |

Setting facts in a different order is allowed (the facts file only validates each value); the RENDER refuses an order that would produce an inconsistent file (section 5), so the sequence cannot be skipped by accident.

**Kill switch (no deploy needed for the signup itself):** `wp aicc-trial pause --reason="..."` is immediate. **Rollback of the config:** `sudo aicc-owner-facts unset AICC_TRIAL_SELF_SERVICE_ENABLED` and re-render: the constant disappears and the signup status answers `mode: off`. Unsetting every P37 fact and removing `/etc/aicc-mail/turnstile.secret` returns the golden default file byte for byte. Unsetting `AICC_NOTIFY_ENABLED` stops all lifecycle mail (queued rows wait); it is refused while the switch is still on.

## 5. Refusals (the renderer writes nothing; `--dry-run` shows the same refusal)

Each rule mirrors a Control Plane blocker (`AICC_LM_Signup::blockers()`, `AICC_LM_Trial::mode()`), except the notification rule, which is the notification promise (verification, welcome, reminder and expiry mail) and is stricter than the Control Plane's own signup check.

| Refused set | Why (Control Plane behaviour) |
|---|---|
| self-service ON without a cap, or with a cap that is not 25, 50 or 100 | cap < 1 means mode `off`: the file would claim an open signup that is closed. Any other cap is refused at `set` time |
| self-service ON without the Turnstile site key, or without the Turnstile secret file | blocker `turnstile` (signup reads `paused`) |
| self-service ON without `AICC_TURNSTILE_ENABLED=true` | blocker `turnstile_blocked`: WordPress itself blocks the siteverify call |
| self-service ON without mail (no safe `smtp.env`) | blocker `mail` |
| self-service ON with `AICC_NOTIFY_ENABLED` unset | no outbox or scheduler: the trial mails the signup promises would never be sent |
| `AICC_NOTIFY_ENABLED` without mail | the center would queue mail it can never send |
| site key without the secret file | the widget would render and every verification fail |
| a mail cap without mail; hour cap above the day cap | a cap for a layer that is not running; the day cap would always stop the hour first |
| funnel origins without the funnel switch | configures a route that does not exist |
| payment reconcile without `AICC_LM_PAID_GATEWAYS` | no payment path is configured while Commerce is closed |
| an unsafe or invalid secret file (mode, owner, symlink, size, first line) or a site key equal to the secret | see section 3 |
| any P37 fact on staging | production only |

The fact-only rules also run in `aicc-owner-facts check` (and so in the promotion preflight). The rules that need the host state (is there a safe `smtp.env`, a valid secret file) run in the renderer, with the state it verified, before anything is written.

## 6. Verification

`bash infra/stack-tests/test_p37_wpconfig.sh` (scratch directories, `php`, `python3`, `jq`; no Docker, no network): default render equals the golden file; each toggle renders exactly its lines with the PHP types the Control Plane reads; every inconsistent set above is refused and leaves the previous file untouched; re-render is idempotent; the Turnstile secret and SMTP password appear in no output, log, facts file or rendered file; the activation order above is accepted step by step and the wrong order refused. `bash infra/stack-tests/lint.sh` pins the structure (one region, no P37 constant defined in the template, staging has none, no secret-bearing fact key).

## 7. Edge note for `/start/` (Turnstile in the browser)

`/start/` and its language-prefixed forms are served by WordPress through the edge (`wp_nocache`, `import to_wordpress_nocache`). The Caddy template sets NO `Content-Security-Policy` on WordPress paths (see the comment above `(static_csp)` in `Caddyfile.edge.template`; the global `security_headers` carry only `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options SAMEORIGIN`, `Permissions-Policy`), and the Control Plane theme sends none. Turnstile's script (`https://challenges.cloudflare.com/turnstile/v0/api.js`, loaded by `aicc-start.js`) and its challenge frame are therefore NOT blocked today. If a CSP is ever added to WordPress pages, `https://challenges.cloudflare.com` must be added to `script-src`, `frame-src` and `connect-src` first. `scripts/test-redirects.mjs` pins that `/start/` carries no CSP snippet.
