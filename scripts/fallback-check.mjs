// npm run fallback:check: on every he / es / ru page, English text must never be presented as the page language.
// A text node is "English" when it has two or more consecutive Latin words (he, ru) or English stop words (es) and is not a brand name;
// such text is only allowed inside an element marked lang="en" (the explicit fallback, see src/i18n/merge.ts). Needs the export served at AICC_BASE_URL.
import { launch, urlFor, ROUTES } from "./lib/browser.mjs";
import { REPLICA_LABELS } from "./lib/replica-labels.mjs";

const BRAND = [...REPLICA_LABELS, "AI Commerce Copilot", "AICC", "Ask Reco", "Reco", "WooCommerce", "WordPress", "WP Consent API", "Solo", "Studio", "Agency", "Storefront", "Plans & Stores", "WCAG", "HTTPS", "HTTP", "CSV", "USD", "HPOS", "PHP", "JavaScript", "EN", "HE", "ES", "RU", "aicc_lang", "aicc_lang_dismissed", "aci_vid", "aci_sid", "http", "https"];
const browser = await launch();
const problems = [];
let nodes = 0, pages = 0;
async function scan(locale, route, mutate) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "1"); } catch {} });
  const p = await ctx.newPage();
  if (mutate) await p.route(/\/$/, async (r) => { const res = await r.fetch(); await r.fulfill({ response: res, body: mutate(await res.text()) }); });
  await p.goto(urlFor(locale, route), { waitUntil: "load" });
  await p.waitForTimeout(300);
  // mount the lazy kit modules and open every tab so their text exists
  await p.evaluate(async () => { for (const t of document.querySelectorAll('[role="tab"]')) { t.click(); await new Promise((r) => setTimeout(r, 400)); document.querySelectorAll("[data-aicc-fbt],[data-aicc-rules]").forEach((e) => e.scrollIntoView()); await new Promise((r) => setTimeout(r, 300)); } document.querySelectorAll("[data-aicc-fbt]").forEach((e) => e.scrollIntoView()); await new Promise((r) => setTimeout(r, 900)); });
  const found = await p.evaluate(({ BRAND, locale }) => {
    const EN_STOP = /\b(the|and|your|with|for|from|that|this|are|you|not|when|can|will|it's|does|what|how|only|every|more|than|into|before|after)\b/i;
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; let count = 0;
    while ((n = walker.nextNode())) {
      const el = n.parentElement;
      if (!el || el.closest("script,style,svg,noscript,[hidden],[aria-hidden='true']")) continue;
      let text = n.textContent.replace(/\s+/g, " ").trim();
      if (!text) continue;
      count++;
      for (const b of BRAND) text = text.split(b).join(" ");
      text = text.replace(/https?:\/\/\S+/g, " ").replace(/[$€£]\s?\d[\d,.]*/g, " ");
      const latinRun = /[A-Za-z]{3,}(?:\s+[A-Za-z]{2,}){1,}/.test(text);
      const english = locale === "es" ? EN_STOP.test(text) && /[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(text) : latinRun;
      if (!english) continue;
      const lang = el.closest("[lang]")?.getAttribute("lang") || document.documentElement.lang;
      if (lang && lang.toLowerCase().startsWith("en")) continue;
      out.push(`${n.textContent.trim().slice(0, 70)}  <${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}>`);
    }
    return { out, count };
  }, { BRAND, locale });
  await ctx.close();
  return found;
}
// The gate must bite: with every lang="en" marker stripped from the served HTML, the Hebrew pricing page has to be flagged.
{
  const bad = await scan("he", "pricing", (h) => h.replace(/ lang="en"/g, ""));
  if (!bad.out.length) { console.error("FAIL: selftest: stripping lang=en from /he/pricing/ was not detected"); process.exit(1); }
}
for (const locale of ["he", "es", "ru"]) for (const route of ROUTES) {
  const found = await scan(locale, route);
  nodes += found.count; pages++;
  for (const f of found.out) problems.push(`${locale}/${route || "home"}: unmarked English text: ${f}`);
}
await browser.close();
console.log(`fallback:check  ${pages} pages, ${nodes} text nodes inspected`);
if (problems.length) { console.error(`FAIL: ${problems.length} unmarked English text node(s)`); [...new Set(problems)].slice(0, 80).forEach((x) => console.error("  " + x)); process.exit(1); }
console.log("PASS: every English fallback on he/es/ru pages is marked lang=en");
