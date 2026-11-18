// npm run test:pricing-consistency-mutations (P39): proves scripts/test-pricing-consistency.mjs FAILS on each regression it exists to catch. Each mutation edits a COPY of the self-service export and the suite must then exit non-zero
// with the expected failure text; the untouched export must pass.
//   node scripts/test-pricing-consistency-mutations.mjs --dir <self-service export> --base <S0 export> [--port <n>]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? path.resolve(args[i + 1]) : undefined; };
const DIR = arg("dir"), BASE = arg("base");
const PORT = (() => { const i = args.indexOf("--port"); return i >= 0 ? Number(args[i + 1]) : 9950; })();
if (!DIR || !BASE) { console.error("usage: --dir <self-service export> --base <S0 export> [--port <n>]"); process.exit(2); }
let failed = 0, total = 0;
const check = (c, m) => { total++; if (!c) { failed++; console.error("  FAIL " + m); } else console.log("  ok   " + m); };
const edit = (dir, rel, fn) => { const f = path.join(dir, rel); const t = fs.readFileSync(f, "utf8"); const n = fn(t); if (n === t) throw new Error(`mutation did not change ${rel}`); fs.writeFileSync(f, n); };
const run = (dir) => spawnSync(process.execPath, ["scripts/test-pricing-consistency.mjs", "--dir", dir, "--base", BASE, "--port", String(PORT)], { encoding: "utf8", maxBuffer: 1 << 28 });
const M = [
  ["a card states the wrong registration date (Dec 30)", "two labelled lines|exact UTC", (d) => edit(d, "pricing/index.html", (t) => t.replace("Dec 24, 2026 at 00:00 UTC", "Dec 30, 2026 at 00:00 UTC"))],
  ["the trial end is moved to 23:00 UTC (Hebrew Pricing)", "two labelled lines|exact UTC", (d) => edit(d, "he/pricing/index.html", (t) => t.replace(/22:00 UTC/g, "23:00 UTC"))],
  ["a price changes everywhere on the Spanish Pricing page (199 -> 299)", "US\\$199|price", (d) => edit(d, "es/pricing/index.html", (t) => t.split("US$199").join("US$299"))],
  ["only the first price of the Spanish Pricing page changes (the meta description)", "meta description|price", (d) => edit(d, "es/pricing/index.html", (t) => t.replace("US$199", "US$299"))],
  ["the paid capacity changes (up to 3 -> up to 5)", "Paid plan: up to 3", (d) => edit(d, "pricing/index.html", (t) => t.replace("Paid plan: up to 3 stores", "Paid plan: up to 5 stores"))],
  ["'Approved stores only' returns", "stale phrase", (d) => edit(d, "pricing/index.html", (t) => t.replace("</main>", "<p>Approved stores only</p></main>"))],
  ["'Requests close 24 hours before the offer ends' returns", "stale phrase", (d) => edit(d, "ru/pricing/index.html", (t) => t.replace("</main>", "<p>Requests close 24 hours before the offer ends.</p></main>"))],
  ["'Israel time' appears on Home", "stale phrase", (d) => edit(d, "index.html", (t) => t.replace("</main>", "<p>Ends at 22:00 Israel time</p></main>"))],
  ["'was $99' appears on Product", "stale phrase", (d) => edit(d, "product/index.html", (t) => t.replace("</main>", "<p>was $99</p></main>"))],
  ["a loose end date appears in a paragraph of the Questions page", "outside the labelled date lines", (d) => edit(d, "questions/index.html", (t) => t.replace("</main>", "<p>The trial ends December 31, 2026.</p></main>"))],
  ["a loose clock time appears on the Spanish Home", "outside the labelled date lines", (d) => edit(d, "es/index.html", (t) => t.replace("</main>", "<p>A las 22:00</p></main>"))],
  ["a January date appears (the inactive Jan-10 extension)", "stale phrase|outside the labelled", (d) => edit(d, "he/product/index.html", (t) => t.replace("</main>", "<p>Extended to January 10, 2027</p></main>"))],
  ["the registration row is deleted from the Home closing band", "date blocks|labelled lines", (d) => edit(d, "index.html", (t) => { const i = t.indexOf('aria-labelledby="final-title"'); const j = t.indexOf("</section>", i); return t.slice(0, i) + t.slice(i, j).replace(/<div data-ss-date="registration">[\s\S]*?<\/div>/, "") + t.slice(j); })],
  ["the status text of a card is replaced by a link", "status", (d) => edit(d, "pricing/index.html", (t) => t.replace(/<p class="aicc-sstate"[^>]*>[\s\S]*?<\/p>/, '<a class="aicc-btn" href="https://www.copilt.org/start/?plan=solo">Start free trial</a>'))],
  ["a link to /request-access/ appears", "request-access", (d) => edit(d, "pricing/index.html", (t) => t.replace("</main>", '<a href="/request-access/">x</a></main>'))],
  ["the structured data gains an Offer with a price", "Offer / price", (d) => edit(d, "pricing/index.html", (t) => t.replace(/(<script type="application\/ld\+json">)/, '$1{"@type":"Offer","price":"99"}</script><script type="application/ld+json">'))],
  ["the sitemap lists /start/", "sitemap", (d) => edit(d, "sitemap.xml", (t) => t.replace("</urlset>", "<url><loc>https://www.copilt.org/start/</loc></url></urlset>"))],
  ["a legal page changes (Terms, English)", "equals the S0 export", (d) => edit(d, "terms/index.html", (t) => t.replace(/(<main[\s\S]*?<p>)/, "$1CHANGED "))],
];
for (const [name, expect, mut] of M) {
  const copy = fs.mkdtempSync(path.join(path.dirname(DIR), "mutpc-"));
  fs.rmSync(copy, { recursive: true });
  spawnSync("cp", ["-Rc", DIR, copy]);
  try {
    mut(copy);
    const r = run(copy), out = r.stdout + r.stderr, fl = out.split("\n").filter((l) => /FAIL/.test(l)).join("\n");
    check(r.status !== 0, `mutation "${name}": the suite FAILS (exit ${r.status})`);
    check(new RegExp(expect, "i").test(fl), `mutation "${name}": the failure names the broken guard (${expect})`);
  } finally { fs.rmSync(copy, { recursive: true, force: true }); }
}
const ok = run(DIR);
check(ok.status === 0, "the untouched export passes the same suite (so the failures above are caused by the mutations)");
console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed ? 1 : 0);
