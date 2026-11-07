// Shared by content:check and fbt:audit. "Frequently Bought Together" is the NAME of the storefront widget and co-purchase counting is ONE recommendation signal; it is
// never AICC's category, positioning, umbrella descriptor, footer definition or brand identity (docs/fbt-usage-audit.md, brand/README.md).
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./load.mjs";

/** Every way the English copy can mention the idea. */
const PHRASE = /frequently[- ]bought|bought[- ]together|buy[- ]together|buys?[- ]together|co-?purchas/i;
export const FBT_RE = { test: (t) => PHRASE.test(t) || /\bFBT\b/.test(t) };

/** The same phrase as the widget heading in each locale (the positional guard also runs on the translated slots). */
export const FBT_LOCALE_RE = {
  en: { test: (t) => /frequently[- ]bought|bought[- ]together|buy[- ]together|buys?[- ]together|co-?purchas/i.test(t) || /\bFBT\b/.test(t) },
  he: /נרכשים לעיתים קרובות יחד|נרכשים יחד|נרכשו יחד|קונים יחד|קנו יחד|\bFBT\b/,
  es: /comprados juntos|compran juntos|compraron juntos|\bFBT\b/i,
  ru: /покупают вместе|покупали вместе|куплены вместе|покупки вместе|\bFBT\b/i,
};

/** Positioning slots: the places where AICC is defined or described. FBT phrasing is forbidden in all of them (every locale). */
export function positioningSlots(dict) {
  const pages = Object.keys(dict.meta.pages);
  const slots = [
    ["home.hero.eyebrow", dict.home.hero.eyebrow],
    ["home.hero.titleLead", dict.home.hero.titleLead],
    ["home.hero.titleAccent", dict.home.hero.titleAccent],
    ["home.hero.lead", dict.home.hero.lead],
    ["meta.ogImageAlt", dict.meta.ogImageAlt],
    ["meta.siteName", dict.meta.siteName],
    ["common.footer.tagline", dict.common.footer.tagline],
    ["common.footer.note", dict.common.footer.note],
    ["product.hero.title", dict.product.hero.title],
    ["product.hero.lead", dict.product.hero.lead],
    ["pricing.hero.title", dict.pricing.hero.title],
    ["questionsPage.hero.title", dict.questionsPage.hero.title],
  ];
  for (const p of pages) slots.push([`meta.pages.${p}.title`, dict.meta.pages[p].title], [`meta.pages.${p}.description`, dict.meta.pages[p].description]);
  return slots;
}

/** Reviewed class-A usages: path (dictionary key, "faq.qNN", or a file) -> why it is a legitimate description of a specific behavior. */
export function loadAllowlist() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/fbt-allowlist.json"), "utf8"));
}

