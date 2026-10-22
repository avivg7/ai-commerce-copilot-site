# Production configuration and deployment path (prepared, NOT used)

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
| Site build | `infra/release/build-site-release.sh --target production` | the Mac |
| CP build | `infra/release/build-cp-release.sh` (env-agnostic artifact) | the Mac |

## 3. What differs between the stage and the production configuration (pinned by a test)

`test_provision.sh` renders both templates and compares the `define()` set: exactly these constants may differ, anything else fails the suite.

| Constant | Stage | Production |
|---|---|---|
| `WP_HOME`, `WP_SITEURL` | `https://stage.copilt.org` | `https://www.copilt.org` |
| `WP_ENVIRONMENT_TYPE` | `staging` | `production` |
| `WP_ACCESSIBLE_HOSTS` (outbound allow-list; `WP_HTTP_BLOCK_EXTERNAL` is `true` in both) | `stage.copilt.org` | `api.copilt.org` (exactly; add a payment host only in a reviewed change when a gateway is configured) |
| `AICC_ENTITLEMENT_WEBHOOK_URL` | not defined (staging can never reach the real Backend) | `https://api.copilt.org/v1/internal/entitlement/webhook` |
| `AICC_ENTITLEMENT_WEBHOOK_SECRET`, `AICC_ACTIVATION_PROOF_SECRET` | random, generated on the host, staging only | **owner-provided, never generated**: the webhook secret must equal the Backend's |

Identical in both: socket-only database, `DISALLOW_FILE_MODS`/`DISALLOW_FILE_EDIT`, `AUTOMATIC_UPDATER_DISABLED`, `DISABLE_WP_CRON` (system timer), `WP_DEBUG` and its log/display off, `FORCE_SSL_ADMIN`, empty trusted proxies, loopback-only operator CIDRs, no `COOKIE_DOMAIN` (host-only cookies), no dev bootstrap/test fixture constants.

## 4. Renderer gates (all refuse with a message, nothing is written)

`--env production` needs: the production template (marker `AICC_TEMPLATE: production`, `WP_HOME` www, no staging host in code); `--confirm-production`; on a real host an identity file that says `AICC_ENV=production`; `/etc/aicc/secrets/entitlement-webhook.secret` and `activation-proof.secret` present, mode 0600/0400, at least 32 characters from a PHP-safe alphabet with at least 12 distinct characters; the database password file. The stage renderer refuses the production template and the other way round.

## 5. Production host prerequisites (not done)

1. **Decision (owner, 2026-10-22): the staging Droplet is converted in place; no second Droplet.** The things the earlier recommendation worried about (stage identity, stage database and test data, stage edge state) are exactly what `promote-to-production.sh` replaces: identity, a clean replacement database with new credentials, production wp-config, production edge env and render, with a verified rollback bundle. Cost: there is no staging environment afterwards (`production-promotion.md` D1/D4).
2. **Identity**: `/etc/aicc-stage-identity` (the file name is historical) must say `AICC_ENV=production`, `AICC_HOSTNAME=www.copilt.org` and a random `AICC_STAGE_ID`. Written by `promote-to-production.sh apply` (step `identity`, after the gates and the rollback bundle); `install-stack.sh --only identity` stays stage-only and is refused on a production identity. It is a plaintext 0644 file whose id is not secret: it protects against operator mistakes, not impersonation.
3. **Provisioning**: the promoted host is NOT re-provisioned. The promotion reuses `create-staging-db.sh` (database + accounts), `render-wp-config.sh --env production`, a production edge env/render/unit drop-in, `aicc-ops.production.toml` and the production sentinel targets. `install-stack.sh --production-host --confirm-production` re-installs/updates the stack on the promoted host; its stage-only steps are refused there.
4. **Mail**: the staging pool routes `mail()` to a sink; production uses the Control Plane SMTP layer enabled by the `AICC_MAIL_*` region of the production wp-config, which the renderer keeps only when `/etc/aicc-mail/smtp.env` is valid (`production-promotion.md` section 8). Without it production sends no mail at all; lost-password and order mail are then not delivered.
5. **Secrets inventory** (who holds what): DB passwords and salts are regenerable on the host; the entitlement webhook secret and the activation-proof key are owner-held (password manager) and are NOT in any backup; the Telegram token is owner-held.
6. **Host key**: pinned beforehand for the deploy client (`--known-hosts`, section 6); `production-promotion.md` step 6.1 builds the pinned file for this Droplet.

## 6. Deploy sequence (production; every step stops on the first refusal)

```
1. build:    infra/release/build-cp-release.sh                    (clean commit required)
             infra/release/build-site-release.sh --target production
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
