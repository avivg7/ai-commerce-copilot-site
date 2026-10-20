#!/usr/bin/env python3.12
"""Populate an AICC Ops SQLite file with N days of SYNTHETIC history through the real pipeline (write -> rollup -> prune
with a simulated clock). FIXTURE DATA for demos, screenshots and storage sizing. Usage:
  python3.12 tools/seed_history.py --db PATH --days 30 [--end-now]"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from aicc_ops.config import load_config  # noqa: E402
from aicc_ops.store import Store  # noqa: E402
import synth  # noqa: E402


def seed(db, days, end=None, step=30, scale=1.0, cfg=None, progress=None):
    cfg = cfg or load_config()
    st = Store(db, cfg["storage"], free_pct_fn=lambda _p: 90.0)
    rng, state = synth.make_rng(), {}
    end = int(end or time.time()) // step * step
    start = end - int(days * 86400)
    t = start
    day_marks = 0
    while t < end:
        day_end = min(t + 86400, end)
        st.db.execute("BEGIN")
        rows = []
        for ts in range(t, day_end, step):
            m = synth.sample(ts, rng, state, scale)
            for name, v in m.items():
                rows.append((st.mid(name), ts, float(v)))
        st.db.executemany("INSERT OR REPLACE INTO raw(mid,ts,v) VALUES (?,?,?)", rows)
        st.db.execute("COMMIT")
        st.rollup(day_end)
        st.prune(day_end)
        t = day_end
        day_marks += 1
        if progress:
            progress(day_marks, st)
    st.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return st


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--days", type=float, default=30)
    ap.add_argument("--scale", type=float, default=1.0)
    a = ap.parse_args()
    s = seed(a.db, a.days, scale=a.scale)
    print("seeded", a.db, "metrics:", len(s.metric_names()), "bytes:", s.db_bytes())
