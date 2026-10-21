import csv
import http.client
import io
import json
import re
import socket
import threading
import time
import unittest

from aicc_ops import export as exp
from aicc_ops.alerts import Obs
from aicc_ops.app import Runtime
from aicc_ops.cli import main as cli_main
from aicc_ops.config import load_config
from aicc_ops.ui import make_server, UnsafeBind, validate_bind, CSP
from tests.helpers import TmpCase, make_store, make_cfg

COLLECTORS_OFF = {"collectors": {k: {"enabled": False} for k in ("host", "caddy", "phpfpm", "mysql", "cp", "backups", "cert", "edge", "postgres")}}


def seeded_runtime(tmp, hours=3):
    cfg = make_cfg(tmp, **COLLECTORS_OFF)
    st = make_store(tmp)
    now = int(time.time()) // 30 * 30
    for i in range(hours * 120):
        t = now - (hours * 3600) + i * 30
        st.write_sample(t, {"cpu.used_pct": 20 + (i % 40), "mem.used_pct": 60.0, "mem.total_bytes": 2 * 1024 ** 3, "mem.used_bytes": 1.2 * 1024 ** 3,
                            "mem.available_bytes": 0.8 * 1024 ** 3, "swap.total_bytes": 2 * 1024 ** 3, "swap.used_bytes": 1e7, "swap.in_pps": 0, "swap.out_pps": 0,
                            "disk.root.total_bytes": 50e9, "disk.root.used_bytes": 10e9, "disk.root.used_pct": 20, "cpu.vcpus": 1, "load.1": 0.4, "load.5": 0.3, "load.15": 0.2,
                            "load.per_vcpu": 0.4, "uptime.seconds": 86400 * 3, "svc.mysql.active": 1, "svc.mysql.restarts": 0, "caddy.up": 1, "caddy.req_rate": 2.0,
                            "caddy.rate_2xx": 1.9, "caddy.rate_5xx": 0.0, "caddy.lat_p95_ms": 120, "collector.host.ok": 1, "collector.host.duration_ms": 12,
                            "ops.db_bytes": 1e6, "ops.rss_bytes": 30e6})
    st.rollup(now)
    st.add_alert_event(now - 100, "x:y", "x", "y", "CRITICAL", "FIRING", "=HYPERLINK(\"http://evil\")")
    st.add_alert_event(now - 50, "x:z", "x", "z", "WARNING", "FIRING", "+cmd|' /C calc'!A0")
    rt = Runtime(cfg, st, None)
    return rt, st


