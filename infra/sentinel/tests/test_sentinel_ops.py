"""Tests for the staging-deployment extensions: stage-tagged checks, expect_ip, identity bodies, one-shot persistence across invocations,
flapping, observer-offline guard, heartbeat/--status, local fallback notifier, the committed targets files, the macOS plist template,
install-launchd.sh (dry-run and apply against a stub launchctl in a temp HOME) and sentinel-secrets.sh. Loopback fakes only; no real host is contacted
and the real launchctl / osascript are never run."""
import io
import json
import os
import plistlib
import re
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import sentinel as S  # noqa: E402
from tests.test_sentinel import HAVE_OPENSSL, Base, make_cert, put, target  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MACOS = os.path.join(ROOT, "macos")
STAGE = os.path.join(ROOT, "targets.stage.toml")
PROD = os.path.join(ROOT, "targets.production.example.toml")
BASH = "/bin/bash" if os.path.exists("/bin/bash") else "bash"
REAL_GAI = socket.getaddrinfo
IDENT_JSON = b'{"env":"staging","host":"stage.copilt.org","id":"c4cae5ab234f10570763ecd9e9a36a16"}'
TOKEN = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ0123456"


def rd(path, mode="r"):
    with open(path, mode) as fh:
        return fh.read()


def R(ok=True, stage="", reason="", **kw):
    return {"ok": ok, "stage": stage, "reason": reason, "status": 200 if ok else None, "latency_ms": 5.0, "tls_days": None, "dns": None, **kw}


def fake_gai(mapping):
    def f(host, port, *a, **k):
        if host in mapping:
            r = mapping[host]
            if callable(r):
                return r()
            if isinstance(r, Exception):
                raise r
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in r]
        return REAL_GAI(host, port, *a, **k)
    return f


class Ops(Base):
    def mk(self, targets, probes=None, dry=False, secrets=None, tg_url=None, control=None, local=None, hb=None, quiet=False, **sk):
        out = io.StringIO()
        self.logs = []
        n = S.Notifier(secrets or os.path.join(self.tmp, "none.env"), "test-observer", dry_run=dry, out=out, log=lambda m: None,
                       test_base_url=tg_url, environ={}, sleep=lambda s: None)
        cfg = {"sentinel": {**S.DEFAULTS, "state_file": os.path.join(self.tmp, "state.json"), **sk}, "targets": targets}
        s = S.Sentinel(cfg, n, os.path.join(self.tmp, "state.json"), log=self.logs.append, heartbeat_path=hb, control=control, local_notify=local, quiet_ok=quiet)
        s.out = out
        return s

    def secrets(self, mode=0o600):
        return put(os.path.join(self.tmp, "s.env"), f"TELEGRAM_BOT_TOKEN={TOKEN}\nTELEGRAM_CHAT_ID=-100123\n", mode)


