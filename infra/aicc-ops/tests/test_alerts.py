import unittest

from aicc_ops.alerts import (AlertEngine, Obs, RuleSpec, Window, build_rules, default_rules, WARNING, CRITICAL,
                             FIRING, RECOVERED, ESCALATED, FLAPPING, REMINDER)
from aicc_ops.config import load_config
from tests.helpers import TmpCase, make_store

T = 1_000_000


def spec(**kw):
    d = dict(id="r", title="Rule", fn=None, for_samples=3, clear_samples=2, cooldown_s=600)
    d.update(kw)
    return RuleSpec(**d)


def feed(eng, seq, t0=1_000_000, step=30, sev=WARNING, scope="s"):
    """seq: iterable of 'b' breach, 'c' clear, 'h' hold, 'n' no-data, 'C' critical breach. Returns [(t, [kinds])]."""
    out = []
    for i, ch in enumerate(seq):
        t = t0 + i * step
        o = {"b": Obs("r", scope, True, False, sev, "txt"), "C": Obs("r", scope, True, False, CRITICAL, "txt"),
             "c": Obs("r", scope, False, True, sev), "h": Obs("r", scope, False, False, sev), "n": Obs("r", scope, None)}[ch]
        out.append((t, [n.kind for n in eng.process([o], t)]))
    return out


def kinds(res):
    return [k for _, ks in res for k in ks]


class StateMachine(unittest.TestCase):
    def eng(self, **kw):
        return AlertEngine([spec(**kw)])

    def test_fires_only_after_n_consecutive_breaches(self):
        e = self.eng()
        self.assertEqual(kinds(feed(e, "bbcbb")), [])          # interrupted: no alert
        e = self.eng()
        res = feed(e, "bbb")
        self.assertEqual(kinds(res), [FIRING])
        self.assertEqual(res[2][1], [FIRING])                   # at the 3rd sample exactly

    def test_dedup_while_firing(self):
        e = self.eng()
        self.assertEqual(kinds(feed(e, "bbbbbbbbbb")), [FIRING])
        self.assertEqual(len(e.active()), 1)

    def test_hysteresis_hold_and_recovery(self):
        e = self.eng()
        res = feed(e, "bbb" + "hhh" + "c" + "h" + "cc")
        self.assertEqual(kinds(res), [FIRING, RECOVERED])      # holds through 'h'; 'c','h','cc' -> needs 2 consecutive clears
        self.assertEqual(e.active(), [])

    def test_clear_streak_interrupted_by_breach(self):
        e = self.eng()
        self.assertEqual(kinds(feed(e, "bbbcbcb")), [FIRING])

    def test_no_data_does_not_change_state(self):
        e = self.eng()
        self.assertEqual(kinds(feed(e, "bbb" + "nnnn")), [FIRING])
        self.assertEqual(len(e.active()), 1)

    def test_recovered_message_has_duration(self):
        e = self.eng()
        notes = []
        for i, ch in enumerate("bbbbbbcc"):
            notes += e.process([Obs("r", "s", ch == "b", ch == "c", WARNING, "x")], T + i * 300)
        rec = [n for n in notes if n.kind == RECOVERED][0]
        self.assertIn("recovered after", rec.text)

    def test_cooldown_suppresses_refire_notification_then_notifies_after(self):
        e = self.eng(cooldown_s=600)
        res = feed(e, "bbb" + "cc" + "bbb", step=30)           # re-fires 60 s after recovery
        self.assertEqual(kinds(res), [FIRING, RECOVERED])      # second FIRING suppressed by cooldown
        later = e.process([Obs("r", "s", True, False, WARNING, "x")], T + 8 * 30 + 700)
        self.assertEqual([n.kind for n in later], [FIRING])   # still firing after cooldown -> deferred notification
        self.assertEqual([n.kind for n in e.process([Obs("r", "s", True, False, WARNING, "x")], T + 8 * 30 + 760)], [])

    def test_suppressed_fire_sends_no_recovery(self):
        e = AlertEngine([spec(cooldown_s=3600)], flap_max=10)
        res = feed(e, "bbb" + "cc" + "bbb" + "cc")
        self.assertEqual(kinds(res), [FIRING, RECOVERED])      # second episode: neither FIRING nor RECOVERED sent

    def test_escalation_to_critical_requires_crit_samples(self):
        e = self.eng(for_samples=2, crit_samples=4)
        res = feed(e, "bbCCCC")
        self.assertEqual(kinds(res), [FIRING, ESCALATED])
        self.assertEqual(e.active()[0]["severity"], CRITICAL)
        e2 = self.eng(for_samples=2, crit_samples=4)
        self.assertEqual(kinds(feed(e2, "bbCCbCC")), [FIRING])  # critical streak was interrupted

    def test_direct_critical(self):
        e = self.eng(for_samples=2, crit_samples=2)
        n = e.process([Obs("r", "s", True, False, CRITICAL, "x")], T) + e.process([Obs("r", "s", True, False, CRITICAL, "x")], T + 30)
        self.assertEqual((n[0].kind, n[0].severity), (FIRING, CRITICAL))

    def test_critical_reminders(self):
        e = self.eng(for_samples=1, crit_samples=1, renotify_critical_s=3600)
        res = feed(e, "C" * 8, step=1800)                       # 4 hours of critical
        self.assertEqual(kinds(res).count(REMINDER), 3)
        w = self.eng(for_samples=1)
        self.assertEqual(kinds(feed(w, "b" * 8, step=1800)), [FIRING])  # warnings never repeat by default

    def test_scopes_are_independent_keys(self):
        e = self.eng(for_samples=1)
        a = e.process([Obs("r", "a", True, False, WARNING, "x"), Obs("r", "b", True, False, WARNING, "x")], T)
        self.assertEqual(len(a), 2)
        self.assertEqual(len(e.active()), 2)
        self.assertEqual(e.process([Obs("r", "a", True, False, WARNING, "x")], T + 30), [])

    def test_flap_suppression_then_stable_exit(self):
        e = AlertEngine([spec(for_samples=1, clear_samples=1, cooldown_s=0)], flap_window_s=1800, flap_max=4)
        res = feed(e, "bcbcbcbc", step=30)
        ks = kinds(res)
        self.assertEqual(ks.count(FLAPPING), 1)                 # one flapping notice
        self.assertLess(len(ks), 8)                              # not one notice per change
        later = e.process([Obs("r", "s", False, True, WARNING)], T + 8 * 30 + 1900)
        self.assertTrue(later and later[0].kind == RECOVERED)   # quiet for a window -> stable notice
        self.assertFalse(e.state["r:s"]["flapping"])

    def test_disabled_engine_is_silent(self):
        e = AlertEngine([spec()], enabled=False)
        self.assertEqual(e.evaluate(Window(), 1), [])


