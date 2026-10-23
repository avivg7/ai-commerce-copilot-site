# 05. PRODUCTION PROMOTION + DNS KIT: one operator sequence A to L (NOTHING here was executed, no DNS touched)

Prepared 2026-10-23 by agent kitB. No ssh to any host, no DNS edit, no deploy. Read-only `dig` against Namecheap's authoritative servers and Let's Encrypt / DigitalOcean public pages only.
Verified against Site `launch/integration` ad30a00: `docs/cutover/production-promotion.md` (the authoritative step text, numbered 6.1 to 6.10, 9.1 to 9.9, section 10, 11), `production-path.md`, `runbook.md` (sections 3 to 5), `tls-caa-hsts.md`, `dns-and-mail.md`, `ssh-access.md`, `alerting.md`, `infra/provision/*`, `infra/release/*`. Repo copy: Site branch `launch/kitB` (local, committed, not pushed), `docs/cutover/production-promotion-operator-sequence.md` (this whole file, including the temporary staging Droplet in section 7).
This kit is the ONE ordered view; where it says "see 6.x" the exact command text is in `production-promotion.md` (it is not duplicated here, to avoid two versions drifting). Variables used below: `export SITE=~/self_projects/ai_copilot_site-worktrees/launch-integration HOSTIP=157.230.110.211 RIP=206.189.248.204 OLDID=<current staging id: ~/aicc-rehearsal/bin/stage-ssh 'grep AICC_STAGE_ID /etc/aicc-stage-identity'>`; after step B: `NEWID` and `PSSH="ssh -i $HOME/.ssh/aicc_cp_prod_operator -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts_aicc_prod aicc@$HOSTIP"`.

DNS read today (2026-10-23, authoritative `dns1.registrar-servers.com`): apex A = the four GitHub Pages IPs (185.199.108-111.153); `www` CNAME `avivg7.github.io.`; apex MX = `eforward1..5.registrar-servers.com`; apex TXT = only the SPF `v=spf1 include:spf.efwd.registrar-servers.com ~all`; `stage` A = 206.189.248.204 (the Reserved IP of the Droplet that is about to become production); `api` A = 139.59.157.231; no `edge`, no `_dmarc`, no CAA. Nothing has changed since the 2026-10-20 baseline.

Legend: BLOCKING / NON-BLOCKING / UNKNOWN; STOP = needs the owner's explicit approval at that moment.

---------------------------------------------------------------------------------------------------

## 0. What this sequence assumes and the gaps that MUST be closed first (verified)

