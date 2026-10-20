"""MySQL collector via the `mysql` CLI with a dedicated socket-authenticated monitoring account.

No password is ever stored or passed: the account is created with auth_socket (see sql/monitoring-user.sql)."""
from __future__ import annotations

import re
import subprocess

from . import CollectorError, Result

STATUS_VARS = ("Threads_connected", "Threads_running", "Max_used_connections", "Slow_queries",
               "Aborted_connects", "Uptime", "Questions", "Connections")
# MySQL client errors meaning "server not reachable/up" (=> mysql.up=0, an alert condition, not a collector fault)
DOWN_CODES = {2002, 2003, 2006, 2013, 1040, 1129, 1130}


class MysqlError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code


def build_argv(sect: dict) -> list:
    return [sect["client"], "--protocol=socket", f"--socket={sect['socket']}", f"--user={sect['user']}",
            "--batch", "--skip-column-names", "--connect-timeout=3", "--no-defaults"]


def run_sql(sect: dict, sql: str, timeout: float = 8.0, database: str = "") -> str:
    argv = build_argv(sect)
    if database:
        argv.append(f"--database={database}")
    argv += ["-e", sql]
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)
    except FileNotFoundError:
        raise CollectorError(f"mysql client not found: {sect['client']}")
    except subprocess.TimeoutExpired:
        raise MysqlError(2013, "query timed out")
    if p.returncode != 0:
        m = re.search(r"ERROR (\d+)", p.stderr)
        raise MysqlError(int(m.group(1)) if m else 0, (p.stderr.strip().splitlines() or ["mysql failed"])[0][:200])
    return p.stdout


def parse_pairs(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            out[parts[0]] = parts[1]
    return out


def collect(full_cfg, cfg, state, now) -> Result:
    names = ",".join(f"'{v}'" for v in STATUS_VARS)
    sql = f"SHOW GLOBAL STATUS WHERE Variable_name IN ({names}); SHOW VARIABLES LIKE 'max_connections';"
    db = cfg.get("database", "")
    if db:  # db name validated by config.validate ([A-Za-z0-9_]{1,64})
        sql += (f" SELECT 'db_size_bytes', IFNULL(SUM(data_length+index_length),0) "
                f"FROM information_schema.tables WHERE table_schema='{db}';")
    try:
        out = run_sql(cfg, sql, cfg.get("timeout_s", 8))
    except MysqlError as e:
        if e.code in DOWN_CODES or e.code == 0:
            return Result(metrics={"mysql.up": 0.0})
        raise CollectorError(f"mysql error {e.code}: {e}")
    return from_pairs(parse_pairs(out), state)


def from_pairs(kv: dict, state: dict) -> Result:
    def f(k):
        try:
            return float(kv[k])
        except (KeyError, ValueError):
            return None
    m = {"mysql.up": 1.0}
    for src, dst in (("Threads_connected", "threads_connected"), ("Threads_running", "threads_running"),
                     ("Max_used_connections", "max_used_connections"), ("Uptime", "uptime_s"),
                     ("max_connections", "max_connections"), ("db_size_bytes", "db_size_bytes")):
        v = f(src)
        if v is not None:
            m[f"mysql.{dst}"] = v
    if m.get("mysql.max_connections") and "mysql.threads_connected" in m:
        m["mysql.conn_pressure_pct"] = 100.0 * m["mysql.threads_connected"] / m["mysql.max_connections"]
    prev = state.get("prev", {})
    cur = {k: f(k) for k in ("Slow_queries", "Aborted_connects", "Questions")}
    up = f("Uptime")
    dt = None
    if up is not None and prev.get("Uptime") is not None:
        dt = up - prev["Uptime"]
    for k, name in (("Slow_queries", "slow_queries_delta"), ("Aborted_connects", "aborted_connects_delta")):
        if cur[k] is not None and prev.get(k) is not None:
            d = cur[k] - prev[k]
            m[f"mysql.{name}"] = cur[k] if d < 0 else d
    if cur["Questions"] is not None and prev.get("Questions") is not None and dt and dt > 0:
        d = cur["Questions"] - prev["Questions"]
        m["mysql.qps"] = (cur["Questions"] if d < 0 else d) / dt
    state["prev"] = {**cur, "Uptime": up}
    return Result(metrics=m)
