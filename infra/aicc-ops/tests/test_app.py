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


if __name__ == "__main__":
    unittest.main()
