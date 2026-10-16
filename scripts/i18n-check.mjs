// npm run i18n:check
// Every key in every locale, no untranslated English, placeholder/markup parity, terminology table, legal + FAQ structure.
import fs from "node:fs";
import path from "node:path";
import { loadDictionaries, loadTs, ROOT } from "./lib/load.mjs";

const LOCALES = ["en", "he", "es", "ru"];
const BRAND = ["WP Consent API", "aicc_lang_dismissed", "AI Commerce Copilot", "Ask Reco", "AICC", "Reco", "WooCommerce", "WordPress", "Solo", "Studio", "Agency", "Storefront", "cookie", "cookies", "Cookie", "http", "https", "HTTP", "HTTPS", "CSV", "WCAG", "HTTPS", "USD", "Plans & Stores", "aicc_lang", "aci_vid", "aci_sid"];
const allow = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/i18n-allowlist.json"), "utf8"));

const dicts = await loadDictionaries();
const { LEGAL_DOCS } = await loadTs("src/data/legal.ts");
const { FAQ } = await loadTs("src/data/faq.ts");

const errors = [];
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

const flat = Object.fromEntries(LOCALES.map((l) => [l, flatten(dicts[l])]));
const enKeys = Object.keys(flat.en);

const tokensOf = (s) => (s.match(/\{[A-Za-z0-9_]+\}/g) || []).sort().join("|");
const linksOf = (s) => (s.match(/\]\((route:[a-z-]+|https?:\/\/[^)]+)\)/g) || []).sort().join("|");
const boldOf = (s) => (s.match(/\*\*/g) || []).length;

function strippedOfBrands(s) {
  let t = s.replace(/\{[A-Za-z0-9_]+\}/g, " ").replace(/\]\((route:[a-z-]+|https?:\/\/[^)]+)\)/g, " ");
  for (const b of BRAND) t = t.split(b).join(" ");
  t = t.replace(/[0-9$€%.,:;!?()\-–—/&"'“”’*\[\]+©·#_=]/g, " ");
  return t.trim();
}
const hasLetters = (s) => /\p{L}/u.test(s);

for (const l of LOCALES) {
  const keys = Object.keys(flat[l]);
  for (const k of enKeys) if (!(k in flat[l])) err(l, k, "missing key");
  for (const k of keys) if (!(k in flat.en)) err(l, k, "extra key not in English");
}

for (const l of LOCALES.filter((x) => x !== "en")) {
  for (const k of enKeys) {
    if (!(k in flat[l]) || k.endsWith("#len")) continue;
    const ev = flat.en[k];
    const lv = flat[l][k];
    if (typeof ev !== typeof lv) { err(l, k, "type differs from English"); continue; }
    if (typeof ev !== "string") continue;
    if (lv.trim() === "") { err(l, k, "empty value"); continue; }
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
    const v = flat[l][t.key];
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
  for (const [k, v] of Object.entries(flat[l])) {
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
  if (!/товар(?![а-яё])/.test(w.addOne)) err("ru", "demo.widget.addOne", "should use 'товар'");
  if (!/товара(?![а-яё])/.test(w.addFew)) err("ru", "demo.widget.addFew", "2-4 take 'товара'");
  if (!/товаров(?![а-яё])/.test(w.addMany)) err("ru", "demo.widget.addMany", "5+ take 'товаров'");
  const rules = new Intl.PluralRules("ru");
  const want = { 1: "one", 2: "few", 3: "few", 4: "few", 5: "many", 11: "many", 21: "one", 22: "few" };
  for (const [n, cat] of Object.entries(want)) if (rules.select(+n) !== cat) err("ru", "plural", `Intl.PluralRules(ru).select(${n}) = ${rules.select(+n)}, expected ${cat}`);
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
  for (const f of FAQ) {
    const it = dicts[l].faq?.items?.[f.id];
    if (!it || !it.q || !it.a) err(l, `faq.items.${f.id}`, "missing question or answer");
  }
}

const nKeys = enKeys.filter((k) => !k.endsWith("#len")).length;
console.log(`i18n:check  locales=${LOCALES.join(",")}  keys=${nKeys}  FAQ=${FAQ.length}`);
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
console.log("PASS: all locales have every key; no untranslated values; placeholders and markup match.");
