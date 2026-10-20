import os
import shutil
import socket
import ssl
import subprocess
import threading
import time
import http.server
import unittest

from aicc_ops.collectors import Collector, CollectorError, Result, run_collector, build_collectors
from aicc_ops.collectors import host, caddy, phpfpm, mysql, cp, backups, cert, edge, postgres, unitstatus
from aicc_ops.config import load_config
from tests.helpers import read_text, put, TmpCase, fixture, read_fixture, make_cfg, write_exe, FakeFpm, BodyServer


class HostParsers(unittest.TestCase):
    def test_meminfo(self):
        m = host.parse_meminfo(read_fixture("proc_a", "meminfo"))
        self.assertEqual(m["MemTotal"], 2035944 * 1024)
        self.assertEqual(m["MemAvailable"], 1250308 * 1024)

    def test_stat_loadavg_uptime_vmstat(self):
        c = host.parse_stat_cpu(read_fixture("proc_a", "stat"))
        self.assertEqual(c["total"], 92975)
        self.assertEqual(c["idle"], 84835)
        self.assertEqual(host.parse_loadavg("0.52 0.48 0.40 2/231 18211"), (0.52, 0.48, 0.40))
        self.assertAlmostEqual(host.parse_uptime(read_fixture("proc_a", "uptime")), 1048577.12)
        self.assertEqual(host.parse_vmstat(read_fixture("proc_a", "vmstat")), {"pswpin": 1000, "pswpout": 5000})

    def test_diskstats_only_whole_disks(self):
        d = host.parse_diskstats(read_fixture("proc_a", "diskstats"))
        self.assertEqual(list(d), ["vda"])  # loop0 and the vda1 partition are excluded
        self.assertEqual(d["vda"]["rd_sectors"], 2802144)

    def test_netdev_and_route(self):
        n = host.parse_netdev(read_fixture("proc_a", "net", "dev"))
        self.assertEqual(n["eth0"], {"rx": 55120000, "tx": 21100000})
        self.assertEqual(host.parse_default_iface(read_fixture("proc_a", "net", "route")), "eth0")

    def test_cpus_cgroup_systemd(self):
        self.assertEqual(host.count_cpus(read_fixture("proc_a", "cpuinfo")), 1)
        self.assertEqual(host.parse_cgroup_cpu_max("max 100000"), None)
        self.assertEqual(host.parse_cgroup_cpu_max("50000 100000"), 0.5)
        kv = host.parse_systemctl_show(read_fixture("systemctl_show_active.txt"))
        self.assertEqual(kv["NRestarts"], "2")
        self.assertEqual(host.parse_systemd_ts(kv["ActiveEnterTimestamp"]), 1792490400)


