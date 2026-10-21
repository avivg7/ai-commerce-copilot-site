#!/usr/bin/env node
// stage-sampler.mjs: resource sampler + analysis for the REAL Linux staging host (stage.copilt.org, DigitalOcean 1 vCPU / 2 GiB).
//
// WHAT IT IS. A reusable measurement tool for a capacity decision. It holds ONE persistent SSH session (through ~/aicc-rehearsal/bin/stage-ssh, which is hard-wired to the staging Droplet; this
// script never builds an ssh command to any other host) that runs a tiny stdlib-only Python sampler on the host every INTERVAL seconds (default 2) and streams one CSV line per sample to the MAC.
// Nothing is written on the host (no file, no log); the sampler is a single python3 process that ends when the SSH session ends (broken pipe) or on its own deadline.
//
//   node scripts/rehearsal/stage-sampler.mjs run   --out FILE.csv [--phase-file F] [--interval 2] [--duration SECONDS] [--phase LABEL]
//        starts the persistent session. The phase label of every sample is read from --phase-file (default: FILE.csv.phase) at the moment the line arrives on the Mac;
//        change it at any time with:   node scripts/rehearsal/stage-sampler.mjs phase "static-browsing" --phase-file F       (browser-flows.mjs does this itself: --sampler-phase-file F)
//        Stops on SIGINT/SIGTERM or after --duration. If the SSH session drops it reconnects (a row `# reconnect` is written and the phase continues).
//   node scripts/rehearsal/stage-sampler.mjs phase LABEL [--phase-file F]
//   node scripts/rehearsal/stage-sampler.mjs snapshot --out FILE.json
//        one-shot host log/counter snapshot: php-fpm pool log ("server reached pm.max_children" lines + timestamps), slowlog entry count, MySQL Max_used_connections / Connections / max_connections,
//        OOM kills in the kernel log, fail2ban jail status (currently banned, total banned, failed), php-fpm /fpm-status once. Take one BEFORE and one AFTER a run; `summarize --before/--after` diffs them.
//   node scripts/rehearsal/stage-sampler.mjs summarize --csv FILE.csv [--out-dir DIR] [--name NAME] [--load-json FILE] [--before FILE.json --after FILE.json]
//        per-phase table (n, seconds, RAM used / available, swap, swap-in/out, CPU busy, load, PHP workers and RSS/PSS, mysqld, caddy, pool status counters, MySQL threads, PSI, sampler overhead)
//        as NAME.summary.json + NAME.summary.md.
//
// COLUMNS (CSV): iso (Mac receive time), epoch (host clock), phase, mem_total_mb, mem_used_mb (free-style: total - free - buffers - page cache - reclaimable slab), mem_avail_mb (MemAvailable),
//   mem_free_mb, cache_mb, swap_used_mb, pswpin_d / pswpout_d (pages swapped in/out since the previous sample), pgmajfault_d, oom_kill_d, load1, load5, cpu_busy_pct (100 - idle - iowait over the
//   interval), cpu_user_pct, cpu_sys_pct, cpu_iowait_pct, cpu_steal_pct, psi_cpu_some10, psi_mem_some10, psi_mem_full10, psi_io_some10, psi_io_full10 (avg10, % of time stalled),
//   psi_cpu_some_us_d / psi_mem_some_us_d / psi_io_some_us_d (stall microseconds in the interval), fpm_procs (php-fpm "pool aicc" worker processes seen by ps), fpm_rss_kb (sum of VmRSS), fpm_pss_kb (sum of PSS: shared
//   pages counted once, the honest figure), fpm_max_rss_kb (biggest worker), mysql_rss_kb / mysql_pss_kb, caddy_rss_kb / caddy_pss_kb (the edge: the process running /etc/aicc-edge/Caddyfile),
//   fpm_active / fpm_idle / fpm_total / fpm_max_active / fpm_listen_queue / fpm_max_listen_queue / fpm_max_children_reached / fpm_slow_requests / fpm_accepted_conn (the pool's own /fpm-status, asked over the
//   FastCGI socket as root), mysql_threads_connected / mysql_threads_running / mysql_max_used / mysql_connections (cumulative) every 3rd sample (blank otherwise), self_cpu_pct (CPU the sampler itself
//   used in the interval, so its overhead is on record), sample_ms (time the sampler spent collecting), cpu_fpm_pct / cpu_mysql_pct / cpu_caddy_pct / cpu_sampler_pct / cpu_other_pct (which process
//   class consumed the CPU: utime+stime ticks of the php-fpm "pool aicc" workers, mysqld, the edge's caddy, this sampler (and its sudo/mysql children), and everything else = busy% minus the four, as % of the host's total CPU capacity in
//   the interval; a worker that exits inside an interval loses its last ticks, so the classes slightly under-count when php-fpm recycles workers (pm.max_requests = 300)). cpu_steal_pct is the hypervisor steal (the 8th /proc/stat field).
// The status request to /fpm-status is itself one short FastCGI request per sample (it is served by a pool worker, so it is a small, constant, DISCLOSED perturbation: ~0.5 request/s).
//
// SAFETY. Read-only on the host: /proc, one FastCGI GET of /fpm-status over the local socket, `mysql -N -e SHOW GLOBAL STATUS` (read only). sudo is used only to read other users' /proc/<pid>/smaps_rollup,
// the root-only socket and the MySQL socket. No secret is read, none is printed.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STAGE_SSH = process.env.AICC_STAGE_SSH || path.join(os.homedir(), "aicc-rehearsal/bin/stage-ssh");