# ------------------------------------------------------------------------------------------------------------ stage-tagged checks
class Stages(Ops):
    def test_dns_expect_ip_mismatch_is_a_dns_failure_and_no_request_is_sent(self):
        srv = self.server()
        t = target(f"http://stage.test:{srv.port}/healthz", allow_http=True, expect_ip="127.0.0.1")
        with mock.patch.object(socket, "getaddrinfo", fake_gai({"stage.test": ["203.0.113.5"]})):
            r = S.probe(t)
        self.assertFalse(r["ok"])
        self.assertEqual(r["stage"], "dns")
        self.assertIn("expect_ip", r["reason"])
        self.assertEqual(r["dns"], ["203.0.113.5"])
        self.assertEqual(srv.requests, [])               # a hijacked name is never connected to

    def test_dns_expect_ip_match_and_extra_record(self):
        srv = self.server()
        t = target(f"http://stage.test:{srv.port}/healthz", allow_http=True, expect_ip=["127.0.0.1"])
        with mock.patch.object(socket, "getaddrinfo", fake_gai({"stage.test": ["127.0.0.1"]})):
            self.assertTrue(S.probe(t)["ok"])
        with mock.patch.object(socket, "getaddrinfo", fake_gai({"stage.test": ["127.0.0.1", "203.0.113.5"]})):
            r = S.probe(t)
        self.assertEqual((r["ok"], r["stage"]), (False, "dns"))     # an unexpected additional address is a change too

    def test_dns_literal_ip_and_resolution_failure_and_timeout(self):
        r = S.probe(target("http://127.0.0.1:9/", allow_http=True, expect_ip="203.0.113.5", timeout_s=2))
        self.assertEqual((r["stage"], r["ok"]), ("dns", False))
        with mock.patch.object(socket, "getaddrinfo", fake_gai({"gone.test": socket.gaierror(-2, "x")})):
            r = S.probe(target("http://gone.test:1/", allow_http=True, timeout_s=2))
        self.assertEqual((r["stage"], r["reason"]), ("dns", "DNS resolution failed"))
        with mock.patch.object(socket, "getaddrinfo", fake_gai({"slow.test": lambda: time.sleep(2.5) or []})):
            r = S.probe(target("http://slow.test:1/", allow_http=True, timeout_s=1))
        self.assertEqual(r["stage"], "dns")
        self.assertIn("timed out", r["reason"])

    def test_config_rejects_bad_expect_ip_body_and_interval(self):
        for kw in ({"expect_ip": "not-an-ip"}, {"expect_ip": ["1.2.3.4", "x"]}, {"expect_body": ["ok", ""]}, {"interval_s": 30}, {"interval_s": 1.5}):
            with self.assertRaises(S.ConfigError, msg=str(kw)):
                target("https://example.com/", **kw)
        target("https://example.com/", expect_ip=["1.2.3.4", "2001:db8::1"], expect_body=["a", "b"], interval_s=300)

    def test_connect_http_body_header_latency_stages(self):
        self.assertEqual(S.probe(target("http://127.0.0.1:9/", allow_http=True, timeout_s=2))["stage"], "connect")
        srv = self.server()
        t = lambda **kw: target(srv.base + "/", allow_http=True, **kw)  # noqa: E731
        srv.script = lambda n, p: (503, b"x", {})
        self.assertEqual(S.probe(t())["stage"], "http")
        srv.script = lambda n, p: (200, b"nothing", {})
        self.assertEqual(S.probe(t(expect_body="ok"))["stage"], "body")
        self.assertEqual(S.probe(t(expect_header="X-A: b"))["stage"], "header")
        srv.script = lambda n, p: (time.sleep(0.3) or 200, b"ok", {})
        r = S.probe(t(latency_ms=50))
        self.assertEqual((r["stage"], r["ok"]), ("latency", False))

    @unittest.skipUnless(HAVE_OPENSSL, "openssl required")
    def test_tls_stage_and_days_to_expiry(self):
        crt, key = make_cert(self.tmp, 40)
        srv = self.server(crt, key)
        r = S.probe(target(srv.base + "/", ca_file=crt))
        self.assertTrue(r["ok"])
        self.assertAlmostEqual(r["tls_days"], 40, delta=0.2)
        r = S.probe(target(srv.base + "/"))              # untrusted: fails closed at the TLS stage
        self.assertEqual((r["ok"], r["stage"]), (False, "tls"))
        # warning threshold arithmetic (exact boundary)
        ts, cfg = S.new_state(), {"cooldown_s": 1800}
        tg = {"tls_warn_days": 14}
        self.assertIsNone(S.tls_note(ts, {"tls_days": 14.5}, tg, cfg, 100_000))
        n = S.tls_note(ts, {"tls_days": 13.2}, tg, cfg, 100_000)
        self.assertEqual(n[0], "WARNING")
        self.assertIn("13 days", n[1])
        self.assertIsNone(S.tls_note(ts, {"tls_days": 13.2}, tg, cfg, 100_060))     # once per 8 x cooldown

    def test_down_message_names_the_failing_part(self):
        srv = self.server()
        srv.script = lambda n, p: (200, b"maintenance", {})
        s = self.mk([target(srv.base + "/", allow_http=True, expect_body="ok")], fail_n=1, window_m=1, cooldown_s=0)
        ev = s.run_once(1000)
        self.assertEqual(ev[0][1], "DOWN")
        self.assertIn("failed at: body", ev[0][2])
        self.assertTrue(any("EVENT DOWN" in m for m in self.logs))

    def test_identity_body_substrings(self):
        ident = next(t for t in S.load_config(STAGE)["targets"] if t["name"] == "stage-identity")
        srv = self.server()
        srv.script = lambda n, p: (200, IDENT_JSON, {})
        mk = lambda body: target(srv.base + "/.well-known/aicc-stage-identity", allow_http=True, expect_body=body)  # noqa: E731
        self.assertTrue(S.probe(mk(ident["expect_body"]))["ok"])
        srv.script = lambda n, p: (200, IDENT_JSON.replace(b"c4cae5ab", b"deadbeef"), {})
        r = S.probe(mk(ident["expect_body"]))
        self.assertEqual((r["stage"], r["reason"]), ("body", "expected body text not found (item 2 of 2)"))
        srv.script = lambda n, p: (200, IDENT_JSON.replace(b"stage.copilt.org", b"www.copilt.org"), {})
        self.assertIn("item 1 of 2", S.probe(mk(ident["expect_body"]))["reason"])


