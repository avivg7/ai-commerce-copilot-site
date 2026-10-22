"""Security-update freshness (WS14): collector over the hourly job's status file + the three rules."""
import json
import os
import re
import unittest

from aicc_ops.alerts import WARNING, CRITICAL, FIRING, RECOVERED
from aicc_ops.collectors import secupdates, build_collectors
from tests.helpers import TmpCase, put
from tests.test_alerts import obs, win, run_rule, RULES, T

NOW = 1_800_000_000


def status(**over):
    d = {"schema": 1, "ts": NOW - 600, "finished_epoch": NOW - 600, "ok": True, "update_rc": 0, "upgrade_rc": 0, "upgraded": ["libnss3"],
         "pending_count": 0, "pending_oldest_epoch": None, "stale_services": [], "reloaded": [], "reboot_required": False}
    d.update(over)
    return json.dumps(d)


class Collector(TmpCase):
    def run_collect(self, text=None):
        path = os.path.join(self.tmp, "security-updates.json")
        if text is not None:
            put(path, text)
        return secupdates.collect({}, {"status_file": path}, {}, NOW)

    def test_healthy_status(self):
        r = self.run_collect(status())
        self.assertEqual(r.errors, [])
        self.assertEqual(r.metrics["secupdates.status_present"], 1.0)
        self.assertEqual(r.metrics["secupdates.last_run_age_s"], 600.0)
        self.assertEqual(r.metrics["secupdates.last_ok"], 1.0)
        self.assertEqual(r.metrics["secupdates.pending_count"], 0.0)
        self.assertEqual(r.metrics["secupdates.pending_oldest_age_s"], 0.0)
        self.assertEqual(r.metrics["secupdates.stale_services"], 0.0)

    def test_pending_age_and_stale_services(self):
        r = self.run_collect(status(pending_count=2, pending_oldest_epoch=NOW - 7 * 3600, stale_services=["php8.3-fpm", "mysql"], ok=False, upgrade_rc=1))
        self.assertEqual(r.metrics["secupdates.pending_count"], 2.0)
        self.assertEqual(r.metrics["secupdates.pending_oldest_age_s"], 7 * 3600.0)
        self.assertEqual(r.metrics["secupdates.stale_services"], 2.0)
        self.assertEqual(r.metrics["secupdates.last_ok"], 0.0)

    def test_numbers_only_no_package_names_reach_the_metrics(self):
        r = self.run_collect(status(upgraded=["libnss3", "php8.3-fpm"], stale_services=["php8.3-fpm"]))
        self.assertFalse([k for k in r.metrics if "nss" in k or "php" in k])

    def test_missing_file_is_a_metric_not_an_error(self):
        r = secupdates.collect({}, {"status_file": os.path.join(self.tmp, "none.json")}, {}, NOW)
        self.assertEqual(r.metrics, {"secupdates.status_present": 0.0})
        self.assertEqual(r.errors, [])

    def test_corrupt_unknown_schema_and_bad_types(self):
        self.assertTrue(self.run_collect("{broken").errors)
        self.assertTrue(self.run_collect(json.dumps({"schema": 2})).errors)
        r = self.run_collect(status(pending_count="x", finished_epoch=True, stale_services="php"))
        self.assertNotIn("secupdates.pending_count", r.metrics)
        self.assertNotIn("secupdates.last_run_age_s", r.metrics)
        self.assertNotIn("secupdates.stale_services", r.metrics)

    def test_registered_and_enabled_by_default(self):
        from aicc_ops.config import load_config
        names = [c.name for c in build_collectors(load_config(None, {}))]
        self.assertIn("secupdates", names)


