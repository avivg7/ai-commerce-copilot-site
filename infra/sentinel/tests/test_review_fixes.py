"""Regression tests for the independent security review of Phase 2B (F6, F9 and the sanitiser ordering)."""
import io
import os
import socket
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
import sentinel as S  # noqa: E402
from test_sentinel import Server, target  # noqa: E402


class HostileTarget(unittest.TestCase):
    def test_redirect_to_an_impossible_port_is_a_failed_check_not_a_crash(self):
        srv = Server()
        self.addCleanup(srv.close)
        srv.script = lambda n, path: (302, b"", {"Location": "http://127.0.0.1:99999999/x"})
        res = S.probe(target(srv.base + "/", allow_http=True))
        self.assertFalse(res["ok"])
        self.assertEqual(res["stage"], "http")

    def test_redirect_with_unterminated_ipv6_is_a_failed_check(self):
        srv = Server()
        self.addCleanup(srv.close)
        srv.script = lambda n, path: (302, b"", {"Location": "http://[::1/x"})
        res = S.probe(target(srv.base + "/", allow_http=True))
        self.assertFalse(res["ok"])

    def test_a_probe_error_cannot_skip_the_state_save_or_the_other_targets(self):
        d = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(d, ignore_errors=True))
        n = S.Notifier(os.path.join(d, "none.env"), "t", dry_run=True, out=io.StringIO(), log=lambda m: None, environ={}, sleep=lambda s: None)
        targets = [target("https://a.invalid/"), target("https://b.invalid/")]
        targets[0]["name"], targets[1]["name"] = "a", "b"
        cfg = {"sentinel": {**S.DEFAULTS, "state_file": os.path.join(d, "s.json")}, "targets": targets}
        sen = S.Sentinel(cfg, n, os.path.join(d, "s.json"), log=lambda m: None)
        calls = []

        def boom(t, now=None):
            calls.append(t["name"])
            raise RuntimeError("boom")
        orig = S.probe
        S.probe = boom
        try:
            sen.run_once()
        finally:
            S.probe = orig
        self.assertEqual(calls, ["a", "b"])                     # the second target was still probed
        self.assertTrue(os.path.exists(os.path.join(d, "s.json")))   # and the state was saved

    @unittest.skipUnless(hasattr(__import__("signal"), "setitimer"), "needs SIGALRM")
    def test_a_slow_drip_server_cannot_hold_the_round_beyond_the_overall_deadline(self):
        lsock = socket.socket()
        lsock.bind(("127.0.0.1", 0))
        lsock.listen(1)
        port = lsock.getsockname()[1]
        stop = threading.Event()

        def drip():
            c, _ = lsock.accept()
            c.recv(4096)
            c.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 60000\r\n\r\n")
            while not stop.is_set():
                try:
                    c.sendall(b"x")
                except OSError:
                    break
                time.sleep(0.5)       # under the per-recv timeout: only an overall deadline can stop this
        threading.Thread(target=drip, daemon=True).start()
        t = target(f"http://127.0.0.1:{port}/", allow_http=True, timeout_s=3)
        t0 = time.monotonic()
        res = S.probe(t)
        stop.set()
        lsock.close()
        self.assertFalse(res["ok"])
        self.assertLess(time.monotonic() - t0, S._probe_deadline(t) + 5)
        self.assertIn("deadline", res["reason"])


class TokenNeverLeaks(unittest.TestCase):
    def test_invalid_url_from_a_token_with_a_newline_does_not_leak_or_crash(self):
        logs = []
        env = {"TELEGRAM_BOT_TOKEN": "123456789:AAAA-BBBB\nCCCC-dddd-EEEE-ffff-GGGG", "TELEGRAM_CHAT_ID": "-100123"}
        n = S.Notifier("", "t", environ=env, log=logs.append, sleep=lambda s: None)
        self.assertTrue(n.enabled)
        ok = n.send("TEST", "x", "hello")
        self.assertFalse(ok)
        self.assertNotIn("AAAA", " ".join(logs))
        self.assertNotIn("CCCC", " ".join(logs))

    def test_environment_secrets_are_stripped(self):
        tok, chat = S.load_secrets("", {"TELEGRAM_BOT_TOKEN": "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ0123456789\n", "TELEGRAM_CHAT_ID": " -100123 \n"})
        self.assertEqual(chat, "-100123")
        self.assertFalse(tok.endswith("\n"))


class SanitiserOrder(unittest.TestCase):
    def test_a_token_split_by_an_invisible_character_is_still_redacted(self):
        text = "token 123456789:ABCdefGhIJKl​mNoPQRsTUVwxyZ0123456789 end"
        self.assertNotIn("ABCdef", S.sanitize(text))
        self.assertNotIn("123456789:", S.sanitize("x 123456789:ABCdefGhIJKlmNoPQRsTUV\x01wxyZ0123456789 y"))


if __name__ == "__main__":
    unittest.main()
