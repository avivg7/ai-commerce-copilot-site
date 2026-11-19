# P38 Brevo transactional e-mail: the host tooling update and the activation runbook

Written 2026-11-14 (UTC). **Nothing in this file has been run against a host.** It describes the behaviour of `infra/provision/render-wp-config.sh`, `infra/provision/lib/owner_facts.py`, the P38 region of `infra/provision/wp-config.production.template.php`, `infra/provision/set-brevo-key.sh` (Mac) and `infra/provision/host/aicc-set-brevo-key` (host), proved by `infra/stack-tests/test_p38_brevo.sh` and `test_p38_key.sh` (scratch directories and a fake host only: no network, no real key, no server).

Facts the owner confirmed: Brevo Free plan (300 e-mails a day), authenticated domain `copilt.org`, branded tracking subdomain `mail.copilt.org`, verified sender `AI Commerce Copilot <notifications@copilt.org>`, Reply-To `support@copilt.org`, a restricted API key (Transactional Email only). Production wp-config today: `WP_HTTP_BLOCK_EXTERNAL=true`, `WP_ACCESSIBLE_HOSTS='api.copilt.org'`, no `AICC_MAIL_*` constants, `/etc/aicc-mail/` empty (`root:aicc-cp 0750`), WP-Cron driven by the systemd timer.

## 1. What this is, in six lines

