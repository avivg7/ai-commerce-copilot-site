// npm run lang:check: translated text must never sit under an element marked lang="en" (WCAG 3.1.2 Language of Parts; and a Hebrew paragraph inside dir="ltr" scrambles its bidi order).
// The English fallback is applied to a unit (a section, a block); translated strings rendered INSIDE such a block (buttons, plan cards, FAQ items) must carry their own lang/dir.
// For every he / es / ru page this scans the rendered text: a text node in the locale's script (he, ru) or with Spanish markers (es) whose closest [lang] ancestor is "en", or a Hebrew node under dir="ltr", fails.
// Needs the export served at AICC_BASE_URL. fallback:check proves the reverse (English text is always marked).
import { launch, urlFor } from "./lib/browser.mjs";
import { REPLICA_LABELS } from "./lib/replica-labels.mjs";

// Second assertion (es, ru): the real plugin-admin labels that stay English in a translated admin (Recommendation Preview, Pin, Bought together {n} times ...)
// must carry lang="en" at the LEAF; the translated words around them must not. (Hebrew: the plugin admin is translated, so he labels are Hebrew and must NOT be marked English; the check above covers that.)
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALT = [...REPLICA_LABELS].sort((a, b) => b.length - a.length).map((l) => escRe(l).replace("\\{n\\}", "[\\d.,\\u00a0\\u202f ]+?")).join("|");
const LABEL_SRC = `(?<![\\p{L}])(?:${ALT})(?![\\p{L}])`;

const PAGES = ["", "product", "pricing", "questions", "data-and-trust", "privacy", "terms", "refund-policy", "accessibility"];
const browser = await launch();
const problems = [];
let nodes = 0, pages = 0; const labelNodes = {};
for (const locale of ["he", "es", "ru"]) for (const route of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "1"); } catch {} });
  const p = await ctx.newPage();
  await p.goto(urlFor(locale, route), { waitUntil: "load" });
  await p.waitForTimeout(300);
  await p.evaluate(async () => { for (const t of document.querySelectorAll('[role="tab"]')) { t.click(); await new Promise((r) => setTimeout(r, 350)); } document.querySelectorAll("[data-aicc-fbt],[data-aicc-rules]").forEach((e) => e.scrollIntoView()); await new Promise((r) => setTimeout(r, 900)); document.querySelectorAll("details").forEach((d) => (d.open = true)); });
  const found = await p.evaluate(({ locale, LABEL_SRC }) => {
    const LABEL = new RegExp(LABEL_SRC, "gu");
    let labels = 0;
    const SCRIPT = { he: /[֐-׿]/, ru: /[Ѐ-ӿ]/, es: /[áéíóúñ¿¡]|\b(tienda|tiendas|para|con|una|los|las|del|que|por|más|está|cuando|también|puedes|usted)\b/i };
    const out = []; let count = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const el = n.parentElement;
      if (!el || el.closest("script,style,svg,noscript")) continue;
      const text = n.textContent.replace(/\s+/g, " ").trim();
      const lang0 = (el.closest("[lang]")?.getAttribute("lang") || document.documentElement.lang || "").toLowerCase();
      if (text && locale !== "he") {
        const hits = text.match(LABEL) || [];
        if (hits.length) {
          const name = `<${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}>`;
          const dirOk = (el.closest("[dir]")?.getAttribute("dir") || document.documentElement.dir) === "ltr";
          if (lang0.startsWith("en")) {
            labels += hits.length;
            // under lang=en: the node must BE the label(s) and nothing translated
            const rest = text.replace(LABEL, "").replace(/[\s\d.,:;·|/()+\-–—%]+/g, "");
            if (rest) out.push(`label wrapper holds translated text "${text.slice(0, 50)}" ${name}`);
            if (!dirOk) out.push(`English label without dir=ltr "${text.slice(0, 40)}" ${name}`);
          } else out.push(`English admin label "${hits[0]}" not marked lang=en in "${text.slice(0, 50)}" ${name}`);
        }
      }
      if (!text || !SCRIPT[locale].test(text)) continue;
      count++;
      const lang = (el.closest("[lang]")?.getAttribute("lang") || document.documentElement.lang || "").toLowerCase();
      const dirEl = el.closest("[dir]");
      const dir = dirEl ? dirEl.getAttribute("dir") : document.documentElement.dir;
      if (lang.startsWith("en")) out.push(`lang=en over "${text.slice(0, 50)}" <${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}>`);
      else if (locale === "he" && dir === "ltr" && /[֐-׿]/.test(text)) out.push(`dir=ltr over Hebrew "${text.slice(0, 50)}" <${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}>`);
    }
    return { out, count, labels };
  }, { locale, LABEL_SRC });
  nodes += found.count; pages++; labelNodes[locale] = (labelNodes[locale] || 0) + found.labels;
  for (const f of found.out) problems.push(`${locale}/${route || "home"}: ${f}`);
  await ctx.close();
}
await browser.close();
console.log(`lang:check  ${pages} pages, ${nodes} translated text nodes inspected; English admin-label leaves found: es ${labelNodes.es || 0}, ru ${labelNodes.ru || 0} (he uses the plugin's Hebrew labels, none marked English)`);
if (!labelNodes.es || !labelNodes.ru) problems.push("no lang=en admin-label leaf found in es or ru: the replica labeller is not running");
if (problems.length) { const u = [...new Set(problems)]; console.error(`FAIL: ${u.length} language-scope problem(s)`); u.slice(0, 60).forEach((x) => console.error("  " + x)); process.exit(1); }
console.log("PASS: no translated text sits under lang=en (or Hebrew under dir=ltr); every English admin label in es/ru is a lang=en dir=ltr leaf");
