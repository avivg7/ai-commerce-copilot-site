# Owner activation runbook: opening public Trial issuance (P41)

Written 2026-11-18 (UTC), P41 builder R. **Nothing here has been run against production.** The wp-config part is proved on scratch directories (`infra/stack-tests/test_p41_lineage.sh`, 58 checks, SYNTHETIC facts); the commands that talk to the host are the repository's own tools and the Control Plane's own CLI, cross-checked against the p40 Control Plane source (`aicc-control-plane-worktrees/p40-pricing`, read-only), and are listed with the output the code prints. Everything stays default OFF until step 7.

Read first: `docs/cutover/p37-self-service-wp-config.md` (the constants and refusal rules), `docs/cutover/p38-brevo-host-update.md` (mail), `docs/cutover/p41-wpconfig-lineage.md` (why ONE render yields everything and the `--compare` rule), `docs/cutover/p41-plugin-publication.md` (steps 3 and 6 below).

## 0. The rules of this runbook

* Only the OWNER does these steps (they need the host login, the vault, the Cloudflare and Brevo accounts, the decision to open). The coordinator may type commands with the owner's go.
* **Never re-render wp-config before `--compare` has been read** (section 2). The live file holds five constants that exist only because they are pinned as owner facts.
* Every step is: facts, `--compare`, `--dry-run`, render, PHP-FPM reload, verify. Each step ends with a verification command and its expected output; stop at the first deviation.
* Nothing opens public signup until step 7. Steps 1 to 6 change no public behaviour (the signup status stays `off`; `/start/` stays 404).
* Never paste a Turnstile secret, a Brevo key or a password into chat, git or shell history; the secret goes through a hidden prompt into a root-only file.

Shell helper used below (a function, not a string: a quoted ssh option string once triggered a fail2ban ban; the pinned host key must exist in `~/.ssh/known_hosts_aicc_prod`):

```bash
pssh() { ssh -i ~/.ssh/aicc_cp_prod_operator -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$HOME/.ssh/known_hosts_aicc_prod" aicc@157.230.110.211 "$@"; }
```

## 1. Which blockers are code-enforced, and which are owner or process gates

| Item | Kind | What enforces it | What you see when it is missing |
|---|---|---|---|
| Switch `AICC_TRIAL_SELF_SERVICE_ENABLED` is exactly `true` and cap is an integer >= 1 | **code** (Control Plane `AICC_LM_Trial::mode()`) | public mode `off` | `/start/` 404, pricing shows the inert state |
| Cap is 25, 50 or 100 | **code at render** (`owner-facts set` / renderer) | the renderer refuses any other value | `REFUSED: ... must be exactly 25, 50 or 100` |
| Kill switch `aicc_lm_trial_paused` | **code** | mode `paused` immediately | `wp aicc-trial status`: `paused ... PAUSED` |
| Registration cutoff 2026-12-24T00:00:00Z | **code** (server clock) | mode `closed_cutoff` at and after the instant | status shows `(CLOSED)` |
| Turnstile site key + readable secret FILE (0640 root:aicc-cp) | **code** (`AICC_LM_Signup::blockers()`: `turnstile`) and **render** | public mode `paused`; the renderer refuses the signup switch without them | blocker `turnstile` |
| `challenges.cloudflare.com` allowed for outbound HTTP (`AICC_TURNSTILE_ENABLED` fact adds it to `WP_ACCESSIBLE_HOSTS`) | **code** (`turnstile_blocked`) and **render** | public mode `paused` | blocker `turnstile_blocked` |
| A working mail transport (Brevo API active) | **code** (`mail`) and **render** | public mode `paused` | blocker `mail` |
| Mail breaker closed; P41: mail budget/quota available | **code** (`mail_breaker`; `mail_budget` is added by the P41 Control Plane funnel/signup work: confirm with `status` once it is deployed) | public mode `paused` | blocker `mail_breaker` (and `mail_budget`) |
| Published Terms and Privacy rows with a version | **code** (`legal_documents`) | public mode `paused` | blocker `legal_documents` |
| Real client address (no shared private peer) | **code** (`no_trusted_proxy`) | public mode `paused` | blocker `no_trusted_proxy` (production: REMOTE_ADDR is the client, so absent) |
| Capacity: pending table, daily breaker, new buckets | **code** (`capacity_tripped`) | public mode `paused` for new signups | `dropped_24h:*` rows, an audit row per day |
| `AICC_NOTIFY_ENABLED=true` with the signup switch | **render** (stricter than the Control Plane: the trial promises welcome/reminder/expiry mail) | renderer refuses | `REFUSED: ... needs AICC_NOTIFY_ENABLED=true` |
| Milestone scheduling, owner-ops section, funnel counters | **owner choice** (not required for issuance) | nothing | the owner page has no section F / the funnel stays empty |
| **Legal counsel's review and removal of the "Being finalized" banners** (`AICC_LEGAL_REVIEW_APPROVED`) | **owner / process gate, NOT code-enforced for Trial signup** | nothing in the signup code reads it (the rows only have to exist) | the pages keep saying "Being finalized" |
| **Official Plugin signed and published** | **owner / process gate, NOT enforced by the signup** | the launch gate (`AICC_PRODUCTION=1`) blocks on it, the signup does not: a customer could sign up and find "The plugin download is not available right now" | account panel text |
| **Turnstile widget created in Cloudflare for www.copilt.org** | **owner action** | the secret file and site key cannot exist without it | n/a |
| **Explicit owner authorization to open** | **process gate** | step 7 is the only line that opens; it is reversible by `wp aicc-trial pause` | n/a |
| Independent review and the integrated E2E (journey, Turnstile test-key negatives, mail failure, cross-tenant download) of the P41 heads | **process gate** (coordinator) | nothing | do not start step 7 without them |

