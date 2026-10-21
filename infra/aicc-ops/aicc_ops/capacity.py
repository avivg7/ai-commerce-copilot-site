"""Capacity engine: pure functions turning rollup windows into HEALTHY / WATCH / UPGRADE RECOMMENDED.

INFORMATIONAL ONLY. It never calls any API, never resizes anything, never alerts by itself.
Thresholds are PROPOSED defaults (config [capacity]) to be validated on staging; they are not production-proven.

Input points are 5-minute rollup points: {"ts","n","avg","mn","mx","p95"}. "p95" below always means the 95th
percentile of the 5-minute AVERAGES in the window (spike-resistant, i.e. sustained load), while "peak" is the max
of 5-minute maxima. A single short spike therefore cannot, on its own, produce an upgrade recommendation."""
from __future__ import annotations

from .util import percentile, fmt_capacity, GIB, MIB

HEALTHY, WATCH, UPGRADE = "HEALTHY", "WATCH", "UPGRADE RECOMMENDED"
DISCLAIMER = ("Informational only: this view never resizes anything or calls any API. Thresholds are proposed "
              "defaults pending validation on staging.")
MIN_POINTS = 12  # 1 hour of 5-minute points before a window is considered meaningful


def _avgs(pts):
    return [p["avg"] for p in pts if p.get("avg") is not None]


def p95_of_avgs(pts):
    return percentile(_avgs(pts), 95)


def peak(pts, key="mx"):
    vs = [p[key] for p in pts if p.get(key) is not None]
    return max(vs) if vs else None


def count_runs(flags):
    """Number of separate runs of consecutive True flags."""
    runs, prev = 0, False
    for f in flags:
        if f and not prev:
            runs += 1
        prev = f
    return runs


def longest_run(flags):
    best = cur = 0
    for f in flags:
        cur = cur + 1 if f else 0
        best = max(best, cur)
    return best


