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
        # defaults match the HOURLY backup timer: warn at 3 h without a new backup, critical at 12 h, clear below 2 h
        self.assertEqual(obs("backup_stale", win(**{"backup.newest_age_s": [4 * 3600]}))[0].severity, WARNING)
        self.assertEqual(obs("backup_stale", win(**{"backup.newest_age_s": [13 * 3600]}))[0].severity, CRITICAL)
        self.assertFalse(obs("backup_stale", win(**{"backup.newest_age_s": [2.5 * 3600]}))[0].breach)
        self.assertTrue(obs("backup_stale", win(**{"backup.newest_age_s": [3600]}))[0].clear)
        # review H5: the Mac lagging behind NEVER makes the HOST backup look stale
        self.assertFalse(obs("backup_stale", win(**{"backup.newest_age_s": [3600], "backup.offhost_set_age_s": [40 * 3600]}))[0].breach)
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
                       "process_restart", "collector_failure", "monitoring_disk_cap", "ram_available_low", "offhost_stale", "backup_failed", "unit_failed",
                       "caddy_admin", "fpm_down", "cert_unreadable"):
            self.assertIn(needed, ids)

    def test_owner_checklist_has_a_rule_for_every_item(self):
        """Caddy/site unhealthy, repeated 5xx, sustained CPU, low available RAM, swap, disk, FPM max_children, MySQL, backup freshness/failure, TLS, restarts/crashes."""
        checklist = {"Caddy/site unhealthy": ("edge_probe", "service_down"), "repeated 5xx": ("http_5xx",), "sustained high CPU": ("cpu_saturation",),
                     "sustained low available RAM": ("ram_available_low",), "swap pressure": ("swap_activity",), "disk": ("disk_low",),
                     "PHP-FPM max_children": ("fpm_saturation",), "MySQL unavailable": ("db_down",), "backup freshness/failure": ("backup_stale", "backup_failed", "offhost_stale"),
                     "TLS expiry": ("cert_expiry",), "unexpected restart/crash": ("process_restart", "service_down", "unit_failed")}
        for item, rules in checklist.items():
            for r in rules:
                self.assertIn(r, RULES, item)
                self.assertTrue(RULES[r].enabled, item)

    def test_threshold_rules_state_current_value_and_threshold(self):
        """Every threshold alert says what the value is AND what it is compared with."""
        samples = {
            "http_5xx": win(**{"caddy.rate_5xx": [1.0] * 10, "caddy.req_rate": [1.0] * 10}),
            "ram_high": win(**{"mem.used_pct": [97]}), "ram_available_low": win(**{"mem.available_bytes": [100 * MIB]}),
            "cpu_saturation": win(**{"cpu.used_pct": [99]}), "disk_low": win(**{"disk.root.used_pct": [95]}),
            "inodes_low": win(**{"disk.root.inodes_used_pct": [96]}), "db_conn_pressure": win(**{"mysql.conn_pressure_pct": [99]}),
            "backup_stale": win(**{"backup.newest_age_s": [80 * 3600]}), "cert_expiry": win(**{"cert.days_left": [3]}),
            "process_restart": win(**{"svc.fpm.restarts": [0, 1, 2, 3, 4, 5, 6, 7]}), "wc_cron_stale": win(**{"cp.wc_cron_last_run_age_seconds": [20000]}),
            "offhost_stale": win(**{"backup.offhost_present": [1], "backup.offhost_verified": [1], "backup.offhost_age_s": [100 * 3600]}),
            "swap_activity": win(**{"swap.in_pps": [1500], "swap.out_pps": [0]}),
        }
        for rule, w in samples.items():
            o = obs(rule, w)
            self.assertTrue(o and o[0].breach, rule)
            self.assertRegex(o[0].text, r"(warn|limit)", rule)
            self.assertRegex(o[0].text, r"\d", rule)


MIB = 1024 * 1024


def run_rule(rule_id, series, cfg=None, step=30):
    """Drive the REAL engine + default RuleSpec (sustain windows, cooldown) with a list of per-sample metric dicts. -> [(t, Notification)]"""
    eng = AlertEngine([r for r in build_rules(cfg or CFG) if r.id == rule_id])
    w = Window(step, stale={})
    out = []
    for i, metrics in enumerate(series):
        t = T + i * step
        w.push(t, metrics)
        out += [(t, n) for n in eng.evaluate(w, t)]
    return out, eng


def avail(mib):
    return {"mem.available_bytes": mib * MIB}


