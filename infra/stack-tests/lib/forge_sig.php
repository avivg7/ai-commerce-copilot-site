<?php
/**
 * TEST HELPER (throwaway keys only): signs a manifest with ANY key file, skipping the checks bin/sign-release.php makes (clean manifest, ZIP carries the key's public half), to build the
 * signatures an attacker or a mistaken operator could produce. Usage: php forge_sig.php <plugin dir> <manifest> <secret key file> <out .sig> [key_id override]
 */
if ( 'cli' !== PHP_SAPI ) { exit( 1 ); }
define( 'ABSPATH', '/nonexistent/' );
require $argv[1] . '/includes/class-aicc-release-signature.php';
$m      = json_decode( file_get_contents( $argv[2] ), true );
$secret = base64_decode( trim( file_get_contents( $argv[3] ) ), true );
$at     = gmdate( 'Y-m-d\TH:i:s\Z' );
$msg    = AICC_Release_Signature::message( array( 'slug' => $m['slug'], 'version' => $m['version'], 'sha256' => $m['sha256'], 'size' => $m['size'], 'requires_wp' => $m['requires_wp'], 'requires_php' => $m['requires_php'], 'requires_wc' => $m['requires_wc'], 'issued_at' => $at ) );
$pub    = sodium_crypto_sign_publickey_from_secretkey( $secret );
$doc    = array( 'schema' => 1, 'alg' => 'ed25519', 'key_id' => $argv[5] ?? AICC_Release_Signature::fingerprint( $pub ), 'issued_at' => $at, 'signature' => base64_encode( sodium_crypto_sign_detached( $msg, $secret ) ) );
file_put_contents( $argv[4], json_encode( $doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) . "\n" );
echo "forged\n";
