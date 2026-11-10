// npm run shots:brand: the owner visual-correction screenshots (site side). Needs the export served (npm run serve:out) and the live site reachable.
//   AICC_SHOTS_DIR=<dir> node scripts/shots-brand.mjs
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { launch, urlFor } from "./lib/browser.mjs";

const OUT = process.env.AICC_SHOTS_DIR || path.resolve("shots-brand");
const LIVE = process.env.AICC_LEGACY_URL || "https://www.copilt.org/";
fs.mkdirSync(OUT, { recursive: true });
const b = await launch();
const ctxFor = async (opts = {}) => {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "en"); } catch {} });
  return ctx;
};
const shot = async (page, name, opts = {}) => { await page.screenshot({ path: path.join(OUT, name), ...opts }); console.log("wrote", name); };

// 1 live hero
{ const ctx = await ctxFor(); const p = await ctx.newPage(); await p.goto(LIVE, { waitUntil: "load" }); await p.waitForTimeout(2500); await shot(p, "01-live-hero.png"); 
  const liveBtn = await p.$("#top a"); const bb = await liveBtn.boundingBox(); await sharp(await p.screenshot({ clip: { x: bb.x - 24, y: bb.y - 20, width: 440, height: bb.height + 50 } })).resize({ width: 880 }).toFile(path.join(OUT, "_live-buttons.png")); await ctx.close(); }
// 2 new site hero + scrolled + reduced motion
{ const ctx = await ctxFor(); const p = await ctx.newPage(); await p.goto(urlFor("en", ""), { waitUntil: "load" }); await p.waitForTimeout(2500); await shot(p, "02-site-hero.png");
  const btn = await p.$("main .aicc-btn--primary.aicc-btn--lg"); const bb = await btn.boundingBox(); await sharp(await p.screenshot({ clip: { x: bb.x - 24, y: bb.y - 20, width: 440, height: bb.height + 50 } })).resize({ width: 880 }).toFile(path.join(OUT, "_site-buttons.png"));
  await p.evaluate(() => scrollTo(0, 60)); await p.waitForTimeout(700); await shot(p, "09-header-scrolled.png", { clip: { x: 0, y: 0, width: 1440, height: 260 } }); await ctx.close(); }
{ const ctx = await ctxFor({ reducedMotion: "reduce" }); const p = await ctx.newPage(); await p.goto(urlFor("en", ""), { waitUntil: "load" }); await p.waitForTimeout(2000); await shot(p, "10-reduced-motion-hero.png"); 
  console.log("reduced-motion: video paused =", await p.evaluate(() => document.querySelector(".aicc-reco-hero__video").paused)); await ctx.close(); }
// 3 buttons side by side
{ const a = await sharp(path.join(OUT, "_live-buttons.png")).metadata(); const bm = await sharp(path.join(OUT, "_site-buttons.png")).metadata();
  const w = Math.max(a.width, bm.width);
  await sharp({ create: { width: w, height: a.height + bm.height + 24, channels: 4, background: "#ffffff" } }).composite([{ input: path.join(OUT, "_live-buttons.png"), top: 0, left: 0 }, { input: path.join(OUT, "_site-buttons.png"), top: a.height + 24, left: 0 }]).png().toFile(path.join(OUT, "03-buttons-live-above-site-below-2x.png")); console.log("wrote 03"); }
// 4 language dropdown en + he
for (const loc of ["en", "he"]) { const ctx = await ctxFor(); const p = await ctx.newPage(); await p.goto(urlFor(loc, ""), { waitUntil: "load" }); await p.waitForTimeout(1200); await p.click(".aicc-site-header__actions .aicc-lang__btn"); await p.waitForTimeout(300); await shot(p, `04-language-dropdown-${loc}.png`, { clip: { x: 0, y: 0, width: 1440, height: 320 } }); await ctx.close(); }
// 5 modal
{ const ctx = await ctxFor(); const p = await ctx.newPage(); await p.goto(urlFor("en", "product"), { waitUntil: "load" }); await p.waitForTimeout(1200); await p.click("[data-aicc-demo-trigger]"); await p.waitForSelector("dialog.aicc-modal[open]"); await p.waitForTimeout(500); await shot(p, "05-watch-demo-modal-placeholder.png"); await ctx.close(); }
// 6 mobile product hero, 7 mobile FBT, 8 hebrew product
{ const ctx = await ctxFor({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); await p.goto(urlFor("en", "product"), { waitUntil: "load" }); await p.waitForTimeout(1200); await shot(p, "06-mobile-product-hero.png");
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView()); await p.waitForSelector(".aicc-fbt input[type=checkbox]"); await p.waitForTimeout(700); await p.addStyleTag({ content: ".aicc-site-header,.aicc-skip{visibility:hidden!important}" }); await (await p.$("#demo")).screenshot({ path: path.join(OUT, "07-mobile-fbt.png") }); console.log("wrote 07");
  await p.locator(".aicc-fbt__mode[data-mode=with]").click(); await p.locator(".aicc-fbt input[type=checkbox]").nth(2).check(); await p.waitForTimeout(700); await (await p.$("#demo")).screenshot({ path: path.join(OUT, "07b-mobile-fbt-with-aicc.png") }); await ctx.close(); }
{ const ctx = await ctxFor(); const p = await ctx.newPage(); await p.addInitScript(() => { try { localStorage.setItem("aicc_lang", "he"); } catch {} }); await p.goto(urlFor("he", "product"), { waitUntil: "load" }); await p.waitForTimeout(1500); await shot(p, "08-hebrew-product-hero.png");
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView()); await p.waitForSelector(".aicc-fbt input[type=checkbox]"); await p.locator(".aicc-fbt__mode[data-mode=with]").click(); await p.locator(".aicc-fbt input[type=checkbox]").nth(1).check(); await p.waitForTimeout(800); await shot(p, "08b-hebrew-fbt.png"); await ctx.close(); }
// FBT desktop states (site)
{ const ctx = await ctxFor(); const p = await ctx.newPage(); await p.goto(urlFor("en", ""), { waitUntil: "load" }); await p.evaluate(() => document.querySelector("#demo").scrollIntoView()); await p.waitForSelector(".aicc-fbt input[type=checkbox]"); await p.addStyleTag({ content: ".aicc-site-header,.aicc-skip{visibility:hidden!important}" }); await p.waitForTimeout(600);
  const el = await p.$("#demo"); await el.screenshot({ path: path.join(OUT, "11-fbt-default.png") });
  await p.locator(".aicc-fbt__mode[data-mode=with]").click(); await p.locator(".aicc-fbt input[type=checkbox]").nth(1).check(); await p.locator(".aicc-fbt input[type=checkbox]").nth(2).check(); await p.waitForTimeout(800); await el.screenshot({ path: path.join(OUT, "12-fbt-selected-with-aicc.png")}); await ctx.close(); }
for (const f of fs.readdirSync(OUT)) if (f.startsWith("_")) fs.unlinkSync(path.join(OUT, f));
await b.close();
