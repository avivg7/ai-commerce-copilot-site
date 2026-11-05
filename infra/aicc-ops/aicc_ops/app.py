"""Runtime: collection loop, storage, alerting, notifications and the shared state the UI reads."""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import time

from . import capacity as cap
from .alerts import AlertEngine, Window, build_rules
from .collectors import build_collectors, run_collector
from .config import redact
from .store import Store
from .telegram import TelegramAdapter, render_digest

CAP_METRICS = ["mem.used_pct", "mem.available_bytes", "swap.in_pps", "cpu.used_pct", "load.per_vcpu",
               "fpm.max_children_reached_delta", "fpm.active_ratio", "fpm.listen_queue", "mysql.conn_pressure_pct",
               "caddy.dyn_lat_p95_ms", "caddy.lat_p95_ms", "caddy.req_rate"]
STALE = {"cert.": 3 * 3600 + 600, "backup.": 1500, "cp.": 400, "collector.": 3600, "ops.": 120}


def self_rss_bytes() -> float:
    try:
        with open("/proc/self/status") as fh:
            for line in fh:
                if line.startswith("VmRSS:"):
                    return float(line.split()[1]) * 1024
    except OSError:
        pass
    try:  # macOS / BSD fallback: current RSS in KiB via ps
        out = subprocess.run(["ps", "-o", "rss=", "-p", str(os.getpid())], capture_output=True, text=True, timeout=2).stdout
        return float(out.strip()) * 1024
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0.0


