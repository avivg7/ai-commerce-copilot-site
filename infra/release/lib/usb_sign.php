<?php
/**
 * PHP half of the P45 passwordless USB signing tools. CLI only. Needs ext-sodium (and ext-zip for `sign`).
 *
 *   php usb_sign.php derive    --key-file P                    re-derive the public key from the seed of the 64-byte secret key at P (libsodium, a fresh computation, not the stored half);
 *                                                              prints `pub=<b64>`, `fp=<xxxx-xxxx-xxxx-xxxx>`; exit 1 when the file is not a valid key or its stored public half differs from the re-derived one.
 *   php usb_sign.php sign      --key-file P --plugin-dir D --manifest M --zip Z --sig-out OUT --expect-pub B64 [--issued-at T]
 *                                                              the same checks and the same signed bytes as the Plugin's `bin/sign-release.php sign`, EXCEPT that the key file's permission bits are NOT
 *                                                              tested here (the calling script does that where the filesystem enforces permissions; a FAT32 stick has none). The signature is written
 *                                                              with fopen mode 'x' (never overwrites). The secret is read in this process and zeroed; it is never printed, copied or put in a file.
 *   php usb_sign.php wrong-key-sig --plugin-dir D --manifest M --out OUT
 *                                                              signs the manifest with a THROWAWAY in-memory key (never written anywhere): the negative control.
 *
 *   php usb_sign.php smoke     --key-file P                    signs a random disposable message with the key and verifies it with the freshly derived public key (and checks a one-byte-changed message does NOT verify).
 *
 * Why a re-implementation: the Plugin tool insists on mode 0600 and the owner on the file (rightly, on a POSIX filesystem). A FAT32 stick cannot satisfy that, and copying the secret to a POSIX
 * location only to satisfy a mode check would put the key on a second medium. The signed message is built by the Plugin's own AICC_Release_Signature::message(); the test suite proves the output is
 * byte-identical to the Plugin tool's for the same key and --issued-at, and the calling script verifies every signature with the Plugin tool afterwards.
 */
if ( 'cli' !== PHP_SAPI ) {
	exit( 1 );
}
ini_set( 'display_errors', 'stderr' );
function uds_die( $m, $c = 1 ) {
	fwrite( STDERR, 'usb_sign: ' . $m . "\n" );
	exit( $c );
}
if ( ! function_exists( 'sodium_crypto_sign_detached' ) ) {
	uds_die( 'ext-sodium is required' );
}
function uds_args( array $argv ) {
	$o = array();
	for ( $i = 2; $i < count( $argv ); $i += 2 ) {
		if ( 0 !== strpos( $argv[ $i ], '--' ) || ! isset( $argv[ $i + 1 ] ) ) {
			uds_die( 'bad argument: ' . $argv[ $i ], 2 );
		}
		$o[ substr( $argv[ $i ], 2 ) ] = $argv[ $i + 1 ];
	}
	return $o;
}
function uds_fp( $raw ) {
	return implode( '-', str_split( substr( hash( 'sha256', $raw ), 0, 16 ), 4 ) );
}
/** The 64-byte secret key from the file (regular file, not a symlink); verifies that the stored public half equals a fresh derivation from the seed. Returns array( secret, public ). */
function uds_load( $path ) {
	if ( '' === $path || is_link( $path ) || ! is_file( $path ) ) {
		uds_die( 'the key file does not exist, is a symlink, or is not a regular file' );
	}
	if ( filesize( $path ) > 512 ) {
		uds_die( 'the key file is too large to be a key' );
	}
	$raw = base64_decode( trim( (string) file_get_contents( $path ) ), true );
	if ( false === $raw || SODIUM_CRYPTO_SIGN_SECRETKEYBYTES !== strlen( $raw ) ) {
		uds_die( 'the key file is not a base64 Ed25519 secret key' );
	}
	$kp  = sodium_crypto_sign_seed_keypair( substr( $raw, 0, SODIUM_CRYPTO_SIGN_SEEDBYTES ) );
	$pub = sodium_crypto_sign_publickey( $kp );
	sodium_memzero( $kp );
	if ( ! hash_equals( $pub, substr( $raw, SODIUM_CRYPTO_SIGN_SEEDBYTES ) ) ) {
		uds_die( 'the key file is corrupt: its stored public half is not the one derived from its seed' );
	}
	return array( $raw, $pub );
}
function uds_fields( array $m, $issued_at ) {
	return array(
		'slug'         => $m['slug'] ?? '',
		'version'      => $m['version'] ?? '',
		'sha256'       => is_string( $m['sha256'] ?? null ) ? strtolower( $m['sha256'] ) : '',
		'size'         => $m['size'] ?? null,
		'requires_wp'  => $m['requires_wp'] ?? '',
		'requires_php' => $m['requires_php'] ?? '',
		'requires_wc'  => $m['requires_wc'] ?? '',
		'issued_at'    => $issued_at,
	);
}
function uds_manifest( $file ) {
	if ( ! is_file( $file ) || filesize( $file ) > 65536 ) {
		uds_die( 'cannot read the manifest: ' . $file );
	}
	$m = json_decode( (string) file_get_contents( $file ), true );
	if ( ! is_array( $m ) ) {
		uds_die( 'the manifest is not valid JSON' );
	}
	return $m;
}
function uds_class( $plug ) {
	if ( ! defined( 'ABSPATH' ) ) {
		define( 'ABSPATH', rtrim( $plug, '/' ) . '/' );
	}
	$f = rtrim( $plug, '/' ) . '/includes/class-aicc-release-signature.php';
	if ( ! is_file( $f ) ) {
		uds_die( '--plugin-dir has no includes/class-aicc-release-signature.php' );
	}
	require_once $f;
}
function uds_write( $out, array $doc ) {
	$h = @fopen( $out, 'x' );
	if ( false === $h ) {
		uds_die( 'could not create ' . $out . ' (it exists, or the directory is not writable): nothing overwritten' );
	}
	fwrite( $h, json_encode( $doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) . "\n" );
	fclose( $h );
}