class PendingRule(unittest.TestCase):
    def test_thresholds_and_clear(self):
        w = lambda cnt, h: win(**{"secupdates.pending_count": [cnt], "secupdates.pending_oldest_age_s": [h * 3600]})
        self.assertFalse(obs("security_updates_pending", w(1, 2))[0].breach)           # inside the normal hourly window
        warn = obs("security_updates_pending", w(1, 7))[0]
        self.assertEqual((warn.breach, warn.severity), (True, WARNING))
        self.assertEqual(obs("security_updates_pending", w(3, 25))[0].severity, CRITICAL)
        self.assertTrue(obs("security_updates_pending", w(0, 0))[0].clear)
        self.assertEqual(obs("security_updates_pending", win(**{"cpu.used_pct": [5]})), [])  # no data: no opinion

    def test_message_has_numbers_and_no_package_names_or_versions(self):
        txt = obs("security_updates_pending", win(**{"secupdates.pending_count": [2], "secupdates.pending_oldest_age_s": [8 * 3600]}))[0].text
        self.assertIn("2 security update(s)", txt)
        self.assertIsNone(re.search(r"libnss|php8|openssl|\d+\.\d+\.\d+-\d|@|https?://", txt))

    def test_engine_fires_once_after_sustain_and_recovers(self):
        pend = {"secupdates.pending_count": 1.0, "secupdates.pending_oldest_age_s": 9 * 3600.0}
        clean = {"secupdates.pending_count": 0.0, "secupdates.pending_oldest_age_s": 0.0}
        out, eng = run_rule("security_updates_pending", [pend] * 6 + [clean] * 4)
        self.assertEqual([n.kind for _, n in out], [FIRING, RECOVERED])
        self.assertEqual(out[0][1].severity, WARNING)


class StaleRule(unittest.TestCase):
    def test_job_age_thresholds(self):
        w = lambda h: win(**{"secupdates.last_run_age_s": [h * 3600], "secupdates.last_ok": [1]})
        by = lambda o: {x.scope: x for x in o}
        self.assertFalse(by(obs("security_updates_stale", w(1.5)))["run"].breach)
        self.assertEqual(by(obs("security_updates_stale", w(5)))["run"].severity, WARNING)
        self.assertEqual(by(obs("security_updates_stale", w(13)))["run"].severity, CRITICAL)
        self.assertTrue(by(obs("security_updates_stale", w(1)))["run"].clear)

    def test_failed_last_run_is_its_own_warning_and_clears(self):
        o = {x.scope: x for x in obs("security_updates_stale", win(**{"secupdates.last_run_age_s": [1800], "secupdates.last_ok": [0]}))}
        self.assertTrue(o["result"].breach and o["result"].severity == WARNING)
        o2 = {x.scope: x for x in obs("security_updates_stale", win(**{"secupdates.last_run_age_s": [1800], "secupdates.last_ok": [1]}))}
        self.assertTrue(o2["result"].clear)

    def test_missing_status_file_only_matters_after_the_host_has_been_up_a_while(self):
        young = obs("security_updates_stale", win(**{"secupdates.status_present": [0], "uptime.seconds": [3600]}))[0]
        self.assertFalse(young.breach)
        old = obs("security_updates_stale", win(**{"secupdates.status_present": [0], "uptime.seconds": [3 * 86400]}))[0]
        self.assertTrue(old.breach)
        self.assertIn("never completed", old.text)


class ServicesRule(unittest.TestCase):
    def test_breach_and_clear(self):
        self.assertTrue(obs("services_need_restart", win(**{"secupdates.stale_services": [1]}))[0].breach)
        self.assertTrue(obs("services_need_restart", win(**{"secupdates.stale_services": [0]}))[0].clear)
        self.assertEqual(obs("services_need_restart", win(**{"cpu.used_pct": [1]})), [])

    def test_catalogue_and_shape(self):
        for r in ("security_updates_pending", "security_updates_stale", "services_need_restart"):
            self.assertIn(r, RULES)
        self.assertEqual(RULES["services_need_restart"].for_samples, 10)           # sustained 5 minutes: the job reloads PHP-FPM itself, so a transient is not an alert


if __name__ == "__main__":
    unittest.main()
