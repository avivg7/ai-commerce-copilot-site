// npm run content:check [-- --cp <Control Plane theme dir>] [-- --no-rendered]
//
// The content pack gate (brand/content/facts.json + faq.*.json) and the English copy:
//   1. banned-claim scan: facts.json "bannedClaims" + the capability-sheet rules, over every English dictionary string, every FAQ
//      question/answer and (when out/ exists) the rendered English pages
//   2. UK-spelling scan (facts.json "ukSpellings"; the site is US English)
//   3. FAQ integrity: ids, layers, topics, per-page selections, retired map, orphans, link tokens that resolve to real routes
//   4. fact consistency: every price, term, refund, import, attribution, minimum-order and expiring figure matches facts.json
//   5. no license-key contradiction ("never paste", "will never ...")
//   6. no count-as-selling-point ("All 40", "55 questions")
//   7. --cp <dir>: the Control Plane theme carries brand/content byte-identically (the FAQ and facts are one file, not two copies)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadDictionaries, loadTs, ROOT } from "./lib/load.mjs";

const args = process.argv.slice(2);
const cpDir = args.includes("--cp") ? args[args.indexOf("--cp") + 1] : null;
const RENDERED = !args.includes("--no-rendered");

const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const facts = read("brand/content/facts.json");
const faq = read("brand/content/faq.en.json");
const { ROUTES } = await loadTs("src/lib/routes.ts");
const dicts = await loadDictionaries();

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

// ---------------------------------------------------------------- corpus
function flatten(obj, prefix, out) {
  if (typeof obj === "string") out.push([prefix, obj]);
  else if (Array.isArray(obj)) obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  else if (obj && typeof obj === "object") for (const k of Object.keys(obj)) flatten(obj[k], prefix ? `${prefix}.${k}` : k, out);
  return out;
}
const corpus = flatten(dicts.en, "", []);
for (const [id, it] of Object.entries(faq.items)) { corpus.push([`faq.${id}.q`, it.q]); corpus.push([`faq.${id}.a`, it.a]); }
for (const l of faq.layers) corpus.push([`faq.layer.${l.id}`, l.title]);
for (const t of faq.topics) corpus.push([`faq.topic.${t.id}`, t.title]);

// Illustrations carry labelled sample numbers (sample orders, sample revenue): they are exempt from the figure checks, never from the claim scans.
const SAMPLE_KEY = /^(dash|ask|demo|rules|flows)\./;