# ------------------------------------------------------------------------------------------------------------ flapping and the state machine
class Flapping(Ops):
    def run_pattern(self, pattern, **sk):
        seq = iter(pattern)
        with mock.patch.object(S, "probe", side_effect=lambda t, now=None: R(*next(seq))):
            s = self.mk([target("https://example.com/")], cooldown_s=0, **sk)
            events = []
            for i in range(len(pattern)):
                events += s.run_once(1000 + 60 * i)
        return events

    def test_every_third_check_failing_never_pages(self):
        ok, bad = (True, "", ""), (False, "http", "HTTP 503 (expected 200)")
        self.assertEqual(self.run_pattern([bad, ok, ok] * 20, fail_n=3, window_m=5), [])

    def test_single_transient_failure_of_every_kind_never_pages(self):
        for stage in ("dns", "connect", "tls", "http", "body", "header", "latency"):
            ev = self.run_pattern([(True, "", "")] * 3 + [(False, stage, "x")] + [(True, "", "")] * 6, fail_n=3, window_m=5)
            self.assertEqual(ev, [], stage)
            ev = self.run_pattern([(False, stage, "x")] + [(True, "", "")] * 6, fail_n=2, window_m=3)
            self.assertEqual(ev, [], stage)

    def test_sustained_alternation_pages_once_not_repeatedly(self):
        ok, bad = (True, "", ""), (False, "http", "HTTP 500 (expected 200)")
        ev = self.run_pattern([bad, ok] * 15, fail_n=3, window_m=5, recover_k=2)
        self.assertEqual([k for _, k, _ in ev], ["DOWN"])              # 3 of 5 is a real problem; one notice, no flapping spam

    def test_real_server_flapping(self):
        srv = self.server()
        srv.script = lambda n, p: (503 if n % 3 == 0 else 200, b"ok", {})
        s = self.mk([target(srv.base + "/", allow_http=True)], fail_n=3, window_m=5, cooldown_s=0)
        evs = []
        for i in range(12):
            evs += s.run_once(1000 + 60 * i)
        self.assertEqual(evs, [])

    def test_recovered_only_after_a_sent_down(self):
        seq = [R(False, "http", "x")] * 3 + [R()] * 3
        with mock.patch.object(S, "probe", side_effect=lambda t, now=None: seq.pop(0)):
            s = self.mk([target("https://example.com/")], fail_n=3, window_m=5, recover_k=2, cooldown_s=10**6)
            s.state["t1"] = {**S.new_state(), "last_down_notice": 1000.0}     # a DOWN notice went out moments ago: cooldown suppresses the next one
            ev = []
            for i in range(6):
                ev += s.run_once(1000 + 60 * i)
        self.assertEqual(ev, [])                                                # no DOWN was sent, so no RECOVERED either
        self.assertEqual(s.state["t1"]["status"], "up")

    def test_stale_window_is_dropped_after_a_long_gap(self):
        seq = [R(False, "http", "x")] * 3
        with mock.patch.object(S, "probe", side_effect=lambda t, now=None: seq.pop(0)):
            s = self.mk([target("https://example.com/")], fail_n=3, window_m=5, cooldown_s=0, stale_after_s=1800)
            self.assertEqual(s.run_once(1000), [])
            self.assertEqual(s.run_once(1060), [])
            self.assertEqual(s.run_once(1060 + 3600), [])      # the Mac slept an hour: two old failures + one new one is not 3 of 5

    def test_failed_down_delivery_is_retried(self):
        tg = self.server()
        tg.script = lambda n, p: (400, b'{"ok":false}', {})
        with mock.patch.object(S, "probe", return_value=R(False, "http", "x")):
            s = self.mk([target("https://example.com/")], secrets=self.secrets(), tg_url=tg.base, fail_n=1, window_m=1, cooldown_s=1800)
            s.run_once(1_700_000_000)
            tg.script = lambda n, p: (200, b'{"ok":true}', {})
            s.run_once(1_700_000_060)
        self.assertEqual(s.n.sent, 1)                          # delivered on the second attempt, not silently dropped
        self.assertTrue(s.state["t1"]["down_notified"])

    def test_observer_offline_guard(self):
        with mock.patch.object(S, "probe", return_value=R(False, "dns", "DNS resolution failed")):
            s = self.mk([target("https://example.com/")], control=lambda: False, fail_n=1, window_m=1, cooldown_s=0)
            self.assertEqual(s.run_once(1000), [])
            self.assertEqual(s.state["t1"]["window"], [])       # discarded, not counted
            self.assertTrue(any("inconclusive" in m for m in self.logs))
            os.remove(os.path.join(self.tmp, "state.json"))
            s2 = self.mk([target("https://example.com/")], control=lambda: True, fail_n=1, window_m=1, cooldown_s=0)
            self.assertEqual(s2.run_once(1000)[0][1], "DOWN")   # control reachable: the target really is unreachable
        calls = []
        with mock.patch.object(S, "probe", return_value=R(False, "http", "HTTP 500")):
            os.remove(os.path.join(self.tmp, "state.json"))
            s3 = self.mk([target("https://example.com/")], control=lambda: calls.append(1) or False, fail_n=1, window_m=1, cooldown_s=0)
            self.assertEqual(s3.run_once(1000)[0][1], "DOWN")
        self.assertEqual(calls, [])                             # the control host is only touched after a dns/connect failure


