"""telegram-status / -check / -discover-chat / -send-test. All network traffic goes to a loopback fake via the test-only base-URL seam
(AICC_OPS_TEST_HARNESS=1 + AICC_OPS_TEST_BASE_URL); nothing here can reach api.telegram.org."""
import contextlib
import io
import json
import os
import re
import urllib.parse
import unittest
from unittest import mock

from aicc_ops import cli, telegram as tg, telegram_ops as ops
from tests.helpers import TmpCase, BodyServer, put
from tests.test_telegram import NoNetwork, TOKEN, CHAT


def reply(path_map):
    def fn(n, path):
        for suffix, (st, body) in path_map.items():
            if path.endswith(suffix):
                return st, json.dumps(body).encode()
        return 404, b"{}"
    return fn


class OpsBase(TmpCase):
    def setUp(self):
        super().setUp()
        self.secrets_path = os.path.join(self.tmp, "secrets.env")
        self.cfg_path = put(os.path.join(self.tmp, "aicc-ops.toml"),
                            f'[general]\nhost_label = "aicc-cp-stage (staging)"\n[telegram]\nsecrets_file = "{self.secrets_path}"\n')

    def secrets(self, mode=0o640, body=None):
        put(self.secrets_path, body if body is not None else f"OTHER=keep\nTELEGRAM_BOT_TOKEN={TOKEN}\nTELEGRAM_CHAT_ID={CHAT}\n")
        os.chmod(self.secrets_path, mode)

    def run_cli(self, *args, srv=None, env=None):
        e = {"AICC_OPS_TEST_HARNESS": "1"} if srv else {}
        if srv:
            e["AICC_OPS_TEST_BASE_URL"] = srv.url
        e.update(env or {})
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, e), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            if "CREDENTIALS_DIRECTORY" not in e:
                os.environ.pop("CREDENTIALS_DIRECTORY", None)
            rc = cli.main(["--config", self.cfg_path, *args])
        return rc, out.getvalue(), err.getvalue()

    @staticmethod
    def kv(out):
        """status output as {label: value} (columns are space-aligned)."""
        return {l[:16].strip(): l[16:].strip() for l in out.splitlines() if len(l) > 16}

    def assert_no_secret(self, *texts):
        for t in texts:
            self.assertNotIn(TOKEN, t)
            self.assertNotIn(TOKEN.split(":")[1][:10], t)     # not even a fragment
            self.assertNotIn(TOKEN.split(":")[0] + ":", t)
            self.assertNotIn("api.telegram.org/bot", t)


class StatusTests(OpsBase):
    def test_usable_prints_length_and_presence_only(self):
        self.secrets()
        with NoNetwork():
            rc, out, err = self.run_cli("telegram-status")
        self.assertEqual(rc, 0, out + err)
        kv = self.kv(out)
        self.assertEqual((kv["token length"], kv["chat id"], kv["mode"], kv["mode acceptable"], kv["source"], kv["usable"]),
                         (str(len(TOKEN)), "present", "0640", "yes", "file", "yes"))
        self.assert_no_secret(out, err)
        self.assertNotIn(CHAT, out)

    def test_unusable_cases_exit_3(self):
        with NoNetwork():
            rc, out, _ = self.run_cli("telegram-status")                  # absent
            self.assertEqual(rc, 3); self.assertEqual(self.kv(out)["present"], "no")
            self.secrets(0o644)                                           # world-readable
            rc, out, _ = self.run_cli("telegram-status")
            self.assertEqual(rc, 3); self.assertEqual(self.kv(out)["mode acceptable"], "NO"); self.assertIn("REFUSED", out)
            self.assert_no_secret(out)
            self.secrets(0o660)                                           # group-writable
            self.assertEqual(self.run_cli("telegram-status")[0], 3)
            self.secrets(0o640, f"TELEGRAM_BOT_TOKEN={TOKEN}\n")          # chat id missing
            rc, out, _ = self.run_cli("telegram-status")
            self.assertEqual(rc, 3); self.assertEqual(self.kv(out)["chat id"], "missing")
            self.assert_no_secret(out)

    def test_credential_directory_source(self):
        d = os.path.join(self.tmp, "cred"); os.mkdir(d)
        put(os.path.join(d, "secrets.env"), f"TELEGRAM_BOT_TOKEN={TOKEN}\nTELEGRAM_CHAT_ID={CHAT}\n")
        with NoNetwork():
            rc, out, err = self.run_cli("telegram-status", env={"CREDENTIALS_DIRECTORY": d})
        self.assertEqual(rc, 0, out + err)
        self.assertEqual(self.kv(out)["source"], "credential-dir")
        self.assert_no_secret(out)

    def test_disabled_by_config_is_not_usable(self):
        self.secrets()
        put(self.cfg_path, f'[telegram]\nenabled = false\nsecrets_file = "{self.secrets_path}"\n')
        rc, out, _ = self.run_cli("telegram-status")
        self.assertEqual(rc, 3)
        self.assertEqual(self.kv(out)["enabled(config)"], "NO (telegram.enabled=false)")


