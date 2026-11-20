<?php
/**
 * AICC Control Plane PRODUCTION wp-config.php TEMPLATE.            AICC_TEMPLATE: production
 *
 * THIS FILE CONTAINS NO SECRETS. Upper-case tokens wrapped in double at-signs are replaced ON THE PRODUCTION HOST by `infra/provision/render-wp-config.sh --env production
 * --confirm-production` from files in /etc/aicc/secrets (0600 root); the result is /srv/aicc/shared/wp-config.php (0640 root:aicc-cp), which every release symlinks to.
 * Nothing rendered from this file is committed or copied off the host except inside the 0600 files archive of the backup.
 *
 * It is the stage template (wp-config.stage.template.php) with exactly the environment-specific differences listed in docs/cutover/production-path.md and
 * enforced by infra:lint / test_provision.sh (the set of defines that differ between the two renders is pinned). Nothing here is activated by anything in this repository:
 * the render script refuses to write a production file on a host whose identity file does not say AICC_ENV=production.
 *
 * What production adds or changes compared with staging:
 *   * WP_HOME / WP_SITEURL / WP_ENVIRONMENT_TYPE are the production ones.
 *   * The Control Plane -> Backend entitlement webhook is delivered to the production API over https, and WordPress may reach EXACTLY that host and nothing else
 *     (updates and telemetry stay blocked: code only ever arrives as a reviewed release). When a payment gateway is configured its API host must be added to
 *     WP_ACCESSIBLE_HOSTS in a reviewed change.
 *   * The two plugin secrets are NOT generated: AICC_ENTITLEMENT_WEBHOOK_SECRET must equal the Backend's value and AICC_ACTIVATION_PROOF_SECRET is the production
 *     activation-proof key; the owner places both in /etc/aicc/secrets (0600) and the renderer refuses to continue without them.
 *   * No mail sink: transactional mail goes through the Control Plane's SMTP layer, enabled only when the owner has placed a valid /etc/aicc-mail/smtp.env (see the mail region below).
 */

// ---- database: UNIX SOCKET only (MySQL runs with skip-networking) --------------------------------------------------------------------------
define( 'DB_NAME', 'aicc_cp' );
define( 'DB_USER', 'aicc_cp' );
define( 'DB_PASSWORD', 'golden_db_pass_0001' );
define( 'DB_HOST', 'localhost:/run/mysqld/mysqld.sock' );
define( 'DB_CHARSET', 'utf8mb4' );
define( 'DB_COLLATE', '' );
$table_prefix = 'wp_';

// ---- keys and salts (generated once on the host; re-rendering keeps them so logged-in sessions survive a re-render) ---------------------------
define( 'AUTH_KEY', 'SALTVALUE_AUTH_KEY' );
define( 'SECURE_AUTH_KEY', 'SALTVALUE_SECURE_AUTH_KEY' );
define( 'LOGGED_IN_KEY', 'SALTVALUE_LOGGED_IN_KEY' );
define( 'NONCE_KEY', 'SALTVALUE_NONCE_KEY' );
define( 'AUTH_SALT', 'SALTVALUE_AUTH_SALT' );
define( 'SECURE_AUTH_SALT', 'SALTVALUE_SECURE_AUTH_SALT' );
define( 'LOGGED_IN_SALT', 'SALTVALUE_LOGGED_IN_SALT' );
define( 'NONCE_SALT', 'SALTVALUE_NONCE_SALT' );

// ---- identity and URLs -------------------------------------------------------------------------------------------------------------------------
define( 'WP_ENVIRONMENT_TYPE', 'production' );
define( 'WP_HOME', 'https://www.copilt.org' );
define( 'WP_SITEURL', 'https://www.copilt.org' );
define( 'FORCE_SSL_ADMIN', true );

// HTTPS DETECTION: Caddy's php_fastcgi sets the FastCGI parameter HTTPS=on for TLS requests, PHP exposes it as $_SERVER['HTTPS'], and WordPress'
// is_ssl() reads exactly that. Deliberately NOT done: trusting X-Forwarded-Proto / X-Forwarded-For. There is no proxy in front of PHP-FPM; those headers
// are client-controlled here. (docs/cutover/Caddyfile.edge.template describes the HTTP-upstream variant, which this host does not use.)

// ---- immutable code: no file changes from inside WordPress ------------------------------------------------------------------------------------
// Code arrives only as a new release (infra/release). DISALLOW_FILE_MODS also blocks plugin/theme install, update and the editors, and hides the
// update UI; auto-updates are off as well. Core, plugin and theme versions change only through a reviewed release.
define( 'DISALLOW_FILE_MODS', true );
define( 'DISALLOW_FILE_EDIT', true );
define( 'AUTOMATIC_UPDATER_DISABLED', true );
define( 'WP_AUTO_UPDATE_CORE', false );