class Persistence(TmpCase):
    def test_state_survives_restart_without_refiring(self):
        st = make_store(self.tmp)
        e1 = AlertEngine([spec()], st)
        self.assertEqual(kinds(feed(e1, "bbb")), [FIRING])
        e2 = AlertEngine([spec()], st)                           # "restart"
        self.assertEqual(len(e2.active()), 1)
        self.assertEqual(kinds(feed(e2, "bbbb", t0=2_000_000)), [])  # no duplicate FIRING
        self.assertEqual(kinds(feed(e2, "cc", t0=3_000_000)), [RECOVERED])
        hist = [h[4] for h in st.alert_history(10)]
        self.assertIn("FIRING", hist)
        self.assertIn("RECOVERED", hist)

    def test_persistence_failure_does_not_break_alerting(self):
        st = make_store(self.tmp)
        e = AlertEngine([spec(for_samples=1)], st)
        st.db.close()
        self.assertEqual(kinds(feed(e, "b")), [FIRING])


def win(**series):
    w = Window(30, stale={})
    n = max(len(v) for v in series.values())
    for i in range(n):
        w.push(1000 + i * 30, {k: v[i] for k, v in series.items() if i < len(v)})
    return w


CFG = load_config()
RULES = {r.id: r for r in default_rules(CFG)}


def obs(rule, w):
    return RULES[rule].fn(w, dict(RULES[rule].params))


