-- AICC Ops monitoring account for MySQL 8.0. Run ONCE as MySQL root on the host: sudo mysql < monitoring-user.sql
-- UNVERIFIED until run against the real MySQL 8.0 (no MySQL was available when this was written).
--
-- * Unix-socket authentication (auth_socket): no password exists anywhere. Only the OS user `aicc-ops` can log in,
--   and only through the local socket.
-- * Read-only, global privileges kept to the minimum needed for SHOW GLOBAL STATUS / SHOW VARIABLES / processlist counts.
-- * information_schema needs no GRANT (it is readable by every account; GRANT ... ON information_schema.* is rejected
--   by MySQL 8). information_schema.TABLES only lists tables the account has SOME privilege on, so the DB-size metric
--   covers only tables granted below. That is deliberate: we do NOT grant SELECT on customer/user tables.

CREATE USER IF NOT EXISTS 'aicc_monitor'@'localhost'
    IDENTIFIED WITH auth_socket AS 'aicc-ops'
    WITH MAX_USER_CONNECTIONS 2 MAX_QUERIES_PER_HOUR 20000;

GRANT USAGE ON *.* TO 'aicc_monitor'@'localhost';
GRANT PROCESS ON *.* TO 'aicc_monitor'@'localhost';

-- ---- Control Plane counters (run AFTER the Control Plane plugin created its tables; replace <db> and <prefix>) ----
-- Only these two tables are readable; both hold aggregate/operational data, no customer rows:
--   GRANT SELECT ON `<db>`.`<prefix>aicc_ops_counters`       TO 'aicc_monitor'@'localhost';
--   GRANT SELECT ON `<db>`.`<prefix>actionscheduler_actions` TO 'aicc_monitor'@'localhost';
-- Entitlement delivery gauges (Control Plane -> Backend webhook outbox; alerts entitlement_outbox_stale / entitlement_outbox_abandoned). OPTIONAL: without this grant the collector
-- reports "not reporting" and raises no alert. COLUMN-level grant: only the five columns the gauge query reads; no event id, license reference, plan or expiry is readable.
--   GRANT SELECT (id, activation_ref, attempts, delivered_at, created_at) ON `<db>`.`<prefix>aicc_lm_entitlement_outbox` TO 'aicc_monitor'@'localhost';
-- Cron heartbeat (option `aicc_ops_cron_last_run`): reading it needs SELECT on `<prefix>options`, which ALSO holds site secrets.
-- That is an OWNER DECISION and is NOT granted by default; without it the collector falls back to the newest completed
-- Action Scheduler action for `wc_cron_last_run_age_seconds`. If you accept the trade-off:
--   GRANT SELECT (option_name, option_value) ON `<db>`.`<prefix>options` TO 'aicc_monitor'@'localhost';
-- (column grant does not hide values; it only limits columns)
-- (actionscheduler_actions rows contain hook names and argument blobs: the collector only runs COUNT/MAX on status and
--  last_attempt_gmt. If you prefer, grant column-level access:  GRANT SELECT (status, last_attempt_gmt) ON ... )

FLUSH PRIVILEGES;

-- Verify (as root):  SHOW GRANTS FOR 'aicc_monitor'@'localhost';
-- Verify (as aicc-ops OS user):  mysql --protocol=socket -S /var/run/mysqld/mysqld.sock -u aicc_monitor -e "SHOW GLOBAL STATUS LIKE 'Threads_connected'"
-- Remove:  DROP USER 'aicc_monitor'@'localhost';