export const COLUMNS = ["epoch", "mem_total_mb", "mem_used_mb", "mem_avail_mb", "mem_free_mb", "cache_mb", "swap_used_mb", "pswpin_d", "pswpout_d", "pgmajfault_d", "oom_kill_d", "load1", "load5",
  "cpu_busy_pct", "cpu_user_pct", "cpu_sys_pct", "cpu_iowait_pct", "cpu_steal_pct", "psi_cpu_some10", "psi_mem_some10", "psi_mem_full10", "psi_io_some10", "psi_io_full10",
  "psi_cpu_some_us_d", "psi_mem_some_us_d", "psi_io_some_us_d", "fpm_procs", "fpm_rss_kb", "fpm_pss_kb", "fpm_max_rss_kb", "mysql_rss_kb", "mysql_pss_kb", "caddy_rss_kb", "caddy_pss_kb",
  "fpm_active", "fpm_idle", "fpm_total", "fpm_max_active", "fpm_listen_queue", "fpm_max_listen_queue", "fpm_max_children_reached", "fpm_slow_requests", "fpm_accepted_conn",
  "mysql_threads_connected", "mysql_threads_running", "mysql_max_used", "mysql_connections", "self_cpu_pct", "sample_ms", "cpu_fpm_pct", "cpu_mysql_pct", "cpu_caddy_pct", "cpu_sampler_pct", "cpu_other_pct"];