$cmd = $argv[1] ?? '';
$a   = uds_args( $argv );
if ( 'derive' === $cmd ) {
	list( $sk, $pub ) = uds_load( $a['key-file'] ?? '' );
	sodium_memzero( $sk );
	echo 'pub=' . base64_encode( $pub ) . "\n" . 'fp=' . uds_fp( $pub ) . "\n";
	exit( 0 );
}
if ( 'sign' === $cmd ) {
	uds_class( $a['plugin-dir'] ?? '' );
	$m = uds_manifest( $a['manifest'] ?? '' );
	if ( false !== ( $m['dirty'] ?? true ) ) {
		uds_die( 'the manifest does not say dirty:false: a development build is never signed' );
	}
	$issued = $a['issued-at'] ?? gmdate( 'Y-m-d\TH:i:s\Z' );
	$msg    = AICC_Release_Signature::message( uds_fields( $m, $issued ) );
	if ( null === $msg ) {
		uds_die( 'the manifest has a missing or malformed field (slug, version, sha256, size, requires_wp/php/wc): nothing signed' );
	}
	$zip = $a['zip'] ?? '';
	if ( ! is_file( $zip ) || filesize( $zip ) !== ( $m['size'] ?? -1 ) || ! hash_equals( (string) ( $m['sha256'] ?? '' ), hash_file( 'sha256', $zip ) ) ) {
		uds_die( 'the ZIP does not match the manifest (size or SHA-256): refusing' );
	}
	if ( ! class_exists( 'ZipArchive' ) ) {
		uds_die( 'the PHP zip extension is required to check what the ZIP bakes' );
	}
	$za = new ZipArchive();
	if ( true !== $za->open( $zip ) ) {
		uds_die( 'the ZIP cannot be opened' );
	}
	$defaults = $za->getFromName( 'ai-commerce-copilot/includes/aicc-release-defaults.php' );
	$za->close();
	if ( ! is_string( $defaults ) || 1 !== preg_match( "/const PUBLIC_KEYS = '([A-Za-z0-9+\\/=,]*)';/", $defaults, $mm ) ) {
		uds_die( 'the ZIP has no baked public key list (not a release build)' );
	}
	list( $sk, $pub ) = uds_load( $a['key-file'] ?? '' );
	if ( isset( $a['expect-pub'] ) && ! hash_equals( (string) $a['expect-pub'], base64_encode( $pub ) ) ) {
		sodium_memzero( $sk );
		uds_die( 'the key on the stick is NOT the expected public key: nothing signed' );
	}
	if ( ! in_array( $pub, AICC_Release_Signature::parse_keys( $mm[1] ), true ) ) {
		sodium_memzero( $sk );
		uds_die( 'the ZIP does not carry this signing key\'s PUBLIC key (UPDATE_PUBLIC_KEYS at build time): a build that cannot verify its own signature is never signed' );
	}
	$sig = sodium_crypto_sign_detached( $msg, $sk );
	sodium_memzero( $sk );
	uds_write( $a['sig-out'] ?? '', array(
		'schema'    => 1,
		'alg'       => 'ed25519',
		'key_id'    => AICC_Release_Signature::fingerprint( $pub ),
		'issued_at' => $issued,
		'signature' => base64_encode( $sig ),
	) );
	echo 'signed ' . ( $m['version'] ?? '?' ) . ' with key ' . AICC_Release_Signature::fingerprint( $pub ) . "\n";
	exit( 0 );
}
if ( 'smoke' === $cmd ) {
	list( $sk, $pub ) = uds_load( $a['key-file'] ?? '' );
	$msg = 'aicc-usb-smoke-test:' . bin2hex( random_bytes( 16 ) );
	$sig = sodium_crypto_sign_detached( $msg, $sk );
	sodium_memzero( $sk );
	if ( ! sodium_crypto_sign_verify_detached( $sig, $msg, $pub ) || sodium_crypto_sign_verify_detached( $sig, $msg . 'x', $pub ) ) {
		uds_die( 'the smoke test failed: the key does not sign and verify correctly' );
	}
	echo "smoke=ok\n";
	exit( 0 );
}
if ( 'wrong-key-sig' === $cmd ) {
	uds_class( $a['plugin-dir'] ?? '' );
	$m      = uds_manifest( $a['manifest'] ?? '' );
	$issued = gmdate( 'Y-m-d\TH:i:s\Z' );
	$msg    = AICC_Release_Signature::message( uds_fields( $m, $issued ) );
	if ( null === $msg ) {
		uds_die( 'malformed manifest' );
	}
	$kp  = sodium_crypto_sign_keypair();
	$sig = sodium_crypto_sign_detached( $msg, sodium_crypto_sign_secretkey( $kp ) );
	$pub = sodium_crypto_sign_publickey( $kp );
	sodium_memzero( $kp );
	uds_write( $a['out'] ?? '', array(
		'schema'    => 1,
		'alg'       => 'ed25519',
		'key_id'    => AICC_Release_Signature::fingerprint( $pub ),
		'issued_at' => $issued,
		'signature' => base64_encode( $sig ),
	) );
	exit( 0 );
}
uds_die( 'usage: derive | sign | smoke | wrong-key-sig (see the header)', 2 );