## 2. Preconditions (read-only; stop if any deviates)

```bash
# 2.1 the Control Plane that is live is the P41 build and signup is OFF
curl -s https://www.copilt.org/wp-json/aicc/v1/signup/status                 # expect: "open":false and "mode":"off"
curl -s -o /dev/null -w '%{http_code}\n' https://www.copilt.org/start/         # expect: 404

# 2.2 nothing on the host diverged from what a render writes (THE rule): expect IDENTICAL
pssh 'sudo aicc-render-wp-config --env production --confirm-production --compare'
#   expected: a line ending "IDENTICAL: the render equals /srv/aicc/shared/wp-config.php byte for byte (nothing would change)" (exit 0)
#   if DIFFERENT: read the NAMES. Under "removed:" = a live constant that is not a fact (the five P35 constants if their facts were never set):
#   STOP and pin them (p38-brevo-host-update.md step 0). Under "changed:" = a hand edit. Do NOT render.

# 2.3 the host tooling knows every key used below
pssh 'sudo aicc-owner-facts keys' | grep -c -x -E 'AICC_TRIAL_SELF_SERVICE_ENABLED|AICC_TRIAL_SELF_SERVICE_CAP|AICC_TURNSTILE_ENABLED|AICC_TURNSTILE_SITE_KEY|AICC_NOTIFY_ENABLED|AICC_NOTIFY_EXCLUDED_CUSTOMERS|AICC_MILESTONE_SYNC_SCHEDULED|AICC_OWNER_OPS_SECTION_ENABLED|AICC_FUNNEL_COUNTERS_ENABLED'   # expect: 9

# 2.4 the baseline
pssh 'sudo aicc-wp aicc-trial status'
#   expect rows (cap/switch off, public mode off): switch (AICC_TRIAL_SELF_SERVICE_ENABLED) | off ; cap ... | 0 ; policy mode | off ; public mode | off ; blockers | turnstile,turnstile_blocked
#   (legal_documents / mail must NOT be in the list; if they are, fix them first: steps 5 and the Brevo runbook)
pssh 'sudo aicc-owner-facts list | grep -c -E "^AICC_(OWNER_METRICS_TOKEN_FILE|OWNER_METRICS_BASE|OWNER_DASHBOARD_USER_IDS|EA_LAUNCH_OFFER_MODE|OWNER_OPS_SNAPSHOT_FILE|MAIL_PROVIDER)="'    # expect: 6
```

## 3. Cross-check: the names (owner fact -> rendered constant -> the Control Plane's reader)

Checked against the p40 Control Plane source. "Reads" is how the Control Plane interprets the value (`true ===` means the string "true", 1 and "yes" are OFF; the renderer writes the boolean).

