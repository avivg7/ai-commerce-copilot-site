"""OPTIONAL, DISABLED BY DEFAULT: scrape the API backend's first-party metrics (API host only).

Contract (Backend repo docs/observability-metrics.md): Prometheus text 0.0.4 on http://127.0.0.1:9108/metrics, bearer
token from a root-only file, GET/HEAD only, and HTTP 403 if ANY forwarding header is present, so we connect directly:
no proxy handler, no extra headers. Enabling it needs a PRODUCTION change on the API host and a separate owner approval;
nothing here points at api.copilt.org. Cardinality: route/surface/kind labels are collapsed into class-level sums."""
from __future__ import annotations

import os
import urllib.error
import urllib.request
from urllib.parse import urlparse

from . import CollectorError, Result
from .caddy import parse_prometheus, bucket_deltas, quantile_ms, _delta, _le, MAX_BYTES
from ..util import assert_loopback

SERIOUS_REASONS = ("server_error", "unavailable")


def read_token(path: str) -> str:
    st = os.stat(path)
    if st.st_mode & 0o007:
        raise CollectorError("backend metrics token file is world-accessible; refusing to read it")
    with open(path) as fh:
        tok = fh.read().strip()
    if len(tok) < 32:
        raise CollectorError("backend metrics token file is empty or too short")
    return tok


def aggregate(text: str) -> dict:
    a = {"http": {}, "hist": {}, "reco_hist": {}, "reco": {"requests": 0.0, "success": 0.0, "serious": 0.0, "failures": 0.0},
         "ingest": {}, "gauges": {}, "bg_fail": 0.0, "scrape_rejected": 0.0, "inflight": 0.0}
    for name, lab, v in parse_prometheus(text):
        if not name.startswith("aicc_"):
            continue
        if name == "aicc_http_requests_total":
            c = lab.get("status_class", "other")
            a["http"][c] = a["http"].get(c, 0.0) + v
        elif name == "aicc_http_request_duration_seconds_bucket" and "le" in lab:
            le = _le(lab["le"])
            a["hist"][le] = a["hist"].get(le, 0.0) + v
        elif name == "aicc_recommendation_duration_seconds_bucket" and "le" in lab:
            le = _le(lab["le"])
            a["reco_hist"][le] = a["reco_hist"].get(le, 0.0) + v
        elif name == "aicc_http_requests_in_flight":
            a["inflight"] += v
        elif name == "aicc_recommendation_requests_total":
            a["reco"]["requests"] += v
        elif name == "aicc_recommendation_success_total":
            a["reco"]["success"] += v
        elif name == "aicc_recommendation_failures_total":
            a["reco"]["failures"] += v
            if lab.get("reason") in SERIOUS_REASONS:
                a["reco"]["serious"] += v
        elif name == "aicc_ingest_requests_total":
            o = lab.get("outcome", "other")
            a["ingest"][o] = a["ingest"].get(o, 0.0) + v
        elif name == "aicc_background_task_failures_total":
            a["bg_fail"] += v
        elif name == "aicc_metrics_scrapes_total" and lab.get("result") in ("forbidden", "unauthorized"):
            a["scrape_rejected"] += v
        elif name in ("aicc_db_pool_size", "aicc_db_pool_max_overflow", "aicc_db_pool_checked_out", "aicc_db_pool_overflow",
                      "aicc_db_pool_waiting", "aicc_postgres_up", "aicc_health_ok", "aicc_job_queue_depth",
                      "aicc_job_queue_oldest_pending_age_seconds", "aicc_job_runner_last_run_timestamp_seconds",
                      "aicc_postgres_probe_last_timestamp_seconds", "aicc_process_start_time_seconds"):
            a["gauges"][name] = v
    return a


