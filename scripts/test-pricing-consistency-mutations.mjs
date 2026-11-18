// npm run test:pricing-consistency-mutations (P39, mapped to the P40 markup): proves scripts/test-pricing-consistency.mjs FAILS on each regression it exists to catch. Each mutation edits a COPY of the self-service export and the suite must then exit non-zero
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
  ["the panel states the wrong registration date (Dec 30)", "timeline is|exactly", (d) => edit(d, "pricing/index.html", (t) => t.replace("Dec 24, 2026 at 00:00 UTC", "Dec 30, 2026 at 00:00 UTC"))],
  ["the trial end is moved to 23:00 UTC (Hebrew Pricing)", "timeline is|exactly|outside the launch panel", (d) => edit(d, "he/pricing/index.html", (t) => t.replace(/22:00 UTC/g, "23:00 UTC"))],
  ["a price changes everywhere on the Spanish Pricing page (199 -> 299)", "US\\$199|price", (d) => edit(d, "es/pricing/index.html", (t) => t.split("US$199").join("US$299"))],
  ["only the first price of the Spanish Pricing page changes (the meta description)", "meta description|price", (d) => edit(d, "es/pricing/index.html", (t) => t.replace("US$199", "US$299"))],
  ["the paid capacity changes (up to 3 -> up to 5)", "Paid plan: up to 3", (d) => edit(d, "pricing/index.html", (t) => t.replace("Paid plan: up to 3 stores", "Paid plan: up to 5 stores"))],
  ["the card's trial line changes (1 store -> 2 stores)", "Launch trial: 1 store", (d) => edit(d, "pricing/index.html", (t) => t.replace("Launch trial: 1 store", "Launch trial: 2 stores"))],
  ["FREE is replaced by a different word", "FREE", (d) => edit(d, "pricing/index.html", (t) => t.replace('<span class="aicc-tier__free-word">FREE</span>', '<span class="aicc-tier__free-word">FREE FOREVER</span>'))],
  ["'Approved stores only' returns", "stale phrase", (d) => edit(d, "pricing/index.html", (t) => t.replace("</main>", "<p>Approved stores only</p></main>"))],
  ["'Requests close 24 hours before the offer ends' returns", "stale phrase", (d) => edit(d, "ru/pricing/index.html", (t) => t.replace("</main>", "<p>Requests close 24 hours before the offer ends.</p></main>"))],
  ["'Israel time' appears on Home", "stale phrase", (d) => edit(d, "index.html", (t) => t.replace("</main>", "<p>Ends at 22:00 Israel time</p></main>"))],
  ["'was $99' appears on Product", "stale phrase", (d) => edit(d, "product/index.html", (t) => t.replace("</main>", "<p>was $99</p></main>"))],
  ["a loose end date appears in a paragraph of the Questions page", "outside the launch panel|nowhere", (d) => edit(d, "questions/index.html", (t) => t.replace("</main>", "<p>The trial ends December 31, 2026.</p></main>"))],
  ["a loose clock time appears on the Spanish Home", "outside the launch panel", (d) => edit(d, "es/index.html", (t) => t.replace("</main>", "<p>A las 22:00</p></main>"))],
  ["a January date appears (the inactive Jan-10 extension)", "stale phrase|outside the launch panel", (d) => edit(d, "he/product/index.html", (t) => t.replace("</main>", "<p>Extended to January 10, 2027</p></main>"))],
  ["a date comes back into a card (dates are said once per page)", "no date, no clock|exactly once", (d) => edit(d, "pricing/index.html", (t) => t.replace('<p class="aicc-tier__incl">', '<p class="aicc-tier__trial">Registration closes Dec 24, 2026 at 00:00 UTC</p><p class="aicc-tier__incl">'))],
  ["a trial fact comes back into a card", "none of the three trial facts", (d) => edit(d, "index.html", (t) => t.replace('<p class="aicc-tier__incl">', '<p class="aicc-tier__trial">No payment method is required, so nothing is charged.</p><p class="aicc-tier__incl">'))],
  ["the panel loses the registration step", "timeline is|exactly ONE launch panel", (d) => edit(d, "index.html", (t) => t.replace(/<li class="aicc-timeline__step" data-ss-date="registration">[\s\S]*?<\/li>/, ""))],
  ["a second launch panel appears on the Pricing page", "exactly ONE launch panel|exactly once", (d) => edit(d, "pricing/index.html", (t) => { const m = t.match(/<section class="aicc-launch"[\s\S]*?<\/section>/)[0]; return t.replace(m, m + m.replace('id="free-trial"', 'id="free-trial-2"')); })],
  ["a launch panel appears on the Product page", "no launch panel|appear", (d) => edit(d, "product/index.html", (t) => { const p = fs.readFileSync(path.join(d, "pricing/index.html"), "utf8").match(/<section class="aicc-launch"[\s\S]*?<\/section>/)[0]; return t.replace("</main>", p + "</main>"); })],
  ["the panel's three facts lose the payment line", "three facts", (d) => edit(d, "pricing/index.html", (t) => t.replace(/<li class="aicc-launch__fact">(?:(?!<li class="aicc-launch__fact">)[\s\S])*?No payment method is required, so nothing is charged\.[\s\S]*?<\/li>/, ""))],
  ["the information link of a card is replaced by a sign-up link while registration is not open", "static control", (d) => edit(d, "pricing/index.html", (t) => t.replace(/href="\/get-started\/\?plan=solo"/, 'href="https://www.copilt.org/start/?plan=solo"'))],
  ["the not-open fact is repeated inside a card", "static control", (d) => edit(d, "pricing/index.html", (t) => t.replace(/(<p class="aicc-tier__fit">)/, "$1Free trial registration isn't open yet. "))],
  ["the status line disappears from the pricing section", "status line", (d) => edit(d, "pricing/index.html", (t) => t.replace(/<p class="aicc-pstate"[\s\S]*?<\/p>/, ""))],
  ["the regular price is struck through", "not struck through|struck", (d) => edit(d, "pricing/index.html", (t) => t.replace(/<bdi class="aicc-tier__amount">\$99<\/bdi>/, '<s class="aicc-tier__amount"><bdi>$99</bdi></s>'))],
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
