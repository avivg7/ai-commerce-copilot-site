// npm run fallback:check: on every he / es / ru page, English text must never be presented as the page language.
// A text node is "English" when it has two or more consecutive Latin words (he, ru) or English stop words (es) and is not a brand name;
// such text is only allowed inside an element marked lang="en" (the explicit fallback, see src/i18n/merge.ts). Needs the export served at AICC_BASE_URL.
import { launch, urlFor, ROUTES } from "./lib/browser.mjs";
import { REPLICA_LABELS } from "./lib/replica-labels.mjs";

const BRAND = [...REPLICA_LABELS, "AI Commerce Copilot", "AICC", "Ask Reco", "Reco", "WooCommerce", "WordPress", "WP Consent API", "Solo", "Studio", "Agency", "Storefront", "Plans & Stores", "WCAG", "HTTPS", "HTTP", "CSV", "USD", "HPOS", "PHP", "JavaScript", "EN", "HE", "ES", "RU", "aicc_lang", "aicc_lang_dismissed", "aci_vid", "aci_sid", "http", "https"];
const browser = await launch();
const problems = [];
let nodes = 0, pages = 0;
async function scan(locale, route, inject) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "1"); } catch {} });
  const p = await ctx.newPage();
  await p.goto(urlFor(locale, route), { waitUntil: "load" });
  await p.waitForTimeout(300);
  // self-test only: put English into the hydrated DOM, as an untranslated unit would render it (the server HTML is not edited: React would drop an unknown node on hydration)
  if (inject) await p.evaluate((html) => document.querySelector("main").insertAdjacentHTML("afterbegin", html), inject);
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
// The gate must bite. Every locale is fully translated now, so nothing is English by itself: the self-test INJECTS English into a translated page (what an untranslated unit would render).
// An English paragraph without lang="en" must be flagged; the same paragraph marked lang="en" dir="ltr" (what the fallback mechanism emits) must not be.
const INJECT = "<p>This sentence is untranslated English text that the page should mark with a language attribute.</p>";
for (const locale of ["he", "es", "ru"]) {
  const bare = await scan(locale, "pricing", INJECT);
  if (!bare.out.some((x) => x.startsWith("This sentence is untranslated English"))) { console.error(`FAIL: selftest: English injected into /${locale}/pricing/ without lang=en was not detected`); process.exit(1); }
  const marked = await scan(locale, "pricing", INJECT.replace("<p>", '<p lang="en" dir="ltr">'));
  if (marked.out.some((x) => x.startsWith("This sentence is untranslated English"))) { console.error(`FAIL: selftest: English marked lang=en on /${locale}/pricing/ was still flagged`); process.exit(1); }
  const clean = await scan(locale, "pricing");
  if (clean.out.length) { console.error(`FAIL: selftest: the untouched /${locale}/pricing/ already has unmarked English: ${clean.out[0]}`); process.exit(1); }
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