| Owner fact (`aicc-owner-facts set`) | Constant the render writes | Reads (Control Plane file) |
|---|---|---|
| `AICC_TRIAL_SELF_SERVICE_ENABLED` `true` | `AICC_TRIAL_SELF_SERVICE_ENABLED` `true` | `true ===` (`class-aicc-lm-trial.php` `switch_enabled`, line 53) |
| `AICC_TRIAL_SELF_SERVICE_CAP` `25` | `AICC_TRIAL_SELF_SERVICE_CAP` integer `25` | integer only; a string reads 0 (`class-aicc-lm-trial.php` `cap`, line 58) |
| `AICC_TURNSTILE_SITE_KEY` `<public key>` | `AICC_TURNSTILE_SITE_KEY` | `^[A-Za-z0-9_-]{8,64}$` (`class-aicc-lm-ea-requests-turnstile.php` `site_key`, line 39) |
| (the file `/etc/aicc-mail/turnstile.secret`) | `AICC_TURNSTILE_SECRET_FILE` = that path | regular file, readable by PHP, no "other" bit (`...-turnstile.php` `read_secret`, line 63) |
| **`AICC_TURNSTILE_ENABLED` `true`** | **no constant**: it appends `challenges.cloudflare.com` to `WP_ACCESSIBLE_HOSTS` | the Control Plane has NO `AICC_TURNSTILE_ENABLED` constant; "Turnstile on" = site key + secret file + the host allowed (`AICC_LM_Signup::turnstile_ready()`, blocker `turnstile_blocked`) |
| (never set) | `AICC_TRIAL_TURNSTILE` is NOT rendered | production always requires Turnstile (`class-aicc-lm-signup.php` `turnstile_mode`) |
| `AICC_NOTIFY_ENABLED` `true` | `AICC_NOTIFY_ENABLED` `true` | `true ===` (`class-aicc-lm-notify.php` `enabled`, line 125) |
| `AICC_NOTIFY_EXCLUDED_CUSTOMERS` `2` | same, string `'2'` | comma list of user ids (`class-aicc-lm-notify-exclusion.php`, line 32) |
| `AICC_MILESTONE_SYNC_SCHEDULED` `true` | same | `true ===`; registers the hourly event `aicc_lm_backend_milestones_sync` (`class-aicc-lm-backend-milestones.php` lines 31, 57, 67) |
| `AICC_OWNER_OPS_SECTION_ENABLED` `true` | same | `true ===` (`class-aicc-lm-owner-ops.php` line 49) |
| `AICC_FUNNEL_COUNTERS_ENABLED` `true` | same | `true ===` (`class-aicc-lm-funnel.php` line 83) |
| Mail (already live): `AICC_MAIL_PROVIDER` `brevo_api` + sender facts + key FILE | `AICC_MAIL_ENABLED` `true`, `AICC_MAIL_PROVIDER`, `AICC_MAIL_API_KEY_FILE`, ... | `class-aicc-lm-mail.php` lines 133-197 |

## 4. Steps

### Step 1. Turnstile: the widget (owner, Cloudflare) and the secret file (owner, host)

