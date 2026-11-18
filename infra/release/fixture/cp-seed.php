<?php
/**
 * FIXTURE ONLY (infra/release/fixture/verify-published-fixture.sh): seeds a DISPOSABLE Control Plane fixture with synthetic customers for verify-published-plugin.sh. Refuses to run anywhere that
 * does not declare itself a disposable fixture. Environment (never argv): AICC_FX_CP (Control Plane worktree), AICC_FX_OUT (JSON result file), AICC_FX_PASS_A/B/C (passwords of the three customers),
 * AICC_FX_ORIGIN_A / AICC_FX_ORIGIN_B (the two stores' origins).
 *   A  an ACTIVE studio plan, one store bound (ORIGIN_A)           -> the customer under test
 *   B  another tenant: an ACTIVE solo plan, one store bound (ORIGIN_B) -> wrong-tenant probes
 *   C  a REVOKED plan (what a refund does)                         -> must not be able to download
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit( 1 );
}
if ( ! defined( 'AICC_LM_TEST_FIXTURE' ) || true !== AICC_LM_TEST_FIXTURE ) {
	fwrite( STDERR, "refusing: this install is not a declared disposable Control Plane fixture\n" );
	exit( 1 );
}
$cp = (string) getenv( 'AICC_FX_CP' );
if ( ! is_file( $cp . '/tests/lib/helpers.php' ) ) {
	fwrite( STDERR, "AICC_FX_CP must be a Control Plane worktree\n" );
	exit( 1 );
}
require_once $cp . '/tests/lib/helpers.php';

function fx_user( $label, $pass_env ) {
	$uid  = aicc_t_customer( $label );
	$pass = (string) getenv( $pass_env );
	if ( strlen( $pass ) < 16 ) {
		fwrite( STDERR, "$pass_env must be set (16+ characters)\n" );
		exit( 1 );
	}
	wp_set_password( $pass, $uid );
	return array( $uid, get_userdata( $uid )->user_login );
}
function fx_plan( $uid, $plan, $limit, $origin ) {
	$lic = aicc_t_issue( $uid, $plan, $limit );
	$act = AICC_LM_Activation::activate( AICC_LM_License::find_by_ref( $lic['license']->license_ref ), $origin );
	if ( is_wp_error( $act ) ) {
		fwrite( STDERR, 'activation failed: ' . $act->get_error_message() . "\n" );
		exit( 1 );
	}
	return array( $lic['license']->license_ref, $act->activation_ref );
}
list( $ua, $la ) = fx_user( 'fx_a', 'AICC_FX_PASS_A' );
list( $ub, $lb ) = fx_user( 'fx_b', 'AICC_FX_PASS_B' );
list( $uc, $lc ) = fx_user( 'fx_c', 'AICC_FX_PASS_C' );
list( $lica, $acta ) = fx_plan( $ua, 'studio', 3, (string) getenv( 'AICC_FX_ORIGIN_A' ) );
list( $licb, $actb ) = fx_plan( $ub, 'solo', 1, (string) getenv( 'AICC_FX_ORIGIN_B' ) );
$licc = aicc_t_issue( $uc, 'solo', 1 );
AICC_LM_License::transition( $licc['license']->license_ref, 'revoked', 'system', null, 'fixture' );
file_put_contents( (string) getenv( 'AICC_FX_OUT' ), wp_json_encode( array( 'login_a' => $la, 'login_b' => $lb, 'login_c' => $lc, 'act_a' => $acta, 'act_b' => $actb ) ) . "\n" );
echo "seeded\n";
