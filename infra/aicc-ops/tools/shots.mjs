// Browser proof for AICC Ops (operator UI). Usage: node infra/aicc-ops/tools/shots.mjs <base-url> <out-dir>
// Takes screenshots at 1280 and 390 px and asserts: no horizontal overflow at 390, no console errors, no request
// leaves 127.0.0.1 (no CDN / fonts), no <script> element, CSP header present.
import fs from "node:fs";
import path from "node:path";
import { launch } from "../../../scripts/lib/browser.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:19190";
const OUT = process.argv[3] || "shots";
fs.mkdirSync(OUT, { recursive: true });
const PAGES = [
  ["overview", "/", [1280, 390]],
  ["history-host-24h", "/history?group=host&range=24h", [1280, 390]],
  ["history-host-7d", "/history?group=host&range=7d", [1280]],
  ["history-host-30d", "/history?group=host&range=30d", [1280]],
  ["history-caddy-24h", "/history?group=caddy&range=24h", [1280]],
  ["capacity", "/capacity", [1280, 390]],
  ["alerts", "/alerts", [1280]],
  ["config", "/config", [1280]],
];
const browser = await launch();
const report = { base: BASE, pages: [], external_requests: [], console_errors: [] };
for (const [name, route, widths] of PAGES) {
  for (const w of widths) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 } });
    const page = await ctx.newPage();
    page.on("request", (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith("data:")) report.external_requests.push(r.url()); });
    page.on("console", (m) => { if (m.type() === "error") report.console_errors.push(`${name}@${w}: ${m.text()}`); });
    const resp = await page.goto(BASE + route, { waitUntil: "load" });
    const csp = resp.headers()["content-security-policy"] || "";
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const scripts = await page.evaluate(() => document.querySelectorAll("script").length);
    const file = path.join(OUT, `${name}-${w}.png`);
    await page.screenshot({ path: file, fullPage: true });
    report.pages.push({ name, width: w, status: resp.status(), csp_has_script_none: csp.includes("script-src 'none'"), horizontal_overflow_px: overflow, script_elements: scripts, file });
    await ctx.close();
  }
}
await browser.close();
report.ok = report.external_requests.length === 0 && report.console_errors.length === 0 &&
  report.pages.every((p) => p.status === 200 && p.script_elements === 0 && p.csp_has_script_none && p.horizontal_overflow_px <= 0);
fs.writeFileSync(path.join(OUT, "browser-proof.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, pages: report.pages.length, external: report.external_requests.length, console_errors: report.console_errors.length }));
process.exit(report.ok ? 0 : 1);