class StatusDeliveryTests(OpsBase):
    """Production 20 (R3 M8): telegram-status also says when the running daemon last delivered / failed (read from its own database; nothing is contacted)."""

    def seed(self, metrics_at):
        from tests.helpers import make_store
        data = os.path.join(self.tmp, "data"); os.makedirs(data, exist_ok=True)
        put(self.cfg_path, f'[general]\ndata_dir = "{data}"\n[telegram]\nsecrets_file = "{self.secrets_path}"\n')
        from aicc_ops.store import Store
        from aicc_ops.config import load_config
        c = load_config(self.cfg_path)
        st = Store(os.path.join(data, c["storage"]["db_file"]), c["storage"], free_pct_fn=lambda _p: 50.0)
        for ts, m in metrics_at:
            st.write_sample(ts, m)
        st.close()

    def status(self, now):
        from aicc_ops.config import load_config
        out = io.StringIO()
        rc = ops.cmd_status(load_config(self.cfg_path), out=out, environ={}, now=now)
        return rc, out.getvalue()

    def test_prints_the_ages_of_the_last_delivery_and_failure_and_the_counters(self):
        self.secrets()
        now = 1_800_000_000
        self.seed([(now - 90, {"ops.telegram_enabled": 1.0, "ops.telegram_sent": 3.0, "ops.telegram_failed": 2.0, "ops.telegram_dropped": 1.0, "ops.telegram_rate_limited": 4.0,
                               "ops.telegram_last_ok_ts": now - 7200.0, "ops.telegram_last_failure_ts": now - 600.0})])
        rc, out = self.status(now)
        self.assertEqual(rc, 0, out)
        kv = self.kv(out)
        self.assertIn("2h 0m ago", kv["last delivery"])
        self.assertIn("10m ago", kv["last failure"])
        self.assertIn("sent 3, failed 2, dropped 1, rate-limited 4", kv["since start"])
        self.assertNotIn(TOKEN, out)

    def test_says_never_when_nothing_was_delivered_or_failed(self):
        self.secrets()
        now = 1_800_000_000
        self.seed([(now - 30, {"ops.telegram_enabled": 1.0, "ops.telegram_sent": 0.0, "ops.telegram_failed": 0.0, "ops.telegram_dropped": 0.0, "ops.telegram_rate_limited": 0.0})])
        kv = self.kv(self.status(now)[1])
        self.assertIn("never", kv["last delivery"])
        self.assertIn("never", kv["last failure"])

    def test_flags_a_daemon_that_stopped_recording(self):
        self.secrets()
        now = 1_800_000_000
        self.seed([(now - 7200, {"ops.telegram_enabled": 1.0, "ops.telegram_sent": 1.0, "ops.telegram_failed": 0.0, "ops.telegram_dropped": 0.0, "ops.telegram_rate_limited": 0.0,
                                 "ops.telegram_last_ok_ts": now - 7300.0})])
        kv = self.kv(self.status(now)[1])
        self.assertIn("2h 0m ago", kv["daemon data"])          # the newest sample is two hours old: the daemon is probably not running

    def test_unreadable_or_absent_daemon_data_is_stated_and_does_not_change_the_exit_code(self):
        self.secrets()
        rc, out = self.status(1_800_000_000)                    # no database at all
        self.assertEqual(rc, 0)
        self.assertIn("not available", self.kv(out)["daemon data"])
        self.assertEqual(self.kv(out)["usable"], "yes")

    def test_a_database_without_the_telegram_metrics_says_the_daemon_predates_them(self):
        self.secrets()
        now = 1_800_000_000
        self.seed([(now - 30, {"cpu.used_pct": 1.0})])
        self.assertIn("no telegram metrics", self.kv(self.status(now)[1])["daemon data"])


