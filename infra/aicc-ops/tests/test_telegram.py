import io
import os
import socket
import time
import unittest
import urllib.request
from unittest import mock

from aicc_ops import telegram as tg
from aicc_ops.alerts import Notification, default_rules, Obs, Window
from aicc_ops.config import load_config
from tests.helpers import TmpCase, BodyServer, put

TOKEN = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ0123456789"
CHAT = "-1001234567890"
NOTE = Notification("FIRING", "WARNING", "ram_high", "High memory use", "host", "memory used 91% (warn >= 90, critical >= 96)", 2_000_000, 1_999_000)


def cfg(**o):
    c = dict(load_config()["telegram"])
    c.update({"min_interval_s": 0.0, "backoff_s": 0.01, "retries": 3, **o})
    return c


class NoNetwork:
    """Context manager making any socket connect / urlopen fail the test."""

    def __enter__(self):
        def boom(*a, **k):
            raise AssertionError("network access attempted")
        self.ps = [mock.patch.object(socket.socket, "connect", boom), mock.patch.object(socket, "create_connection", boom),
                   mock.patch.object(urllib.request, "urlopen", boom), mock.patch.object(socket, "getaddrinfo", boom)]
        for p in self.ps:
            p.start()
        return self

    def __exit__(self, *a):
        for p in self.ps:
            p.stop()


class SecretsTests(TmpCase):
    def secrets(self, mode=0o600, body=None):
        p = os.path.join(self.tmp, "secrets.env")
        put(p, body or f"# comment\nTELEGRAM_BOT_TOKEN={TOKEN}\nTELEGRAM_CHAT_ID={CHAT}\n")
        os.chmod(p, mode)
        return p

    def test_reads_env_file_0600(self):
        self.assertEqual(tg.load_secrets(self.secrets(), {}), (TOKEN, CHAT))

    def test_refuses_world_accessible_or_group_writable(self):
        self.assertEqual(tg.load_secrets(self.secrets(0o644), {}), (None, None))
        self.assertEqual(tg.load_secrets(self.secrets(0o660), {}), (None, None))
        self.assertEqual(tg.load_secrets(self.secrets(0o604), {}), (None, None))
        self.assertEqual(tg.load_secrets(self.secrets(0o640), {}), (TOKEN, CHAT))   # root:aicc-ops 0640 is accepted

    def test_missing_or_incomplete(self):
        self.assertEqual(tg.load_secrets(os.path.join(self.tmp, "none"), {}), (None, None))
        self.assertEqual(tg.load_secrets(self.secrets(body="TELEGRAM_BOT_TOKEN=x\n"), {}), (None, None))

    def test_systemd_credentials_secrets_env(self):
        d = os.path.join(self.tmp, "cred2"); os.mkdir(d)
        put(os.path.join(d, "secrets.env"), f"TELEGRAM_BOT_TOKEN={TOKEN}\nTELEGRAM_CHAT_ID={CHAT}\n")
        self.assertEqual(tg.load_secrets("/nonexistent", {"CREDENTIALS_DIRECTORY": d}), (TOKEN, CHAT))

    def test_systemd_credentials(self):
        d = os.path.join(self.tmp, "cred"); os.mkdir(d)
        put(os.path.join(d, "telegram_bot_token"), TOKEN + "\n"); put(os.path.join(d, "telegram_chat_id"), CHAT)
        self.assertEqual(tg.load_secrets("/nonexistent", {"CREDENTIALS_DIRECTORY": d}), (TOKEN, CHAT))

    def test_config_has_no_secret_fields(self):
        self.assertFalse([k for k in load_config()["telegram"] if "token" in k or "chat" in k])


