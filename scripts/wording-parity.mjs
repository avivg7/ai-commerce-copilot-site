#!/usr/bin/env node
// P35/P36 wording parity: the Site launch-offer strings (src/i18n/ea/{en,he,es,ru}.ts, step 0, tokens resolved) versus the Control Plane /pricing/ strings
// (admin/wp-content/themes/aicc-admin/inc/launch-offer.php msgids + the COMPILED catalogues languages/{he_IL,es_ES,ru_RU}.mo), in four languages.
//   node wording-parity.mjs [--site <site worktree>] [--cp <control-plane worktree>]
// READ-ONLY on both trees. Exit 1 on any mismatch, any CP string with no Site counterpart that is not on the declared CP-only list, any CP string left untranslated, or a date-token table mismatch.
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i >= 0 ? process.argv[i + 1] : d; };
const SITE = arg("site", path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."));
const CP = arg("cp", path.join(os.homedir(), "Local Sites/woo-recommendation-qa/aicc-control-plane-worktrees/p36-pricing-ux"));
const THEME = path.join(CP, "admin/wp-content/themes/aicc-admin");
const { createJiti } = await import(path.join(SITE, "node_modules/jiti/lib/jiti.mjs")).catch(() => import("jiti"));
const jiti = createJiti(path.join(SITE, "scripts/x.mjs"), { alias: { "@": path.join(SITE, "src") }, moduleCache: false });
const { getEaDictionary, getDictionary } = await jiti.import(path.join(SITE, "src/i18n/index.ts"));
const { EA_DATES } = await jiti.import(path.join(SITE, "src/i18n/eaTokens.ts"));

// ---- CP strings (msgids) and date table
const php = fs.readFileSync(path.join(THEME, "inc/launch-offer.php"), "utf8");
const unq = (s) => s.replace(/\\(['\\])/g, "$1");
const cp = new Map();
const body = php.slice(php.indexOf("function aicc_lo_strings()"), php.indexOf("function aicc_lo_resolved"));
for (const m of body.matchAll(/'([A-Za-z0-9_.]+)'\s*=>\s*__\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'aicc-admin'\s*\)/g)) cp.set(m[1], unq(m[2]));
if (process.argv.includes("--self-test")) { cp.set("plan.free", cp.get("plan.free") + " x"); cp.delete("section.faq.end.q"); cp.set("bar.live", cp.get("bar.live").replace("approved stores", "stores")); } // negative control: three injected defects MUST be reported
const cpDates = {};
const dtab = php.slice(php.indexOf("function aicc_lo_dates()"), php.indexOf("function aicc_lo_strings()"));
for (const m of dtab.matchAll(/'(en|he|es|ru)'\s*=>\s*array\(\s*'lastDay'\s*=>\s*'([^']*)',\s*'lastDayShort'\s*=>\s*'([^']*)',\s*'until'\s*=>\s*'([^']*)'/g)) cpDates[m[1]] = { lastDay: m[2], lastDayShort: m[3], until: m[4] };

// ---- compiled catalogues (.mo, little or big endian)
function readMo(file) {
  const b = fs.readFileSync(file); const le = b.readUInt32LE(0) === 0x950412de; const u = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const n = u(8), ot = u(12), tt = u(16), map = new Map();
  for (let i = 0; i < n; i++) { const ol = u(ot + 8 * i), oo = u(ot + 8 * i + 4), tl = u(tt + 8 * i), to = u(tt + 8 * i + 4); map.set(b.slice(oo, oo + ol).toString("utf8"), b.slice(to, to + tl).toString("utf8")); }
  return map;
}
const CAT = { he: readMo(path.join(THEME, "languages/he_IL.mo")), es: readMo(path.join(THEME, "languages/es_ES.mo")), ru: readMo(path.join(THEME, "languages/ru_RU.mo")) };

// ---- mapping CP key -> Site dictionary path
const MAP = (k) => ({ "support.noCard": "pricing.support.noCard", "support.manual": "pricing.support.manual", "support.regular": "pricing.support.regular", "support.label": "hero.supportLabel", "plan.limited": "hero.support.limited", "plan.demo": "@home.hero.ctaDemo", "plan.seePricing": "@home.hero.ctaPlans" }[k] || k);
// CP-only strings (no Site counterpart by design; each is listed in the report): the Site has no "closed" bar variant (a static page has no request-closure state)
const CP_ONLY = new Set(["bar.closed"]);
const get = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
const nrm = (s) => String(s).replace(/[\u00a0\u202f\u2009]/g, " ").replace(/\s+/g, " ").trim();
const fails = [], rows = []; let ok = 0;
for (const l of ["en", "he", "es", "ru"]) {
  const site = getEaDictionary(l, 0);
  for (const [k, src] of cp) {
    const sp = MAP(k);
    let want = sp.startsWith("@") ? get(getDictionary(l), sp.slice(1)) : get(site, sp);
    if (want === undefined) { if (CP_ONLY.has(k)) { rows.push(`${l} ${k}: CP-only (declared)`); continue; } fails.push(`${l} ${k}: no Site string at ea.${sp}`); continue; }
    let have = l === "en" ? src : CAT[l].get(src);
    if (have === undefined || have === "") { fails.push(`${l} ${k}: CP has NO ${l} translation (msgid falls back to English)`); continue; }
    // CP resolves the date tokens with its own table (inside aicc_lo_resolved); do the same here, with the CP table
    const d = cpDates[l];
    have = have.replace(/\{(lastDay|lastDayShort|until)\}/g, (_, t) => d[t]);
    // the Site resolves {firstLastDay} etc. itself; tokens both sides pass through ({contactEmail}, {mailProvider}, {priceSolo}...) are compared literally
    if (nrm(have) === nrm(want)) ok++; else fails.push(`${l} ${k} (ea.${sp}):\n    SITE: ${nrm(want)}\n    CP  : ${nrm(have)}`);
  }
  for (const t of ["lastDay", "lastDayShort", "until"]) if (cpDates[l]?.[t] !== EA_DATES[l][0][t]) fails.push(`${l} date token ${t}: CP "${cpDates[l]?.[t]}" vs Site "${EA_DATES[l][0][t]}"`);
}
for (const l of ["en", "he", "es", "ru"]) { // P36 owner rule: the compared customer strings carry no country, no local time zone, no 00:00 end and no 1 January date
  const site = getEaDictionary(l, 0);
  const bad = /israel|jerusalem|ישראל|израил|\b00:00\b/i;
  for (const [k, v] of cp) if (bad.test(l === "en" ? v : (CAT[l].get(v) || ""))) fails.push(`${l} CP ${k}: names a country or a local time zone or a 00:00 end`);
  const walk = (o, p) => typeof o === "string" ? (bad.test(o) ? fails.push(`${l} Site ea.${p}: names a country or a local time zone or a 00:00 end`) : 0) : o && typeof o === "object" ? Object.entries(o).forEach(([k, v]) => walk(v, p ? p + "." + k : k)) : 0;
  walk(site, "");
}
console.log(`CP strings: ${cp.size}; compared per language; matching: ${ok}; CP-only declared: ${rows.length}; mismatches: ${fails.length}`);
for (const r of rows) console.log("  note " + r);
for (const f of fails) console.log("  MISMATCH " + f);
console.log(fails.length ? "FAIL wording-parity" : "PASS wording-parity");
process.exit(fails.length ? 1 : 0);
