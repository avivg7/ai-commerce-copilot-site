import http.server
import io
import json
import os
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import sentinel as S  # noqa: E402

HAVE_OPENSSL = shutil.which("openssl") is not None


def put(path, text, mode=None):
    with open(path, "w") as fh:
        fh.write(text)
    if mode:
        os.chmod(path, mode)
    return path


class Server:
    """Loopback server (HTTPS when a cert is given) with scriptable behaviour; records requests."""

    def __init__(self, cert=None, key=None):
        outer = self
        self.script = lambda n, path: (200, b"ok\n", {})
        self.requests = []

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass

            def _do(self):
                outer.requests.append({"method": self.command, "path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}})
                st, body, hdrs = outer.script(len(outer.requests), self.path)
                self.send_response(st)
                for k, v in hdrs.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)
            do_GET = do_HEAD = do_POST = _do

        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.tls = bool(cert)
        if cert:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(cert, key)
            self.srv.socket = ctx.wrap_socket(self.srv.socket, server_side=True)
        self.port = self.srv.server_address[1]
        self.base = f"{'https' if cert else 'http'}://127.0.0.1:{self.port}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown(); self.srv.server_close()


def make_cert(d, days, name="c"):
    key, crt = os.path.join(d, name + ".key"), os.path.join(d, name + ".crt")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", str(days),
                    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], check=True, capture_output=True)
    return crt, key


def target(url, **kw):
    t = {**S.TARGET_DEFAULTS, "name": "t1", "url": url}
    t.update(kw)
    S.validate_target(t)
    return t


def cfg_for(targets, **sk):
    return {"sentinel": {**S.DEFAULTS, **sk}, "targets": targets}


