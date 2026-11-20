# The production wp-config render: one template, one facts file, both infra lineages (P41 lineage trap)

Written 2026-11-18 (UTC), P41 builder R. **Nothing here was run against a host.** Everything is proved on scratch directories by `infra/stack-tests/test_p41_lineage.sh` (58 checks) with SYNTHETIC owner-facts fixtures; the live host's facts and wp-config were not read.

## 1. The trap, as found

The P41 gap matrix says the Brevo wp-config region exists only on `feat/p38-brevo-infra` (`9d6290e`) while the Trial/Turnstile region lives on the p39/p40 Site infra lineage, and that the two are not ancestors of each other. Investigated:

| Fact | Evidence |
|---|---|
| The two lines forked at `bf54801` (`feat/p37-selfservice`) | `git merge-base 1693122 feat/p38-brevo-infra` = `bf54801` |
| Neither is an ancestor of the other | `git merge-base --is-ancestor` both ways exits 1 |
| **The P40 Site line has NO infra change since the fork** | `git diff --stat bf54801 1693122 -- infra` is empty (same for `feat/p39-marketing` `7ad5615`, `feat/p37-infra` `4cbf745`); the P39/P40 commits changed `src/`, `scripts/`, `tests/`, `brand/`, `docs/` only |
| So the "Trial/Turnstile region on the p39/p40 line" is the **P37 region inherited from `bf54801`**, which the P38 branch ALSO contains | the P38 branch is `bf54801` + the Brevo work |
| What ONLY the P38 branch has | `git diff --stat bf54801 feat/p38-brevo-infra -- infra docs`: the Brevo template region (+12 lines), `owner_facts.py` (+323: the P38 Brevo keys and the five pinned P35 keys), `render-wp-config.sh` (+118: Brevo key-file check, mail-mode decision, `--compare`), `set-brevo-key.sh` and `host/aicc-set-brevo-key`, `owner-facts.sh`, `install-stack.sh` (+2), lint and tests (`test_p38_brevo.sh`, `test_p38_key.sh`), two runbooks |

Consequence: the P38 branch is a strict SUPERSET of the P40 line's infra. Rendering from the P40 line's template would silently DROP the Brevo region and (without the P35 pin) the five hand-appended constants; rendering from the P38 line alone already yields everything. There is no content conflict: only a lineage that a naive merge of the P41 Site branch into an integration branch could lose.

## 2. What this branch does about it