def days_with(pts, pred):
    return len({p["ts"] // 86400 for p in pts if pred(p)})


def sustained_days(pts, thr, min_points):
    """UTC days on which `avg > thr` held for >= min_points consecutive 5-minute points."""
    by_day = {}
    for p in sorted(pts, key=lambda x: x["ts"]):
        by_day.setdefault(p["ts"] // 86400, []).append(p["avg"] is not None and p["avg"] > thr)
    return sum(1 for flags in by_day.values() if longest_run(flags) >= min_points)


def _add(reasons, level, code, window, text):
    reasons.append({"level": level, "code": code, "window": window, "text": text})


def evaluate(windows: dict, cfg: dict, ctx: dict | None = None) -> dict:
    """windows: {"24h": {metric: [points]}, "7d": {...}}; ctx: {"mem_total": bytes, "vcpus": n}."""
    ctx = ctx or {}
    reasons, figures = [], []
    mem_total = ctx.get("mem_total") or 0
    vcpus = ctx.get("vcpus") or 1
    npts = {w: len(windows.get(w, {}).get("mem.used_pct", [])) for w in ("24h", "7d")}
    if max(npts.values() or [0]) < MIN_POINTS:
        figures.append({"label": "History", "window": "-", "text": f"insufficient history ({max(npts.values())} five-minute points); verdict is provisional"})

    for w in ("24h", "7d"):
        d = windows.get(w, {})
        # ---- RAM -----------------------------------------------------------------------------------------
        ram = d.get("mem.used_pct", [])
        if ram:
            p95, pk = p95_of_avgs(ram), peak(ram)
            if mem_total:
                figures.append({"label": "RAM p95", "window": w, "text": fmt_capacity(p95 / 100 * mem_total, mem_total)})
                figures.append({"label": "RAM peak", "window": w, "text": fmt_capacity(pk / 100 * mem_total, mem_total)})
            else:
                figures.append({"label": "RAM p95 / peak", "window": w, "text": f"{p95:.0f}% / {pk:.0f}%"})
            if p95 >= cfg["upgrade_ram_p95_pct"]:
                _add(reasons, UPGRADE, "ram_p95", w, f"RAM p95 {p95:.0f}% >= {cfg['upgrade_ram_p95_pct']:.0f}% ({w})")
            elif p95 >= cfg["watch_ram_p95_pct"]:
                _add(reasons, WATCH, "ram_p95", w, f"RAM p95 {p95:.0f}% >= {cfg['watch_ram_p95_pct']:.0f}% ({w})")
        avail = d.get("mem.available_bytes", [])
        if avail:
            thr = cfg["upgrade_min_available_mib"] * MIB
            episodes = count_runs([p["mn"] is not None and p["mn"] < thr for p in sorted(avail, key=lambda x: x["ts"])])
            lo = min((p["mn"] for p in avail if p["mn"] is not None), default=None)
            if lo is not None:
                figures.append({"label": "Min available RAM", "window": w, "text": f"{lo / MIB:.0f} MiB ({episodes} episode(s) < {cfg['upgrade_min_available_mib']} MiB)"})
            if episodes >= cfg["upgrade_min_available_episodes"]:
                _add(reasons, UPGRADE, "ram_min_available", w, f"available RAM fell below {cfg['upgrade_min_available_mib']} MiB in {episodes} separate episodes ({w})")
        # ---- swap ----------------------------------------------------------------------------------------
        sw = d.get("swap.in_pps", [])
        if sw:
            if any(p["avg"] is not None and p["avg"] >= cfg["watch_swap_in_pps"] for p in sw):
                _add(reasons, WATCH, "swap_in_present", w, f"swap-in activity present ({w}), peak {peak(sw):.0f} pages/s")
            need_pts = max(int(cfg["upgrade_swap_sustained_min"] // 5), 1)
            days = sustained_days(sw, cfg["upgrade_swap_in_pps"], need_pts)
            figures.append({"label": "Swap-in sustained days", "window": w, "text": f"{days} day(s) with > {cfg['upgrade_swap_in_pps']:.0f} pages/s for >= {cfg['upgrade_swap_sustained_min']} min"})
            if days >= cfg["upgrade_swap_days"]:
                _add(reasons, UPGRADE, "swap_in_sustained", w, f"sustained swap-in > {cfg['upgrade_swap_in_pps']:.0f} pages/s for >= {cfg['upgrade_swap_sustained_min']} min on {days} days ({w})")
        # ---- CPU / load -----------------------------------------------------------------------------------
        cpu = d.get("cpu.used_pct", [])
        if cpu:
            p95, pk = p95_of_avgs(cpu), peak(cpu)
            figures.append({"label": f"CPU p95 ({vcpus} vCPU)", "window": w, "text": f"{p95:.0f}% (peak {pk:.0f}%)"})
            if p95 >= cfg["upgrade_cpu_p95_pct"]:
                _add(reasons, UPGRADE, "cpu_p95", w, f"CPU p95 {p95:.0f}% >= {cfg['upgrade_cpu_p95_pct']:.0f}% sustained ({w})")
            elif p95 >= cfg["watch_cpu_p95_pct"]:
                _add(reasons, WATCH, "cpu_p95", w, f"CPU p95 {p95:.0f}% >= {cfg['watch_cpu_p95_pct']:.0f}% ({w})")
        ld = d.get("load.per_vcpu", [])
        if ld:
            p95 = p95_of_avgs(ld)
            figures.append({"label": "Load per vCPU p95", "window": w, "text": f"{p95:.2f}"})
            if p95 >= cfg["upgrade_load_per_vcpu"]:
                _add(reasons, UPGRADE, "load", w, f"load per vCPU p95 {p95:.2f} >= {cfg['upgrade_load_per_vcpu']} ({w})")
            elif p95 >= cfg["watch_load_per_vcpu"]:
                _add(reasons, WATCH, "load", w, f"load per vCPU p95 {p95:.2f} >= {cfg['watch_load_per_vcpu']} ({w})")
        # ---- PHP-FPM --------------------------------------------------------------------------------------
        reached = d.get("fpm.max_children_reached_delta", [])
        if reached:
            days = days_with(reached, lambda p: p["mx"] is not None and p["mx"] > 0)
            figures.append({"label": "PHP-FPM max_children reached", "window": w, "text": f"on {days} separate day(s)"})
            if days >= cfg["upgrade_fpm_reached_days"]:
                _add(reasons, UPGRADE, "fpm_reached", w, f"PHP-FPM max_children reached on {days} separate days ({w})")
            elif days > 0:
                _add(reasons, WATCH, "fpm_reached", w, f"PHP-FPM max_children reached on {days} day(s) ({w})")
        ratio = d.get("fpm.active_ratio", [])
        if ratio:
            p95 = p95_of_avgs(ratio)
            figures.append({"label": "PHP-FPM active/total p95", "window": w, "text": f"{p95:.2f}"})
            if p95 >= cfg["watch_fpm_ratio"]:
                _add(reasons, WATCH, "fpm_ratio", w, f"PHP-FPM active/total p95 {p95:.2f} >= {cfg['watch_fpm_ratio']} ({w})")
        lq = d.get("fpm.listen_queue", [])
        if lq and any(p["mx"] and p["mx"] > 0 for p in lq):
            _add(reasons, WATCH, "fpm_queue", w, f"PHP-FPM listen queue non-empty ({w})")
        # ---- database connections -------------------------------------------------------------------------
        cp = d.get("mysql.conn_pressure_pct", [])
        if cp:
            p95 = p95_of_avgs(cp)
            figures.append({"label": "DB connections p95", "window": w, "text": f"{p95:.0f}% of max_connections"})
            if p95 >= cfg["upgrade_db_conn_pct"]:
                _add(reasons, UPGRADE, "db_conn", w, f"DB connection pressure p95 {p95:.0f}% >= {cfg['upgrade_db_conn_pct']:.0f}% ({w})")
            elif p95 >= cfg["watch_db_conn_pct"]:
                _add(reasons, WATCH, "db_conn", w, f"DB connection pressure p95 {p95:.0f}% >= {cfg['watch_db_conn_pct']:.0f}% ({w})")
        # ---- latency (dynamic routes when the handler label allows it) -------------------------------------
        lat_name = "caddy.dyn_lat_p95_ms" if d.get("caddy.dyn_lat_p95_ms") else "caddy.lat_p95_ms"
        lat = sorted(d.get(lat_name, []), key=lambda p: p["ts"])
        rps = {p["ts"]: p["avg"] for p in d.get("caddy.req_rate", [])}
        if lat:
            q = [p for p in lat if rps.get(p["ts"], cfg["latency_min_rps"]) >= cfg["latency_min_rps"]]
            if q:
                p95 = p95_of_avgs(q)
                kind = "dynamic" if lat_name.startswith("caddy.dyn") else "all-route"
                figures.append({"label": f"HTTP latency p95 ({kind})", "window": w, "text": f"{p95:.0f} ms"})
                flags = [p["avg"] > cfg["upgrade_latency_ms"] for p in q]
                if longest_run(flags) >= cfg["latency_sustain_points"]:
                    _add(reasons, UPGRADE, "latency", w, f"p95 latency > {cfg['upgrade_latency_ms'] / 1000:.1f} s sustained for >= {cfg['latency_sustain_points'] * 5} min ({w})")
                elif p95 > cfg["watch_latency_ms"]:
                    _add(reasons, WATCH, "latency", w, f"p95 latency {p95:.0f} ms > {cfg['watch_latency_ms']:.0f} ms ({w})")
        # ---- traffic (informational) ----------------------------------------------------------------------
        tr = d.get("caddy.req_rate", [])
        if tr:
            figures.append({"label": "Traffic p95 / peak", "window": w, "text": f"{p95_of_avgs(tr):.2f} / {peak(tr):.2f} req/s"})

    seen, dedup = set(), []
    for r in reasons:  # keep one entry per (level, code, window)
        k = (r["level"], r["code"], r["window"])
        if k not in seen:
            seen.add(k)
            dedup.append(r)
    verdict = UPGRADE if any(r["level"] == UPGRADE for r in dedup) else WATCH if dedup else HEALTHY
    notes = []
    if ctx.get("reboot_required"):
        notes.append("A host reboot is pending (installed updates are not active yet). The figures above describe the running kernel and libraries; plan a maintenance window. This note never changes the verdict.")
    return {"verdict": verdict, "reasons": dedup, "figures": figures, "disclaimer": DISCLAIMER, "notes": notes}
