// npm run shots: visual evidence. Desktop 1280 + mobile 390 of home, product, pricing, privacy, accessibility, questions,
// and the demo states (default, selected, reduced-motion, after toggle) in EN/HE/ES/RU. Needs the export served.
import fs from "node:fs";
import path from "node:path";
import { launch, urlFor, LOCALES } from "./lib/browser.mjs";

const OUT = process.env.AICC_SHOTS_DIR || path.resolve("shots");
fs.mkdirSync(OUT, { recursive: true });
const PAGES = ["", "product", "pricing", "privacy", "accessibility", "questions"];
const SIZES = [[1280, 900, "desktop"], [390, 844, "mobile"]];
const browser = await launch();
let n = 0;

async function settle(page) {
  await page.waitForTimeout(700);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 600) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(40); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
}

for (const locale of LOCALES) {
  for (const [w, h, label] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript((l) => localStorage.setItem("aicc_lang", l), locale); // no language suggestion banner in screenshots
    const page = await ctx.newPage();
    for (const route of PAGES) {
      await page.goto(urlFor(locale, route));
      await settle(page);
      await page.screenshot({ path: path.join(OUT, `${locale}-${route || "home"}-${label}.png`), fullPage: true });
      n++;
    }
    // demo states
    await page.goto(urlFor(locale, ""));
    await page.evaluate(() => document.querySelector("#demo").scrollIntoView());
    await page.waitForSelector(".aicc-demo input[type=checkbox]");
    await page.waitForTimeout(700);
    const demo = page.locator("#demo");
    await demo.screenshot({ path: path.join(OUT, `${locale}-demo-1-default-${label}.png`) }); n++;
    const boxes = page.locator(".aicc-demo input[type=checkbox]");
    await boxes.nth(2).check(); await boxes.nth(3).check(); await page.waitForTimeout(700);
    await demo.screenshot({ path: path.join(OUT, `${locale}-demo-2-selected-${label}.png`) }); n++;
    await page.locator(".aicc-demo__mode[aria-pressed=false]").click(); await page.waitForTimeout(700);
    await demo.screenshot({ path: path.join(OUT, `${locale}-demo-4-after-toggle-${label}.png`) }); n++;
    await ctx.close();
    // reduced motion
    const rctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
    await rctx.addInitScript((l) => localStorage.setItem("aicc_lang", l), locale);
    const rp = await rctx.newPage();
    await rp.goto(urlFor(locale, ""));
    await rp.evaluate(() => document.querySelector("#demo").scrollIntoView());
    await rp.waitForSelector(".aicc-demo input[type=checkbox]");
    await rp.locator(".aicc-demo input[type=checkbox]").nth(2).check();
    await rp.waitForTimeout(150);
    await rp.locator("#demo").screenshot({ path: path.join(OUT, `${locale}-demo-3-reduced-motion-${label}.png`) }); n++;
    await rctx.close();
  }
}
await browser.close();
console.log(`shots: wrote ${n} screenshots to ${OUT}`);