class HostCollect(TmpCase):
    def _ctl(self):
        return write_exe(os.path.join(self.tmp, "fakectl"), f'''
unit="$4"
case "$unit" in
  php8.3-fpm) cat {fixture("systemctl_show_active.txt")} ;;
  mysql) cat {fixture("systemctl_show_failed.txt")} ;;
  *) cat {fixture("systemctl_show_notfound.txt")} ;;
esac
''')

    def test_two_cycles_compute_rates(self):
        cfg = make_cfg(self.tmp)
        sect = {**cfg["collectors"]["host"], "units": ["php8.3-fpm", "mysql", "nginx"], "systemctl": self._ctl()}
        state = {}
        r1 = host.collect(cfg, sect, state, 1000)
        self.assertNotIn("cpu.used_pct", r1.metrics)  # needs a previous sample
        cfg["general"]["proc_root"] = fixture("proc_b")
        r2 = host.collect(cfg, sect, state, 1030)
        m = r2.metrics
        self.assertEqual(r2.errors, [])
        self.assertAlmostEqual(m["cpu.used_pct"], 100 * (1 - 320 / 650), places=2)
        self.assertAlmostEqual(m["swap.in_pps"], 20.0)
        self.assertAlmostEqual(m["swap.out_pps"], 30.0)
        self.assertAlmostEqual(m["mem.used_pct"], 100 * (2035944 - 1063420) / 2035944, places=3)
        self.assertEqual(m["mem.total_bytes"], 2035944 * 1024)
        self.assertEqual(m["cpu.vcpus"], 1.0)
        self.assertAlmostEqual(m["net.rx_bps"], 10000.0)
        self.assertAlmostEqual(m["io.write_bps"], 8000 * 512 / 30, places=3)
        self.assertEqual(m["svc.php8_3_fpm.active"], 1.0)
        self.assertEqual(m["svc.php8_3_fpm.restarts"], 2.0)
        self.assertEqual(m["svc.mysql.failed"], 1.0)
        self.assertEqual(m["svc.mysql.active"], 0.0)
        self.assertEqual(m["svc.nginx.present"], 0.0)
        self.assertIn("disk.root.used_pct", m)
        self.assertAlmostEqual(m["load.per_vcpu"], 0.52)

    def test_section_failure_is_isolated(self):
        cfg = make_cfg(self.tmp)
        cfg["general"]["proc_root"] = os.path.join(self.tmp, "nope")
        r = host.collect(cfg, {**cfg["collectors"]["host"], "units": []}, {}, 1000)
        self.assertTrue(r.errors)  # reported, not raised
        self.assertIn("disk.root.used_pct", r.metrics)  # statvfs section still worked

    def test_counter_reset_is_ignored(self):
        cfg = make_cfg(self.tmp)
        sect = {**cfg["collectors"]["host"], "units": []}
        state = {}
        cfg["general"]["proc_root"] = fixture("proc_b")
        host.collect(cfg, sect, state, 1000)
        cfg["general"]["proc_root"] = fixture("proc_a")  # counters go backwards (reboot)
        r = host.collect(cfg, sect, state, 1030)
        self.assertNotIn("swap.in_pps", r.metrics)


class CaddyTests(unittest.TestCase):
    def test_parse_and_aggregate_low_cardinality(self):
        agg = caddy.aggregate(read_fixture("caddy_metrics_a.txt"))
        self.assertEqual(agg["status"]["2xx"], 600)
        self.assertEqual(agg["status"]["5xx"], 0)
        self.assertEqual(agg["in_flight"], 3)
        self.assertEqual(agg["upstreams"], [1.0])
        # nothing keyed by URL/method/host: only `le` bounds survive
        self.assertTrue(all(isinstance(k, float) for k in agg["buckets_all"]))

    def test_rates_and_percentiles_from_bucket_deltas(self):
        st = {}
        caddy.from_text(read_fixture("caddy_metrics_a.txt"), {}, st, 1000)
        r = caddy.from_text(read_fixture("caddy_metrics_b.txt"), {}, st, 1030).metrics
        self.assertAlmostEqual(r["caddy.rate_2xx"], 350 / 30)
        self.assertAlmostEqual(r["caddy.rate_5xx"], 5 / 30)
        self.assertAlmostEqual(r["caddy.req_rate"], 355 / 30)
        self.assertAlmostEqual(r["caddy.lat_p50_ms"], 177.5 / 300 * 5, places=3)
        self.assertAlmostEqual(r["caddy.dyn_lat_p95_ms"], (0.1 + 0.9 * (32.25 / 35)) * 1000, places=2)
        self.assertAlmostEqual(r["caddy.resp_bytes_ps"], 3000000 / 30)
        self.assertEqual(r["caddy.upstream_healthy_min"], 1.0)

    def test_quantile_edge_cases(self):
        self.assertIsNone(caddy.quantile_ms([], 0.5))
        self.assertIsNone(caddy.quantile_ms([(0.1, 0), (float("inf"), 0)], 0.5))
        # everything beyond the last finite bucket -> clamp to highest finite bound
        self.assertEqual(caddy.quantile_ms([(0.1, 0), (1.0, 0), (float("inf"), 10)], 0.99), 1000.0)

    def test_counter_reset_uses_new_value(self):
        st = {}
        caddy.from_text(read_fixture("caddy_metrics_b.txt"), {}, st, 1000)
        r = caddy.from_text(read_fixture("caddy_metrics_a.txt"), {}, st, 1030).metrics
        self.assertAlmostEqual(r["caddy.req_rate"], 600 / 30)  # restart: new counters are the delta

    def test_admin_only_metrics_give_up_only(self):
        r = caddy.from_text("caddy_reverse_proxy_upstreams_healthy{upstream=\"127.0.0.1:18982\"} 1\n", {}, {}, 1)
        self.assertEqual(r.metrics["caddy.up"], 1.0)
        self.assertNotIn("caddy.req_rate", r.metrics)

    def test_collect_http_loopback_only_and_down(self):
        cfg = {"url": "http://127.0.0.1:9/metrics", "timeout_s": 1}
        self.assertEqual(caddy.collect({}, cfg, {}, 1).metrics["caddy.up"], 0.0)
        with self.assertRaises(ValueError):
            caddy.collect({}, {"url": "http://example.com/metrics"}, {}, 1)  # SSRF guard
        with self.assertRaises(CollectorError):
            caddy.collect({}, {"url": "https://127.0.0.1/metrics"}, {}, 1)
        srv = BodyServer(read_fixture("caddy_metrics_a.txt").encode())
        try:
            r = caddy.collect({}, {"url": srv.url + "/metrics", "timeout_s": 2}, {}, 1)
            self.assertEqual(r.metrics["caddy.up"], 1.0)
        finally:
            srv.close()


