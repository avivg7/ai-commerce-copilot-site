<?php
/**
 * AICC Control Plane STAGING wp-config.php TEMPLATE.
 *
 * THIS FILE CONTAINS NO SECRETS. Upper-case tokens wrapped in double at-signs (for example DB_PASSWORD) are replaced ON THE HOST by infra/provision/render-wp-config.sh from files in the host's
 * /etc/aicc/secrets (mode 0600, root) and the result is written to /srv/aicc/shared/wp-config.php (0640 root:aicc-cp). Every release contains a
 * symlink wp-config.php -> /srv/aicc/shared/wp-config.php, so a release can be replaced or rolled back without touching configuration or secrets.
 * Nothing rendered from this file is ever committed or copied off the host except inside the 0600 files archive of the backup (infra/backup).
 *
 * The production template (wp-config.production.template.php) must differ from this file only in the environment-specific constants; test_provision.sh pins that set, so a change here needs the same change there.
 */

// ---- database: UNIX SOCKET only (MySQL runs with skip-networking) --------------------------------------------------------------------------
define( 'DB_NAME', '@@DB_NAME@@' );
define( 'DB_USER', '@@DB_USER@@' );
define( 'DB_PASSWORD', '@@DB_PASSWORD@@' );
define( 'DB_HOST', 'localhost:/run/mysqld/mysqld.sock' );
define( 'DB_CHARSET', 'utf8mb4' );
define( 'DB_COLLATE', '' );
$table_prefix = 'wp_';

// ---- keys and salts (generated once on the host; re-rendering keeps them so logged-in sessions survive a re-render) ---------------------------
@@SALTS@@

// ---- identity and URLs -------------------------------------------------------------------------------------------------------------------------
define( 'WP_ENVIRONMENT_TYPE', 'staging' );
define( 'WP_HOME', 'https://stage.copilt.org' );
define( 'WP_SITEURL', 'https://stage.copilt.org' );
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

// STAGING MUST NOT TALK TO ANYTHING ELSE: block every outbound HTTP request from WordPress/WooCommerce/plugins except this host's own loopback
// (WP-Cron spawns, Action Scheduler loopbacks, site health). This keeps the staging Control Plane from calling the production Backend
// (api.copilt.org), wordpress.org/woocommerce.com update and telemetry endpoints, or any real customer system. Lesson from the macOS rehearsal:
// a fixture whose home URL was the public name sent loopback requests to the real public site.
// The edge serves the static /product/ page (the theme otherwise falls back to /#why when it is not behind the edge): keeps the header 'Product' link identical to the site's.
define( 'AICC_PRODUCT_PAGE_ON_EDGE', true );
define( 'WP_HTTP_BLOCK_EXTERNAL', true );
// Security review M1: NO localhost / 127.0.0.1 here. They turned any wp_remote_get() SSRF primitive in WordPress/WooCommerce/a plugin into a request to Caddy's unauthenticated
// admin API (127.0.0.1:12019), the operator listener and AICC Ops. WordPress always lets a request to its OWN site host through, so the list names only that host; nothing in the
// Control Plane makes any other outbound call on staging (the only wp_remote_* in plugin and theme is the entitlement webhook, which staging must not deliver). The cgroup network lock in
// infra/systemd/overrides/php8.3-fpm.service.d/aicc.conf (IPAddressDeny=127.0.0.0/8 ...) closes the same door for raw PHP sockets.
define( 'WP_ACCESSIBLE_HOSTS', 'stage.copilt.org' );

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

// ---- mail: NOTHING LEAVES THIS HOST ----------------------------------------------------------------------------------------------------------------
// PHP's mail() (WordPress' default transport) is routed by the FPM pool and the CLI ini to /usr/local/sbin/aicc-mail-sink, which writes each message
// to /var/lib/aicc-cp/mail/*.eml (mode 0600, newest 200 kept) and sends nothing. Do not install an SMTP plugin on staging.

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
// CP -> Backend entitlement webhook: AICC_ENTITLEMENT_WEBHOOK_URL is deliberately NOT defined on staging. The plugin then falls back to its docker-compose default
// (http://backend:8000/...), which the WP_HTTP_BLOCK_EXTERNAL allow-list above blocks: staging never delivers to a real Backend. PRODUCTION MUST differ: an https URL on
// api.copilt.org and WP_ACCESSIBLE_HOSTS = exactly api.copilt.org (see wp-config.production.template.php, rendered only by `render-wp-config.sh --env production --confirm-production` on a production host; the Control Plane launch gate fails otherwise).
// Staging-only random secrets generated on the host (they are NOT the production values and unlock nothing elsewhere).
define( 'AICC_ACTIVATION_PROOF_SECRET', '@@AICC_ACTIVATION_PROOF_SECRET@@' );
define( 'AICC_ENTITLEMENT_WEBHOOK_SECRET', '@@AICC_ENTITLEMENT_WEBHOOK_SECRET@@' );
// @@OWNER_FACTS_BEGIN@@
// OWNER FACTS (non-secret): rendered ONLY from the root-only host file /etc/aicc/owner-facts.env by render-wp-config.sh (validated, escaped); absent or empty = this whole region is removed. Staging may carry only
// AICC_ACTIVATION_PROOF_KID, AICC_LM_PAID_GATEWAYS and AICC_LM_PAYMENT_GATE_STRICT (a payment SANDBOX rehearsal runs the production rules); an owner-set extra outbound host is appended to WP_ACCESSIBLE_HOSTS above by the renderer.
@@OWNER_FACTS@@
// @@OWNER_FACTS_END@@
// AICC_LM_ALLOW_DEV_SECRET_BOOTSTRAP and AICC_LM_TEST_FIXTURE are intentionally NOT defined.

// ---- bootstrap -----------------------------------------------------------------------------------------------------------------------------------------
// ABSPATH is defined by wp-load.php (the real release directory) BEFORE this file is read, even though this file is reached through a symlink.
// Using __DIR__ here would resolve to /srv/aicc/shared and break every path, so refuse instead of guessing.
if ( ! defined( 'ABSPATH' ) ) {
	http_response_code( 500 );
	exit( 'wp-config.php must be loaded by WordPress (wp-load.php defines ABSPATH).' );
}
require_once ABSPATH . 'wp-settings.php';
