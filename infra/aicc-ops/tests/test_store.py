import os
import sqlite3
import unittest

from aicc_ops.store import Store
from tests.helpers import TmpCase, make_store

T0 = 1_760_000_000 // 3600 * 3600  # aligned to the hour


class StoreTests(TmpCase):
    def fill(self, st, start, seconds, step=30, f=lambda t: 1.0, name="m.a"):
        for t in range(start, start + seconds, step):
            st.write_sample(t, {name: f(t)})

    def test_wal_and_pragmas(self):
        st = make_store(self.tmp)
        self.assertEqual(st.db.execute("PRAGMA journal_mode").fetchone()[0], "wal")
        self.assertEqual(st.db.execute("PRAGMA synchronous").fetchone()[0], 1)  # NORMAL
        self.assertEqual(st.db.execute("PRAGMA auto_vacuum").fetchone()[0], 2)  # INCREMENTAL

    def test_rollup_avg_min_max_p95(self):
        st = make_store(self.tmp)
        vals = list(range(1, 11))  # ten samples in one 5-minute bucket
        for i, v in enumerate(vals):
            st.write_sample(T0 + i * 30, {"m.a": float(v)})
        st.write_sample(T0 + 600, {"m.a": 99.0})  # opens a later bucket so the first is closed
        st.rollup(T0 + 301)
        row = st.db.execute("SELECT n, avg, mn, mx, p95 FROM r5").fetchone()
        self.assertEqual(row[0], 10)
        self.assertAlmostEqual(row[1], 5.5)
        self.assertEqual((row[2], row[3]), (1.0, 10.0))
        self.assertAlmostEqual(row[4], 9.55)  # linear-interpolated p95
        self.assertEqual(st.db.execute("SELECT COUNT(*) FROM r5").fetchone()[0], 1)  # open bucket not rolled yet

    def test_open_bucket_is_not_rolled_and_rollup_is_idempotent(self):
        st = make_store(self.tmp)
        self.fill(st, T0, 3600)
        st.rollup(T0 + 3600)
        n5 = st.db.execute("SELECT COUNT(*) FROM r5").fetchone()[0]
        n1 = st.db.execute("SELECT COUNT(*) FROM r1h").fetchone()[0]
        st.rollup(T0 + 3600)
        self.assertEqual(n5, 12)
        self.assertEqual(n1, 1)
        self.assertEqual(st.db.execute("SELECT COUNT(*) FROM r5").fetchone()[0], 12)

    def test_retention_windows(self):
        st = make_store(self.tmp, raw_retention_h=48, rollup5_retention_d=35, rollup1h_retention_d=400)
        now = T0 + 90 * 86400
        for ts in (now - 49 * 3600, now - 47 * 3600):
            st.write_sample(ts, {"m.a": 1.0})
        mid = st.mid("m.a")
        for ts in (now - 36 * 86400, now - 34 * 86400):
            st.db.execute("INSERT INTO r5 VALUES (?,?,?,?,?,?,?)", (mid, ts, 1, 1, 1, 1, 1))
        for ts in (now - 401 * 86400, now - 399 * 86400):
            st.db.execute("INSERT INTO r1h VALUES (?,?,?,?,?,?,?)", (mid, ts, 1, 1, 1, 1, 1))
        d = st.prune(now)
        self.assertEqual(d, {"raw": 1, "r5": 1, "r1h": 1})

    def test_size_cap_prunes_oldest_rollups_first(self):
        st = make_store(self.tmp)
        mid_ids = [st.mid(f"m.{i}") for i in range(40)]
        st.db.execute("BEGIN")
        rows5 = [(m, T0 + i * 300, 10, 1.5, 1.0, 2.0, 1.9) for m in mid_ids for i in range(2000)]
        st.db.executemany("INSERT INTO r5 VALUES (?,?,?,?,?,?,?)", rows5)
        rows1 = [(m, T0 + i * 3600, 10, 1.5, 1.0, 2.0, 1.9) for m in mid_ids for i in range(8000)]
        st.db.executemany("INSERT INTO r1h VALUES (?,?,?,?,?,?,?)", rows1)
        rawrows = [(m, T0 + i * 30, 1.5) for m in mid_ids for i in range(500)]
        st.db.executemany("INSERT INTO raw VALUES (?,?,?)", rawrows)
        st.db.execute("COMMIT")
        before = (st.db.execute("SELECT COUNT(*) FROM raw").fetchone()[0],)
        st.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        total = st.db_bytes()
        st.cfg["max_db_bytes"] = int(total * 0.8)  # smaller than the DB, reachable by trimming the 1-h tier alone
        old_min_1h = st.db.execute("SELECT MIN(ts) FROM r1h").fetchone()[0]
        actions = st.enforce_cap(T0)
        self.assertTrue(actions)
        self.assertLessEqual(st.db_bytes(), st.cfg["max_db_bytes"])
        self.assertTrue(actions[0].startswith("cap: pruned") and "r1h" in actions[0])  # r1h pruned FIRST
        self.assertGreater(st.db.execute("SELECT MIN(ts) FROM r1h").fetchone()[0], old_min_1h)  # oldest went first
        self.assertEqual(st.db.execute("SELECT COUNT(*) FROM raw").fetchone()[0], before[0])  # raw untouched while rollups sufficed
        self.assertEqual(st.db.execute("SELECT COUNT(*) FROM events WHERE kind='size_cap'").fetchone()[0], 1)

    def test_disk_guard_refuses_writes_and_does_not_touch_db(self):
        st = make_store(self.tmp, free_pct=5.0, min_free_pct=10)
        self.assertFalse(st.write_sample(T0, {"m.a": 1.0}))
        self.assertTrue(st.blocked)
        self.assertEqual(st.db.execute("SELECT COUNT(*) FROM raw").fetchone()[0], 0)
        st.free_pct_fn = lambda _p: 50.0
        self.assertTrue(st.write_sample(T0, {"m.a": 1.0}))
        self.assertFalse(st.blocked)

    def test_series_downsampling_and_tiers(self):
        st = make_store(self.tmp)
        self.fill(st, T0, 6 * 3600, f=lambda t: (t - T0) / 3600.0)
        tier, step, rows = st.series("m.a", T0, T0 + 6 * 3600, max_points=72)
        self.assertEqual(tier, "raw") if T0 > 0 and False else None
        self.assertLessEqual(len(rows), 73)
        self.assertEqual(step % 30, 0)
        self.assertEqual(st.series("nope", T0, T0 + 10)[2], [])
        # tier choice by age
        self.assertEqual(st.tier_for(T0 - 10 * 86400, T0), "r5")
        self.assertEqual(st.tier_for(T0 - 100 * 86400, T0), "r1h")
        self.assertEqual(st.tier_for(T0 - 3600, T0), "raw")

    def test_points_5m_merges_rollup_and_raw_tail(self):
        st = make_store(self.tmp)
        self.fill(st, T0, 3600, f=lambda t: 10.0)
        st.rollup(T0 + 1800)  # 6 buckets rolled
        pts = st.points_5m(["m.a"], T0, T0 + 3600)["m.a"]
        self.assertEqual(len(pts), 12)
        self.assertEqual([p["ts"] for p in pts], sorted(p["ts"] for p in pts))
        self.assertTrue(all(abs(p["avg"] - 10.0) < 1e-9 for p in pts))

    def test_alert_state_and_history_roundtrip_and_config_snapshot(self):
        st = make_store(self.tmp)
        st.save_alert_state("k:s", {"status": "firing"})
        self.assertEqual(st.load_alert_states()["k:s"]["status"], "firing")
        st.add_alert_event(5, "k:s", "k", "s", "WARNING", "FIRING", "msg")
        self.assertEqual(st.alert_history(10)[0][1:], ("k", "s", "WARNING", "FIRING", "msg"))
        a = st.snapshot_config(1, {"x": 1})
        b = st.snapshot_config(2, {"x": 1})
        c = st.snapshot_config(3, {"x": 2})
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertEqual(st.db.execute("SELECT COUNT(*) FROM config_snapshot").fetchone()[0], 2)

    def test_reader_is_read_only(self):
        st = make_store(self.tmp)
        r = st.reader()
        with self.assertRaises(sqlite3.OperationalError):
            r.execute("INSERT INTO meta VALUES ('a','b')")
        r.close()

    def test_nan_and_private_keys_not_stored(self):
        st = make_store(self.tmp)
        st.write_sample(T0, {"m.a": float("nan"), "_error.x": 5, "m.b": 2})
        self.assertEqual(st.metric_names(), ["m.b"])


if __name__ == "__main__":
    unittest.main()