class Base(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.tmp = self.td.name
        self.addCleanup(self.td.cleanup)
        self.servers = []

    def tearDown(self):
        for s in self.servers:
            s.close()

    def server(self, cert=None, key=None):
        s = Server(cert, key)
        self.servers.append(s)
        return s

    def sentinel(self, targets, dry=False, secrets=None, tg_url=None, **sk):
        out = io.StringIO()
        n = S.Notifier(secrets or os.path.join(self.tmp, "none.env"), "test-observer", dry_run=dry, out=out, log=lambda m: None,
                       test_base_url=tg_url, environ={}, sleep=lambda s: None)
        s = S.Sentinel(cfg_for(targets, state_file=os.path.join(self.tmp, "state.json"), **sk), n, os.path.join(self.tmp, "state.json"), log=lambda m: None)
        s.out = out
        return s


@unittest.skipUnless(HAVE_OPENSSL, "openssl required")
class HttpsBehaviour(Base):
    def setUp(self):
        super().setUp()
        self.crt, self.key = make_cert(self.tmp, 90)
        self.srv = self.server(self.crt, self.key)

    def t(self, **kw):
        return target(self.srv.base + "/healthz", ca_file=self.crt, **kw)

    def test_up_records_status_latency_and_tls_days(self):
        r = S.probe(self.t(expect_body="ok"))
        self.assertTrue(r["ok"], r)
        self.assertEqual(r["status"], 200)
        self.assertAlmostEqual(r["tls_days"], 90, delta=0.2)

    def test_production_entitlement_mode_expectation_matches_enforced_and_pages_on_shadow(self):
        """The real expect_body of targets.production.toml (api-health) against Backend-shaped /health bodies (FastAPI compact JSON)."""
        prod = {t["name"]: t for t in S.load_config(os.path.join(os.path.dirname(os.path.dirname(__file__)), "targets.production.toml"))["targets"]}
        want = prod["api-health"]["expect_body"]
        bodies = {"enforced": b'{"status":"ok","database":"ok","version":"1.2.3","build":"abc1234","entitlement_mode":"enforced"}',
                  "shadow": b'{"status":"ok","database":"ok","version":"1.2.3","build":"abc1234","entitlement_mode":"shadow"}',
                  "old": b'{"status":"ok","database":"ok"}'}
        res = {}
        for name, body in bodies.items():
            self.srv.script = lambda n, path, b=body: (200, b, {})
            res[name] = S.probe(self.t(expect_body=want))
        self.assertTrue(res["enforced"]["ok"], res["enforced"])
        self.assertFalse(res["shadow"]["ok"])
        self.assertEqual(res["shadow"]["stage"], "body")
        self.assertFalse(res["old"]["ok"])      # a Backend that does not report the mode yet is also not "enforced"

    def test_request_is_get_only_with_identifying_ua_and_no_credentials(self):
        S.probe(self.t())
        S.probe(self.t(method="HEAD"))
        reqs = self.srv.requests
        self.assertEqual([r["method"] for r in reqs], ["GET", "HEAD"])
        for r in reqs:
            self.assertTrue(r["headers"]["user-agent"].startswith("AICC-Sentinel/"))
            for h in ("cookie", "authorization", "proxy-authorization", "x-api-key"):
                self.assertNotIn(h, r["headers"])

    def test_down_requires_n_of_m_then_recovers_after_k(self):
        s = self.sentinel([self.t()], fail_n=3, window_m=5, recover_k=2, cooldown_s=0)
        self.srv.script = lambda n, p: (503, b"bad", {})
        ev = [s.run_once(1000 + i * 60) for i in range(4)]
        self.assertEqual([len(e) for e in ev], [0, 0, 1, 0])           # DOWN exactly at the 3rd failure, once
        self.assertEqual(ev[2][0][1], "DOWN")
        self.assertIn("HTTP 503", ev[2][0][2])
        self.srv.script = lambda n, p: (200, b"ok", {})
        ev = [s.run_once(2000 + i * 60) for i in range(3)]
        self.assertEqual([len(e) for e in ev], [0, 1, 0])               # RECOVERED after the 2nd consecutive success
        self.assertEqual(ev[1][0][1], "RECOVERED")
        self.assertEqual(s.state["t1"]["status"], "up")

    def test_isolated_failures_do_not_trigger(self):
        s = self.sentinel([self.t()], fail_n=3, window_m=5, cooldown_s=0)
        codes = [200, 500, 200, 500, 200, 200, 500, 200]
        evs = []
        for i, c in enumerate(codes):
            self.srv.script = lambda n, p, c=c: (c, b"ok", {})
            evs += s.run_once(1000 + i * 60)
        self.assertEqual(evs, [])

    def test_slow_response_counts_as_failure(self):
        self.srv.script = lambda n, p: (time.sleep(0.4) or 200, b"ok", {})
        r = S.probe(self.t(latency_ms=100))
        self.assertFalse(r["ok"])
        self.assertIn("slow response", r["reason"])

    def test_timeout(self):
        self.srv.script = lambda n, p: (time.sleep(2.5) or 200, b"ok", {})
        r = S.probe(self.t(timeout_s=1))
        self.assertFalse(r["ok"])
        self.assertIn("timeout", r["reason"])

    def test_wrong_body_and_header_and_status(self):
        self.srv.script = lambda n, p: (200, b"maintenance page", {"X-Served-By": "aicc-edge"})
        self.assertIn("body", S.probe(self.t(expect_body="ok-token"))["reason"])
        self.assertTrue(S.probe(self.t(expect_header="X-Served-By: aicc"))["ok"])
        self.assertIn("header", S.probe(self.t(expect_header="X-Served-By: nginx"))["reason"])
        self.assertIn("HTTP 200 (expected 204)", S.probe(self.t(expect_status=204))["reason"])

    def test_tls_expiry_warning_once_per_cooldown(self):
        crt, key = make_cert(self.tmp, 5, "short")
        srv = self.server(crt, key)
        t = target(srv.base + "/healthz", ca_file=crt, tls_warn_days=14, name="short")
        s = self.sentinel([t], cooldown_s=1800)
        now = time.time()
        e1 = s.run_once(now)
        e2 = s.run_once(now + 60)
        self.assertEqual([k for _, k, _ in e1], ["WARNING"])
        self.assertIn("expires in", e1[0][2])
        self.assertEqual(e2, [])
        self.assertEqual(s.state["short"]["status"], "up")   # an expiring cert is a warning, not DOWN

    def test_untrusted_certificate_fails_closed(self):
        t = target(self.srv.base + "/healthz")     # no ca_file: self-signed cert must NOT be trusted
        r = S.probe(t)
        self.assertFalse(r["ok"])
        self.assertIn("TLS", r["reason"])

    def test_state_survives_restart(self):
        self.srv.script = lambda n, p: (500, b"", {})
        s1 = self.sentinel([self.t()], fail_n=2, window_m=3, cooldown_s=0)
        s1.run_once(1000); s1.run_once(1060)
        s2 = self.sentinel([self.t()], fail_n=2, window_m=3, cooldown_s=0)    # "restart"
        self.assertEqual(s2.state["t1"]["status"], "down")
        self.assertEqual(s2.run_once(1120), [])                                # no duplicate DOWN
        self.srv.script = lambda n, p: (200, b"ok", {})
        s2.run_once(1180)
        self.assertEqual(s2.run_once(1240)[0][1], "RECOVERED")


class RedirectsAndPolicy(Base):
    def test_redirect_off_target_refused_and_not_followed(self):
        evil = self.server()
        evil.script = lambda n, p: (200, b"ok", {})
        a = self.server()
        a.script = lambda n, p: (302, b"", {"Location": evil.base + "/pwn"})
        r = S.probe(target(a.base + "/", allow_http=True))
        self.assertFalse(r["ok"])
        self.assertEqual(r["reason"], "redirect off-target refused")
        self.assertEqual(evil.requests, [])      # the other origin was never contacted

    def test_redirect_to_other_port_same_host_is_off_target(self):
        other = self.server()
        a = self.server()
        a.script = lambda n, p: (301, b"", {"Location": other.base + "/"})
        self.assertEqual(S.probe(target(a.base + "/", allow_http=True))["reason"], "redirect off-target refused")

    def test_same_origin_redirect_followed_and_loop_capped(self):
        a = self.server()
        a.script = lambda n, p: (302, b"", {"Location": "/final"}) if p == "/start" else (200, b"ok", {})
        self.assertTrue(S.probe(target(a.base + "/start", allow_http=True))["ok"])
        a.script = lambda n, p: (302, b"", {"Location": "/loop"})
        self.assertEqual(S.probe(target(a.base + "/loop", allow_http=True))["reason"], "too many redirects")

    def test_non_https_refused_unless_explicit(self):
        with self.assertRaises(S.ConfigError):
            target("http://127.0.0.1:1/health")
        target("http://127.0.0.1:1/health", allow_http=True)

    def test_other_config_refusals(self):
        for kw in ({"url": "https://user:pw@example.com/"}, {"url": "ftp://example.com/"}, {"method": "POST"}, {"method": "PUT"},
                   {"timeout_s": 99}, {"name": "bad;name"}):
            with self.assertRaises(S.ConfigError, msg=str(kw)):
                target(**{"url": "https://example.com/", **kw}) if "url" not in kw else target(kw.pop("url"), **kw)
        with self.assertRaises(S.ConfigError):
            target("https://example.com/", method="HEAD", expect_body="x")

    def test_interval_below_60_refused(self):
        p = put(os.path.join(self.tmp, "c.toml"), '[sentinel]\ninterval_s = 30\n[[target]]\nname="a"\nurl="https://example.com/"\n')
        with self.assertRaises(S.ConfigError):
            S.load_config(p)
        self.assertEqual(S.main(["--config", p, "--plan"]), 2)

    def test_example_targets_file_loads_and_has_required_targets(self):
        cfg = S.load_config(os.path.join(os.path.dirname(__file__), "..", "targets.example.toml"))
        by = {t["name"]: t for t in cfg["targets"]}
        self.assertEqual(by["stage.copilt.org"]["url"], "https://stage.copilt.org/healthz")
        self.assertEqual(by["api.copilt.org"]["url"], "https://api.copilt.org/health")
        self.assertFalse(by["www.copilt.org"]["enabled"])
        self.assertGreaterEqual(cfg["sentinel"]["interval_s"], 60)

    def test_unreachable_and_dns_failure_are_failures_not_crashes(self):
        self.assertEqual(S.probe(target("http://127.0.0.1:9/", allow_http=True, timeout_s=2))["reason"], "connection refused")
        r = S.probe(target("https://does-not-exist.invalid/", timeout_s=3))
        self.assertFalse(r["ok"])


class Telegram(Base):
    def fake_tg(self):
        s = self.server()
        s.script = lambda n, p: (200, b'{"ok":true}', {})
        return s

    def secrets(self, mode=0o600):
        return put(os.path.join(self.tmp, "s.env"), "TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ0123456789\nTELEGRAM_CHAT_ID=-100123\n", mode)

    def test_disabled_without_secrets_sends_nothing(self):
        tg = self.fake_tg()
        app = self.server(); app.script = lambda n, p: (500, b"", {})
        s = self.sentinel([target(app.base + "/", allow_http=True)], tg_url=tg.base, fail_n=1, window_m=1, cooldown_s=0)
        s.run_once(1000)
        self.assertEqual(tg.requests, [])
        self.assertFalse(s.n.enabled)

    def test_dry_run_prints_and_never_contacts_telegram(self):
        tg = self.fake_tg()
        app = self.server(); app.script = lambda n, p: (500, b"", {})
        s = self.sentinel([target(app.base + "/", allow_http=True, name="stage.copilt.org")], dry=True, secrets=self.secrets(), tg_url=tg.base, fail_n=1, window_m=1, cooldown_s=0)
        s.run_once(1000)
        self.assertEqual(tg.requests, [])
        out = s.out.getvalue()
        self.assertIn("DRY-RUN", out)
        self.assertIn("[DOWN] stage.copilt.org", out)
        self.assertNotIn("ABCdefGh", out)

    def test_enabled_sends_down_and_recovered_to_fake_server(self):
        tg = self.fake_tg()
        app = self.server(); app.script = lambda n, p: (500, b"", {})
        s = self.sentinel([target(app.base + "/", allow_http=True, name="api.copilt.org")], secrets=self.secrets(), tg_url=tg.base, fail_n=1, window_m=1, recover_k=1, cooldown_s=0)
        s.run_once(1000)
        app.script = lambda n, p: (200, b"ok", {})
        s.run_once(1100)
        self.assertEqual(len(tg.requests), 2)
        self.assertIn("/bot123456789:", tg.requests[0]["path"])
        self.assertEqual(s.n.sent, 2)

    def test_plan_mode_opens_no_socket(self):
        p = put(os.path.join(self.tmp, "c.toml"), '[[target]]\nname="a"\nurl="https://example.com/"\n')
        def boom(*a, **k): raise AssertionError("network access")
        with mock.patch.object(socket.socket, "connect", boom), mock.patch.object(socket, "create_connection", boom), mock.patch.object(socket, "getaddrinfo", boom):
            out = io.StringIO()
            with mock.patch("sys.stdout", out):
                rc = S.main(["--config", p, "--plan"])
        self.assertEqual(rc, 0)
        self.assertIn("GET https://example.com/", out.getvalue())

    def test_messages_have_no_pii_and_secrets_file_permissions_enforced(self):
        n = S.Notifier(self.secrets(0o644), "obs", environ={}, log=lambda m: None)
        self.assertFalse(n.enabled)                 # world-readable secrets file refused
        n2 = S.Notifier(self.secrets(0o600), "obs", environ={}, log=lambda m: None)
        self.assertTrue(n2.enabled)
        msg = n2.render("DOWN", "api.copilt.org", "contact me@example.com from 203.0.113.9 token " + "A" * 40)
        self.assertNotIn("me@example.com", msg)
        self.assertNotIn("203.0.113.9", msg)
        self.assertNotIn("A" * 40, msg)

    def test_base_url_override_restricted(self):
        for bad in ("https://evil.example", "http://10.0.0.1:80", "http://127.0.0.1.evil.com:80"):
            with self.assertRaises(ValueError):
                S.Notifier("", "x", test_base_url=bad)

    def test_source_contains_no_write_methods(self):
        with open(S.__file__) as fh:
            src = fh.read()
        for bad in ('"DELETE"', '"PUT"', '"PATCH"', "method=\"POST\", headers={\"User-Agent\": UA, \"Accept"):
            self.assertNotIn(bad, src)
        self.assertIn('t["method"] not in ("GET", "HEAD")', src)


if __name__ == "__main__":
    unittest.main()