`feat/p41-release-tools` contains `git merge feat/p38-brevo-infra` (commit `5a42de2`, conflict-free: P40's changes outside `infra/` and `docs/cutover/p39-*`/`p40-*` do not meet the P38 changes). `infra/` on this branch is therefore byte-identical to `feat/p38-brevo-infra` `9d6290e` plus the P41 release tools (no change to the renderer, the owner-facts validator or the template). **No new merged template was needed**: the merge IS the merged template.

Coordinator merge order (either gives the same `infra/` tree): merge `feat/p41-release-tools` (it already carries P38), or merge `feat/p38-brevo-infra` first and `feat/p41-release-tools` second. Do NOT build the host bundle (`push-bundle.sh` mirrors with `--delete`) from a Site branch that lacks `9d6290e`: `test_p41_lineage.sh` section L fails on such a tree (ancestry of `9d6290e`, `24e1f6e`, `bf54801`, `1693122`, and every template region).

## 3. One render yields everything

`render-wp-config.sh --env production` fills five delimited regions of `wp-config.production.template.php` from ONE facts file (`/etc/aicc/owner-facts.env`) and TWO verified secret files; absent input removes the region, so the default render is the committed golden byte for byte.

| Region (template marker) | Fed by | Constants it renders |
|---|---|---|
| MAIL (SMTP layer) | `/etc/aicc-mail/smtp.env` (only when it is the selected transport) | `AICC_MAIL_*` SMTP set |
| OWNER_FACTS | owner facts | legal, gateway, signing-keys (`AICC_LM_PLUGIN_SIGNING_PUBKEYS`) facts |
| BREVO | `AICC_MAIL_PROVIDER=brevo_api` + valid `/etc/aicc-mail/brevo-api.key` + sender facts | `AICC_MAIL_ENABLED`, `_PROVIDER`, `_API_KEY_FILE` (path only), `_FROM_ADDRESS`, `_FROM_NAME`, `_REPLY_TO`, `_ALLOWED_FROM_DOMAINS`, `_DAILY_BUDGET`, optional test recipients / status poll; appends `api.brevo.com` to `WP_ACCESSIBLE_HOSTS` |
| P37 | trial / Turnstile / notify / funnel / milestone / owner-ops facts + valid `/etc/aicc-mail/turnstile.secret` | `AICC_TRIAL_SELF_SERVICE_ENABLED`, `_CAP`, `AICC_TURNSTILE_SITE_KEY`, `AICC_TURNSTILE_SECRET_FILE` (path only), `AICC_NOTIFY_ENABLED`, `AICC_NOTIFY_EXCLUDED_CUSTOMERS`, `AICC_MAIL_MAX_PER_HOUR/DAY`, `AICC_FUNNEL_COUNTERS_ENABLED`, `AICC_FUNNEL_ALLOWED_ORIGINS`, `AICC_OWNER_OPS_SECTION_ENABLED`, `AICC_MILESTONE_SYNC_SCHEDULED`, plan-change / reconcile / privacy switches; `AICC_TURNSTILE_ENABLED` is a fact that renders NO constant, it appends `challenges.cloudflare.com` to `WP_ACCESSIBLE_HOSTS` |
| P35 | the five pinned facts | `AICC_OWNER_METRICS_TOKEN_FILE`, `AICC_OWNER_METRICS_BASE`, `AICC_OWNER_DASHBOARD_USER_IDS`, `AICC_EA_LAUNCH_OFFER_MODE`, `AICC_OWNER_OPS_SNAPSHOT_FILE` (the same three commented blocks the P35 script inserted, in the order B2, OFFER, SNAP) |

The renderer refuses (writes nothing) any set that the Control Plane would read as closed while the file claims open: self-service without a cap of 25/50/100, the Turnstile site key, the secret file, `AICC_TURNSTILE_ENABLED`, a working mail transport or `AICC_NOTIFY_ENABLED` (`docs/cutover/p37-self-service-wp-config.md` section 5; the Brevo rules are in `p38-brevo-host-update.md`).

## 4. The five hand-appended P35 constants and all live values

* The five constants were appended BY HAND to the live wp-config on 2026-11-13 (P35 gates B2, OFFER, SNAP). `9d6290e` pinned them as production-only owner facts; the template's P35 region renders them back as the identical text. **Never re-render before they are facts** (a render rewrites the whole file and would delete them). `render-wp-config.sh --compare` against the live file names exactly them as `removed` when the facts are missing (section 6).
* The committed fixture `infra/stack-tests/fixtures/owner-facts.production.live.env` is the synthetic image of the non-secret facts the host carries after P35 + P38 (the five + `AICC_MAIL_PROVIDER=brevo_api`, sender `notifications@copilt.org`, name, reply-to `support@copilt.org`, daily budget 240). Its render (with a safe Brevo key file) is frozen as `infra/stack-tests/golden/wp-config.production.p41-live.php`.
* Relative to the default golden, that render ADDS exactly the five + the eight Brevo constants and changes exactly one value, `WP_ACCESSIBLE_HOSTS` (`api.copilt.org,api.brevo.com`); it removes nothing; no Trial/Turnstile/notify/milestone/owner-ops constant is defined (public trial issuance stays closed).
* `owner-facts.production.p41-activation.env` = the live facts + the owner's activation facts (`docs/cutover/p41-activation-runbook.md`). Its render (`golden/wp-config.production.p41-activation.php`) ADDS exactly ten constants (the nine below plus `AICC_LEGAL_REVIEW_APPROVED`, which the switch now requires) to the live render (`AICC_TRIAL_SELF_SERVICE_ENABLED`, `_CAP` as the integer 25, `AICC_TURNSTILE_SITE_KEY`, `AICC_TURNSTILE_SECRET_FILE`, `AICC_NOTIFY_ENABLED`, `AICC_NOTIFY_EXCLUDED_CUSTOMERS`, `AICC_FUNNEL_COUNTERS_ENABLED`, `AICC_OWNER_OPS_SECTION_ENABLED`, `AICC_MILESTONE_SYNC_SCHEDULED`), removes none, keeps every live value, and extends `WP_ACCESSIBLE_HOSTS` to `api.copilt.org,challenges.cloudflare.com,api.brevo.com`. The switches are the exact boolean `true` the Control Plane reads; `AICC_TRIAL_TURNSTILE`, `AICC_COMMERCE_OPEN` and `AICC_PLAN_CHANGE_ENABLED` stay absent.
* `AICC_LM_PLUGIN_SIGNING_PUBKEYS` is an owner fact too (public keys); whether the host already has it is unknown here: `check-host-signing-keys.sh` answers without printing it (`docs/cutover/p41-plugin-publication.md` section 3).

## 5. Tests (`bash infra/stack-tests/test_p41_lineage.sh`, scratch directories, no host)

| Section | What it proves |
|---|---|
| L (12 checks) | `9d6290e`, `24e1f6e`, `bf54801`, `1693122` are ancestors of HEAD; the template carries MAIL, BREVO, OWNER_FACTS, P37, P35 regions exactly once and the three placeholders once; `owner-facts keys` lists every key the activation and the live file need; stage accepts none of them |
| P (live render) | the live fixture renders (php -l clean) and equals the committed golden byte for byte; PHP reads the five P35 values, the Brevo values (budget as an integer 240, allowed domains array) and the unchanged production constants; no P37 constant is defined; added = exactly 13 names, removed = none, only `WP_ACCESSIBLE_HOSTS` changes |
| A (activation) | the activation fixture renders and equals its golden; booleans/integer types; hosts list; Brevo still on; the things that must stay closed absent; relative to the live render: +9 names, -0, only `WP_ACCESSIBLE_HOSTS` changes; the five P35 constants intact; no secret in the output; idempotent |
| C (`--compare`) | IDENTICAL (exit 0) for the live facts against a live-shaped file; the file is untouched (hash) and no `.compare.*`/`.wpcfg.*` leftover; against a file WITHOUT the five constants: exit 4 and `added` = the five; THE TRAP (facts without the five vs the live file): exit 4 and `removed` = exactly the five, no value printed; activation facts vs the live file: exit 4, `added` = the nine, `changed` = `WP_ACCESSIBLE_HOSTS` |
| R (refusals) | no Turnstile secret file / no mail transport / no `AICC_NOTIFY_ENABLED` / no `AICC_TURNSTILE_ENABLED` / no cap / a cap that is not 25, 50 or 100: each is refused and the previous file is untouched; the complete set renders again |

Golden files are regenerated only deliberately: `AICC_UPDATE_GOLDEN=1 bash infra/stack-tests/test_p41_lineage.sh` then review the diff. The existing suites are unchanged: `test_p37_wpconfig.sh` (266), `test_p38_brevo.sh` (459), `test_provision.sh` (659), `lint.sh` (483 checks, shellcheck clean).

## 6. `--compare` on the host: the read-only expectation

`sudo aicc-render-wp-config --env production --confirm-production --compare` renders to a temporary 0600 file in `/etc/aicc/secrets`, compares it with `/srv/aicc/shared/wp-config.php` and prints constant NAMES only (never a value), writes nothing else, removes its temp file (trap + sweep of leftovers). Exit 0 = IDENTICAL; exit 4 = DIFFERENT with three lines `added / removed / changed`. Read it as follows:

| When | Expected | If not |
|---|---|---|
| Before ANY P41 host step (now: the host has the P38 render) | `IDENTICAL` | `removed:` names = a live constant that is not a fact (e.g. the five P35 constants if their facts were never set): STOP, `aicc-owner-facts set` them (`p38-brevo-host-update.md` step 0), compare again. `changed:` = a hand edit: find out why |
| After the owner sets the activation facts, BEFORE the render | `DIFFERENT`, `removed: -`, `changed: WP_ACCESSIBLE_HOSTS` (only when `AICC_TURNSTILE_ENABLED` was added), `added:` = exactly the constants of the steps taken so far (activation runbook, each step names them) | anything under `removed:` or an unexpected name under `added:`: do not render |
| Right after the render and the PHP-FPM reload | `IDENTICAL` | `DIFFERENT`: the render did not write (it refused) or the file was changed afterwards |
| After `unset` of a fact | `DIFFERENT` with that fact's constants under `removed:` | expected: that is the rollback preview |

## 7. Risk statement (what remains unproven)

1. **The real facts file on the host is not read here.** The fixtures encode what the evidence says is live (P35's five, P38's five Brevo facts). If the host carries other facts (for example `AICC_LM_PLUGIN_SIGNING_PUBKEYS`, `AICC_ACTIVATION_PROOF_KID`, legal facts), they render unchanged because the renderer reads the same file; the host's own `--compare` is the arbiter and must say IDENTICAL before anything is changed.
2. **The renderer, validator and template were NOT modified.** The proof is the merge itself plus the frozen goldens; a future change to any of them must regenerate the goldens deliberately.
3. **Host tooling must be the P38 tooling or newer** (`aicc-owner-facts keys` must list `AICC_TRIAL_SELF_SERVICE_ENABLED`, `AICC_MAIL_PROVIDER` and `AICC_OWNER_METRICS_TOKEN_FILE`). The P38 update copied six files only; a full `push-bundle.sh` mirror of an older tree would roll back unrelated ops/backup tooling (see `p38-brevo-host-update.md` section 4).
4. **No P41 renderer/owner-facts support was needed**: P41's new Control Plane behaviour (mail-budget blocker, funnel, milestone mapping) reads the same constants. If the Control Plane builders add a NEW wp-config constant, it needs an owner-facts key first; check with `grep -rhoE "defined\( *'AICC_[A-Z0-9_]+'" <CP>/admin/wp-content | sort -u` against `aicc-owner-facts keys` (as of the p40 CP the only constants not renderable are dev/test seams, the Brevo API key constant the CP itself refuses, `AICC_MAIL_STATUS_MAX_CALLS_PER_HOUR`, `AICC_MAIL_BREVO_IDEMPOTENCY_HEADER`, the demo-video constants and the version constants).
