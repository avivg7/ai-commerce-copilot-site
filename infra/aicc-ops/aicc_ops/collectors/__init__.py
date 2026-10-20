"""Collector framework: every collector is isolated by a timeout and try/except; a failure becomes a metric."""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field


class CollectorError(Exception):
    """Raised by a collector when it cannot produce its metrics (recorded as collector.<name>.ok = 0)."""


@dataclass
class Result:
    metrics: dict = field(default_factory=dict)
    errors: list = field(default_factory=list)  # partial failures; make ok=0 but keep the metrics


@dataclass
class Collector:
    name: str
    fn: object
    cfg: dict
    state: dict = field(default_factory=dict)
    next_due: float = 0.0
    thread: threading.Thread | None = None

    @property
    def interval(self) -> float:
        return float(self.cfg.get("interval_s", 30))

    @property
    def timeout(self) -> float:
        return float(self.cfg.get("timeout_s", 10))


def run_collector(c: Collector, full_cfg: dict, now: float) -> dict:
    """Run one collector with a hard timeout; always returns a metrics dict (never raises).

    Adds collector.<name>.ok (1/0) and collector.<name>.duration_ms.
    A hung collector keeps its (daemon) thread; the next cycle reports 'still running' instead of stacking threads."""
    prefix = f"collector.{c.name}"
    if c.thread is not None and c.thread.is_alive():
        return {f"{prefix}.ok": 0.0}
    box: dict = {}

    def target():
        try:
            r = c.fn(full_cfg, c.cfg, c.state, now)
            box["result"] = r if isinstance(r, Result) else Result(metrics=dict(r))
        except BaseException as e:  # noqa: BLE001 - isolation is the point
            box["error"] = f"{type(e).__name__}: {e}"

    t0 = time.monotonic()
    th = threading.Thread(target=target, name=f"collector-{c.name}", daemon=True)
    c.thread = th
    th.start()
    th.join(c.timeout)
    dur = (time.monotonic() - t0) * 1000.0
    out: dict = {f"{prefix}.duration_ms": round(dur, 1)}
    if th.is_alive():
        out[f"{prefix}.ok"] = 0.0
        out["_error." + c.name] = f"timeout after {c.timeout:.0f}s"
        return out
    c.thread = None
    if "error" in box:
        out[f"{prefix}.ok"] = 0.0
        out["_error." + c.name] = box["error"]
        return out
    res: Result = box["result"]
    out.update({k: float(v) for k, v in res.metrics.items() if v is not None})
    out[f"{prefix}.ok"] = 0.0 if res.errors else 1.0
    if res.errors:
        out["_error." + c.name] = "; ".join(res.errors)[:300]
    return out


def build_collectors(cfg: dict) -> list:
    from . import host, caddy, phpfpm, mysql, cp, backups, cert, edge, postgres, backend_metrics, unitstatus
    table = {
        "host": host.collect, "caddy": caddy.collect, "phpfpm": phpfpm.collect, "mysql": mysql.collect,
        "cp": cp.collect, "backups": backups.collect, "cert": cert.collect, "edge": edge.collect,
        "postgres": postgres.collect, "backend_metrics": backend_metrics.collect, "unitstatus": unitstatus.collect,
    }
    return [Collector(n, table[n], c) for n, c in cfg["collectors"].items() if c.get("enabled") and n in table]