/** The host-side sampler (Python 3 stdlib). Printed lines: CSV with COLUMNS. Arguments: interval seconds, deadline seconds (0 = none). */
const REMOTE_PY = String.raw`
import os, sys, time, socket, struct, subprocess, re
IV = float(sys.argv[1]); DEADLINE = float(sys.argv[2]); T0 = time.time()
PAGE = os.sysconf("SC_PAGE_SIZE"); HZ = os.sysconf("SC_CLK_TCK")
def rd(p):
    try:
        with open(p) as f: return f.read()
    except Exception: return ""
def meminfo():
    d = {}
    for l in rd("/proc/meminfo").splitlines():
        k, _, v = l.partition(":"); d[k] = int(v.split()[0]) if v.split() else 0
    return d
def vmstat():
    d = {}
    for l in rd("/proc/vmstat").splitlines():
        p = l.split()
        if len(p) == 2: d[p[0]] = int(p[1])
    return d
def stat():
    p = rd("/proc/stat").splitlines()[0].split()[1:]
    return [int(x) for x in p[:8]]
def psi(n):
    out = {}
    for l in rd("/proc/pressure/" + n).splitlines():
        p = l.split(); kind = p[0]; kv = dict(x.split("=") for x in p[1:])
        out[kind] = (float(kv.get("avg10", 0)), int(kv.get("total", 0)))
    return out
def pss(pid):
    for l in rd("/proc/%d/smaps_rollup" % pid).splitlines():
        if l.startswith("Pss:"): return int(l.split()[1])
    return 0
def classify():
    r = {"fpm": [], "mysql": [], "caddy": []}
    for e in os.listdir("/proc"):
        if not e.isdigit(): continue
        pid = int(e)
        try:
            cmd = open("/proc/%d/cmdline" % pid, "rb").read().replace(b"\0", b" ").decode("utf8", "replace")
        except Exception: continue
        if cmd.startswith("php-fpm: pool aicc"): k = "fpm"
        elif "/usr/sbin/mysqld" in cmd[:40] or cmd.startswith("mysqld"): k = "mysql"
        elif "caddy run" in cmd and "/etc/aicc-edge/Caddyfile" in cmd: k = "caddy"
        else: continue
        try: rss = int(open("/proc/%d/statm" % pid).read().split()[1]) * PAGE // 1024
        except Exception: continue
        r[k].append((pid, rss))
    return r
def ticks(pid):
    p = rd("/proc/%d/stat" % pid).rsplit(")", 1)[-1].split()
    return (int(p[11]) + int(p[12])) if len(p) > 13 else None
NCPU = os.cpu_count() or 1
PT = {}  # pid -> last utime+stime ticks
def fcgi_status():
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.settimeout(2); s.connect("/run/php/aicc-cp.sock")
        def rec(t, body, rid=1):
            return struct.pack("!BBHHBx", 1, t, rid, len(body), 0) + body
        def nv(k, v):
            def ln(n): return struct.pack("B", n) if n < 128 else struct.pack("!I", n | 0x80000000)
            return ln(len(k)) + ln(len(v)) + k + v
        params = b"".join(nv(k, v) for k, v in [(b"SCRIPT_NAME", b"/fpm-status"), (b"SCRIPT_FILENAME", b"/fpm-status"), (b"REQUEST_METHOD", b"GET"), (b"QUERY_STRING", b"")])
        s.sendall(rec(1, struct.pack("!HB5x", 1, 0)) + rec(4, params) + rec(4, b"") + rec(5, b""))
        out = b""
        while True:
            h = b""
            while len(h) < 8:
                c = s.recv(8 - len(h))
                if not c: raise EOFError
                h += c
            v, t, rid, cl, pl = struct.unpack("!BBHHBx", h)
            body = b""
            while len(body) < cl + pl:
                c = s.recv(cl + pl - len(body))
                if not c: raise EOFError
                body += c
            if t == 6: out += body[:cl]
            if t == 3: break
        s.close()
        txt = out.decode("utf8", "replace").split("\r\n\r\n", 1)[-1]
        d = {}
        for l in txt.splitlines():
            k, _, v = l.partition(":")
            d[k.strip()] = v.strip()
        g = lambda k: d.get(k, "")
        return [g("active processes"), g("idle processes"), g("total processes"), g("max active processes"), g("listen queue"), g("max listen queue"), g("max children reached"), g("slow requests"), g("accepted conn")]
    except Exception:
        return [""] * 9
def mysql_status():
    try:
        o = subprocess.run(["mysql", "-N", "-e", "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Max_used_connections','Connections')"], capture_output=True, text=True, timeout=4).stdout
        d = dict(l.split("\t") for l in o.strip().splitlines() if "\t" in l)
        return [d.get("Threads_connected", ""), d.get("Threads_running", ""), d.get("Max_used_connections", ""), d.get("Connections", "")]
    except Exception:
        return [""] * 4
def me():
    p = rd("/proc/self/stat").rsplit(")", 1)[-1].split()
    return (int(p[11]) + int(p[12])) / HZ
prev = None; n = 0; nxt = time.time()
while True:
    if DEADLINE and time.time() - T0 > DEADLINE: break
    t = time.time()
    mi = meminfo(); vm = vmstat(); st = stat(); pc = psi("cpu"); pm = psi("memory"); pi = psi("io"); cl = classify()
    cls_delta = {}
    seen = set()
    for k, v in cl.items():
        d_ = 0
        for pid_, _r in v:
            t_ = ticks(pid_)
            if t_ is None: continue
            seen.add(pid_)
            d_ += t_ - PT.get(pid_, 0) if (pid_ in PT or prev) else 0
            PT[pid_] = t_
        cls_delta[k] = d_
    for pid_ in list(PT):
        if pid_ not in seen and pid_ not in (os.getpid(),): PT.pop(pid_, None)
    fs = fcgi_status()
    my = mysql_status() if n % 3 == 0 else [""] * 4
    ts = mi.get("MemTotal", 0); av = mi.get("MemAvailable", 0); fr = mi.get("MemFree", 0)
    cache = mi.get("Buffers", 0) + mi.get("Cached", 0) + mi.get("SReclaimable", 0)
    used = ts - fr - cache; swap = mi.get("SwapTotal", 0) - mi.get("SwapFree", 0)
    la = rd("/proc/loadavg").split()
    sums = {}
    for k, v in cl.items():
        sums[k] = (len(v), sum(r for _, r in v), sum(pss(p) for p, _ in v), max([r for _, r in v] or [0]))
    cur = (t, st, vm.get("pswpin", 0), vm.get("pswpout", 0), vm.get("pgmajfault", 0), vm.get("oom_kill", 0), pc.get("some", (0, 0))[1], pm.get("some", (0, 0))[1], pi.get("some", (0, 0))[1], me())
    if prev:
        dt = [a - b for a, b in zip(cur[1], prev[1])]; tot = sum(dt) or 1
        idle = dt[3]; iow = dt[4]
        busy = 100.0 * (tot - idle - iow) / tot
        us = 100.0 * (dt[0] + dt[1]) / tot; sy = 100.0 * (dt[2] + dt[5] + dt[6]) / tot; io = 100.0 * iow / tot; sl = 100.0 * dt[7] / tot
        d = [cur[2] - prev[2], cur[3] - prev[3], cur[4] - prev[4], cur[5] - prev[5]]
        pd = [cur[6] - prev[6], cur[7] - prev[7], cur[8] - prev[8]]
        selfc = 100.0 * (cur[9] - prev[9]) / max(cur[0] - prev[0], 0.001)
    else:
        busy = us = sy = io = sl = 0.0; d = [0, 0, 0, 0]; pd = [0, 0, 0]; selfc = 0.0
    row = [int(t), ts // 1024, used // 1024, av // 1024, fr // 1024, cache // 1024, swap // 1024, d[0], d[1], d[2], d[3], la[0], la[1],
           "%.1f" % busy, "%.1f" % us, "%.1f" % sy, "%.1f" % io, "%.1f" % sl,
           pc.get("some", (0, 0))[0], pm.get("some", (0, 0))[0], pm.get("full", (0, 0))[0], pi.get("some", (0, 0))[0], pi.get("full", (0, 0))[0], pd[0], pd[1], pd[2],
           sums["fpm"][0], sums["fpm"][1], sums["fpm"][2], sums["fpm"][3], sums["mysql"][1], sums["mysql"][2], sums["caddy"][1], sums["caddy"][2]] + fs + my
    row += ["%.1f" % selfc, "%d" % int((time.time() - t) * 1000)]
    if prev:
        cap = HZ * max(cur[0] - prev[0], 0.001) * NCPU
        cf, cm, cc = [100.0 * max(cls_delta.get(k, 0), 0) / cap for k in ("fpm", "mysql", "caddy")]
        cs = max(selfc, 0.0) / NCPU
        co = max(busy - cf - cm - cc - cs, 0.0)
        row += ["%.1f" % cf, "%.1f" % cm, "%.1f" % cc, "%.1f" % cs, "%.1f" % co]
    else:
        row += ["0.0"] * 5
    sys.stdout.write(",".join(str(x) for x in row) + "\n"); sys.stdout.flush()
    prev = cur
    n += 1; nxt += IV
    sl_ = nxt - time.time()
    if sl_ > 0: time.sleep(sl_)
    else: nxt = time.time()
`;

