<?php
// Router for the rehearsal fixture's `php -S` (cp-fixture.sh). php -S runs auto_prepend_file only for scripts it executes ITSELF, not for files a router script includes (the fixture's own
// router.php says so), so a request WordPress handles through the router (every pretty URL) would run WITHOUT scripts/rehearsal/egress-guard.php. This wrapper loads the guard first and then
// hands over to the fixture's router, whose return value (true = handled, false = serve the file) is passed through unchanged. The fixture's files are not modified.
require_once __DIR__ . '/egress-guard.php';
$aicc_router = ( getenv( 'AICC_REHEARSAL_HOME' ) ?: ( ( function_exists( 'posix_getpwuid' ) && ( $pw = posix_getpwuid( posix_getuid() ) ) ? $pw['dir'] : getenv( 'HOME' ) ) . '/aicc-rehearsal' ) ) . '/cp/router.php';
return require $aicc_router;