class PhpFpmTests(TmpCase):
    def test_json_text_parsers(self):
        j = phpfpm.parse_status_json(read_fixture("phpfpm_status.json"))
        t = phpfpm.parse_status_text(read_fixture("phpfpm_status.txt"))
        for k in ("active", "idle", "total", "listen_queue", "max_children_reached", "slow_requests"):
            self.assertEqual(j[k], t[k])
        self.assertEqual(j["total"], 5)

    def test_collect_over_fastcgi_and_deltas(self):
        path = os.path.join(self.tmp, "f.sock")
        srv = FakeFpm(path, read_fixture("phpfpm_status.json").encode())
        try:
            cfg = {"socket": path, "status_path": "/fpm-status", "timeout_s": 2, "max_children": 10}
            st = {}
            m = phpfpm.collect({}, cfg, st, 1).metrics
            self.assertEqual(m["fpm.active"], 2.0)
            self.assertAlmostEqual(m["fpm.active_ratio"], 0.2)  # active / max(total, max_children)
            self.assertNotIn("fpm.max_children_reached_delta", m)
            self.assertEqual(srv.params["SCRIPT_NAME"], "/fpm-status")
            self.assertEqual(srv.params["QUERY_STRING"], "json")
            srv.body = read_fixture("phpfpm_status.json").replace('"max children reached":1', '"max children reached":3').encode()
            m2 = phpfpm.collect({}, cfg, st, 31).metrics
            self.assertEqual(m2["fpm.max_children_reached_delta"], 2.0)
        finally:
            srv.close()

    def test_down_and_bad_status(self):
        self.assertEqual(phpfpm.collect({}, {"socket": os.path.join(self.tmp, "none.sock"), "status_path": "/s"}, {}, 1).metrics["fpm.up"], 0.0)
        path = os.path.join(self.tmp, "g.sock")
        srv = FakeFpm(path, b"File not found.", status="404 Not Found")
        try:
            with self.assertRaises(CollectorError):
                phpfpm.collect({}, {"socket": path, "status_path": "/s", "timeout_s": 2}, {}, 1)
        finally:
            srv.close()