class RamAvailableLow(unittest.TestCase):
    def test_thresholds_and_hysteresis(self):
        self.assertFalse(obs("ram_available_low", win(**{"mem.available_bytes": [1059 * MIB]}))[0].breach)    # measured minimum under load: healthy
        self.assertTrue(obs("ram_available_low", win(**{"mem.available_bytes": [1059 * MIB]}))[0].clear)
        self.assertFalse(obs("ram_available_low", win(**{"mem.available_bytes": [200 * MIB]}))[0].breach)    # strictly below 200
        w = obs("ram_available_low", win(**{"mem.available_bytes": [199 * MIB]}))[0]
        self.assertEqual((w.breach, w.severity), (True, WARNING))
        self.assertEqual(obs("ram_available_low", win(**{"mem.available_bytes": [120 * MIB]}))[0].severity, WARNING)   # strictly below 120 for CRITICAL
        self.assertEqual(obs("ram_available_low", win(**{"mem.available_bytes": [119 * MIB]}))[0].severity, CRITICAL)
        hold = obs("ram_available_low", win(**{"mem.available_bytes": [250 * MIB]}))[0]
        self.assertEqual((hold.breach, hold.clear), (False, False))                                          # 200..300: hold
        self.assertFalse(obs("ram_available_low", win(**{"mem.available_bytes": [300 * MIB]}))[0].clear)      # clear is strictly > 300
        self.assertTrue(obs("ram_available_low", win(**{"mem.available_bytes": [301 * MIB]}))[0].clear)
        self.assertEqual(obs("ram_available_low", Window(30, stale={})), [])                                  # no data: no opinion

    def test_text_has_value_and_thresholds(self):
        t = obs("ram_available_low", win(**{"mem.available_bytes": [150 * MIB]}))[0].text
        self.assertEqual(t, "available memory 150 MiB (warn < 200 MiB, critical < 120 MiB)")

    def test_sustained_five_minutes_before_warning(self):
        notes, _ = run_rule("ram_available_low", [avail(150)] * 9)
        self.assertEqual(notes, [])                                       # 4.5 min: nothing
        notes, _ = run_rule("ram_available_low", [avail(150)] * 10)
        self.assertEqual([(n.kind, n.severity) for _, n in notes], [(FIRING, WARNING)])
        self.assertEqual(notes[0][0], T + 9 * 30)                         # exactly at the 10th 30-second sample

    def test_a_short_dip_never_alerts_and_never_sends_a_recovery(self):
        notes, _ = run_rule("ram_available_low", [avail(150)] * 6 + [avail(900)] * 20)
        self.assertEqual(notes, [])

    def test_critical_needs_its_own_sustained_window(self):
        notes, _ = run_rule("ram_available_low", [avail(150)] * 12 + [avail(100)] * 9)
        self.assertEqual([(n.kind, n.severity) for _, n in notes], [(FIRING, WARNING)])
        notes, _ = run_rule("ram_available_low", [avail(150)] * 12 + [avail(100)] * 10)
        self.assertEqual([(n.kind, n.severity) for _, n in notes], [(FIRING, WARNING), (ESCALATED, CRITICAL)])
        notes, _ = run_rule("ram_available_low", [avail(100)] * 10)
        self.assertEqual([(n.kind, n.severity) for _, n in notes], [(FIRING, CRITICAL)])

    def test_recovery_only_after_300_mib_is_sustained(self):
        notes, eng = run_rule("ram_available_low", [avail(150)] * 10 + [avail(250)] * 30 + [avail(290)] * 30)
        self.assertEqual([n.kind for _, n in notes], [FIRING])            # 250 and 290 MiB are in the hysteresis band: still active
        self.assertEqual(len(eng.active()), 1)
        notes, eng = run_rule("ram_available_low", [avail(150)] * 10 + [avail(400)] * 9)
        self.assertEqual([n.kind for _, n in notes], [FIRING])            # not yet 10 clear samples
        notes, eng = run_rule("ram_available_low", [avail(150)] * 10 + [avail(400)] * 10)
        self.assertEqual([n.kind for _, n in notes], [FIRING, RECOVERED])
        self.assertEqual(eng.active(), [])

    def test_no_storm_while_it_stays_low(self):
        notes, _ = run_rule("ram_available_low", [avail(150)] * 400)      # 3.3 hours
        self.assertEqual([n.kind for _, n in notes], [FIRING])            # WARNING never repeats

    def test_override_via_config(self):
        cfg = load_config(None, {"alerts": {"rules": {"ram_available_low": {"warn_mib": 500, "for_samples": 2}}}})
        notes, _ = run_rule("ram_available_low", [avail(400)] * 2, cfg)
        self.assertEqual([n.kind for _, n in notes], [FIRING])


