# Production configuration and deployment path (prepared, NOT used)

> **WARNING: the Site repository's `origin` is a PUBLIC GitHub repository. NEVER push `launch/integration` (or any branch that carries `infra/`, `docs/cutover/` or `docs/launch/ops-owner-kit/`) to it.** Those branches contain operational material that must not be public: the Droplet and Reserved IP addresses, private repository names, ssh and backup details, the monitoring and sentinel layout and the owner kit. The release flow publishes ONLY the static site export, never this repository's operational branches. Safe options: (1) a PRIVATE mirror repository (create it private, add it as a second remote, push there); (2) push only the public marketing-site commit, from a branch that does not contain `infra/` and `docs/cutover/`; (3) keep it local and back it up with `git bundle`. Always check `git remote -v` and the repository visibility before any push.

**Update 2026-10-22 (owner direction):** the production host is the EXISTING Droplet `aicc-cp-stage` promoted in place. The conversion procedure, the decisions behind it and the cutover gate are in **`docs/cutover/production-promotion.md`** (script `infra/provision/promote-to-production.sh`, section 5 below summarises what it replaced). Statements below that say "a new Droplet" or "no production host exists" are superseded by that document.

Status (2026-10-21, still true for the live host as of 2026-10-22): the tooling exists, is tested, and has **never been pointed at a real production host**: the conversion has not been executed. Nothing in this document was applied to `www.copilt.org`, the apex, `api.copilt.org`, the existing API Droplet, Neon, Render or any payment system. "Rehearsed" below means exercised on the Linux **staging** host or against stubs, and each item says which.

## 1. Design in one paragraph

Two environments share one code path and differ only through reviewed, enumerated values. The Control Plane configuration file is rendered ON THE HOST from a template of its environment; releases are immutable tarballs activated through the same host-side tool in both environments; the deploy client adds extra gates for production that can only tighten, never loosen.

## 2. Files