1. In the Cloudflare dashboard (Turnstile), create a widget for the hostname **www.copilt.org** (the Control Plane binds the verification to the site's own host and to the widget action `signup`, which the page sets; nothing to configure for the action). Copy the PUBLIC site key. Keep the secret key out of every file except step 2.
2. Place the secret (hidden prompt; root-only; 0640 root:aicc-cp, the permissions the renderer demands):

```bash
pssh -t 'sudo bash -c '"'"'umask 027; read -rsp "Turnstile secret key: " k; echo; install -o root -g aicc-cp -m 0640 /dev/null /etc/aicc-mail/turnstile.secret; printf "%s\n" "$k" > /etc/aicc-mail/turnstile.secret; unset k'"'"''
pssh 'sudo stat -c "%U:%G %a %s" /etc/aicc-mail/turnstile.secret'          # expect: root:aicc-cp 640 <key length + 1>
```

3. Facts, compare, render (the order of the two `set` lines does not matter; the render checks the set):

```bash
pssh 'sudo aicc-owner-facts set AICC_TURNSTILE_ENABLED true'
pssh 'sudo aicc-owner-facts set AICC_TURNSTILE_SITE_KEY <the PUBLIC site key>'
pssh 'sudo aicc-render-wp-config --env production --confirm-production --compare'
#   expect: DIFFERENT; removed: -; added: AICC_TURNSTILE_SECRET_FILE, AICC_TURNSTILE_SITE_KEY; changed: WP_ACCESSIBLE_HOSTS
pssh 'sudo aicc-render-wp-config --env production --confirm-production --dry-run'      # turnstile secret file valid (constant rendered, content never read into the output)
pssh 'sudo aicc-render-wp-config --env production --confirm-production && sudo systemctl reload php8.3-fpm'
pssh 'sudo aicc-render-wp-config --env production --confirm-production --compare'      # expect: IDENTICAL
```

Verify: `pssh 'sudo aicc-wp aicc-trial status'` -> `turnstile mode | required`, and the blockers no longer contain `turnstile` or `turnstile_blocked` (public mode still `off`: the switch is not set).
Rollback: `aicc-owner-facts unset AICC_TURNSTILE_SITE_KEY` + `unset AICC_TURNSTILE_ENABLED` + render + reload (the file may stay). A secret that appeared anywhere else: rotate it in Cloudflare.

### Step 2. Notification switch (verification, welcome, reminder and expiry mail)

```bash
pssh 'sudo aicc-wp user list --role=customer --fields=ID,user_login'          # confirm the id of the account that must get no lifecycle mail (the operator-granted test account)
pssh 'sudo aicc-owner-facts set AICC_NOTIFY_EXCLUDED_CUSTOMERS 2'              # BEFORE the switch; do NOT list the account you will use for the self-test in step 8
pssh 'sudo aicc-owner-facts set AICC_NOTIFY_ENABLED true'
pssh 'sudo aicc-render-wp-config --env production --confirm-production --compare'      # expect added: AICC_NOTIFY_ENABLED, AICC_NOTIFY_EXCLUDED_CUSTOMERS; removed: -; changed: -
pssh 'sudo aicc-render-wp-config --env production --confirm-production && sudo systemctl reload php8.3-fpm'
```

Verify: `pssh 'sudo aicc-wp aicc-notify status'` -> JSON with `"enabled": true` and `"mail_ready": true`; `pssh 'sudo aicc-wp aicc-notify run'` -> `{"ran":true,...}` (a tick with nothing queued). The system timer runs the tick every 5-7 minutes (`docs/notify-scheduling.md`).
Rollback: `unset AICC_NOTIFY_ENABLED` (refused while the signup switch is still set: that is the rule) + render.

### Step 3. Milestone scheduling (the Backend onboarding milestones mirrored into the owner funnel; optional for issuance, needed for the journey view)

Needs the owner-metrics token file already pinned (`AICC_OWNER_METRICS_TOKEN_FILE`, P35).

```bash
pssh 'sudo aicc-owner-facts set AICC_MILESTONE_SYNC_SCHEDULED true'
pssh 'sudo aicc-render-wp-config --env production --confirm-production --compare'      # added: AICC_MILESTONE_SYNC_SCHEDULED only
pssh 'sudo aicc-render-wp-config --env production --confirm-production && sudo systemctl reload php8.3-fpm'
```

Verify: `pssh 'sudo aicc-wp cron event list --fields=hook,next_run_relative | grep aicc_lm_backend_milestones_sync'` shows the hourly event; `pssh 'sudo aicc-wp aicc-ops milestones sync'` prints a counts table and exits 0 (without the token it makes no request and says why). Rollback: `unset` + render (the event is removed by the next request).

### Step 4. Owner dashboard: ops section F and funnel counters

```bash
pssh 'sudo aicc-owner-facts set AICC_OWNER_OPS_SECTION_ENABLED true'
pssh 'sudo aicc-owner-facts set AICC_FUNNEL_COUNTERS_ENABLED true'
pssh 'sudo aicc-render-wp-config --env production --confirm-production --compare'      # added: AICC_FUNNEL_COUNTERS_ENABLED, AICC_OWNER_OPS_SECTION_ENABLED
pssh 'sudo aicc-render-wp-config --env production --confirm-production && sudo systemctl reload php8.3-fpm'
```

Verify (browser, signed in as an allow-listed administrator): wp-admin, AICC Licenses, AICC Owner: the nav shows section F "Self-service operations"; the funnel cards read zero. Rollback: `unset` both + render.

### Step 5. Legal publication gate

Code check (the only code-enforced part: rows exist with a version):

```bash
pssh 'sudo aicc-wp eval '"'"'$v = AICC_LM_Signup::legal_versions(); echo $v ? "terms " . $v["terms"] . " privacy " . $v["privacy"] : "NOT PUBLISHED"; echo PHP_EOL;'"'"''     # expect: terms 2.0 privacy 2.0
pssh 'sudo aicc-wp aicc-trial status' | grep blockers                       # must not contain legal_documents
```

Process gate (owner and counsel, not enforced by code): the published pages still carry the "Being finalized" banner until `AICC_LEGAL_REVIEW_APPROVED=true` is set as an owner fact (`aicc-owner-facts set AICC_LEGAL_REVIEW_APPROVED true`, then `--compare`/render/reload). Decide this BEFORE opening: a signup records the Terms and Privacy versions it accepted, so republishing versions mid-flight splits the records. Opening with the banner is a conscious decision (the signup form's own terms block states the one-store, no-payment trial).

### Step 6. Plugin: sign offline and publish (owner, then coordinator with the owner's approval)

Follow `docs/cutover/p41-plugin-publication.md` sections 1 to 6 for the P41 successor (1.1.2) or the approved 1.1.1 (`$SITE` and the other variables are defined in its section 1): sign with `sign-plugin-release.sh`, `check-host-signing-keys.sh`, production dry run, `--apply --set-current`, then the verification:

```bash
bash "$SITE/infra/release/verify-published-plugin.sh" --mode production --base-url https://www.copilt.org --version <V> --sha256 <SHA> \
  --manifest <...manifest.json> --sig <...manifest.sig> --plugin-dir <Plugin checkout> --expect-key-id 9d49-041f-0ced-13ac --local-zip <ZIP> --credentials-file ~/aicc-verify-creds.env --out ~/aicc-verify-<V>
#   expect: ... verify-published-plugin: 30 checks, 30 passed, 0 FAILED   (exit 0; 31 with --previous-version; every line PASS)
pssh 'sudo env AICC_PRODUCTION=1 aicc-wp eval-file /var/lib/aicc-cp/seed/check-launch-blockers.php' | grep -i -E 'plugin (download|release)'
#   expect: "Plugin download: current release <V>, <bytes> bytes, sha256 ... (verified now)." and "Plugin release <V> is signed (key 9d49-041f-0ced-13ac, ...) ..."
```

Then record the ZIP's SHA-256 for the Site's `AICC_EA_PLUGIN_RELEASE_SHA256` (publication doc section 8).

### Step 7. OPEN public Trial issuance (the explicit authorization)

Do this only when steps 1-6 are green, the coordinator confirms the independent review and the integrated E2E passed, and you have decided to open. First place for 25 stores (the approved first stage); 50 and 100 are later, one approval each.

```bash
pssh 'sudo aicc-owner-facts set AICC_TRIAL_SELF_SERVICE_CAP 25'
pssh 'sudo aicc-owner-facts set AICC_TRIAL_SELF_SERVICE_ENABLED true'
pssh 'sudo aicc-render-wp-config --env production --confirm-production --compare'      # expect added: AICC_TRIAL_SELF_SERVICE_CAP, AICC_TRIAL_SELF_SERVICE_ENABLED; removed: -; changed: -
pssh 'sudo aicc-render-wp-config --env production --confirm-production --dry-run'      # a refusal here names the missing piece (no secret file, no mail, no notify, no cap): fix it, nothing was written
pssh 'sudo aicc-render-wp-config --env production --confirm-production && sudo systemctl reload php8.3-fpm'
pssh 'sudo aicc-render-wp-config --env production --confirm-production --compare'      # expect IDENTICAL
```

Verify (all three):

```bash
pssh 'sudo aicc-wp aicc-trial status'
#   switch (AICC_TRIAL_SELF_SERVICE_ENABLED) | ON
#   cap (AICC_TRIAL_SELF_SERVICE_CAP)        | 25
#   paused (aicc_lm_trial_paused)            | no
#   registration cutoff (UTC)                | 2026-12-24T00:00:00Z (open)
#   policy mode                              | open
#   public mode                              | open          <- "paused" means a blocker remains: read the next row
#   turnstile mode                           | required
#   blockers                                 | none
curl -s https://www.copilt.org/wp-json/aicc/v1/signup/status           # expect: "open":true,"mode":"open" and a coarse cap_bucket (many/some/few), never an exact number
curl -s -o /dev/null -w '%{http_code}\n' https://www.copilt.org/start/   # expect: 200
```

### Step 8. First live self-test with your OWN mailbox (immediately after step 7; it uses 1 of the 25 places)

In a private browser window: open the pricing page, choose a plan, follow the real CTA to `/start/`, enter your own mailbox (an address you own, not an operator account), accept the terms, solve Turnstile, submit. Then:

1. The verification mail arrives from `notifications@copilt.org` with Reply-To `support@copilt.org`; the link opens the password page; set a password (the account exists only now).
2. You land on the "done" page; sign in; the account shows the checklist; Plans & Stores shows the launch trial (one store, ends 2026-12-31T22:00:00Z) and the plugin download (version, SHA-256, signing key). Download it and compare: `shasum -a 256 <file>` equals the page and the value recorded in step 6.
3. Install it on your own test store, connect (the Connect popup), let it sync, and watch the checklist (the P41 plugin/Control Plane builds define the later stages).

Evidence from the host (counts and codes only, never an address):

```bash
pssh 'sudo aicc-wp aicc-trial status'        # issued +1; places left 24; signups completed 1; dropped_24h:mail_failed 0
pssh 'sudo aicc-wp aicc-notify status'       # the verify_email notification sent
pssh 'sudo aicc-wp aicc-mail usage'          # budget used +1 (verification mail), still below the daily budget 240
```

Brevo (your browser): the message shows requests + delivered; SPF/DKIM/DMARC pass on the received headers. If the mail does not arrive: `dropped_24h:mail_failed` > 0 or the P41 `mail_budget` blocker explains it; run `pssh 'sudo aicc-wp aicc-mail check'` (config, key, `api.brevo.com` reachable, auth). Do NOT retry in a loop: pause (step 9) first.

### Step 9. The kill switch, and the rollbacks

| Need | Command | Effect |
|---|---|---|
| **Stop new signups and issuance now** (no deploy, immediate) | `pssh 'sudo aicc-wp aicc-trial pause --reason="owner stop: <8-300 characters, no e-mail address>"'` -> `Success: Paused. Mode is now paused.` | public mode `paused`; `/start/` answers paused; existing accounts and trials are untouched |
| Resume | `pssh 'sudo aicc-wp aicc-trial resume --reason="<why>"'` -> `Success: Resumed. Mode is now open.` | open again (if no blocker) |
| Close it in the configuration | `pssh 'sudo aicc-owner-facts unset AICC_TRIAL_SELF_SERVICE_ENABLED'`, `--compare` (removed: that constant), render, reload | mode `off` |
| Everything back to the live state of today | `unset` the facts of steps 1-4 and 7, remove `/etc/aicc-mail/turnstile.secret`, render: `--compare` must then say IDENTICAL to the P38 state | the five P35 constants and Brevo stay (they are facts) |

Verify a pause: `pssh 'sudo aicc-wp aicc-trial status' | grep -E 'paused|public mode'` -> `PAUSED` and `paused`.

## 5. After opening: what to watch

`wp aicc-trial status` (issued, places left, `dropped_24h:*` reasons), the owner page section F, `wp aicc-mail usage` (daily budget 240), Brevo's activity page. Raise the cap only by `set AICC_TRIAL_SELF_SERVICE_CAP 50` (then 100) with one approval each. The registration cutoff (2026-12-24T00:00:00Z) and the trial end (2026-12-31T22:00:00Z) are enforced by the server clock; the Jan-10 extension stays inactive and unadvertised.

## 6. Open issues for the owner (read before step 7)

1. The exact `wp aicc-trial status` and `signup/status` outputs above are what the p40 Control Plane code prints; the P41 Control Plane branches (signup, funnel) add rows/blockers (`mail_budget`, per-customer journey); the expected blocker list is "none" in every build.
2. The notify exclusion id `2` and the owner-dashboard allow-list `1` are the ids recorded in the P35/P37 notes; confirm them on the host (`user list`) rather than trusting this text.
3. `AICC_LEGAL_REVIEW_APPROVED` is the owner's and counsel's decision; nothing in the signup code requires it.
4. The Plugin publication is NOT a code gate for the signup; open only after step 6 passes or accept that new trials will see "not available right now".
5. `AICC_EA_PLUGIN_RELEASE_SHA256` / `scripts/data/ea-plugin-releases.json` must list the published ZIP before a Site announce/open build (publication doc section 8).
