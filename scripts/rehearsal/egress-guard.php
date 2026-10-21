<?php
/**
 * REHEARSAL FIXTURE EGRESS GUARD (fail closed). Loaded as auto_prepend_file by cp-fixture.sh (php -S and wp-cli) and fpm.sh (php-fpm); lives in the SITE repo, outside the fixture docroot.
 *
 * Why: WordPress sends outbound HTTP requests on its own. Measured on 2026-10-21 (the macOS sandbox log showed `php ... deny(1) network-outbound remote:*:443`): the fixture's PHP
 * (a) posts Action Scheduler's async runner to admin_url('admin-ajax.php') = https://www.copilt.org/wp-admin/admin-ajax.php, a REAL public host (GitHub Pages today), whenever a request in wp-admin
 * / admin-ajax.php finds pending actions, and (b) may contact wordpress.org / WooCommerce.com for update and marketplace checks. Earlier rehearsal runs therefore sent real requests to the public
 * site from the fixture (not from the test runners). This file closes that:
 *   1. WordPress HTTP API: every request whose host is not www.copilt.org / copilt.org (default ports only) or loopback is answered with a WP_Error BEFORE any DNS lookup or connection and logged;
 *   2. the two copilt.org names are forced to 127.0.0.1 (CURLOPT_RESOLVE) so that the fixture's loopback requests reach the rehearsal EDGE, never the public site.
 * The hooks are registered through WordPress's pre-initialised hook arrays ($wp_filter before wp-settings.php), so no fixture file is changed. cp-fixture.sh / fpm.sh additionally start PHP under
 * scripts/rehearsal/loopback-only.sb on macOS (the kernel denies any non-loopback connect).
 */
if ( defined( 'AICC_EGRESS_GUARD_LOADED' ) ) { return; } // php -S runs auto_prepend_file for scripts it executes itself AND fixture-router.php includes this file: load once
define( 'AICC_EGRESS_GUARD_LOADED', true );

// the rehearsal home: AICC_REHEARSAL_HOME, else ~/aicc-rehearsal (the environment is cleared under php-fpm, so the home directory comes from the passwd entry)
$aicc_home = getenv( 'AICC_REHEARSAL_HOME' );
if ( ! $aicc_home ) {
	$aicc_pw   = function_exists( 'posix_getpwuid' ) ? posix_getpwuid( posix_getuid() ) : false;
	$aicc_home = ( $aicc_pw && ! empty( $aicc_pw['dir'] ) ? $aicc_pw['dir'] : getenv( 'HOME' ) ) . '/aicc-rehearsal';
}
$GLOBALS['aicc_egress_log'] = $aicc_home . '/logs/cp-egress-blocked.log';
$aicc_fixture_prepend       = $aicc_home . '/cp/prepend.php';
if ( is_file( $aicc_fixture_prepend ) ) { require_once $aicc_fixture_prepend; } // the fixture's owner marker (X-Rehearsal-Upstream) and upstream log
unset( $aicc_home, $aicc_pw, $aicc_fixture_prepend );

if ( PHP_SAPI !== 'cli' && ! headers_sent() ) { header( 'X-Rehearsal-Egress-Guard: on' ); } // visible proof, through the edge, that the serving PHP process runs this guard

if ( ! isset( $GLOBALS['aicc_egress_guard'] ) ) {
	$GLOBALS['aicc_egress_guard'] = true;
	$GLOBALS['wp_filter']['pre_http_request'][1][] = array( 'function' => 'aicc_egress_pre_http_request', 'accepted_args' => 3 );
	$GLOBALS['wp_filter']['http_api_curl'][1][]    = array( 'function' => 'aicc_egress_curl', 'accepted_args' => 1 );
}

// functions are declared inside this block: PHP compiles unconditional functions of an included file at compile time, so a second include (auto_prepend_file AND fixture-router.php under php -S) would otherwise fatal
if ( ! function_exists( 'aicc_egress_allowed' ) ) {
	function aicc_egress_allowed( $url ) {
		$p    = parse_url( (string) $url );
		$host = strtolower( isset( $p['host'] ) ? trim( $p['host'], '[]' ) : '' );
		$port = isset( $p['port'] ) ? (int) $p['port'] : null;
		if ( in_array( $host, array( 'www.copilt.org', 'copilt.org' ), true ) ) {
			return null === $port || 80 === $port || 443 === $port; // mapped to 127.0.0.1 by aicc_egress_curl: only the standing edge's ports
		}
		if ( in_array( $host, array( 'localhost', '127.0.0.1', '::1' ), true ) ) {
			return null === $port || ! ( ( $port >= 8981 && $port <= 8983 ) || ( $port >= 9111 && $port <= 9114 ) || 8982 === $port || 8000 === $port ); // never the QA / owner fixtures
		}
		return false;
	}

	function aicc_egress_pre_http_request( $preempt, $args, $url ) {
		if ( false !== $preempt || aicc_egress_allowed( $url ) ) {
			return $preempt;
		}
		$log = isset( $GLOBALS['aicc_egress_log'] ) ? $GLOBALS['aicc_egress_log'] : '';
		if ( $log ) {
			$p = parse_url( (string) $url );
			@file_put_contents( $log, json_encode( array( 't' => gmdate( 'c' ), 'sapi' => PHP_SAPI, 'host' => isset( $p['host'] ) ? $p['host'] : '', 'port' => isset( $p['port'] ) ? $p['port'] : null, 'path' => isset( $p['path'] ) ? $p['path'] : '', 'method' => isset( $args['method'] ) ? $args['method'] : 'GET' ) ) . "\n", FILE_APPEND | LOCK_EX );
		}
		return new WP_Error( 'aicc_egress_blocked', 'Rehearsal fixture: outbound HTTP to this host is blocked (fail closed). Only www.copilt.org / copilt.org (-> 127.0.0.1) and loopback are reachable.' );
	}

	function aicc_egress_curl( $handle ) {
		if ( function_exists( 'curl_setopt' ) && defined( 'CURLOPT_RESOLVE' ) ) {
			curl_setopt( $handle, CURLOPT_RESOLVE, array( 'www.copilt.org:443:127.0.0.1', 'copilt.org:443:127.0.0.1', 'www.copilt.org:80:127.0.0.1', 'copilt.org:80:127.0.0.1' ) );
		}
	}

}
