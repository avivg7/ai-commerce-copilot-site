#!/usr/bin/env node
// stage-load.mjs: a MODEST, controlled HTTP load against the real staging host through the fail-closed target guard (curl only, GET only), for the capacity measurements of the 1 vCPU / 2 GiB Droplet.
//
//   node scripts/rehearsal/stage-load.mjs --stage-host stage.copilt.org --stage-ip IP --port 443 --stage-id ID [--duration 180] [--concurrency 4] [--out FILE.json]
//        [--sampler-phase-file F --phase http-load] [--wp-json-per-min 15] [--urls /pricing/,/my-account/,/product/,/]
//        [--sampler-csv FILE]   enables the SAFETY ABORT (checked every second): error rate > 20% (after >= 20 requests), the host's MemAvailable < 300 MB, or swap-in sustained > 200 pages/s
//                               (3 consecutive samples), the last two read from the newest row of the running stage-sampler CSV. The abort is recorded in the output as `aborted` and exits 4.
//
// What it does: CONCURRENCY workers (default 4) each loop over the URL mix for DURATION seconds (default 180), one new curl process (one new TLS connection) per request, back to back.
//   mix per worker cycle: /pricing/ (WordPress), /my-account/ (WordPress), / (static), /product/ (static), /pricing/, /my-account/, / , /product/ ; /wp-json/ is paced separately to
//   --wp-json-per-min (default 15 per minute, because the Control Plane rate-limits REST routes per IP at 30 per minute).
//   It records per request the status, curl's time_total and time_starttransfer, bytes; and reports p50/p95/p99 per URL class, error rate (status 0, 5xx, 429), the status histogram and a per-10-second timeline.
// Nothing else is sent: no cookies, no POST. Each request passes assertRequest() of the guard; the identity of the host is verified first. A guard refusal stops the run (exit 3).
// Pair it with scripts/rehearsal/stage-sampler.mjs (the host-side resource curve) running in another process; this script only writes the phase label to the sampler's phase file.
import fs from "node:fs";
import path from "node:path";
import { TargetGuard, buildConfig, parseGuardArgs, guarded, installDnsGuard, EXIT_REFUSED } from "../lib/target-guard.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const { raw } = parseGuardArgs(args);
const DURATION = Number(opt("duration", "180")), CONC = Number(opt("concurrency", "4")), WPJ = Number(opt("wp-json-per-min", "15"));
const OUT = opt("out", "");
const PHASE_FILE = opt("sampler-phase-file", ""), PHASE = opt("phase", "http-load");
const SAMPLER_CSV = opt("sampler-csv", "");
const MIX = (opt("urls", "") ? opt("urls", "").split(",") : ["/pricing/", "/my-account/", "/", "/product/", "/pricing/", "/my-account/", "/", "/product/"]).filter(Boolean);
if (!(DURATION > 0 && DURATION <= 900) || !(CONC >= 1 && CONC <= 8)) { console.error("duration must be 1..900 s and concurrency 1..8"); process.exit(2); }

const guard = await guarded(async () => { const g = new TargetGuard(buildConfig({ ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) })); installDnsGuard(g); await g.ensureIdentity(); return g; });
const HOST = guard.cfg.stageHost;
const klass = (u) => (u === "/" || u.startsWith("/product") ? "static" : u.startsWith("/wp-json") ? "wp-json" : "wordpress");
const results = [];
let stop = false, lastWpJson = 0, seq = 0;
const t0 = Date.now();
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return Math.round((s[lo] + (s[hi] - s[lo]) * (i - lo)) * 1000) / 1000; };

async function one(u) {
  const start = Date.now();
  try {
    const r = await guard.curlAsync({ url: `https://${HOST}:${guard.cfg.port}${u}`, method: "GET", timeout: 40, bodyFile: "/dev/null", compressed: true, headers: { "Accept-Language": "en-US,en;q=0.9" }, writeOut: "\n@@%{time_total} %{time_starttransfer} %{size_download} %{http_code}" });
    const m = /@@([\d.]+) ([\d.]+) (\d+) (\d+)\s*$/.exec(r.stdout.toString("latin1"));
    results.push({ t: (start - t0) / 1000, u, k: klass(u), status: m ? Number(m[4]) : r.status, total: m ? Number(m[1]) : (Date.now() - start) / 1000, ttfb: m ? Number(m[2]) : null, bytes: m ? Number(m[3]) : 0, err: r.status === 0 ? (r.error || "").slice(0, 80) : "" });
  } catch (e) { if (e && e.name === "GuardRefusal") throw e; results.push({ t: (start - t0) / 1000, u, k: klass(u), status: 0, total: (Date.now() - start) / 1000, ttfb: null, bytes: 0, err: String(e.message).slice(0, 80) }); }
}
async function worker(id) {
  let i = id * 2;
  while (!stop) {
    // /wp-json/ at a fixed low rate across all workers
    if (WPJ > 0 && Date.now() - lastWpJson >= 60000 / WPJ) { lastWpJson = Date.now(); await one("/wp-json/aicc-license/v1/plans"); continue; }
    await one(MIX[i++ % MIX.length]); seq++;
  }
}