class Runtime:
    def __init__(self, cfg: dict, store: Store, telegram: TelegramAdapter | None = None, clock=time.time, log=None):
        self.cfg = cfg
        self.store = store
        self.telegram = telegram
        self.clock = clock
        self.log = log or (lambda m: print(m, file=sys.stderr, flush=True))
        self.collectors = build_collectors(cfg)
        iv = cfg["general"]["interval_s"]
        self.window = Window(iv, stale=STALE)
        a = cfg["alerts"]
        self.engine = AlertEngine(build_rules(cfg), store, a["flap_window_s"], a["flap_max_transitions"], a["enabled"],
                                  a["delivery_retry_s"], a["delivery_retry_max_s"], a["delivery_retry_max_attempts"])
        if telegram is not None:
            telegram.on_result = self.engine.report_delivery   # every queued message ends in a delivered / failed / dropped report that re-arms an alert that did not arrive
        self._latest: dict = {}
        self._errors: dict = {}
        self._lock = threading.Lock()
        self._cap_cache = (0.0, None)
        self._last_maint = 0.0
        self._db_bytes = 0.0
        self._last_cycle_ms = 0.0
        self._blocked_logged = False
        self.started = clock()
        self.cycles = 0
        # warm state after restart
        try:
            for name, rows in store.recent_raw(self.started - 3900).items():
                for ts, v in rows:
                    self.window.push(ts, {name: v})
            self.window.now = self.started
            with self._lock:
                for name, (v, ts) in store.latest().items():
                    self._latest[name] = (v, ts)
            store.snapshot_config(self.started, redact(cfg))
        except Exception as e:  # noqa: BLE001
            self.log(f"warm-start skipped: {type(e).__name__}")

    # ---- UI-facing
    def latest(self) -> dict:
        with self._lock:
            return dict(self._latest)

    def collector_errors(self) -> dict:
        with self._lock:
            return dict(self._errors)

    def capacity(self) -> dict:
        now = self.clock()
        with self._lock:
            ts, val = self._cap_cache
        if val is not None and now - ts < 60:
            return val
        conn = self.store.reader()
        try:
            w = {"24h": self.store.points_5m(CAP_METRICS, now - 86400, now, conn=conn),
                 "7d": self.store.points_5m(CAP_METRICS, now - 7 * 86400, now, conn=conn)}
        finally:
            conn.close()
        lt = self.latest()
        ctx = {"mem_total": (lt.get("mem.total_bytes") or (0,))[0], "vcpus": (lt.get("cpu.vcpus") or (1,))[0],
               "reboot_required": (lt.get("host.reboot_required") or (0,))[0] == 1}
        val = cap.evaluate(w, self.cfg["capacity"], ctx)
        with self._lock:
            self._cap_cache = (now, val)
        return val

    # ---- the loop
    def cycle(self, now: float | None = None) -> dict:
        t0 = time.monotonic()
        now = self.clock() if now is None else now
        merged: dict = {}
        errors: dict = {}
        for c in self.collectors:
            if now < c.next_due:
                continue
            c.next_due = now + c.interval - 0.5
            r = run_collector(c, self.cfg, now)
            for k, v in r.items():
                if k.startswith("_error."):
                    errors[k[7:]] = v
                else:
                    merged[k] = v
            if f"collector.{c.name}.ok" in r and r[f"collector.{c.name}.ok"] == 1:
                errors.pop(c.name, None)
        free = self.store.free_pct_fn(self.store.dir)
        blocked = free < self.cfg["storage"]["min_free_pct"]
        merged["ops.fs_free_pct"] = free
        merged["ops.write_blocked"] = 1.0 if blocked else 0.0
        merged["ops.rss_bytes"] = self_rss_bytes()
        merged["ops.cycle_ms"] = self._last_cycle_ms
        merged["ops.db_bytes"] = self._db_bytes or float(self.store.db_bytes())
        if self.telegram is not None:
            merged.update(self.telegram.metrics())
            merged["ops.telegram_abandoned"] = float(self.engine.abandoned_count())     # sent / failed / dropped / rate_limited counters and the last delivery / failure times (export.json, UI, telegram-status)
        if blocked:
            if not self._blocked_logged:
                self.log(f"CRITICAL: filesystem free space {free:.1f}% < {self.cfg['storage']['min_free_pct']}%: monitoring writes refused")
                self._blocked_logged = True
        else:
            self._blocked_logged = False
        try:
            self.store.write_sample(int(now), merged)
        except Exception as e:  # noqa: BLE001 - storage trouble must not kill the loop
            self.log(f"storage write failed: {type(e).__name__}: {e}")
        with self._lock:
            for k, v in merged.items():
                self._latest[k] = (v, now)
            for k, v in errors.items():
                self._errors[k] = v
            for k in [k for k in self._errors if k not in errors and merged.get(f"collector.{k}.ok") == 1]:
                self._errors.pop(k, None)
        self.window.push(now, merged)
        try:
            notes = self.engine.evaluate(self.window, now)
        except Exception as e:  # noqa: BLE001
            self.log(f"alert engine error: {type(e).__name__}")
            notes = []
        if self.telegram:
            for n in notes:
                self.telegram.submit(n)       # the outcome (delivered / failed / dropped) comes back through engine.report_delivery and is read by the next evaluation
        if now - self._last_maint >= self.cfg["storage"]["maintenance_interval_s"]:
            self._last_maint = now
            try:
                if not blocked:
                    self.store.maintenance(now)
                self._db_bytes = float(self.store.db_bytes())
            except Exception as e:  # noqa: BLE001
                self.log(f"maintenance failed: {type(e).__name__}: {e}")
        self.cycles += 1
        self._last_cycle_ms = (time.monotonic() - t0) * 1000.0
        return {"notifications": notes, "metrics": len(merged)}

    def run(self, stop: threading.Event):
        iv = self.cfg["general"]["interval_s"]
        nxt = time.monotonic()
        while not stop.is_set():
            self.cycle()
            nxt += iv
            delay = nxt - time.monotonic()
            if delay < 0:  # overran; do not burst
                nxt = time.monotonic()
                delay = 0
            stop.wait(delay)

    def digest_text(self) -> str:
        cv = self.capacity()
        lt = self.latest()
        lines = []
        for k, label in (("mem.used_pct", "RAM used"), ("cpu.used_pct", "CPU"), ("disk.root.used_pct", "Disk /")):
            if k in lt:
                lines.append(f"{label}: {lt[k][0]:.0f}%")
        act = self.engine.active()
        lines.append(f"Active alerts: {len(act)}")
        lines += [f"- {a['severity']} {a['title']} ({a['scope']})" for a in act[:5]]
        lines += [f"- {r['text']}" for r in cv["reasons"][:4]]
        return render_digest(self.cfg["general"]["host_label"], cv["verdict"], lines)