class MysqlTests(TmpCase):
    def _client(self, text, rc=0, err=""):
        p = os.path.join(self.tmp, "mysqlstub")
        write_exe(p, f"cat {fixture(text)} 2>/dev/null\n[ -n '{err}' ] && echo '{err}' >&2\nexit {rc}\n" if text else f"echo '{err}' >&2\nexit {rc}\n")
        return p

    def sect(self, client):
        return {"client": client, "socket": "/x.sock", "user": "aicc_monitor", "database": "wp", "timeout_s": 3}

    def test_deltas_and_pressure(self):
        st = {}
        r1 = mysql.from_pairs(mysql.parse_pairs(read_fixture("mysql_a.tsv")), st).metrics
        self.assertAlmostEqual(r1["mysql.conn_pressure_pct"], 7.0)
        self.assertNotIn("mysql.slow_queries_delta", r1)
        r2 = mysql.from_pairs(mysql.parse_pairs(read_fixture("mysql_b.tsv")), st).metrics
        self.assertEqual(r2["mysql.slow_queries_delta"], 2.0)
        self.assertEqual(r2["mysql.aborted_connects_delta"], 0.0)
        self.assertAlmostEqual(r2["mysql.qps"], 600 / 30)
        self.assertEqual(r2["mysql.db_size_bytes"], 73400320.0)

    def test_collect_via_cli(self):
        r = mysql.collect({}, self.sect(self._client("mysql_a.tsv")), {}, 1)
        self.assertEqual(r.metrics["mysql.up"], 1.0)

    def test_unreachable_is_down_not_collector_failure(self):
        r = mysql.collect({}, self.sect(self._client("", 1, "ERROR 2002 (HY000): Can't connect to local MySQL server")), {}, 1)
        self.assertEqual(r.metrics, {"mysql.up": 0.0})

    def test_access_denied_is_collector_failure(self):
        with self.assertRaises(CollectorError):
            mysql.collect({}, self.sect(self._client("", 1, "ERROR 1045 (28000): Access denied")), {}, 1)

    def test_missing_client(self):
        with self.assertRaises(CollectorError):
            mysql.collect({}, self.sect("/nonexistent/mysql"), {}, 1)

    def test_argv_has_no_password_and_uses_socket(self):
        a = mysql.build_argv(self.sect("mysql"))
        self.assertIn("--protocol=socket", a)
        self.assertFalse([x for x in a if "password" in x.lower() or x.startswith("-p")])