class Base(TmpCase):
    def setUp(self):
        super().setUp()
        self.rt, self.st = seeded_runtime(self.tmp)
        self.srv = make_server(self.rt, "127.0.0.1", 0, max_threads=4, timeout=3)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True).start()
        self.addCleanup(lambda: (self.srv.shutdown(), self.srv.server_close()))

    def get(self, path, method="GET", host=None, body=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        hdrs = {"Host": host} if host else {}
        c.request(method, path, body=body, headers=hdrs)
        r = c.getresponse()
        data = r.read()
        h = {k.lower(): v for k, v in r.getheaders()}
        c.close()
        return r.status, h, data


class Routes(Base):
    def test_pages_200_and_content(self):
        for path, needle in (("/", "Capacity verdict"), ("/history?group=host&range=24h", "<svg"), ("/history?group=caddy&range=7d", "Requests per second"),
                             ("/history?group=cp&range=30d", "Control Plane"), ("/alerts", "Alert history"), ("/capacity", "Reasons"),
                             ("/config", "redacted"), ("/export", "Known metrics"), ("/healthz", "ok")):
            st, h, body = self.get(path)
            self.assertEqual(st, 200, path)
            self.assertIn(needle, body.decode(), path)

    def test_reboot_pending_note_on_capacity_pages(self):
        """Architecture review M-2: the capacity page and the overview card show the note when host.reboot_required is 1, and nothing otherwise."""
        for path in ("/capacity", "/"):
            self.assertNotIn("reboot is pending", self.get(path)[2].decode())
        with self.rt._lock:
            self.rt._latest["host.reboot_required"] = (1.0, time.time())
        self.rt._cap_cache = (0, None)
        for path in ("/capacity", "/"):
            st, _, body = self.get(path)
            self.assertEqual(st, 200)
            self.assertIn("A host reboot is pending", body.decode(), path)

    def test_overview_capacity_comparisons(self):
        body = self.get("/")[2].decode()
        self.assertIn("RAM 1.2 GiB / 2.0 GiB — 60%", body)
        self.assertIn("Swap", body)
        self.assertIn("Disk 9.3 GiB / 46.6 GiB", body)
        self.assertIn("CPU (1 vCPU)", body)
        self.assertIn("No active alerts", body)

    def test_unknown_and_traversal_are_404_and_bad_params_400(self):
        for p in ("/nope", "/assets/../../etc/passwd", "/assets/%2e%2e/%2e%2e/etc/passwd", "/../etc/passwd", "/static/ops.css"):
            self.assertEqual(self.get(p)[0], 404, p)
        self.assertEqual(self.get("/history?group=../x&range=24h")[0], 400)
        self.assertEqual(self.get("/history?group=host&range=99y")[0], 400)
        self.assertEqual(self.get("/" + "a" * 3000)[0], 414)

    def test_get_only(self):
        for m in ("POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"):
            st, h, _ = self.get("/", method=m, body=b"x=1" if m in ("POST", "PUT", "PATCH") else None)
            self.assertEqual(st, 405, m)
            self.assertEqual(h["allow"], "GET")

    def test_security_headers_and_no_cookies(self):
        for path in ("/", "/history?group=host", "/assets/ops.css", "/export.json", "/nope"):
            st, h, _ = self.get(path)
            self.assertEqual(h["content-security-policy"], CSP)
            self.assertEqual(h["x-content-type-options"], "nosniff")
            self.assertEqual(h["cache-control"], "no-store")
            self.assertNotIn("set-cookie", h)
            self.assertEqual(h["x-frame-options"], "DENY")
        csp = self.get("/")[1]["content-security-policy"]
        self.assertIn("default-src 'none'", csp)
        self.assertNotIn("unsafe-inline", csp)
        self.assertNotIn("unsafe-eval", csp)
        self.assertIn("script-src 'none'", csp)

    def test_html_has_no_script_inline_style_or_external_requests(self):
        for path in ("/", "/history?group=host&range=7d", "/alerts", "/capacity", "/config"):
            html = self.get(path)[2].decode()
            self.assertNotRegex(html, r"(?i)<script")
            self.assertNotRegex(html, r"(?i)\sstyle=")
            self.assertNotRegex(html, r"(?i)\son\w+=")
            self.assertEqual(re.findall(r"""(?:src|href)=["'](https?:)?//""", html), [], path)
            self.assertIn('<meta name="viewport"', html)
            self.assertIn('lang="en"', html)
            self.assertIn('href="#main"', html)

    def test_dns_rebinding_host_header_rejected(self):
        self.assertEqual(self.get("/", host="evil.example")[0], 403)
        self.assertEqual(self.get("/", host="evil.example:9190")[0], 403)
        self.assertEqual(self.get("/", host="localhost:9190")[0], 200)
        self.assertEqual(self.get("/", host="127.0.0.1")[0], 200)
        self.assertEqual(self.get("/", host="[::1]:9190")[0], 200)

    def test_host_header_authority_is_parsed_strictly(self):
        """Security review I2: `localhost:9190@evil` was cut at the last colon and accepted as `localhost`."""
        from aicc_ops.util import host_from_header
        for bad in ("localhost:9190@evil", "localhost@evil", "user@localhost", "localhost evil", "localhost :9190", " localhost", "localhost\t", "localhost/x", "localhost?x=1", "localhost#f", "localhost\\evil",
                    "localhost:99999", "localhost:", ":9190", "", "127.0.0.1:9190@evil.example", "localhost:9190:80", "[::1", "[::1]x", "loc\x00alhost"):
            self.assertIsNone(host_from_header(bad), repr(bad))
            if bad and bad == bad.strip() and "\x00" not in bad:   # (HTTP strips leading/trailing blanks of a header value itself)
                try:
                    st = self.get("/", host=bad)[0]
                except Exception:
                    continue   # the HTTP client itself refuses to send some of them
                self.assertEqual(st, 403, repr(bad))
        for good, want in (("localhost", "localhost"), ("LOCALHOST:9190", "localhost"), ("127.0.0.1:9190", "127.0.0.1"), ("[::1]:9190", "[::1]"), ("[::1]", "[::1]")):
            self.assertEqual(host_from_header(good), want)
        self.assertEqual(self.get("/", host="[::1]:9190")[0], 200)

    def test_no_secrets_in_any_response(self):
        self.rt.cfg["telegram"]["fake_token"] = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ0123456789"
        body = self.get("/config")[2].decode()
        self.assertNotIn("ABCdefGh", body)
        self.assertIn("***", body)

    def test_server_error_does_not_leak_internals(self):
        self.rt.capacity = lambda: (_ for _ in ()).throw(RuntimeError("secret path /etc/shadow"))
        st, _, body = self.get("/capacity")
        self.assertEqual(st, 500)
        self.assertNotIn(b"shadow", body)
        self.assertNotIn(b"Traceback", body)

    def test_active_alert_shown(self):
        self.rt.engine.process([Obs("db_down", "mysql", True, False, "CRITICAL", "MySQL is unreachable")] * 1, time.time())
        self.rt.engine.process([Obs("db_down", "mysql", True, False, "CRITICAL", "MySQL is unreachable")] * 1, time.time() + 30)
        body = self.get("/")[2].decode()
        self.assertIn("MySQL is unreachable", body)

    def test_thread_cap_returns_503(self):
        holders = []
        for _ in range(4):
            s = socket.create_connection(("127.0.0.1", self.port)); s.sendall(b"GET / HT"); holders.append(s)  # incomplete request pins a worker
        time.sleep(0.3)
        c = socket.create_connection(("127.0.0.1", self.port)); c.settimeout(3)
        c.sendall(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        self.assertIn(b"503", c.recv(200))
        c.close()
        for s in holders:
            s.close()

    def test_slow_client_times_out(self):
        s = socket.create_connection(("127.0.0.1", self.port)); s.settimeout(6)
        s.sendall(b"GET / HT")
        t0 = time.time()
        data = s.recv(100)   # server closes after its 3 s request timeout
        self.assertLess(time.time() - t0, 5.5)
        s.close()


class Exports(Base):
    def test_json_export(self):
        st, h, body = self.get("/export.json?range=24h&metrics=cpu.used_pct,mem.used_pct")
        self.assertEqual(st, 200)
        self.assertTrue(h["content-type"].startswith("application/json"))
        d = json.loads(body)
        self.assertEqual(set(d["metrics"]), {"cpu.used_pct", "mem.used_pct"})
        self.assertEqual(d["columns"], ["ts", "avg", "min", "max", "p95"])
        self.assertGreater(len(d["metrics"]["cpu.used_pct"]), 10)
        self.assertLessEqual(len(d["metrics"]["cpu.used_pct"]), exp.MAX_POINTS_PER_METRIC)
        self.assertIn("attachment", h["content-disposition"])

    def test_csv_export(self):
        st, h, body = self.get("/export.csv?range=6h&metrics=cpu.used_pct")
        self.assertEqual(st, 200)
        self.assertTrue(h["content-type"].startswith("text/csv"))
        rows = list(csv.reader(io.StringIO(body.decode())))
        self.assertEqual(rows[0], ["metric", "time_utc", "ts", "avg", "min", "max", "p95"])
        self.assertEqual(rows[1][0], "cpu.used_pct")

    def test_validation_rejects_bad_input(self):
        bad = ["/export.json?range=10y", "/export.json?metrics=cpu.used_pct;drop", "/export.json?metrics=../../etc/passwd", "/export.json?metrics=unknown.metric",
               "/export.json?metrics=" + ",".join(f"m{i}" for i in range(25)), "/export.json?foo=1", "/export.json?range=24h&range=7d",
               "/export.csv?kind=evil", "/export.csv?kind=alerts&limit=99999", "/export.csv?kind=alerts&limit=-1", "/export.json?metrics=" + "a" * 2000,
               "/export.json?metrics=cpu.used_pct%00"]
        for p in bad:
            self.assertEqual(self.get(p)[0], 400, p)

    def test_csv_injection_neutralised_in_alert_export(self):
        st, h, body = self.get("/export.csv?kind=alerts")
        self.assertEqual(st, 200)
        rows = list(csv.reader(io.StringIO(body.decode())))
        msgs = [r[-1] for r in rows[1:]]
        self.assertTrue(all(not m or m[0] not in "=+-@" for m in msgs), msgs)
        self.assertIn("'=HYPERLINK", " ".join(msgs))
        self.assertIn("'+cmd", " ".join(msgs))

    def test_alert_json_export(self):
        d = json.loads(self.get("/export.json?kind=alerts&limit=1")[2])
        self.assertEqual(len(d["alerts"]), 1)

    def test_bounded_size(self):
        st, _, body = self.get("/export.json?range=365d&metrics=" + ",".join(["cpu.used_pct"] * 3))
        self.assertEqual(st, 200)
        self.assertLess(len(body), 2_000_000)

    def test_csv_cell_unit(self):
        for v in ("=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx", " =1"):
            self.assertTrue(exp.csv_cell(v).startswith("'"), v)
        self.assertEqual(exp.csv_cell("plain"), "plain")
        self.assertEqual(exp.csv_cell(-5.0), -5.0)   # numbers are not touched


class BindSafety(TmpCase):
    def test_validate_bind(self):
        for ok in ("127.0.0.1", "127.0.0.2", "::1", "localhost", "[::1]"):
            validate_bind(ok)
        for bad in ("0.0.0.0", "::", "", "192.168.1.5", "10.0.0.1", "203.0.113.4", "example.com", "*"):
            with self.assertRaises(UnsafeBind, msg=bad):
                validate_bind(bad)
        validate_bind("0.0.0.0", unsafe=True)   # only with the explicit flag

    def test_make_server_refuses_without_binding(self):
        rt, _ = seeded_runtime(self.tmp)
        with self.assertRaises(UnsafeBind):
            make_server(rt, "0.0.0.0", 0)
        s = make_server(rt, "127.0.0.1", 0)
        self.assertEqual(s.server_address[0], "127.0.0.1")
        s.server_close()

    def test_cli_exits_2_for_non_loopback_before_creating_anything(self):
        import os
        data = os.path.join(self.tmp, "should-not-exist")
        rc = cli_main(["run", "--bind", "0.0.0.0", "--port", "0", "--data-dir", data])
        self.assertEqual(rc, 2)
        self.assertFalse(os.path.exists(data))

    def test_example_config_and_unit_never_set_unsafe(self):
        import os
        root = os.path.join(os.path.dirname(__file__), "..")
        with open(os.path.join(root, "systemd", "aicc-ops.service")) as fh:
            live = [l for l in fh.read().splitlines() if not l.lstrip().startswith("#")]
        self.assertFalse([l for l in live if "unsafe" in l.lower()])
        self.assertTrue([l for l in live if l.startswith("ExecStart=") and l.rstrip().endswith(" run")])
        with open(os.path.join(root, "config", "aicc-ops.example.toml")) as fh:
            cfg = fh.read()
        self.assertIn('bind = "127.0.0.1"', cfg)


if __name__ == "__main__":
    unittest.main()
