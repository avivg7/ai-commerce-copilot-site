// npm run vitals: LCP, CLS and an INP proxy measured in headless Chrome against the served export (localhost, so no
// network latency: these are lab numbers, not field data). CPU is throttled 4x to approximate a mid-range phone.
import { launch, urlFor } from "./lib/browser.mjs";

const targets = [["en", ""], ["he", ""], ["ru", "pricing"], ["en", "product"], ["es", "questions"]];
const browser = await launch();
const rows = [];
for (const [locale, route] of targets) {
  for (const [label, vp] of [["mobile 390", { width: 390, height: 844 }], ["desktop 1280", { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.addInitScript(() => {
      window.__v = { lcp: 0, cls: 0, longTasks: 0, tbt: 0, inp: 0 };
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__v.longTasks++; window.__v.tbt += Math.max(0, e.duration - 50); } }).observe({ type: "longtask", buffered: true });
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.inp = Math.max(window.__v.inp, e.duration); }).observe({ type: "event", durationThreshold: 16, buffered: true }); } catch {}
    });
    await page.goto(urlFor(locale, route), { waitUntil: "load" });
    await page.waitForTimeout(1500);
    // interactions: menu or language, demo toggle if present
    const menu = vp.width < 1024 ? ".aicc-site-header__menu-btn" : ".aicc-lang button";
    await page.click(menu); await page.waitForTimeout(150); await page.keyboard.press("Escape");
    if (await page.$("#demo")) {
      await page.evaluate(() => document.querySelector("#demo").scrollIntoView());
      await page.waitForSelector(".aicc-fbt input[type=checkbox]", { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(400);
      const box = await page.$(".aicc-fbt input[type=checkbox]:not(:checked)");
      if (box) await box.click();
      await page.waitForTimeout(150);
      const mode = await page.$(".aicc-fbt__mode[aria-pressed=false]");
      if (mode) await mode.click();
      await page.waitForTimeout(300);
    }
    const first = await page.$("summary");
    if (first) { await first.scrollIntoViewIfNeeded(); await first.click(); await page.waitForTimeout(150); }
    await page.waitForTimeout(500);
    const v = await page.evaluate(() => window.__v);
    rows.push({ page: `${locale}/${route || "home"}`, vp: label, lcp: Math.round(v.lcp), cls: +v.cls.toFixed(4), tbt: Math.round(v.tbt), inp: Math.round(v.inp) });
    await ctx.close();
  }
}
await browser.close();
console.log("page".padEnd(20), "viewport".padEnd(14), "LCP ms".padStart(7), "CLS".padStart(8), "TBT ms".padStart(7), "INP~ ms".padStart(8));
for (const r of rows) console.log(r.page.padEnd(20), r.vp.padEnd(14), String(r.lcp).padStart(7), String(r.cls).padStart(8), String(r.tbt).padStart(7), String(r.inp).padStart(8));
const worst = (k) => Math.max(...rows.map((r) => r[k]));
console.log(`\nworst: LCP ${worst("lcp")} ms (good < 2500), CLS ${worst("cls")} (good < 0.1), INP proxy ${worst("inp")} ms (good < 200)  [4x CPU throttle, localhost]`);
process.exit(worst("cls") > 0.1 || worst("lcp") > 2500 ? 1 : 0);
