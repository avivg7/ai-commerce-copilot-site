// npm run i18n:check
// Every translated key is valid; every untranslated unit is an explicit, counted English fallback (see src/i18n/merge.ts).
//   npm run i18n:check             fails on structural problems and on bad translations; fallback units are reported, not failures
//   npm run i18n:check -- --strict also fails while any unit or FAQ question still falls back to English (the Stage 2 completion gate)
import fs from "node:fs";
import path from "node:path";
import { loadDictionaries, loadPartials, loadFallbacks, loadTs, ROOT } from "./lib/load.mjs";
import { REPLICA_LABELS, HE_ADMIN_LABELS } from "./lib/replica-labels.mjs";

const STRICT = process.argv.includes("--strict");

const LOCALES = ["en", "he", "es", "ru"];
const BRAND = ["WP Consent API", "aicc_lang_dismissed", "AI Commerce Copilot", "Ask Reco", "AICC", "Reco", "WooCommerce", "WordPress", "Solo", "Studio", "Agency", "Storefront", "cookie", "cookies", "Cookie", "http", "https", "HTTP", "HTTPS", "CSV", "WCAG", "HTTPS", "USD", "Plans & Stores", "aicc_lang", "aci_vid", "aci_sid", "Cloudflare Turnstile", "Cloudflare", "Turnstile"];
const allow = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/i18n-allowlist.json"), "utf8"));

const dicts = await loadDictionaries();       // as rendered: English fills every untranslated unit
const partials = await loadPartials();         // as authored: he/es/ru hold only translated units
const fallbacks = await loadFallbacks();
const { LEGAL_DOCS } = await loadTs("src/data/legal.ts");
const faqMod = await loadTs("src/data/faq.ts");
const { FAQ } = faqMod;

const eaTokens = await loadTs("src/i18n/eaTokens.ts");
const { EA_EXTENSION_STEP } = await loadTs("src/lib/earlyAccess.ts");
const authoredText = (l, k) => (k.startsWith("ea.") && typeof flatP[l][k] === "string" ? eaTokens.resolveEaTokens(flatP[l][k], l, EA_EXTENSION_STEP) : flatP[l][k]);
const errors = [];
const partialNotes = [];
const warnings = [];
const err = (loc, key, msg) => errors.push(`[${loc}] ${key}: ${msg}`);

function flatten(obj, prefix = "", out = {}) {
  if (typeof obj === "string") { out[prefix] = obj; return out; }
  if (Array.isArray(obj)) {
    out[`${prefix}#len`] = obj.length;
    obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj)) flatten(obj[k], prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out[prefix] = obj;
  return out;
}

const flat = Object.fromEntries(LOCALES.map((l) => [l, flatten(dicts[l])]));       // rendered
const flatP = Object.fromEntries(LOCALES.map((l) => [l, flatten(partials[l])]));   // authored (translated units only)
const enKeys = Object.keys(flat.en);

const tokensOf = (s) => (s.match(/\{[A-Za-z0-9_]+\}/g) || []).sort().join("|");
const linksOf = (s) => (s.match(/\]\((route:[a-z-]+|https?:\/\/[^)]+)\)/g) || []).sort().join("|");
const boldOf = (s) => (s.match(/\*\*/g) || []).length;