class AdapterTests(TmpCase):
    def secrets(self):
        p = os.path.join(self.tmp, "secrets.env")
        put(p, f"TELEGRAM_BOT_TOKEN={TOKEN}\nTELEGRAM_CHAT_ID={CHAT}\n")
        os.chmod(p, 0o600)
        return p

    def adapter(self, srv=None, secrets=True, dry_run=False, **over):
        logs = []
        c = cfg(secrets_file=self.secrets() if secrets else os.path.join(self.tmp, "absent.env"), **over)
        a = tg.TelegramAdapter(c, "aicc-test", dry_run=dry_run, out=io.StringIO(), log=logs.append,
                               test_base_url=srv.url if srv else None, environ={})
        a.logs = logs
        return a

    def test_dry_run_prints_and_opens_no_socket(self):
        with NoNetwork():
            a = self.adapter(dry_run=True, secrets=False)
            self.assertTrue(a.submit(NOTE))
            a.flush(1)
        out = a.out.getvalue()
        self.assertIn("DRY-RUN", out)
        self.assertIn("[WARNING] aicc-test", out)
        self.assertIn("memory used 91%", out)
        self.assertEqual(a.stats["sent"], 0)

    def test_dry_run_with_secrets_still_no_socket_and_no_token_in_output(self):
        with NoNetwork():
            a = self.adapter(dry_run=True)
            a.submit(NOTE)
        self.assertNotIn(TOKEN, a.out.getvalue())
        self.assertNotIn(CHAT, a.out.getvalue())

    def test_disabled_without_secrets_makes_no_request_and_logs_once(self):
        srv = BodyServer(b"{}")
        try:
            a = self.adapter(srv, secrets=False)
            self.assertFalse(a.enabled)
            self.assertFalse(a.submit(NOTE))
            self.assertFalse(a.submit(NOTE))
            a.flush(1)
            self.assertEqual(srv.requests, [])
            self.assertEqual(len([l for l in a.logs if "disabled" in l]), 1)
        finally:
            srv.close()

    def test_sends_to_fake_server_with_expected_payload(self):
        srv = BodyServer(b'{"ok":true}')
        try:
            a = self.adapter(srv)
            self.assertTrue(a.submit(NOTE))
            self.assertTrue(a.flush(5))
            r = srv.requests[0]
            self.assertEqual(r["method"], "POST")
            self.assertEqual(r["path"], f"/bot{TOKEN}/sendMessage")
            self.assertIn(b"chat_id=-1001234567890", r["body"])
            self.assertIn(b"High+memory+use", r["body"])
            self.assertNotIn(b"parse_mode", r["body"])   # plain text only
            self.assertEqual(a.stats["sent"], 1)
            self.assertFalse([l for l in a.logs if TOKEN in l])
        finally:
            srv.close()

    def test_retry_with_backoff_then_success(self):
        srv = BodyServer(handler_fn=lambda n, p: (500, b"err") if n < 3 else (200, b'{"ok":true}'))
        try:
            a = self.adapter(srv)
            a.sleep = lambda s: None
            a.submit(NOTE); a.flush(5)
            self.assertEqual(len(srv.requests), 3)
            self.assertEqual(a.stats["sent"], 1)
        finally:
            srv.close()

    def test_permanent_4xx_not_retried_and_failure_counted(self):
        srv = BodyServer(b'{"ok":false}', status=400)
        try:
            a = self.adapter(srv)
            a.submit(NOTE); a.flush(5)
            self.assertEqual(len(srv.requests), 1)
            self.assertEqual(a.stats["failed"], 1)
        finally:
            srv.close()

    def test_429_honours_retry_after(self):
        slept = []
        srv = BodyServer(handler_fn=lambda n, p: (429, b'{"parameters":{"retry_after":7}}') if n == 1 else (200, b"{}"))
        try:
            a = self.adapter(srv)
            a.sleep = slept.append
            a.submit(NOTE); a.flush(5)
            self.assertIn(7.0, slept)
            self.assertEqual(a.stats["sent"], 1)
        finally:
            srv.close()

    def test_unreachable_server_fails_without_blocking_caller(self):
        a = tg.TelegramAdapter(cfg(secrets_file=self.secrets(), retries=2), "h", out=io.StringIO(), log=lambda m: None,
                               test_base_url="http://127.0.0.1:9", environ={}, sleep=lambda s: None)
        t0 = time.monotonic()
        a.submit(NOTE)
        self.assertLess(time.monotonic() - t0, 0.5)   # submit() returns immediately
        a.flush(10)
        self.assertEqual(a.stats["failed"], 1)

    def test_hourly_rate_limit_and_summary(self):
        srv = BodyServer(b"{}")
        try:
            a = self.adapter(srv, max_per_hour=2)
            for i in range(5):
                a.submit(NOTE)
            a.flush(10)
            self.assertEqual(len(srv.requests), 2)
            self.assertEqual(a.stats["rate_limited"], 3)
        finally:
            srv.close()

    def test_queue_full_drops_not_blocks(self):
        a = self.adapter(BodyServer(b"{}"))
        a._ensure_thread = lambda: None   # nothing drains the queue
        for _ in range(150):
            a.submit_text("x")
        self.assertGreater(a.stats["dropped"], 0)

    def test_base_url_override_only_loopback_http(self):
        for bad in ("https://evil.example", "http://127.0.0.1.evil.example:80", "http://10.0.0.1:80", "http://localhost:80"):
            with self.assertRaises(ValueError):
                tg.TelegramAdapter(cfg(secrets_file="/nonexistent"), "h", test_base_url=bad)
        a = tg.TelegramAdapter(cfg(secrets_file="/nonexistent"), "h", log=lambda m: None)
        self.assertEqual(a.base, "https://api.telegram.org")

    def test_no_inbound_surface(self):
        import inspect
        src = inspect.getsource(tg)
        for word in ("getUpdates", "setWebhook", "serve_forever", "listen("):
            self.assertNotIn(word, src)


