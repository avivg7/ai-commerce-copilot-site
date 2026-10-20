"""PHP-FPM collector: pool status page fetched over the pool's unix socket with our own FastCGI client."""
from __future__ import annotations

import json
import re

from . import CollectorError, Result
from ..fcgi import fcgi_get, FcgiError


def parse_status_json(body: str) -> dict:
    d = json.loads(body)
    keys = {
        "active processes": "active", "idle processes": "idle", "total processes": "total",
        "listen queue": "listen_queue", "max listen queue": "max_listen_queue",
        "max children reached": "max_children_reached", "slow requests": "slow_requests",
        "max active processes": "max_active", "accepted conn": "accepted_conn",
        "listen queue len": "listen_queue_len",
    }
    return {short: float(d[long]) for long, short in keys.items() if long in d}


def parse_status_text(body: str) -> dict:
    """Plain `key: value` format (when ?json is not honoured)."""
    d = {}
    for line in body.splitlines():
        k, _, v = line.partition(":")
        d[k.strip().lower()] = v.strip()
    keys = {"active processes": "active", "idle processes": "idle", "total processes": "total",
            "listen queue": "listen_queue", "max listen queue": "max_listen_queue",
            "max children reached": "max_children_reached", "slow requests": "slow_requests"}
    return {short: float(d[long]) for long, short in keys.items() if re.match(r"^\d+$", d.get(long, ""))}


def collect(full_cfg, cfg, state, now) -> Result:
    try:
        status, _hdr, body = fcgi_get(cfg["socket"], cfg["status_path"], "json", timeout=cfg.get("timeout_s", 5))
    except (OSError, FcgiError):
        return Result(metrics={"fpm.up": 0.0})
    if status != 200:
        raise CollectorError(f"fpm status returned HTTP {status} (status path not enabled or not allowed?)")
    text = body.decode("utf-8", "replace")
    try:
        s = parse_status_json(text) if text.lstrip().startswith("{") else parse_status_text(text)
    except (ValueError, KeyError) as e:
        raise CollectorError(f"unparseable fpm status: {e}")
    if "total" not in s:
        raise CollectorError("fpm status lacks process counts")
    m = {"fpm.up": 1.0}
    for k in ("active", "idle", "total", "listen_queue", "max_listen_queue", "max_active"):
        if k in s:
            m[f"fpm.{k}"] = s[k]
    maxc = float(cfg.get("max_children") or 0)
    denom = max(s["total"], maxc) if maxc else s["total"]
    m["fpm.active_ratio"] = s.get("active", 0.0) / denom if denom else 0.0
    prev = state.get("prev", {})
    for k in ("max_children_reached", "slow_requests"):
        if k in s:
            m[f"fpm.{k}"] = s[k]
            if k in prev:
                d = s[k] - prev[k]
                m[f"fpm.{k}_delta"] = s[k] if d < 0 else d
    state["prev"] = {k: s[k] for k in ("max_children_reached", "slow_requests") if k in s}
    return Result(metrics=m)