H = 3600


def off(age_h=None, *, present=1, verified=1, reason=None, up_h=None, newest_h=None, set_age_h=None):
    m = {"backup.offhost_present": present, "backup.offhost_verified": verified}
    if set_age_h is not None:
        m["backup.offhost_set_age_s"] = set_age_h * H
    if age_h is not None:
        m["backup.offhost_age_s"] = age_h * H
    if reason is not None:
        m["backup.offhost_reason"] = reason
    if up_h is not None:
        m["uptime.seconds"] = up_h * H
    if newest_h is not None:
        m["backup.newest_age_s"] = newest_h * H
    return m


class OffhostStale(unittest.TestCase):
    def one(self, **kw):
        return obs("offhost_stale", win(**{k: [v] for k, v in off(**kw).items()}))

    def test_re_acknowledging_an_old_set_does_not_look_fresh(self):
        # the ack is 10 minutes old, but it names a set that is 40 h older than the newest backup on the host (review F10)
        o = self.one(age_h=0.2, set_age_h=41, newest_h=1)
        self.assertTrue(o[0].breach)
        self.assertEqual(o[0].severity, "WARNING")
        # an ack of the newest set (or one a couple of hours behind) is fine
        self.assertFalse(self.one(age_h=0.2, set_age_h=1.2, newest_h=1)[0].breach)
        self.assertFalse(self.one(age_h=0.2, set_age_h=4, newest_h=1)[0].breach)

    def test_thresholds(self):
        self.assertFalse(self.one(age_h=35.9)[0].breach)
        w = self.one(age_h=36.1)[0]
        self.assertEqual((w.breach, w.severity), (True, WARNING))
        self.assertEqual(self.one(age_h=95)[0].severity, WARNING)
        c = self.one(age_h=96.5)[0]
        self.assertEqual((c.breach, c.severity), (True, CRITICAL))
        self.assertTrue(self.one(age_h=29.9)[0].clear)
        hold = self.one(age_h=33)[0]
        self.assertEqual((hold.breach, hold.clear), (False, False))

    def test_text_says_what_to_do(self):
        t = self.one(age_h=40.2)[0].text
        self.assertIn("the owner's Mac has not confirmed a verified copy of the newest backup in 40 h", t)
        self.assertIn("(warn >= 36 h, critical >= 96 h)", t)
        self.assertIn("Mac asleep/offline?", t)
        self.assertIn("Run infra/backup/pull-offhost.sh.", t)
        self.assertEqual(tg_scan(t), [])

    def test_absent_file_on_a_new_host_is_silent(self):
        for kw in (dict(up_h=10, newest_h=2), dict(up_h=48, newest_h=2), dict(up_h=100, newest_h=None)):
            o = self.one(present=0, verified=0, **kw)[0]
            self.assertEqual((o.breach, o.clear), (False, True), kw)

    def test_absent_file_on_an_old_host_with_a_successful_backup_warns(self):
        o = self.one(present=0, verified=0, up_h=49, newest_h=5)[0]
        self.assertEqual((o.breach, o.severity), (True, WARNING))
        self.assertIn("pull-offhost.sh", o.text)
        self.assertIn("up 49 h", o.text)
        self.assertEqual(self.one(present=0, verified=0, up_h=24 * 30, newest_h=70)[0].severity, WARNING)    # never CRITICAL when absent

    def test_absent_file_with_unknown_uptime_holds_state(self):
        self.assertEqual(self.one(present=0, verified=0, newest_h=5), [])
        self.assertEqual(obs("offhost_stale", Window(30, stale={})), [])

    def test_invalid_acks_are_warnings_with_a_reason(self):
        for code, words in ((1, "not valid JSON"), (2, "schema"), (3, "NOT verified"), (4, "missing or invalid fields"), (5, "cannot be read")):
            o = self.one(verified=0, reason=code, age_h=1)[0]
            self.assertEqual((o.breach, o.severity), (True, WARNING), code)
            self.assertIn(words, o.text)
            self.assertIn("pull-offhost.sh", o.text)
        # a recent but unverified ack must not look healthy; an old verified-looking ack with verified=0 stays WARNING, not CRITICAL
        self.assertEqual(self.one(verified=0, reason=3, age_h=500)[0].severity, WARNING)

    def test_override_thresholds_via_config(self):
        cfg = load_config(None, {"alerts": {"rules": {"offhost_stale": {"warn_h": 12, "crit_h": 24, "absent_after_uptime_h": 1}}}})
        r = {x.id: x for x in build_rules(cfg)}["offhost_stale"]
        o = r.fn(win(**{k: [v] for k, v in off(age_h=13).items()}), dict(r.params))[0]
        self.assertEqual((o.breach, o.severity), (True, WARNING))
        o = r.fn(win(**{k: [v] for k, v in off(present=0, verified=0, up_h=2, newest_h=1).items()}), dict(r.params))[0]
        self.assertTrue(o.breach)

    def sustained(self, ages, **kw):
        series = [off(a, **kw) for a in ages]
        return run_rule("offhost_stale", series, step=30)

    def test_sustained_window_fire_escalate_hold_and_recover(self):
        notes, eng = self.sustained([37])
        self.assertEqual(notes, [])                                       # one sample is not enough (for_samples=2)
        notes, eng = self.sustained([37, 37])
        self.assertEqual([(n.kind, n.severity) for _, n in notes], [(FIRING, WARNING)])
        self.assertIn("37 h", notes[0][1].text)
        self.assertEqual(notes[0][1].scope, "offhost")
        notes, _ = self.sustained([37, 37, 97, 97])
        self.assertEqual([(n.kind, n.severity) for _, n in notes], [(FIRING, WARNING), (ESCALATED, CRITICAL)])
        notes, eng = self.sustained([37, 37] + [33] * 10)
        self.assertEqual([n.kind for _, n in notes], [FIRING])            # 30..36 h: hysteresis, no recovery
        self.assertEqual(len(eng.active()), 1)
        notes, eng = self.sustained([37, 37, 2])
        self.assertEqual([n.kind for _, n in notes], [FIRING])            # one clear sample is not enough
        notes, eng = self.sustained([37, 37, 2, 2])
        self.assertEqual([n.kind for _, n in notes], [FIRING, RECOVERED])
        self.assertEqual(eng.active(), [])

    def test_single_stale_blip_and_normal_operation_stay_silent(self):
        notes, _ = self.sustained([5, 37, 5, 37, 5, 6, 7])
        self.assertEqual(notes, [])
        notes, _ = self.sustained([a / 10 for a in range(0, 300)])        # ages climbing slowly to 30 h: never warns
        self.assertEqual(notes, [])

    def test_no_repeat_notice_for_a_warning_and_critical_reminders_are_6h_apart(self):
        notes, _ = self.sustained([40] * 1500)                            # 12.5 hours of WARNING
        self.assertEqual([n.kind for _, n in notes], [FIRING])
        notes, _ = self.sustained([100] * 1500)
        kinds_ = [n.kind for _, n in notes]
        self.assertEqual(kinds_[0], FIRING)
        self.assertTrue(set(kinds_[1:]) <= {REMINDER})
        self.assertLessEqual(len(kinds_), 3)

    def test_absent_then_ack_arrives_recovers(self):
        series = [off(present=0, verified=0, up_h=50, newest_h=3)] * 2 + [off(1)] * 2
        notes, eng = run_rule("offhost_stale", series)
        self.assertEqual([n.kind for _, n in notes], [FIRING, RECOVERED])

    def test_end_to_end_from_collector_output(self):
        from aicc_ops.collectors import backups
        now = 1_792_600_000
        ack = {"schema": 1, "acked_at": now - 50 * H, "set_ts": "20261019T033000Z", "dump": "d.sql.gz", "dump_sha256": "c" * 64, "puller": "mac-launchd", "verified": True}
        import json as _j
        import os, tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "offhost-ack.json")
            with open(path, "w") as fh:
                fh.write(_j.dumps(ack))
            m = backups.collect({}, {"dir": d, "patterns": [], "status_file": "", "offhost_ack_file": path}, {}, now).metrics
        notes, _ = run_rule("offhost_stale", [m, m])
        self.assertEqual([(n.kind, n.severity) for _, n in notes], [(FIRING, WARNING)])
        self.assertIn("50 h", notes[0][1].text)