# ------------------------------------------------------------------------------------------------------------ one-shot, state, heartbeat, status
class OneShot(Ops):
    def cfg_file(self, url, extra=""):
        return put(os.path.join(self.tmp, "c.toml"), f'[sentinel]\ncooldown_s = 0\n{extra}\n[[target]]\nname = "app"\nurl = "{url}"\nallow_http = true\nexpect_body = "ok"\n')

    def invoke(self, *args):
        out = io.StringIO()
        with mock.patch("sys.stdout", out), mock.patch("sys.stderr", io.StringIO()):
            rc = S.main(list(args))
        return rc, out.getvalue()

    def test_failure_counted_across_two_invocations_then_recovered_after_k(self):
        srv = self.server()
        srv.script = lambda n, p: (503, b"bad", {})
        cfg = self.cfg_file(srv.base + "/")
        st = os.path.join(self.tmp, "ci", "state.json")
        common = ["--config", cfg, "--once", "--dry-run", "--state-file", st, "--fail-n", "2", "--window-m", "3"]
        rc, out = self.invoke(*common)
        self.assertEqual(rc, 0)
        self.assertNotIn("[DOWN]", out)                                 # first failure: no page
        rc, out = self.invoke(*common)                                  # a SEPARATE invocation, state restored from the file
        self.assertIn("[DOWN] app", out)
        self.assertIn("failed at: http", out)
        rc, out = self.invoke(*common)
        self.assertNotIn("[DOWN]", out)                                 # same outage: no duplicate
        srv.script = lambda n, p: (200, b"ok", {})
        rc, out = self.invoke(*common)
        self.assertNotIn("RECOVERED", out)                              # K = 2 consecutive successes needed
        rc, out = self.invoke(*common)
        self.assertIn("[RECOVERED] app", out)
        self.assertEqual(stat.S_IMODE(os.stat(st).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(st)).st_mode), 0o700)

    def test_state_option_alias_and_fail_on_down(self):
        srv = self.server()
        srv.script = lambda n, p: (503, b"bad", {})
        cfg = self.cfg_file(srv.base + "/")
        st = os.path.join(self.tmp, "s.json")
        rc, _ = self.invoke("--config", cfg, "--once", "--dry-run", "--state", st, "--fail-n", "1", "--window-m", "1", "--fail-on-down")
        self.assertEqual(rc, 1)
        rc, _ = self.invoke("--config", cfg, "--once", "--dry-run", "--state-file", st, "--fail-n", "1", "--window-m", "1")
        self.assertEqual(rc, 0)

    def test_due_only_respects_per_target_interval(self):
        srv = self.server()
        t_fast = target(srv.base + "/fast", allow_http=True, name="fast", interval_s=120)
        t_slow = target(srv.base + "/slow", allow_http=True, name="slow", interval_s=300)
        s = self.mk([t_fast, t_slow])
        for i, now in enumerate((1000, 1120, 1240, 1360)):
            s.run_once(now, due_only=True)
        paths = [r["path"] for r in srv.requests]
        self.assertEqual(paths.count("/fast"), 4)
        self.assertEqual(paths.count("/slow"), 2)                       # 1000 and 1360 (elapsed 360 >= 300); 1120/1240 were not due
        s.run_once(1361)                                                # without due_only everything is probed
        self.assertEqual([r["path"] for r in srv.requests].count("/slow"), 3)

    def test_heartbeat_contents_and_no_secrets(self):
        srv = self.server()
        hb = os.path.join(self.tmp, "app support", "last-run.json")
        s = self.mk([target(srv.base + "/", allow_http=True, name="app")], hb=hb, secrets=self.secrets(), tg_url=self.server().base)
        s.run_once(1_700_000_000)
        text = rd(hb)
        d = json.loads(text)
        self.assertEqual(d["telegram"], "enabled")
        self.assertEqual(d["targets"]["app"]["status"], "up")
        self.assertEqual(d["observer"], S.DEFAULTS["host_label"])
        for needle in (TOKEN, "ABCdefGh", "-100123", "TELEGRAM"):
            self.assertNotIn(needle, text)
            self.assertNotIn(needle, rd(os.path.join(self.tmp, "state.json")))
        self.assertEqual(stat.S_IMODE(os.stat(hb).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(hb)).st_mode), 0o700)

    def test_status_cli(self):
        hb = os.path.join(self.tmp, "last-run.json")
        rc, out = self.invoke("--status", "--heartbeat", hb)
        self.assertEqual(rc, 2)
        self.assertIn("no heartbeat", out)
        srv = self.server()
        s = self.mk([target(srv.base + "/", allow_http=True, name="app")], hb=hb)
        s.run_once(time.time())
        rc, out = self.invoke("--status", "--heartbeat", hb)
        self.assertEqual(rc, 0)
        self.assertIn("alive", out)
        self.assertIn("app: UP ok", out)
        text, rc = S.status_report(hb, now=time.time() + 4 * 3600)
        self.assertEqual(rc, 1)
        self.assertIn("STALE", text)
        srv.script = lambda n, p: (500, b"", {})
        s2 = self.mk([target(srv.base + "/", allow_http=True, name="app")], hb=hb, fail_n=1, window_m=1)
        s2.run_once(time.time())
        text, rc = S.status_report(hb)
        self.assertEqual(rc, 1)
        self.assertIn("DOWN", text)
        self.assertIn("[http]", text)

    def test_secrets_from_environment_and_file_rule(self):
        self.assertEqual(S.load_secrets("", {"TELEGRAM_BOT_TOKEN": "t" * 12, "TELEGRAM_CHAT_ID": "5"}), ("t" * 12, "5"))
        self.assertEqual(S.load_secrets("", {"TELEGRAM_BOT_TOKEN": "t" * 12}), (None, None))
        self.assertEqual(S.load_secrets(self.secrets(0o640), {}), (None, None))      # group-readable: refused
        self.assertEqual(S.load_secrets(self.secrets(0o600), {})[1], "-100123")

    def test_test_notify(self):
        tg = self.server()
        tg.script = lambda n, p: (200, b'{"ok":true}', {})
        n = S.Notifier(self.secrets(), "obs", environ={}, log=lambda m: None, test_base_url=tg.base)
        self.assertTrue(n.send("TEST", "sentinel", "Test message"))
        self.assertEqual(len(tg.requests), 1)
        rc, _ = self.invoke("--config", self.cfg_file("http://127.0.0.1:1/"), "--test-notify")      # no secrets in this environment -> nothing sent
        self.assertEqual(rc, 1)


# ------------------------------------------------------------------------------------------------------------ local fallback notifier
class LocalNotify(Ops):
    def test_fallback_only_when_telegram_absent_or_failed(self):
        calls = []
        with mock.patch.object(S, "probe", return_value=R(False, "http", "HTTP 500")):
            s = self.mk([target("https://example.com/")], local=calls.append, fail_n=1, window_m=1, cooldown_s=0)
            s.run_once(1000)
        self.assertEqual(calls, ["DOWN"])                                # no secrets: log + local notification
        calls.clear()
        tg = self.server()
        tg.script = lambda n, p: (200, b'{"ok":true}', {})
        with mock.patch.object(S, "probe", return_value=R(False, "http", "HTTP 500")):
            s = self.mk([target("https://example.com/")], local=calls.append, secrets=self.secrets(), tg_url=tg.base, fail_n=1, window_m=1, cooldown_s=0)
            s.run_once(1000)
        self.assertEqual(calls, [])                                     # Telegram delivered: no duplicate popup

    def test_macos_notify_text_is_fixed_and_runs_osascript_only_on_darwin(self):
        runner = mock.Mock()
        for kind in ("DOWN", "RECOVERED", "REMINDER", "WARNING"):
            runner.reset_mock()
            self.assertTrue(S.macos_notify(kind, runner=runner, platform="darwin"))
            argv = runner.call_args[0][0]
            self.assertEqual(argv[:2], ["/usr/bin/osascript", "-e"])
            script = argv[2]
            self.assertRegex(script, r'^display notification "[A-Za-z .]+" with title "[A-Za-z: ]+"$')
            for bad in ("http", "://", "stage", "copilt", "token", TOKEN):
                self.assertNotIn(bad, script.lower())
        runner.reset_mock()
        self.assertFalse(S.macos_notify("DOWN", runner=runner, platform="linux"))
        self.assertFalse(S.macos_notify("TEST", runner=runner, platform="darwin"))
        runner.assert_not_called()


