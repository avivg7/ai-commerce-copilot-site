<?php
/**
 * AICC Control Plane PRODUCTION wp-config.php TEMPLATE -- *** NOT USABLE. DO NOT RENDER. DO NOT COPY. ***
 *
 * AICC_TEMPLATE_STATUS: NOT-USABLE
 *
 * WHY THIS FILE EXISTS (architecture review B-3, 2026-10-21): there was no production configuration path at all, so nothing recorded that the Control Plane -> Backend
 * entitlement webhook needs a production-specific setting. The staging wp-config blocks every outbound request except its own host (WP_HTTP_BLOCK_EXTERNAL true,
 * WP_ACCESSIBLE_HOSTS "stage.copilt.org,localhost,127.0.0.1") and never sets AICC_ENTITLEMENT_WEBHOOK_URL, whose default is the docker-compose name
 * http://backend:8000/v1/internal/entitlement/webhook. Copying the staging settings to production would silently block every paid-licence entitlement delivery (the outbox
 * retries for ever). This template records the two settings production MUST have, so that the production path is not forgotten:
 *
 *   * AICC_ENTITLEMENT_WEBHOOK_URL = https://api.copilt.org/v1/internal/entitlement/webhook   (https, the API host only)
 *   * WP_HTTP_BLOCK_EXTERNAL true and WP_ACCESSIBLE_HOSTS = exactly "api.copilt.org"   (plus nothing else: no updates, no telemetry, no staging names)
 *
 * The Control Plane launch gate (scripts/check-launch-blockers.php in the Control Plane repository, enforced with AICC_PRODUCTION=1) refuses a configuration whose effective
 * webhook URL is not an https URL on the API host or whose outbound allow-list does not contain it.
 *
 * WHAT THIS FILE IS NOT: it is not wired into render-wp-config.sh, deploy-release.sh, install-stack.sh or any other script. render-wp-config.sh REFUSES it by name and by the
 * marker above (infra:lint and test_provision.sh check that refusal), and the PHP guard directly below stops any copy of this file from running as a wp-config. Producing a
 * production wp-config is a separate piece of work (production provisioning, secrets, database, DNS, the decision "new Droplet or convert staging") that is deliberately NOT
 * done here. When that work starts, replace the guard and the marker deliberately, in a reviewed change, and add the production host to the provisioning tests.
 *
 * Every value below that is not a webhook/outbound setting is a PLACEHOLDER to be decided with the production provisioning, not a decision.
 */

// GUARD: a copy of this file used as a real wp-config.php must not run.
http_response_code( 500 );
throw new RuntimeException( 'wp-config.production.template.php is a TEMPLATE and is not usable (AICC_TEMPLATE_STATUS: NOT-USABLE).' );

// ---- the settings production must carry (not reached while the guard above exists) -------------------------------------------------------------------------------------------------
define( 'WP_ENVIRONMENT_TYPE', 'production' );
define( 'WP_HOME', 'https://www.copilt.org' );
define( 'WP_SITEURL', 'https://www.copilt.org' );

// CP -> Backend: deliver entitlements to the production API over https, and let WordPress reach exactly that host.
define( 'AICC_ENTITLEMENT_WEBHOOK_URL', 'https://api.copilt.org/v1/internal/entitlement/webhook' );
define( 'WP_HTTP_BLOCK_EXTERNAL', true );
define( 'WP_ACCESSIBLE_HOSTS', 'api.copilt.org' );

// Secrets are generated on the production host by the (not yet written) production provisioning; never committed.
define( 'AICC_ACTIVATION_PROOF_SECRET', '@@PRODUCTION_TEMPLATE_NOT_USABLE@@' );
define( 'AICC_ENTITLEMENT_WEBHOOK_SECRET', '@@PRODUCTION_TEMPLATE_NOT_USABLE@@' );

// Keep from the staging template (review them again for production): DISALLOW_FILE_MODS, DISALLOW_FILE_EDIT, AUTOMATIC_UPDATER_DISABLED, DISABLE_WP_CRON + aicc-wp-cron.timer,
// WP_DEBUG off, empty AICC_LM_TRUSTED_PROXIES, AICC_LM_OPERATOR_CIDRS loopback only, FORCE_SSL_ADMIN. Never define AICC_LM_ALLOW_DEV_SECRET_BOOTSTRAP or AICC_LM_TEST_FIXTURE.