class RuleTests(unittest.TestCase):
    def test_service_down(self):
        o = obs("service_down", win(**{"svc.mysql.active": [0], "svc.mysql.failed": [1], "svc.mysql.present": [1], "svc.fpm.active": [1]}))
        by = {x.scope: x for x in o}
        self.assertTrue(by["mysql"].breach and "failed" in by["mysql"].text and by["mysql"].severity == CRITICAL)
        self.assertFalse(by["fpm"].breach)
        self.assertTrue(by["fpm"].clear)

    def test_http_5xx_needs_minimum_traffic_and_share(self):
        quiet = obs("http_5xx", win(**{"caddy.rate_5xx": [0.1] * 10, "caddy.req_rate": [0.1] * 10}))  # 30 requests, 100% 5xx
        self.assertTrue(quiet[0].breach)
        tiny = obs("http_5xx", win(**{"caddy.rate_5xx": [0.01] * 10, "caddy.req_rate": [0.01] * 10}))  # 3 requests only
        self.assertFalse(tiny[0].breach)
        warn = obs("http_5xx", win(**{"caddy.rate_5xx": [0.1] * 10, "caddy.req_rate": [1.0] * 10}))   # 10%
        self.assertEqual((warn[0].breach, warn[0].severity), (True, WARNING))
        crit = obs("http_5xx", win(**{"caddy.rate_5xx": [0.5] * 10, "caddy.req_rate": [1.0] * 10}))   # 50%
        self.assertEqual(crit[0].severity, CRITICAL)
        ok = obs("http_5xx", win(**{"caddy.rate_5xx": [0.0] * 10, "caddy.req_rate": [1.0] * 10}))
        self.assertTrue(ok[0].clear and not ok[0].breach)

    def test_thresholds_for_ram_cpu_disk_inodes(self):
        self.assertEqual(obs("ram_high", win(**{"mem.used_pct": [91]}))[0].severity, WARNING)
        self.assertEqual(obs("ram_high", win(**{"mem.used_pct": [97]}))[0].severity, CRITICAL)
        self.assertFalse(obs("ram_high", win(**{"mem.used_pct": [88]}))[0].breach)    # between: hold
        self.assertFalse(obs("ram_high", win(**{"mem.used_pct": [88]}))[0].clear)
        self.assertTrue(obs("ram_high", win(**{"mem.used_pct": [80]}))[0].clear)
        self.assertTrue(obs("cpu_saturation", win(**{"cpu.used_pct": [92]}))[0].breach)
        d = {x.scope: x for x in obs("disk_low", win(**{"disk.root.used_pct": [94], "disk.var_lib.used_pct": [10]}))}
        self.assertEqual(d["root"].severity, CRITICAL)
        self.assertTrue(d["var_lib"].clear)
        self.assertTrue(obs("inodes_low", win(**{"disk.root.inodes_used_pct": [90]}))[0].breach)

    def test_swap_activity(self):
        self.assertTrue(obs("swap_activity", win(**{"swap.in_pps": [150], "swap.out_pps": [0]}))[0].breach)
        self.assertEqual(obs("swap_activity", win(**{"swap.in_pps": [1500], "swap.out_pps": [0]}))[0].severity, CRITICAL)
        self.assertTrue(obs("swap_activity", win(**{"swap.in_pps": [0], "swap.out_pps": [0]}))[0].clear)
        self.assertFalse(obs("swap_activity", win(**{"swap.in_pps": [5], "swap.out_pps": [50]}))[0].breach)  # small out-swap is normal

    def test_fpm_rules(self):
        self.assertTrue(obs("fpm_down", win(**{"fpm.up": [0]}))[0].breach)
        sat = obs("fpm_saturation", win(**{"fpm.up": [1] * 5, "fpm.max_children_reached_delta": [0, 0, 1, 0, 0], "fpm.listen_queue": [0] * 5, "fpm.active_ratio": [0.3] * 5}))[0]
        self.assertTrue(sat.breach and "max_children" in sat.text)
        queue = obs("fpm_saturation", win(**{"fpm.up": [1], "fpm.listen_queue": [12], "fpm.active_ratio": [1.0]}))[0]
        self.assertEqual(queue.severity, CRITICAL)
        idle = obs("fpm_saturation", win(**{"fpm.up": [1], "fpm.listen_queue": [0], "fpm.active_ratio": [0.2]}))[0]
        self.assertTrue(idle.clear)

    def test_db_rules(self):
        self.assertTrue(obs("db_down", win(**{"mysql.up": [0]}))[0].breach)
        self.assertEqual(obs("db_conn_pressure", win(**{"mysql.conn_pressure_pct": [96]}))[0].severity, CRITICAL)
        self.assertTrue(obs("db_conn_pressure", win(**{"mysql.conn_pressure_pct": [50]}))[0].clear)

    def test_backup_rules(self):
        self.assertEqual(obs("backup_stale", win(**{"backup.newest_age_s": [40 * 3600]}))[0].severity, WARNING)
        self.assertEqual(obs("backup_stale", win(**{"backup.newest_age_s": [80 * 3600]}))[0].severity, CRITICAL)
        self.assertTrue(obs("backup_stale", win(**{"backup.newest_age_s": [3600]}))[0].clear)
        self.assertTrue(obs("backup_stale", win(**{"backup.dir_present": [0]}))[0].breach)
        self.assertTrue(obs("backup_failed", win(**{"backup.status_ok": [0]}))[0].breach)
        rc = [o for o in obs("backup_failed", win(**{"backup.status_ok": [1], "backup.restore_check_ok": [0]})) if o.scope == "restore-check"][0]
        self.assertTrue(rc.breach and rc.severity == CRITICAL)
        # a 0751 directory (unlistable) with no status.json yet nudges, it does not claim the directory is missing
        nudge = obs("backup_stale", win(**{"backup.dir_present": [1], "backup.status_present": [0]}))[0]
        self.assertIn("no backup status file", nudge.text)
        self.assertEqual(obs("backup_stale", win(**{"backup.dir_present": [1], "backup.status_present": [1]})), [])

    def test_unit_failed_rule(self):
        o = {x.scope: x for x in RULES["unit_failed"].fn(win(**{"unitfail.aicc_backup_service.failed": [1], "unitfail.aicc_edge_service.failed": [0]}), {})}
        self.assertTrue(o["aicc_backup_service"].breach and o["aicc_backup_service"].severity == CRITICAL)
        self.assertTrue(o["aicc_edge_service"].clear)

    def test_cert_rules(self):
        by = {o.rule: o for o in obs("cert_expiry", win(**{"cert.days_left": [10], "cert.ok": [1]}))}
        self.assertEqual(by["cert_expiry"].severity, WARNING)
        self.assertEqual(obs("cert_expiry", win(**{"cert.days_left": [3]}))[0].severity, CRITICAL)
        self.assertTrue(obs("cert_expiry", win(**{"cert.days_left": [60]}))[0].clear)
        self.assertTrue([o for o in obs("cert_expiry", win(**{"cert.ok": [0]})) if o.rule == "cert_unreadable"][0].breach)

    def test_repeated_restarts_counts_increments_in_window(self):
        vals = [2, 2, 3, 3, 4, 5, 5]
        o = obs("process_restart", win(**{"svc.fpm.restarts": vals}))[0]
        self.assertEqual((o.breach, o.severity), (True, WARNING))   # 3 restarts
        self.assertIn("3 time", o.text)
        self.assertTrue(obs("process_restart", win(**{"svc.fpm.restarts": [2] * 6}))[0].clear)
        reset = obs("process_restart", win(**{"svc.fpm.restarts": [8, 8, 0, 1, 1]}))[0]    # counter reset after reboot
        self.assertFalse(reset.breach)

    def test_collector_failure_and_monitoring_rules(self):
        self.assertTrue(obs("collector_failure", win(**{"collector.mysql.ok": [0]}))[0].breach)
        cap_obs = RULES["monitoring_disk_cap"].fn(win(**{"ops.db_bytes": [140e6]}), {**RULES["monitoring_disk_cap"].params, "cap_bytes": 150e6})
        self.assertEqual(cap_obs[0].severity, WARNING)
        wb = obs("monitoring_write_blocked", win(**{"ops.write_blocked": [1], "ops.fs_free_pct": [6.2]}))[0]
        self.assertEqual(wb.severity, CRITICAL)
        self.assertIn("6.2%", wb.text)

    def test_stale_metrics_do_not_alert(self):
        w = Window(30, stale={"mysql.": 100})
        w.push(1000, {"mysql.up": 0})
        w.push(5000, {"cpu.used_pct": 1})   # time moved on; mysql data now stale
        self.assertEqual(obs("db_down", w), [])

    def test_buggy_rule_is_isolated(self):
        def bad(ctx, p): raise ValueError("x")
        eng = AlertEngine([spec(id="bad", fn=bad), spec(id="good", fn=lambda c, p: [Obs("good", "s", True, False, WARNING, "t")], for_samples=1)])
        notes = eng.evaluate(Window(), T)
        self.assertEqual([n.rule for n in notes if n.kind == FIRING and n.rule == "good"], ["good"])

    def test_config_overrides_apply(self):
        cfg = load_config(None, {"alerts": {"rules": {"ram_high": {"warn": 70, "for_samples": 3, "cooldown_s": 5}, "disk_low": {"enabled": False}}}})
        r = {x.id: x for x in build_rules(cfg)}
        self.assertEqual(r["ram_high"].params["warn"], 70)
        self.assertEqual((r["ram_high"].for_samples, r["ram_high"].cooldown_s), (3, 5))
        self.assertFalse(r["disk_low"].enabled)

    def test_catalogue_covers_requirements(self):
        ids = set(RULES)
        for needed in ("service_down", "edge_probe", "http_5xx", "ram_high", "swap_activity", "cpu_saturation", "disk_low",
                       "inodes_low", "fpm_saturation", "db_down", "db_conn_pressure", "backup_stale", "cert_expiry",
                       "process_restart", "collector_failure", "monitoring_disk_cap"):
            self.assertIn(needed, ids)


