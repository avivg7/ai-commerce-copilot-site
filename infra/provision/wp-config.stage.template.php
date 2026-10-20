<?php
/**
 * AICC Control Plane STAGING wp-config.php TEMPLATE.
 *
 * THIS FILE CONTAINS NO SECRETS. Upper-case tokens wrapped in double at-signs (for example DB_PASSWORD) are replaced ON THE HOST by infra/provision/render-wp-config.sh from files in the host's
 * /etc/aicc/secrets (mode 0600, root) and the result is written to /srv/aicc/shared/wp-config.php (0640 root:aicc-cp). Every release contains a
 * symlink wp-config.php -> /srv/aicc/shared/wp-config.php, so a release can be replaced or rolled back without touching configuration or secrets.
 * Nothing rendered from this file is ever committed or copied off the host except inside the 0600 files archive of the backup (infra/backup).
 *
 * Production later uses the same file with another host name; do not add staging shortcuts here that a production build could inherit.
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
// aicc-wp-cron.timer runs `wp cron event run --due-now` every minute; /wp-cron.php is operator-only at the edge.
define( 'DISABLE_WP_CRON', true );

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
define( 'AICC_LM_TRUSTED_PROXIES', array() );
// Operators exempt from the login throttle: loopback only (the SSH tunnel). Nobody on the public internet is exempt.
define( 'AICC_LM_OPERATOR_CIDRS', array( '127.0.0.1/32', '::1/128' ) );
// Staging-only random secrets generated on the host (they are NOT the production values and unlock nothing elsewhere).
define( 'AICC_ACTIVATION_PROOF_SECRET', '@@AICC_ACTIVATION_PROOF_SECRET@@' );
define( 'AICC_ENTITLEMENT_WEBHOOK_SECRET', '@@AICC_ENTITLEMENT_WEBHOOK_SECRET@@' );
// AICC_LM_ALLOW_DEV_SECRET_BOOTSTRAP and AICC_LM_TEST_FIXTURE are intentionally NOT defined.

// ---- bootstrap -----------------------------------------------------------------------------------------------------------------------------------------
// ABSPATH is defined by wp-load.php (the real release directory) BEFORE this file is read, even though this file is reached through a symlink.
// Using __DIR__ here would resolve to /srv/aicc/shared and break every path, so refuse instead of guessing.
if ( ! defined( 'ABSPATH' ) ) {
	http_response_code( 500 );
	exit( 'wp-config.php must be loaded by WordPress (wp-load.php defines ABSPATH).' );
}
require_once ABSPATH . 'wp-settings.php';
