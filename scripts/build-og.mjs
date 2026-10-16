// npm run og:build: generates the branded Open Graph images (public/og/<locale>-<page>.jpg, 1200x630) with headless Chrome.
// Static export has no image runtime, so the images are generated once and committed. Needs a prior `npm run build`
// only for the Geist font file; otherwise falls back to the system sans-serif.
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import { loadDictionaries, ROOT } from "./lib/load.mjs";

const dicts = await loadDictionaries();
const outDir = path.join(ROOT, "public/og");
fs.mkdirSync(outDir, { recursive: true });
const tmp = path.join(ROOT, ".audit");
fs.mkdirSync(tmp, { recursive: true });

const mediaDir = path.join(ROOT, "out/_next/static/media");
const font = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir).find((f) => f.endsWith(".woff2")) : null;
const fontCss = font ? `@font-face{font-family:'OG';src:url('file://${path.join(mediaDir, font)}') format('woff2');font-weight:100 900}` : "";
const file = (p) => "file://" + path.join(ROOT, p);
const titles = (t) => ({
  home: t.home.hero.title,
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
    const html = `<!doctype html><html lang="${locale}" dir="${DIR[locale]}"><meta charset="utf-8"><style>
${fontCss}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;font-family:'OG',-apple-system,'Segoe UI','Arial Hebrew',Arial,sans-serif;color:#fff;
 background:radial-gradient(900px 500px at 100% 0%,rgba(34,211,238,.28),transparent 65%),radial-gradient(700px 500px at 0% 100%,rgba(16,185,129,.22),transparent 65%),#0b1220;
 display:grid;grid-template-columns:1fr 440px;gap:48px;padding:64px;align-items:center;overflow:hidden}
.brand{display:flex;align-items:center;gap:16px;font-weight:700;font-size:30px;letter-spacing:-.01em}
.brand img{width:56px;height:56px}
h1{font-size:${big ? 54 : 56}px;line-height:1.08;font-weight:750;letter-spacing:${DIR[locale] === "rtl" ? 0 : "-.03em"};margin-top:36px;text-wrap:balance}
p{margin-top:24px;font-size:24px;line-height:1.35;color:#cbd5e1;max-width:620px}
.card{border-radius:36px;overflow:hidden;box-shadow:0 30px 80px -20px rgba(0,0,0,.6);aspect-ratio:1/1;position:relative;background:#dbeafe}
.card img{width:100%;height:100%;object-fit:cover;object-position:42% 50%;transform:scale(1.05)}
</style><body><div><div class="brand"><img src="${file("public/brand/aicc-logomark.svg")}" alt=""><span>AI Commerce Copilot</span></div>
<h1>${title.replace(/</g, "&lt;")}</h1><p>${t.common.footer.tagline.replace(/</g, "&lt;")}</p></div>
<div class="card"><img src="${file("public/images/reco/reco-hero-960.webp")}" alt=""></div></body></html>`;
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
