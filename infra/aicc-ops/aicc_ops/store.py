"""SQLite storage: raw 30 s samples, 5-minute and 1-hour rollups, alert state/history, config snapshots.

Retention (defaults): raw 48 h, 5-min 35 d, 1-h 400 d, plus a HARD size cap (default 150 MiB incl. WAL):
over the cap we prune oldest 1-h rollups first, then 5-min rollups, then raw, then incremental-vacuum.
The collector never fills the disk: below `min_free_pct` free space, writes are refused (see write_sample)."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time

from .util import percentile

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS metrics(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS raw(mid INTEGER NOT NULL, ts INTEGER NOT NULL, v REAL NOT NULL, PRIMARY KEY(mid, ts)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS r5(mid INTEGER NOT NULL, ts INTEGER NOT NULL, n INTEGER NOT NULL, avg REAL, mn REAL, mx REAL, p95 REAL, PRIMARY KEY(mid, ts)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS r1h(mid INTEGER NOT NULL, ts INTEGER NOT NULL, n INTEGER NOT NULL, avg REAL, mn REAL, mx REAL, p95 REAL, PRIMARY KEY(mid, ts)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS alert_state(key TEXT PRIMARY KEY, json TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS alert_events(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, key TEXT, rule TEXT, scope TEXT, severity TEXT, kind TEXT, message TEXT);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, severity TEXT, kind TEXT, message TEXT);
CREATE TABLE IF NOT EXISTS config_snapshot(ts INTEGER PRIMARY KEY, sha TEXT, json TEXT);
"""
TIERS = {"raw": 30, "r5": 300, "r1h": 3600}


class DiskGuard(Exception):
    """Raised/recorded when the filesystem has too little free space to write safely."""


def free_pct(path: str) -> float:
    sv = os.statvfs(path)
    return 100.0 * sv.f_bavail / sv.f_blocks if sv.f_blocks else 0.0


