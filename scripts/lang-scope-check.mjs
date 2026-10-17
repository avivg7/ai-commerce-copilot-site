// npm run lang:check: translated text must never sit under an element marked lang="en" (WCAG 3.1.2 Language of Parts; and a Hebrew paragraph inside dir="ltr" scrambles its bidi order).
// The English fallback is applied to a unit (a section, a block); translated strings rendered INSIDE such a block (buttons, plan cards, FAQ items) must carry their own lang/dir.
// For every he / es / ru page this scans the rendered text: a text node in the locale's script (he, ru) or with Spanish markers (es) whose closest [lang] ancestor is "en", or a Hebrew node under dir="ltr", fails.
// Needs the export served at AICC_BASE_URL. fallback:check proves the reverse (English text is always marked).
import { launch, urlFor } from "./lib/browser.mjs";

const PAGES = ["", "product", "pricing", "questions", "data-and-trust", "privacy", "terms", "refund-policy", "accessibility"];
const browser = await launch();
const problems = [];
let nodes = 0, pages = 0;
for (const locale of ["he", "es", "ru"]) for (const route of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "1"); } catch {} });
  const p = await ctx.newPage();
  await p.goto(urlFor(locale, route), { waitUntil: "load" });
  await p.waitForTimeout(300);
  await p.evaluate(async () => { for (const t of document.querySelectorAll('[role="tab"]')) { t.click(); await new Promise((r) => setTimeout(r, 350)); } document.querySelectorAll("[data-aicc-fbt],[data-aicc-rules]").forEach((e) => e.scrollIntoView()); await new Promise((r) => setTimeout(r, 900)); document.querySelectorAll("details").forEach((d) => (d.open = true)); });
  const found = await p.evaluate((locale) => {
    const SCRIPT = { he: /[֐-׿]/, ru: /[Ѐ-ӿ]/, es: /[áéíóúñ¿¡]|\b(tienda|tiendas|para|con|una|los|las|del|que|por|más|está|cuando|también|puedes|usted)\b/i };
    const out = []; let count = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const el = n.parentElement;
      if (!el || el.closest("script,style,svg,noscript")) continue;
      const text = n.textContent.replace(/\s+/g, " ").trim();
      if (!text || !SCRIPT[locale].test(text)) continue;
      count++;
      const lang = (el.closest("[lang]")?.getAttribute("lang") || document.documentElement.lang || "").toLowerCase();
      const dirEl = el.closest("[dir]");
      const dir = dirEl ? dirEl.getAttribute("dir") : document.documentElement.dir;
      if (lang.startsWith("en")) out.push(`lang=en over "${text.slice(0, 50)}" <${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}>`);
      else if (locale === "he" && dir === "ltr" && /[֐-׿]/.test(text)) out.push(`dir=ltr over Hebrew "${text.slice(0, 50)}" <${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}>`);
    }
    return { out, count };
  }, locale);
  nodes += found.count; pages++;
  for (const f of found.out) problems.push(`${locale}/${route || "home"}: ${f}`);
  await ctx.close();
}
await browser.close();
console.log(`lang:check  ${pages} pages, ${nodes} translated text nodes inspected`);
if (problems.length) { const u = [...new Set(problems)]; console.error(`FAIL: ${u.length} translated text node(s) under an English or LTR wrapper`); u.slice(0, 60).forEach((x) => console.error("  " + x)); process.exit(1); }
console.log("PASS: no translated text sits under lang=en (or Hebrew under dir=ltr)");