1. The Control Plane (branch `feat/p38-brevo`, `docs/mail-brevo.md` there) sends mail through Brevo's HTTPS API when `AICC_MAIL_PROVIDER === 'brevo_api'`. It reads the key from a FILE named by `AICC_MAIL_API_KEY_FILE`; a key constant is refused by the Control Plane itself.
2. This change makes the production wp-config renderer able to write those constants. **Default OFF, byte-identical:** with no P38 fact and no key file the render is the golden file of today (`stack-tests/golden/wp-config.production.no-owner-facts.php`), proved against the pre-P38 renderer from git for every host state we can build.
3. **The key is a file, never a fact, never a constant, never in the rendered wp-config.** `/etc/aicc-mail/brevo-api.key`, `root:aicc-cp 0640`, placed by the OWNER with `set-brevo-key.sh` (hidden prompt, key on the ssh connection's stdin only).
4. `api.brevo.com` is added to `WP_ACCESSIBLE_HOSTS` (exactly once, never a wildcard) only while the Brevo region is rendered.
5. Brevo configuration activates **nothing else**: no `AICC_NOTIFY_ENABLED`, no public signup, no campaign, no scheduler, no December reminder. Those stay separate owner facts (`docs/cutover/p37-self-service-wp-config.md`).
6. Every step is reversible: unset one fact and re-render (section 7), or restore the previous bundle (section 4.7).

## 2. The constants (names checked against the Control Plane source, worktree `p38-brevo`, 2026-11-14)

"true" means the exact PHP boolean. The Control Plane reads `true === AICC_MAIL_ENABLED`; integers are integers (a string reads as 0).

| Constant | Rendered as | From | Control Plane reading |
|---|---|---|---|
| `AICC_MAIL_ENABLED` | `true` | the region exists (provider fact + valid key file) | `class-aicc-lm-mail.php`: exactly `true` |
| `AICC_MAIL_PROVIDER` | `'brevo_api'` | fact `AICC_MAIL_PROVIDER=brevo_api` | `'smtp'` (default) or `'brevo_api'`; anything else = `bad_provider` |
| `AICC_MAIL_API_KEY_FILE` | `'/etc/aicc-mail/brevo-api.key'` | fixed path | `class-aicc-lm-mail-secret.php` + `secure_read()`: regular file, not a symlink, root-owned, no "other" bits, not group-writable, outside the web root; first line `[A-Za-z0-9_-]{20,200}` |
| `AICC_MAIL_FROM_ADDRESS` | string | fact (required with the provider; only `@copilt.org`) | the one sender; its domain must be in `AICC_MAIL_ALLOWED_FROM_DOMAINS` |
| `AICC_MAIL_FROM_NAME` | string | fact, default `AI Commerce Copilot` (printable, at most 70 characters) | cut to 70 characters |
| `AICC_MAIL_REPLY_TO` | string | fact, default `support@copilt.org` (same as `AICC_LEGAL_SUPPORT_EMAIL`) | Reply-To of every message |
| `AICC_MAIL_ALLOWED_FROM_DOMAINS` | `array( 'copilt.org' )` | fixed | array of domains |
| `AICC_MAIL_DAILY_BUDGET` | integer | fact, default 240, 1 to 300, never above the day cap | clamped to 1..300 and to `AICC_MAIL_MAX_PER_DAY` |
| `AICC_MAIL_TEST_RECIPIENTS` | one comma string | fact (1 to 5 exact addresses), absent by default = every `send-test --kind` refused | `class-aicc-lm-mail-ops.php`: array or comma list, lower-cased, exact match |
| `AICC_MAIL_STATUS_POLL_ENABLED` | `true` | fact (`true` only), absent by default | registers ONE ten-minute WP-Cron event (`reconcile()`) |
| `AICC_MAIL_MAX_PER_HOUR`, `AICC_MAIL_MAX_PER_DAY` | integers | the existing P37 facts, rendered in the P37 region | existing caps; with Brevo both are at most 300 |
| `WP_ACCESSIBLE_HOSTS` | `'api.copilt.org[,<owner hosts>][,challenges.cloudflare.com],api.brevo.com'` | built by the renderer | `wp_safe_remote_request` host allow-list |

Not rendered, ever, by this region: `AICC_MAIL_API_KEY` (refused by the Control Plane), `AICC_MAIL_SMTP_*`, `AICC_MAIL_SECRETS_FILE` (the SMTP region is replaced by one comment line while Brevo is the transport), `AICC_NOTIFY_ENABLED` and every campaign / scheduler / self-service switch, `AICC_MAIL_STATUS_MAX_CALLS_PER_HOUR`, the reserve / class caps (their code defaults stand).

## 3. Owner facts and the render rules

Facts live in `/etc/aicc/owner-facts.env` (root, 0600), set with `sudo aicc-owner-facts set KEY VALUE`, validated by the same code the renderer runs. Staging refuses all of them.

| Fact | Accepts | Notes |
|---|---|---|
| `AICC_MAIL_PROVIDER` | `brevo_api` or `smtp` | THE switch. `smtp` only says "use the smtp.env layer" (it matters when both secret files exist) |
| `AICC_MAIL_FROM_ADDRESS` | `local@copilt.org` | a sender on any other domain, a subdomain, a list or a display name is refused; the domain is stored lower-case |
| `AICC_MAIL_FROM_NAME` | printable text, at most 70 characters | no control character, no `<`, `>`, `"`, `@@`; apostrophe and backslash are kept and escaped as a PHP literal |
| `AICC_MAIL_REPLY_TO` | `local@copilt.org` only (same allowed-domain rule as the sender; stored with the domain lower-case) | replies must land on our own domain; `AICC_LEGAL_SUPPORT_EMAIL` keeps its own rule |
| `AICC_MAIL_DAILY_BUDGET` | integer 1 to 300 | at most `AICC_MAIL_MAX_PER_DAY` when that is set; with a day cap below 240 the budget must be set explicitly |
| `AICC_MAIL_TEST_RECIPIENTS` | 1 to 5 exact addresses, comma separated | personal data: `aicc-owner-facts list` shows `o***@gmail.com`; the facts file (root, 0600) and the rendered config (`root:aicc-cp 0640`) hold the real value; `export` is the explicit full copy; refusal messages never echo it. Set it with `sudo aicc-owner-facts set-stdin AICC_MAIL_TEST_RECIPIENTS` (value on stdin: in no command line, no `ps`, no sudo log) |
| `AICC_MAIL_STATUS_POLL_ENABLED` | exactly `true` | refused at render without the provider fact |
| `AICC_MAIL_MAX_PER_HOUR` / `_PER_DAY` (existing) | whole numbers | with `brevo_api` both at most 300 (the Free plan's day), hour at most day |

**Which transport the render uses** (one function, `owner_facts.mail_mode`, shared by the preflight check, the renderer and the dry run):

| Provider fact | `smtp.env` | key file | Result |
|---|---|---|---|
| absent | no | no | no mail region (today) |
| absent | yes | no | the SMTP region (today) |
| absent | no | yes | no mail region; a note: the key is ignored until the fact is set |
| absent | yes | yes | **REFUSED**: both secret files, the render will not guess |
| `brevo_api` | any | valid | the Brevo region; the SMTP region is not rendered (the explicit fact decides) |
| `brevo_api` | any | absent | **no mail** (a warning): never half-enabled, and a rebuilt host with the facts but without the secret can still render |
| `smtp` | yes | any | the SMTP region |
| `smtp` | no | any | no mail (a warning) |

A key file that EXISTS but is unsafe or malformed REFUSES whatever the facts say (mode other than 0640 or 0440, not `root:aicc-cp`, a symlink, a directory, not 20 to 256 bytes, more than one line, first line outside `[A-Za-z0-9_-]{20,200}`, an `xsmtpsib-` SMTP key). The renderer never prints, copies or renders its content: the shape check runs in one `python3 -I` process, so no shell variable exists for `bash -x` to trace.

Other refusals (nothing is written; `--dry-run` shows the same refusal): the provider without `AICC_MAIL_FROM_ADDRESS`; a daily budget above the day cap, above 300, or a day / hour cap above 300 with Brevo; the status poll without `brevo_api`; `api.brevo.com` (or any `*.brevo.com`) as an extra outbound host, with or without the provider fact; `AICC_NOTIFY_ENABLED`, caps or the self-service switch while no transport is ready (the existing P37 rules now count Brevo as a transport). Sender, name, reply-to, budget and test-recipient facts without the provider are inert (a note), which is what makes `unset AICC_MAIL_PROVIDER` a one-command way to turn Brevo off.

New renderer option: `--compare` renders to a temporary file (inside the 0700 secrets directory, mode 0600, removed by the trap, any leftover of a killed run swept at the next run; never in /tmp) and tells you whether it equals the current output: `IDENTICAL` (exit 0) or `DIFFERENT` (exit 4) with the constant NAMES added, removed or changed (never a value). It writes nothing and needs the normal root and secrets.

## 3b. Step 0 before any render: pin the P35 hand-added constants as owner facts

**Why.** On 2026-11-13 the P35 gates appended five constants BY HAND to the live `/srv/aicc/shared/wp-config.php` (script `execution-reset/cp-dark/p35/b2-exec/wpconfig-add.sh`, three blocks inserted before the `// ---- bootstrap` banner in the order B2, OFFER, SNAP; backup sizes 12395, 12812, 13004 bytes in the evidence logs). The renderer rewrites the whole file, so ANY render (Brevo, the P37 switches, a restore) would silently remove them: the owner dashboard would lose its Backend metrics, the ops snapshot and the launch-offer `announce` mode. The new renderer's `--compare` against the live file said DIFFERENT for exactly these five names. They are now production-only owner facts, rendered as the SAME three delimited, commented blocks (same comment lines, same order, one blank line after each block), so a render reproduces the live file byte for byte. With no such fact the render is the golden file, unchanged.

**Complete list.** Reading every script and log in the p34, p35 and p36 evidence folders: the only hand-appended wp-config constants are these five (p34 touched no wp-config line, `p36/deploy-exec/run-p36-deploy.sh` states "No wp-config change", and nothing else in p35 edits the file: the other `define(` hits are the Plugin's own constants and a throwaway rehearsal config).

| Block | Constant | Fact (production only) | Value on the live host | Accepted by the fact |
|---|---|---|---|---|
| B2 | `AICC_OWNER_METRICS_TOKEN_FILE` | same name | `/srv/aicc/shared/owner-metrics.token` | an absolute path under `/srv/aicc/shared/` naming one file: letters, digits, `. _ -`, no hidden segment, no `..`, no trailing slash, at most 4 segments, not inside `uploads` or `plugin-releases`, not `wp-config*`. The renderer never reads the file |
| B2 | `AICC_OWNER_METRICS_BASE` | same name | `https://api.copilt.org` | exactly that origin (the Control Plane accepts no other Backend host in production: no path, no port, no slash) |
| B2 | `AICC_OWNER_DASHBOARD_USER_IDS` | same name | `1` | a comma list of positive whole numbers (the Control Plane's own pattern; stored without blanks, rendered as a string) |
| OFFER | `AICC_EA_LAUNCH_OFFER_MODE` | same name | `announce` | exactly `announce`. The Control Plane also knows `open`, which needs the request intake and the mail-provider constant; that stays a separate reviewed step (the fact refuses it). Unset = off |
| SNAP | `AICC_OWNER_OPS_SNAPSHOT_FILE` | same name | `/srv/aicc/shared/owner-ops-snapshot.json` | same path rule as the token file |

**Do this once, before the first render of any kind (after section 4 has put the tooling on the host):**

```bash
export PSSH=~/aicc-promotion/pssh
$PSSH 'sudo aicc-owner-facts set AICC_OWNER_METRICS_TOKEN_FILE /srv/aicc/shared/owner-metrics.token'
$PSSH 'sudo aicc-owner-facts set AICC_OWNER_METRICS_BASE https://api.copilt.org'
$PSSH 'sudo aicc-owner-facts set AICC_OWNER_DASHBOARD_USER_IDS 1'
$PSSH 'sudo aicc-owner-facts set AICC_EA_LAUNCH_OFFER_MODE announce'
$PSSH 'sudo aicc-owner-facts set AICC_OWNER_OPS_SNAPSHOT_FILE /srv/aicc/shared/owner-ops-snapshot.json'
$PSSH 'sudo aicc-render-wp-config --env production --confirm-production --compare'
```
Expectation: **`IDENTICAL`** (exit 0). The facts are not rendered by this step: `--compare` writes nothing. If it says DIFFERENT, read the constant names it prints (never values): a name under `added` or `changed` means the live file differs from the facts you just set (check the five values above against `sudo grep -n "AICC_OWNER\|AICC_EA_LAUNCH" /srv/aicc/shared/wp-config.php`); a name under `removed` means a hand-added line the facts do not cover: STOP, do not render, and add it as a fact or find out who added it. Only after `IDENTICAL` is a first real render safe: from then on `aicc-render-wp-config` preserves the five constants and `--compare` stays the gate before every render in sections 6 and 7. Without Step 0, `--compare` against the live file lists exactly `AICC_EA_LAUNCH_OFFER_MODE, AICC_OWNER_DASHBOARD_USER_IDS, AICC_OWNER_METRICS_BASE, AICC_OWNER_METRICS_TOKEN_FILE, AICC_OWNER_OPS_SNAPSHOT_FILE` as `removed` (proved against a synthetic live file built exactly as the P35 script built it).

Rollback of Step 0: `sudo aicc-owner-facts unset <KEY>` for each (the live file is not touched by `set` or `unset`; only a render changes it).

## 4. Getting the new tooling onto the host (reversible; no behaviour change until a fact is set)

How the host gets its tools: `infra/provision/push-bundle.sh` mirrors `infra/` and `scripts/ops/` (rsync `-a --delete`, secret-looking names excluded) into `~aicc/aicc-infra-bundle` on the host; `install-stack.sh --only scripts` then copies the files into `/usr/local/lib/aicc/` and `/usr/local/sbin/` (previous versions are kept under `/var/backups/aicc-config/<UTC>/`). The tools this change touches:

| Host path | Source | How it gets there |
|---|---|---|
| `/usr/local/sbin/aicc-render-wp-config` | symlink to `/usr/local/lib/aicc/provision/render-wp-config.sh` | `install-stack.sh --only scripts` |
| `/usr/local/lib/aicc/provision/lib/owner_facts.py`, `lib/common.sh`, `wp-config.production.template.php` (and the stage one) | `infra/provision/...` | same |
| `/usr/local/sbin/aicc-owner-facts` | symlink to `/usr/local/lib/aicc/provision/owner-facts.sh` | same |
| `/usr/local/sbin/aicc-set-brevo-key` (new) | `infra/provision/host/aicc-set-brevo-key`, 0755 root:root | same |
| `~aicc/aicc-infra-bundle/infra/provision/*` | the bundle itself (the promotion runbook calls the renderer from here too) | `push-bundle.sh` |

### 4.1 Mac pre-checks

```bash
export SITE=~/self_projects/ai_copilot_site-worktrees/<the integrated Site checkout that contains feat/p38-brevo-infra>   # never an older infra tree: the push MIRRORS (--delete)
export PSSH=~/aicc-promotion/pssh HOSTIP=157.230.110.211 NEWID="$(cat ~/aicc-promotion/NEWID)"   # NEWID = 3e897286ce82e55f4d866acf0d526a5f
cd "$SITE" && git status --short && git log -1 --format='%h %s'                 # clean tree, the head you mean to push
npm run infra:lint && bash infra/stack-tests/test_p38_brevo.sh && bash infra/stack-tests/test_p38_key.sh && bash infra/stack-tests/test_p37_wpconfig.sh && bash infra/stack-tests/test_provision.sh | tail -1
```

### 4.2 Host pre-checks (read-only)

```bash
$PSSH 'grep -E "^AICC_(ENV|HOSTNAME|STAGE_ID)=" /etc/aicc-stage-identity; df -h / | tail -1; du -sh ~/aicc-infra-bundle; stat -c "%U:%G %a %n" /etc/aicc-mail; ls -A /etc/aicc-mail'
$PSSH 'sudo aicc-owner-facts list; sudo aicc-render-wp-config --env production --confirm-production --dry-run'
$PSSH 'sudo sha256sum /srv/aicc/shared/wp-config.php /usr/local/lib/aicc/provision/render-wp-config.sh /usr/local/lib/aicc/provision/lib/owner_facts.py /usr/local/lib/aicc/provision/wp-config.production.template.php'   # hashes only: NEVER cat wp-config.php
```
Expect: `AICC_ENV=production`, `AICC_HOSTNAME=www.copilt.org`, `AICC_STAGE_ID=3e897286ce82e55f4d866acf0d526a5f`; at least 500 MiB free; `/etc/aicc-mail` is `root:aicc-cp 750` and holds no `brevo-api.key`; the facts list shows no `AICC_MAIL_PROVIDER`; the dry run says `mail layer not enabled` (or `ENABLED (transport: smtp)` if an `smtp.env` was placed). Write the three hashes down: they are the rollback evidence.

### 4.3 Snapshot the current bundle (the rollback copy)

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ); echo "$TS" > /tmp/p38-ts
$PSSH "cp -a ~/aicc-infra-bundle ~/aicc-infra-bundle.pre-p38-$TS && ls -d ~/aicc-infra-bundle.pre-p38-$TS"
```

### 4.4 See exactly what will change on the host (read-only)

```bash
cd "$SITE"
(find infra scripts/ops -type f ! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/__pycache__/*' ! -name '*.pyc' ! -name '.env*' ! -name '*.pem' ! -name '*.key' ! -path '*/aicc-ops/tests/*' ! -path '*/sentinel/tests/*' ! -name .DS_Store -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256) > /tmp/p38-mac.sha
$PSSH 'cd ~/aicc-infra-bundle && find infra scripts/ops -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum' > /tmp/p38-host.sha
diff /tmp/p38-host.sha /tmp/p38-mac.sha | awk '{print $1, $3}' | sort -k2 | uniq     # '<' host today, '>' after the push; a path only on the left would be DELETED by the push
bash infra/provision/push-bundle.sh --env production --stage-ip $HOSTIP --stage-host www.copilt.org --expect-id "$NEWID" --key ~/.ssh/aicc_cp_prod_operator --known-hosts ~/.ssh/known_hosts_aicc_prod --dry-run | tail -40
```
The content diff is the truth (rsync's `-a` also lists files whose modification time differs). The expected P38 set is: `infra/provision/render-wp-config.sh`, `lib/owner_facts.py`, `wp-config.production.template.php`, `install-stack.sh`, `set-brevo-key.sh`, `host/aicc-set-brevo-key`, the three `infra/stack-tests/` files and `lint.py` / `test_lint.sh` / `run-all.sh`. Anything else in the diff is an earlier merge that never reached the host (for example P37 infra): read each before you continue. **Stop if a path appears only on the host side that you did not expect to lose.**

### 4.5 Push, then install

```bash
bash infra/provision/push-bundle.sh --env production --stage-ip $HOSTIP --stage-host www.copilt.org --expect-id "$NEWID" --key ~/.ssh/aicc_cp_prod_operator --known-hosts ~/.ssh/known_hosts_aicc_prod
$PSSH 'cd ~/aicc-infra-bundle && sudo infra/provision/install-stack.sh --production-host --confirm-production --dry-run --only scripts' | grep -E 'would:|diff|^[-+]' | head -80
```
The dry run prints `DRY-RUN would: replace <path>` plus a diff for every installed file that would change, and `create /usr/local/sbin/aicc-set-brevo-key`. Read it. The `scripts` step only copies files and creates symlinks (no service is restarted, no unit touched). Then:
```bash
$PSSH 'cd ~/aicc-infra-bundle && sudo infra/provision/install-stack.sh --production-host --confirm-production --only scripts' | tail -30
$PSSH 'cd ~/aicc-infra-bundle && sudo infra/provision/install-stack.sh --production-host --confirm-production --dry-run --only scripts' | grep -c 'would:'     # expect 0: everything installed
```

### 4.6 Post-checks: nothing changed until a fact is set

```bash
$PSSH 'ls -l /usr/local/sbin/aicc-set-brevo-key /usr/local/sbin/aicc-owner-facts /usr/local/sbin/aicc-render-wp-config'      # 0755 root:root file; two symlinks into /usr/local/lib/aicc/provision
shasum -a 256 infra/provision/host/aicc-set-brevo-key; $PSSH 'sudo sha256sum /usr/local/sbin/aicc-set-brevo-key'                # identical hashes
$PSSH 'sudo aicc-owner-facts keys' | grep -c '^AICC_MAIL_'                                                                    # 9 (seven P38 facts + the two caps)
$PSSH 'sudo aicc-render-wp-config --env production --confirm-production --compare'                                            # IDENTICAL (exit 0): the NO-FACT render equals today's wp-config.php byte for byte
$PSSH 'sudo aicc-render-wp-config --env production --confirm-production --dry-run'                                            # mail layer not enabled; brevo api key file absent
$PSSH 'sudo aicc-set-brevo-key status'                                                                                         # absent: /etc/aicc-mail/brevo-api.key
$PSSH 'sudo sha256sum /srv/aicc/shared/wp-config.php'                                                                          # unchanged from 4.2
```
`--compare` is the gate: with the facts the host has today, the new renderer must reproduce the wp-config.php already in place. `DIFFERENT` here means the live file was rendered from other inputs than the current facts (or someone edited it): the known cause is the five P35 hand-added constants, fixed by **Step 0 (section 3b)**; any other name, read it and do **not** continue to section 6 until you understand it.

### 4.7 Rollback of the tooling

```bash
TS=$(cat /tmp/p38-ts)
$PSSH "rm -rf ~/aicc-infra-bundle && mv ~/aicc-infra-bundle.pre-p38-$TS ~/aicc-infra-bundle"
$PSSH 'cd ~/aicc-infra-bundle && sudo infra/provision/install-stack.sh --production-host --confirm-production --only scripts | tail -5'   # re-installs the previous versions
$PSSH 'sudo rm -f /usr/local/sbin/aicc-set-brevo-key'                                                                         # the one file the old bundle does not know (install-stack never deletes)
$PSSH 'sudo sha256sum /usr/local/lib/aicc/provision/render-wp-config.sh /usr/local/lib/aicc/provision/lib/owner_facts.py /usr/local/lib/aicc/provision/wp-config.production.template.php; ls /var/backups/aicc-config | tail -3'   # equal to the 4.2 hashes
```
Each replaced installed file also has its previous version under `/var/backups/aicc-config/<UTC>/usr/local/...` if you prefer to copy one back by hand. If a Brevo fact or key file already exists when you roll back, run section 7 first (the old renderer does not know the P38 facts and would refuse the facts file).

## 5. The key (owner step, Mac side)

`infra/provision/set-brevo-key.sh` (see `docs/cutover/p38-brevo-owner-steps.md`): hidden prompt on the Mac Terminal, SHA-256 confirmation, local shape check, then the key goes to **stdin of one SSH connection** to `aicc@157.230.110.211` (production identity key, pinned host key, `StrictHostKeyChecking=yes`, isolated from the owner's ssh config with `-F /dev/null`, no proxy or jump host, no agent / X11 / other forwarding, no tty, no global known hosts, no host-key updates, no multiplexing; host identity `production / www.copilt.org / 3e897286ce82e55f4d866acf0d526a5f` verified before the prompt and again on the host before the key is read). The remote command is `sudo /usr/local/sbin/aicc-set-brevo-key install --expect-stage-id <id>`; it contains no secret.

On the host `aicc-set-brevo-key` (modes `install`, `rotate`, `revoke`, `status`) refuses unless `/etc/aicc-mail` is `root:aicc-cp 0750` and not a symlink, never follows a symlink, reads at most 257 bytes, validates the shape (and refuses `xsmtpsib-` with "this is an SMTP key, an API key is needed"), writes a `0400` temp file in the same directory (umask `0277`, `O_EXCL`), sets `root:aicc-cp 0640`, fsyncs, renames it over the target atomically and fsyncs the directory. The write is checked before it can replace anything: the `write()` count and the real size of the temp file must equal the key plus newline, otherwise the temp file is removed and the existing key is untouched. Install, rotate and revoke take a non-blocking `flock` on the key directory (a second concurrent run is refused at once; `status` is not blocked). A `kill -9` at any stage leaves the old key or nothing, never a partial file (tested at every stage); a stale temp file is removed by the next run. It keeps **no copy** of the previous key (rotation = replace: **revoke the old key in Brevo**), never opens `smtp.env` or `turnstile.secret`, prints only `installed: /etc/aicc-mail/brevo-api.key root:aicc-cp 640 <size>` and the first 8 hex characters of the key's SHA-256, and writes one audit line (time, operator, action, fingerprint prefix) to the journal: `journalctl -t aicc-brevo-key`.

## 6. Activation (the exact lines; each render passes `php -l`)

Prerequisite: section 4 done and its post-checks green, **and Step 0 (section 3b) done: `--compare` says IDENTICAL**; the owner created the restricted API key in Brevo (SMTP & API, API Keys, **an API key `xkeysib-...`, not an SMTP key**).

```bash
export PSSH=~/aicc-promotion/pssh
# 6.1 facts (the provider fact first). With no key yet the render is mail OFF, with a warning: nothing is half-enabled.
$PSSH 'sudo aicc-owner-facts set AICC_MAIL_PROVIDER brevo_api'
$PSSH 'sudo aicc-owner-facts set AICC_MAIL_FROM_ADDRESS notifications@copilt.org'
$PSSH "sudo aicc-owner-facts set AICC_MAIL_FROM_NAME 'AI Commerce Copilot'"
$PSSH 'sudo aicc-owner-facts set AICC_MAIL_REPLY_TO support@copilt.org'
$PSSH 'sudo aicc-owner-facts set AICC_MAIL_DAILY_BUDGET 240'
# 6.2 review (read-only)
$PSSH 'sudo aicc-owner-facts list | grep AICC_MAIL_'
$PSSH 'sudo aicc-render-wp-config --env production --confirm-production --dry-run'      # NOTE: ... brevo-api.key is absent ... NO mail; mail layer not enabled
$PSSH 'sudo aicc-render-wp-config --env production --confirm-production --compare'      # IDENTICAL (no key = still no mail region)
# 6.3 the owner places the key and, with --then-check, renders, reloads and sends the tests (Mac, interactive Terminal):
#     infra/provision/set-brevo-key.sh --dry-run
#     infra/provision/set-brevo-key.sh --then-check --tests verify,welcome,trial_ending
```
`--then-check` does, in order: install the key; show the constants a render would change (names only: expect `AICC_MAIL_ALLOWED_FROM_DOMAINS, AICC_MAIL_API_KEY_FILE, AICC_MAIL_DAILY_BUDGET, AICC_MAIL_ENABLED, AICC_MAIL_FROM_ADDRESS, AICC_MAIL_FROM_NAME, AICC_MAIL_PROVIDER, AICC_MAIL_REPLY_TO` added and `WP_ACCESSIBLE_HOSTS` changed); ask before it renders and reloads; run `aicc-wp aicc-mail check`; ask for a mailbox you control and a confirmation, set `AICC_MAIL_TEST_RECIPIENTS`, render, reload, and run `aicc-wp aicc-mail send-test --to=<you> --kind=<kind>` for each kind, printing only the outcome class and the provider message id (your address masked). By hand, the same steps:
```bash
$PSSH 'sudo aicc-render-wp-config --env production --confirm-production --compare'     # DIFFERENT: the eight names above + WP_ACCESSIBLE_HOSTS
$PSSH 'sudo aicc-render-wp-config --env production --confirm-production && sudo systemctl reload php8.3-fpm'
$PSSH 'sudo aicc-wp aicc-mail check'                                                    # config ok, key ok, api.brevo.com accessible, auth ok (read-only)
printf '%s\n' '<your test mailbox>' | $PSSH 'sudo aicc-owner-facts set-stdin AICC_MAIL_TEST_RECIPIENTS'      # the address on stdin: in no command line
$PSSH 'sudo aicc-render-wp-config --env production --confirm-production && sudo systemctl reload php8.3-fpm'
$PSSH 'sudo aicc-wp aicc-mail send-test --to=<your test mailbox> --kind=verify'
$PSSH 'sudo aicc-wp aicc-mail send-test --to=<your test mailbox> --kind=welcome'
$PSSH 'sudo aicc-wp aicc-mail send-test --to=<your test mailbox> --kind=trial_ending'
$PSSH 'sudo aicc-wp aicc-mail health --strict; sudo aicc-wp aicc-mail usage'
```
(`aicc-wp` is the host's WP-CLI wrapper: `sudo -u aicc-cp wp --path=/srv/aicc/cp/current`; a bare `wp` would not find the site.) Hard checks after the render: `grep -c "api.brevo.com" /srv/aicc/shared/wp-config.php` prints `1`; `grep -c AICC_NOTIFY_ENABLED` prints `0` unless you set that fact on purpose. Optional, later and separately: `AICC_MAIL_MAX_PER_HOUR 60` / `AICC_MAIL_MAX_PER_DAY 240` (one render each; both at most 300), `AICC_MAIL_STATUS_POLL_ENABLED true` (delivery states by polling; one ten-minute cron event). `AICC_NOTIFY_ENABLED` and the signup stay their own decisions.

## 7. Turning mail off

```bash
$PSSH 'sudo aicc-owner-facts unset AICC_MAIL_STATUS_POLL_ENABLED; sudo aicc-owner-facts unset AICC_MAIL_PROVIDER && sudo aicc-render-wp-config --env production --confirm-production && sudo systemctl reload php8.3-fpm'
```
That is the whole switch-off (the first `unset` is a no-op when the poll was never on; it must go first because the poll is refused without the provider). The render removes the Brevo region and `api.brevo.com`; the sender facts and the key file stay but are inert; with the key file still present and the facts unset the render is the golden default again (`--compare` says IDENTICAL against a render made without any P38 fact). Anything that needs a transport (`AICC_NOTIFY_ENABLED`, the self-service switch, mail caps) must be unset first: the renderer refuses it without a mail layer and names it.

Retiring the key as well (Mac): `infra/provision/set-brevo-key.sh revoke` (asks you to type `REVOKE`; removes only `/etc/aicc-mail/brevo-api.key`). **The key itself stays valid in Brevo until you revoke it there** (SMTP & API, API Keys). With the file gone and the provider fact still set, a render leaves mail OFF with a warning (and the Control Plane reports `key_file: missing`); unset the fact when you are done.

## 8. Proving the authentication from a received message

From the mailbox that received a test message (Gmail): open it, the three dots, **Show original**. In the summary box at the top look for:

* `SPF:` `PASS` with IP ... (Brevo's sending IP). Brevo's bounce domain is usually not `copilt.org`, so this line may name another domain: that is normal and does not by itself break DMARC.
* `DKIM:` `PASS` with domain **`copilt.org`**. This is the one that must read `copilt.org`: it is what aligns the message with your domain.
* `DMARC:` `PASS`. With the published DMARC policy this is the line that decides whether Gmail trusts the message as yours.
* `From:` `AI Commerce Copilot <notifications@copilt.org>` and `Reply-To:` `support@copilt.org`.

If DKIM does not read `copilt.org`, the sender-domain authentication in Brevo (the DKIM CNAME / TXT records and the Brevo code) is not complete: fix it in DNS, wait for the TTL, send again. Do not change the sender facts to work around it.

**Branded tracking domain:** `mail.copilt.org` must resolve and answer on https for tracked links to work: `dig +short mail.copilt.org` must print a name or address, and `curl -sI https://mail.copilt.org/ | head -1` must answer. If a message's links are rewritten to `mail.copilt.org/...` that is expected (it is a subdomain of `copilt.org`, which the Control Plane's link policy allows); links that stay on `copilt.org` are fine too. A link that points at a host that does not resolve is a DNS defect to fix before real customers get mail.

**Replies:** reply from the received test mail; the To field must show `support@copilt.org` (the Reply-To); the reply must arrive in the support mailbox through the existing Gmail forwarding. Do not change the forwarding.

## 9. Verification (what the tests prove, and what they do not)

`bash infra/stack-tests/test_p38_brevo.sh` (renderer, facts, template: golden and pre-P38-renderer equality, exact lines and PHP types, the provider decision table, every refusal, hostile values `'`, `\`, `?>`, `$x`, newline, quotes and placeholders, idempotence, `--compare`, `bash -x` trace without the key, no key in any output, log, trace, fact or rendered file, masked test recipients, the activation order and the one-command off). `bash infra/stack-tests/test_p38_key.sh` (the key tools against a fake host prefix: argument, environment, file, terminal, journal and process-list scans with positive controls, atomicity under `kill -9` at four stages for install and rotate, rotation, revocation, symlink / directory-mode / tracing / no-terminal / wrong-identity refusals, unrelated files byte-identical, the whole `--then-check` flow through the real renderer). `npm run infra:lint` pins the structure (and `test_lint.sh` breaks it 35 ways on purpose; most lint rules are presence/structure checks, the "behaviour of the validator" block imports and calls `owner_facts.py`).

Not proven here, because it needs the real host or Brevo: that `sudo` on the host passes stdin through a non-tty ssh session as expected (the existing tooling relies on the same), root ownership of the final file (the tests prove the mode and the intended owner through a seam; `aicc-set-brevo-key status` on the host prints `root:aicc-cp` and is the check), that Brevo accepts the restricted key, that `mail.copilt.org` resolves, and the live SPF / DKIM / DMARC result. Those are the section 6 and 8 checks.

## 10. Review round (2026-11-14, independent security review: LOW findings, all fixed on top of `0e615ee`)

| # | Finding | Fix | Proof |
|---|---|---|---|
| 1 | "nothing else was changed" printed after a failure that may follow the commit | any non-zero exit after the key was sent prints `STATE UNKNOWN ... run status before retrying`; the host tool writes its audit line as soon as the rename happened (`result=committed-then-failed` if a later check fails) | fake host that commits then drops the connection |
| 2 | a short write could replace a good key | `write()` count and `fstat` size checked before chown/fsync/rename | simulated short write at rotate and at install |
| 3 | owner's ssh config could redirect the connection | `-F /dev/null` and the isolation options above | exact option list pinned in `test_p38_key.sh` |
| 4 | test seams reachable on a real machine | both scripts refuse the seams unless the fake ssh / the root prefix is under the system temp dir (symlinks refused) and print `TEST HARNESS ACTIVE` on stderr | refusal and banner tests |
| 5 | one atomicity assertion compared a file with itself; lint "string present" rules | smtp.env and turnstile.secret hashes compared before/after every kill stage; lint labels its presence checks and adds a behaviour block that calls the validator | tests and 6 new negative lint tests |
| 7 | reply-to could be any domain | `@copilt.org` only | off-domain and hostile values |
| 8 | test mailbox in remote command lines / sudo log, case-sensitive masking | the mailbox travels on stdin (`aicc-owner-facts set-stdin`, `read -r a` before `aicc-wp ... send-test`); masking is case-insensitive over every host echo. **Residual:** `wp aicc-mail send-test --to=` takes the address as an argument, so it is in the `wp` process's argument list on the host for the seconds a test runs (visible with `ps` to local users, not in the sudo log) | recorded ssh commands and argv contain no address |
| 9 | `--compare` temp file in /tmp | secrets directory, 0600, trap + sweep | trace and leftover tests |
| 10 | owner doc said `rotate` when nothing is installed | says `install` (`status` tells which) | |
| 11 | rotate message | "gone from the host, still valid in Brevo until you revoke it"; optional Brevo authorised-IPs hardening documented in the owner steps | |
| 12 | concurrent installs | non-blocking `flock` on `/etc/aicc-mail` | lock test |

## 11. Step 0 found by the host update (2026-11-15): the five P35 hand-added constants

See section 3b. Added to the renderer: five production-only owner facts (`AICC_OWNER_METRICS_TOKEN_FILE`, `AICC_OWNER_METRICS_BASE`, `AICC_OWNER_DASHBOARD_USER_IDS`, `AICC_EA_LAUNCH_OFFER_MODE`, `AICC_OWNER_OPS_SNAPSHOT_FILE`) and one template region (`@@P35_BEGIN@@` ... `@@P35_END@@`, removed when no fact is set so the golden render is unchanged). `AICC_OWNER_DASHBOARD_USER_IDS` is no longer a refused key (the P37 doc and lint list were updated). Proof: `test_p38_brevo.sh` section I (synthetic live file, byte equality, hostile values, traversal, mode enum, staging refusal, golden unchanged) and the lint behaviour block.
