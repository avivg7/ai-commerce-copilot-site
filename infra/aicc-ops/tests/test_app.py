import io
import os
import socket
import time
import unittest
import urllib.request
from unittest import mock

from aicc_ops.alerts import FIRING
from aicc_ops.app import Runtime
from aicc_ops.cli import main as cli_main
from aicc_ops.config import load_config
from aicc_ops.telegram import TelegramAdapter
from aicc_ops.store import Store
from tests.helpers import TmpCase, make_cfg, make_store, fixture, write_exe, BodyServer, read_fixture, put
from tests.test_telegram import NoNetwork

OFF = {k: {"enabled": False} for k in ("host", "caddy", "phpfpm", "mysql", "cp", "backups", "cert", "edge", "postgres", "backend_metrics")}


class RuntimeTests(TmpCase):
    def rt(self, collectors=None, free=50.0, dry=True, **over):
        coll = {**OFF, **(collectors or {})}
        cfg = make_cfg(self.tmp, collectors=coll, **over)
        st = make_store(self.tmp, free_pct=free)
        out = io.StringIO()
        tgm = TelegramAdapter(cfg["telegram"], "aicc-test", dry_run=dry, out=out, log=lambda m: None, environ={})
        r = Runtime(cfg, st, tgm, log=lambda m: None)
        r.out = out
        return r

    def test_cycle_writes_metrics_and_self_metrics(self):
        r = self.rt({"host": {"enabled": True, "units": [], "mounts": ["/"]}})
        r.cycle(1_800_000_000.0)
        r.cycle(1_800_000_030.0)
        names = r.store.metric_names()
        for n in ("mem.used_pct", "collector.host.ok", "ops.rss_bytes", "ops.db_bytes", "ops.fs_free_pct", "disk.root.used_pct"):
            self.assertIn(n, names)
        self.assertEqual(r.latest()["collector.host.ok"][0], 1.0)

    def test_one_collector_failing_does_not_stop_others_and_is_recorded_as_metric(self):
        write_exe(os.path.join(self.tmp, "mysql-bad"), "echo 'ERROR 1045 (28000): Access denied' >&2\nexit 1\n")
        r = self.rt({"host": {"enabled": True, "units": []},
                     "mysql": {"enabled": True, "client": os.path.join(self.tmp, "mysql-bad")}})
        r.cycle(1_800_000_000.0)
        lt = r.latest()
        self.assertEqual(lt["collector.mysql.ok"][0], 0.0)
        self.assertEqual(lt["collector.host.ok"][0], 1.0)
        self.assertIn("mysql", r.collector_errors())
        self.assertIn("mem.used_pct", lt)
        self.assertIn("collector.mysql.ok", r.store.metric_names())   # failure persisted as a metric

    def test_collector_failure_alert_fires_after_sustained_failures(self):
        write_exe(os.path.join(self.tmp, "mysql-bad"), "echo 'ERROR 1045 (28000): Access denied' >&2\nexit 1\n")
        r = self.rt({"mysql": {"enabled": True, "client": os.path.join(self.tmp, "mysql-bad"), "interval_s": 5}})
        t = 1_800_000_000.0
        notes = []
        for i in range(8):
            notes += r.cycle(t + i * 30)["notifications"]
        self.assertTrue([n for n in notes if n.rule == "collector_failure" and n.kind == FIRING])
        self.assertIn("collector 'mysql' is failing", r.out.getvalue())   # dry-run adapter printed it

    def test_disk_guard_blocks_writes_and_raises_critical_without_touching_db(self):
        r = self.rt({"host": {"enabled": True, "units": []}}, free=4.0)
        notes = []
        for i in range(3):
            notes += r.cycle(1_800_000_000.0 + i * 30)["notifications"]
        self.assertEqual(r.store.db.execute("SELECT COUNT(*) FROM raw").fetchone()[0], 0)
        crit = [n for n in notes if n.rule == "monitoring_write_blocked"]
        self.assertTrue(crit and crit[0].severity == "CRITICAL")
        self.assertIn("REFUSED", r.out.getvalue())
        # space returns -> writes resume
        r.store.free_pct_fn = lambda _p: 60.0
        r.cycle(1_800_000_200.0)
        self.assertGreater(r.store.db.execute("SELECT COUNT(*) FROM raw").fetchone()[0], 0)

    def test_maintenance_rolls_up_and_enforces_cap(self):
        r = self.rt({"host": {"enabled": True, "units": []}}, storage={"maintenance_interval_s": 1})
        for i in range(25):
            r.cycle(1_800_000_000.0 + i * 30)
        self.assertGreater(r.store.db.execute("SELECT COUNT(*) FROM r5").fetchone()[0], 0)

    def test_restart_keeps_alert_state_no_refire(self):
        r = self.rt({"mysql": {"enabled": True, "client": "/nonexistent/mysql", "interval_s": 5}})
        t = 1_800_000_000.0
        for i in range(8):
            r.cycle(t + i * 30)
        self.assertTrue(r.engine.active())
        cfg2 = r.cfg
        r2 = Runtime(cfg2, r.store, TelegramAdapter(cfg2["telegram"], "h", dry_run=True, out=io.StringIO(), log=lambda m: None, environ={}), log=lambda m: None)
        self.assertEqual(len(r2.engine.active()), len(r.engine.active()))
        notes = r2.cycle(t + 9 * 30)["notifications"]
        self.assertEqual([n for n in notes if n.kind == "FIRING"], [])

    def test_dry_run_runtime_opens_no_socket(self):
        with NoNetwork():
            r = self.rt({"host": {"enabled": True, "units": []}}, dry=True)
            for i in range(3):
                r.cycle(1_800_000_000.0 + i * 30)
            r.telegram.submit_text("test")

    def test_digest_text_is_pii_free_and_rendered(self):
        r = self.rt({"host": {"enabled": True, "units": []}})
        r.cycle(1_800_000_000.0); r.cycle(1_800_000_030.0)
        from aicc_ops.telegram import scan_pii
        t = r.digest_text()
        self.assertIn("Capacity verdict", t)
        self.assertEqual(scan_pii(t), [])