const csvLine = (a) => a.join(",");
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

function writePhase(file, label) { fs.writeFileSync(file, String(label).replace(/[\r\n,]/g, " ").trim() + "\n"); }
function readPhase(file, fallback) { try { return fs.readFileSync(file, "utf8").trim() || fallback; } catch { return fallback; } }

/** Programmatic API for runners: start/stop a sampler in the background of the current process. */
export function startSampler({ out, phaseFile, interval = 2, duration = 0, phase = "unlabelled" } = {}) {
  const args = [fileURLToPath(import.meta.url), "run", "--out", out, "--interval", String(interval)];
  if (phaseFile) args.push("--phase-file", phaseFile);
  if (duration) args.push("--duration", String(duration));
  if (phase) args.push("--phase", phase);
  const child = spawn(process.execPath, args, { stdio: ["ignore", "inherit", "inherit"] });
  return { child, stop: () => new Promise((res) => { child.once("exit", res); child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 8000).unref(); }) };
}
export const setPhase = (file, label) => { if (file) writePhase(file, label); };

async function run() {
  const out = opt("out"); if (!out) { console.error("--out FILE.csv is required"); process.exit(2); }
  const phaseFile = opt("phase-file", out + ".phase");
  const interval = Number(opt("interval", "2")); const duration = Number(opt("duration", "0"));
  if (!fs.existsSync(STAGE_SSH)) { console.error(`stage-ssh not found at ${STAGE_SSH}`); process.exit(2); }
  if (opt("phase")) writePhase(phaseFile, opt("phase")); else if (!fs.existsSync(phaseFile)) writePhase(phaseFile, "unlabelled");
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const exists = fs.existsSync(out) && fs.statSync(out).size > 0;
  const fd = fs.openSync(out, "a");
  if (!exists) fs.writeSync(fd, csvLine(["iso", "phase", ...COLUMNS]) + "\n");
  const b64 = Buffer.from(REMOTE_PY).toString("base64");
  // the python source travels as base64 inside ONE argument; `sudo -n` only so /proc/<pid>/smaps_rollup of other users, the pool socket and the MySQL socket are readable
  const remote = `sudo -n python3 -u -c "$(echo ${b64} | base64 -d)" ${interval} ${duration || 0}`;
  let stopping = false, child = null, rows = 0, reconnects = 0, lastRow = Date.now();
  const stop = () => { stopping = true; try { child?.kill("SIGTERM"); } catch { /* gone */ } };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const t0 = Date.now();
  const connect = () => new Promise((resolve) => {
    child = spawn(STAGE_SSH, ["-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3", remote], { stdio: ["ignore", "pipe", "pipe"] });
    let buf = ""; let err = "";
    child.stdout.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line || !/^\d+,/.test(line)) continue;
        fs.writeSync(fd, `${new Date().toISOString()},${readPhase(phaseFile, "unlabelled")},${line}\n`);
        rows++; lastRow = Date.now();
      }
    });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => resolve({ code, err }));
  });
  console.log(`stage-sampler: ${out} (interval ${interval}s${duration ? `, ${duration}s` : ""}, phase file ${phaseFile})`);
  for (;;) {
    const r = await connect();
    if (stopping || (duration && (Date.now() - t0) / 1000 >= duration - 1)) break;
    reconnects++;
    fs.writeSync(fd, `# reconnect ${new Date().toISOString()} exit=${r.code} ${r.err.replace(/\s+/g, " ").slice(0, 160)}\n`);
    console.error(`stage-sampler: ssh ended (exit ${r.code}); reconnecting in 3 s`);
    if (reconnects > 20) { console.error("stage-sampler: too many reconnects, giving up"); break; }
    await new Promise((res) => setTimeout(res, 3000));
  }
  fs.closeSync(fd);
  console.log(`stage-sampler: stopped after ${rows} rows, ${reconnects} reconnect(s)`);
}

