<?php
/**
 * outbox-snapshot.php: run through `aicc-wp eval-file` (as the PHP user aicc-cp) by `aicc-rotate-webhook-secret` (preflight, prepare, drain-check, finalize).
 *
 * READ-ONLY. It lists the entitlement outbox rows that have NOT reached the Backend (delivered_at IS NULL) so the rotation can prove, event by event, that nothing sent in the mismatch window is still waiting:
 *   EVENT <event_id> attempts=<n>       still retrying (attempts < AICC_LM_Entitlement_Dispatcher::MAX_ATTEMPTS)
 *   EXHAUSTED <event_id> attempts=<n> superseded=<0|1>   gave up (attempts >= MAX_ATTEMPTS): never deleted, never marked delivered; AICC_LM_Entitlement_Dispatcher::reconcile_exhausted() may re-queue it (newest row per activation only); superseded=1 when a newer row of the same activation exists
 *   TOTAL unavailable (exit 1)   the table or the query failed: FAIL CLOSED, never an empty list
 *   TOTAL pending=<n> exhausted=<n> listed=<n>
 * Only event ids (UUIDs) and counters are printed: no secret, no payload, no licence data. At most 1000 rows are listed (TOTAL says how many exist; a longer list makes the caller refuse).
 * It reads only (SHOW TABLES and one SELECT with a count sub-select); it never writes (no UPDATE, INSERT, DELETE, no option, no cron call).
 */
if ( ! defined( 'ABSPATH' ) ) {
	fwrite( STDERR, "run this through wp eval-file\n" );
	exit( 1 );
}
global $wpdb;
if ( ! class_exists( 'AICC_LM_Activator' ) || ! class_exists( 'AICC_LM_Entitlement_Dispatcher' ) ) {
	echo "TOTAL unavailable\n";
	exit( 1 );
}
$aicc_snap_table = AICC_LM_Activator::outbox_table();
$aicc_snap_max   = (int) AICC_LM_Entitlement_Dispatcher::MAX_ATTEMPTS;
// FAIL CLOSED. wpdb::get_results() returns an EMPTY array when the query fails (a wrong table or column, a dropped connection), which is indistinguishable from "nothing pending": the table must exist
// and `$wpdb->last_error` must be empty after the query, otherwise nothing but `TOTAL unavailable` is printed and the exit code is 1. (The caller also cross-checks the counts against `aicc-mail health`.)
$wpdb->suppress_errors( true );
$wpdb->last_error = '';
// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
$aicc_snap_exists = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $aicc_snap_table ) ) );
if ( $aicc_snap_table !== $aicc_snap_exists || '' !== $wpdb->last_error ) {
	echo "TOTAL unavailable\n";
	exit( 1 );
}
// `superseded` = a NEWER row (higher id = wire sequence) of the same activation exists: reconcile_exhausted() re-queues only the newest row of an activation, so an older exhausted row can never be re-queued and the Backend would answer it as stale.
// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
$aicc_snap_rows = $wpdb->get_results( "SELECT o.event_id, o.attempts, ( SELECT COUNT(*) FROM {$aicc_snap_table} n WHERE n.activation_ref = o.activation_ref AND n.id > o.id ) AS newer FROM {$aicc_snap_table} o WHERE o.delivered_at IS NULL ORDER BY o.id ASC LIMIT 1000" );
if ( ! is_array( $aicc_snap_rows ) || '' !== $wpdb->last_error ) {
	echo "TOTAL unavailable\n";
	exit( 1 );
}
$aicc_snap_pending   = 0;
$aicc_snap_exhausted = 0;
foreach ( $aicc_snap_rows as $aicc_snap_row ) {
	$aicc_snap_id = preg_match( '/^[A-Za-z0-9-]{1,40}$/', (string) $aicc_snap_row->event_id ) ? (string) $aicc_snap_row->event_id : 'invalid-id';
	$aicc_snap_n  = (int) $aicc_snap_row->attempts;
	if ( $aicc_snap_n >= $aicc_snap_max ) {
		++$aicc_snap_exhausted;
		echo 'EXHAUSTED ' . $aicc_snap_id . ' attempts=' . $aicc_snap_n . ' superseded=' . ( (int) $aicc_snap_row->newer > 0 ? '1' : '0' ) . "\n";
	} else {
		++$aicc_snap_pending;
		echo 'EVENT ' . $aicc_snap_id . ' attempts=' . $aicc_snap_n . "\n";
	}
}
echo 'TOTAL pending=' . $aicc_snap_pending . ' exhausted=' . $aicc_snap_exhausted . ' listed=' . count( $aicc_snap_rows ) . "\n";
exit( 0 );