class DeliveryEndToEnd(TmpCase):
    """Production 20 (R3 M8): a Telegram refusal must neither lose the alert nor stay invisible. Real adapter, loopback fake Telegram, fake clock for the engine."""

    def setUp(self):
        super().setUp()
        self.srv = BodyServer(b'{"ok":false}', status=401)
        self.addCleanup(self.srv.close)
        self.secrets = put(os.path.join(self.tmp, "secrets.env"), "TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ0123456789\nTELEGRAM_CHAT_ID=-1001234567890\n")
        os.chmod(self.secrets, 0o600)
        write_exe(os.path.join(self.tmp, "mysql-bad"), "echo 'ERROR 1045 (28000): Access denied' >&2\nexit 1\n")
        coll = {**OFF, **{k: {"enabled": False} for k in ("fpmlog", "secupdates", "unitstatus")},
                "mysql": {"enabled": True, "client": os.path.join(self.tmp, "mysql-bad"), "interval_s": 5}}
        self.cfg = make_cfg(self.tmp, collectors=coll, telegram={"secrets_file": self.secrets, "min_interval_s": 0.0, "backoff_s": 0.01, "retries": 1})
        self.logs = []
        self.tg = TelegramAdapter(self.cfg["telegram"], "aicc-test", out=io.StringIO(), log=self.logs.append, test_base_url=self.srv.url, environ={}, sleep=lambda s: None)
        self.rt = Runtime(self.cfg, make_store(self.tmp), self.tg, log=lambda m: None)
        self.t0 = 1_800_000_000.0

    def run_cycles(self, start, n, step=30):
        notes = []
        for i in range(n):
            notes += self.rt.cycle(start + i * step)["notifications"]
            self.assertTrue(self.tg.flush(10))
        return notes

    def alert(self):
        return [a for a in self.rt.engine.active() if a["rule"] == "collector_failure"][0]

    def test_a_refused_alert_is_not_lost_and_is_sent_again_once_the_token_works(self):
        notes = self.run_cycles(self.t0, 6)
        self.assertEqual([n.kind for n in notes if n.rule == "collector_failure"], ["FIRING"])
        self.assertEqual(len(self.srv.requests), 1)                                     # Telegram answered 401
        self.assertIn("telegram: failed collector_failure FIRING", self.logs)
        self.assertFalse(self.alert()["notified"])                                      # recorded as NOT delivered
        self.assertEqual(self.alert()["delivery_fails"], 1)
        # the owner fixes the token: the same server now accepts
        self.srv.status, self.srv.body = 200, b'{"ok":true}'
        self.assertEqual(self.run_cycles(self.t0 + 6 * 30, 8), [])                      # inside the retry delay nothing is sent
        self.assertEqual(len(self.srv.requests), 1)
        notes = self.run_cycles(self.t0 + 14 * 30, 6)
        self.assertEqual([n.kind for n in notes if n.rule == "collector_failure"], ["FIRING"])
        self.assertEqual(len(self.srv.requests), 2)
        self.assertIn("telegram: delivered collector_failure FIRING", self.logs)
        self.assertTrue(self.alert()["notified"])
        self.assertEqual(self.alert()["delivery_fails"], 0)
        self.assertEqual(self.run_cycles(self.t0 + 20 * 30, 40), [])                     # delivered: back to the old behaviour, no further messages
        self.assertEqual(len(self.srv.requests), 2)

    def test_counters_and_times_are_stored_metrics(self):
        self.run_cycles(self.t0, 6)
        self.rt.cycle(self.t0 + 6 * 30)
        lt = self.rt.latest()
        self.assertEqual(lt["ops.telegram_enabled"][0], 1.0)
        self.assertEqual(lt["ops.telegram_failed"][0], 1.0)
        self.assertEqual(lt["ops.telegram_sent"][0], 0.0)
        self.assertIn("ops.telegram_last_failure_ts", lt)
        self.assertEqual(lt["ops.telegram_abandoned"][0], 0.0)
        self.assertNotIn("ops.telegram_last_ok_ts", lt)
        names = self.rt.store.metric_names()
        for n in ("ops.telegram_sent", "ops.telegram_failed", "ops.telegram_dropped", "ops.telegram_rate_limited", "ops.telegram_last_failure_ts"):
            self.assertIn(n, names)

    def test_a_runtime_without_telegram_adds_no_telegram_metrics(self):
        coll = {**OFF, "host": {"enabled": True, "units": []}}
        rt = Runtime(make_cfg(self.tmp, collectors=coll), make_store(self.tmp), None, log=lambda m: None)
        rt.cycle(self.t0)
        self.assertFalse([n for n in rt.latest() if n.startswith("ops.telegram")])

    def test_a_dry_run_runtime_behaves_as_before_and_never_re_arms(self):
        out = io.StringIO()
        tgm = TelegramAdapter(self.cfg["telegram"], "aicc-test", dry_run=True, out=out, log=lambda m: None, environ={})
        rt = Runtime(self.cfg, make_store(self.tmp), tgm, log=lambda m: None)
        for i in range(60):
            rt.cycle(self.t0 + i * 30)
        self.assertEqual(out.getvalue().count("collector 'mysql' is failing"), 1)
        self.assertTrue([a for a in rt.engine.active() if a["notified"]])