class CheckTests(OpsBase):
    def test_getme_ok_prints_username_only_and_sends_nothing(self):
        self.secrets()
        srv = BodyServer(handler_fn=reply({"/getMe": (200, {"ok": True, "result": {"id": 1, "is_bot": True, "username": "aicc_ops_bot", "first_name": "Secret Name"}})}))
        try:
            rc, out, err = self.run_cli("telegram-check", srv=srv)
        finally:
            srv.close()
        self.assertEqual(rc, 0, out + err)
        self.assertIn("@aicc_ops_bot", out)
        self.assertIn("ok", out)
        self.assertNotIn("Secret Name", out)
        self.assert_no_secret(out, err)
        self.assertEqual([r["path"] for r in srv.requests], [f"/bot{TOKEN}/getMe"])     # exactly one call, and it is not sendMessage
        self.assertEqual(srv.requests[0]["method"], "GET")

    def test_http_failure_prints_status_only(self):
        self.secrets()
        srv = BodyServer(handler_fn=reply({"/getMe": (401, {"ok": False, "error_code": 401, "description": f"Unauthorized {TOKEN}"})}))
        try:
            rc, out, err = self.run_cli("telegram-check", srv=srv)
        finally:
            srv.close()
        self.assertEqual(rc, 1)
        self.assertIn("HTTP 401", out)
        self.assert_no_secret(out, err)
        self.assertNotIn("Unauthorized", out)

    def test_connection_failure_prints_exception_type_only(self):
        self.secrets()
        srv = BodyServer(b"{}"); port = srv.port; srv.close()      # nothing listens there now
        fake = mock.Mock(url=f"http://127.0.0.1:{port}")
        rc, out, err = self.run_cli("telegram-check", srv=fake)
        self.assertEqual(rc, 1)
        self.assertRegex(out, r"exception \w*(Error|Exception)\b")
        self.assert_no_secret(out, err)
        self.assertNotIn(str(port), out)

    def test_refuses_an_unsafe_secrets_file_before_any_request(self):
        for mode in (0o644, 0o660, 0o604):
            self.secrets(mode)
            srv = BodyServer(b'{"ok":true}')
            try:
                for cmd in (("telegram-check",), ("telegram-discover-chat",), ("telegram-send-test", "--send")):
                    rc, out, err = self.run_cli(*cmd, srv=srv)
                    self.assertEqual(rc, 3, (cmd, mode))
                    self.assertIn("REFUSED", err)
                    self.assert_no_secret(out, err)
                self.assertEqual(srv.requests, [])
            finally:
                srv.close()

    def test_missing_secrets_exit_3(self):
        rc, _, err = self.run_cli("telegram-check")
        self.assertEqual(rc, 3)
        self.assertIn("no Telegram bot token", err)

    def test_check_works_with_token_only(self):
        self.secrets(body=f"TELEGRAM_BOT_TOKEN={TOKEN}\n")
        srv = BodyServer(handler_fn=reply({"/getMe": (200, {"ok": True, "result": {"username": "x_bot"}})}))
        try:
            self.assertEqual(self.run_cli("telegram-check", srv=srv)[0], 0)
        finally:
            srv.close()