function strippedOfBrands(s) {
  let t = s;
  for (const b of REPLICA_LABELS) t = t.split(b).join(" "); // real admin labels (English on purpose), before tokens and brands
  t = t.replace(/\{[A-Za-z0-9_]+\}/g, " ").replace(/\]\((route:[a-z-]+|https?:\/\/[^)]+)\)/g, " ");
  for (const b of BRAND) t = t.split(b).join(" ");
  t = t.replace(/[0-9$€%.,:;!?()\-–—/&"'“”’*\[\]+©·#_=]/g, " ");
  return t.trim();
}
const hasLetters = (s) => /\p{L}/u.test(s);
const { unitOf: unitOfKey } = await loadTs("src/i18n/merge.ts");

// Structure: English is the contract. A locale may only contain keys English has; anything it lacks is a fallback unit.
for (const l of LOCALES) {
  for (const k of Object.keys(flatP[l])) if (!(k in flat.en)) err(l, k, "extra key not in English");
  for (const k of enKeys) if (!(k in flat[l])) err(l, k, "missing key after fallback merge (merge bug)");
}
// Fallback mechanism: a unit is either wholly the locale's own text or wholly English; never a mix.
{
  const { unitOf } = await loadTs("src/i18n/merge.ts");
  const { isFallback, fbProps } = await loadTs("src/i18n/index.ts");
  for (const l of LOCALES.filter((x) => x !== "en")) {
    const fbSet = new Set(fallbacks[l]);
    const byUnit = new Map();
    for (const k of enKeys) { if (k.endsWith("#len")) continue; const u = unitOf(k); (byUnit.get(u) ?? byUnit.set(u, []).get(u)).push(k); }
    for (const [u, keys] of byUnit) {
      const own = keys.filter((k) => k in flatP[l]);
      const isFb = fbSet.has(u);
      if (isFb) {
        for (const k of keys) if (flat[l][k] !== flat.en[k]) err(l, k, "fallback unit must render the English text");
        if (!isFallback(l, keys[0])) err(l, keys[0], "isFallback() disagrees with the fallback set");
        const a = fbProps(l, keys[0]);
        if (a.lang !== "en" || a.dir !== "ltr") err(l, keys[0], "fallback text must be marked lang=en dir=ltr");
        if (own.length && own.length < keys.length) partialNotes.push(`[${l}] ${u}: ${own.length}/${keys.length} strings kept for Stage 2; the whole unit shows English until complete`);
      } else {
        // the Early Access pack carries date tokens ({lastDay} ...): the rendered text is the authored text with the tokens of this build's step resolved (src/i18n/eaTokens.ts)
        for (const k of keys) if (flat[l][k] !== authoredText(l, k)) err(l, k, "translated unit must render the locale text");
        if (isFallback(l, keys[0]) || Object.keys(fbProps(l, keys[0])).length) err(l, keys[0], "a translated unit must not carry fallback markers");
      }
    }
  }
  for (const k of enKeys) if (isFallback("en", k)) err("en", k, "English can never be a fallback");
}

for (const l of LOCALES.filter((x) => x !== "en")) {
  for (const k of Object.keys(flatP[l])) {
    if (!(k in flat.en) || k.endsWith("#len")) continue;
    if (fallbacks[l].includes(unitOfKey(k))) continue; // partial units are ignored by the merge; reported above
    // the Early Access pack is compared as authored (date tokens unresolved), so a language that drops or invents a token is caught
    const ev = k.startsWith("ea.") ? flatP.en[k] : flat.en[k];
    const lv = flatP[l][k];
    if (typeof ev !== typeof lv) { err(l, k, "type differs from English"); continue; }
    if (typeof ev !== "string") continue;
    if (lv.trim() === "") { if (ev.trim() !== "") err(l, k, "empty value"); continue; } // an empty English value (a link-less sample answer) stays empty
    if (tokensOf(ev) !== tokensOf(lv)) err(l, k, `placeholder mismatch: en "${tokensOf(ev)}" vs ${l} "${tokensOf(lv)}"`);
    if (linksOf(ev) !== linksOf(lv)) err(l, k, `link target mismatch: en "${linksOf(ev)}" vs ${l} "${linksOf(lv)}"`);
    if (boldOf(ev) !== boldOf(lv)) err(l, k, "bold marker count mismatch");
    if (ev === lv && hasLetters(strippedOfBrands(ev)) && !(allow[l] || []).includes(k)) {
      err(l, k, `value equals English: "${ev.slice(0, 60)}"`);
    }
    // Untranslated English heuristic for non-Latin-script locales, and long English runs in es.
    const body = strippedOfBrands(lv.replace(/\]\([^)]*\)/g, ""));
    if (l === "he" || l === "ru") {
      const latin = body.match(/[A-Za-z]{3,}(?:\s+[A-Za-z]{2,}){1,}/g);
      if (latin) err(l, k, `untranslated English run: "${latin[0]}"`);
      const latinWords = body.match(/\b[A-Za-z]{4,}\b/g);
      if (latinWords && latinWords.length >= 1) warnings.push(`[${l}] ${k}: Latin word(s) outside the brand list: ${latinWords.slice(0, 3).join(", ")}`);
    }
  }
}