# ------------------------------------------------------------------------------------------------------------ committed targets files
class TargetsFiles(unittest.TestCase):
    def test_stage_targets(self):
        cfg = S.load_config(STAGE)
        by = {t["name"]: t for t in cfg["targets"]}
        self.assertEqual(set(by), {"stage-edge", "stage-identity", "stage-app", "api-health"})
        self.assertEqual(by["stage-edge"]["url"], "https://stage.copilt.org/healthz")
        self.assertEqual((by["stage-edge"]["interval_s"], by["stage-edge"]["expect_body"], by["stage-edge"]["expect_ip"]), (120, "ok", "206.189.248.204"))
        self.assertEqual(by["stage-identity"]["url"], "https://stage.copilt.org/.well-known/aicc-stage-identity")
        self.assertEqual(by["stage-identity"]["expect_body"], ['"host":"stage.copilt.org"', '"id":"c4cae5ab234f10570763ecd9e9a36a16"'])
        self.assertEqual((by["stage-app"]["url"], by["stage-app"]["interval_s"]), ("https://stage.copilt.org/pricing/", 300))
        self.assertEqual((by["api-health"]["url"], by["api-health"]["interval_s"]), ("https://api.copilt.org/health", 300))
        for t in cfg["targets"]:
            self.assertTrue(t["enabled"])
            self.assertEqual(t["method"], "GET")
            self.assertGreaterEqual(t["interval_s"] or cfg["sentinel"]["interval_s"], 60)
            self.assertTrue(t["url"].startswith(("https://stage.copilt.org/", "https://api.copilt.org/")))
            for forbidden in ("wp-login", "wp-admin", "wp-cron", "my-account", "cart", "checkout", "xmlrpc"):
                self.assertNotIn(forbidden, t["url"])

    def test_production_example_is_inactive_everywhere(self):
        cfg = S.load_config(PROD)
        self.assertTrue(cfg["targets"])
        for t in cfg["targets"]:
            self.assertFalse(t["enabled"], t["name"])
            self.assertTrue(t["url"].startswith("https://www.copilt.org/"))
        self.assertIn("NOT ACTIVE", rd(PROD))
        for path in (os.path.join(MACOS, "install-launchd.sh"), os.path.join(ROOT, "examples", "github-actions-sentinel.yml.example")):
            self.assertNotIn("targets.production", rd(path))     # nothing installs or schedules the production example

    def test_targets_files_hold_no_credentials(self):
        for path in (STAGE, PROD, os.path.join(ROOT, "targets.example.toml")):
            text = rd(path)
            self.assertIsNone(re.search(r"\b\d{6,}:[A-Za-z0-9_-]{20,}\b", text), path)
            self.assertNotRegex(text.lower(), r"(bot_?token|api[_-]?key|password)\s*=")


