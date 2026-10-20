#!/usr/bin/env python3.12
"""Report AICC Ops DB growth (bytes/day) and projected steady-state size from FIXTURE data.
Simulates D days through the real pipeline, measuring per-tier bytes with the dbstat virtual table.
  python3.12 tools/measure_db_growth.py [--days 14] [--json out.json]
Projection: raw is bounded by its 48 h window; each rollup tier grows linearly until its retention is reached, so
projected = raw_window_bytes + r5_bytes_per_day*35 + r1h_bytes_per_day*400 (+ small fixed tables)."""
import argparse
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seed_history  # noqa: E402


def tier_bytes(st):
    try:
        rows = st.db.execute("SELECT name, SUM(pgsize) FROM dbstat GROUP BY name").fetchall()
        return {n: b for n, b in rows}
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=float, default=14)
    ap.add_argument("--json")
    a = ap.parse_args()
    td = tempfile.mkdtemp(prefix="aicc-growth-")
    db = os.path.join(td, "g.sqlite3")
    marks = {}

    def prog(day, st):
        if day in (2, 3, int(a.days)):
            st.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            marks[day] = tier_bytes(st)
    st = seed_history.seed(db, a.days, progress=prog)
    final = tier_bytes(st)
    if not final:
        sys.exit("dbstat virtual table not available in this SQLite build")
    n = int(a.days)
    def rows(t):
        return st.db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    counts = {t: rows(t) for t in ("raw", "r5", "r1h")}
    metrics = len(st.metric_names())
    # bytes/day per rollup tier from the whole run (linear tiers; the tables are PK-organised, so sqlite_autoindex names)
    def pick(tab):
        return sum(v for k, v in final.items() if k == tab or k.startswith(f"sqlite_autoindex_{tab}"))
    b = {t: pick(t) for t in ("raw", "r5", "r1h")}
    per_day = {"r5": b["r5"] / n, "r1h": b["r1h"] / n}
    raw_window = b["raw"]  # already pruned to its 48 h window when n >= 2 days
    fixed = sum(final.values()) - sum(b.values())
    proj = {"raw_48h": raw_window, "r5_35d": per_day["r5"] * 35, "r1h_400d": per_day["r1h"] * 400, "fixed_tables": fixed}
    proj_total = sum(proj.values())
    rep = {"fixture": "synthetic (tools/synth.py)", "metrics": metrics, "simulated_days": n, "rows": counts, "bytes_by_tier": b,
           "growth_bytes_per_day": {"r5": per_day["r5"], "r1h": per_day["r1h"], "total_while_filling": (per_day["r5"] + per_day["r1h"])},
           "projected_steady_state_bytes": proj, "projected_total_bytes": proj_total, "projected_total_mib": proj_total / 1048576,
           "cap_mib": 150, "within_cap_without_pruning": proj_total <= 150 * 1048576, "db_file_bytes_now": st.db_bytes(), "sqlite": __import__("sqlite3").sqlite_version}
    print(json.dumps(rep, indent=2))
    if a.json:
        with open(a.json, "w") as fh:
            json.dump(rep, fh, indent=2)


if __name__ == "__main__":
    main()