class Store:
    def __init__(self, path: str, cfg: dict, free_pct_fn=free_pct):
        self.path = path
        self.cfg = cfg
        self.free_pct_fn = free_pct_fn
        self.lock = threading.Lock()
        d = os.path.dirname(path) or "."
        os.makedirs(d, exist_ok=True)
        self.dir = d
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        new = self.db.execute("PRAGMA page_count").fetchone()[0] == 0
        if new:
            self.db.execute("PRAGMA auto_vacuum=INCREMENTAL")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.execute("PRAGMA journal_size_limit=4194304")
        self.db.executescript(SCHEMA)
        self._ids = {n: i for i, n in self.db.execute("SELECT name, id FROM metrics")}
        self.blocked = False

    # ---- helpers ----------------------------------------------------------------------------------------
    def close(self):
        try:
            self.db.close()
        except sqlite3.Error:
            pass

    def reader(self) -> sqlite3.Connection:
        c = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, check_same_thread=False, timeout=5)
        c.execute("PRAGMA query_only=1")
        return c

    def mid(self, name: str) -> int:
        i = self._ids.get(name)
        if i is None:
            cur = self.db.execute("INSERT OR IGNORE INTO metrics(name) VALUES (?)", (name,))
            i = self.db.execute("SELECT id FROM metrics WHERE name=?", (name,)).fetchone()[0]
            self._ids[name] = i
        return i

    def db_bytes(self) -> int:
        total = 0
        for suffix in ("", "-wal", "-shm"):
            try:
                total += os.path.getsize(self.path + suffix)
            except OSError:
                pass
        return total

    def set_meta(self, k, v):
        self.db.execute("INSERT OR REPLACE INTO meta(k,v) VALUES (?,?)", (k, str(v)))

    def get_meta(self, k, default=None):
        r = self.db.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
        return r[0] if r else default

    # ---- writing ----------------------------------------------------------------------------------------
    def write_sample(self, ts: int, metrics: dict) -> bool:
        """Insert one raw sample. Returns False (and sets self.blocked) when the disk guard refuses the write."""
        pct = self.free_pct_fn(self.dir)
        if pct < self.cfg["min_free_pct"]:
            self.blocked = True
            return False
        self.blocked = False
        rows = []
        for name, v in metrics.items():
            if name.startswith("_") or v is None or v != v:
                continue
            rows.append((self.mid(name), int(ts), float(v)))
        with self.lock:
            self.db.execute("BEGIN")
            try:
                self.db.executemany("INSERT OR REPLACE INTO raw(mid,ts,v) VALUES (?,?,?)", rows)
                self.db.execute("COMMIT")
            except Exception:
                self.db.execute("ROLLBACK")
                raise
        return True

    def add_event(self, ts: int, severity: str, kind: str, message: str):
        if self.blocked:
            return
        self.db.execute("INSERT INTO events(ts,severity,kind,message) VALUES (?,?,?,?)", (int(ts), severity, kind, message[:500]))
        self.db.execute("DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - 2000")

    # ---- rollups ----------------------------------------------------------------------------------------
    def rollup(self, now: float) -> int:
        """Aggregate CLOSED buckets from raw into r5 and r1h. Returns number of rollup rows written."""
        written = 0
        for tier, table, size in (("r5", "r5", 300), ("r1h", "r1h", 3600)):
            key = f"{tier}_done"
            end = int(now // size) * size
            done = self.get_meta(key)
            if done is None:
                first = self.db.execute("SELECT MIN(ts) FROM raw").fetchone()[0]
                if first is None:
                    continue
                done = int(first // size) * size
            done = int(done)
            while done < end:
                chunk_end = min(end, done + 3600)
                rows = self.db.execute("SELECT mid, ts, v FROM raw WHERE ts >= ? AND ts < ? ORDER BY mid, ts", (done, chunk_end)).fetchall()
                out, cur_key, vals = [], None, []

                def flush():
                    if vals:
                        out.append((cur_key[0], cur_key[1], len(vals), sum(vals) / len(vals), min(vals), max(vals), percentile(vals, 95)))
                for mid, ts, v in rows:
                    k = (mid, ts // size * size)
                    if k != cur_key:
                        flush()
                        cur_key, vals = k, []
                    vals.append(v)
                flush()
                if not self.blocked and out:
                    self.db.execute("BEGIN")
                    self.db.executemany(f"INSERT OR REPLACE INTO {table}(mid,ts,n,avg,mn,mx,p95) VALUES (?,?,?,?,?,?,?)", out)
                    self.db.execute("COMMIT")
                    written += len(out)
                done = chunk_end
                self.set_meta(key, done)
        return written

    # ---- retention / cap --------------------------------------------------------------------------------
    def prune(self, now: float) -> dict:
        c = self.cfg
        cut = {
            "raw": now - c["raw_retention_h"] * 3600,
            "r5": now - c["rollup5_retention_d"] * 86400,
            "r1h": now - c["rollup1h_retention_d"] * 86400,
        }
        deleted = {}
        for t, table in (("raw", "raw"), ("r5", "r5"), ("r1h", "r1h")):
            cur = self.db.execute(f"DELETE FROM {table} WHERE ts < ?", (int(cut[t]),))
            deleted[t] = cur.rowcount
        lim = int(self.cfg.get("alert_history_limit", 5000))
        self.db.execute("DELETE FROM alert_events WHERE id <= (SELECT IFNULL(MAX(id),0) FROM alert_events) - ?", (lim,))
        self.db.execute("DELETE FROM config_snapshot WHERE ts NOT IN (SELECT ts FROM config_snapshot ORDER BY ts DESC LIMIT 20)")
        self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        self.db.execute("PRAGMA incremental_vacuum(2000)").fetchall()
        return deleted

    def enforce_cap(self, now: float) -> list:
        """Hard size cap: prune oldest rollups first, then raw. Returns list of human-readable actions."""
        cap = self.cfg["max_db_bytes"]
        actions = []
        self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        for _ in range(60):
            size = self.db_bytes()
            if size <= cap:
                break
            for table in ("r1h", "r5", "raw"):
                n = self.db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                if n == 0:
                    continue
                k = max(n // 10, 1)  # drop the oldest 10% of that tier per step
                cutoff = self.db.execute(f"SELECT ts FROM {table} ORDER BY ts LIMIT 1 OFFSET ?", (k - 1,)).fetchone()[0]
                cur = self.db.execute(f"DELETE FROM {table} WHERE ts <= ?", (cutoff,))
                actions.append(f"cap: pruned {cur.rowcount} rows from {table} older than ts={cutoff}")
                break
            else:
                break
            self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            self.db.execute("PRAGMA incremental_vacuum").fetchall()
        if actions:
            self.add_event(now, "WARNING", "size_cap", f"database exceeded cap {cap} B; {len(actions)} prune step(s)")
        return actions

    def maintenance(self, now: float) -> dict:
        info = {"rolled": self.rollup(now), "pruned": self.prune(now)}
        info["cap_actions"] = self.enforce_cap(now)
        return info

    # ---- reading ----------------------------------------------------------------------------------------
    def metric_names(self, conn=None) -> list:
        c = conn or self.db
        return [r[0] for r in c.execute("SELECT name FROM metrics ORDER BY name")]

    def tier_for(self, start: float, now: float) -> str:
        if start >= now - self.cfg["raw_retention_h"] * 3600:
            return "raw"
        if start >= now - self.cfg["rollup5_retention_d"] * 86400:
            return "r5"
        return "r1h"

    def series(self, name: str, start: float, end: float, max_points: int = 400, conn=None):
        """Return (tier, step, [(ts, avg, mn, mx, p95), ...]) downsampled to <= max_points buckets."""
        c = conn or self.db
        r = c.execute("SELECT id FROM metrics WHERE name=?", (name,)).fetchone()
        if not r:
            return "raw", 0, []
        mid = r[0]
        tier = self.tier_for(start, end)
        res = TIERS[tier]
        step = max(res, -(-int(end - start) // max_points))
        step = -(-step // res) * res
        if tier == "raw":
            q = ("SELECT ts/?*?, AVG(v), MIN(v), MAX(v), NULL FROM raw WHERE mid=? AND ts>=? AND ts<? GROUP BY 1 ORDER BY 1")
        else:
            q = (f"SELECT ts/?*?, SUM(avg*n)/SUM(n), MIN(mn), MAX(mx), MAX(p95) FROM {tier} WHERE mid=? AND ts>=? AND ts<? GROUP BY 1 ORDER BY 1")
        rows = c.execute(q, (step, step, mid, int(start), int(end))).fetchall()
        return tier, step, rows

    def points_5m(self, names, start: float, end: float, conn=None) -> dict:
        """5-minute resolution points per metric for capacity windows: r5 rows, plus raw for the not-yet-rolled tail."""
        c = conn or self.db
        out = {n: [] for n in names}
        done = c.execute("SELECT v FROM meta WHERE k='r5_done'").fetchone()
        done = int(done[0]) if done else int(start)
        for n in names:
            r = c.execute("SELECT id FROM metrics WHERE name=?", (n,)).fetchone()
            if not r:
                continue
            mid = r[0]
            for ts, cnt, avg, mn, mx, p95 in c.execute("SELECT ts,n,avg,mn,mx,p95 FROM r5 WHERE mid=? AND ts>=? AND ts<? ORDER BY ts", (mid, int(start), min(done, int(end)))):
                out[n].append({"ts": ts, "n": cnt, "avg": avg, "mn": mn, "mx": mx, "p95": p95})
            buckets = {}
            for ts, v in c.execute("SELECT ts, v FROM raw WHERE mid=? AND ts>=? AND ts<=? ORDER BY ts", (mid, max(done, int(start)), int(end))):
                buckets.setdefault(ts // 300 * 300, []).append(v)
            for b in sorted(buckets):
                vs = buckets[b]
                out[n].append({"ts": b, "n": len(vs), "avg": sum(vs) / len(vs), "mn": min(vs), "mx": max(vs), "p95": percentile(vs, 95)})
        return out

    def latest(self, conn=None) -> dict:
        """Most recent raw value per metric."""
        c = conn or self.db
        rows = c.execute("SELECT m.name, r.v, MAX(r.ts) FROM raw r JOIN metrics m ON m.id=r.mid GROUP BY r.mid").fetchall()
        return {n: (v, ts) for n, v, ts in rows}

    def recent_raw(self, since: float) -> dict:
        """name -> list of (ts, v) since `since` (used to warm in-memory alert windows after a restart)."""
        out = {}
        for n, ts, v in self.db.execute("SELECT m.name, r.ts, r.v FROM raw r JOIN metrics m ON m.id=r.mid WHERE r.ts>=? ORDER BY r.ts", (int(since),)):
            out.setdefault(n, []).append((ts, v))
        return out

    # ---- alerts / config --------------------------------------------------------------------------------
    def save_alert_state(self, key: str, state: dict):
        self.db.execute("INSERT OR REPLACE INTO alert_state(key,json) VALUES (?,?)", (key, json.dumps(state)))

    def load_alert_states(self) -> dict:
        return {k: json.loads(j) for k, j in self.db.execute("SELECT key,json FROM alert_state")}

    def add_alert_event(self, ts, key, rule, scope, severity, kind, message):
        self.db.execute("INSERT INTO alert_events(ts,key,rule,scope,severity,kind,message) VALUES (?,?,?,?,?,?,?)",
                        (int(ts), key, rule, scope, severity, kind, message[:500]))

    def alert_history(self, limit=200, conn=None):
        c = conn or self.db
        return c.execute("SELECT ts,rule,scope,severity,kind,message FROM alert_events ORDER BY id DESC LIMIT ?", (int(limit),)).fetchall()

    def snapshot_config(self, now: float, redacted_cfg: dict):
        blob = json.dumps(redacted_cfg, sort_keys=True)
        sha = hashlib.sha256(blob.encode()).hexdigest()[:16]
        last = self.db.execute("SELECT sha FROM config_snapshot ORDER BY ts DESC LIMIT 1").fetchone()
        if not last or last[0] != sha:
            self.db.execute("INSERT OR REPLACE INTO config_snapshot(ts,sha,json) VALUES (?,?,?)", (int(now), sha, blob))
        return sha