# ------------------------------------------------------------------------------------------------------------ production targets and the GitHub Actions pack (2026-10-22)
class ProductionAndGithubPack(unittest.TestCase):
    PRODT = os.path.join(ROOT, "targets.production.toml")
    DARK = os.path.join(ROOT, "targets.dark.toml")
    GH = os.path.join(ROOT, "github")

    def test_active_production_targets_are_www_only_and_pin_the_reserved_ip(self):
        cfg = S.load_config(self.PRODT)
        by = {t["name"]: t for t in cfg["targets"]}
        self.assertEqual(set(by), {"www-edge", "www-app", "www-home", "api-health"})
        for n in ("www-edge", "www-app", "www-home"):
            self.assertTrue(by[n]["enabled"])
            self.assertTrue(by[n]["url"].startswith("https://www.copilt.org/"))
        self.assertEqual(by["www-edge"]["expect_ip"], "206.189.248.204")
        self.assertEqual(by["www-edge"]["url"], "https://www.copilt.org/healthz")
        for t in cfg["targets"]:
            for forbidden in ("wp-login", "wp-admin", "wp-cron", "my-account", "cart", "checkout", "xmlrpc"):
                self.assertNotIn(forbidden, t["url"])
        self.assertNotIn("stage.copilt.org", rd(self.PRODT))

    def test_dark_targets_watch_only_the_existing_api(self):
        cfg = S.load_config(self.DARK)
        self.assertEqual([t["name"] for t in cfg["targets"]], ["api-health"])
        self.assertNotIn("stage.copilt.org", rd(self.DARK).replace("stage.copilt.org no longer answers", ""))

    def test_github_targets_probe_exactly_one_public_url(self):
        cfg = S.load_config(os.path.join(self.GH, "targets.github.toml"))
        self.assertEqual(len(cfg["targets"]), 1)
        t = cfg["targets"][0]
        self.assertEqual(t["url"], "https://www.copilt.org/healthz")
        self.assertEqual(t["method"], "GET")
        self.assertEqual(cfg["sentinel"]["host_label"], "github-actions")
        self.assertEqual(cfg["sentinel"]["secrets_file"], "")          # secrets only through the environment
        self.assertLessEqual(cfg["sentinel"]["fail_n"], cfg["sentinel"]["window_m"])

    def test_no_targets_file_holds_a_credential(self):
        for path in (self.PRODT, self.DARK, os.path.join(self.GH, "targets.github.toml"), os.path.join(self.GH, "aicc-sentinel.workflow.yml")):
            text = rd(path)
            self.assertIsNone(re.search(r"\b\d{6,}:[A-Za-z0-9_-]{20,}\b", text), path)
            self.assertNotRegex(text.lower(), r"(bot_?token|api[_-]?key|password)\s*=\s*[\"']?[a-z0-9]")

    def test_workflow_is_safe_to_publish(self):
        w = rd(os.path.join(self.GH, "aicc-sentinel.workflow.yml"))
        code = "\n".join(l for l in w.splitlines() if not l.lstrip().startswith("#"))
        self.assertNotRegex(code, r"(?m)^\s*(pull_request|pull_request_target|issues|issue_comment|push|workflow_run):")
        self.assertIn("schedule:", code)
        self.assertIn("workflow_dispatch", code)
        self.assertRegex(code, r"(?m)^permissions:\s*\n\s+contents: read\s*$")
        uses = re.findall(r"uses:\s*(\S+)", code)
        self.assertEqual(len(uses), 3)
        for u in uses:
            self.assertRegex(u, r"^actions/[a-z-]+(/[a-z-]+)?@[0-9a-f]{40}$", u)     # full commit SHAs, never a moving tag
        for line in code.splitlines():
            if "secrets." in line:
                self.assertRegex(line, r"^\s+TELEGRAM_(BOT_TOKEN|CHAT_ID): \$\{\{ secrets\.TELEGRAM_(BOT_TOKEN|CHAT_ID) \}\}$")
        m = re.search(r'cron:\s*"([^"]+)"', code)
        self.assertIsNotNone(m)
        minutes = m.group(1).split()[0].split(",")
        self.assertNotIn("0", minutes)                     # never :00
        self.assertGreaterEqual(len(minutes), 1)
        self.assertIn("concurrency:", code)
        self.assertIn("timeout-minutes:", code)

    def test_prepare_script_stages_a_standalone_repo_and_refuses_unsafe_targets(self):
        sh = os.path.join(self.GH, "prepare-sentinel-repo.sh")
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "repo")
            r = subprocess.run([BASH, sh, "--out", out], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            for f in ("sentinel.py", "targets.toml", ".github/workflows/aicc-sentinel.yml", "README.md", "SHA256SUMS"):
                self.assertTrue(os.path.isfile(os.path.join(out, f)), f)
            self.assertIn("OWNER GATE", r.stdout)
            self.assertIn("gh secret set TELEGRAM_BOT_TOKEN", r.stdout)
            self.assertNotRegex(r.stdout, r"--body|--token")
            self.assertEqual(open(os.path.join(out, "sentinel.py")).read(), open(os.path.join(ROOT, "sentinel.py")).read())
            self.assertFalse(os.path.isdir(os.path.join(out, ".git")))         # staging never initialises or publishes anything
            r2 = subprocess.run([BASH, sh, "--out", out], capture_output=True, text=True)
            self.assertEqual(r2.returncode, 3)                                   # non-empty target refused
            inside = os.path.join(d, "work")
            os.makedirs(inside)
            subprocess.run(["git", "init", "-q", inside], check=True)
            r3 = subprocess.run([BASH, sh, "--out", os.path.join(inside, "sentinel")], capture_output=True, text=True)
            self.assertEqual(r3.returncode, 3)                                   # inside another work tree refused
            r4 = subprocess.run([BASH, sh, "--out", "relative/dir"], capture_output=True, text=True)
            self.assertEqual(r4.returncode, 2)

    def test_the_github_pack_never_claims_24_7_for_the_mac(self):
        text = rd(os.path.join(self.GH, "README.md"))
        self.assertIn("not 24/7", text.lower())


# ------------------------------------------------------------------------------------------------------------ macOS plist template
class PlistTemplate(unittest.TestCase):
    FAKE = {"@PYTHON@": "/opt/fake/bin/python3.12", "@SCRIPT@": "/Users/x/Library/Application Support/aicc-sentinel/sentinel.py",
            "@TARGETS@": "/Users/x/Library/Application Support/aicc-sentinel/targets.toml", "@STATE@": "/Users/x/Library/Application Support/aicc-sentinel/state.json",
            "@HEARTBEAT@": "/Users/x/Library/Application Support/aicc-sentinel/last-run.json", "@LOGDIR@": "/Users/x/Library/Logs/aicc-sentinel"}

    def render(self):
        with open(os.path.join(MACOS, "com.aicc.sentinel.plist.template")) as fh:
            t = fh.read()
        for k, v in self.FAKE.items():
            t = t.replace(k, v)
        return t

    def test_valid_plist_with_expected_program_arguments(self):
        text = self.render()
        self.assertNotRegex(text.replace("@...@", ""), r"@[A-Z]+@")
        d = plistlib.loads(text.encode())
        self.assertEqual(d["Label"], "com.aicc.sentinel")
        pa = d["ProgramArguments"]
        self.assertEqual(pa[:2], ["/opt/fake/bin/python3.12", self.FAKE["@SCRIPT@"]])
        self.assertEqual(pa[pa.index("--config") + 1], self.FAKE["@TARGETS@"])
        self.assertEqual(pa[pa.index("--state-file") + 1], self.FAKE["@STATE@"])
        self.assertEqual(pa[pa.index("--heartbeat") + 1], self.FAKE["@HEARTBEAT@"])
        for flag in ("--once", "--due-only", "--quiet-ok", "--macos-notify"):
            self.assertIn(flag, pa)
        self.assertNotIn("--dry-run", pa)
        self.assertTrue(all(os.path.isabs(p) for p in (pa[0], pa[1])))
        self.assertTrue(d["RunAtLoad"])
        self.assertEqual(d["StartInterval"], 120)
        self.assertNotIn("KeepAlive", d)
        self.assertEqual((d["Nice"], d["LowPriorityIO"], d["ProcessType"]), (10, True, "Background"))
        self.assertTrue(d["StandardOutPath"].startswith("/Users/x/Library/Logs/aicc-sentinel/"))
        self.assertTrue(d["StandardErrorPath"].startswith("/Users/x/Library/Logs/aicc-sentinel/"))

    def test_no_secret_in_plist_or_arguments(self):
        text = self.render()
        d = plistlib.loads(text.encode())
        blob = json.dumps(d)
        for rx in (r"\d{6,}:[A-Za-z0-9_-]{20,}", r"TELEGRAM_", r"(?i)token\s*[=:]", r"(?i)password", r"(?i)bearer"):
            self.assertIsNone(re.search(rx, blob), rx)
        for a in d["ProgramArguments"]:
            if not a.startswith(("/", "--")):
                self.assertIsNone(re.search(r"[A-Za-z0-9+/_-]{24,}", a), a)
        self.assertNotIn("secrets.env", blob)
        self.assertFalse(any(a.startswith("--token") or a.startswith("--chat") for a in d["ProgramArguments"]))
        self.assertEqual(d.get("EnvironmentVariables", {}).keys(), {"PYTHONDONTWRITEBYTECODE", "PYTHONUNBUFFERED"})

    @unittest.skipUnless(shutil.which("plutil"), "plutil not available")
    def test_plutil_lint(self):
        p = os.path.join(tempfile.mkdtemp(), "x.plist")
        self.addCleanup(shutil.rmtree, os.path.dirname(p), True)
        put(p, self.render())
        r = subprocess.run(["plutil", "-lint", p], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


# ------------------------------------------------------------------------------------------------------------ install-launchd.sh and sentinel-secrets.sh
class ShellBase(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.addCleanup(self.td.cleanup)
        self.home = os.path.join(self.td.name, "home")
        self.bin = os.path.join(self.td.name, "bin")
        os.makedirs(self.home)
        os.makedirs(self.bin)
        self.lc_log = os.path.join(self.td.name, "launchctl.log")
        put(os.path.join(self.bin, "launchctl"), f'#!/bin/sh\necho "$@" >> "{self.lc_log}"\nexit 0\n', 0o755)
        self.env = {"HOME": self.home, "PATH": f"{self.bin}:/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "C"}

    def run_sh(self, script, *args, stdin=None, env=None, fake_root=False):
        e = {**self.env, **(env or {})}
        if fake_root:
            put(os.path.join(self.bin, "id"), '#!/bin/sh\n[ "$1" = "-u" ] && echo 0 || echo root\n', 0o755)
        return subprocess.run([BASH, os.path.join(MACOS, script), *args], capture_output=True, text=True, env=e, input=stdin, stdin=None if stdin is not None else subprocess.DEVNULL, timeout=60)

    def files_under_home(self):
        return [os.path.join(dp, f) for dp, dns, fns in os.walk(self.home) for f in fns + dns]


class InstallScript(ShellBase):
    def py(self):
        return ["--python", sys.executable]

    def test_dry_run_is_default_changes_nothing_and_never_calls_launchctl(self):
        for args in ([], ["--dry-run"], ["--uninstall"]):
            r = self.run_sh("install-launchd.sh", *self.py(), *args)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("DRY-RUN", r.stdout)
            self.assertIn("WOULD", r.stdout)
            self.assertNotIn("DO    ", r.stdout)
            self.assertEqual(self.files_under_home(), [])
            self.assertFalse(os.path.exists(self.lc_log))
        r = self.run_sh("install-launchd.sh", *self.py())
        self.assertIn("WOULD launchctl bootstrap gui/", r.stdout)
        self.assertIn("never created by this script", r.stdout)
        self.assertIn("NO secrets file", r.stdout)
        m = re.search(r"-- rendered plist.*?--\n(.*?)\n-- end plist --", r.stdout, re.S)
        d = plistlib.loads(m.group(1).encode())
        self.assertEqual(d["ProgramArguments"][0], sys.executable)
        self.assertTrue(d["ProgramArguments"][1].startswith(self.home))
        self.assertIn("sentinel --plan", r.stdout)

    def test_refuses_root_and_bad_arguments(self):
        r = self.run_sh("install-launchd.sh", *self.py(), "--apply", fake_root=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("root", r.stderr)
        self.assertEqual(self.files_under_home(), [])
        self.assertFalse(os.path.exists(self.lc_log))
        self.assertNotEqual(self.run_sh("install-launchd.sh", "--bogus").returncode, 0)
        self.assertNotEqual(self.run_sh("install-launchd.sh", "--python", "/nonexistent/python", "--apply").returncode, 0)
        self.assertFalse(os.path.exists(self.lc_log))

    @unittest.skipUnless(sys.platform == "darwin", "apply path needs macOS (uname, plutil)")
    def test_apply_with_stub_launchctl_and_uninstall(self):
        r = self.run_sh("install-launchd.sh", *self.py(), "--apply")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        sup = os.path.join(self.home, "Library", "Application Support", "aicc-sentinel")
        logs = os.path.join(self.home, "Library", "Logs", "aicc-sentinel")
        plist = os.path.join(self.home, "Library", "LaunchAgents", "com.aicc.sentinel.plist")
        for d in (sup, logs):
            self.assertEqual(stat.S_IMODE(os.stat(d).st_mode), 0o700)
        for f in ("sentinel.py", "targets.toml"):
            self.assertEqual(stat.S_IMODE(os.stat(os.path.join(sup, f)).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(plist).st_mode), 0o644)
        d = plistlib.loads(rd(plist, "rb"))
        self.assertEqual(d["ProgramArguments"][0], sys.executable)
        self.assertEqual(rd(os.path.join(sup, "targets.toml")), rd(STAGE))
        self.assertFalse(os.path.exists(os.path.join(self.home, ".config")))     # the secrets file / dir is never created here
        lc = rd(self.lc_log).splitlines()
        uid = str(os.getuid())
        self.assertIn(f"bootstrap gui/{uid} {plist}", lc)
        self.assertIn(f"enable gui/{uid}/com.aicc.sentinel", lc)
        self.assertIn(f"kickstart gui/{uid}/com.aicc.sentinel", lc)
        self.assertEqual(self.run_sh("install-launchd.sh", *self.py(), "--apply").returncode, 0)   # idempotent re-install
        # a dry-run uninstall deletes nothing; --uninstall --apply removes the agent and our support dir but leaves logs and secrets alone
        self.run_sh("install-launchd.sh", "--uninstall")
        self.assertTrue(os.path.exists(plist))
        os.makedirs(os.path.join(self.home, ".config", "aicc-sentinel"))
        put(os.path.join(self.home, ".config", "aicc-sentinel", "secrets.env"), "x=y\n", 0o600)
        r = self.run_sh("install-launchd.sh", "--uninstall", "--apply")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(os.path.exists(plist))
        self.assertFalse(os.path.exists(sup))
        self.assertTrue(os.path.isdir(logs))
        self.assertTrue(os.path.exists(os.path.join(self.home, ".config", "aicc-sentinel", "secrets.env")))
        self.assertIn(f"bootout gui/{uid}/com.aicc.sentinel", rd(self.lc_log))


class SecretsScript(ShellBase):
    def setUp(self):
        super().setUp()
        self.env["AICC_SENTINEL_SECRETS_TEST"] = "1"
        self.f = os.path.join(self.home, ".config", "aicc-sentinel", "secrets.env")

    def test_writes_0600_atomically_in_the_loader_format_and_never_echoes(self):
        r = self.run_sh("sentinel-secrets.sh", "--stdin", stdin=f"{TOKEN}\n-100123\n")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn(TOKEN, r.stdout + r.stderr)
        self.assertNotIn("100123", r.stdout + r.stderr)
        self.assertEqual(stat.S_IMODE(os.stat(self.f).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(self.f)).st_mode), 0o700)
        self.assertEqual(rd(self.f), f"TELEGRAM_BOT_TOKEN={TOKEN}\nTELEGRAM_CHAT_ID=-100123\n")
        self.assertEqual(os.listdir(os.path.dirname(self.f)), ["secrets.env"])          # no temp file left behind
        self.assertEqual(S.load_secrets(self.f, {}), (TOKEN, "-100123"))                # exactly what sentinel.py loads (and it accepts the mode)
        chk = self.run_sh("sentinel-secrets.sh", "--check")
        self.assertEqual(chk.returncode, 0)
        self.assertNotIn(TOKEN, chk.stdout)

    def test_overwrite_keeps_0600_and_check_detects_a_bad_mode(self):
        self.run_sh("sentinel-secrets.sh", "--stdin", stdin=f"{TOKEN}\n5\n")
        os.chmod(self.f, 0o644)
        chk = self.run_sh("sentinel-secrets.sh", "--check")
        self.assertEqual(chk.returncode, 1)
        self.assertIn("IGNORE", chk.stdout)
        self.assertEqual(S.load_secrets(self.f, {}), (None, None))                      # the loader really does refuse it
        self.run_sh("sentinel-secrets.sh", "--stdin", stdin=f"{TOKEN}\n@mychannel\n")
        self.assertEqual(stat.S_IMODE(os.stat(self.f).st_mode), 0o600)
        self.assertIn("@mychannel", rd(self.f))

    def test_rejects_bad_input_writes_nothing_and_does_not_echo_it(self):
        for stdin in ("not-a-token\n123\n", f"{TOKEN}\nnot a chat\n", f"{TOKEN}\n", "\n\n", f"{TOKEN}\n123\n".replace("\n", "\r\n")):
            r = self.run_sh("sentinel-secrets.sh", "--stdin", stdin=stdin)
            self.assertNotEqual(r.returncode, 0, repr(stdin))
            self.assertFalse(os.path.exists(self.f))
            self.assertNotIn(TOKEN, r.stdout + r.stderr)

    def test_never_accepts_secrets_as_arguments_and_needs_a_terminal(self):
        r = self.run_sh("sentinel-secrets.sh", TOKEN)
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn(TOKEN, r.stdout + r.stderr)
        r = self.run_sh("sentinel-secrets.sh", "--token", TOKEN)
        self.assertNotEqual(r.returncode, 0)
        r = self.run_sh("sentinel-secrets.sh")                                          # stdin is /dev/null, not a TTY
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("terminal", r.stderr)
        r = self.run_sh("sentinel-secrets.sh", "--stdin", stdin=f"{TOKEN}\n5\n", env={"AICC_SENTINEL_SECRETS_TEST": ""})
        self.assertNotEqual(r.returncode, 0)                                            # --stdin is test-only
        self.assertFalse(os.path.exists(self.f))
        r = self.run_sh("sentinel-secrets.sh", "--stdin", stdin=f"{TOKEN}\n5\n", fake_root=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(self.f))

    def test_remove(self):
        self.run_sh("sentinel-secrets.sh", "--stdin", stdin=f"{TOKEN}\n5\n")
        self.assertEqual(self.run_sh("sentinel-secrets.sh", "--remove").returncode, 0)
        self.assertFalse(os.path.exists(self.f))
        self.assertEqual(self.run_sh("sentinel-secrets.sh", "--check").returncode, 1)

    def test_source_uses_silent_reads_and_no_external_secret_handling(self):
        src = rd(os.path.join(MACOS, "sentinel-secrets.sh"))
        self.assertIn("read -rs token", src)
        self.assertIn("read -rs chat", src)
        self.assertNotRegex(src, r"(?m)^\s*set -[a-z]*x")
        self.assertNotRegex(src, r'(echo|curl|python|openssl)[^\n]*\$\{?(token|chat)')


class ShellLint(unittest.TestCase):
    @unittest.skipUnless(shutil.which("shellcheck"), "shellcheck not installed")
    def test_shellcheck_clean(self):
        files = [os.path.join(MACOS, f) for f in os.listdir(MACOS) if f.endswith(".sh")]
        self.assertTrue(files)
        r = subprocess.run(["shellcheck", "-x", "-S", "style", *files], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_bash_syntax_and_strict_mode(self):
        for f in os.listdir(MACOS):
            if f.endswith(".sh"):
                p = os.path.join(MACOS, f)
                self.assertEqual(subprocess.run([BASH, "-n", p]).returncode, 0, f)
                self.assertIn("set -euo pipefail", rd(p))


class WorkflowExample(unittest.TestCase):
    def test_workflow_example_is_least_privilege(self):
        text = rd(os.path.join(ROOT, "examples", "github-actions-sentinel.yml.example"))
        self.assertIn('cron: "*/10 * * * *"', text)
        self.assertRegex(text, r"permissions:\n  contents: read\n")
        self.assertIn("timeout-minutes: 3", text)
        self.assertIn("concurrency:", text)
        self.assertIn("TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}", text)
        self.assertIn("TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}", text)
        code = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))
        # secrets are only ever referenced in the two env: lines
        self.assertEqual(len(re.findall(r"\$\{\{\s*secrets\.", code)), 2)
        self.assertNotIn("pull_request", code)
        self.assertIn("--state-file", code)
        self.assertIn("--once", code)
        self.assertIn("persist-credentials: false", code)


if __name__ == "__main__":
    unittest.main()