class RebootRequired(unittest.TestCase):
    """Architecture review M-2: unattended-upgrades never reboots; a pending reboot must be visible as a WARNING that only a reboot (the marker file disappearing) clears."""

    def test_rule_shape(self):
        r = RULES["reboot_required"]
        self.assertEqual((r.for_samples, r.clear_samples, r.cooldown_s), (1, 1, 86400))

    def test_breach_is_warning_and_clear_only_when_file_is_gone(self):
        pending = obs("reboot_required", win(**{"host.reboot_required": [1], "host.reboot_required_age_s": [3 * 86400]}))[0]
        self.assertTrue(pending.breach)
        self.assertFalse(pending.clear)
        self.assertEqual(pending.severity, WARNING)
        self.assertIn("3.0 days", pending.text)
        gone = obs("reboot_required", win(**{"host.reboot_required": [0]}))[0]
        self.assertTrue(gone.clear and not gone.breach)
        self.assertEqual(obs("reboot_required", win(**{"cpu.used_pct": [5]})), [])      # no data: no opinion

    def test_never_auto_clears_and_never_escalates(self):
        eng = AlertEngine([RULES["reboot_required"]])
        notes = []
        for i in range(3000):                                                          # ~25 h of 30 s samples with the file present
            notes += eng.evaluate(win(**{"host.reboot_required": [1], "host.reboot_required_age_s": [i * 30.0]}), T + i * 30)
        self.assertEqual([n.kind for n in notes], [FIRING])                            # one notice, no RECOVERED, no ESCALATED, no reminder
        self.assertEqual(notes[0].severity, WARNING)
        self.assertEqual(len(eng.active()), 1)
        rec = eng.evaluate(win(**{"host.reboot_required": [0]}), T + 3001 * 30)
        self.assertEqual([n.kind for n in rec], [RECOVERED])
        self.assertEqual(eng.active(), [])

    def test_message_has_no_pii_or_package_names(self):
        txt = obs("reboot_required", win(**{"host.reboot_required": [1], "host.reboot_required_age_s": [86400 * 2.5]}))[0].text
        import re
        self.assertIsNone(re.search(r"@|https?://|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|linux-image|libc6|openssl", txt))
        self.assertIn("NOT automatic", txt)

    def test_catalogue_lists_it(self):
        self.assertIn("reboot_required", RULES)