class CpTests(TmpCase):
    def test_parse_drops_unknown_metrics_and_bad_reasons(self):
        out = cp.parse_counters(read_fixture("cp_counters.tsv"), 2)
        self.assertEqual(out["cp.registrations_per_min"], 1.5)
        self.assertEqual(out["cp.login_failure_per_min"], (5 + 2 + 9) / 2)
        self.assertEqual(out["cp.login_failure.r.bad_password_per_min"], 2.5)
        self.assertEqual(out["cp.license_lifecycle_failure.r.issue_per_min"], 1.5)   # 'issue' is in the contract enum
        self.assertNotIn("cp.license_lifecycle_failure.r.provider_down_per_min", out)   # outside the enum: dropped
        self.assertEqual(out["cp.order_completed.r.processing_per_min"], 2.0)
        self.assertEqual(out["cp.registrations.r.checkout_per_min"], 1.0)
        self.assertAlmostEqual(out["cp.order_per_checkout_ratio"], 4 / 40)
        self.assertFalse([k for k in out if "evil" in k or "@" in k or "example" in k])

    def test_sql_is_integer_parameterised(self):
        sql = cp.counters_sql("wp_", 100, 105)
        self.assertIn("`wp_aicc_ops_counters`", sql)
        self.assertIn("bucket_minute > 100 AND bucket_minute <= 105", sql)

    def sect(self, client):
        return {"client": client, "socket": "/x", "user": "aicc_monitor", "database": "wp", "prefix": "wp_", "timeout_s": 3}

    def test_table_missing_tolerated(self):
        p = write_exe(os.path.join(self.tmp, "m"), "echo \"ERROR 1146 (42S02): Table 'wp.wp_aicc_ops_counters' doesn't exist\" >&2\nexit 1\n")
        r = cp.collect({}, self.sect(p), {}, 6000)
        self.assertEqual(r.errors, [])
        self.assertEqual(r.metrics["cp.table_present"], 0.0)

    def test_collects_counters_and_gauges_and_advances_minute(self):
        p = write_exe(os.path.join(self.tmp, "m"), f'''
case "$*" in
  *aicc_ops_counters*) cat {fixture("cp_counters.tsv")} ;;
  *actionscheduler_actions*GROUP*) printf 'pending\\t4\\nfailed\\t1\\n' ;;
  *options*) printf 'wc_cron_last_run_age_seconds\\t120\\n' ;;
  *) exit 1 ;;
esac
''')
        st = {}
        r = cp.collect({}, self.sect(p), st, 6000)
        self.assertEqual(r.metrics["cp.table_present"], 1.0)
        self.assertEqual(r.metrics["cp.action_scheduler_pending"], 4.0)
        self.assertEqual(r.metrics["cp.wc_cron_last_run_age_seconds"], 120.0)
        self.assertEqual(st["last_minute"], 6000 // 60 - 1)

    def test_cron_heartbeat_falls_back_to_action_scheduler_when_options_unreadable(self):
        p = write_exe(os.path.join(self.tmp, "m2"), f'''
case "$*" in
  *aicc_ops_counters*) cat {fixture("cp_counters.tsv")} ;;
  *GROUP*) printf 'pending\\t2\\n' ;;
  *wp_options*) echo "ERROR 1142 (42000): SELECT command denied" >&2; exit 1 ;;
  *) printf 'wc_cron_last_run_age_seconds\\t300\\n' ;;
esac
''')
        r = cp.collect({}, self.sect(p), {}, 6000)
        self.assertEqual(r.metrics["cp.wc_cron_last_run_age_seconds"], 300.0)
        self.assertEqual(r.metrics["cp.action_scheduler_failed"], 0.0)

    def test_requires_database(self):
        with self.assertRaises(CollectorError):
            cp.collect({}, {**self.sect("x"), "database": ""}, {}, 1)


class BackupTests(TmpCase):
    def test_status_json_is_primary_source(self):
        sf = put(os.path.join(self.tmp, "status.json"), read_fixture("backup_status_ok.json"))
        cfg = {"dir": self.tmp, "patterns": ["*.sql.gz"], "status_file": sf}
        m = backups.collect({}, cfg, {}, 1792553470 + 7200).metrics
        self.assertEqual(m["backup.status_ok"], 1.0)
        self.assertAlmostEqual(m["backup.newest_age_s"], 7200)
        self.assertEqual(m["backup.newest_size_bytes"], 3145728.0)
        self.assertEqual(m["backup.restore_check_ok"], 1.0)
        self.assertEqual(m["backup.status_present"], 1.0)

    def test_failed_run_keeps_age_of_last_success(self):
        sf = put(os.path.join(self.tmp, "status.json"), read_fixture("backup_status_failed_after_success.json"))
        m = backups.collect({}, {"dir": self.tmp, "patterns": [], "status_file": sf}, {}, 1792640000 + 100).metrics
        self.assertEqual(m["backup.status_ok"], 0.0)
        self.assertAlmostEqual(m["backup.newest_age_s"], 1792640100 - 1792553470)   # age of the LAST SUCCESS, not of the failure
        self.assertAlmostEqual(m["backup.last_run_age_s"], 100)
        self.assertEqual(m["backup.restore_check_ok"], 0.0)

    def test_unlistable_directory_0751_is_not_an_error(self):
        d = os.path.join(self.tmp, "b"); os.mkdir(d)
        sf = put(os.path.join(d, "status.json"), read_fixture("backup_status_ok.json"))
        os.chmod(d, 0o311)   # --x for owner: can open by name, cannot list (like 0751 for other users)
        try:
            r = backups.collect({}, {"dir": d, "patterns": ["*.sql.gz"], "status_file": sf}, {}, 1792553470 + 10)
            self.assertEqual(r.metrics["backup.dir_present"], 1.0)
            self.assertEqual(r.errors, [])
            os.unlink(sf)
            r2 = backups.collect({}, {"dir": d, "patterns": ["*.sql.gz"], "status_file": sf}, {}, 1)
        finally:
            os.chmod(d, 0o755)
        self.assertEqual(r2.metrics["backup.dir_present"], 1.0)    # exists, just not listable: never reported as "missing"
        self.assertEqual(r2.metrics["backup.status_present"], 0.0)

    def test_directory_scan_fallback(self):
        now = time.time()
        for name, age in (("a.sql.gz", 7200), ("b.sql.gz", 90000), ("note.txt", 10)):
            p = os.path.join(self.tmp, name)
            put(p, "x" * 10)
            os.utime(p, (now - age, now - age))
        m = backups.collect({}, {"dir": self.tmp, "patterns": ["*.sql.gz"], "status_file": ""}, {}, now).metrics
        self.assertAlmostEqual(m["backup.newest_age_s"], 7200, delta=2)
        self.assertEqual(m["backup.count"], 2.0)

    def test_missing_dir_and_garbage_status(self):
        m = backups.collect({}, {"dir": "/nonexistent-aicc", "patterns": ["*"], "status_file": ""}, {}, 1).metrics
        self.assertEqual(m["backup.dir_present"], 0.0)
        sf = put(os.path.join(self.tmp, "status.json"), "{not json")
        m2 = backups.collect({}, {"dir": self.tmp, "patterns": [], "status_file": sf}, {}, 1).metrics
        self.assertEqual(m2["backup.status_present"], 0.0)

    def test_parse_status_variants(self):
        self.assertTrue(backups.parse_status("ok"))
        self.assertFalse(backups.parse_status("status=error"))
        self.assertTrue(backups.parse_status('{"status":"ok"}'))
        self.assertIsNone(backups.parse_status(""))


class UnitStatusTests(TmpCase):
    def test_reads_failed_and_ok_files_with_allow_listed_names(self):
        d = self.tmp
        put(os.path.join(d, "unit-aicc-backup.service.json"), read_fixture("unit_failed.json"))
        put(os.path.join(d, "unit-aicc-edge.service.json"), read_fixture("unit_ok.json"))
        put(os.path.join(d, "unit-evil name;rm.service.json"), read_fixture("unit_failed.json"))   # ignored by the name filter
        put(os.path.join(d, "notes.txt"), "x")
        r = unitstatus.collect({}, {"dir": d}, {}, 1792600000 + 300)
        m = r.metrics
        self.assertEqual(m["unitfail.aicc_backup_service.failed"], 1.0)
        self.assertEqual(m["unitfail.aicc_edge_service.failed"], 0.0)
        self.assertEqual(m["unitfail.aicc_backup_service.age_s"], 300.0)
        self.assertEqual(m["unitfail.failed_count"], 1.0)
        self.assertFalse([k for k in m if "evil" in k or "rm" in k.split(".")])

    def test_missing_dir_and_corrupt_file(self):
        self.assertEqual(unitstatus.collect({}, {"dir": "/nonexistent-aicc"}, {}, 1).metrics, {"unitfail.dir_present": 0.0})
        put(os.path.join(self.tmp, "unit-x.service.json"), "{broken")
        r = unitstatus.collect({}, {"dir": self.tmp}, {}, 1)
        self.assertTrue(r.errors)


@unittest.skipUnless(shutil.which("openssl"), "openssl not available")
class CertTests(TmpCase):
    def setUp(self):
        super().setUp()
        self.key, self.crt = os.path.join(self.tmp, "k.pem"), os.path.join(self.tmp, "c.pem")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", self.key, "-out", self.crt,
                        "-days", "30", "-subj", "/CN=stage.copilt.org", "-addext", "subjectAltName=DNS:stage.copilt.org"],
                       check=True, capture_output=True)

    def test_der_not_after_matches_openssl(self):
        out = subprocess.run(["openssl", "x509", "-in", self.crt, "-noout", "-enddate"], capture_output=True, text=True).stdout
        expected = ssl.cert_time_to_seconds(out.strip().split("=", 1)[1])
        der = ssl.PEM_cert_to_DER_cert(open(self.crt).read()) if False else ssl.PEM_cert_to_DER_cert(read_text(self.crt))
        self.assertEqual(cert.der_not_after(der), expected)

    def test_file_mode(self):
        r = cert.collect({}, {"cert_file": self.crt, "timeout_s": 2}, {}, time.time()).metrics
        self.assertAlmostEqual(r["cert.days_left"], 30, delta=0.1)

    def test_served_cert_over_loopback_with_sni(self):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(self.crt, self.key)
        seen = {}
        ctx.sni_callback = lambda s, name, c: seen.setdefault("sni", name) and None
        srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(2)
        port = srv.getsockname()[1]

        def serve():
            for _ in range(2):
                try:
                    c, _a = srv.accept(); s = ctx.wrap_socket(c, server_side=True); s.close()
                except Exception:
                    pass
        threading.Thread(target=serve, daemon=True).start()
        r = cert.collect({}, {"host": "127.0.0.1", "port": port, "hostname": "stage.copilt.org", "cert_file": "", "timeout_s": 3}, {}, time.time())
        srv.close()
        self.assertEqual(r.metrics["cert.ok"], 1.0)
        self.assertAlmostEqual(r.metrics["cert.days_left"], 30, delta=0.1)
        self.assertEqual(seen["sni"], "stage.copilt.org")

    def test_non_loopback_refused(self):
        with self.assertRaises(ValueError):
            cert.collect({}, {"host": "203.0.113.5", "port": 443, "hostname": "x", "cert_file": ""}, {}, 1)

    def test_unreachable_is_ok_zero(self):
        r = cert.collect({}, {"host": "127.0.0.1", "port": 9, "hostname": "x", "cert_file": "", "timeout_s": 1}, {}, 1)
        self.assertEqual(r.metrics["cert.ok"], 0.0)

    def test_edge_probe_up_and_down(self):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(self.crt, self.key)
        paths = []

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def do_GET(self):
                paths.append((self.path, self.headers.get("Host")))
                self.send_response(200); self.send_header("Content-Length", "3"); self.end_headers(); self.wfile.write(b"ok\n")
        httpd = http.server.HTTPServer(("127.0.0.1", 0), H)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        cfg = {"host": "127.0.0.1", "port": httpd.server_address[1], "hostname": "stage.copilt.org", "path": "/healthz", "expect_status": 200, "timeout_s": 3}
        m = edge.collect({}, cfg, {}, 1).metrics
        httpd.shutdown(); httpd.server_close()
        self.assertEqual(m["edge.up"], 1.0)
        self.assertEqual(paths[0], ("/healthz", "stage.copilt.org"))
        self.assertEqual(edge.collect({}, {**cfg, "port": 9, "timeout_s": 1}, {}, 1).metrics["edge.up"], 0.0)


