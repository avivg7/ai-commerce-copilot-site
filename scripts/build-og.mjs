// npm run og:build: generates the branded Open Graph images (a neutral product-page bundle sketch: no Reco artwork, no chart or growth motif) (public/og/<locale>-<page>.jpg, 1200x630) with headless Chrome.
// Static export has no image runtime, so the images are generated once and committed. Needs a prior `npm run build`
// only for the Geist font file; otherwise falls back to the system sans-serif.
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import { loadDictionaries, loadFallbacks, ROOT } from "./lib/load.mjs";

const dicts = await loadDictionaries();
const FB = await loadFallbacks(); // a unit that is still English on a he/es/ru page is laid out left-to-right
const outDir = path.join(ROOT, "public/og");
fs.mkdirSync(outDir, { recursive: true });
const tmp = path.join(ROOT, ".audit");
fs.mkdirSync(tmp, { recursive: true });

const mediaDir = path.join(ROOT, "out/_next/static/media");
const font = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir).find((f) => f.endsWith(".woff2")) : null;
const fontCss = font ? `@font-face{font-family:'OG';src:url('file://${path.join(mediaDir, font)}') format('woff2');font-weight:100 900}` : "";
const file = (p) => "file://" + path.join(ROOT, p);
const titles = (t) => ({
  home: `${t.home.hero.titleLead} ${t.home.hero.titleAccent}`,
  product: t.product.hero.title,
  pricing: t.pricing.hero.title,
  "data-and-trust": t.legal.dataTrust.title,
  privacy: t.legal.privacy.title,
  terms: t.legal.terms.title,
  "refund-policy": t.legal.refund.title,
  accessibility: t.legal.accessibility.title,
  questions: t.questionsPage.hero.title,
});
const DIR = { en: "ltr", he: "rtl", es: "ltr", ru: "ltr" };

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
let n = 0;
for (const [locale, t] of Object.entries(dicts)) {
  for (const [route, title] of Object.entries(titles(t))) {
    const key = route === "home" ? "home" : route;
    const big = route === "home";
    const english = route === "home" ? FB[locale].includes("home.hero") || FB[locale].includes("common.footer.tagline") : false;
    const dir = english ? "ltr" : DIR[locale], lang = english ? "en" : locale;
    const html = `<!doctype html><html lang="${lang}" dir="${dir}"><meta charset="utf-8"><style>
${fontCss}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;font-family:'OG',-apple-system,'Segoe UI','Arial Hebrew',Arial,sans-serif;color:#fff;
 background:radial-gradient(900px 500px at 100% 0%,rgba(34,211,238,.28),transparent 65%),radial-gradient(700px 500px at 0% 100%,rgba(16,185,129,.22),transparent 65%),#0b1220;
 display:grid;grid-template-columns:1fr 440px;gap:48px;padding:64px;align-items:center;overflow:hidden}
.brand{display:flex;align-items:center;gap:16px;font-weight:700;font-size:30px;letter-spacing:-.01em}
.brand img{width:56px;height:56px}
h1{font-size:${big ? 54 : 56}px;line-height:1.08;font-weight:750;letter-spacing:${dir === "rtl" ? 0 : "-.03em"};margin-top:36px;text-wrap:balance}
p{margin-top:24px;font-size:24px;line-height:1.35;color:#cbd5e1;max-width:620px}
.card{border-radius:36px;overflow:hidden;box-shadow:0 30px 80px -20px rgba(0,0,0,.6);aspect-ratio:1/1;position:relative;background:#f8fafc;padding:28px;display:grid;grid-template-rows:auto 1fr auto;gap:18px}
/* A neutral sketch of a product page recommendation bundle (no text, no chart, no growth motif): the viewed product, ticked partners, an add-to-cart bar. */
.sk-top{display:flex;align-items:center;gap:20px}
.sk-img{width:72px;height:72px;border-radius:18px;background:linear-gradient(135deg,#a5f3fc,#6ee7b7);flex:none}
.sk-lines{flex:1;display:grid;gap:12px}.sk-lines i{display:block;height:14px;border-radius:7px;background:#cbd5e1}.sk-lines i:first-child{width:70%;background:#94a3b8}.sk-lines i:last-child{width:40%}
.sk-rows{display:grid;gap:10px;align-content:center}
.sk-row{display:flex;align-items:center;gap:16px;padding:10px 14px;border-radius:16px;background:#fff;border:2px solid #e2e8f0}
.sk-row b{width:30px;height:30px;border-radius:9px;background:#0e7490;flex:none;position:relative}
.sk-row b::after{content:"";position:absolute;left:9px;top:5px;width:8px;height:15px;border:solid #fff;border-width:0 4px 4px 0;transform:rotate(40deg)}
.sk-row.off b{background:#fff;border:3px solid #94a3b8}.sk-row.off b::after{display:none}
.sk-row .th{width:44px;height:44px;border-radius:14px;background:#e2e8f0;flex:none}
.sk-row .ln{flex:1;display:grid;gap:9px}.sk-row .ln i{display:block;height:12px;border-radius:6px;background:#cbd5e1}.sk-row .ln i:first-child{width:75%;background:#94a3b8}.sk-row .ln i:last-child{width:35%}
.sk-bar{height:48px;border-radius:16px;background:linear-gradient(90deg,#0e7490,#059669)}
</style><body><div><div class="brand"><img src="${file("brand/assets/aicc-logomark.svg")}" alt=""><span>AI Commerce Copilot</span></div>
<h1>${title.replace(/</g, "&lt;")}</h1><p>${t.common.footer.tagline.replace(/</g, "&lt;")}</p></div>
<div class="card" aria-hidden="true"><div class="sk-top"><div class="sk-img"></div><div class="sk-lines"><i></i><i></i></div></div><div class="sk-rows"><div class="sk-row"><b></b><span class="th"></span><span class="ln"><i></i><i></i></span></div><div class="sk-row"><b></b><span class="th"></span><span class="ln"><i></i><i></i></span></div><div class="sk-row off"><b></b><span class="th"></span><span class="ln"><i></i><i></i></span></div></div><div class="sk-bar"></div></div></body></html>`;
    const f = path.join(tmp, "og.html");
    fs.writeFileSync(f, html);
    await page.goto("file://" + f);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, `${locale}-${key}.jpg`), type: "jpeg", quality: 84 });
    n++;
  }
}
await browser.close();
console.log(`og:build wrote ${n} images to public/og/`);
