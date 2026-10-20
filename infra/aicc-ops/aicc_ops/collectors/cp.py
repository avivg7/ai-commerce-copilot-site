"""Control Plane aggregate counters (read-only SELECT) per the aicc_ops_counters contract.

Table `{prefix}aicc_ops_counters(metric, bucket_minute, reason, value)`. No PII: `reason` is a small fixed enum.
Emits per-minute RATES over the complete minutes since the previous read (rollups can then recover totals).
Tolerates the table (or the WooCommerce Action Scheduler tables) not existing yet."""
from __future__ import annotations

import re

from . import CollectorError, Result
from .mysql import run_sql, MysqlError

KNOWN_METRICS = ("registrations", "login_success", "login_failure", "checkout_start", "order_completed", "refund",
                 "license_issued", "license_lifecycle_failure", "store_connection", "password_reset_failure")
REASON_RE = re.compile(r"^[a-z0-9_]{1,24}$")
# Fixed enums from the Control Plane contract (docs/unified-experience/ops-counters.md). Metrics without an entry accept
# any short [a-z0-9_] token. Anything outside the enum is dropped, never turned into a metric name.
KNOWN_REASONS = {
    "license_lifecycle_failure": {"validate", "activate", "deactivate", "expire", "revoke", "delivery", "issue", "other"},
    "order_completed": {"processing", "completed"},
    "registrations": {"checkout", "account", "admin"},
    "store_connection": {"approve", "purchase"},
}
MAX_REASONS_PER_METRIC = 8
MAX_CATCHUP_MIN = 15
NO_TABLE = 1146


def counters_sql(prefix: str, from_minute: int, to_minute: int) -> str:
    # prefix validated by config.validate; minutes are ints => no injection surface
    return (f"SELECT metric, reason, SUM(value) FROM `{prefix}aicc_ops_counters` "
            f"WHERE bucket_minute > {int(from_minute)} AND bucket_minute <= {int(to_minute)} GROUP BY metric, reason")


def gauges_sql(prefix: str) -> str:
    """Action Scheduler gauges per the contract: one grouped query over pending/failed."""
    return (f"SELECT status, COUNT(*) FROM `{prefix}actionscheduler_actions` "
            "WHERE status IN ('pending','failed') GROUP BY status")


def heartbeat_sql(prefix: str) -> str:
    """Cron heartbeat: autoload=off option `aicc_ops_cron_last_run` (unix seconds). Needs SELECT on the options table
    (a trade-off the owner must accept, see sql/monitoring-user.sql); on failure we fall back to Action Scheduler."""
    return (f"SELECT 'wc_cron_last_run_age_seconds', UNIX_TIMESTAMP() - CAST(option_value AS UNSIGNED) "
            f"FROM `{prefix}options` WHERE option_name='aicc_ops_cron_last_run'")


def fallback_cron_sql(prefix: str) -> str:
    return ("SELECT 'wc_cron_last_run_age_seconds', TIMESTAMPDIFF(SECOND, MAX(last_attempt_gmt), UTC_TIMESTAMP()) "
            f"FROM `{prefix}actionscheduler_actions` WHERE status='complete' AND last_attempt_gmt > '1970-01-02'")


def parse_counters(text: str, minutes: int) -> dict:
    """-> per-minute rates; unknown metric names / malformed reasons are dropped (never trust DB content as names)."""
    totals, reasons = {}, {}
    for line in text.splitlines():
        p = line.split("\t")
        if len(p) != 3 or p[0] not in KNOWN_METRICS:
            continue
        try:
            v = float(p[2])
        except ValueError:
            continue
        totals[p[0]] = totals.get(p[0], 0.0) + v
        if p[1] and REASON_RE.match(p[1]) and p[1] in KNOWN_REASONS.get(p[0], {p[1]}):
            reasons.setdefault(p[0], {})[p[1]] = reasons.get(p[0], {}).get(p[1], 0.0) + v
    out = {}
    for k in KNOWN_METRICS:
        out[f"cp.{k}_per_min"] = totals.get(k, 0.0) / minutes
        for r, v in sorted(reasons.get(k, {}).items(), key=lambda kv: -kv[1])[:MAX_REASONS_PER_METRIC]:
            out[f"cp.{k}.r.{r}_per_min"] = v / minutes
    # checkout_start is APPROXIMATE (page view in a session with a cart): only ever shown as a ratio, never an exact funnel
    if totals.get("checkout_start", 0.0) > 0:
        out["cp.order_per_checkout_ratio"] = totals.get("order_completed", 0.0) / totals["checkout_start"]
    return out


def collect(full_cfg, cfg, state, now) -> Result:
    cur_min = int(now // 60) - 1  # last COMPLETE minute
    last = state.get("last_minute")
    from_min = max(last if last is not None else cur_min - 1, cur_min - MAX_CATCHUP_MIN)
    res = Result()
    db = cfg.get("database") or ""
    if not db:
        raise CollectorError("collectors.cp.database is not configured")
    prefix = cfg["prefix"]
    if cur_min > from_min:
        try:
            out = run_sql(cfg, counters_sql(prefix, from_min, cur_min), cfg.get("timeout_s", 10), database=db)
            res.metrics.update(parse_counters(out, cur_min - from_min))
            res.metrics["cp.table_present"] = 1.0
            state["last_minute"] = cur_min
        except MysqlError as e:
            if e.code == NO_TABLE:
                res.metrics["cp.table_present"] = 0.0
            elif e.code in (2002, 2003, 2006, 2013):
                res.metrics["cp.table_present"] = state.get("table_present", 0.0)
                res.errors.append("mysql unreachable")
            else:
                raise CollectorError(f"cp counters query failed: mysql error {e.code}")
    try:
        out = run_sql(cfg, gauges_sql(prefix), cfg.get("timeout_s", 10), database=db)
        seen = {"pending": 0.0, "failed": 0.0}
        for line in out.splitlines():
            p = line.split("\t")
            if len(p) == 2 and p[0] in seen and re.fullmatch(r"\d+", p[1].strip()):
                seen[p[0]] = float(p[1])
        res.metrics["cp.action_scheduler_pending"] = seen["pending"]
        res.metrics["cp.action_scheduler_failed"] = seen["failed"]
    except MysqlError as e:
        if e.code != NO_TABLE:  # WooCommerce / Action Scheduler not installed yet is fine
            res.errors.append(f"action scheduler query failed: mysql error {e.code}")
    age = None
    for sql in (heartbeat_sql(prefix), fallback_cron_sql(prefix)):
        try:
            out = run_sql(cfg, sql, cfg.get("timeout_s", 10), database=db)
        except MysqlError:
            continue
        for line in out.splitlines():
            p = line.split("\t")
            if len(p) == 2 and p[0] == "wc_cron_last_run_age_seconds" and re.fullmatch(r"-?\d+", p[1].strip()):
                age = float(p[1])
        if age is not None:
            break
    if age is not None and age >= 0:
        res.metrics["cp.wc_cron_last_run_age_seconds"] = age
    state["table_present"] = res.metrics.get("cp.table_present", 0.0)
    return res