class IsolationTests(unittest.TestCase):
    def test_failure_timeout_and_success_are_isolated(self):
        cfg = load_config()
        def boom(*a): raise RuntimeError("kaput")
        def slow(*a): time.sleep(5)
        def ok(*a): return {"x.y": 1}
        cols = [Collector("boom", boom, {"timeout_s": 2}), Collector("slow", slow, {"timeout_s": 0.2}), Collector("ok", ok, {"timeout_s": 2})]
        res = {c.name: run_collector(c, cfg, 1) for c in cols}
        self.assertEqual(res["boom"]["collector.boom.ok"], 0.0)
        self.assertIn("RuntimeError", res["boom"]["_error.boom"])
        self.assertEqual(res["slow"]["collector.slow.ok"], 0.0)
        self.assertIn("timeout", res["slow"]["_error.slow"])
        self.assertEqual(res["ok"]["collector.ok.ok"], 1.0)
        self.assertEqual(res["ok"]["x.y"], 1.0)
        # a still-running hung collector is not stacked again
        again = run_collector(cols[1], cfg, 2)
        self.assertEqual(again["collector.slow.ok"], 0.0)

    def test_partial_errors_mark_not_ok_but_keep_metrics(self):
        c = Collector("p", lambda *a: Result({"a": 1}, ["section failed"]), {"timeout_s": 2})
        r = run_collector(c, load_config(), 1)
        self.assertEqual(r["collector.p.ok"], 0.0)
        self.assertEqual(r["a"], 1.0)

    def test_registry_respects_enabled_flags(self):
        names = [c.name for c in build_collectors(load_config())]
        self.assertNotIn("postgres", names)   # optional module stays disabled by default
        self.assertNotIn("cp", names)         # cp is opt-in until the table exists
        self.assertIn("host", names)


class PostgresDisabled(unittest.TestCase):
    def test_default_config_disables_postgres(self):
        self.assertFalse(load_config()["collectors"]["postgres"]["enabled"])


if __name__ == "__main__":
    unittest.main()
