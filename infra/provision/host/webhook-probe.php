<?php
/**
 * webhook-probe.php: run through `aicc-wp eval-file` (as the PHP user aicc-cp) by `aicc-rotate-webhook-secret probe-new`.
 *
 * It answers ONE question without touching any data: does the Backend accept a signature made with the AICC_ENTITLEMENT_WEBHOOK_SECRET that THIS PHP process holds (the RUNNING constant)?
 * It signs a deliberately MALFORMED body (valid JSON without the required fields) with AICC_LM_Entitlement_Dispatcher::sign(), exactly as every outbox event is signed, and POSTs it with
 * wp_safe_remote_post(). The Backend verifies the signature BEFORE it parses the payload, so: 400 webhook_payload_malformed = the signature is right; 401 webhook_signature_invalid = it is wrong.
 * The probe never reaches the database. The secret is used in memory only: this script prints ONLY three lines (constant_fp, status, error), never the secret, the signature or the response body.
 *
 * Argument 1 (optional, tests only): the Backend base URL. The default is https://api.copilt.org (the only host WP_ACCESSIBLE_HOSTS allows).
 */
if ( ! defined( 'ABSPATH' ) ) {
	fwrite( STDERR, "run this through wp eval-file\n" );
	exit( 1 );
}
$aicc_probe_base = ( isset( $args[0] ) && is_string( $args[0] ) && '' !== $args[0] ) ? rtrim( $args[0], '/' ) : 'https://api.copilt.org';
if ( ! defined( 'AICC_ENTITLEMENT_WEBHOOK_SECRET' ) || ! is_string( AICC_ENTITLEMENT_WEBHOOK_SECRET ) || '' === AICC_ENTITLEMENT_WEBHOOK_SECRET ) {
	echo "constant_fp=none\nstatus=none\nerror=constant_not_defined\n";
	exit( 1 );
}
if ( ! class_exists( 'AICC_LM_Entitlement_Dispatcher' ) || ! method_exists( 'AICC_LM_Entitlement_Dispatcher', 'sign' ) ) {
	echo "constant_fp=none\nstatus=none\nerror=dispatcher_not_loaded\n";
	exit( 1 );
}
$aicc_probe_secret = AICC_ENTITLEMENT_WEBHOOK_SECRET;
// the same fingerprint the host tools print: the first 16 hex of SHA-256( tag + secret )
echo 'constant_fp=' . substr( hash( 'sha256', "aicc-webhook-secret-fingerprint-v1\n" . $aicc_probe_secret ), 0, 16 ) . "\n";
$aicc_probe_body = '{"probe":"aicc-webhook-rotation"}';
$aicc_probe_ts   = time();
$aicc_probe_sig  = AICC_LM_Entitlement_Dispatcher::sign( $aicc_probe_body, $aicc_probe_ts, $aicc_probe_secret );
$aicc_probe_resp = wp_safe_remote_post(
	$aicc_probe_base . '/v1/internal/entitlement/webhook',
	array(
		'timeout'     => 20,
		'redirection' => 0,
		'headers'     => array(
			'Content-Type'              => 'application/json',
			'X-AICC-Webhook-Timestamp'  => (string) $aicc_probe_ts,
			'X-AICC-Webhook-Signature'  => $aicc_probe_sig,
		),
		'body'        => $aicc_probe_body,
	)
);
if ( is_wp_error( $aicc_probe_resp ) ) {
	echo "status=none\nerror=transport_error\n";
	exit( 1 );
}
$aicc_probe_code = (int) wp_remote_retrieve_response_code( $aicc_probe_resp );
$aicc_probe_json = json_decode( (string) wp_remote_retrieve_body( $aicc_probe_resp ), true );
$aicc_probe_err  = 'none';
if ( is_array( $aicc_probe_json ) ) {
	$aicc_probe_d = isset( $aicc_probe_json['detail'] ) ? $aicc_probe_json['detail'] : $aicc_probe_json;
	if ( is_array( $aicc_probe_d ) && isset( $aicc_probe_d['error'] ) && is_string( $aicc_probe_d['error'] ) ) {
		$aicc_probe_err = $aicc_probe_d['error'];
	}
}
// only a plain error code is ever printed (letters and underscores): anything else is reduced to a fixed word
if ( ! preg_match( '/^[a-z_]{1,64}$/', $aicc_probe_err ) ) {
	$aicc_probe_err = 'unrecognised';
}
echo 'status=' . $aicc_probe_code . "\n";
echo 'error=' . $aicc_probe_err . "\n";
// the verdict is the host tool's: this script exits 0 whenever it printed a status
exit( 0 );