// Terminology table (content-source.md section 8): required exact values / substrings.
const TERMS = [
  { key: "common.getStarted", he: "להתחלה", es: "Empezar", ru: "Начать", exact: true },
  { key: "common.plan.choose", he: "בחירת {plan}", es: "Elegir {plan}", ru: "Выбрать {plan}", exact: true },
  { key: "demo.widget.title", he: "נרכשים לעיתים קרובות יחד", es: "Comprados juntos con frecuencia", ru: "Часто покупают вместе", exact: true },
  { key: "common.plan.oneStore", he: "חנות", es: "tienda", ru: "магазин" },
  { key: "common.plan.upToStores", he: "עד {n} חנויות", es: "Hasta {n} tiendas", ru: "До {n} магазинов", exact: true },
  { key: "faq.items.q09.a", he: "חנויות", es: "tiendas", ru: "магазин" },
  { key: "faq.items.q12.a", he: "תוכניות וחנויות", es: "Planes y tiendas", ru: "Планы и магазины" },
  { key: "faq.items.q20.a", he: "תוכניות וחנויות", es: "Planes y tiendas", ru: "Планы и магазины" },
  { key: "common.plan.renewal", he: "ללא חיוב אוטומטי", es: "sin cobros automáticos", ru: "без автоматических списаний", ci: true },
  { key: "common.plan.guarantee", he: "החזר כספי", es: "devolución del dinero", ru: "возврата денег", ci: true },
  { key: "faq.items.q11.a", he: "תוכנית", es: "plan", ru: "план", ci: true },
  { key: "faq.items.q14.a", he: "תוכנית", es: "plan", ru: "план", ci: true },
];
for (const t of TERMS) {
  for (const l of ["he", "es", "ru"]) {
    const v = flatP[l][t.key]?.replace(/\u00a0/g, " "); // non-breaking spaces are typography, not wording
    if (v === undefined) continue;
    const want = t[l];
    const ok = t.exact ? v === want : t.ci ? v.toLowerCase().includes(want.toLowerCase()) : v.includes(want);
    if (!ok) err(l, t.key, `terminology: expected ${t.exact ? "exactly" : "to contain"} "${want}", got "${v.slice(0, 70)}"`);
  }
}

