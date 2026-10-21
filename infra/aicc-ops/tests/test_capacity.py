import unittest

from aicc_ops import capacity as cap
from aicc_ops.config import DEFAULTS
from aicc_ops.util import fmt_capacity, GIB, MIB

CFG = DEFAULTS["capacity"]
DAY0 = 1_760_000_000 // 86400 * 86400
TOTAL = 2 * GIB


def pts(days, f, step=300):
    """Synthetic 5-minute points; f(t_index, ts) -> value or (avg, mn, mx)."""
    out = []
    n = int(days * 86400 / step)
    for i in range(n):
        ts = DAY0 + i * step
        v = f(i, ts)
        avg, mn, mx = v if isinstance(v, tuple) else (v, v, v)
        out.append({"ts": ts, "n": 10, "avg": avg, "mn": mn, "mx": mx, "p95": mx})
    return out


def windows(metrics7, days7=7):
    """Slice 7d series into the trailing 24 h window too."""
    w7 = {k: v for k, v in metrics7.items()}
    w24 = {}
    for k, v in metrics7.items():
        cutoff = v[-1]["ts"] - 86400
        w24[k] = [p for p in v if p["ts"] >= cutoff]
    return {"24h": w24, "7d": w7}


def base(**over):
    m = {"mem.used_pct": pts(7, lambda i, t: 50.0), "cpu.used_pct": pts(7, lambda i, t: 20.0),
         "swap.in_pps": pts(7, lambda i, t: 0.0), "mem.available_bytes": pts(7, lambda i, t: 900 * MIB),
         "fpm.max_children_reached_delta": pts(7, lambda i, t: 0.0), "fpm.active_ratio": pts(7, lambda i, t: 0.2),
         "caddy.dyn_lat_p95_ms": pts(7, lambda i, t: 300.0), "caddy.req_rate": pts(7, lambda i, t: 1.0),
         "mysql.conn_pressure_pct": pts(7, lambda i, t: 10.0), "load.per_vcpu": pts(7, lambda i, t: 0.3)}
    m.update(over)
    return m


def verdict(m):
    return cap.evaluate(windows(m), CFG, {"mem_total": TOTAL, "vcpus": 1})


def codes(r, level=None):
    return {x["code"] for x in r["reasons"] if level is None or x["level"] == level}


class FormatTests(unittest.TestCase):
    def test_capacity_format(self):
        self.assertEqual(fmt_capacity(1.3 * GIB, 2.0 * GIB), "1.3 GiB / 2.0 GiB — 65%")


