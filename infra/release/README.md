# Release tooling (staging now, production later)

Owner-approved model: **immutable versioned releases, a `current` symlink and a `previous` symlink, swapped atomically**, for both the static site and the Control Plane (WordPress).

```
/srv/aicc/site/releases/<id>/   _next/static, pages, 50x.html, .well-known/aicc-stage-identity (stage only)
/srv/aicc/site/current   -> releases/<id>          Caddy: root * /srv/aicc/site/current
/srv/aicc/site/previous  -> releases/<id>
/srv/aicc/cp/releases/<id>/     WordPress core + WooCommerce + AICC theme/plugin; wp-content/uploads and wp-config.php are symlinks into shared storage
/srv/aicc/cp/current     -> releases/<id>          PHP-FPM docroot (SCRIPT_FILENAME)
/srv/aicc/cp/previous    -> releases/<id>
/srv/aicc/shared/{wp-config.php (root:aicc-cp 0640), uploads (aicc-cp, setgid, ACL for aicc-edge)}
```

Release id `20261021T101500Z-1a2b3c4d` = UTC build time + first 8 hex of the tree hash. Each release has `<id>.manifest.json`, `<id>.SHA256SUMS` (and `<id>.static.txt` for the site) beside its directory.

## The pipeline

| Step | Script | Where | What it guarantees |
|---|---|---|---|
| Build the site | `build-site-release.sh --target stage --stage-id <id>` | Mac | stage: noindex meta in every HTML file, `robots.txt` = disallow all, no sitemap, `/.well-known/aicc-stage-identity` with the host's random stage id. production: none of that, and the build is checked to contain no identity file, no blanket Disallow and no noindex outside the error pages; a `--stage-id` is refused Optional `--cp-worktree PATH` (the paired Control Plane worktree): `sync-brand-kit.mjs --verify --strict` against the theme COMMITTED there before building; drift fails the build, and a production build without it prints a warning. |
| Build the Control Plane | `build-cp-release.sh --cp-worktree PATH` (REQUIRED, no default) | Mac | WordPress 7.1.3 tarball and WooCommerce 10.9.4 zip verified against pinned SHA-256 (`pins.env`); theme + plugin from `git archive HEAD` of the CP worktree (a dirty tree is refused); `node scripts/sync-brand-kit.mjs --verify --strict` of this Site repo against the packaged theme (drift or stale kit files fail the build); opt-in `--with-payplus` adds the pinned PayPlus Payment Gateway (`pins.env` PAYPLUS_*; a build input, not an endorsement, never activated; the default build is byte-identical without it); tests, `.git`, fixtures, `.env`, SQL and logs excluded; the scan fails on any private key, non-empty `DB_PASSWORD`, salt, rehearsal marker or local path; deterministic tarball (same commit, same bytes) + `manifest.json` + `SHA256SUMS` |
| Deploy | `deploy-release.sh --kind site\|cp --artifact ... --stage-host --stage-ip --stage-id` | Mac | in `--env stage` (the default) refuses production targets/keys, a build for another stage; `--env production` is a separate, tightened path (pinned `--known-hosts`, `--confirm-production <id>`, clean production build, production host identity: see `docs/cutover/production-path.md`); a tampered artifact, a host whose identity differs; (cp) takes a pre-release dump; rsync to `.incoming-<id>`; runs the host's `aicc-activate-release` |
| Activate | `activate-release.sh` | host | verify every file against SHA256SUMS (no extra, no missing); (cp) **pre-release dump gate: refuses unless a successful backup < 15 min old exists, its dump matches its checksum and restore check did not fail; no bypass flag**; (site) carry forward `_next/static`; root-owned read-only tree; atomic swap; (cp) graceful PHP-FPM reload; health gate; auto-rollback; prune |
| Warm up | `warm-cp.sh` (called by `activate-release.sh` and `rollback-release.sh` for `cp` only) | host | AFTER the health gate: one GET each of `/pricing/`, `/my-account/`, `/cart/` and `/?rest_route=/aicc-license/v1/plans` through Caddy's public listener on loopback (`curl --resolve <AICC_PUBLIC_HOST from /etc/aicc-edge/edge.env>:443:127.0.0.1`), 10 s per request, 30 s total, 60 s hard cap in the caller. **Never fails or rolls back a release.** Why: the PHP-FPM reload empties the 128 MiB OPcache and the first requests took 4.8 s (`/pricing/`), 5.3 s (`admin-ajax`) and once 11.5 s (REST) on the host (review M-7); `--no-warm` skips it |
| Roll back | `rollback-release.sh --kind ...` | host | `current` <-> `previous`, health-gated, refuses a release marked FAILED |

### The swap

`ln -sfn <release> current.tmp.$$` then `mv -T current.tmp.$$ current` (a `rename(2)` over the symlink: readers see the old or the new tree, never none). `previous` is set first, `current` second. Tested with 200 swaps against a concurrent reader (no missing link, no partial content). On macOS the reader occasionally sees a transient `EINVAL` (kernel behaviour, also with a pure-Python `os.replace`); the Linux expectation of zero is checked by the same test and **must be confirmed on the host**.

### Health gate and rollback

After the swap (and, for the Control Plane, the PHP-FPM reload) `smoke-cp.sh` / `smoke-site.sh` must succeed twice in a row within 30 s (2 s apart). `smoke-cp.sh` sends `GET /?rest_route=/` straight to the FastCGI socket with the new release's real path: it needs wp-config, MySQL, WordPress, WooCommerce and the AICC plugin to load without a fatal error, and works before Caddy/DNS/TLS exist. `smoke-site.sh` checks the three pages the edge preflight requires, the stage identity, and (when the edge runs) fetches `/` through the loopback listener with the public SNI. If the gate fails: `current` and `previous` are restored, FPM is reloaded again and the gate re-run (exit 3 = rolled back, 4 = the rollback target is unhealthy too = critical). A broken *first* release leaves no `current` (nothing broken is served; the edge preflight then refuses to start).