// ---- cron: system timer only ---------------------------------------------------------------------------------------------------------------------
// aicc-wp-cron.timer runs `wp cron event run --due-now` every 2 minutes; /wp-cron.php is operator-only at the edge.
define( 'DISABLE_WP_CRON', true );

// OUTBOUND HTTP: blocked for every request except WordPress's own host and the single host listed below (no wordpress.org / woocommerce.com update or telemetry traffic,
// no Gravatar, no payment host until one is configured in a reviewed change). Security review M1 applies here too: NO localhost / 127.0.0.1 (they would turn any
// wp_remote_get() SSRF into a request to Caddy's admin API, the operator listener or AICC Ops); the cgroup network lock in infra/systemd/overrides/php8.3-fpm.service.d/aicc.conf
// closes the same door for raw PHP sockets.
// The edge serves the static /product/ page (the theme otherwise falls back to /#why when it is not behind the edge).
define( 'AICC_PRODUCT_PAGE_ON_EDGE', true );
define( 'WP_HTTP_BLOCK_EXTERNAL', true );
define( 'WP_ACCESSIBLE_HOSTS', 'api.copilt.org,challenges.cloudflare.com,api.brevo.com' );

// ---- diagnostics: off (errors go to /var/log/aicc-cp/php-error.log through the pool; nothing is shown to visitors) -------------------------------
define( 'WP_DEBUG', false );
define( 'WP_DEBUG_LOG', false );
define( 'WP_DEBUG_DISPLAY', false );
define( 'SCRIPT_DEBUG', false );

// ---- memory: one ceiling, matching the pool (php_admin_value[memory_limit] = 192M) so wp-admin never asks for more than PHP would grant ----------
define( 'WP_MEMORY_LIMIT', '128M' );
define( 'WP_MAX_MEMORY_LIMIT', '192M' );
define( 'WP_POST_REVISIONS', 5 );
define( 'EMPTY_TRASH_DAYS', 14 );

// ---- mail: the Control Plane's own SMTP layer (AICC_LM_Mail), configured ONLY by constants + the path of a root-owned secrets file ---------------------------------------
// The layer is completely inert unless AICC_MAIL_ENABLED is exactly true. render-wp-config.sh keeps the region below ONLY when /etc/aicc-mail/smtp.env exists, is owned by root, is
// group aicc-cp, mode 0640 (or stricter), holds exactly AICC_MAIL_SMTP_USER and AICC_MAIL_SMTP_PASS (both non-empty) and sits outside the web root; otherwise the region is removed and
// production sends no mail at all (never through PHP mail(), never through the staging mail sink). The credentials are NEVER in this file.
// WHY /etc/aicc-mail and not /etc/aicc/secrets: /etc/aicc is 0750 root:root, so the PHP user (aicc-cp) cannot even traverse to /etc/aicc/secrets/smtp.env (verified on the host 2026-10-22). Loosening that
// directory would expose the other secrets' names; a dedicated directory /etc/aicc-mail (0750 root:aicc-cp, like /etc/aicc-edge for its group) gives PHP exactly one readable file. Staging has no such region and keeps the mail sink.
// Provider values are the owner-approved relay of docs/cutover/production-promotion.md section 8 (Brevo relays on smtp-relay.brevo.com:2525; DigitalOcean blocks 25/465/587). The layer speaks
// SMTP through PHPMailer sockets, NOT through wp_remote_*, so the relay host does NOT belong in WP_ACCESSIBLE_HOSTS. Changing provider is a reviewed change of this region.
// (SMTP mail layer not rendered: AICC_MAIL_PROVIDER=brevo_api selects the Brevo API region below)
// ---- P38 Brevo transactional e-mail over the HTTPS API: rendered by render-wp-config.sh ONLY when the owner fact AICC_MAIL_PROVIDER=brevo_api is set AND /etc/aicc-mail/brevo-api.key passed every check (regular file, not a symlink, root:aicc-cp, mode 0640 or 0440,
// first line = the key as the Control Plane reads it); otherwise this whole region (including these lines) is removed and the render is byte-for-byte the render before P38. The sender, reply-to and budget come from owner facts; the KEY is never a constant, a fact or
// a rendered value: only the PATH of its file is written (AICC_MAIL_API_KEY_FILE). Never defined by this region: AICC_NOTIFY_ENABLED or any campaign / scheduler / self-service switch (Brevo configuration must not activate them), AICC_MAIL_API_KEY (the Control Plane refuses a key constant).
// The provider host is added to WP_ACCESSIBLE_HOSTS by the renderer in the same condition and never otherwise. The SMTP region above is not rendered while this one is (the provider fact decides; both secret files without the fact is refused). Procedure: docs/cutover/p38-brevo-host-update.md.
define( 'AICC_MAIL_ENABLED', true );
define( 'AICC_MAIL_PROVIDER', 'brevo_api' );
define( 'AICC_MAIL_API_KEY_FILE', '/etc/aicc-mail/brevo-api.key' );
define( 'AICC_MAIL_FROM_ADDRESS', 'notifications@copilt.org' );
define( 'AICC_MAIL_FROM_NAME', 'AI Commerce Copilot' );
define( 'AICC_MAIL_REPLY_TO', 'support@copilt.org' );
define( 'AICC_MAIL_ALLOWED_FROM_DOMAINS', array( 'copilt.org' ) );
define( 'AICC_MAIL_DAILY_BUDGET', 240 );
// ---- end P38 Brevo ----