class BaseUrlSeamTests(unittest.TestCase):
    def test_env_redirect_needs_the_harness_flag_and_is_loopback_only(self):
        self.assertEqual(ops.resolve_base({"AICC_OPS_TEST_BASE_URL": "http://127.0.0.1:1"}), tg.API_BASE)      # no harness flag: ignored
        self.assertEqual(ops.resolve_base({"AICC_OPS_TEST_HARNESS": "1"}), tg.API_BASE)
        self.assertEqual(ops.resolve_base({"AICC_OPS_TEST_HARNESS": "1", "AICC_OPS_TEST_BASE_URL": "http://127.0.0.1:8080"}), "http://127.0.0.1:8080")
        for bad in ("https://evil.example", "http://127.0.0.1.evil.example:80", "http://10.0.0.1:80", "http://localhost:80", "http://127.0.0.1:80/x"):
            with self.assertRaises(ValueError):
                ops.resolve_base({"AICC_OPS_TEST_HARNESS": "1", "AICC_OPS_TEST_BASE_URL": bad})
            with self.assertRaises(ValueError):
                ops.resolve_base({}, bad)


class DiscoverTests(OpsBase):
    UPDATES = {"ok": True, "result": [
        {"update_id": 1, "message": {"message_id": 5, "text": "my private message text", "from": {"id": 42, "first_name": "Dana", "username": "dana_private"},
                                     "chat": {"id": 424242424, "type": "private", "first_name": "Dana", "username": "dana_private"}}},
        {"update_id": 2, "message": {"text": "hello again", "chat": {"id": 424242424, "type": "private", "first_name": "Dana"}}},
        {"update_id": 3, "message": {"text": "in group", "chat": {"id": -1001234567890, "type": "supergroup", "title": "Ops Room", "username": "ops_room"}}},
        {"update_id": 4, "channel_post": {"text": "post", "chat": {"id": -1009876543210, "type": "channel", "title": "News"}}},
        {"update_id": 5, "my_chat_member": {"chat": {"id": -100555555555, "type": "group", "title": "Added"}}},
        {"update_id": 6, "callback_query": {"id": "x"}},
    ]}

    def test_lists_each_distinct_chat_without_message_text_or_private_names(self):
        self.secrets(body=f"TELEGRAM_BOT_TOKEN={TOKEN}\n")      # no chat id yet: this is exactly when discovery is used
        srv = BodyServer(handler_fn=reply({"/getUpdates": (200, self.UPDATES)}))
        try:
            rc, out, err = self.run_cli("telegram-discover-chat", srv=srv)
        finally:
            srv.close()
        self.assertEqual(rc, 0, out + err)
        self.assertEqual(out.count("chat_id="), 4)
        self.assertIn("chat_id=424242424  type=private", out)
        self.assertIn("chat_id=-1001234567890  type=supergroup  title='Ops Room'  username=@ops_room", out)
        self.assertIn("chat_id=-1009876543210  type=channel  title='News'", out)
        for leaked in ("my private message text", "hello again", "in group", "Dana", "dana_private"):
            self.assertNotIn(leaked, out)
        self.assert_no_secret(out, err)
        self.assertEqual(len(srv.requests), 1)
        body = urllib.parse.parse_qs(srv.requests[0]["body"].decode())
        self.assertEqual(body["limit"], ["20"])
        self.assertEqual(body["timeout"], ["2"])
        self.assertNotIn("offset", body)         # nothing is acknowledged/consumed

    def test_no_chats_explains_what_to_do(self):
        self.secrets()
        srv = BodyServer(handler_fn=reply({"/getUpdates": (200, {"ok": True, "result": []})}))
        try:
            rc, out, _ = self.run_cli("telegram-discover-chat", srv=srv)
        finally:
            srv.close()
        self.assertEqual(rc, 0)
        self.assertIn("send it any message", out)

    def test_webhook_conflict_and_http_errors(self):
        self.secrets()
        srv = BodyServer(handler_fn=reply({"/getUpdates": (409, {"ok": False, "description": "Conflict: can't use getUpdates method while webhook is active"})}))
        try:
            rc, out, err = self.run_cli("telegram-discover-chat", srv=srv)
        finally:
            srv.close()
        self.assertEqual(rc, 1)
        self.assertIn("HTTP 409", out)
        self.assertIn("webhook", out)
        self.assert_no_secret(out, err)

    def test_extract_chats_tolerates_garbage(self):
        self.assertEqual(ops.extract_chats(None), [])
        self.assertEqual(ops.extract_chats([1, "x", {"message": 5}, {"message": {"chat": {"id": True}}}, {"message": {"chat": {"id": "7"}}}]), [])


