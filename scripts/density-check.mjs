// npm run density:check [-- --route=""]: how much text does the first viewport carry? Counts the words a visitor can read (text nodes whose box intersects the viewport,
// visible, not aria-hidden decoration), at 1280x800 and 390x844, split into the page header (navigation, always present) and the content. A hero that reads like a
// spec fails. Budget (words in the content part): 1280x800 <= 75, 390x844 <= 70. Needs the export served at AICC_BASE_URL.
import { launch, urlFor } from "./lib/browser.mjs";

const BUDGET = { 1280: 75, 390: 70 };
const route = (process.argv.find((a) => a.startsWith("--route=")) || "--route=").slice(8);
const browser = await launch();
const rows = [];
let fail = false;
for (const [w, h] of [[1280, 800], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
  await ctx.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "1"); } catch {} });
  const p = await ctx.newPage();
  await p.goto(urlFor("en", route), { waitUntil: "load" });
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const out = { header: 0, content: 0, hero: 0, chips: 0 };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const el = n.parentElement;
      if (!el || el.closest("script,style,svg,noscript,[hidden],[inert],.aicc-sr-only,.aicc-skip,.aicc-suggest,[data-aicc-menu-panel]")) continue;
      const text = n.textContent.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const rect = [...rg.getClientRects()].find((q) => q.width > 0 && q.height > 0 && q.bottom > 0 && q.top < innerHeight && q.right > 0 && q.left < innerWidth);
      if (!rect) continue;
      const words = text.split(" ").length;
      if (el.closest(".aicc-site-header")) out.header += words;
      else if (el.closest("[aria-hidden='true']")) out.chips += words;
      else { out.content += words; if (el.closest(".aicc-hero__copy")) out.hero += words; }
    }
    return out;
  });
  const ok = r.content <= BUDGET[w];
  if (!ok) fail = true;
  rows.push(`${w}x${h}: content ${r.content} words (hero copy ${r.hero}; budget ${BUDGET[w]}) + header ${r.header} + decorative chips ${r.chips}  ${ok ? "PASS" : "FAIL"}`);
  await ctx.close();
}
await browser.close();
console.log(`density:check  /${route}\n  ` + rows.join("\n  "));
if (fail) { console.error("FAIL: the first viewport reads like a spec"); process.exit(1); }
console.log("PASS: the first viewport stays short");