// ---- AICC Control Plane plugin ---------------------------------------------------------------------------------------------------------------------
// Client IP: the plugin trusts X-Forwarded-For only from addresses listed here. EMPTY on purpose: PHP-FPM receives the real TCP peer as REMOTE_ADDR
// from Caddy's FastCGI transport, so REMOTE_ADDR already IS the client (or 127.0.0.1 for an operator coming through the SSH tunnel).
// VERIFIED 2026-10-23 (real-Caddy + real php-fpm rehearsal; the live edge log shows thousands of distinct client addresses): with php_fastcgi over a unix socket PHP's REMOTE_ADDR IS the client and every
// forwarding header is stripped at the edge, so this stays EMPTY (docs/cutover/production-promotion.md D11). Listing any address would only create a path to trust a client-supplied header.
define( 'AICC_LM_TRUSTED_PROXIES', array() );
// Operators exempt from the login throttle: loopback only (the SSH tunnel). Nobody on the public internet is exempt.
define( 'AICC_LM_OPERATOR_CIDRS', array( '127.0.0.1/32', '::1/128' ) );
// Private Plugin release store (docs/plugin-delivery.md in the Control Plane): the immutable ZIPs customers download and the `current` pointer. ABSOLUTE, OUTSIDE every web root (the static root is
// /srv/aicc/site/current, the PHP docroot /srv/aicc/cp/current; this directory is a sibling of uploads under /srv/aicc/shared and no Caddy route serves it), root:aicc-cp 0750 so PHP-FPM can read and
// nothing but scripts/plugin-release/install-plugin-release.sh (run as root by infra/release/publish-plugin-release.sh) can write. Same value on staging and production (pinned by test_provision.sh).
define( 'AICC_LM_PLUGIN_RELEASE_DIR', '/srv/aicc/shared/plugin-releases' );
// CP -> Backend entitlement webhook: https, the production API host only (the Control Plane launch gate scripts/check-launch-blockers.php, enforced with AICC_PRODUCTION=1,
// refuses a configuration whose effective URL is not https on the API host or whose outbound allow-list does not contain it).
define( 'AICC_ENTITLEMENT_WEBHOOK_URL', 'https://api.copilt.org/v1/internal/entitlement/webhook' );
// Owner-provided production secrets (never generated by the renderer, never committed): the webhook secret must equal the Backend's.
define( 'AICC_ACTIVATION_PROOF_SECRET', 'PROOF-test-0123456789-0123456789-abcdefgh' );
define( 'AICC_ENTITLEMENT_WEBHOOK_SECRET', 'WEBHOOK-test-0123456789-0123456789-abcdef' );
// OWNER FACTS (non-secret): rendered ONLY from the root-only host file /etc/aicc/owner-facts.env by render-wp-config.sh, which validates every value and escapes it as a PHP literal; when the file is absent or empty this whole
// region (including these lines) is removed and the rendered configuration is exactly what it was before the region existed. Possible keys: AICC_ACTIVATION_PROOF_KID (must equal the Backend's ACTIVATION_PROOF_KID_CURRENT), AICC_LEGAL_ENTITY_NAME,
// _ENTITY_ADDRESS, _SUPPORT_EMAIL, _GOVERNING_LAW, _JURISDICTION, _PAYMENT_PROCESSOR, _VAT_DETAILS, AICC_LEGAL_REVIEW_APPROVED, AICC_LEGAL_SUBPROCESSORS_VERIFIED, AICC_STRUCTURED_DATA_OFFERS, AICC_COMMERCE_OPEN (the ONE fail-closed switch for "commercial checkout is open": only the value true is accepted, unset = closed, refused unless every launch fact is present; see docs/cutover/pre-commercial.md), AICC_LM_PAID_GATEWAYS (the runtime payment
// gate: exact gateway ids), AICC_LAUNCH_REAL_GATEWAYS (the launch gate), AICC_LM_PLUGIN_SIGNING_PUBKEYS (PUBLIC Ed25519 update-signing keys, primary + standby: the Control Plane re-verifies each Plugin release when serving it). An owner-set extra outbound host for a payment gateway is appended to WP_ACCESSIBLE_HOSTS above by the renderer, never here. Nothing in this region is a secret.
define( 'AICC_LEGAL_SUPPORT_EMAIL', 'support@copilt.org' );
define( 'AICC_LEGAL_REVIEW_APPROVED', true );
// ---- P37 self-service (Trial signup, notifications, owner dashboard): rendered by render-wp-config.sh from the owner facts + ONE root-placed secret file; EVERY constant below is ABSENT unless its owner fact is set (absent = OFF) ----------
// This whole region (including these lines) is removed when no P37 fact is set and no Turnstile secret file exists, so the default render is byte-for-byte the render before P37. Procedure, order and refusal rules:
// docs/cutover/p37-self-service-wp-config.md. The renderer REFUSES (writes nothing) an inconsistent set: self-service ON without a cap of 25/50/100, the Turnstile site key + secret file, the Turnstile outbound host, mail enabled or the notification switch;
// the notification switch or mail caps without mail; origins without the funnel switch. NO SECRET is ever rendered here: the Turnstile SECRET and the SMTP credentials are FILES (AICC_TURNSTILE_SECRET_FILE, AICC_MAIL_SECRETS_FILE), only public values are facts.
// Never defined by this renderer on purpose: AICC_TRIAL_TURNSTILE (production always requires Turnstile), AICC_NOTIFY_ALLOW_TEST_ACCOUNT_DELIVERY (a one-user test escape hatch), AICC_OWNER_DASHBOARD_USER_IDS (a separate reviewed change).
// Switches the Control Plane reads as "exactly boolean true" (the string "true", 1 and "yes" do NOT count): AICC_TRIAL_SELF_SERVICE_ENABLED, AICC_NOTIFY_ENABLED, AICC_FUNNEL_COUNTERS_ENABLED, AICC_OWNER_OPS_SECTION_ENABLED,
// AICC_MILESTONE_SYNC_SCHEDULED, AICC_PLAN_CHANGE_ENABLED, AICC_PAY_RECONCILE_ENABLED, AICC_PRIVACY_REQUESTS_ENABLED. AICC_TRIAL_SELF_SERVICE_CAP and the mail caps are INTEGERS (a string reads as 0).
define( 'AICC_TURNSTILE_SITE_KEY', '0x4AAAAAAApubLICsitekey01' );
define( 'AICC_NOTIFY_ENABLED', true );
define( 'AICC_OWNER_OPS_SECTION_ENABLED', true );
define( 'AICC_MILESTONE_SYNC_SCHEDULED', true );
define( 'AICC_TURNSTILE_SECRET_FILE', '/etc/aicc-mail/turnstile.secret' );
// ---- end P37 self-service ----
// AICC_LM_ALLOW_DEV_SECRET_BOOTSTRAP and AICC_LM_TEST_FIXTURE are intentionally NOT defined.