class PiiTests(unittest.TestCase):
    BAD = {
        "email": "contact buyer@example.com now",
        "ipv4": "from 203.0.113.9 blocked",
        "telegram_token": TOKEN,
        "long_secret": "key=" + "A" * 40,
        "cookie": "Cookie: wordpress_logged_in_abc=1",
        "order_number": "refund for order #48213 failed",
    }

    def test_scanner_detects_each_class(self):
        for cls, sample in self.BAD.items():
            self.assertIn(cls, tg.scan_pii(sample), cls)

    def test_sanitize_redacts(self):
        for cls, sample in self.BAD.items():
            self.assertEqual(tg.scan_pii(tg.sanitize(sample)), [], cls)
        self.assertEqual(tg.sanitize("ok 127.0.0.1 fine"), "ok 127.0.0.1 fine")

    def test_every_template_is_pii_free(self):
        for name, t in tg.TEMPLATES.items():
            self.assertEqual(tg.scan_pii(t), [], name)

    def test_every_rendered_alert_from_every_rule_is_pii_free(self):
        """Drive each default rule with plausible window data, render every observation as every kind."""
        cfgd = load_config()
        w = Window(30, stale={})
        samples = {"svc.mysql.active": 0, "svc.mysql.failed": 1, "svc.mysql.present": 1, "svc.mysql.restarts": 9, "edge.up": 0, "edge.status": 502,
                   "caddy.up": 0, "caddy.rate_5xx": 1.0, "caddy.req_rate": 2.0, "mem.used_pct": 97, "swap.in_pps": 2000, "swap.out_pps": 400,
                   "cpu.used_pct": 99, "disk.root.used_pct": 95, "disk.root.inodes_used_pct": 96, "fpm.up": 1, "fpm.listen_queue": 20,
                   "fpm.active_ratio": 1.0, "fpm.max_children_reached_delta": 2, "mysql.up": 0, "mysql.conn_pressure_pct": 99,
                   "backup.newest_age_s": 99 * 3600, "backup.status_ok": 0, "cert.days_left": 2, "cert.ok": 0, "collector.mysql.ok": 0,
                   "ops.db_bytes": 149e6, "ops.write_blocked": 1, "ops.fs_free_pct": 4.0, "cp.wc_cron_last_run_age_seconds": 99999}
        for i in range(12):
            w.push(1000 + i * 30, {**samples, "svc.mysql.restarts": 1 + i})
        texts = 0
        for r in default_rules(cfgd):
            if r.fn is None:
                continue
            for o in r.fn(w, dict(r.params)):
                for kind in ("FIRING", "RECOVERED", "ESCALATED", "REMINDER", "FLAPPING"):
                    for sev in ("WARNING", "CRITICAL"):
                        n = Notification(kind, sev, o.rule, r.title, o.scope, o.text, 2_000_000, 1_999_000)
                        txt = tg.render(n, "aicc-staging")
                        self.assertEqual(tg.scan_pii(txt), [], f"{o.rule}/{kind}: {txt}")
                        self.assertNotIn("[redacted", txt, f"{o.rule} text needed redaction: {txt}")
                        texts += 1
        self.assertGreater(texts, 100)

    def test_digest_template(self):
        t = tg.render_digest("h", "HEALTHY", ["RAM used: 41%", "Active alerts: 0"])
        self.assertIn("Capacity verdict: HEALTHY", t)
        self.assertEqual(tg.scan_pii(t), [])

    def test_digest_off_by_default(self):
        self.assertFalse(load_config()["telegram"]["digest_enabled"])


if __name__ == "__main__":
    unittest.main()