class CliTests(TmpCase):
    def test_check_config_redacts_and_once_runs(self):
        out = io.StringIO()
        with mock.patch("sys.stdout", out):
            rc = cli_main(["check-config"])
        self.assertEqual(rc, 0)
        self.assertIn('"bind": "127.0.0.1"', out.getvalue())

    def test_once_with_fixture_proc(self):
        cfgp = put(os.path.join(self.tmp, "c.toml"), '[collectors.mysql]\nenabled=false\n[collectors.caddy]\nenabled=false\n[collectors.phpfpm]\nenabled=false\n[collectors.backups]\nenabled=false\n[collectors.cert]\nenabled=false\n[collectors.edge]\nenabled=false\n[collectors.host]\nunits=[]\n')
        rc = cli_main(["--config", cfgp, "run", "--once", "--fixture-proc", fixture("proc_a"), "--data-dir", os.path.join(self.tmp, "d"), "--dry-run-telegram"])
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "d", "aicc-ops.sqlite3")))

    def test_bad_config_exit_2(self):
        p = put(os.path.join(self.tmp, "bad.toml"), "[server]\nport = 99999\n")
        self.assertEqual(cli_main(["--config", p, "check-config"]), 2)

    def test_telegram_test_is_dry_and_offline(self):
        out = io.StringIO()
        with NoNetwork(), mock.patch("sys.stdout", out):
            # adapter prints to its own `out` (sys.stdout at construction time)
            rc = cli_main(["telegram-test"])
        self.assertEqual(rc, 0)
        txt = out.getvalue()
        for needle in ("[WARNING]", "[CRITICAL]", "[RECOVERED]", "DAILY DIGEST", "DRY-RUN"):
            self.assertIn(needle, txt)

    def test_digest_off_by_default(self):
        out = io.StringIO()
        with mock.patch("sys.stderr", out):
            rc = cli_main(["digest", "--dry-run"])
        self.assertEqual(rc, 0)
        self.assertIn("disabled", out.getvalue())

    def _digest_cfg(self, secrets_path):
        return put(os.path.join(self.tmp, "d.toml"), f'[general]\ndata_dir = "{self.tmp}"\n[telegram]\nsecrets_file = "{secrets_path}"\nmin_interval_s = 0.0\nretries = 1\ndigest_enabled = true\n'
                   '[collectors.mysql]\nenabled=false\n[collectors.caddy]\nenabled=false\n[collectors.phpfpm]\nenabled=false\n[collectors.backups]\nenabled=false\n[collectors.cert]\nenabled=false\n[collectors.edge]\nenabled=false\n[collectors.host]\nunits=[]\n')

    def _run_digest(self, status):
        srv = BodyServer(b'{"ok":true}', status=status)
        self.addCleanup(srv.close)
        sec = put(os.path.join(self.tmp, "s.env"), "TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ0123456789\nTELEGRAM_CHAT_ID=-100123\n")
        os.chmod(sec, 0o600)
        real = TelegramAdapter

        def adapter(cfg, host, **kw):
            return real(cfg, host, test_base_url=srv.url, environ={}, sleep=lambda s: None, **kw)
        err = io.StringIO()
        with mock.patch("aicc_ops.cli.TelegramAdapter", adapter), mock.patch("sys.stderr", err):
            rc = cli_main(["--config", self._digest_cfg(sec), "digest"])
        return rc, err.getvalue(), srv

    def test_digest_start_up_line_does_not_claim_nothing_is_sent(self):
        rc, err, srv = self._run_digest(200)
        self.assertEqual(rc, 0, err)
        self.assertEqual(len(srv.requests), 1)
        self.assertNotIn("nothing is sent", err)
        self.assertIn("one daily-digest message", err)
        self.assertIn("telegram: delivered digest DIGEST", err)
        self.assertIn("digest delivered", err)

    def test_digest_that_was_refused_says_so_and_exits_nonzero(self):
        rc, err, srv = self._run_digest(401)
        self.assertEqual(rc, 1, err)
        self.assertIn("telegram: failed digest DIGEST", err)
        self.assertIn("digest NOT delivered", err)
        self.assertNotIn("ABCdefGh", err)


if __name__ == "__main__":
    unittest.main()