class VerdictTests(unittest.TestCase):
    def test_healthy(self):
        r = verdict(base())
        self.assertEqual(r["verdict"], cap.HEALTHY)
        self.assertEqual(r["reasons"], [])
        self.assertIn("Informational only", r["disclaimer"])

    def test_reboot_pending_is_a_note_not_a_verdict(self):
        """Architecture review M-2: a pending reboot is shown on the capacity page and never changes the verdict."""
        r = cap.evaluate(base(), CFG, {"mem_total": TOTAL, "vcpus": 1, "reboot_required": True})
        self.assertEqual(r["verdict"], cap.HEALTHY)
        self.assertEqual(r["reasons"], [])
        self.assertEqual(len(r["notes"]), 1)
        self.assertIn("reboot is pending", r["notes"][0])
        self.assertEqual(cap.evaluate(base(), CFG, {"mem_total": TOTAL, "vcpus": 1})["notes"], [])

    def test_watch_ram(self):
        r = verdict(base(**{"mem.used_pct": pts(7, lambda i, t: 78.0)}))
        self.assertEqual(r["verdict"], cap.WATCH)
        self.assertIn("ram_p95", codes(r, cap.WATCH))

    def test_upgrade_ram_p95(self):
        r = verdict(base(**{"mem.used_pct": pts(7, lambda i, t: 88.0)}))
        self.assertEqual(r["verdict"], cap.UPGRADE)
        self.assertIn("ram_p95", codes(r, cap.UPGRADE))
        self.assertTrue(any("GiB / 2.0 GiB" in f["text"] for f in r["figures"] if f["label"] == "RAM p95"))

    def test_upgrade_min_available_twice_but_not_once(self):
        def avail(episodes):
            starts = {50 + 400 * k for k in range(episodes)}
            return pts(7, lambda i, t: (900 * MIB, 100 * MIB, 900 * MIB) if i in starts else 900 * MIB)
        self.assertEqual(verdict(base(**{"mem.available_bytes": avail(1)}))["verdict"], cap.HEALTHY)
        r = verdict(base(**{"mem.available_bytes": avail(2)}))
        self.assertEqual(r["verdict"], cap.UPGRADE)
        self.assertIn("ram_min_available", codes(r))

    def test_ram_spike_is_not_sustained(self):
        # one 5-minute point at 99% in 7 days must not move the p95 of 5-minute averages
        r = verdict(base(**{"mem.used_pct": pts(7, lambda i, t: 99.0 if i == 500 else 50.0)}))
        self.assertEqual(r["verdict"], cap.HEALTHY)
        peak = [f for f in r["figures"] if f["label"] == "RAM peak" and f["window"] == "7d"]
        self.assertIn("99%", peak[0]["text"])  # the spike is still reported as a peak

    def test_cpu_sustained_vs_spike(self):
        spike = verdict(base(**{"cpu.used_pct": pts(7, lambda i, t: 100.0 if i < 6 else 20.0)}))  # 30 minutes only
        self.assertEqual(spike["verdict"], cap.HEALTHY)
        busy = verdict(base(**{"cpu.used_pct": pts(7, lambda i, t: 90.0 if (i % 288) < 40 else 20.0)}))  # ~14% of every day
        self.assertEqual(busy["verdict"], cap.UPGRADE)
        self.assertIn("cpu_p95", codes(busy, cap.UPGRADE))
        watch = verdict(base(**{"cpu.used_pct": pts(7, lambda i, t: 75.0)}))
        self.assertEqual(watch["verdict"], cap.WATCH)

    def test_swap_sustained_days(self):
        def swap(days_with):
            return pts(7, lambda i, t: 120.0 if (i // 288) < days_with and (i % 288) < 4 else 0.0)  # 20 min bursts
        three = verdict(base(**{"swap.in_pps": swap(3)}))
        self.assertEqual(three["verdict"], cap.UPGRADE)
        self.assertIn("swap_in_sustained", codes(three))
        two = verdict(base(**{"swap.in_pps": swap(2)}))
        self.assertEqual(two["verdict"], cap.WATCH)  # present but not on >= 3 days
        self.assertIn("swap_in_present", codes(two))
        short = verdict(base(**{"swap.in_pps": pts(7, lambda i, t: 500.0 if (i % 288) == 3 else 0.0)}))  # 5-min bursts only
        self.assertNotIn("swap_in_sustained", codes(short))

    def test_fpm_max_children_days(self):
        def reached(days_with):
            return pts(7, lambda i, t: (0.0, 0.0, 2.0) if (i % 288) == 10 and (i // 288) < days_with else 0.0)
        self.assertEqual(verdict(base(**{"fpm.max_children_reached_delta": reached(3)}))["verdict"], cap.UPGRADE)
        r = verdict(base(**{"fpm.max_children_reached_delta": reached(1)}))
        self.assertEqual(r["verdict"], cap.WATCH)

    def test_latency_sustained_vs_single_slow_window(self):
        sustained = verdict(base(**{"caddy.dyn_lat_p95_ms": pts(7, lambda i, t: 2500.0 if 100 <= i < 110 else 300.0)}))  # 50 min
        self.assertEqual(sustained["verdict"], cap.UPGRADE)
        self.assertIn("latency", codes(sustained, cap.UPGRADE))
        blip = verdict(base(**{"caddy.dyn_lat_p95_ms": pts(7, lambda i, t: 5000.0 if i in (100, 150, 200) else 300.0)}))
        self.assertEqual(blip["verdict"], cap.HEALTHY)
        watch = verdict(base(**{"caddy.dyn_lat_p95_ms": pts(7, lambda i, t: 1700.0)}))
        self.assertEqual(watch["verdict"], cap.WATCH)

    def test_latency_ignored_without_traffic(self):
        r = verdict(base(**{"caddy.dyn_lat_p95_ms": pts(7, lambda i, t: 4000.0), "caddy.req_rate": pts(7, lambda i, t: 0.001)}))
        self.assertNotIn("latency", codes(r))

    def test_fpm_ratio_and_db_connections(self):
        self.assertEqual(verdict(base(**{"fpm.active_ratio": pts(7, lambda i, t: 0.85)}))["verdict"], cap.WATCH)
        self.assertEqual(verdict(base(**{"mysql.conn_pressure_pct": pts(7, lambda i, t: 75.0)}))["verdict"], cap.WATCH)
        self.assertEqual(verdict(base(**{"mysql.conn_pressure_pct": pts(7, lambda i, t: 92.0)}))["verdict"], cap.UPGRADE)

    def test_load_per_vcpu(self):
        self.assertEqual(verdict(base(**{"load.per_vcpu": pts(7, lambda i, t: 1.8)}))["verdict"], cap.WATCH)
        self.assertEqual(verdict(base(**{"load.per_vcpu": pts(7, lambda i, t: 3.5)}))["verdict"], cap.UPGRADE)

    def test_24h_only_problem_is_caught_by_24h_window(self):
        def ram(i, t):
            return 90.0 if i >= 6 * 288 else 40.0  # only the last day is hot
        r = verdict(base(**{"mem.used_pct": pts(7, ram)}))
        self.assertEqual(r["verdict"], cap.UPGRADE)
        self.assertIn(("UPGRADE RECOMMENDED", "ram_p95", "24h"), {(x["level"], x["code"], x["window"]) for x in r["reasons"]})

    def test_insufficient_history_noted(self):
        r = cap.evaluate({"24h": {"mem.used_pct": pts(0.02, lambda i, t: 50.0)}, "7d": {}}, CFG, {"mem_total": TOTAL})
        self.assertTrue(any("insufficient history" in f["text"] for f in r["figures"]))

    def test_never_calls_anything(self):
        import aicc_ops.capacity as c
        with open(c.__file__) as fh:
            src = fh.read()
        for bad in ("urllib", "socket", "requests", "subprocess", "http.client"):
            self.assertNotIn(bad, src)


if __name__ == "__main__":
    unittest.main()