/* ------------------------------------------------------------------ snapshot */
function sshOut(script, timeout = 40000) {
  const r = spawnSync(STAGE_SSH, [script], { encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}
export function snapshot(label = "") {
  const r = sshOut(`sudo bash -c '
echo "##fpmlog"; grep -n "max_children" /var/log/php8.3-fpm.log 2>/dev/null
echo "##fpmlogtail"; tail -n 15 /var/log/php8.3-fpm.log 2>/dev/null
echo "##slowcount"; grep -c "^\\[.*pool aicc" /var/log/aicc-cp/php-slow.log 2>/dev/null; wc -c < /var/log/aicc-cp/php-slow.log 2>/dev/null
echo "##mysql"; mysql -N -e "SHOW GLOBAL STATUS WHERE Variable_name IN (\\"Max_used_connections\\",\\"Connections\\",\\"Threads_connected\\",\\"Aborted_connects\\",\\"Slow_queries\\",\\"Questions\\"); SHOW VARIABLES LIKE \\"max_connections\\""
echo "##oom"; dmesg 2>/dev/null | grep -c -i "out of memory\\|oom-kill\\|killed process"; grep -c oom_kill /proc/vmstat; awk "/^oom_kill /{print \\$2}" /proc/vmstat
echo "##f2b"; for j in aicc-wp-login caddy-4xx-flood sshd; do echo "jail $j"; fail2ban-client status $j 2>&1 | grep -E "Currently failed|Total failed|Currently banned|Total banned|Banned IP list"; done
echo "##f2blog"; grep -E "Ban |Unban |Found" /var/log/fail2ban.log 2>/dev/null | tail -n 12
echo "##uptime"; uptime; free -m | sed -n 1,3p
'`);
  const sec = {}; let cur = "";
  for (const l of r.out.split("\n")) { if (l.startsWith("##")) { cur = l.slice(2); sec[cur] = []; } else if (cur) sec[cur].push(l); }
  const mysql = Object.fromEntries((sec.mysql || []).map((l) => l.split("\t")).filter((p) => p.length === 2));
  const reached = (sec.fpmlog || []).filter((l) => /server reached pm\.max_children/.test(l));
  return { label, taken: new Date().toISOString(), ok: r.code === 0, fpmMaxChildrenLogLines: reached.length, fpmMaxChildrenLog: reached.slice(-30), fpmLogTail: sec.fpmlogtail || [], slowlogEntries: Number((sec.slowcount || [])[0]) || 0, slowlogBytes: Number((sec.slowcount || [])[1]) || 0, mysql, oom: sec.oom || [], fail2ban: sec.f2b || [], fail2banLogTail: sec.f2blog || [], uptime: sec.uptime || [] };
}

/* ------------------------------------------------------------------ summarize */
const num = (x) => (x === "" || x === undefined || Number.isNaN(Number(x)) ? null : Number(x));
const pct = (a, p) => { const s = a.filter((x) => x !== null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const mx = (a) => { const s = a.filter((x) => x !== null); return s.length ? Math.max(...s) : null; };
const mn = (a) => { const s = a.filter((x) => x !== null); return s.length ? Math.min(...s) : null; };
const avg = (a) => { const s = a.filter((x) => x !== null); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
const sum = (a) => a.filter((x) => x !== null).reduce((x, y) => x + y, 0);
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

export function parseCsv(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const head = lines[0].split(",");
  const rows = []; const gaps = [];
  for (const l of lines.slice(1)) {
    if (l.startsWith("#")) { gaps.push(l); continue; }
    const p = l.split(","); const o = {};
    head.forEach((h, i) => { o[h] = i < 2 ? p[i] : num(p[i]); });
    o.phase = p[1];
    rows.push(o);
  }
  return { rows, gaps };
}

export function summarizeRows(rows) {
  const phases = [];
  for (const r of rows) { if (!phases.includes(r.phase)) phases.push(r.phase); }
  const out = [];
  for (const ph of phases) {
    const R = rows.filter((r) => r.phase === ph); const c = (k) => R.map((r) => r[k]);
    const t0 = Date.parse(R[0].iso), t1 = Date.parse(R[R.length - 1].iso);
    const first = (k) => { const v = c(k).filter((x) => x !== null); return v.length ? v[0] : null; };
    const last = (k) => { const v = c(k).filter((x) => x !== null); return v.length ? v[v.length - 1] : null; };
    out.push({
      phase: ph, samples: R.length, seconds: Math.round((t1 - t0) / 1000), from: R[0].iso, to: R[R.length - 1].iso,
      ram_used_mb: { mean: r1(avg(c("mem_used_mb"))), p95: r1(pct(c("mem_used_mb"), 0.95)), peak: mx(c("mem_used_mb")) },
      ram_available_mb: { min: mn(c("mem_avail_mb")), p5: r1(pct(c("mem_avail_mb"), 0.05)), mean: r1(avg(c("mem_avail_mb"))) },
      swap_used_mb: { max: mx(c("swap_used_mb")), first: first("swap_used_mb"), last: last("swap_used_mb") },
      swap_pages: { in: sum(c("pswpin_d")), out: sum(c("pswpout_d")), majfault: sum(c("pgmajfault_d")) },
      oom_kills: sum(c("oom_kill_d")),
      cpu_busy_pct: { mean: r1(avg(c("cpu_busy_pct"))), p95: r1(pct(c("cpu_busy_pct"), 0.95)), peak: mx(c("cpu_busy_pct")) },
      cpu_iowait_pct_max: mx(c("cpu_iowait_pct")), cpu_steal_pct_max: mx(c("cpu_steal_pct")), cpu_steal_pct: { mean: r1(avg(c("cpu_steal_pct"))), p95: r1(pct(c("cpu_steal_pct"), 0.95)), max: mx(c("cpu_steal_pct")) },
      cpu_by_class_pct: { php_fpm: { mean: r1(avg(c("cpu_fpm_pct"))), peak: mx(c("cpu_fpm_pct")) }, mysqld: { mean: r1(avg(c("cpu_mysql_pct"))), peak: mx(c("cpu_mysql_pct")) }, caddy: { mean: r1(avg(c("cpu_caddy_pct"))), peak: mx(c("cpu_caddy_pct")) }, sampler: { mean: r1(avg(c("cpu_sampler_pct"))) }, other: { mean: r1(avg(c("cpu_other_pct"))), peak: mx(c("cpu_other_pct")) } },
      load1: { mean: r1(avg(c("load1"))), peak: mx(c("load1")) },
      psi: { cpu_some10_max: mx(c("psi_cpu_some10")), mem_some10_max: mx(c("psi_mem_some10")), mem_full10_max: mx(c("psi_mem_full10")), io_some10_max: mx(c("psi_io_some10")), io_full10_max: mx(c("psi_io_full10")), mem_stall_ms: r1(sum(c("psi_mem_some_us_d")) / 1000), cpu_stall_ms: r1(sum(c("psi_cpu_some_us_d")) / 1000), io_stall_ms: r1(sum(c("psi_io_some_us_d")) / 1000) },
      php_workers: { max: mx(c("fpm_procs")), mean: r1(avg(c("fpm_procs"))), max_active: mx(c("fpm_active")), pool_max_active: mx(c("fpm_max_active")), listen_queue_max: mx(c("fpm_listen_queue")), pool_max_listen_queue: mx(c("fpm_max_listen_queue")), max_children_reached_start: first("fpm_max_children_reached"), max_children_reached_end: last("fpm_max_children_reached"), slow_requests_delta: last("fpm_slow_requests") !== null && first("fpm_slow_requests") !== null ? last("fpm_slow_requests") - first("fpm_slow_requests") : null, requests_delta: last("fpm_accepted_conn") !== null && first("fpm_accepted_conn") !== null ? last("fpm_accepted_conn") - first("fpm_accepted_conn") : null },
      php_rss_mb: { max_total: r1(mx(c("fpm_rss_kb")) / 1024), max_worker: r1(mx(c("fpm_max_rss_kb")) / 1024) },
      php_pss_mb: { max_total: r1(mx(c("fpm_pss_kb")) / 1024) },
      mysqld_rss_mb: { max: r1(mx(c("mysql_rss_kb")) / 1024) }, mysqld_pss_mb: { max: r1(mx(c("mysql_pss_kb")) / 1024) },
      caddy_rss_mb: { max: r1(mx(c("caddy_rss_kb")) / 1024) }, caddy_pss_mb: { max: r1(mx(c("caddy_pss_kb")) / 1024) },
      mysql_threads: { connected_max: mx(c("mysql_threads_connected")), running_max: mx(c("mysql_threads_running")), max_used_connections_seen: mx(c("mysql_max_used")), new_connections: last("mysql_connections") !== null && first("mysql_connections") !== null ? last("mysql_connections") - first("mysql_connections") : null },
      sampler_overhead: { self_cpu_pct_mean: r1(avg(c("self_cpu_pct"))), sample_ms_mean: r1(avg(c("sample_ms"))), sample_ms_max: mx(c("sample_ms")) },
    });
  }
  const all = rows;
  const overall = { samples: all.length, ram_used_mb_peak: mx(all.map((r) => r.mem_used_mb)), ram_used_mb_p95: r1(pct(all.map((r) => r.mem_used_mb), 0.95)), ram_available_mb_min: mn(all.map((r) => r.mem_avail_mb)), swap_used_mb_max: mx(all.map((r) => r.swap_used_mb)), swap_pages_in: sum(all.map((r) => r.pswpin_d)), swap_pages_out: sum(all.map((r) => r.pswpout_d)), cpu_busy_pct_peak: mx(all.map((r) => r.cpu_busy_pct)), load1_peak: mx(all.map((r) => r.load1)), php_workers_peak: mx(all.map((r) => r.fpm_procs)), php_pool_max_active: mx(all.map((r) => r.fpm_max_active)), php_max_children_reached_end: (() => { const v = all.map((r) => r.fpm_max_children_reached).filter((x) => x !== null); return v.length ? v[v.length - 1] : null; })(), mysql_threads_connected_peak: mx(all.map((r) => r.mysql_threads_connected)), mysql_max_used_peak: mx(all.map((r) => r.mysql_max_used)), oom_kills: sum(all.map((r) => r.oom_kill_d)) };
  return { phases: out, overall };
}

function mdTable(ph) {
  const f = (x, u = "") => (x === null || x === undefined ? "-" : `${x}${u}`);
  const head = ["phase", "n", "s", "RAM used mean/p95/peak MB", "RAM avail min MB", "swap MB max", "swap in/out pages", "CPU busy mean/p95/peak %", "load1 peak", "PHP workers max (pool max active)", "PHP RSS/PSS MB (all workers)", "mysqld RSS MB", "caddy RSS MB", "MySQL threads conn/run max", "PSI cpu/mem/io some10 max", "CPU steal mean/p95/max %", "CPU share mean % fpm/mysqld/caddy/other"];
  const rows = ph.map((p) => [p.phase, p.samples, p.seconds, `${f(p.ram_used_mb.mean)}/${f(p.ram_used_mb.p95)}/${f(p.ram_used_mb.peak)}`, f(p.ram_available_mb.min), f(p.swap_used_mb.max), `${p.swap_pages.in}/${p.swap_pages.out}`, `${f(p.cpu_busy_pct.mean)}/${f(p.cpu_busy_pct.p95)}/${f(p.cpu_busy_pct.peak)}`, f(p.load1.peak), `${f(p.php_workers.max)} (${f(p.php_workers.pool_max_active)})`, `${f(p.php_rss_mb.max_total)}/${f(p.php_pss_mb.max_total)}`, f(p.mysqld_rss_mb.max), f(p.caddy_rss_mb.max), `${f(p.mysql_threads.connected_max)}/${f(p.mysql_threads.running_max)}`, `${f(p.psi.cpu_some10_max)}/${f(p.psi.mem_some10_max)}/${f(p.psi.io_some10_max)}`, `${f(p.cpu_steal_pct.mean)}/${f(p.cpu_steal_pct.p95)}/${f(p.cpu_steal_pct.max)}`, `${f(p.cpu_by_class_pct.php_fpm.mean)}/${f(p.cpu_by_class_pct.mysqld.mean)}/${f(p.cpu_by_class_pct.caddy.mean)}/${f(p.cpu_by_class_pct.other.mean)}`]);
  return ["| " + head.join(" | ") + " |", "|" + head.map(() => "---").join("|") + "|", ...rows.map((r) => "| " + r.join(" | ") + " |")].join("\n");
}

function summarize() {
  const csv = opt("csv"); if (!csv) { console.error("--csv FILE is required"); process.exit(2); }
  const outDir = opt("out-dir", path.dirname(path.resolve(csv)));
  const name = opt("name", path.basename(csv).replace(/\.csv$/, ""));
  const { rows, gaps } = parseCsv(csv);
  if (!rows.length) { console.error("no sample rows"); process.exit(1); }
  const s = summarizeRows(rows);
  const load = opt("load-json") ? Object.fromEntries(opt("load-json").split(",").filter((f) => fs.existsSync(f)).map((f) => [path.basename(f, ".json"), JSON.parse(fs.readFileSync(f, "utf8"))])) : null;
  const before = opt("before") ? JSON.parse(fs.readFileSync(opt("before"), "utf8")) : null, after = opt("after") ? JSON.parse(fs.readFileSync(opt("after"), "utf8")) : null;
  const diff = before && after ? { fpmMaxChildrenLogLines: { before: before.fpmMaxChildrenLogLines, after: after.fpmMaxChildrenLogLines, newLines: after.fpmMaxChildrenLog.filter((l) => !before.fpmMaxChildrenLog.includes(l)) }, slowlogEntries: { before: before.slowlogEntries, after: after.slowlogEntries }, mysql: { before: before.mysql, after: after.mysql }, oom: { before: before.oom, after: after.oom }, fail2ban: { before: before.fail2ban, after: after.fail2ban }, fail2banLogNew: after.fail2banLogTail.filter((l) => !before.fail2banLogTail.includes(l)) } : null;
  const result = { csv: path.resolve(csv), generated: new Date().toISOString(), reconnectGaps: gaps, ...s, load, hostLogDiff: diff };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${name}.summary.json`), JSON.stringify(result, null, 2) + "\n");
  const md = [`# Resource sampling summary: ${name}`, "", `Source: ${path.resolve(csv)} (${s.overall.samples} samples, sampled every ~2 s from the host over one persistent SSH session; RSS = resident set (shared pages counted per process), PSS = proportional share; "RAM used" = total - free - buffers - page cache - reclaimable slab; "RAM avail" = MemAvailable).`, "", "Measurements only, no capacity verdict.", "", "## Overall", "", "```json", JSON.stringify(s.overall, null, 2), "```", "", "## Per phase", "", mdTable(s.phases), ""];
  if (gaps.length) md.push("Reconnect gaps in the sampler session:", ...gaps.map((g) => `- ${g}`), "");
  if (load && Object.keys(load).length) md.push("## Controlled HTTP load phases", "", ...Object.entries(load).flatMap(([n, l]) => [`### ${n}`, "", "```json", JSON.stringify({ config: l.config, aborted: l.aborted || null, wall_s: l.wall_s, byClass: l.summary.byClass, overall: l.summary.overall }, null, 2), "```", ""]));
  if (diff) md.push("## Host log / counter diff (before vs after)", "", "```json", JSON.stringify(diff, null, 2), "```", "");
  fs.writeFileSync(path.join(outDir, `${name}.summary.md`), md.join("\n"));
  console.log(`wrote ${path.join(outDir, name + ".summary.json")} and .md`);
  console.log(mdTable(s.phases));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (cmd === "run") await run();
  else if (cmd === "phase") { writePhase(opt("phase-file", ""), argv[1]); if (!opt("phase-file")) { console.error("--phase-file F is required"); process.exit(2); } }
  else if (cmd === "snapshot") { const s = snapshot(opt("label", "")); fs.writeFileSync(opt("out", "snapshot.json"), JSON.stringify(s, null, 2) + "\n"); console.log(JSON.stringify({ ok: s.ok, fpmMaxChildrenLogLines: s.fpmMaxChildrenLogLines, slowlogEntries: s.slowlogEntries, mysql: s.mysql }, null, 1)); }
  else if (cmd === "summarize") summarize();
  else { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 36).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(cmd ? 2 : 0); }
}
void HERE;