| Gap | Where it bites | Fix (Claude, before step B) |
|---|---|---|
| G-A. `AICC_ACTIVATION_PROOF_KID` is not in the production (or stage) wp-config template, but `AICC_LM_Proof::get_current_kid()` fails without it | step C seeding and every "Connect AICC" binding | follow-up F3 (kit 01/04): add the KID line (non-secret id equal to the Backend's `ACTIVATION_PROOF_KID_CURRENT`) and pin it in `test_provision.sh` |
| G-B. No `AICC_LEGAL_*` and no `AICC_LM_PAID_GATEWAYS` region in the production template | legal facts and the payment gate cannot be applied on the host (`render-wp-config.sh` regenerates the file) | follow-up F3 (kit 01/03) |
| G-C. Neither the staging nor the production CP release can contain the PayPlus plugin (`DISALLOW_FILE_MODS`; builder assembles only WordPress, WooCommerce 10.9.4, Storefront, AICC theme/plugin) | payment sandbox on either host | follow-up F1/F2 (kit 01) |
| G-D. The promotion bundle (`push-bundle.sh`) carries the templates: G-A/G-B must be merged BEFORE step B.3 or the host renders an incomplete config | step B | order: finish F-items, `npm run infra:lint && npm run infra:test`, then B |
| G-E. Plugin signing keys do not exist (`UPDATE_PUBLIC_KEYS=` empty in Plugin `release/endpoints.conf`) | step D; CP launch gate rule 5g stays blocked | owner: see `owner-kit/A-ops/` |
| G-F. The Backend release is not on `api.copilt.org` (kit 04 section 0) | CP entitlement webhook delivery from the first license | owner: kit 04 |

A decision the owner must take before B: **where the PayPlus sandbox acceptance (kit 01 section 5) runs.** If sandbox credentials will exist before the promotion date, run it on `stage.copilt.org` FIRST (staging disappears at B). If not, run it on a temporary hourly Droplet (section 7) after the promotion. Dark production cannot do it (internal TLS, nothing reachable by PayPlus).

---------------------------------------------------------------------------------------------------

## A. PRE-PROMOTION (owner gates and Mac-only preparation; host untouched)

| # | Item | Blocking? | Owner action / UI / command | Claude after |
|---|---|---|---|---|
| A1 | Production operator key (passphrase) and off-host pull key; pinned host key | BLOCKING | `ssh-keygen -t ed25519 -f ~/.ssh/aicc_cp_prod_operator -C aicc-cp-prod-operator` (SET A PASSPHRASE); `ssh-keygen -t ed25519 -N "" -f ~/.ssh/aicc_cp_prod_offhost -C aicc-offhost-pull-prod`; pin the host key per 6.1 and compare the fingerprint ONCE with the DigitalOcean web console (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` in the console) | verifies `ssh-keygen -F $HOSTIP -f ~/.ssh/known_hosts_aicc_prod` |
| A2 | Second operator key on another machine + rehearsed console recovery | BLOCKING (ssh-access.md 3.4) | generate the key elsewhere; DigitalOcean > Droplet > Access > Reset root password > Launch Droplet Console rehearsal | records the rehearsal |
| A3 | The two shared secrets exist (owner-held) | BLOCKING | kit 04 step 12 (generate in the password manager; do not type into chat) | checks nothing sensitive |
| A4 | Telegram bot + token on the host; DO alert policies | BLOCKING per `production-promotion.md` section 5 preconditions 1, 2 (do first) | `alerting.md` 1b (3 minutes) and 3 (4 policies + a temporary 5% disk policy to prove delivery); see gate matrix | runs the verification table, leak audit |
| A5 | Backup encryption key (F-05): RSA >= 3072 pair OFF the Mac, private key in the password manager + offline, certificate on the Mac | BLOCKING (the production pull refuses without `--encrypt-to`) | `infra/backup/README-backup.md` "Encrypted off-host copies" | tests with `decrypt-offhost.sh` in step F |
| A6 | Announce the freeze: after B.4 `stage.copilt.org` stops answering | BLOCKING | tell anyone using it (only the owner and Claude today) | stops all stage tests |
| A7 | PayPlus sandbox decision (where to run) | BLOCKING for payments, not for the promotion | section 0 | - |
| A8 | Claude prerequisites: F-items merged (G-A..G-D), `npm run infra:lint && npm run infra:test && npm run ops:test && npm run sentinel:test` green, both Caddy renders validate, releases built from CLEAN commits (6.2) | BLOCKING | approve the SHAs (Site, CP) | C: executes 6.2, records `SITE_REL`, `CP_REL` |
| A9 | Domain-side lead-time items, no effect on traffic: CAA records at Namecheap (`tls-caa-hsts.md` 3: `0 issue "letsencrypt.org"`, `0 issuewild ";"`, `0 iodef "mailto:ops@copilt.org"`), `ops@` forwarder test, Brevo/DMARC steps (kit 02) | NON-BLOCKING for the promotion; CAA before J | Namecheap > Advanced DNS > Host Records > Add New Record (CAA type) | `dig +short CAA copilt.org` and `dig +short CAA stage.copilt.org` |

STOP-gate check (read-only, from the Mac) before moving on: `promote-to-production.sh check` (B.2) must say PASS on every line.

---------------------------------------------------------------------------------------------------

## B. PROMOTE THE EXISTING $12 DROPLET IN PLACE (Droplet `aicc-cp-stage`, 1 vCPU / 2 GiB / FRA1, USD 12 per month, Reserved IP 206.189.248.204 assigned = free)

Steps 6.3 and 6.4 of `production-promotion.md`:
1. B.1 Bring the host tooling up to date, still in STAGING mode (reversible): `push-bundle.sh --stage-ip $HOSTIP --stage-host stage.copilt.org --dry-run` then for real; `scp` the two Caddyfiles; `install-stack.sh --only scripts,systemd,logrotate,fail2ban`; authorise the production operator key.
2. B.2 Place the two owner secrets with hidden prompts (`promote-to-production.sh set-owner-secret entitlement-webhook` and `... activation-proof`) and run the read-only gate: `promote-to-production.sh check --confirm-production --expect-stage-id $OLDID --caddyfile ... --ops-config ...` (every line PASS).
3. **STOP: owner approval.** From here the host is converted and `stage.copilt.org` stops answering (section 6 of this kit). Rollback R1 exists.
4. B.3 `promote-to-production.sh apply --confirm-production ...` (writes identity `AICC_ENV=production`, backs up to the rollback bundle `/var/backups/aicc-promotion/<ts>`, dumps and drops the staging database, new random DB passwords, production wp-config, production edge env and dark render, units, AICC Ops production config). Exit 3 = a gate failed and nothing changed; re-run the same command to resume.
5. B.4 `$PSSH 'sudo ~/aicc-infra-bundle/infra/provision/promote-to-production.sh start --confirm-production'`; `systemctl is-active mysql php8.3-fpm aicc-edge aicc-ops aicc-wp-cron.timer aicc-backup.timer` (cert-expiry timer inactive by design while dark).
6. B.5 Swap the Mac LaunchAgents (staging pull agent uninstalled, sentinel on `targets.dark.toml`, i.e. `api.copilt.org` only).
Claude after B: reads `cat /etc/aicc-stage-identity`, `aicc-deploy-status --last 6` (a `promoted_to_production` boundary record), `aicc-edge-listener-audit`.

## C. DARK-PRODUCTION VALIDATION (nothing public; the host answers only on its IP / the operator tunnel)

C.1 Fresh WordPress and seeding (6.5): `promote-to-production.sh wp-install --admin-user <login> --admin-email <addr>` (hidden password prompt; no `wp-admin.pass` file; a guessable admin name is refused), then the three idempotent seed scripts from the CP repo (`bootstrap-commercial-products`, `configure-account-required-checkout`, `seed-legal-documents`) and the read-only launch checker. The last command is EXPECTED to list blockers (legal facts, gateway, mail, plugin release): that is the launch checklist, not a failure.
C.2 Verification that does not need the production site build: identity file, `aicc-edge-listener-audit`, services, AICC Ops overview, `$PSSH 'sudo grep -c "stage.copilt.org" /srv/aicc/shared/wp-config.php'` must print 0, `woocommerce_coming_soon` still `yes`.
(The full `production-edge-check.sh` run needs the production Site build and therefore comes after step E; see E.3.)
Claude after C: records the checker output as the open-items list for the owner.

## D. SIGNED PLUGIN SEED (publish the first Plugin release into the private store)

BLOCKING for the CP launch gate rule 5g. Needs the owner's offline signing keys and decisions (first version; recommended 1.1.0, release notes; Reco mascot art rights): `owner-kit/A-ops/`. Command text: 6.10 (build with `bin/build-release.sh` from a CLEAN Plugin commit AFTER `UPDATE_PUBLIC_KEYS=<primary>,<standby>` is committed; `php bin/sign-release.php sign` on the owner's offline machine; `verify`; `publish-plugin-release.sh --env production ... --confirm-production <version>` as a dry run, then `--apply`, then `--apply --set-current`). The store is `/srv/aicc/shared/plugin-releases` (root:aicc-cp 0750, in the backup).
Verification happens after E (the check script needs the CP release live): `$PSSH 'sudo env AICC_PRODUCTION=1 aicc-wp eval-file /var/lib/aicc-cp/seed/check-launch-blockers.php | grep -i "plugin download"'` shows "current release <version> ... (verified now)" and no 5g blocker.

## E. CP + SITE RELEASES (production builds, dark)

E.1 Build with the facts exported (kit 03 section 4.1): `infra/release/build-site-release.sh --target production --out-dir ~/aicc-releases` (inherits `NEXT_PUBLIC_*`; owner values must be exported BEFORE or the release publishes pending lines), `infra/release/build-cp-release.sh --out-dir ~/aicc-releases` (WordPress 7.1.3 + WooCommerce 10.9.4 + Storefront 4.6.2 + AICC theme/plugin from the CP worktree; pass `--cp-worktree` explicitly: the script's default is the old cp2a-14 worktree). The PayPlus plugin is NOT in these builds (F1 flag stays off until the owner approves).
E.2 `deploy-release.sh --env production --kind site|cp --artifact ... --stage-host www.copilt.org --stage-ip $HOSTIP --stage-id $NEWID --key ~/.ssh/aicc_cp_prod_operator --known-hosts ~/.ssh/known_hosts_aicc_prod --confirm-production <release id> --dry-run`, then without `--dry-run` (pre-release dump < 15 minutes is enforced; health gate twice; automatic rollback exit 3/4).
E.3 Dark verification (6.7): fetch Caddy's PUBLIC root certificate, `scripts/ops/production-edge-check.sh --ip $HOSTIP --cacert ~/aicc-promotion/caddy-root.crt --full-demo-hash` (72 read-only checks, 0 failed expected), `aicc-edge-listener-audit`, operator browser through `operator-tunnel.sh --env production ... --spki-hash` (separate Chrome profile only), and the client-address proof 6.7b (31st request 429 from one source, a second source not 429).
Claude after E: runs 6.7 and 6.7b read-only parts and the CP launch checker; re-runs the D verification.

## F. BACKUPS

6.8: `$PSSH 'sudo aicc-backup --label manual'`; install the restricted pull account with the production key (`install-offhost-access.sh --env production --confirm-production --pubkey-file ...`); one pull by hand with `pull-offhost.sh --env production --stage-ip $HOSTIP --expect-id $NEWID --known-hosts ~/.ssh/known_hosts_aicc_prod_cp --encrypt-to $BKCERT` (ciphertext only on the Mac); prove decryption once with `decrypt-offhost.sh --key <private key from the password manager>`; install the hourly LaunchAgent `com.aicc.offhost-pull.production`; read `offhost-ack.json` (verified true). Optional destructive proof `dr-drill.sh --env production ... --i-understand-this-wipes-production-data` is allowed ONLY while the host holds no customer and no order (the tool checks). Honest limit: the second copy is the owner's Mac (copies were at most about 4.7 h old, 0 failures in 26.5 h, measured earlier); decide a second always-on copy (gate matrix).

## G. MONITORING

AICC Ops production config (label `aicc-cp-prod (production)`, `cert_expiry` OFF while dark), Telegram test table (`alerting.md` 1b a-j, leak audit CLEAN), DO policies confirmed by the temporary test policy, Mac sentinel on `targets.dark.toml`, and prepared (not enabled before DNS) the 24/7 GitHub Actions sentinel in a NEW dedicated PUBLIC repository (`infra/sentinel/github/prepare-sentinel-repo.sh --out ~/aicc-sentinel-repo`; never the old public site repo, whose `main` can redeploy the live site). Until the Actions sentinel runs, a whole-host or DNS outage while the Mac sleeps is detected by nothing external.

## H. SOAK (24 hours dark; the lower bound of the plan)

Pass criteria (6.9): AICC Ops overview no CRITICAL; 24 hourly backups with Mac acks; `production-edge-check.sh` still green; DO policies exist and the test alert was received; deploy status as expected; `aicc-restore scratch --production` of the newest set loads and fingerprints. Owner decision points here: CAA records published, `edge.copilt.org` A record added (TTL 300) and DNS TTLs lowered (section I.0). Nothing public has happened yet.

## I. DNS CUTOVER (STOP: owner approval; irreversible-ish)

Preconditions (production-promotion.md 9 + runbook 5): sections A to H done; Backend release live and kit 04 steps 13 to 15 green (no commerce on the old Backend); the TTLs have been 300 s for at least 24 h; Pages certificate notAfter re-checked (`echo | openssl s_client -connect www.copilt.org:443 -servername www.copilt.org | openssl x509 -noout -dates`, expected 2027-01-18 12:41:22 GMT as of 2026-10-20: the rollback-to-Pages window ends there); legal/support/payment either done or consciously accepted for a PRE-SALES launch (`woocommerce_coming_soon` stays `yes`: checkout closed); a person available for the next hour.

I.0 (T-2 days, after the host is dark and verified) Namecheap > Advanced DNS > Host Records: ADD `A  edge  206.189.248.204  TTL 300`; EDIT only the TTL of the `www` CNAME and the four apex A records to 300; do NOT touch MX, the SPF TXT or any other TXT; add the CAA rows (A9). Wait at least 24 h.
Then, in order, stop at the first failure (steps 9.1 to 9.9 of production-promotion.md):
1. Mac: `infra/sentinel/macos/install-launchd.sh --targets infra/sentinel/targets.production.toml --apply`.
2. Registrar: EDIT the `www` CNAME TARGET in place from `avivg7.github.io.` to `edge.copilt.org.` (never delete and re-add: the SOA minimum is 3601 s, an empty name can be cached for an hour).
3. `dig @dns1.registrar-servers.com +noall +answer www.copilt.org CNAME` until it shows `edge.copilt.org.`.
4. Host: `promote-to-production.sh final-edge --confirm-cutover --caddyfile ~/aicc-infra-bundle/Caddyfile.final --expect-ip $RIP` (refuses unless public DNS already resolves www to the Reserved IP; installs the automatic-HTTPS render, removes the dark overrides, enables the cert-expiry timer, RESTARTS the edge). Watch `journalctl -u aicc-edge -f`.
5. Mac: `scripts/ops/production-edge-check.sh --ip $RIP --public --full-demo-hash`; the 270-case replay against the live names; the smoke checklist of `runbook.md` section 4.
6. ROLLBACK POINT R3: if anything fails, edit the `www` CNAME back to `avivg7.github.io.` and optionally `dark-edge` on the host. Do not continue unless step 5 is green.
7. Registrar: EDIT the FOUR apex A records IN PLACE to `206.189.248.204` (edit the first, then the others to the same value or remove them; the apex is never empty). MX, SPF, TXT untouched.
8. Verify the apex: `curl -sIL http://copilt.org/x?y=1` -> one hop 301 to `https://www.copilt.org/x?y=1`; run the edge check again.
9. HSTS stays `max-age=300`; announce only after 5 and 8 are green.

## J. LET'S ENCRYPT

Issuance is by Caddy (automatic HTTPS) for `www.copilt.org` and `copilt.org`, ACME contact `ops@copilt.org` (a forwarder: verify it receives; do not rely on the CA's expiry mail). Rules (https://letsencrypt.org/docs/rate-limits/, read 2026-10-23): 5 authorization failures per identifier per account per hour (refill 1 per 12 minutes); 5 certificates per exact set of names per 7 days; 50 certificates per registered domain per 7 days. This is why the dark phase uses `tls internal` and `final-edge` refuses until `www` resolves to the edge. The apex name validates only after step I.7 points the apex at the host: if the apex certificate is missing minutes after propagation, reload Caddy ONCE rather than waiting for the backoff; if still failing, apply the rollback conditions. Verify: `openssl s_client -connect www.copilt.org:443 -servername www.copilt.org </dev/null 2>/dev/null | openssl x509 -noout -issuer -subject -dates` (issuer Let's Encrypt, not "(STAGING)" and not Caddy Local); `scripts/ops/cert-expiry-check.sh --host www.copilt.org`; the `aicc-cert-expiry` timer is now on and AICC Ops `cert_expiry` WARNING 14 d / CRITICAL 5 d. CAA (A9) allows exactly `letsencrypt.org`; no `accounturi=` until the old Pages site is retired (GitHub renews with its own account). HSTS ramp afterwards: `tls-caa-hsts.md` section 4 (300; 86400 after a clean day and live renewal monitoring; 604800 after 7 clean days; 31536000 after 4 clean weeks; no `includeSubDomains`, no `preload` without approval; keep 300 for the whole Pages rollback window).

## K. FINAL SMOKE (after I.9, against live DNS)

`runbook.md` section 4 checklist for en, /he/, /es/, /ru/ (home, product, pricing, legal pages 200 from WordPress; Get started / Sign in reach `/my-account/` and the prefixed variants; `wc_ajax_url` never prefixed; cookies Secure; no mixed content; `/robots.txt` and `/sitemap.xml` www-only; cart and checkout NOT publicly reachable while no real gateway is configured; admin surface 403 from outside; `Host: evil.example` gets 421; security headers and none of Server/X-Powered-By/Via); plus: two-source rate-limit test; outbox delivery to the new Backend within 10 minutes (needs kit 04 step 15); a password-reset mail delivered with `dkim=pass header.d=copilt.org` (kit 02 E8, only after the mail decision); `https://api.copilt.org/health` shows `entitlement_mode: enforced`; the WooCommerce fail-soft invariant (edge stopped, a store with the plugin keeps selling). Evidence to `~/Downloads/AICC-launch-evidence/` (no secrets).

## L. ROLLBACK (the rollback table of production-promotion.md section 4, condensed)

| Point | State | Command | Lost |
|---|---|---|---|
| R0 before B.3 | untouched staging | nothing | nothing |
| R1/R2 after apply, dark | production identity, empty DB | `$PSSH 'sudo ~/aicc-infra-bundle/infra/provision/promote-to-production.sh rollback --bundle /var/backups/aicc-promotion/<ts> --confirm-rollback'` (staging identity, edge, wp-config, secrets, the verified staging database, old backup directory; appends `demoted_to_staging`) | production-side work since apply |
| R3 after the `www` flip | public on www | edit the `www` CNAME back to `avivg7.github.io.`; optionally `promote-to-production.sh dark-edge --caddyfile ... --ops-config ...`; allowed ONLY before the first customer | nothing (no customer) |
| R4 after the apex flip | public | edit the four apex A records back to the GitHub IPs; as R3 | - |
| R5 after the first customer | public | `$PSSH 'sudo aicc-rollback-release --kind site'` or `--kind cp`; DB restore from the pre-release dump only for a schema-breaking release; NO DNS revert (the old site has no accounts or checkout) | data written after the dump |
Honest limits: a rollback to Pages works only until the Pages certificate in force at the flip expires; mixed behaviour lasts one TTL plus resolver and browser tails (30 to 60 minutes worst case, about 5 minutes best case); the Control Plane disappears during a rollback to Pages.

---------------------------------------------------------------------------------------------------

## 6. What happens to `stage.copilt.org` (it is RETIRED by the promotion)

| Aspect | What happens, exactly when | Your action |
|---|---|---|
| The name stops answering | At step B.3 `apply`: the identity file changes to production and the edge render is replaced by the production render that serves only `www.copilt.org` and `copilt.org` (dark: `tls internal`). The services are stopped by `apply` and restarted by the separate `start` (B.4), after which a request for `stage.copilt.org` reaches a Caddy that has no site block for that name (TLS handshake failure on 443, the catch-all 421 on plain HTTP). Exactly: from the moment `apply` completes | announce the freeze (A6). Nothing public ever used the name |
| DNS record | The `stage` A record (206.189.248.204) stays in Namecheap and points at the SAME address that becomes the production edge: harmless, but it is a dangling public name. Planned deletion: T+7 days after a clean cutover (`production-promotion.md` 10.4), together with the rollback bundle | delete at T+7 d: Namecheap > Advanced DNS > Host Records > the `stage` row > delete. Do it earlier only if you accept losing the R1/R2 rollback to staging. NEVER leave it if the Reserved IP is ever unassigned |
| Certificate | The Let's Encrypt certificate for `stage.copilt.org` (notAfter 2027-01-19) stays in Caddy's storage and is never renewed (Caddy maintains only names present in its Caddyfile). It is a public certificate, not a secret key leak | leave it, or after T+7d remove that certificate directory under `/var/lib/aicc-edge/caddy/certificates/` (path to be confirmed with `sudo find /var/lib/aicc-edge/caddy -name '*stage.copilt.org*'`) |
| SSH | The staging operator key `aicc_cp_stage` stays authorised in `~aicc/.ssh/authorized_keys` until T+7d (the wrapper `~/aicc-rehearsal/bin/stage-ssh` has the IP hard-coded and does NOT check the host identity: after B.3 it logs into PRODUCTION; use `$PSSH` instead and stop using the wrapper). The staging pull account key is REPLACED by the production pull key in step F | at T+7 d remove the staging operator key from `authorized_keys`; move `~/.ssh/aicc_cp_stage*` to the password-manager archive and delete them from the Mac when the rollback bundle is deleted |
| known_hosts | `~/.ssh/known_hosts_aicc_stage` holds the host key of THIS server (same machine, same key). The production pinned files (`known_hosts_aicc_prod`, `known_hosts_aicc_prod_cp`) were built from it in A1 and keep the same key. Do NOT delete the key line from the production files. Delete `known_hosts_aicc_stage` after T+7d. A future temporary staging Droplet has a NEW host key: never reuse that file for it (ssh would warn "REMOTE HOST IDENTIFICATION HAS CHANGED", which is correct) | use a new file `known_hosts_aicc_stage_tmp` for the temporary host |
| Mac artefacts | `~/aicc-offhost-backups-stage` (staging dumps, wp-config with staging secrets) kept 14 days for the rollback window, then deleted; the staging LaunchAgents were uninstalled at B.5 | delete at T+14 d (`production-promotion.md` D7) |
| Tooling | The fail-closed staging test tools refuse a production-identity host by design; `npm run staging:replay` needs the stage identity route and cannot run against production; the stage sentinel `targets.stage.toml` expects the Reserved IP and would alarm if left installed | uninstall the stage sentinel agent at B.5 (already in the doc) |

## 7. Consequences of having NO permanent staging, and the temporary hourly Droplet substitute

### 7.1 Consequences (be explicit)
1. Releases are rehearsed only on the Mac rehearsal stack and the Ubuntu container tests (`infra:test`); the first real Linux/systemd/Caddy/MySQL 8.0 run of any change is on production. The safety net is the pre-release dump gate (<15 min), the health gate with automatic rollback (exit 3/4) and `aicc-rollback-release`.
2. Schema-breaking releases cannot be rehearsed on real MySQL on Linux; follow the expand/migrate/contract rule (`infra/release/README.md`).
3. Provider integrations that need a PUBLIC HTTPS non-production URL (PayPlus sandbox callbacks, mail link clicks) have no home: use the temporary Droplet.
4. Hourly security updates (`aicc-security-updates.timer`) hit production with no canary; the 2026-10-21 PHP security update is the precedent.
5. Destructive DR drills (`dr-drill.sh --env production`) are allowed only while the host holds no customer or order; afterwards only `aicc-restore scratch --production`.
6. What it saves: USD 12 per month. What it costs when needed: about USD 0.43 per day (7.3).

### 7.2 Create a TEMPORARY staging Droplet later (owner console steps; no API token needed)
Prerequisites: the old `stage` A record must no longer point at the production Reserved IP: EDIT it (in place) to the new Droplet's IPv4 (step 7), or delete it first. NEVER aim any stage tool at 157.230.110.211 / 206.189.248.204 (they are production).
1. Key: reuse `~/.ssh/aicc_cp_stage` (it is no longer authorised on production after T+7d) or `ssh-keygen -t ed25519 -a 64 -f ~/.ssh/aicc_cp_stage_tmp -C aicc-cp-stage-tmp`. Never `aicc_cp_prod*` or `aicc_digitalocean_prod` (the renderer refuses them).
2. `cd $SITE && infra/provision/render-cloud-init.sh ~/.ssh/aicc_cp_stage_tmp.pub > /tmp/aicc-cloud-init.yaml` (read it: base hardening only).
3. DigitalOcean console > Create > Droplets: region FRA1, Ubuntu 24.04 LTS x64, Basic > Regular, plan USD 12/mo (1 vCPU / 2 GB / 50 GB; summary price must read USD 12.00/month), SSH key, Monitoring ON, IPv6 ON (free), User data = the whole cloud-init file, Backups OFF, hostname `aicc-cp-stage-tmp`, tags `aicc` and `stage-temp`. Do NOT attach a Reserved IP (an unassigned one costs USD 5/month; https://docs.digitalocean.com/products/networking/reserved-ips/details/pricing/).
4. Cloud Firewall: attach 22/80/443 inbound (the existing `aicc-cp-stage-fw` can apply to the tag `stage-temp`) so the old policy does not leave the new box open or blocked.
5. Wait about 3 minutes; `infra/provision/verify-droplet.sh --ip <NEW IPv4> --key ~/.ssh/aicc_cp_stage_tmp`.
6. Bring-up: `RUNBOOK-stage-bringup.md` steps 1 to 8 (push-bundle with `--stage-host stage.copilt.org`, the two-session stage-2 hardening, `install-stack.sh`, `create-staging-db.sh`, `render-wp-config.sh` (stage), edge env, CP release incl. the PayPlus flag build, `wp core install`, site stage build, Caddyfile, `enable-edge`; first start with the Let's Encrypt STAGING directory). About 2 to 3 hours of operator time, most of it waiting.
7. DNS (Namecheap, owner): `A stage <NEW IPv4> TTL 300` (edit the old row in place). Let's Encrypt for the name `stage.copilt.org` is within the 5 duplicate certificates per week limit unless repeated.
8. Use it; run kit 01 section 5; then tear down.
Optional doctl route (needs an API token the owner creates in the DO console API tab, scoped to droplets/firewall/ssh keys, entered with `doctl auth init` at its hidden prompt and revoked afterwards): `doctl compute ssh-key import aicc-cp-stage-tmp --public-key-file ~/.ssh/aicc_cp_stage_tmp.pub` ; `doctl compute droplet create aicc-cp-stage-tmp --region fra1 --image ubuntu-24-04-x64 --size s-1vcpu-2gb --ssh-keys <fingerprint> --user-data-file /tmp/aicc-cloud-init.yaml --enable-monitoring --enable-ipv6 --tag-names aicc,stage-temp --wait` (flags confirmed in https://docs.digitalocean.com/reference/doctl/reference/compute/droplet/create/ on 2026-10-23; the slug `s-1vcpu-2gb` is NOT confirmed there: check `doctl compute size list`) ; `doctl compute droplet list --format ID,Name,PublicIPv4,Status`.
Host key and wrapper: create a copy of the wrapper with the new IP and a NEW known_hosts file (`~/aicc-rehearsal/bin/stage-ssh` has `STAGE_IP=157.230.110.211` hard-coded: do not reuse it).

### 7.3 Cost estimate (https://www.digitalocean.com/pricing/droplets and docs.digitalocean.com/products/droplets/details/pricing/, read 2026-10-23)
USD 0.01786 per hour (USD 12.00/mo cap) billed per second with a 60-second minimum; a POWERED-OFF Droplet is still billed; billing ends only when the Droplet is DESTROYED. 8 hours = about USD 0.14; 24 hours = USD 0.43; 48 hours = USD 0.86; 7 days = USD 3.00; never more than USD 12 per month. Public IPv4 on bundled plans is included. Snapshots (USD 0.06 per GB-month) and Backups are not used. Let's Encrypt is free.

### 7.4 Teardown (the same day you finish)
1. Archive the evidence; if the PayPlus SANDBOX keys were entered, nothing remains after destroy, but revoke them at PayPlus if you can.
2. DigitalOcean console > the Droplet > Destroy > "Destroy this Droplet" (or `doctl compute droplet delete <id> --force`). Confirm the Droplet list is empty and the next invoice preview shows no Droplet.
3. Namecheap: delete the `stage` A row.
4. Delete the SSH key entry created for it (console > Settings > Security), the firewall rule changes if any, `known_hosts_aicc_stage_tmp`, the wrapper copy, `~/aicc-offhost-backups-stage-tmp` if you pulled one.
5. Confirm `dig +short stage.copilt.org` returns nothing.

---------------------------------------------------------------------------------------------------

## 8. UNKNOWN list

Everything about the conversion on the real host (never run: `systemctl`, real MySQL 8.0, real `aicc-wp`, `wp core install --prompt` over a piped TTY, Caddy production start with `tls internal` on Linux, the `final-edge` restart gap, Let's Encrypt issuance for www and the apex, IPv6 (no AAAA published, the guest has none), SMTP delivery, Telegram delivery, DigitalOcean alert emails, the Actions sentinel); whether the Namecheap UI applies an edit atomically (a throwaway-name dry run answers it); whether Namecheap offers ALIAS/ANAME at the apex (not needed); the second operator key and console recovery (not yet rehearsed); exact behaviour of `stage.copilt.org` requests after retirement (TLS alert vs 421, inferred from the Caddy configuration, not observed); the doctl size slug; today's Pages certificate notAfter (re-check on the day).
Sources: repo docs named above; Let's Encrypt limits page (2026-10-23); DigitalOcean pricing pages (2026-10-23); dig output (2026-10-23).