class SendTestTests(OpsBase):
    def test_dry_run_is_default_and_needs_no_secrets_or_network(self):
        with NoNetwork():
            rc, out, err = self.run_cli("telegram-send-test")
        self.assertEqual(rc, 0, err)
        self.assertIn("DRY-RUN", out)
        self.assertIn("[TEST] aicc-cp-stage (staging) - Telegram path check ", out)
        self.assertIn("UTC. No action needed.", out)
        self.assertEqual(tg.scan_pii(out), [])

    def test_send_posts_exactly_one_message(self):
        self.secrets()
        srv = BodyServer(handler_fn=reply({"/sendMessage": (200, {"ok": True, "result": {"message_id": 9}})}))
        try:
            rc, out, err = self.run_cli("telegram-send-test", "--send", srv=srv)
        finally:
            srv.close()
        self.assertEqual(rc, 0, out + err)
        self.assertEqual(out.strip(), "sendMessage: ok (HTTP 200)")
        self.assertEqual(len(srv.requests), 1)
        r = srv.requests[0]
        self.assertEqual((r["method"], r["path"]), ("POST", f"/bot{TOKEN}/sendMessage"))
        form = urllib.parse.parse_qs(r["body"].decode())
        self.assertEqual(form["chat_id"], [CHAT])
        self.assertRegex(form["text"][0], r"^\[TEST\] aicc-cp-stage \(staging\) - Telegram path check \d{4}-\d\d-\d\d \d\d:\d\d UTC\. No action needed\.$")
        self.assertNotIn("parse_mode", form)
        self.assert_no_secret(out, err)

    def test_send_failure_prints_status_only(self):
        self.secrets()
        srv = BodyServer(handler_fn=reply({"/sendMessage": (400, {"ok": False, "description": "Bad Request: chat not found"})}))
        try:
            rc, out, err = self.run_cli("telegram-send-test", "--send", srv=srv)
        finally:
            srv.close()
        self.assertEqual(rc, 1)
        self.assertIn("HTTP 400", out)
        self.assertEqual(len(srv.requests), 1)      # no retry storm for a test message
        self.assertNotIn("chat not found", out)
        self.assert_no_secret(out, err)

    def test_send_needs_a_chat_id(self):
        self.secrets(body=f"TELEGRAM_BOT_TOKEN={TOKEN}\n")
        srv = BodyServer(b'{"ok":true}')
        try:
            rc, _, err = self.run_cli("telegram-send-test", "--send", srv=srv)
        finally:
            srv.close()
        self.assertEqual(rc, 3)
        self.assertIn("chat id", err)
        self.assertEqual(srv.requests, [])


class NoSecretInSourceTests(unittest.TestCase):
    def test_token_is_never_interpolated_outside_the_request_url(self):
        """Static guard (not a proof): the token variable may be interpolated only into the request URL."""
        import inspect
        hits = [l.strip() for l in inspect.getsource(ops).splitlines() if re.search(r"\{(token|creds\[0\]|t)\b", l)]
        self.assertEqual(hits, ['url = f"{base}/bot{token}/{method}"     # the token lives only in this local string / the request line'])


if __name__ == "__main__":
    unittest.main()