// Register / terminology decisions (shared-decisions.md item 6 and 16): forbidden variants per locale.
const FORBIDDEN = {
  he: [
    [/מפתחים|למפתח|המפתח(?!\s*של)|מפתח\/ת/, "a developer is 'מתכנת' (מפתח is only the licence key, 'מפתח רישיון')"],
    [/מושלמת/, "'כשהרכישה מושלמת' is wrong: 'מרגע שהרכישה הושלמה'"],
    [/החזר כספי מלא/, "guarantee noun is 'החזר כספי תוך 14 ימים על הרכישה הראשונה' (no 'מלא')"],
    [/אישור תשלום שמור/, "write 'אין הרשאת חיוב שמורה'"],
    [/ווידג'ט/, "widget is spelled with geresh U+05F3: ווידג׳ט"],
    [/[\u0590-\u05FF]-[A-Za-z]/, "use maqaf U+05BE between a Hebrew prefix and a Latin word (ל־WooCommerce)"],
    [/[\u0590-\u05FF]"[\u0590-\u05FF]|"[\u0590-\u05FF][^"]*[\u0590-\u05FF]"/, "use gershayim ״…״ (or none), not ASCII double quotes around Hebrew"],
    [/הסוחר|\/ת\b/, "no slash forms; merchant = בעל חנות"],
    [/AICC מפסיקה/, "'AICC מפסיק' (masculine) everywhere"],
    [/עלול להיכשל|נעדר לגמרי|שנשאר כן|דוגמאות בדויות/, "reviewer-rejected phrasing"],
  ],
  es: [
    [/Condiciones del Servicio|Condiciones del servicio/, "use 'Términos del servicio'"],
    [/\blugares\b/i, "slot = cupo"],
    [/\bseud[oó]nimos\b/i, "use 'seudonimizados'"],
    [/\b(puedes|tienes|quieres|eres|necesitas|sabes|tu tienda|tus tiendas|conectas)\b/i, "usted register (not tú)"],
    [/(^|[.!?]\s)Solo (conecta|cubre|permite|tiene)\b/, "'Solo' the plan must read as 'el plan Solo'"],
    [/periodo de retenci[oó]n|empieza de cero|nuevo comienzo/i, "retention wording (shared item 7)"],
  ],
  ru: [
    [/(?<=[a-zа-яё,;:]\s)(Вы|Ваш\w*|Вам|Вас)(?=[\s.,;:!?])/, "lowercase вы/ваш mid-sentence"],
    [/проводник|продавец|слот|возвращён|Возвращённый/i, "терминология: гид / владелец магазина / место / «если за план вернули деньги»"],
    [/товара\(ов\)/, "use proper plural forms (товар / товара / товаров)"],
    [/данные для списания не сохраняются/i, "write: мы не храним разрешение на повторные списания"],
    [/(?<![а-яё])г\.\./, "doubled period after 'г.'"],
    [/самое большее|детерминирован|наложения/i, "reviewer-rejected phrasing"],
    [/срок хранения|начнёте заново/i, "retention wording (shared item 7)"],
  ],
};
const TU_ALLOWED = new Set(["demo.widget.selectAtLeastOne"]);
for (const [l, rules] of Object.entries(FORBIDDEN)) {
  for (const [k, v] of Object.entries(flatP[l])) {
    if (typeof v !== "string" || k.endsWith("#len")) continue;
    for (const [re, why] of rules) {
      if (l === "es" && TU_ALLOWED.has(k) && /usted register/.test(why)) continue;
      if (re.test(v)) err(l, k, `forbidden variant (${why}): "${v.slice(0, 80)}"`);
    }
  }
}
// Retention shape (shared item 7): the 12-month sentence is never paired with "is deleted after".
for (const l of LOCALES) {
  for (const [k, v] of Object.entries(flat[l])) {
    if (typeof v === "string" && /deleted after|deleted when you leave/i.test(v)) err(l, k, "deletion promise");
  }
}
// Plural forms (Russian): the add-to-cart label has three forms that must differ and agree with their numbers.
{
  const w = dicts.ru.demo.widget;
  if (!fallbacks.ru.includes("demo")) {
  if (!/товар(?![а-яё])/.test(w.addOne)) err("ru", "demo.widget.addOne", "should use 'товар'");
  if (!/товара(?![а-яё])/.test(w.addFew)) err("ru", "demo.widget.addFew", "2-4 take 'товара'");
  if (!/товаров(?![а-яё])/.test(w.addMany)) err("ru", "demo.widget.addMany", "5+ take 'товаров'");
  const rules = new Intl.PluralRules("ru");
  const want = { 1: "one", 2: "few", 3: "few", 4: "few", 5: "many", 11: "many", 21: "one", 22: "few" };
  for (const [n, cat] of Object.entries(want)) if (rules.select(+n) !== cat) err("ru", "plural", `Intl.PluralRules(ru).select(${n}) = ${rules.select(+n)}, expected ${cat}`);
  }
}
// Russian "{n} раз" (Покупали вместе {n} раз; куплено {n} раз): "раз" is right for the plural categories one (1, 21, 31 ...) and many (5-20, 25-30 ...) but wrong for few (2-4, 22-24 ...: "раза").
// The counts shown are fixed samples in the kit (rules-demo, fbt-demo, dash-preview) and on the Product page. Rather than ship plural logic the samples do not need, this proves
// no sample count is a "few" number; changing a sample to 2-4 / 22-24 fails here until the ru strings get real plural forms (Intl.PluralRules("ru"), as the cart label has).
{
  const rd = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const samples = new Set();
  for (const [f, re] of [["brand/js/fbt-demo.js", /count:\s*(\d+)/g], ["brand/js/rules-demo.js", /count:\s*(\d+)/g], ["brand/js/dash-preview.js", /\.format\((\d+)\)/g], ["src/components/pages/ProductPage.tsx", /replace\("\{n\}",\s*"(\d+)"\)/g]])
    for (const m of rd(f).matchAll(re)) if (+m[1] > 0) samples.add(+m[1]);
  const rules = new Intl.PluralRules("ru");
  if (samples.size < 3) err("ru", "plural.samples", `found only ${samples.size} sample counts: the extraction patterns are stale`);
  for (const n of samples) if (rules.select(n) === "few") err("ru", "plural.samples", `sample count ${n} is a "few" number: "{n} раз" would need "раза"; add plural forms`);
}
// Pending lines exist and are the single muted line (no brackets / pills).
for (const l of LOCALES) {
  const p = dicts[l].pending;
  if (!p?.line || !p?.detail) err(l, "pending", "line and detail are required");
  else if (/[\[\]]|pending|--/.test(p.line + p.detail) && l === "en") err(l, "pending", "must be a plain sentence, no bracket tokens");
}

// Legal blocks: structure from src/data/legal.ts must exist in every locale, with the right type.
for (const l of LOCALES) {
  for (const [docId, doc] of Object.entries(LEGAL_DOCS)) {
    const d = dicts[l].legal?.[docId];
    if (!d) { err(l, `legal.${docId}`, "missing document"); continue; }
    for (const sec of doc.sections) {
      const ds = d.s?.[sec.id];
      if (!ds || typeof ds.h !== "string") { err(l, `legal.${docId}.s.${sec.id}.h`, "missing heading"); continue; }
      for (const b of sec.blocks) {
        const v = ds[b.id];
        if (b.list ? !Array.isArray(v) : typeof v !== "string") err(l, `legal.${docId}.s.${sec.id}.${b.id}`, b.list ? "expected a list (string[])" : "expected a paragraph (string)");
      }
    }
    const declared = new Set(doc.sections.map((s) => s.id));
    for (const sid of Object.keys(d.s || {})) if (!declared.has(sid)) err(l, `legal.${docId}.s.${sid}`, "section not declared in src/data/legal.ts");
  }
}

// FAQ pack (brand/content): the structure, per-page selections and retired map resolve; translations only ever supply q/a that exist in English.
{
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, "brand/content/faq.en.json"), "utf8"));
  for (const l of LOCALES.filter((x) => x !== "en")) {
    const tr = JSON.parse(fs.readFileSync(path.join(ROOT, `brand/content/faq.${l}.json`), "utf8"));
    for (const [id, it] of Object.entries(tr.items)) {
      if (!en.items[id]) { err(l, `faq.${id}`, "translation for an id that is not an active English question"); continue; }
      if (!it.q?.trim() || !it.a?.trim()) err(l, `faq.${id}`, "empty question or answer");
      const tk = (x) => [...x.matchAll(/\]\((route:[a-z-]+)\)/g)].map((m) => m[1]).sort().join("|");
      if (tk(it.a) !== tk(en.items[id].a)) err(l, `faq.${id}`, "link tokens differ from English");
      if (Object.keys(it).some((x) => !["q", "a"].includes(x))) err(l, `faq.${id}`, "translations may hold only q and a");
    }
    for (const f of FAQ) {
      const t = faqMod.faqText(l, f.id);
      if (!t.q || !t.a) err(l, `faq.${f.id}`, "no renderable question");
      if (t.fallback !== !(f.id in tr.items)) err(l, `faq.${f.id}`, "fallback flag disagrees with the pack");
    }
  }
}

