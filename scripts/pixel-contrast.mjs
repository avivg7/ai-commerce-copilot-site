// npm run contrast:pixels [-- --quick]: text contrast measured from the pixels the browser really paints (adapted from the independent accessibility review).
// For each page state: record every visible text run with its computed colour, hide all text, screenshot, sample the real background behind each text box,
// composite alpha and ancestor opacity, apply the large-text rule (>= 24px, or >= 18.66px bold). Fails below 4.5:1 (3:1 for large text).
// Clip-text gradient headings and fixed overlays are measured separately (visual-contract.mjs). Needs the export served at AICC_BASE_URL.
import { launch, urlFor } from "./lib/browser.mjs";

const QUICK = process.argv.includes("--quick");
const CONFIGS = [];
for (const route of ["", "product", "pricing", "questions", "data-and-trust"]) {
  CONFIGS.push({ locale: "en", route, width: 1280, mode: "default", state: "open" });
  CONFIGS.push({ locale: "en", route, width: 390, mode: "default", state: "open" });
  if (!QUICK) CONFIGS.push({ locale: "en", route, width: 1280, mode: "enhanced", state: "open" });
}
for (const t of ["ws-t-control", "ws-t-insights", "ws-t-ask"]) CONFIGS.push({ locale: "en", route: "", width: 1280, mode: "default", state: `tab:${t}` });
CONFIGS.push({ locale: "en", route: "", width: 1280, mode: "default", state: "merchant" });
CONFIGS.push({ locale: "en", route: "", width: 1280, mode: "default", state: "plain" });
if (!QUICK) for (const locale of ["he", "es", "ru"]) for (const route of ["", "pricing", "questions"]) CONFIGS.push({ locale, route, width: 1280, mode: "default", state: "open" });

