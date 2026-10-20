"""Caddy collector: Prometheus text from the admin API on loopback (never public).

Cardinality rule: labels are only ever used to AGGREGATE (status class, dynamic-vs-all handler, histogram `le`).
No per-URL/per-host/per-method series is kept, in memory or on disk."""
from __future__ import annotations

import re
import urllib.request
from urllib.parse import urlparse

from . import CollectorError, Result
from ..util import assert_loopback

_LINE = re.compile(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+([^\s]+)(?:\s+\d+)?$')
_LABEL = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"')
MAX_BYTES = 4 * 1024 * 1024


def parse_prometheus(text: str):
    """Yield (name, labels dict, value float) for sample lines; comments/blank/NaN lines are skipped."""
    for line in text.splitlines():
        if not line or line[0] == "#":
            continue
        m = _LINE.match(line.strip())
        if not m:
            continue
        name, lab, val = m.groups()
        try:
            v = float(val)
        except ValueError:
            continue
        if v != v:  # NaN
            continue
        labels = dict(_LABEL.findall(lab)) if lab else {}
        yield name, labels, v


def _le(s: str) -> float:
    return float("inf") if s in ("+Inf", "Inf") else float(s)


def aggregate(text: str, dynamic_handlers=("reverse_proxy",), count_handlers=()):
    """Collapse the exposition into low-cardinality cumulative aggregates."""
    agg = {
        "status": {"2xx": 0.0, "3xx": 0.0, "4xx": 0.0, "5xx": 0.0, "other": 0.0},
        "buckets_all": {}, "buckets_dyn": {},
        "resp_bytes": 0.0, "req_bytes": 0.0,
        "in_flight": 0.0, "upstreams": [], "have_http": False,
    }
    reqs_total_with_code = {}
    for name, lab, v in parse_prometheus(text):
        if not name.startswith(("caddy_http", "caddy_reverse")):
            continue
        handler = lab.get("handler", "")
        counted = (not count_handlers) or handler in count_handlers
        if name == "caddy_http_request_duration_seconds_bucket" and "le" in lab:
            agg["have_http"] = True
            if counted:
                le = _le(lab["le"])
                agg["buckets_all"][le] = agg["buckets_all"].get(le, 0.0) + v
            if handler in dynamic_handlers:
                le = _le(lab["le"])
                agg["buckets_dyn"][le] = agg["buckets_dyn"].get(le, 0.0) + v
        elif name == "caddy_http_request_duration_seconds_count" and counted:
            agg["have_http"] = True
            cls = lab.get("code", "")[:1] + "xx" if lab.get("code", "")[:1] in "2345" and lab.get("code") else "other"
            agg["status"][cls if cls in agg["status"] else "other"] += v
        elif name == "caddy_http_requests_total" and "code" in lab and counted:
            reqs_total_with_code[lab["code"][:1] + "xx"] = reqs_total_with_code.get(lab["code"][:1] + "xx", 0.0) + v
        elif name == "caddy_http_response_size_bytes_sum" and counted:
            agg["resp_bytes"] += v
        elif name == "caddy_http_request_size_bytes_sum" and counted:
            agg["req_bytes"] += v
        elif name == "caddy_http_requests_in_flight":
            agg["in_flight"] += v
        elif name == "caddy_reverse_proxy_upstreams_healthy":
            agg["upstreams"].append(v)
    return agg


def _delta(cur: float, prev: float) -> float:
    d = cur - prev
    return cur if d < 0 else d  # counter reset: the new value is the delta since reset


def bucket_deltas(cur: dict, prev: dict) -> list:
    """Per-`le` cumulative delta, sorted by bound. Any bucket reset => treat the whole histogram as reset."""
    reset = any(cur.get(le, 0) < prev.get(le, 0) for le in prev)
    return sorted((le, cur[le] - (0 if reset else prev.get(le, 0))) for le in cur)


def quantile_ms(deltas: list, q: float):
    """Prometheus-style histogram_quantile on cumulative bucket deltas; returns milliseconds or None."""
    if not deltas:
        return None
    total = deltas[-1][1]
    if total <= 0:
        return None
    target = q * total
    prev_le, prev_c = 0.0, 0.0
    for le, c in deltas:
        if c >= target:
            if le == float("inf"):
                finite = [b for b, _ in deltas if b != float("inf")]
                return (finite[-1] if finite else 0.0) * 1000.0
            span = c - prev_c
            frac = (target - prev_c) / span if span > 0 else 1.0
            return (prev_le + (le - prev_le) * frac) * 1000.0
        prev_le, prev_c = le, c
    return None


def collect(full_cfg, cfg, state, now) -> Result:
    url = cfg["url"]
    u = urlparse(url)
    if u.scheme != "http":
        raise CollectorError("caddy metrics url must be http:// on loopback")
    assert_loopback(u.hostname or "", "caddy url host")
    req = urllib.request.Request(url, headers={"User-Agent": "aicc-ops/0.1", "Accept": "text/plain"})
    try:
        with urllib.request.urlopen(req, timeout=cfg.get("timeout_s", 5)) as r:  # nosec - loopback only
            body = r.read(MAX_BYTES + 1)
    except OSError:
        return Result(metrics={"caddy.up": 0.0})
    if len(body) > MAX_BYTES:
        raise CollectorError("metrics response too large")
    return from_text(body.decode("utf-8", "replace"), cfg, state, now)


def from_text(text: str, cfg, state, now) -> Result:
    agg = aggregate(text, tuple(cfg.get("dynamic_handlers", ["reverse_proxy"])), tuple(cfg.get("count_handlers", [])))
    m = {"caddy.up": 1.0, "caddy.in_flight": agg["in_flight"]}
    if agg["upstreams"]:
        m["caddy.upstream_healthy_min"] = min(agg["upstreams"])
        m["caddy.upstream_count"] = float(len(agg["upstreams"]))
    prev = state.get("prev")
    state["prev"] = {"ts": now, "agg": agg}
    if not agg["have_http"] or not prev:
        return Result(metrics=m)
    dt = now - prev["ts"]
    if dt <= 0:
        return Result(metrics=m)
    p = prev["agg"]
    total = 0.0
    for cls in ("2xx", "3xx", "4xx", "5xx", "other"):
        d = _delta(agg["status"][cls], p["status"][cls])
        total += d
        m[f"caddy.rate_{cls}"] = d / dt
    m["caddy.req_rate"] = total / dt
    m["caddy.resp_bytes_ps"] = _delta(agg["resp_bytes"], p["resp_bytes"]) / dt
    m["caddy.req_bytes_ps"] = _delta(agg["req_bytes"], p["req_bytes"]) / dt
    for tag, key in (("", "buckets_all"), ("dyn_", "buckets_dyn")):
        if agg[key]:
            bd = bucket_deltas(agg[key], p[key])
            for q, n in ((0.5, "p50"), (0.95, "p95"), (0.99, "p99")):
                v = quantile_ms(bd, q)
                if v is not None:
                    m[f"caddy.{tag}lat_{n}_ms"] = v
    return Result(metrics=m)