if (PHASE_FILE) fs.writeFileSync(PHASE_FILE, PHASE + "\n");
console.log(`stage-load: ${CONC} workers x ${DURATION}s against ${HOST} (mix ${MIX.join(" ")} + /wp-json/ ${WPJ}/min)`);
const timer = setTimeout(() => { stop = true; }, DURATION * 1000);
let aborted = null; const swapHist = [];
const lastRow = () => { try { const t = fs.readFileSync(SAMPLER_CSV, "utf8").trimEnd().split("\n"); const head = t[0].split(","); const rows = t.slice(-1)[0].split(","); return Object.fromEntries(head.map((h, i) => [h, rows[i]])); } catch { return null; } };
const tick = setInterval(() => {
  const sec = Math.round((Date.now() - t0) / 1000);
  const errs = results.filter((r) => r.status === 0 || r.status >= 500 || r.status === 429).length;
  if (sec % 30 === 0) console.log(`  t=${sec}s requests=${results.length} errors=${errs}`);
  if (aborted) return;
  let why = null;
  if (results.length >= 20 && errs / results.length > 0.2) why = `error rate ${(100 * errs / results.length).toFixed(1)}% > 20% after ${results.length} requests`;
  const row = SAMPLER_CSV ? lastRow() : null;
  if (row && Date.now() - Date.parse(row.iso) < 10000) {
    if (Number(row.mem_avail_mb) < 300) why = why || `host MemAvailable ${row.mem_avail_mb} MB < 300 MB`;
    const key = row.epoch; if (swapHist.length === 0 || swapHist[swapHist.length - 1].k !== key) swapHist.push({ k: key, rate: Number(row.pswpin_d) / 2 });
    const last3 = swapHist.slice(-3); if (last3.length === 3 && last3.every((x) => x.rate > 200)) why = why || `swap-in sustained > 200 pages/s (${last3.map((x) => x.rate).join(", ")})`;
  }
  if (why) { aborted = { at_s: sec, reason: why }; stop = true; console.error(`ABORT: ${why}`); }
}, 1000);
try { await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i))); } catch (e) { stop = true; if (e && e.name === "GuardRefusal") { console.error(`GUARD REFUSED [${e.code}]: ${e.message}`); process.exit(EXIT_REFUSED); } throw e; }
clearTimeout(timer); clearInterval(tick);
const wall = (Date.now() - t0) / 1000;

const summarize = (rows) => ({
  requests: rows.length, ok_2xx_3xx: rows.filter((r) => r.status >= 200 && r.status < 400).length,
  errors: rows.filter((r) => r.status === 0 || r.status >= 500 || r.status === 429).length,
  error_rate_pct: rows.length ? Math.round((rows.filter((r) => r.status === 0 || r.status >= 500 || r.status === 429).length / rows.length) * 10000) / 100 : null,
  client_4xx: rows.filter((r) => r.status >= 400 && r.status < 500 && r.status !== 429).length,
  statuses: rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {}),
  total_s: { p50: pct(rows.map((r) => r.total), 0.5), p95: pct(rows.map((r) => r.total), 0.95), p99: pct(rows.map((r) => r.total), 0.99), max: pct(rows.map((r) => r.total), 1) },
  ttfb_s: { p50: pct(rows.filter((r) => r.ttfb !== null).map((r) => r.ttfb), 0.5), p95: pct(rows.filter((r) => r.ttfb !== null).map((r) => r.ttfb), 0.95), p99: pct(rows.filter((r) => r.ttfb !== null).map((r) => r.ttfb), 0.99) },
  rps: Math.round((rows.length / wall) * 10) / 10,
  mb: Math.round(rows.reduce((a, r) => a + r.bytes, 0) / 1048.576) / 1000,
});
const byUrl = {}; for (const u of [...new Set(results.map((r) => r.u))]) byUrl[u] = summarize(results.filter((r) => r.u === u));
const byClass = {}; for (const k of ["static", "wordpress", "wp-json"]) { const rows = results.filter((r) => r.k === k); if (rows.length) byClass[k] = summarize(rows); }
const timeline = []; for (let s = 0; s < Math.ceil(wall / 10); s++) { const rows = results.filter((r) => r.t >= s * 10 && r.t < (s + 1) * 10); const wp = rows.filter((r) => r.k === "wordpress"); timeline.push({ from_s: s * 10, requests: rows.length, wp_p50_s: pct(wp.map((r) => r.total), 0.5), wp_p95_s: pct(wp.map((r) => r.total), 0.95), errors: rows.filter((r) => r.status === 0 || r.status >= 500 || r.status === 429).length }); }
const out = { aborted, stage: { host: HOST, ip: guard.cfg.stageIp }, config: { duration_s: DURATION, concurrency: CONC, mix: MIX, wp_json_per_min: WPJ }, started: new Date(t0).toISOString(), wall_s: Math.round(wall * 10) / 10, summary: { overall: summarize(results), byClass, byUrl }, timeline, errorsSample: results.filter((r) => r.status === 0 || r.status >= 500 || r.status === 429).slice(0, 15), guard: guard.summary() };
if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n"); }
if (PHASE_FILE) fs.writeFileSync(PHASE_FILE, "after-load\n");
console.log(JSON.stringify({ wall_s: out.wall_s, overall: out.summary.overall, byClass: out.summary.byClass }, null, 1));
console.log(`guard: ${out.guard.allowed} requests allowed, ${out.guard.violations} violations`);
process.exit(out.guard.violations ? EXIT_REFUSED : aborted ? 4 : 0);