const browser = await launch();
let total = 0, failed = 0;
for (const c of CONFIGS) {
  const ctx = await browser.newContext({ viewport: { width: c.width, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  if (c.mode === "enhanced") await ctx.addInitScript(() => localStorage.setItem("aicc_a11y", JSON.stringify({ contrast: "high" })));
  await page.goto(urlFor(c.locale, c.route), { waitUntil: "load" });
  await page.waitForTimeout(500);
  const h0 = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h0; y += 500) { await page.evaluate((v) => scrollTo(0, v), y); await page.waitForTimeout(70); }
  await page.waitForTimeout(500);
  await page.evaluate(() => { document.querySelector(".aicc-suggest button")?.click(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.activeElement?.blur()); // dismissing moves focus to the skip link, which would cover the logo // the fixed language suggestion would be captured in the wrong place by full-page screenshots
  await page.evaluate(({ state }) => {
    if (state === "open") document.querySelectorAll("details").forEach((d) => (d.open = true));
    if (state === "merchant") { document.querySelector('button[data-view="merchant"]')?.click(); document.querySelectorAll("details").forEach((d) => (d.open = true)); }
    if (state === "plain") document.querySelector('button[data-mode="without"]')?.click();
    if (state.startsWith("tab:")) document.getElementById(state.slice(4))?.click();
  }, { state: c.state });
  await page.waitForTimeout(500);
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(200);
  const items = await page.evaluate(() => {
    const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const pf = (col) => { const m = col.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
    let n, id = 0;
    window.__ranges = [];
    while ((n = w.nextNode())) {
      const t = n.textContent.replace(/\s+/g, " ").trim(); if (!t) continue;
      const p = n.parentElement; if (!p || p.closest("script,style,noscript,svg,option")) continue;
      const cs = getComputedStyle(p);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const det = p.closest("details"); if (det && !det.open && !p.closest("summary")) continue; // a closed answer keeps its layout box but paints nothing: it is not text a visitor can read
      let hidden = false, fixed = false, op = 1;
      for (let e = p; e && e !== document.documentElement; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || e.hidden) { hidden = true; break; } if (s.position === "fixed") fixed = true; op *= parseFloat(s.opacity); if (e.matches?.(".aicc-sr-only") || (s.position === "absolute" && parseFloat(s.width) <= 1 && parseFloat(s.height) <= 1)) { hidden = true; break; } }
      if (hidden) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      if (!rects.length) continue;
      const fill = cs.webkitTextFillColor && cs.webkitTextFillColor !== "rgba(0, 0, 0, 0)" ? cs.webkitTextFillColor : cs.color;
      const clipText = cs.webkitBackgroundClip === "text" || cs.backgroundClip === "text";
      const fs = parseFloat(cs.fontSize), fw = parseInt(cs.fontWeight) || 400;
      window.__ranges.push(range);
      out.push({ rangeIdx: window.__ranges.length - 1, id: id++, t: t.slice(0, 50), tag: p.tagName.toLowerCase(), cls: (p.className || "").toString().slice(0, 40), fg: pf(clipText ? "rgba(0,0,0,0)" : fill), op, fixed, clipText, fs, large: fs >= 24 || (fs >= 18.66 && fw >= 700), top: rects[0].top + scrollY });
    }
    return out;
  });
  await page.addStyleTag({ content: "*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;text-decoration-color:transparent!important} svg{visibility:hidden!important} ::placeholder{color:transparent!important}" });
  await page.waitForTimeout(300);
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  const rects2 = await page.evaluate(() => window.__ranges.map((r) => [...r.getClientRects()].filter((q) => q.width > 1 && q.height > 1).map((q) => [q.left + scrollX, q.top + scrollY, q.width, q.height])));
  const shots = [];
  for (let y = 0; y < H; y += 6000) shots.push({ y, buf: (await page.screenshot({ fullPage: true, clip: { x: 0, y, width: c.width, height: Math.min(6000, H - y) }, animations: "disabled" })).toString("base64") });
  const pg = await ctx.newPage(); await pg.setContent("<canvas id=c></canvas>");
  const results = await pg.evaluate(async ({ shots, items, rects2, W, H }) => {
    const cv = document.getElementById("c"); cv.width = W; cv.height = H; const g = cv.getContext("2d", { willReadFrequently: true });
    for (const sh of shots) { const bm = await createImageBitmap(await (await fetch("data:image/png;base64," + sh.buf)).blob()); g.drawImage(bm, 0, sh.y); }
    const lum = ([r, gc, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(gc) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const res = [];
    for (const it of items) {
      if (!it.fg) continue;
      let worst = 99, samples = 0;
      for (const [x, y, w, h] of rects2[it.rangeIdx]) {
        const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y)), x1 = Math.min(W, Math.ceil(x + w)), y1 = Math.min(H, Math.ceil(y + h));
        if (x1 <= x0 || y1 <= y0) continue;
        const data = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        const sx = Math.max(1, Math.floor((x1 - x0) / 40)), sy = Math.max(1, Math.floor((y1 - y0) / 6));
        for (let yy = 0; yy < y1 - y0; yy += sy) for (let xx = 0; xx < x1 - x0; xx += sx) {
          const i = (yy * (x1 - x0) + xx) * 4; const bg = [data[i], data[i + 1], data[i + 2]];
          const a = it.fg.a * it.op; const fg = [it.fg.r * a + bg[0] * (1 - a), it.fg.g * a + bg[1] * (1 - a), it.fg.b * a + bg[2] * (1 - a)];
          const r = ratio(fg, bg); samples++; if (r < worst) worst = r;
        }
      }
      if (samples) res.push({ t: it.t, tag: it.tag, cls: it.cls, ratio: +worst.toFixed(2), large: it.large, fs: it.fs });
    }
    return res;
  }, { shots, rects2, W: c.width, H, items: items.filter((i) => !i.clipText && (!i.fixed || i.top < 200)) });
  const bad = results.filter((r) => r.ratio < (r.large ? 3 : 4.5));
  total += results.length; failed += bad.length;
  console.log(`${bad.length ? "FAIL" : "PASS"}  ${c.locale}/${c.route || "home"} @${c.width} ${c.mode} ${c.state}: ${results.length} text runs, ${bad.length} below threshold`);
  const seen = new Set();
  for (const r of bad.sort((a, b) => a.ratio - b.ratio)) { const k = r.cls + r.t; if (seen.has(k)) continue; seen.add(k); console.log(`    ${r.ratio} (need ${r.large ? 3 : 4.5}) "${r.t}" <${r.tag}.${r.cls}> ${r.fs}px`); if (seen.size > 12) break; }
  await ctx.close();
}
await browser.close();
console.log(`\ncontrast:pixels  ${CONFIGS.length} page states, ${total} text runs measured, ${failed} below threshold`);
if (failed) process.exit(1);
console.log("PASS: every measured text run meets WCAG 2.2 AA contrast against the pixels actually painted");