### Opcache, symlinks and why the reload matters

`opcache.validate_timestamps=0` (files never change inside a release). New code is therefore picked up **only** by the reload that `activate-release.sh` performs (`systemctl reload php8.3-fpm` = SIGUSR2, which recreates the shared memory and clears the realpath cache). Never edit a file inside an active release. **Request for the Caddyfile owner:** use `php_fastcgi ... { root /srv/aicc/cp/current; resolve_root_symlink }` so `SCRIPT_FILENAME` already carries the real release directory; then OPcache keys are per release and a request can never run old code from a new path even before the reload.

## Database migration rule set (code rollback is NOT a database rollback)

1. **Additive only** inside one release: new tables, new nullable/defaulted columns, new indexes, new options. No `DROP`, no `RENAME`, no type narrowing, no `NOT NULL` without a default, no data rewrites that the previous code cannot read.
2. Destructive or incompatible changes use **expand / migrate / contract across at least two releases**: release N adds the new structure and writes both, release N+1 reads the new one, release N+2 removes the old after N+1 has been live and backed up.
3. A migration runs once, idempotently, from code that is safe to run twice; the AICC plugin's schema upgrade (`AICC_LM_DB_SCHEMA_VERSION`) must tolerate being re-run after a rollback and re-activation.
4. Every Control Plane release is preceded by a **fresh dump (< 15 minutes)**; `activate-release.sh` enforces it.
5. If the health gate rolls back, the code returns to the previous release but **the database keeps whatever the failed release already wrote**. If that state is incompatible with the old code (a rule-1 violation), the only remedy is restoring the pre-release dump (`infra/backup/README-backup.md`), which loses everything written after the dump. The owner has accepted that loss for the non-additive case; do not rely on it.
6. WooCommerce and WordPress core upgrades are releases like any other: bump the pins in `pins.env`, build, deploy to staging, read the changelogs for schema changes first.

## Reproducibility and trust chain (honest)

* Build inputs: the pinned WordPress tarball and WooCommerce zip are accepted only if their SHA-256 equals `pins.env`; the CP commit is recorded in `manifest.json` (`sources.cp_commit`) and `SOURCE_DATE_EPOCH` is that commit's time. Two builds gave identical tarball bytes (tested).
* WordPress core: wordpress.org publishes a SHA-1 next to the tarball (matched when the pin was made); the SHA-256 is ours. WooCommerce has no separately published checksum: the pin is trust-on-first-use over TLS, double-checked once against an independent download.
* Pruned from third-party content (and nothing else): WordPress' `readme.html`, `license.txt`, `wp-config-sample.php`, akismet, hello dolly, the two older default themes; WooCommerce directories named `tests`/`test` and `*.phpt` files (Jest specs and vendor tests that ship by accident). The manifest records `vendor_test_files_pruned`.

## Tests

`npm run infra:test` (suite `test_release.sh`, ~220 checks): atomic swap under a concurrent reader, rollback and double rollback, carry-forward for exactly three further releases, retention, every refusal path, the dump gate, the real CP tarball (reproducible, no secrets/fixtures/tests, symlinks only, scan negative tests), stage vs production site builds, deploy guards with stubbed ssh/rsync.

## Deployment record and status

Every activation and rollback appends one JSON line to `/var/lib/aicc/deployments.jsonl` (0644; `AICC_DEPLOY_LOG` overrides in sandboxes): timestamp, outcome (`ok`, `rolled_back`, `critical`, `manual_rollback`), kind, release id, previous release, tarball sha256, source commit, build target, host and the sudo user (always the shared `aicc` account over the deploy path). A FIRST release that fails its health gate writes no record. `sudo aicc-deploy-status [--last N] [--json]` prints what is live, what the rollback target is (with sha256 prefix, commit and target of each build) and the last N records. `activation.log` in each kind directory additionally carries `sha256=... commit=... target=...` for the live release.


## Plugin releases (private store, 2026-10-23)

The AICC **Plugin** ZIP is not a site or Control Plane release: it is published into the Control Plane's private release store (`/srv/aicc/shared/plugin-releases`, `AICC_LM_PLUGIN_RELEASE_DIR`) with `infra/release/publish-plugin-release.sh` (Mac side: verifies the Plugin repo's `bin/build-release.sh` output locally, pushes it over the same fail-closed SSH gates as `deploy-release.sh`, then runs the Control Plane's `scripts/plugin-release/install-plugin-release.sh` as root with `--expect-sha256`; `--set-current` flips the pointer, `--point-at <version>` rolls back or forward; production is a dry run unless `--apply` and needs `--confirm-production <version>`). Tests: `infra/stack-tests/test_plugin_publish.sh` (stubs, plus a compatibility run of the real installer when its worktree exists). Runbook step: `docs/cutover/production-promotion.md` 6.10. Production never publishes a pre-release version (`1.1.0-dev.N`, `-rc`...: refused, also for `--point-at`). The day the owner supplies the two PUBLIC keys, `infra/release/first-signed-release.sh` is the one ordered sequence (preconditions, build, offline sign by the owner, verify, publish dry run, apply, set current, read-only verification) with STOP markers; stages 5 and 6 refuse without `--yes-i-have-the-owners-go`.