def tg_scan(text):
    from aicc_ops.telegram import scan_pii
    return scan_pii(text)


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


class FpmMaxChildren(unittest.TestCase):
    """The pool ran out of workers: counts come from the root timer's JSON (the log itself is root-only)."""

    def one(self, e15, e5=0):
        return obs("fpm_max_children", win(**{"fpm.log_events_15m": [e15], "fpm.log_events_5m": [e5]}))

    def test_thresholds(self):
        self.assertFalse(self.one(0)[0].breach)
        self.assertFalse(self.one(4)[0].breach)
        o = self.one(5)[0]
        self.assertTrue(o.breach)
        self.assertEqual(o.severity, "WARNING")
        self.assertEqual(self.one(40)[0].severity, "CRITICAL")
        self.assertIn("pm.max_children", o.text)

    def test_no_data_holds_state(self):
        self.assertEqual(obs("fpm_max_children", Window(30, stale={})), [])

    def test_sustained_then_recovered(self):
        series = [{"fpm.log_events_15m": 12.0, "fpm.log_events_5m": 6.0}] * 3 + [{"fpm.log_events_15m": 0.0, "fpm.log_events_5m": 0.0}] * 12
        notes, _ = run_rule("fpm_max_children", series)
        self.assertEqual([n.kind for _, n in notes], [FIRING, RECOVERED])