// ---------------------------------------------------------------- 1. banned claims
const banned = facts.bannedClaims.map((s) => new RegExp(s, "i"));
// Apologetic phrasing ("we don't promise", "we'd rather ...") is banned on public marketing copy and the FAQ. It stays legitimate on the legal pages
// (privacy, terms, refund policy, data and trust, accessibility), where a disclaimer is genuinely required: facts.json "apologeticAllowOnPages".
const APOLOGETIC = banned.filter((re) => /promise|not a guarantee|we'd rather/.test(re.source));
const LEGAL_KEY = /^legal\./;
// Extra UK stems found by review (cancelled/cancelling, honoured, finalised). They apply to EVERY string, the legal pages and the accessibility statement included.
// The only allowed form is WooCommerce's own order status "Cancelled" (capitalised, as the admin shows it).
const EXTRA_UK = ["finalis", "honour", "cancell"];
const ukHit = (w, text) => new RegExp(`\\b${w}`, "i").test(w === "cancell" ? text.replace(/\bCancelled\b/g, " ") : text);
const bannedFor = (where) => (LEGAL_KEY.test(where) || /^out\/(privacy|terms|refund-policy|data-and-trust|accessibility)\//.test(where) ? banned.filter((re) => !APOLOGETIC.includes(re)) : banned);
const SHEET_RULES = [
  [/widget views?/i, "say 'recommendation views'"],
  [/\b10 purchases\b/i, "say '10 orders'"],
  [/\bcart[- ]exclusion\b|excluded from the cart|not (shown|appear)s? (in|on) (the )?cart/i, "no cart-exclusion claim"],
  [/no network (call|request)s? (at|during) checkout/i, "say 'placing an order never waits on AICC'"],
  // "Strong Bundle Opportunity" is a real Merchant Insights card; what does not exist is a Strong/Medium/Light strength tier on a link.
  [/\b(strong|medium|light)[- ](link|tier|pair)s?\b|\blink (strength|tier)s?\b|\b(strong|medium|light)\s*(\/|,|or)\s*(strong|medium|light)\b/i, "no Strong/Medium/Light link tiers (not in the product)"],
  [/\b(revenue|orders?|sales) generated\b|generated (revenue|orders?|sales)/i, "say 'associated', never 'generated'"],
  [/\bsays so\b/i, "fallbacks are not announced to shoppers"],
  [/\bwithin minutes\b|\bin (a few|\d+) minutes\b|\bin seconds\b/i, "no time-to-value duration"],
  [/\bauto-?detect(s|ed)? (a )?staging\b/i, "no staging auto-detection claim"],
  [/\b(upgrade in place|in-place upgrade)\b/i, "a larger plan is a separate purchase"],
  // Found by the independent product-truth review:
  [/Same category — no purchase history yet/, "not a plugin label: a fallback product shows only its price in the Recommendation Preview"],
  [/Hot Product Detected/, "the plugin title is 'Top Performing Product'"],
  [/hand-picked per product/i, "WooCommerce related products are automatic; hand-picking is Upsells and Cross-sells"],
  [/learn from day one|day[- ]one results/i, "no time-to-value claim: say 'start from pairs already learned'"],
  [/Nothing from (your )?past orders is sent until/i, "orders placed or changed after connecting are sent: say the import is what waits for your choice"],
  [/independent of AICC|never depends on (it|AICC)/i, "say 'placing an order never waits on AICC'"],
  [/up to five products\b/i, "a product page shows the viewed product plus up to four recommendations; the cart page up to five"],
  [/\bfail[- ]soft\b/i, "jargon: say 'keeps working if AICC doesn't'"],
];
const scan = (where, text, sample = false) => {
  for (const re of bannedFor(where)) if (re.test(text) && !negated(text, re)) fail(where, `banned claim /${re.source}/ in "${snippet(text, re)}"`);
  for (const [re, why] of SHEET_RULES) {
    if (/jargon/.test(why) && LEGAL_KEY.test(where)) continue; // the legal texts keep their own (mirrored) wording
    // The upgrade sentence is allowed to NEGATE the claim ("not an in-place upgrade").
    if (re.test(text) && !(/in-place upgrade/.test(re.source) && /not an? in-place upgrade|no in-place upgrade|isn't an in-place upgrade/i.test(text))) fail(where, `${why}: "${snippet(text, re)}"`);
  }
  for (const w of [...facts.ukSpellings, ...EXTRA_UK]) { if (ukHit(w, text)) fail(where, `UK spelling "${w}" (the site is US English): "${snippet(text, new RegExp(`\\b${w}`, "i"))}"`); }
  // 5. license-key contradiction
  if (/never paste|will never/i.test(text) && !/^legal\./.test(where)) fail(where, `license-key contradiction wording ("never paste" / "will never"): "${snippet(text, /never paste|will never/i)}"`);
  // 6. count as a selling point
  if (/\ball \d+\b|\b\d+ (questions|answers|faqs)\b/i.test(text)) fail(where, `count used as a selling point: "${snippet(text, /\ball \d+\b|\b\d+ (questions|answers|faqs)\b/i)}"`);
  checkFacts(where, text, sample);
};
// A claim may be named in order to deny it: "No guaranteed results", "we do not promise guaranteed ROI".
const negated = (t, re) => { const m = t.match(re); if (!m) return false; return /\b(no|not|never|without|doesn't|does not|don't|do not)\s+(promise\s+|offer\s+|make\s+|give\s+)?$/i.test(t.slice(Math.max(0, m.index - 24), m.index)); };
const snippet = (t, re) => { const m = t.match(re); const i = m ? m.index : 0; return t.slice(Math.max(0, i - 30), i + 70).replace(/\s+/g, " "); };

// ---------------------------------------------------------------- 4. fact consistency
const PRICES = new Set(facts.plans.map((p) => p.price));
const STORES = new Set(facts.plans.map((p) => p.stores));
// CSV export ranges 7/30/90 days: capability sheet section 4 (Product Data Export).
const EXPORT_RANGE_DAYS = [7, 30, 90];
const DAYS = new Set([facts.moneyBackDays, facts.termDays, facts.dashboardPeriodDays, facts.expiringSoonDays, ...EXPORT_RANGE_DAYS]);
function checkFacts(where, text, sample) {
  if (sample) return;
  for (const m of text.matchAll(/(?:US)?\$\s?(\d[\d,]*)(?!\d)/g)) { const n = +m[1].replace(/,/g, ""); if (!PRICES.has(n)) fail(where, `price $${n} is not a plan price (${[...PRICES].join("/")}): "${snippet(text, m[0])}"`); }
  for (const m of text.matchAll(/(\d[\d,]*)[- ]days?\b/gi)) { const n = +m[1].replace(/,/g, ""); if (!DAYS.has(n)) fail(where, `${n}-day figure matches no fact (${[...DAYS].join("/")}): "${snippet(text, m[0])}"`); }
  for (const m of text.matchAll(/(\d+)[- ]day (money-back|guarantee|refund)/gi)) if (+m[1] !== facts.moneyBackDays) fail(where, `money-back is ${facts.moneyBackDays} days, not ${m[1]}`);
  for (const m of text.matchAll(/(\d+) days (from purchase|of access)|(\d+)-day term/gi)) { const n = +(m[1] || m[3]); if (n !== facts.termDays) fail(where, `term is ${facts.termDays} days, not ${n}`); }
  for (const m of text.matchAll(/(\d+)\s*months?\b/gi)) { const n = +m[1]; if (n !== facts.importMonths && n !== facts.retentionMonthsPolicy) fail(where, `${n} months matches neither import (${facts.importMonths}) nor retention (${facts.retentionMonthsPolicy}): "${snippet(text, m[0])}"`); }
  for (const m of text.matchAll(/up to (\d+) months of (past |previous |earlier )?orders|(\d+) months of (past |previous |earlier )?orders/gi)) { const n = +(m[1] || m[3]); if (n !== facts.importMonths) fail(where, `import window is ${facts.importMonths} months, not ${n}`); }
  for (const m of text.matchAll(/(\d+)[- ]hours?\b/gi)) if (+m[1] !== facts.attributionWindowHours) fail(where, `attribution window is ${facts.attributionWindowHours} hours, not ${m[1]}`);
  for (const m of text.matchAll(/(\d+)\s+(?:completed |processing )?orders?\b/gi)) { const n = +m[1]; if (n !== facts.insightsMinOrders && /at least|minimum|once you have|fewer than/i.test(text.slice(Math.max(0, m.index - 30), m.index))) fail(where, `insights minimum is ${facts.insightsMinOrders} orders, not ${n}`); }
  for (const m of text.matchAll(/up to (\d+) (?:stores|sites)/gi)) if (!STORES.has(+m[1])) fail(where, `up to ${m[1]} stores matches no plan (${[...STORES].join("/")})`);
  for (const m of text.matchAll(/up to (\d+) (products|items)\b/gi)) if (+m[1] !== facts.widgetMaxItems && /widget|bundle|show/i.test(text)) fail(where, `widget shows up to ${facts.widgetMaxItems} products, not ${m[1]}`);
}

for (const [k, v] of corpus) scan(k, v, SAMPLE_KEY.test(k));

// The gate must bite: every known-bad sentence below has to be flagged, every known-good one passed (runs on every invocation).
{
  const bad = [
    "AICC will boost your revenue.", "Increase your conversion with AICC.", "No network call at checkout.", "You will never paste a key.", "Plans from $149 a year.",
    "A 30-day money-back guarantee.", "Import 12 months of past orders.", "Widget views this week.", "Orders after 10 purchases.", "Strong, Medium or Light links.",
    "Our licence terms.", "Browse all 40 questions.", "We can't promise every theme or host.", "We'd rather list these than let you find out later.", "Import starts automatically after connect.", "There is no subscription.", "Learn from day one.", "Hand-picked per product.", "Nothing from past orders is sent until you choose.", "Independent of AICC.", "Revenue generated by AICC.", "Attribution within 48 hours.", "Up to 4 stores.",
  ];
  const good = ["A 14-day money-back guarantee on your first purchase.", "Solo is $99 a year.", "Up to 24 months of past orders.", "Observations appear once you have at least 10 orders.", "Placing an order never waits on AICC.", "Straight answers, grouped by what you are trying to decide."];
  const keep = errors.length;
  for (const t of bad) { const n = errors.length; scan("selftest", t); if (errors.length === n) fail("selftest", `gate missed: "${t}"`); }
  const flagged = errors.length - keep;
  errors.length = keep;
  for (const t of good) { const n = errors.length; scan("selftest", t); if (errors.length !== n) { fail("selftest", `gate wrongly flagged: "${t}"`); } }
  if (flagged < bad.length) fail("selftest", "fewer detections than bad samples");
}

// ---------------------------------------------------------------- 3. FAQ integrity
{
  const ids = Object.keys(faq.items);
  const layerIds = new Set(faq.layers.map((x) => x.id));
  const topicIds = new Set(faq.topics.map((x) => x.id));
  const routes = new Set(Object.keys(ROUTES));
  if (new Set(ids).size !== ids.length) fail("faq", "duplicate ids");
  for (const id of ids) {
    const it = faq.items[id];
    if (!/^q\d{2}$/.test(id)) fail(`faq.${id}`, "id must be qNN");
    if (!layerIds.has(it.layer)) fail(`faq.${id}`, `unknown layer "${it.layer}"`);
    if (!topicIds.has(it.topic)) fail(`faq.${id}`, `unknown topic "${it.topic}"`);
    if (!it.q?.trim() || !it.a?.trim()) fail(`faq.${id}`, "empty question or answer");
    for (const m of (it.q + "\n" + it.a).matchAll(/\]\(route:([a-z-]+)\)/g)) if (!routes.has(m[1])) fail(`faq.${id}`, `link token route:${m[1]} is not a real route`);
    if (/\]\((?!route:|https?:\/\/)/.test(it.a)) fail(`faq.${id}`, "links must be route: tokens or absolute https URLs");
    if (/\[[^\]]+\]\(route:[a-z-]+\)/.test(it.q)) fail(`faq.${id}`, "no links in questions");
  }
  for (const [rid, r] of Object.entries(faq.retired)) {
    if (ids.includes(rid)) fail(`faq.retired.${rid}`, "a retired id must not also be active");
    if (!faq.items[r.mergedInto]) fail(`faq.retired.${rid}`, `mergedInto ${r.mergedInto} is not an active question`);
  }
  const used = new Set();
  for (const [page, sel] of Object.entries(faq.selection)) {
    if (sel === "all") continue;
    if (new Set(sel).size !== sel.length) fail(`faq.selection.${page}`, "duplicate ids");
    for (const id of sel) { used.add(id); if (!faq.items[id]) fail(`faq.selection.${page}`, `${id} ${faq.retired[id] ? "is retired" : "does not exist"}`); }
  }
  if (faq.selection.questions !== "all") fail("faq.selection.questions", 'the Questions page shows every active question: selection must be "all"');
  for (const topic of topicIds) if (!ids.some((id) => faq.items[id].topic === topic)) fail(`faq.topic.${topic}`, "topic has no questions");
  for (const layer of layerIds) if (!ids.some((id) => faq.items[id].layer === layer)) fail(`faq.layer.${layer}`, "layer has no questions");
  // Every question must be reachable: either on the Questions page ("all") or a page selection; "all" covers it, so the orphan check is
  // that no translation or selection references a missing id, and that retired ids are not in any translation file.
  for (const l of ["he", "es", "ru"]) {
    const tr = read(`brand/content/faq.${l}.json`);
    for (const id of Object.keys(tr.items)) { if (!faq.items[id]) fail(`faq.${l}.${id}`, "orphan translation (no such active English question)"); }
    if (!tr.reviewStatus) fail(`faq.${l}`, "reviewStatus is required");
  }
  // Components must not hard-code ids that do not exist.
  for (const f of ["src/components/pages/HomePage.tsx", "src/components/pages/ProductPage.tsx", "src/components/pages/PricingPage.tsx", "src/components/pages/QuestionsPage.tsx", "src/components/ui/FaqHash.tsx"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const m of src.matchAll(/["'`](q\d{2})["'`]/g)) if (!faq.items[m[1]] && !faq.retired[m[1]]) fail(f, `references unknown FAQ id ${m[1]}`);
  }
  // Facts file sanity.
  if (facts.plans.length !== 3 || facts.plans.some((p) => !p.price || !p.stores)) fail("facts", "plans malformed");
  if (!facts.bannedClaims.every((s) => { try { new RegExp(s, "i"); return true; } catch { return false; } })) fail("facts", "an invalid bannedClaims regex");
}

// ---------------------------------------------------------------- keys that must exist
{
  const { LEGAL_REVIEW_KEYS } = await loadTs("src/data/legal.ts");
  const flat = Object.fromEntries(corpus);
  for (const k of LEGAL_REVIEW_KEYS) if (!(k in flat)) fail("legal.ts LEGAL_REVIEW_KEYS", `"${k}" is not a dictionary key (stale list: launch:check would miss that copy)`);
}

// ---------------------------------------------------------------- page titles and descriptions
{
  const price = (t) => t.replace(/\{priceSolo\}/g, "$" + facts.plans[0].price).replace(/\{priceStudio\}/g, "$" + facts.plans[1].price).replace(/\{priceAgency\}/g, "$" + facts.plans[2].price);
  for (const [k, m] of Object.entries(dicts.en.meta.pages)) {
    const title = price(m.title), desc = price(m.description);
    if (title.length > 60) fail(`meta.pages.${k}.title`, `${title.length} characters (max 60): "${title}"`);
    if (desc.length > 155) fail(`meta.pages.${k}.description`, `${desc.length} characters (max 155): "${desc}"`);
  }
}

// ---------------------------------------------------------------- rendered English pages
let rendered = 0;
const outDir = path.join(ROOT, "out");
if (RENDERED && fs.existsSync(outDir)) {
  const EN_PAGES = ["index.html", "product/index.html", "pricing/index.html", "questions/index.html", "data-and-trust/index.html", "privacy/index.html", "terms/index.html", "refund-policy/index.html", "accessibility/index.html"];
  for (const rel of EN_PAGES) {
    const f = path.join(outDir, rel);
    if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, "utf8");
    const body = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
    const text = body.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
    // Rendered text includes the sample illustrations (labelled): figures are checked on the dictionary side, claims here.
    for (const re of bannedFor(`out/${rel}`)) if (re.test(text) && !negated(text, re)) fail(`out/${rel}`, `banned claim /${re.source}/: "${snippet(text, re)}"`);
    for (const [re, why] of SHEET_RULES) if (re.test(text) && !/in-place/.test(re.source) && !(/jargon/.test(why) && /^(privacy|terms|refund-policy|data-and-trust|accessibility)\//.test(rel))) fail(`out/${rel}`, `${why}: "${snippet(text, re)}"`);
    for (const w of [...facts.ukSpellings, ...EXTRA_UK]) { if (ukHit(w, text)) fail(`out/${rel}`, `UK spelling "${w}"`); }
    if (/\ball \d+\b/i.test(text)) fail(`out/${rel}`, "count as a selling point");
    // One H1, sequential headings.
    const hs = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => +m[1]);
    if (hs.filter((h) => h === 1).length !== 1) fail(`out/${rel}`, `expected exactly one h1, found ${hs.filter((h) => h === 1).length}`);
    for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) fail(`out/${rel}`, `heading level jumps h${hs[i - 1]} -> h${hs[i]}`);
    rendered++;
  }
}

// ---------------------------------------------------------------- 7. Control Plane parity
let parity = "not requested (pass --cp <theme dir>)";
if (cpDir) {
  const manifest = read("brand/MANIFEST.json");
  const dest = path.join(path.resolve(cpDir), "assets", "brand");
  let n = 0;
  for (const [rel, meta] of Object.entries(manifest.files)) {
    if (!rel.startsWith("content/")) continue;
    const f = path.join(dest, rel);
    n++;
    if (!fs.existsSync(f)) { fail("cp-parity", `missing ${rel} in ${dest}`); continue; }
    if (crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") !== meta.sha256) fail("cp-parity", `${rel} differs from brand/content (the FAQ and facts must be byte-identical on both surfaces)`);
  }
  if (!n) fail("cp-parity", "brand/MANIFEST.json lists no content/ files");
  parity = `${n} content files compared with ${dest}`;
}

// Manifest coverage of the pack.
{
  const manifest = read("brand/MANIFEST.json");
  for (const rel of fs.readdirSync(path.join(ROOT, "brand/content"))) if (!manifest.files[`content/${rel}`]) fail("manifest", `content/${rel} is not in brand/MANIFEST.json: run npm run brand:build`);
}

console.log(`content:check  strings=${corpus.length}  faq=${Object.keys(faq.items).length} active, ${Object.keys(faq.retired).length} retired  rendered pages=${rendered}  banned=${banned.length}+${SHEET_RULES.length}  parity: ${parity}`);
if (errors.length) {
  console.error(`FAIL: ${errors.length} problem(s)`);
  errors.slice(0, 120).forEach((e) => console.error("  " + e));
  process.exit(1);
}
console.log("PASS: claims, spelling, FAQ integrity, fact consistency and (when asked) Control Plane parity.");
