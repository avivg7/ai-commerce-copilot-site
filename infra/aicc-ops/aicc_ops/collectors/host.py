"""Host collector: /proc, statvfs, cgroup limits and systemd unit state.

Every section is isolated: a failing section is reported but the others still produce metrics."""
from __future__ import annotations

import os
import re
import subprocess
import time
from pathlib import Path

from . import CollectorError, Result
from ..util import safe_name

WHOLE_DISK_RE = re.compile(r"^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)$")


# ---- parsers (pure; unit-tested against fixtures) -------------------------------------------------------
def parse_meminfo(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        m = re.match(r"^([A-Za-z_()0-9]+):\s+(\d+)(?:\s*kB)?", line)
        if m:
            out[m.group(1)] = int(m.group(2)) * (1024 if "kB" in line else 1)
    return out


def parse_stat_cpu(text: str):
    for line in text.splitlines():
        if line.startswith("cpu "):
            vals = [int(x) for x in line.split()[1:]]
            vals += [0] * (8 - len(vals))
            user, nice, system, idle, iowait, irq, softirq, steal = vals[:8]
            total = user + nice + system + idle + iowait + irq + softirq + steal
            return {"total": total, "idle": idle + iowait, "iowait": iowait, "steal": steal}
    raise CollectorError("no aggregate cpu line in /proc/stat")


def parse_loadavg(text: str):
    p = text.split()
    return float(p[0]), float(p[1]), float(p[2])


def parse_vmstat(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        k, _, v = line.partition(" ")
        if k in ("pswpin", "pswpout"):
            out[k] = int(v)
    return out


def parse_diskstats(text: str) -> dict:
    """Aggregate whole-disk devices: sectors read/written and ms spent doing IO."""
    devs = {}
    for line in text.splitlines():
        f = line.split()
        if len(f) < 14 or not WHOLE_DISK_RE.match(f[2]):
            continue
        devs[f[2]] = {"rd_sectors": int(f[5]), "wr_sectors": int(f[9]), "io_ms": int(f[12])}
    return devs


def parse_netdev(text: str) -> dict:
    out = {}
    for line in text.splitlines()[2:]:
        if ":" not in line:
            continue
        name, data = line.split(":", 1)
        f = data.split()
        if len(f) >= 9:
            out[name.strip()] = {"rx": int(f[0]), "tx": int(f[8])}
    return out


def parse_default_iface(route_text: str):
    for line in route_text.splitlines()[1:]:
        f = line.split()
        if len(f) >= 8 and f[1] == "00000000" and int(f[7], 16) == 0:
            return f[0]
    return None


def parse_uptime(text: str) -> float:
    return float(text.split()[0])


def count_cpus(cpuinfo_text: str) -> int:
    n = len(re.findall(r"^processor\s*:", cpuinfo_text, re.M))
    return n or (os.cpu_count() or 1)


def parse_cgroup_cpu_max(text: str):
    """cgroup v2 cpu.max: '<quota|max> <period>'. Returns vCPU limit or None."""
    p = text.split()
    if len(p) == 2 and p[0] != "max":
        return int(p[0]) / int(p[1])
    return None


def parse_systemctl_show(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        k, _, v = line.partition("=")
        if k:
            out[k.strip()] = v.strip()
    return out


def parse_systemd_ts(val: str):
    """`Tue 2026-10-20 10:00:00 UTC` -> epoch seconds (UTC assumed when zone is UTC/empty)."""
    m = re.search(r"(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})", val or "")
    if not m:
        return None
    import calendar
    return calendar.timegm(tuple(int(x) for x in m.groups()) + (0, 0, 0))


# ---- collection -----------------------------------------------------------------------------------------
def _read(root: Path, rel: str) -> str:
    return (root / rel).read_text()


def _rate(cur, prev, dt):
    d = cur - prev
    if d < 0 or dt <= 0:  # counter reset / bad clock
        return None
    return d / dt


def collect(full_cfg, cfg, state, now) -> Result:
    root = Path(full_cfg["general"]["proc_root"])
    res = Result()
    m = res.metrics
    prev_ts = state.get("ts")
    dt = (now - prev_ts) if prev_ts else 0
    state["ts"] = now

    def section(name, fn):
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            res.errors.append(f"{name}: {type(e).__name__}: {e}")

    # CPU allocation
    vcpus = {"v": 1}

    def cpu_alloc():
        try:
            vcpus["v"] = count_cpus(_read(root, "cpuinfo"))
        except OSError:
            vcpus["v"] = os.cpu_count() or 1
        limit = None
        p = cfg.get("cgroup_cpu_max", "/sys/fs/cgroup/cpu.max")
        try:
            limit = parse_cgroup_cpu_max(Path(p).read_text())
        except (OSError, ValueError):
            pass
        eff = min(vcpus["v"], limit) if limit else vcpus["v"]
        m["cpu.vcpus"] = float(eff)
        vcpus["v"] = eff
    section("cpu_alloc", cpu_alloc)

    def cpu():
        cur = parse_stat_cpu(_read(root, "stat"))
        prev = state.get("cpu")
        state["cpu"] = cur
        if prev:
            dtot = cur["total"] - prev["total"]
            if dtot > 0:
                m["cpu.used_pct"] = 100.0 * (1 - (cur["idle"] - prev["idle"]) / dtot)
                m["cpu.iowait_pct"] = 100.0 * (cur["iowait"] - prev["iowait"]) / dtot
                m["cpu.steal_pct"] = 100.0 * (cur["steal"] - prev["steal"]) / dtot
    section("cpu", cpu)

    def load():
        l1, l5, l15 = parse_loadavg(_read(root, "loadavg"))
        m["load.1"], m["load.5"], m["load.15"] = l1, l5, l15
        m["load.per_vcpu"] = l1 / max(vcpus["v"], 1)
    section("load", load)

    def memory():
        mi = parse_meminfo(_read(root, "meminfo"))
        total, avail = mi["MemTotal"], mi.get("MemAvailable", mi.get("MemFree", 0))
        try:
            lim = Path(cfg.get("cgroup_memory_max", "/sys/fs/cgroup/memory.max")).read_text().strip()
            if lim.isdigit() and int(lim) < total:
                avail = min(avail, int(lim))
                total = int(lim)
        except OSError:
            pass
        m["mem.total_bytes"] = total
        m["mem.available_bytes"] = avail
        m["mem.used_bytes"] = total - avail
        m["mem.used_pct"] = 100.0 * (total - avail) / total
        st, sf = mi.get("SwapTotal", 0), mi.get("SwapFree", 0)
        m["swap.total_bytes"] = st
        m["swap.used_bytes"] = st - sf
        m["swap.used_pct"] = 100.0 * (st - sf) / st if st else 0.0
    section("memory", memory)

    def swap_rates():
        cur = parse_vmstat(_read(root, "vmstat"))
        prev = state.get("vm")
        state["vm"] = cur
        if prev and dt > 0:
            for k, name in (("pswpin", "swap.in_pps"), ("pswpout", "swap.out_pps")):
                r = _rate(cur.get(k, 0), prev.get(k, 0), dt)
                if r is not None:
                    m[name] = r
    section("swap_rates", swap_rates)

    def disks():
        for mount in cfg.get("mounts", ["/"]):
            label = "root" if mount == "/" else safe_name(mount)
            sv = os.statvfs(mount)
            total = sv.f_blocks * sv.f_frsize
            used = (sv.f_blocks - sv.f_bfree) * sv.f_frsize
            avail = sv.f_bavail * sv.f_frsize
            denom = used + avail
            m[f"disk.{label}.total_bytes"] = total
            m[f"disk.{label}.used_bytes"] = used
            m[f"disk.{label}.used_pct"] = 100.0 * used / denom if denom else 0.0
            if sv.f_files:
                m[f"disk.{label}.inodes_used_pct"] = 100.0 * (sv.f_files - sv.f_ffree) / sv.f_files
    section("disk", disks)

    def io():
        devs = parse_diskstats(_read(root, "diskstats"))
        want = cfg.get("disk_device", "auto")
        if want != "auto":
            devs = {k: v for k, v in devs.items() if k == want}
        prev = state.get("io")
        state["io"] = devs
        if prev and dt > 0 and devs:
            rd = wr = 0.0
            util = 0.0
            for k, v in devs.items():
                p = prev.get(k)
                if not p:
                    continue
                rd += max(v["rd_sectors"] - p["rd_sectors"], 0) * 512 / dt
                wr += max(v["wr_sectors"] - p["wr_sectors"], 0) * 512 / dt
                util = max(util, min(100.0, 100.0 * max(v["io_ms"] - p["io_ms"], 0) / (dt * 1000)))
            m["io.read_bps"], m["io.write_bps"], m["io.util_pct"] = rd, wr, util
    section("io", io)

    def net():
        nd = parse_netdev(_read(root, "net/dev"))
        iface = cfg.get("net_interface", "auto")
        if iface == "auto":
            try:
                iface = parse_default_iface(_read(root, "net/route"))
            except OSError:
                iface = None
            if not iface or iface not in nd:
                cands = {k: v for k, v in nd.items() if k != "lo"}
                iface = max(cands, key=lambda k: cands[k]["rx"] + cands[k]["tx"]) if cands else None
        if not iface or iface not in nd:
            raise CollectorError("no network interface found")
        cur = nd[iface]
        prev = state.get("net")
        state["net"] = {"iface": iface, **cur}
        if prev and prev.get("iface") == iface and dt > 0:
            for k, name in (("rx", "net.rx_bps"), ("tx", "net.tx_bps")):
                r = _rate(cur[k], prev[k], dt)
                if r is not None:
                    m[name] = r
    section("net", net)

    def uptime():
        m["uptime.seconds"] = parse_uptime(_read(root, "uptime"))
    section("uptime", uptime)

    def reboot_required():
        # architecture review M-2: unattended-upgrades installs kernel/library updates that stay inactive until a reboot. Existence of the marker file is the whole signal.
        f = cfg.get("reboot_required_file", "/var/run/reboot-required")
        if not f:
            return
        try:
            st = os.stat(f)
        except FileNotFoundError:
            m["host.reboot_required"] = 0.0
            return
        m["host.reboot_required"] = 1.0
        m["host.reboot_required_age_s"] = max(now - st.st_mtime, 0.0)
    section("reboot_required", reboot_required)

    def systemd():
        ctl = cfg.get("systemctl", "systemctl")
        for unit in cfg.get("units", []):
            if not re.match(r"^[A-Za-z0-9@:_.\-]+$", unit):
                raise CollectorError(f"invalid unit name {unit!r}")
            name = "svc." + safe_name(unit)
            try:
                out = subprocess.run(
                    [ctl, "show", "-p", "NRestarts,ActiveState,SubState,ActiveEnterTimestamp,LoadState", unit],
                    capture_output=True, text=True, timeout=5, check=False)
            except FileNotFoundError:
                raise CollectorError(f"{ctl} not found")
            kv = parse_systemctl_show(out.stdout)
            if not kv:
                res.errors.append(f"systemd {unit}: no output")
                continue
            state_ok = kv.get("ActiveState") == "active"
            m[f"{name}.active"] = 1.0 if state_ok else 0.0
            m[f"{name}.failed"] = 1.0 if kv.get("ActiveState") == "failed" else 0.0
            m[f"{name}.present"] = 0.0 if kv.get("LoadState") == "not-found" else 1.0
            if kv.get("NRestarts", "").isdigit():
                m[f"{name}.restarts"] = float(kv["NRestarts"])
            ts = parse_systemd_ts(kv.get("ActiveEnterTimestamp", ""))
            if ts and state_ok:
                m[f"{name}.uptime_s"] = max(now - ts, 0)
    section("systemd", systemd)
    return res