| What | File | Used by |
|---|---|---|
| Stage wp-config template | `infra/provision/wp-config.stage.template.php` | `render-wp-config.sh` (default `--env stage`) |
| Production wp-config template | `infra/provision/wp-config.production.template.php` | `render-wp-config.sh --env production --confirm-production` ONLY (infra:lint fails if any script other than the renderer, the stage template's comment and the refusal in `deploy-release.sh` names it) |
| Renderer | `infra/provision/render-wp-config.sh` | the host, as root |
| Deploy client (Mac) | `infra/release/deploy-release.sh` (`--env stage` default, `--env production`) | the operator |
| Activation / rollback / status (host) | `activate-release.sh`, `rollback-release.sh`, `deploy-status.sh` → `aicc-activate-release`, `aicc-rollback-release`, `aicc-deploy-status` | env-agnostic |
| Edge | `docs/cutover/Caddyfile.edge.template`, `scripts/ops/render-edge.mjs --mode production` | the host; validated with Caddy 2.11.7 (`caddy validate`) on the Mac |
| Site build | `infra/release/build-site-release.sh --target production --cp-worktree <CP worktree>` | the Mac |
| CP build | `infra/release/build-cp-release.sh --cp-worktree <CP worktree>` (env-agnostic artifact; opt-in `--with-payplus` packages the pinned PayPlus plugin, see the PayPlus payment kit, Control Plane `docs/launch/payplus-owner-kit.md`) | the Mac |

## 3. What differs between the stage and the production configuration (pinned by a test)

`test_provision.sh` renders both templates and compares the `define()` set: exactly these constants may differ, anything else fails the suite.

| Constant | Stage | Production |
|---|---|---|
| `WP_HOME`, `WP_SITEURL` | `https://stage.copilt.org` | `https://www.copilt.org` |
| `WP_ENVIRONMENT_TYPE` | `staging` | `production` |
| `WP_ACCESSIBLE_HOSTS` (outbound allow-list; `WP_HTTP_BLOCK_EXTERNAL` is `true` in both) | `stage.copilt.org` | `api.copilt.org` by default (exactly). A payment gateway's API host is added ONLY through the owner-set list of section 3a (`AICC_EXTRA_ACCESSIBLE_HOSTS`: plain host names, validated, empty by default) |
| `AICC_ENTITLEMENT_WEBHOOK_URL` | not defined (staging can never reach the real Backend) | `https://api.copilt.org/v1/internal/entitlement/webhook` |
| `AICC_ENTITLEMENT_WEBHOOK_SECRET`, `AICC_ACTIVATION_PROOF_SECRET` | random, generated on the host, staging only | **owner-provided, never generated**: the webhook secret must equal the Backend's |

Identical in both: socket-only database, `DISALLOW_FILE_MODS`/`DISALLOW_FILE_EDIT`, `AUTOMATIC_UPDATER_DISABLED`, `DISABLE_WP_CRON` (system timer), `WP_DEBUG` and its log/display off, `FORCE_SSL_ADMIN`, empty trusted proxies, loopback-only operator CIDRs, no `COOKIE_DOMAIN` (host-only cookies), no dev bootstrap/test fixture constants.

## 3a. Owner facts: the non-secret launch values the owner sets on the host (added 2026-10-23, "plumb")

The production wp-config template carries ONE region for values only the owner knows. They live in a root-only host file, **`/etc/aicc/owner-facts.env`** (mode 0600, `root:root`, a regular file; the PHP user cannot even traverse `/etc/aicc`). `render-wp-config.sh` reads it on every render and never writes it, so no re-render (new release, `--force-salts`, restore of a missing wp-config, promotion) can lose a value. Nothing in it is a secret (the two shared secrets stay in `/etc/aicc/secrets`, the SMTP login in `/etc/aicc-mail`) and nothing from it is ever in the repository. Absent or empty file: the rendered configuration is **byte-for-byte what it was before this region existed** (pinned by golden files in `infra/stack-tests/golden/`), no owner-fact constant is defined, and the launch gate keeps blocking (an undefined `AICC_LAUNCH_REAL_GATEWAYS` is the gate's own empty array; an undefined `AICC_LM_PAID_GATEWAYS` is the payment gate's empty allowlist).

| Key (file) | Rendered as | Rule |
|---|---|---|
| `AICC_ACTIVATION_PROOF_KID` | `define( 'AICC_ACTIVATION_PROOF_KID', '...' )` | `[A-Za-z0-9._-]`, 1-64. **Must equal the Backend's `ACTIVATION_PROOF_KID_CURRENT`**; the Control Plane refuses to issue activation proofs without it (`AICC_LM_Proof::get_current_kid`), the secret half is `/etc/aicc/secrets/activation-proof.secret` (must equal the Backend's `ACTIVATION_PROOF_SECRET_CURRENT`) |
| `AICC_LEGAL_ENTITY_NAME`, `_ENTITY_ADDRESS`, `_SUPPORT_EMAIL`, `_GOVERNING_LAW`, `_JURISDICTION`, `_PAYMENT_PROCESSOR`, `_VAT_DETAILS` (optional) | one escaped PHP string each | the seven facts of `docs/launch/owner-facts-batch.md` section A (Control Plane column). Free text: no control or invisible characters, no `<` `>`, no `@@`, at most 200-300 characters; apostrophes and backslashes are kept and escaped. `_SUPPORT_EMAIL` must look like an address (the launch gate additionally rejects example/test/invalid/local) |
| `AICC_LEGAL_REVIEW_APPROVED`, `AICC_STRUCTURED_DATA_OFFERS` | `true` | exactly `true`; to turn off, **unset**. Counsel approval / checkout live are decisions (batch B-8, B-11) |
| `AICC_COMMERCE_OPEN` | `define( 'AICC_COMMERCE_OPEN', true );` | the ONE fail-closed switch for "commercial checkout is open" (production only, exactly `true`, **unset = closed**, which is the state of the public pre-commercial release). The tool refuses it unless the six legal facts, the review approval, the sub-processor date, the key id and both gateway lists are already present (set it LAST), the renderer refuses it without the production mail layer, and the Control Plane additionally needs WooCommerce coming-soon off and a clean attested gate run. NO override. See `pre-commercial.md` |
| `AICC_LEGAL_SUBPROCESSORS_VERIFIED` | string `YYYY-MM-DD` | a real calendar date; the gate demands "not in the future, at most 90 days old" |
| `AICC_LM_PAID_GATEWAYS` | `array( 'id' => array( 'require_transaction_id' => true, 'proof_meta' => array(...) ), ... )` | the RUNTIME payment gate (`AICC_LM_Payment_Gate`). Comma-separated list of EXACT WooCommerce gateway ids, each optionally followed by `:meta_key[:meta_key2]` (the order-meta key that carries the provider reference, e.g. `payplus_transaction_uid`). Lower case `[a-z0-9_-]`; no patterns or prefixes; `bacs` `cheque` `cod` refused; at most 12; a transaction id is ALWAYS required (this tool cannot switch that off) |
| `AICC_LM_PAYMENT_EVIDENCE_PROVIDER` | a provider tag, e.g. `payplus` (`[a-z0-9_-]`, 1-40) | COM-GATE-01, owner decision OD-1 (2026-11-01): provider-side captured-payment verification is REQUIRED before commerce opens. When set, the renderer writes into **every** entry of `AICC_LM_PAID_GATEWAYS` (wallet ids included) `'require_provider_evidence' => true, 'evidence_provider' => '<tag>', 'evidence_environment' => 'live'` (`'sandbox'` on the staging host; **the environment is fixed by the render target, never by a fact, so production cannot render a sandbox**). It is a NAME, never a credential. It enables nothing by itself: the Control Plane also needs a registered provider adapter and an attested provider sandbox run before `AICC_LM_Payment_Readiness` lets commerce open (`wp aicc-ops payment-readiness` lists what is open). `AICC_COMMERCE_OPEN=true` is refused while it is unset, and it cannot be unset while commerce is open |
| `AICC_LAUNCH_REAL_GATEWAYS` | `array( 'id', ... )` | the LAUNCH gate's list of gateways that may be ENABLED in WooCommerce (`scripts/check-launch-blockers.php` reads a wp-config definition before its empty default). Same id syntax. **Every id must also be in `AICC_LM_PAID_GATEWAYS`** (the renderer and the tool refuse otherwise: customers would pay and get no license), so set the paid list first |
| `AICC_EXTRA_ACCESSIBLE_HOSTS` | appended to `WP_ACCESSIBLE_HOSTS` (`api.copilt.org,host1,host2`) | at most 5 plain DNS host names (e.g. `restapi.payplus.co.il`), lower-cased. Refused: wildcards, IP addresses, `localhost` and local/reserved names (`.local`, `.internal`, `.test`, ...), ports, schemes, paths, underscores, anything under `copilt.org`. `WP_HTTP_BLOCK_EXTERNAL` stays `true`. The Control Plane launch gate prints a WARN note ("allows more than the API host") for each extra host: expected, not a blocker |
| `AICC_LM_PLUGIN_SIGNING_PUBKEYS` (production only) | `define( 'AICC_LM_PLUGIN_SIGNING_PUBKEYS', 'k1,k2' )` | the PUBLIC half of the Plugin update-signing key: standard base64 (44 characters) of a 32-byte Ed25519 public key, at most TWO comma-separated (primary + standby), no duplicates; anything that does not decode to 32 bytes (for example a 64-byte secret key) is refused. This is exactly what the Control Plane reads (`AICC_LM_Release_Signature::parse_keys`, at most 2). With it set the Control Plane re-verifies each release when serving it; if set it must contain a key the shipped Plugin build carries (the launch gate's Plugin-download check). Not set: the gate prints a NOTE, not a blocker. A 32-byte private SEED would also pass the shape check: only ever paste the PUBLIC key printed by the key kit. Staging does not accept it |

**The three gateway lists are NOT the same list** (the earlier "identical" wording was wrong): `AICC_LM_PAID_GATEWAYS` (wp-config) and `AICC_LAUNCH_REAL_GATEWAYS` hold exact WooCommerce gateway ids and the launch list must be a SUBSET of the runtime list (the runtime list may also hold ids that arrive on orders but are not separately enabled, such as the wallet ids PayPlus writes into `payment_method`); the Site `REAL_GATEWAY_ALLOWLIST` (`scripts/lib/payment-gate.mjs`) holds the payment-processor DISPLAY NAME ("PayPlus") that is compared, case-insensitively, with `NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR` and is changed in the repository at build time, not on the host.

**Staging** accepts only `AICC_ACTIVATION_PROOF_KID`, `AICC_LM_PAID_GATEWAYS`, `AICC_LM_PAYMENT_EVIDENCE_PROVIDER` (rendered with the `sandbox` environment), `AICC_LM_PAYMENT_GATE_STRICT` (`true`: a payment SANDBOX rehearsal runs the production rules) and `AICC_EXTRA_ACCESSIBLE_HOSTS` (appended to `stage.copilt.org`, e.g. `restapidev.payplus.co.il`). Production does not accept `AICC_LM_PAYMENT_GATE_STRICT` (strict is derived from the production host name).

### Operator commands (on the host, as root; `aicc-owner-facts` is installed by `install-stack.sh --only scripts`)

```
sudo aicc-owner-facts keys                      # what this host's environment accepts
sudo aicc-owner-facts list                      # the facts file (values are not secrets)
sudo aicc-owner-facts check                     # validate the whole file, change nothing
sudo aicc-owner-facts export > owner-facts.env  # DR copy (non-secret); `import /abs/path` re-enters it on a rebuilt host

# SET (validated first; the file is replaced atomically, mode 0600; nothing is rendered yet)
sudo aicc-owner-facts set AICC_ACTIVATION_PROOF_KID prod-2026-10
sudo aicc-owner-facts set AICC_LEGAL_ENTITY_NAME 'Example Studio Ltd'
sudo aicc-owner-facts set AICC_LM_PAID_GATEWAYS 'payplus-payment-gateway:payplus_transaction_uid'
sudo aicc-owner-facts set AICC_LM_PAYMENT_EVIDENCE_PROVIDER payplus   # COM-GATE-01: a provider NAME (flags every path above); no credential is ever an owner fact
sudo aicc-owner-facts set AICC_LAUNCH_REAL_GATEWAYS payplus-payment-gateway
sudo aicc-owner-facts set AICC_EXTRA_ACCESSIBLE_HOSTS restapi.payplus.co.il
sudo aicc-owner-facts set AICC_LM_PLUGIN_SIGNING_PUBKEYS '<primary public key>,<standby public key>'   # public keys only, from the key kit; never hand-edit the rendered wp-config (the next render erases it)

# UNSET (the next render behaves as if the key had never been set)
sudo aicc-owner-facts unset AICC_EXTRA_ACCESSIBLE_HOSTS

# APPLY (re-render, then reload PHP-FPM: OPcache has validate_timestamps=0, so FPM keeps the old wp-config until it is reloaded)
sudo aicc-render-wp-config --env production --confirm-production --dry-run     # validates the facts, prints only the NUMBER of values
sudo aicc-render-wp-config --env production --confirm-production
sudo systemctl reload php8.3-fpm
sudo aicc-wp eval 'echo json_encode( array( array_keys( AICC_LM_Payment_Gate::allowlist() ), AICC_LAUNCH_REAL_GATEWAYS, WP_ACCESSIBLE_HOSTS ) );'    # read back (WP-CLI sees the file at once)
```

On staging use `--env stage` (no `--confirm-production`); `aicc-owner-facts` picks the environment from the host identity. A refusal prints `REFUSED: ...` and leaves both the facts file and the rendered wp-config untouched. **Disaster recovery of the facts file (M6).** `/etc/aicc/owner-facts.env` is deliberately NOT in the host backup or in the encrypted off-host copy (it is root-only configuration, and keeping the backup set free of configuration keeps restore simple). Instead it is NON-secret and exportable, and the DR steps re-enter it:
```
sudo aicc-owner-facts export > owner-facts-$(date +%F).env   # run after EVERY change of a fact; file text is validated, holds no secret
#   keep that file with the owner's records (password manager attachment / encrypted notes), next to the filled facts form (docs/launch/owner-facts-batch.md)
# on a rebuilt host, BEFORE the first production render (scp the file to the host first, absolute path, then):
sudo aicc-owner-facts import /root/owner-facts-2026-xx-xx.env  # validated for THIS host's environment; refuses a symlink, an invalid value, a stage-only key on production, and never merges into a different existing file
sudo aicc-render-wp-config --env production --confirm-production
```
The import file is validated exactly like `set` (one validator). After a promotion the file survives and is validated by the promotion gate (`production-promotion.md`).

## 4. Renderer gates (all refuse with a message, nothing is written)

`--env production` needs: the production template (marker `AICC_TEMPLATE: production`, `WP_HOME` www, no staging host in code); `--confirm-production`; on a real host an identity file that says `AICC_ENV=production`; `/etc/aicc/secrets/entitlement-webhook.secret` and `activation-proof.secret` present, mode 0600/0400, at least 32 characters from a PHP-safe alphabet with at least 12 distinct characters; the database password file. The stage renderer refuses the production template and the other way round.

## 5. Production host prerequisites (not done)

1. **Decision (owner, 2026-10-22): the staging Droplet is converted in place; no second Droplet.** The things the earlier recommendation worried about (stage identity, stage database and test data, stage edge state) are exactly what `promote-to-production.sh` replaces: identity, a clean replacement database with new credentials, production wp-config, production edge env and render, with a verified rollback bundle. Cost: there is no staging environment afterwards (`production-promotion.md` D1/D4).
2. **Identity**: `/etc/aicc-stage-identity` (the file name is historical) must say `AICC_ENV=production`, `AICC_HOSTNAME=www.copilt.org` and a random `AICC_STAGE_ID`. Written by `promote-to-production.sh apply` (step `identity`, after the gates and the rollback bundle); `install-stack.sh --only identity` stays stage-only and is refused on a production identity. It is a plaintext 0644 file whose id is not secret: it protects against operator mistakes, not impersonation.
3. **Provisioning**: the promoted host is NOT re-provisioned. The promotion reuses `create-staging-db.sh` (database + accounts), `render-wp-config.sh --env production`, a production edge env/render/unit drop-in, `aicc-ops.production.toml` and the production sentinel targets. `install-stack.sh --production-host --confirm-production` re-installs/updates the stack on the promoted host; its stage-only steps are refused there.
4. **Mail**: the staging pool routes `mail()` to a sink; production uses the Control Plane SMTP layer enabled by the `AICC_MAIL_*` region of the production wp-config, which the renderer keeps only when `/etc/aicc-mail/smtp.env` is valid (`production-promotion.md` section 8). Without it production sends no mail at all; lost-password and order mail are then not delivered.
5. **Secrets inventory** (who holds what): DB passwords and salts are regenerable on the host; the entitlement webhook secret and the activation-proof key are owner-held (password manager) and are NOT in any backup; the Telegram token is owner-held.
6. **Owner facts** (section 3a): the proof key id, the seven legal facts, the gateway allowlists, an optional payment-gateway host and the public update-signing keys are set on the host with `aicc-owner-facts` BEFORE the first production render (or at any time afterwards, followed by a re-render and an FPM reload); the Backend's `ACTIVATION_PROOF_KID_CURRENT` must be the same id.
6. **Host key**: pinned beforehand for the deploy client (`--known-hosts`, section 6); `production-promotion.md` step 6.1 builds the pinned file for this Droplet.

## 6. Deploy sequence (production; every step stops on the first refusal)

```
1. build:    infra/release/build-cp-release.sh --cp-worktree "$CPW"   (clean commit required; --cp-worktree is REQUIRED; fails on brand-kit drift)
             infra/release/build-site-release.sh --target production --cp-worktree "$CPW"   (--cp-worktree: brand-kit drift check against the paired CP commit)
2. preflight (local, no network):  infra/release/deploy-release.sh --env production --dry-run ...
3. deploy:   infra/release/deploy-release.sh --env production --kind cp|site --artifact <file> \
               --stage-host www.copilt.org --stage-ip <PRODUCTION IPv4> --stage-id <id from the host identity> \
               --key ~/.ssh/aicc_cp_prod* --known-hosts <pinned file> --confirm-production <the release id>
4. host:     pre-release backup (cp; the activation refuses without a dump younger than 15 minutes) -> rsync to .incoming-<id> -> aicc-activate-release:
             verify every file against SHA256SUMS -> atomic swap -> PHP-FPM reload (cp) -> health gate (smoke-cp / smoke-site, 2 successes) -> OPcache warm-up -> prune
5. record:   /var/lib/aicc/deployments.jsonl (timestamp, outcome, kind, release id, previous, tarball sha256, source commit, target, host, and the sudo user, which over the deploy path is always the shared `aicc` account, not a person; a FIRST release that fails its health gate writes no record) and
             aicc-deploy-status (what is live, what is the rollback target, last N deployments)
```

Production refusals (all tested against stubs, `test_release.sh`): host name other than `www.copilt.org`; an address that is the API Droplet or a GitHub Pages address (the Droplet's own two addresses are accepted since 2026-10-22 because it IS the production host; a non-promoted host is stopped by the identity gate); a key not named `aicc_cp_prod*`; no pinned `--known-hosts` (or one without an entry for the address, checked with `ssh-keygen -F`, so hashed files work too); a missing or wrong `--confirm-production <id>`; a manifest that is not `dirty == false` (strict boolean); a site build whose target is not `production`, that contains the staging identity route, a `noindex` meta outside the error pages or a blanket `Disallow`; an artifact carrying a wp-config template; a host whose identity does not say `AICC_ENV=production` with this name and id; a failed pre-release backup.

**Honest limits:** the manifest facts (`dirty`, `target`, release id) are asserted by the same directory that supplies the tarball: the gates guard against accidents, not against a hostile artifact. There is no signing, no branch/tag check and no two-person gate yet. `--confirm-production <id>` proves a conscious per-release step, not provenance.

## 7. Rollback

`aicc-rollback-release --kind site|cp` swaps `current`/`previous` (health-gated, refuses a release marked FAILED). The code rollback never rolls the database back: the migration rules and the restore-from-pre-release-dump caveat are in `infra/release/README.md`. A failed health gate during activation rolls back automatically (exit 3; exit 4 if even the rollback is unhealthy). **What was exercised on the staging host:** real activations and rollbacks of site and CP releases (this phase's final acceptance), the automatic rollback by an unhealthy release, the pre-release dump gate.

## 8. Edge (production render)

`node scripts/ops/render-edge.mjs --mode production --pre-cutover` is the **dark-production** waiting render (the same text with `tls internal`; installed by the promotion, validated with Caddy 2.11.7 and accepted by the production preflight with `AICC_ALLOW_PRODUCTION_MODE=1` + `AICC_ALLOW_INTERNAL_TLS=1`); the final render is installed by `promote-to-production.sh final-edge` after DNS points at the host. `node scripts/ops/render-edge.mjs --mode production` is the template with `www.copilt.org` + apex, no identity route, HSTS `max-age=300` (ramp: `docs/cutover/tls-caa-hsts.md`), HTTP/3 off, apex redirects 301 (GET/HEAD) and 308 (other methods). It validates with Caddy 2.11.7 (`caddy validate`, done on the Mac with placeholder paths) and was exercised for its topology by the real-Caddy rehearsal (`docs/cutover/rehearsal.md`). It has **never been started on Linux** and the preflight refuses to start it without `AICC_ALLOW_PRODUCTION_MODE=1`.

## 9. Still missing before a production cutover (technical), as of 2026-10-22

Done in the repository (tested on the Mac, not on the host): the identity writer and the whole conversion (`promote-to-production.sh`), the production AICC Ops config and sentinel targets (dark and live), the production-named backup/pull/restore/drill tooling and a production-mode rehearsal in an isolated target, the pinned-host-key and key-name rules for every Mac-side tool, the DNS TTL plan (`production-promotion.md` section 7), the mail wiring (config only).
Still missing: **executing** the conversion on the host (owner approval); the Telegram token on the host and DigitalOcean alert policies (owner console actions); the 24/7 external sentinel (dedicated public repository, one owner gate); signed or provenance-checked artifacts; a second operator key and a rehearsed console recovery; the SMTP provider account and a proven outbound path; payment host allow-listing and a gateway; legal/support facts; Let's Encrypt issuance for `www` and the apex, the IPv6 decision and the HSTS ramp (`tls-caa-hsts.md`); an off-host second copy that does not depend on a sleeping Mac (`infra/backup/README-backup.md`).