// ---- Owner Dashboard (P35 gate B2, 2026-11-13): the Backend token is read server-side from this root-owned file (never sent to a browser), the Backend base is fixed, only the listed administrator may open the page ----
define( 'AICC_OWNER_METRICS_TOKEN_FILE', '/srv/aicc/shared/owner-metrics.token' );
define( 'AICC_OWNER_METRICS_BASE', 'https://api.copilt.org' );
define( 'AICC_OWNER_DASHBOARD_USER_IDS', '1' );

// ---- Launch offer, ANNOUNCE mode only (2026-11-13 owner batch authorization): no request intake, no strike-through, no limited chip ----
define( 'AICC_EA_LAUNCH_OFFER_MODE', 'announce' );

// ---- Owner Dashboard ops snapshot (backup + recovery-gate state, produced on the owner Mac; 2026-11-13): optional, a stale or missing file reads "Not reported" ----
define( 'AICC_OWNER_OPS_SNAPSHOT_FILE', '/srv/aicc/shared/owner-ops-snapshot.json' );

// ---- bootstrap -----------------------------------------------------------------------------------------------------------------------------------------
// ABSPATH is defined by wp-load.php (the real release directory) BEFORE this file is read, even though this file is reached through a symlink.
// Using __DIR__ here would resolve to /srv/aicc/shared and break every path, so refuse instead of guessing.
if ( ! defined( 'ABSPATH' ) ) {
	http_response_code( 500 );
	exit( 'wp-config.php must be loaded by WordPress (wp-load.php defines ABSPATH).' );
}
require_once ABSPATH . 'wp-settings.php';