class CronCadence(unittest.TestCase):
    """The system cron timer runs every 2 minutes (architecture review H-2/H-4). wc_cron_stale must neither fire on that cadence nor on several missed runs."""

    def test_timer_file_and_alert_constant_agree(self):
        import os, re
        from aicc_ops.alerts import WP_CRON_CADENCE_S
        timer = open(os.path.join(os.path.dirname(__file__), "../../systemd/aicc-wp-cron.timer")).read()
        m = re.search(r"(?m)^OnCalendar=\*:0/(\d+)\s*$", timer)
        self.assertIsNotNone(m, "aicc-wp-cron.timer must use OnCalendar=*:0/N")
        self.assertEqual(int(m.group(1)) * 60, WP_CRON_CADENCE_S)

    def test_two_minute_cadence_never_alerts(self):
        from aicc_ops.alerts import WP_CRON_CADENCE_S
        p = RULES["wc_cron_stale"].params
        self.assertGreaterEqual(p["warn_s"], 15 * WP_CRON_CADENCE_S)          # a quarter hour of missed runs is still silent
        for age in (30, WP_CRON_CADENCE_S, WP_CRON_CADENCE_S + 10, 5 * WP_CRON_CADENCE_S, 10 * 60, 29 * 60):
            o = obs("wc_cron_stale", win(**{"cp.wc_cron_last_run_age_seconds": [age]}))[0]
            self.assertFalse(o.breach, "age %d s must not breach" % age)
        self.assertTrue(obs("wc_cron_stale", win(**{"cp.wc_cron_last_run_age_seconds": [3700]}))[0].breach)
        self.assertEqual(obs("wc_cron_stale", win(**{"cp.wc_cron_last_run_age_seconds": [15000]}))[0].severity, CRITICAL)
        # through the state machine: 20 consecutive samples of a "just ran 2 minutes ago" heartbeat produce no notification at all
        eng = AlertEngine([RULES["wc_cron_stale"]])
        notes = []
        for i in range(20):
            notes += eng.evaluate(win(**{"cp.wc_cron_last_run_age_seconds": [WP_CRON_CADENCE_S]}), T + i * 30)
        self.assertEqual(notes, [])


if __name__ == "__main__":
    unittest.main()
