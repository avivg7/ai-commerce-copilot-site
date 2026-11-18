<?php
/**
 * Runs the Plugin's REAL update-offer logic (includes/class-aicc-updater.php: validate_offer + verify_offer, and includes/class-aicc-release-signature.php) on one update-check answer, outside WordPress.
 *   php updater_offer_check.php <plugin dir> <installed version> <b64[,b64] public keys the build bakes>  < offer.json
 * Prints ONE JSON line: {"validate": true|false, "verify": ""|<reason>}. validate=false is "the store would not even consider this offer" (not newer than the installed version, malformed);
 * verify "" is "the signature verifies against the baked keys". Only WordPress's time constants and wp_strip_all_tags are shimmed; the checked code is the shipped code.
 */
if ( 'cli' !== PHP_SAPI ) {
	exit( 1 );
}
define( 'ABSPATH', '/nonexistent/' );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'DAY_IN_SECONDS', 86400 );
function wp_strip_all_tags( $s ) {
	return strip_tags( (string) $s );
}
$dir = $argv[1] ?? '';
if ( ! is_file( $dir . '/includes/class-aicc-updater.php' ) || ! is_file( $dir . '/includes/class-aicc-release-signature.php' ) ) {
	fwrite( STDERR, "plugin dir lacks the updater or signature class\n" );
	exit( 2 );
}
require $dir . '/includes/class-aicc-release-signature.php';
require $dir . '/includes/class-aicc-updater.php';
$data  = json_decode( (string) stream_get_contents( STDIN ), true );
$offer = AICC_Updater::validate_offer( $data, (string) ( $argv[2] ?? '0.0.0' ) );
$out   = array( 'validate' => is_array( $offer ), 'verify' => null );
if ( is_array( $offer ) ) {
	$out['verify'] = AICC_Updater::verify_offer( $offer, AICC_Release_Signature::parse_keys( (string) ( $argv[3] ?? '' ) ) );
}
echo json_encode( $out ) . "\n";
