#!/usr/bin/env python3.12
"""LOCAL DEVELOPMENT ONLY: a synthetic 'host' so AICC Ops can run end to end on a Mac.

Writes /proc-format files that evolve over time, serves Caddy-style Prometheus text on a loopback port, answers
PHP-FPM status over a unix socket (FastCGI), serves a TLS /healthz on a loopback port, and writes shim `systemctl` and
`mysql` executables reading a JSON state file. Everything is FIXTURE data: nothing here measures any real server.

  python3.12 tools/fake_host.py --dir ./fakehost --caddy-port 12199 --edge-port 18443
"""
import argparse
import http.server
import json
import math
import os
import random
import socket
import ssl
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from aicc_ops import fcgi  # noqa: E402

BUCKETS = ["0.005", "0.025", "0.1", "0.25", "1", "2.5", "10", "+Inf"]


def load_at(t, scale=1.0):
    """0..1 'busyness' with a daily rhythm, a slow wobble and random bursts."""
    day = 0.5 + 0.5 * math.sin((t % 86400) / 86400 * 2 * math.pi - 1.8)
    return max(0.02, min(1.0, (0.12 + 0.35 * day + random.random() * 0.05) * scale))


class Sim:
    def __init__(self, scale):
        self.scale = scale
        self.t = time.time()
        self.cpu = [1000, 10, 500, 90000, 200, 0, 50, 10]
        self.rx, self.tx = 10**9, 3 * 10**8
        self.rd, self.wr, self.io_ms = 10**7, 3 * 10**7, 10**6
        self.pswpin, self.pswpout = 5000, 90000
        self.reqs = {"2xx": 50000.0, "3xx": 3000.0, "4xx": 900.0, "5xx": 20.0}
        self.hist = {b: 0.0 for b in BUCKETS}
        self.dyn = {b: 0.0 for b in BUCKETS}
        self.resp_b, self.req_b = 5e8, 5e7
        self.reached = 0
        self.slow_q = 12
        self.queries = 10**6
        self.lock = threading.Lock()
        self.state = {}
        self.step(0)

    def step(self, dt):
        t = time.time()
        L = load_at(t, self.scale)
        with self.lock:
            self.t = t
            jiff = 100 * dt
            self.cpu[3] += jiff * (1 - L) * 0.99
            self.cpu[0] += jiff * L * 0.6
            self.cpu[2] += jiff * L * 0.35
            self.cpu[4] += jiff * 0.01 * (1 + L)
            self.cpu[7] += jiff * 0.003
            self.cpu[6] += jiff * L * 0.05
            self.rx += dt * 40000 * (0.3 + L); self.tx += dt * 150000 * (0.3 + L)
            self.rd += dt * 2e5 * L; self.wr += dt * 8e5 * (0.2 + L); self.io_ms += dt * 1000 * (0.03 + L * 0.25)
            used = 0.50 + 0.22 * L + 0.02 * math.sin(t / 3600)
            self.avail_kb = int(2035944 * (1 - used))
            swap_used = int(2097148 * min(0.4, max(0.01, (used - 0.55) * 1.2)))
            self.swap_free_kb = 2097148 - swap_used
            if used > 0.74:
                self.pswpin += dt * (used - 0.74) * 400
                self.pswpout += dt * (used - 0.74) * 500
            self.load = (0.2 + 1.1 * L, 0.2 + 1.0 * L, 0.2 + 0.9 * L)
            self.uptime = 86400 * 3 + (t % 100000)
            rate = (0.5 + 6 * L) * dt
            for cls, frac in (("2xx", 0.86), ("3xx", 0.07), ("4xx", 0.06), ("5xx", 0.0006 + (0.02 if L > 0.8 and random.random() < 0.05 else 0))):
                self.reqs[cls] += rate * frac
            n_dyn = rate * 0.35
            slow = 0.03 + 0.55 * L * L
            probs = [0.25, 0.30, 0.25, 0.10 - slow * 0.1, 0.06, 0.02 + slow * 0.1, 0.01 + slow * 0.05, 0.002]
            tot_p = sum(probs)
            run = 0.0
            for b, p in zip(BUCKETS, probs):
                run += p / tot_p
                self.dyn[b] += n_dyn * run          # cumulative histogram buckets
                self.hist[b] += rate * (0.55 + 0.45 * run)
            self.resp_b += rate * 40000; self.req_b += rate * 1500
            if L > 0.75 and random.random() < 0.05:
                self.reached += 1
            self.queries += dt * (20 + 200 * L)
            self.active = int(1 + 5 * L + random.random() * 2)
            self.state = {
                "mysql": {"Threads_connected": int(4 + 8 * L), "Threads_running": int(1 + 3 * L), "Max_used_connections": 19, "Slow_queries": int(12 + t % 997 / 40),
                          "Aborted_connects": 3, "Uptime": int(self.uptime), "Questions": int(self.queries), "Connections": int(self.queries / 100),
                          "max_connections": 151, "db_size_bytes": 73400320},
                "cp": [["registrations", "checkout", int(rate / 6)], ["login_success", "", int(rate)], ["login_failure", "bad_password", int(random.random() * 2)],
                       ["checkout_start", "", int(rate / 3)], ["order_completed", "completed", int(rate / 12)], ["license_issued", "", int(rate / 12)]],
                "as": {"pending": int(3 + 4 * L), "failed": 0}, "cron_age": int(30 + random.random() * 120),
                "units": {"aicc-edge": 1, "php8.3-fpm": 1, "mysql": 1, "fail2ban": 1},
            }

    def proc_files(self):
        with self.lock:
            c = [int(x) for x in self.cpu]
            return {
                "stat": f"cpu  {' '.join(map(str, c))} 0 0\ncpu0 {' '.join(map(str, c))} 0 0\nctxt 1\nbtime 1\n",
                "meminfo": f"MemTotal:        2035944 kB\nMemFree:          100000 kB\nMemAvailable:    {self.avail_kb} kB\nSwapTotal:       2097148 kB\nSwapFree:        {self.swap_free_kb} kB\n",
                "loadavg": "%.2f %.2f %.2f 1/200 100\n" % self.load,
                "uptime": f"{self.uptime:.2f} 1.0\n",
                "vmstat": f"pswpin {int(self.pswpin)}\npswpout {int(self.pswpout)}\n",
                "diskstats": f"   7       0 loop0 1 0 1 1 0 0 0 0 0 1 1\n 252       0 vda 100 0 {int(self.rd/512)} 10 100 0 {int(self.wr/512)} 10 0 {int(self.io_ms)} 20\n",
                "net/dev": "Inter-|   Receive\n face |bytes\n    lo: 1 1 0 0 0 0 0 0 1 1 0 0 0 0 0 0\n  eth0: %d 1 0 0 0 0 0 0 %d 1 0 0 0 0 0 0\n" % (self.rx, self.tx),
                "net/route": "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\neth0\t00000000\t0100A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0\n",
                "cpuinfo": "processor\t: 0\nmodel name\t: FIXTURE vCPU\n",
            }

    def caddy_text(self):
        with self.lock:
            o = ["# TYPE caddy_http_request_duration_seconds histogram"]
            codes = {"2xx": "200", "3xx": "301", "4xx": "404", "5xx": "502"}
            tot = sum(self.reqs.values())
            for cls, code in codes.items():
                share = self.reqs[cls] / tot
                for b in BUCKETS:
                    o.append(f'caddy_http_request_duration_seconds_bucket{{code="{code}",handler="file_server",method="GET",server="srv0",le="{b}"}} {int(self.hist[b] * share * 0.65)}')
                o.append(f'caddy_http_request_duration_seconds_count{{code="{code}",handler="file_server",method="GET",server="srv0"}} {int(self.hist["+Inf"] * share * 0.65)}')
            for b in BUCKETS:
                o.append(f'caddy_http_request_duration_seconds_bucket{{code="200",handler="reverse_proxy",method="GET",server="srv0",le="{b}"}} {int(self.dyn[b])}')
            o.append(f'caddy_http_request_duration_seconds_count{{code="200",handler="reverse_proxy",method="GET",server="srv0"}} {int(self.dyn["+Inf"])}')
            o.append(f'caddy_http_response_size_bytes_sum{{code="200",handler="file_server",method="GET",server="srv0"}} {int(self.resp_b)}')
            o.append(f'caddy_http_request_size_bytes_sum{{code="200",handler="file_server",method="GET",server="srv0"}} {int(self.req_b)}')
            o.append('caddy_http_requests_in_flight{handler="file_server",server="srv0"} %d' % random.randint(0, 3))
            o.append('caddy_reverse_proxy_upstreams_healthy{upstream="unix//run/php/php8.3-fpm.sock"} 1')
            return "\n".join(o) + "\n"

    def fpm_json(self):
        with self.lock:
            total = max(self.active + 1, 3)
            return json.dumps({"pool": "www", "process manager": "dynamic", "listen queue": 0, "max listen queue": 2, "idle processes": total - self.active,
                               "active processes": self.active, "total processes": total, "max active processes": 5, "max children reached": self.reached, "slow requests": self.reached * 2})


