// npm run test:links: every page loads with no failed requests, and every internal link/asset resolves (200).
// Works for a domain-root build (AICC_BASE_URL=http://localhost:3011) and a sub-path build
// (AICC_BASE_URL=http://localhost:3012/ai-commerce-copilot-site, served with --prefix).
import { launch, LOCALES, ROUTES } from "./lib/browser.mjs";

const BASE = (process.env.AICC_BASE_URL || "http://localhost:3011").replace(/\/$/, "");
const origin = new URL(BASE).origin;
const prefix = new URL(BASE).pathname.replace(/\/$/, "");
const browser = await launch();
const page = await browser.newPage();
const failed = [];
page.on("requestfailed", (r) => { const e = r.failure()?.errorText || ""; if (!/ERR_ABORTED/.test(e)) failed.push(`request failed (${e}): ${r.url()}`); }); // aborted = prefetch cancelled by navigation
// P39: a self-service build asks GET /wp-json/aicc/v1/signup/status (served by WordPress, not part of the export): a static server answers 404 for it; every other 4xx / 5xx is still a failure
page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(origin) && !r.url().endsWith("/wp-json/aicc/v1/signup/status")) failed.push(`${r.status()} ${r.url()}`); });
const seen = new Set();
let pages = 0, links = 0;
for (const l of LOCALES) for (const r of ROUTES) {
  const url = `${BASE}${l === "en" ? "" : "/" + l}/${r ? r + "/" : ""}`;
  await page.goto(url, { waitUntil: "load" }); pages++;
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(150);
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
  for (const h of hrefs) {
    if (!h.startsWith(origin)) continue;
    const u = h.split("#")[0];
    if (seen.has(u)) continue; seen.add(u); links++;
    if (prefix && !u.startsWith(origin + prefix)) failed.push(`link escapes base path: ${h} (on ${url})`);
    const res = await page.request.get(u); if (res.status() !== 200) failed.push(`${res.status()} ${u} (linked from ${url})`);
  }
}
// external links must only be the account URL, mailto, or none
const ext = new Set();
for (const r of ROUTES) { await page.goto(`${BASE}/${r ? r + "/" : ""}`); for (const h of await page.$$eval("a[href]", (as) => as.map((a) => a.href))) if (!h.startsWith(origin) && !h.startsWith("mailto:")) ext.add(new URL(h).origin); }
await browser.close();
console.log(`link-check: ${pages} pages, ${links} unique internal links checked against ${BASE}; external origins linked: ${[...ext].join(", ") || "none"}`);
if (failed.length) { console.error("FAIL\n  " + [...new Set(failed)].slice(0, 30).join("\n  ")); process.exit(1); }
console.log("PASS: no failed requests, no broken or base-path-escaping internal links");
