"""OPTIONAL PostgreSQL collector for the API host. DISABLED BY DEFAULT.

Enabling it requires a production change (a read-only monitoring role + local socket access + installing AICC Ops
on the API host), which needs separate owner approval. Nothing here is enabled or deployed by the staging package."""
from __future__ import annotations

import subprocess

from . import CollectorError, Result


def collect(full_cfg, cfg, state, now) -> Result:
    sql = ("SELECT 'connections', count(*) FROM pg_stat_activity; "
           "SELECT 'max_connections', setting::int FROM pg_settings WHERE name='max_connections'; "
           "SELECT 'db_size_bytes', pg_database_size(current_database());")
    argv = [cfg["client"], "-X", "-A", "-t", "-F", "\t", "-h", cfg["host"], "-U", cfg["user"], "-d", cfg["database"],
            "-f", "-"]
    try:
        p = subprocess.run(argv, input=sql, capture_output=True, text=True, timeout=cfg.get("timeout_s", 8), check=False)
    except FileNotFoundError:
        raise CollectorError(f"psql client not found: {cfg['client']}")
    except subprocess.TimeoutExpired:
        return Result(metrics={"pg.up": 0.0})
    if p.returncode != 0:
        return Result(metrics={"pg.up": 0.0})
    kv = dict(l.split("\t", 1) for l in p.stdout.splitlines() if "\t" in l)
    m = {"pg.up": 1.0}
    for k in ("connections", "max_connections", "db_size_bytes"):
        try:
            m[f"pg.{k}"] = float(kv[k])
        except (KeyError, ValueError):
            pass
    if m.get("pg.max_connections") and "pg.connections" in m:
        m["pg.conn_pressure_pct"] = 100.0 * m["pg.connections"] / m["pg.max_connections"]
    return Result(metrics=m)