def write_atomic(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        fh.write(text)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--caddy-port", type=int, default=12199)
    ap.add_argument("--edge-port", type=int, default=18443)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--sock")
    ap.add_argument("--tick", type=float, default=3.0)
    a = ap.parse_args()
    d = os.path.abspath(a.dir)
    os.makedirs(os.path.join(d, "bin"), exist_ok=True)
    sim = Sim(a.scale)

    # shims reading state.json
    shim_ctl = f'''#!/usr/bin/env python3.12
import json, sys, time
st = json.load(open({os.path.join(d, "state.json")!r}))
unit = sys.argv[-1].replace(".service", "")
up = st["units"].get(unit, 0)
print("LoadState=loaded\\nActiveState=%s\\nSubState=%s\\nActiveEnterTimestamp=Mon 2026-10-19 08:00:00 UTC\\nNRestarts=0" % (("active", "running") if up else ("failed", "failed")))
'''
    shim_my = f'''#!/usr/bin/env python3.12
import json, sys
st = json.load(open({os.path.join(d, "state.json")!r}))
sql = sys.argv[-1]
if "SHOW GLOBAL STATUS" in sql:
    for k, v in st["mysql"].items(): print(f"{{k}}\\t{{v}}")
elif "aicc_ops_counters" in sql:
    for m, r, v in st["cp"]: print(f"{{m}}\\t{{r}}\\t{{v}}")
elif "GROUP BY status" in sql:
    for k, v in st["as"].items(): print(f"{{k}}\\t{{v}}")
elif "aicc_ops_cron_last_run" in sql:
    print("wc_cron_last_run_age_seconds\\t%d" % st["cron_age"])
else:
    sys.stderr.write("ERROR 1146 (42S02): not available in fixture\\n"); sys.exit(1)
'''
    for name, body in (("fake-systemctl", shim_ctl), ("fake-mysql", shim_my)):
        p = os.path.join(d, "bin", name)
        write_atomic(p, body)
        os.chmod(p, 0o755)
    # backups
    bdir = os.path.join(d, "backups")
    os.makedirs(bdir, exist_ok=True)
    dump = os.path.join(bdir, "aicc-fixture.sql.gz")
    write_atomic(dump, "fixture dump\n")
    os.utime(dump, (time.time() - 5 * 3600, time.time() - 5 * 3600))
    fin = int(time.time()) - 5 * 3600
    write_atomic(os.path.join(bdir, "status.json"), json.dumps({"schema": 1, "status": "ok", "label": "scheduled", "finished_epoch": fin, "disk_free_pct": 71,
                 "db_dump": {"bytes": 3145728, "restore_check": "ok"}, "last_success": {"finished_epoch": fin, "label": "scheduled"}}) + "\n")
    udir = os.path.join(d, "unitstatus")
    os.makedirs(udir, exist_ok=True)
    write_atomic(os.path.join(udir, "unit-aicc-backup.service.json"), json.dumps({"schema": 1, "unit": "aicc-backup.service", "state": "ok", "status": "ok", "since_epoch": fin}) + "\n")
    # TLS cert
    crt, key = os.path.join(d, "cert.pem"), os.path.join(d, "key.pem")
    if not os.path.exists(crt):
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", "63", "-subj", "/CN=fixture.invalid"], check=True, capture_output=True)

    def tick():
        last = time.time()
        while True:
            time.sleep(a.tick)
            now = time.time()
            sim.step(now - last)
            last = now
            for rel, text in sim.proc_files().items():
                write_atomic(os.path.join(d, "proc", rel), text)
            write_atomic(os.path.join(d, "state.json"), json.dumps(sim.state))
    for rel, text in sim.proc_files().items():
        write_atomic(os.path.join(d, "proc", rel), text)
    write_atomic(os.path.join(d, "state.json"), json.dumps(sim.state))
    threading.Thread(target=tick, daemon=True).start()

    class CH(http.server.BaseHTTPRequestHandler):
        def log_message(self, *x): pass
        def do_GET(self):
            b = sim.caddy_text().encode()
            self.send_response(200); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    threading.Thread(target=http.server.ThreadingHTTPServer(("127.0.0.1", a.caddy_port), CH).serve_forever, daemon=True).start()

    class EH(http.server.BaseHTTPRequestHandler):
        def log_message(self, *x): pass
        def do_GET(self):
            self.send_response(200); self.send_header("Content-Length", "3"); self.end_headers(); self.wfile.write(b"ok\n")
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(crt, key)
    eh = http.server.ThreadingHTTPServer(("127.0.0.1", a.edge_port), EH)
    eh.socket = ctx.wrap_socket(eh.socket, server_side=True)
    threading.Thread(target=eh.serve_forever, daemon=True).start()

    sock_path = a.sock or f"/tmp/aicc-fake-fpm-{os.getuid()}.sock"   # unix socket paths are limited to ~104 bytes on macOS
    if os.path.exists(sock_path):
        os.unlink(sock_path)
    srv = socket.socket(socket.AF_UNIX); srv.bind(sock_path); srv.listen(8)

    def fpm():
        while True:
            c, _ = srv.accept()
            try:
                for rtype, rid, content in fcgi.read_records(c):
                    if rtype == fcgi.STDIN and not content:
                        break
                out = b"Status: 200 OK\r\nContent-Type: application/json\r\n\r\n" + sim.fpm_json().encode()
                c.sendall(fcgi.record(fcgi.STDOUT, rid, out) + fcgi.record(fcgi.STDOUT, rid) + fcgi.record(fcgi.END_REQUEST, rid, b"\0" * 8))
            except Exception:
                pass
            finally:
                c.close()
    threading.Thread(target=fpm, daemon=True).start()

    cfg = f'''[general]
host_label = "FIXTURE-host (not a real server)"
banner = "FIXTURE DATA: synthetic host generated on a Mac for local end-to-end proof. These numbers measure nothing real."
proc_root = "{d}/proc"
data_dir = "{d}/data"
[server]
port = {int(os.environ.get("AICC_E2E_UI_PORT", "19190"))}
[collectors.host]
units = ["aicc-edge", "php8.3-fpm", "mysql", "fail2ban"]
systemctl = "{d}/bin/fake-systemctl"
[collectors.caddy]
url = "http://127.0.0.1:{a.caddy_port}/metrics"
[collectors.phpfpm]
socket = "{sock_path}"
max_children = 8
[collectors.mysql]
client = "{d}/bin/fake-mysql"
database = "wpfixture"
[collectors.cp]
enabled = true
client = "{d}/bin/fake-mysql"
database = "wpfixture"
[collectors.backups]
dir = "{bdir}"
status_file = "{bdir}/status.json"
[collectors.unitstatus]
dir = "{udir}"
[collectors.cert]
port = {a.edge_port}
hostname = "fixture.invalid"
[collectors.edge]
port = {a.edge_port}
hostname = "fixture.invalid"
[telegram]
secrets_file = "{d}/no-secrets.env"
'''
    write_atomic(os.path.join(d, "e2e.toml"), cfg)
    print(f"fake host ready in {d}; config: {d}/e2e.toml", flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
