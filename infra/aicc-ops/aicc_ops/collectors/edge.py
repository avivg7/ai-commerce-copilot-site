"""Loopback HTTPS probe of the edge (Caddy): GET <path> on 127.0.0.1:443 with SNI/Host = configured hostname.
Detects 'Caddy up but app/edge broken' locally; the external view is the sentinel's job."""
from __future__ import annotations

import http.client
import socket
import ssl
import time

from . import Result
from ..util import assert_loopback


def collect(full_cfg, cfg, state, now) -> Result:
    assert_loopback(cfg["host"], "edge host")
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    t0 = time.monotonic()
    s = None
    try:
        raw = socket.create_connection((cfg["host"], int(cfg["port"])), timeout=cfg.get("timeout_s", 5))
        s = ctx.wrap_socket(raw, server_hostname=cfg["hostname"])
        conn = http.client.HTTPSConnection(cfg["host"], int(cfg["port"]), timeout=cfg.get("timeout_s", 5), context=ctx)
        conn.sock = s
        conn.request("GET", cfg["path"], headers={"Host": cfg["hostname"], "User-Agent": "aicc-ops/0.1"})
        r = conn.getresponse()
        r.read(4096)
        status = r.status
        conn.close()
    except (OSError, ssl.SSLError, http.client.HTTPException):
        return Result(metrics={"edge.up": 0.0})
    finally:
        if s is not None:
            s.close()
    ms = (time.monotonic() - t0) * 1000.0
    return Result(metrics={"edge.up": 1.0 if status == int(cfg["expect_status"]) else 0.0,
                           "edge.status": float(status), "edge.latency_ms": ms})
