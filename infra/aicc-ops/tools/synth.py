"""Deterministic synthetic metric samples with a realistic metric SET (about 140 series) for storage sizing and demos.
FIXTURE DATA ONLY: nothing here reflects a real server."""
import math
import random

UNITS = ("aicc_edge", "php8_3_fpm", "mysql", "fail2ban")
CP = ("registrations", "login_success", "login_failure", "checkout_start", "order_completed", "refund", "license_issued",
      "license_lifecycle_failure", "store_connection", "password_reset_failure")


def busy(t, rng, scale=1.0):
    day = 0.5 + 0.5 * math.sin((t % 86400) / 86400 * 2 * math.pi - 1.8)
    weekly = 0.85 + 0.15 * math.sin(t / 604800 * 2 * math.pi)
    burst = 0.35 if rng.random() < 0.004 else 0.0
    return max(0.02, min(1.0, (0.10 + 0.35 * day * weekly + rng.random() * 0.05 + burst) * scale))


def sample(t, rng, state, scale=1.0):
    L = busy(t, rng, scale)
    used = 0.48 + 0.22 * L + 0.02 * math.sin(t / 3600)
    total = 2035944 * 1024
    m = {"cpu.vcpus": 1, "cpu.used_pct": 100 * L * 0.9, "cpu.iowait_pct": L * 2, "cpu.steal_pct": L * 0.3,
         "load.1": 0.2 + 1.2 * L, "load.5": 0.2 + 1.0 * L, "load.15": 0.2 + 0.9 * L, "load.per_vcpu": 0.2 + 1.2 * L,
         "mem.total_bytes": total, "mem.available_bytes": total * (1 - used), "mem.used_bytes": total * used, "mem.used_pct": used * 100,
         "swap.total_bytes": 2147483648, "swap.used_bytes": 2147483648 * max(0.01, (used - 0.55)), "swap.used_pct": 100 * max(0.01, (used - 0.55)),
         "swap.in_pps": max(0, (used - 0.74)) * 400 if rng.random() < 0.3 else 0, "swap.out_pps": max(0, (used - 0.74)) * 500,
         "disk.root.total_bytes": 53687091200, "disk.root.used_bytes": 12e9 + t % 1e7, "disk.root.used_pct": 22 + (t % 1e7) / 1e8, "disk.root.inodes_used_pct": 6.1,
         "io.read_bps": 2e5 * L, "io.write_bps": 8e5 * (0.2 + L), "io.util_pct": 3 + 25 * L, "net.rx_bps": 4e4 * (0.3 + L), "net.tx_bps": 1.5e5 * (0.3 + L),
         "uptime.seconds": t % 1e7}
    for u in UNITS:
        m.update({f"svc.{u}.active": 1, f"svc.{u}.failed": 0, f"svc.{u}.present": 1, f"svc.{u}.restarts": 0 if u != "php8_3_fpm" else int(t % 5e6 > 4e6), f"svc.{u}.uptime_s": t % 3e6})
    rate = 0.5 + 6 * L
    m.update({"caddy.up": 1, "caddy.in_flight": rng.randint(0, 3), "caddy.upstream_healthy_min": 1, "caddy.upstream_count": 1,
              "caddy.rate_2xx": rate * 0.86, "caddy.rate_3xx": rate * 0.07, "caddy.rate_4xx": rate * 0.06, "caddy.rate_5xx": rate * 0.0006, "caddy.rate_other": 0,
              "caddy.req_rate": rate, "caddy.resp_bytes_ps": rate * 4e4, "caddy.req_bytes_ps": rate * 1500,
              "caddy.lat_p50_ms": 8 + 30 * L, "caddy.lat_p95_ms": 90 + 700 * L * L, "caddy.lat_p99_ms": 200 + 1500 * L * L,
              "caddy.dyn_lat_p50_ms": 60 + 200 * L, "caddy.dyn_lat_p95_ms": 250 + 1400 * L * L, "caddy.dyn_lat_p99_ms": 600 + 2500 * L * L})
    act = int(1 + 5 * L)
    reached = 1 if (L > 0.8 and rng.random() < 0.1) else 0
    state["reached"] = state.get("reached", 0) + reached
    m.update({"fpm.up": 1, "fpm.active": act, "fpm.idle": 3, "fpm.total": act + 3, "fpm.listen_queue": 0, "fpm.max_listen_queue": 2, "fpm.max_active": 6,
              "fpm.active_ratio": act / 8, "fpm.max_children_reached": state["reached"], "fpm.max_children_reached_delta": reached,
              "fpm.slow_requests": state["reached"] * 2, "fpm.slow_requests_delta": reached * 2})
    thr = 4 + 8 * L
    m.update({"mysql.up": 1, "mysql.threads_connected": thr, "mysql.threads_running": 1 + 3 * L, "mysql.max_used_connections": 19, "mysql.uptime_s": t % 1e7,
              "mysql.max_connections": 151, "mysql.db_size_bytes": 73400320 + t % 1e6, "mysql.conn_pressure_pct": 100 * thr / 151,
              "mysql.slow_queries_delta": 1 if rng.random() < 0.05 else 0, "mysql.aborted_connects_delta": 0, "mysql.qps": 20 + 200 * L})
    for k in CP:
        m[f"cp.{k}_per_min"] = rng.random() * L * (3 if k in ("login_success",) else 0.5)
    for k in ("login_failure", "license_lifecycle_failure", "store_connection", "order_completed", "registrations"):
        for r in ("a", "b"):
            m[f"cp.{k}.r.{r}_per_min"] = rng.random() * 0.1
    m.update({"cp.order_per_checkout_ratio": 0.08, "cp.table_present": 1, "cp.action_scheduler_pending": 3 + 4 * L, "cp.action_scheduler_failed": 0, "cp.wc_cron_last_run_age_seconds": 30 + rng.random() * 120})
    m.update({"backup.dir_present": 1, "backup.count": 7, "backup.newest_age_s": t % 86400 + 3600, "backup.newest_size_bytes": 3e7, "backup.status_ok": 1, "backup.status_age_s": t % 86400 + 3600,
              "cert.ok": 1, "cert.days_left": 60 - (t % 5e6) / 86400, "edge.up": 1, "edge.status": 200, "edge.latency_ms": 12 + 30 * L})
    for c in ("host", "caddy", "phpfpm", "mysql", "cp", "backups", "cert", "edge"):
        m[f"collector.{c}.ok"] = 1
        m[f"collector.{c}.duration_ms"] = 5 + rng.random() * 20
    m.update({"ops.rss_bytes": 28e6 + rng.random() * 1e6, "ops.db_bytes": 5e7, "ops.cycle_ms": 30 + rng.random() * 40, "ops.fs_free_pct": 55, "ops.write_blocked": 0})
    return m


def make_rng(seed=7):
    return random.Random(seed)