def fetch(cfg) -> str:
    u = urlparse(cfg["url"])
    if u.scheme != "http":
        raise CollectorError("backend metrics url must be http:// on loopback")
    assert_loopback(u.hostname or "", "backend metrics host")
    token = read_token(cfg["token_file"])
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # direct connection: a proxy adds Via/X-Forwarded-*
    req = urllib.request.Request(cfg["url"], method="GET", headers={"Authorization": f"Bearer {token}", "User-Agent": "aicc-ops/0.1", "Accept": "text/plain"})
    try:
        with opener.open(req, timeout=cfg.get("timeout_s", 5)) as r:
            return r.read(MAX_BYTES + 1).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise CollectorError(f"backend metrics rejected the request (HTTP {e.code}): check token file / forwarding headers")
        raise CollectorError(f"backend metrics HTTP {e.code}")
    except (urllib.error.URLError, OSError):
        return ""


def collect(full_cfg, cfg, state, now) -> Result:
    text = fetch(cfg)
    if not text:
        return Result(metrics={"backend.up": 0.0})
    return from_text(text, state, now)


def from_text(text: str, state: dict, now: float) -> Result:
    a = aggregate(text)
    g = a["gauges"]
    m = {"backend.up": 1.0, "backend.in_flight": a["inflight"]}
    for src, dst in (("aicc_postgres_up", "postgres_up"), ("aicc_health_ok", "health_ok"), ("aicc_db_pool_size", "pool_size"),
                     ("aicc_db_pool_checked_out", "pool_checked_out"), ("aicc_db_pool_overflow", "pool_overflow"),
                     ("aicc_db_pool_waiting", "pool_waiting"), ("aicc_job_queue_depth", "job_queue_depth"),
                     ("aicc_job_queue_oldest_pending_age_seconds", "job_oldest_pending_s")):
        if src in g:
            m[f"backend.{dst}"] = g[src]
    cap = g.get("aicc_db_pool_size", 0) + g.get("aicc_db_pool_max_overflow", 0)
    if cap > 0 and "aicc_db_pool_checked_out" in g:
        m["backend.pool_pressure_pct"] = 100.0 * (g["aicc_db_pool_checked_out"] + g.get("aicc_db_pool_overflow", 0)) / cap
    if "aicc_job_runner_last_run_timestamp_seconds" in g:
        m["backend.job_runner_age_s"] = max(now - g["aicc_job_runner_last_run_timestamp_seconds"], 0.0)
    prev = state.get("prev")
    state["prev"] = {"ts": now, "a": a}
    if not prev or now - prev["ts"] <= 0:
        return Result(metrics=m)
    dt, p = now - prev["ts"], prev["a"]
    total = 0.0
    for cls in ("2xx", "3xx", "4xx", "5xx"):
        d = _delta(a["http"].get(cls, 0.0), p["http"].get(cls, 0.0))
        total += d
        m[f"backend.rate_{cls}"] = d / dt
    m["backend.req_rate"] = total / dt
    if a["hist"]:
        bd = bucket_deltas(a["hist"], p["hist"])
        for q, n in ((0.5, "p50"), (0.95, "p95"), (0.99, "p99")):
            v = quantile_ms(bd, q)
            if v is not None:
                m[f"backend.lat_{n}_ms"] = v
    if a["reco_hist"]:
        v = quantile_ms(bucket_deltas(a["reco_hist"], p["reco_hist"]), 0.95)
        if v is not None:
            m["backend.reco_lat_p95_ms"] = v
    for k, n in (("requests", "reco_rate"), ("success", "reco_success_rate"), ("serious", "reco_serious_fail_rate")):
        m[f"backend.{n}"] = _delta(a["reco"][k], p["reco"][k]) / dt
    for o in ("success", "client_error", "server_error"):
        m[f"backend.ingest_{o}_rate"] = _delta(a["ingest"].get(o, 0.0), p["ingest"].get(o, 0.0)) / dt
    m["backend.bg_failures_delta"] = _delta(a["bg_fail"], p["bg_fail"])
    m["backend.scrapes_rejected_delta"] = _delta(a["scrape_rejected"], p["scrape_rejected"])
    return Result(metrics=m)