class EntitlementOutbox(unittest.TestCase):
    """Architecture review M1: the Control Plane's entitlement outbox gauges alert on the Site side (WARNING: oldest undelivered > 15 min; CRITICAL: any abandoned)."""

    def test_rules_exist_with_frozen_gauge_names_and_thresholds(self):
        self.assertEqual(RULES["entitlement_outbox_stale"].params["warn_s"], 900)
        self.assertTrue(RULES["entitlement_outbox_stale"].enabled and RULES["entitlement_outbox_abandoned"].enabled)
        from aicc_ops.collectors.cp import OUTBOX_GAUGES
        self.assertEqual(OUTBOX_GAUGES, ("entitlement_outbox_pending", "entitlement_outbox_oldest_pending_age_s", "entitlement_outbox_abandoned"))

    def test_absent_gauges_never_alert(self):
        for rid in ("entitlement_outbox_stale", "entitlement_outbox_abandoned"):
            self.assertEqual(obs(rid, win(**{"cp.action_scheduler_pending": [3]})), [], rid)

    def test_stale_threshold_is_fifteen_minutes(self):
        for age, want in ((0, False), (300, False), (900, False), (901, True), (7200, True)):
            o = obs("entitlement_outbox_stale", win(**{"cp.entitlement_outbox_oldest_pending_age_s": [age], "cp.entitlement_outbox_pending": [2]}))[0]
            self.assertEqual(o.breach, want, age)
            self.assertEqual(o.severity, WARNING)
        self.assertTrue(obs("entitlement_outbox_stale", win(**{"cp.entitlement_outbox_oldest_pending_age_s": [100]}))[0].clear)
        self.assertIn("not reaching" if False else "min old", obs("entitlement_outbox_stale", win(**{"cp.entitlement_outbox_oldest_pending_age_s": [1800]}))[0].text)

    def test_abandoned_is_critical_from_one(self):
        o = obs("entitlement_outbox_abandoned", win(**{"cp.entitlement_outbox_abandoned": [1]}))[0]
        self.assertTrue(o.breach)
        self.assertEqual(o.severity, CRITICAL)
        o0 = obs("entitlement_outbox_abandoned", win(**{"cp.entitlement_outbox_abandoned": [0]}))[0]
        self.assertFalse(o0.breach)
        self.assertTrue(o0.clear)

    def test_state_machine_same_dedupe_and_cooldown_pattern(self):
        # the stale rule needs 2 consecutive samples, notifies once, then stays quiet through the cooldown and recovers after 2 clear samples
        eng = AlertEngine([RULES["entitlement_outbox_stale"]])
        notes = []
        for i in range(6):
            notes += eng.evaluate(win(**{"cp.entitlement_outbox_oldest_pending_age_s": [2000], "cp.entitlement_outbox_pending": [3]}), T + i * 30)
        self.assertEqual([n.kind for n in notes], [FIRING])
        self.assertEqual(notes[0].severity, WARNING)
        for i in range(6, 9):
            notes += eng.evaluate(win(**{"cp.entitlement_outbox_oldest_pending_age_s": [0], "cp.entitlement_outbox_pending": [0]}), T + i * 30)
        self.assertEqual([n.kind for n in notes], [FIRING, RECOVERED])
        # abandoned: fires on the FIRST sample, as CRITICAL, once
        eng = AlertEngine([RULES["entitlement_outbox_abandoned"]])
        notes = []
        for i in range(5):
            notes += eng.evaluate(win(**{"cp.entitlement_outbox_abandoned": [2]}), T + i * 30)
        self.assertEqual([(n.kind, n.severity) for n in notes], [(FIRING, CRITICAL)])
        # not reporting after it fired: the state is unchanged (no false RECOVERED)
        for i in range(5, 12):
            notes += eng.evaluate(win(**{"cp.action_scheduler_pending": [1]}), T + i * 30)
        self.assertEqual([n.kind for n in notes], [FIRING])