// Hebrew: the plugin admin IS translated, so the he replicas must use the plugin's own Hebrew labels (brand/content/replica-labels.json "he", from the plugin .po),
// never the English label, and a label must not be reworded. For every English kit string that is exactly a real admin label, the he string at the same key must equal the .po label.
{
  const walk = (en, he, p) => {
    for (const [k, v] of Object.entries(en || {})) {
      const q = p ? p + "." + k : k;
      if (typeof v === "string") {
        const want = HE_ADMIN_LABELS[v];
        if (want && typeof he?.[k] === "string" && he[k] !== want) err("he", q, `plugin Hebrew admin label is "${want}", found "${he[k]}"`);
      } else if (v && typeof v === "object") walk(v, he?.[k], q);
    }
  };
  // a kit set that still falls back to English (not translated yet) is not Hebrew text: nothing to compare
  for (const root of ["dash", "rules", "demo"]) if (!fallbacks.he.includes(root)) walk(dicts.en[root], dicts.he[root], root);
}

const nKeys = enKeys.filter((k) => !k.endsWith("#len")).length;
console.log(`i18n:check  locales=${LOCALES.join(",")}  keys=${nKeys}  FAQ=${FAQ.length}`);
if (partialNotes.length) console.log(`  ${partialNotes.length} fallback unit(s) still hold some earlier translated strings (kept as Stage 2 reference; never rendered). Use --verbose to list.`);
if (process.argv.includes("--verbose")) partialNotes.forEach((n) => console.log("    " + n));
const fbReport = {};
for (const l of LOCALES.filter((x) => x !== "en")) {
  const q = faqMod.faqFallbackIds(l);
  fbReport[l] = { units: fallbacks[l].length, faq: q.length };
  console.log(`  ${l}: ${fallbacks[l].length} dictionary unit(s) and ${q.length}/${FAQ.length} FAQ question(s) fall back to English (marked lang=en dir=ltr)`);
  // <title> and <meta description> cannot carry lang: a page whose title is still English is listed here so the locale agents translate titles first (WCAG 2.4.2).
  const metaFb = fallbacks[l].filter((u) => u.startsWith("meta.pages.")).map((u) => u.split(".")[2]);
  console.log(`  ${l}: page title/description still English for: ${metaFb.length ? metaFb.join(", ") : "none"}`);
}
if (STRICT && Object.values(fbReport).some((r) => r.units || r.faq)) { for (const l of Object.keys(fbReport)) if (fbReport[l].units || fbReport[l].faq) err(l, "fallback", `--strict: ${fbReport[l].units} unit(s) and ${fbReport[l].faq} question(s) still untranslated`); }
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s) (Latin words in non-Latin locales; review, not failing):`);
  for (const w of warnings.slice(0, 40)) console.log("  " + w);
}
if (errors.length) {
  console.error(`\nFAIL: ${errors.length} problem(s)`);
  for (const e of errors.slice(0, 200)) console.error("  " + e);
  if (errors.length > 200) console.error(`  ... and ${errors.length - 200} more`);
  process.exit(1);
}
console.log("PASS: structure complete, translated units valid, every untranslated unit is an explicit lang=en fallback.");