const SKIP_FILES = new Set(["scripts/content-check.mjs", "scripts/copy-check.mjs", "scripts/lib/fbt.mjs", "scripts/fbt-audit.mjs", "scripts/fbt-allowlist.json", "docs/fbt-usage-audit.md", "brand/i18n/strings.json", "brand/MANIFEST.json"]);
function* walk(dir, exts, skipDirs = ["node_modules", ".next", "out", ".git", ".audit"]) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skipDirs.includes(e.name)) yield* walk(rel, exts, skipDirs); }
    else if (exts.includes(path.extname(e.name)) && !SKIP_FILES.has(rel)) yield rel;
  }
}
function flatten(obj, prefix, out) {
  if (typeof obj === "string") out.push([prefix, obj]);
  else if (Array.isArray(obj)) obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  else if (obj && typeof obj === "object") for (const k of Object.keys(obj)) flatten(obj[k], prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/** All English occurrences: dictionary leaves, FAQ questions and answers, and every source/doc/script file outside src/i18n. */
export function scanFbt(enDict, faq) {
  const dict = [], faqs = [], files = [];
  for (const [k, v] of flatten(enDict, "", [])) if (FBT_RE.test(v)) dict.push({ path: k, text: v });
  for (const [id, it] of Object.entries(faq.items)) for (const f of ["q", "a"]) if (FBT_RE.test(it[f])) faqs.push({ path: `${id}.${f}`, text: it[f] });
  const roots = [["src", [".ts", ".tsx", ".css"]], ["brand/js", [".js"]], ["brand", [".css", ".md"]], ["brand/content", [".md"]], ["docs", [".md"]], ["scripts", [".mjs"]], ["scripts/lib", [".mjs"]], [".", [".md"]]];
  const seen = new Set();
  for (const [dir, exts] of roots) {
    const list = dir === "." ? fs.readdirSync(ROOT).filter((f) => exts.includes(path.extname(f)) && !SKIP_FILES.has(f)) : [...walk(dir, exts)];
    for (const rel of list) {
      if (seen.has(rel) || rel.startsWith("src/i18n/")) continue;
      seen.add(rel);
      const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n");
      lines.forEach((l, i) => { if (FBT_RE.test(l)) files.push({ path: rel, line: i + 1, text: l.trim().slice(0, 140) }); });
    }
  }
  return { dict, faqs, files };
}

/** Reason shown in the audit table for a class-A occurrence (the reviewer's call is recorded by listing it in scripts/fbt-allowlist.json). */
export function classA(text) {
  if (/Frequently Bought Together/.test(text)) return "names the storefront widget (its real heading)";
  if (/bought together \{n\}|times bought together|bought together \{na\}/i.test(text)) return "the real evidence label / count of a learned partner";
  return "describes the co-purchase signal or a relationship in context (the first step of a fixed ranking chain)";
}

/** Fails (returns messages) for FBT phrasing in positioning slots (all locales) and for any occurrence not in the reviewed allow-list. */
export function checkFbt({ dicts, faq, faqTranslations, enDict }) {
  const out = [];
  for (const [l, d] of Object.entries(dicts)) {
    for (const [slot, v] of positioningSlots(d)) if (typeof v === "string" && FBT_LOCALE_RE[l].test(v)) out.push(`[${l}] ${slot}: "Frequently Bought Together" / co-purchase phrasing in a positioning slot (class B: AICC is a commerce recommendation and merchandising copilot; FBT names the widget only): "${v.slice(0, 80)}"`);
  }
  const firstSentence = (a) => a.split(/(?<=[.!?])\s/)[0];
  const q01 = { en: faq.items.q01.a, ...Object.fromEntries(Object.entries(faqTranslations).map(([l, t]) => [l, t.items?.q01?.a]).filter(([, a]) => a)) };
  for (const [l, a] of Object.entries(q01)) if (FBT_LOCALE_RE[l].test(firstSentence(a))) out.push(`[${l}] "What is AICC?" answer, first sentence: FBT phrasing (class B)`);
  const allow = loadAllowlist();
  const scan = scanFbt(enDict, faq);
  const NEED = "classify it: A (a legitimate description of the widget or of the co-purchase signal: add it to scripts/fbt-allowlist.json with a reason and to docs/fbt-usage-audit.md) or B (used as AICC's identity: rewrite it)";
  for (const o of scan.dict) if (!allow.dict[o.path]) out.push(`new FBT / co-purchase wording at dictionary path ${o.path}: ${NEED}. "${o.text.slice(0, 90)}"`);
  for (const o of scan.faqs) if (!allow.faq[o.path]) out.push(`new FBT / co-purchase wording in FAQ ${o.path}: ${NEED}`);
  const per = {};
  for (const o of scan.files) per[o.path] = (per[o.path] || 0) + 1;
  for (const [f, n] of Object.entries(per)) { const a = allow.files[f]; if (!a || n > a.max) out.push(`FBT wording in ${f}: ${n} occurrence(s), allowed ${a ? a.max : 0}: ${NEED}`); }
  return { problems: out, scan };
}
