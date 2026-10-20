import http.server
import os
import threading
import unittest

from aicc_ops.collectors import backend_metrics as bm, CollectorError
from aicc_ops.config import load_config
from tests.helpers import TmpCase, read_fixture, put

TOKEN = "t" * 48
FORWARDING = ("x-forwarded-for", "x-forwarded-host", "forwarded", "x-real-ip", "via", "cf-connecting-ip", "true-client-ip")


class FakeBackend:
    """Mimics the backend listener contract: bearer auth, 403 on any forwarding header, GET/HEAD /metrics only."""

    def __init__(self, body):
        outer = self
        self.body, self.seen = body, []

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass

            def do_GET(self):
                hs = {k.lower(): v for k, v in self.headers.items()}
                outer.seen.append(hs)
                if self.path != "/metrics":
                    code, b = 404, b""
                elif any(f in hs for f in FORWARDING):
                    code, b = 403, b""
                elif hs.get("authorization") != f"Bearer {TOKEN}":
                    code, b = 401, b""
                else:
                    code, b = 200, outer.body.encode()
                self.send_response(code); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}/metrics"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown(); self.srv.server_close()


class BackendMetricsTests(TmpCase):
    def token_file(self, mode=0o600, tok=TOKEN):
        p = os.path.join(self.tmp, "metrics.token")
        put(p, tok + "\n"); os.chmod(p, mode)
        return p

    def test_disabled_by_default(self):
        self.assertFalse(load_config()["collectors"]["backend_metrics"]["enabled"])

    def test_rates_latency_and_gauges_from_fixture(self):
        st = {}
        bm.from_text(read_fixture("backend_metrics_a.txt"), st, 2_000_000)
        m = bm.from_text(read_fixture("backend_metrics_b.txt"), st, 2_000_030).metrics
        self.assertAlmostEqual(m["backend.rate_2xx"], (300 + 60) / 30)
        self.assertAlmostEqual(m["backend.rate_5xx"], 10 / 30)
        self.assertAlmostEqual(m["backend.rate_4xx"], 0.0)
        self.assertAlmostEqual(m["backend.req_rate"], 370 / 30)
        self.assertIn("backend.lat_p95_ms", m)
        self.assertEqual(m["backend.postgres_up"], 1.0)
        self.assertAlmostEqual(m["backend.pool_pressure_pct"], 100 * (7 + 2) / 15)
        self.assertEqual(m["backend.bg_failures_delta"], 2.0)
        self.assertEqual(m["backend.scrapes_rejected_delta"], 3.0)
        self.assertEqual(m["backend.job_runner_age_s"], 40.0)
        self.assertAlmostEqual(m["backend.ingest_success_rate"], 0.0)

    def test_no_per_route_or_per_surface_series(self):
        m = bm.from_text(read_fixture("backend_metrics_a.txt"), {}, 1).metrics
        bad = [k for k in m if "/" in k or "v1" in k or "recommendations" in k]
        self.assertEqual(bad, [])

    def test_counter_reset_after_backend_restart(self):
        st = {}
        bm.from_text(read_fixture("backend_metrics_b.txt"), st, 1000)
        m = bm.from_text(read_fixture("backend_metrics_a.txt"), st, 1030).metrics   # counters went backwards
        self.assertAlmostEqual(m["backend.rate_2xx"], 1500 / 30)

    def test_fetch_sends_bearer_and_no_forwarding_headers_even_with_proxy_env(self):
        srv = FakeBackend(read_fixture("backend_metrics_a.txt"))
        old = {k: os.environ.get(k) for k in ("http_proxy", "HTTP_PROXY")}
        os.environ["http_proxy"] = os.environ["HTTP_PROXY"] = "http://127.0.0.1:9"   # would break/forward if honoured
        try:
            r = bm.collect({}, {"url": srv.url, "token_file": self.token_file(), "timeout_s": 3}, {}, 1)
        finally:
            for k, v in old.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
            srv.close()
        self.assertEqual(r.metrics["backend.up"], 1.0)
        hs = srv.seen[0]
        self.assertEqual(hs["authorization"], f"Bearer {TOKEN}")
        self.assertFalse([h for h in hs if h in FORWARDING])

    def test_auth_rejection_is_a_collector_failure_not_down(self):
        srv = FakeBackend("")
        try:
            with self.assertRaises(CollectorError) as cm:
                bm.collect({}, {"url": srv.url, "token_file": self.token_file(tok="x" * 40), "timeout_s": 3}, {}, 1)
            self.assertNotIn("x" * 40, str(cm.exception))   # the token is never echoed
        finally:
            srv.close()

    def test_unreachable_is_up_zero(self):
        r = bm.collect({}, {"url": "http://127.0.0.1:9/metrics", "token_file": self.token_file(), "timeout_s": 1}, {}, 1)
        self.assertEqual(r.metrics["backend.up"], 0.0)

    def test_guards(self):
        with self.assertRaises(ValueError):
            bm.collect({}, {"url": "http://api.copilt.org:9108/metrics", "token_file": self.token_file()}, {}, 1)   # SSRF guard
        with self.assertRaises(CollectorError):
            bm.collect({}, {"url": "https://127.0.0.1:9108/metrics", "token_file": self.token_file()}, {}, 1)
        with self.assertRaises(CollectorError):
            bm.read_token(self.token_file(mode=0o644))
        with self.assertRaises(CollectorError):
            bm.read_token(self.token_file(tok="short"))

    def test_config_shows_path_not_token(self):
        from aicc_ops.config import redact
        r = redact(load_config())["collectors"]["backend_metrics"]
        self.assertEqual(r["token_file"], "/etc/aicc/metrics.token")


if __name__ == "__main__":
    unittest.main()
