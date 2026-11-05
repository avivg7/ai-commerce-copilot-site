"""Export endpoints' logic: strictly validated parameters, bounded output, CSV-injection neutralisation."""
from __future__ import annotations

import csv
import io
import json
import re

from .util import iso, valid_metric_name

RANGES = {"1h": 3600, "6h": 6 * 3600, "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400, "90d": 90 * 86400, "365d": 365 * 86400}
MAX_METRICS = 20
MAX_POINTS_PER_METRIC = 1500
MAX_TOTAL_ROWS = 30000
DEFAULT_METRICS = ["cpu.used_pct", "mem.used_pct", "swap.in_pps", "disk.root.used_pct", "load.1", "caddy.req_rate", "caddy.lat_p95_ms", "fpm.active_ratio", "mysql.conn_pressure_pct",
                   "ops.telegram_sent", "ops.telegram_failed", "ops.telegram_dropped", "ops.telegram_rate_limited", "ops.telegram_last_ok_ts", "ops.telegram_last_failure_ts"]


class ExportError(ValueError):
    pass


def csv_cell(v):
    """Neutralise spreadsheet formula injection in TEXT cells (leading = + - @ tab CR); numbers pass through."""
    if isinstance(v, str):
        if v and (v[0] in "=+-@\t\r" or v.lstrip()[:1] in ("=", "+", "-", "@")):
            return "'" + v
        return v
    return v


def parse_params(qs: dict, known_metrics: set) -> dict:
    """qs: urllib.parse.parse_qs output. Raises ExportError on any invalid parameter."""
    allowed = {"range", "metrics", "kind", "limit"}
    for k in qs:
        if k not in allowed:
            raise ExportError(f"unknown parameter {k!r}")
        if len(qs[k]) != 1:
            raise ExportError(f"parameter {k!r} given more than once")
    rng = qs.get("range", ["24h"])[0]
    if rng not in RANGES:
        raise ExportError("range must be one of " + ",".join(RANGES))
    kind = qs.get("kind", ["metrics"])[0]
    if kind not in ("metrics", "alerts"):
        raise ExportError("kind must be metrics or alerts")
    limit = qs.get("limit", ["500"])[0]
    if not re.fullmatch(r"\d{1,4}", limit) or not (1 <= int(limit) <= 2000):
        raise ExportError("limit must be 1..2000")
    names = DEFAULT_METRICS
    if "metrics" in qs:
        raw = qs["metrics"][0]
        if len(raw) > 1500:
            raise ExportError("metrics parameter too long")
        names = [n for n in raw.split(",") if n]
        if not names or len(names) > MAX_METRICS:
            raise ExportError(f"metrics must list 1..{MAX_METRICS} names")
        for n in names:
            if not valid_metric_name(n):
                raise ExportError("invalid metric name")
    names = [n for n in dict.fromkeys(names)]
    if kind == "metrics":
        unknown = [n for n in names if n not in known_metrics]
        if "metrics" in qs and unknown:
            raise ExportError("unknown metric: " + unknown[0])
        names = [n for n in names if n in known_metrics]
    return {"range": rng, "seconds": RANGES[rng], "metrics": names, "kind": kind, "limit": int(limit)}


def collect_metrics(store, conn, params: dict, now: float) -> dict:
    per_metric = min(MAX_POINTS_PER_METRIC, max(MAX_TOTAL_ROWS // max(len(params["metrics"]), 1), 10))
    out, tier, step = {}, None, None
    for n in params["metrics"]:
        tier, step, rows = store.series(n, now - params["seconds"], now, max_points=per_metric, conn=conn)
        out[n] = rows
    return {"generated": iso(now), "range": params["range"], "tier": tier, "step_s": step, "metrics": out}


def to_json(data: dict) -> bytes:
    body = {"generated": data["generated"], "range": data["range"], "tier": data["tier"], "step_s": data["step_s"],
            "columns": ["ts", "avg", "min", "max", "p95"],
            "metrics": {k: [list(r) for r in v] for k, v in data["metrics"].items()}}
    return json.dumps(body, separators=(",", ":")).encode()


def metrics_csv(data: dict) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(["metric", "time_utc", "ts", "avg", "min", "max", "p95"])
    for name, rows in data["metrics"].items():
        for ts, avg, mn, mx, p95 in rows:
            w.writerow([csv_cell(name), iso(ts), ts, avg, mn, mx, "" if p95 is None else p95])
    return buf.getvalue().encode()


def alerts_rows(store, conn, limit):
    return store.alert_history(limit, conn=conn)


def alerts_csv(rows) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(["time_utc", "ts", "rule", "scope", "severity", "kind", "message"])
    for ts, rule, scope, sev, kind, msg in rows:
        w.writerow([iso(ts), ts, csv_cell(rule), csv_cell(scope), csv_cell(sev), csv_cell(kind), csv_cell(msg)])
    return buf.getvalue().encode()


def alerts_json(rows) -> bytes:
    return json.dumps({"alerts": [{"ts": ts, "time_utc": iso(ts), "rule": r, "scope": s, "severity": sv, "kind": k, "message": m}
                                  for ts, r, s, sv, k, m in rows]}, separators=(",", ":")).encode()
