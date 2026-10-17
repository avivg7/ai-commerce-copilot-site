// npm run shots:aa: before/after screenshots of the three accessible colour treatments (primary button, headline gradient, eyebrow)
// against the live site, plus the new hero in desktop, phone, Hebrew and Enhanced contrast.
//   AICC_SHOTS_DIR=<dir> node scripts/shots-aa.mjs      (needs the export served and the live site reachable)
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { launch, urlFor } from "./lib/browser.mjs";

const OUT = process.env.AICC_SHOTS_DIR || path.resolve("shots-aa");
const LIVE = process.env.AICC_LEGACY_URL || "https://www.copilt.org/";
fs.mkdirSync(OUT, { recursive: true });
const b = await launch();
const ctxFor = async (opts = {}) => {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "en"); } catch {} });
  return ctx;
};
const open = async (url, opts) => { const ctx = await ctxFor(opts); const p = await ctx.newPage(); await p.goto(url, { waitUntil: "load" }); await p.waitForTimeout(2200); return p; };
const crop = async (p, sel, pad) => {
  const el = p.locator(sel).first(); await el.scrollIntoViewIfNeeded(); const bb = await el.boundingBox();
  const buf = await p.screenshot({ clip: { x: Math.max(0, bb.x - pad), y: Math.max(0, bb.y - pad), width: bb.width + pad * 2, height: bb.height + pad * 2 } });
  return sharp(buf).resize({ width: Math.round((bb.width + pad * 2) * 2), kernel: "lanczos3" }).png().toBuffer();
};
const stack = async (a, bimg, name) => {
  const A = await sharp(a).metadata(), B = await sharp(bimg).metadata(); const w = Math.max(A.width, B.width);
  await sharp({ create: { width: w, height: A.height + B.height + 16, channels: 3, background: "#ffffff" } }).composite([{ input: a, top: 0, left: 0 }, { input: bimg, top: A.height + 16, left: 0 }]).png().toFile(path.join(OUT, name));
  console.log("wrote", name, "(top: live copilt.org, bottom: new site)");
};
const side = async (a, bimg, name) => {
  const A = await sharp(a).metadata(), B = await sharp(bimg).metadata(); const h = Math.max(A.height, B.height);
  await sharp({ create: { width: A.width + B.width + 20, height: h, channels: 3, background: "#cbd5e1" } }).composite([{ input: a, top: 0, left: 0 }, { input: bimg, top: 0, left: A.width + 20 }]).png().toFile(path.join(OUT, name));
  console.log("wrote", name, "(left: live copilt.org, right: new site)");
};
const hover = async (p, sel) => { const bb = await p.locator(sel).first().boundingBox(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(600); };

const live = await open(LIVE), site = await open(urlFor("en", ""));
const liveHero = await live.screenshot(), siteHero = await site.screenshot();
await sharp(liveHero).toFile(path.join(OUT, "aa-site-hero-live.png")); await sharp(siteHero).toFile(path.join(OUT, "aa-site-hero-new.png"));
await side(await sharp(liveHero).resize({ width: 960 }).png().toBuffer(), await sharp(siteHero).resize({ width: 960 }).png().toBuffer(), "aa-site-hero-live-vs-new.png");
// primary button, resting and hovered (2x)
await stack(await crop(live, "#top a:first-of-type", 28), await crop(site, "main .aicc-btn--primary.aicc-btn--lg", 28), "aa-site-cta-live-vs-new-2x.png");
await hover(live, "#top a:first-of-type"); await hover(site, "main .aicc-btn--primary.aicc-btn--lg");
await stack(await crop(live, "#top a:first-of-type", 28), await crop(site, "main .aicc-btn--primary.aicc-btn--lg", 28), "aa-site-cta-hover-live-vs-new-2x.png");
await live.mouse.move(2, 2); await site.mouse.move(2, 2); await site.waitForTimeout(500);
// eyebrow (2x) and headline treatment
await stack(await crop(live, "#top span.rounded-full", 16), await crop(site, ".aicc-eyebrow-pill", 16), "aa-site-eyebrow-live-vs-new-2x.png");
await stack(await crop(live, "#top h1", 12), await crop(site, ".aicc-hero-title", 12), "aa-site-headline-live-vs-new.png");
// page, phone, Hebrew, Enhanced contrast
await site.screenshot({ path: path.join(OUT, "aa-site-home.png") });
{ const p = await open(urlFor("en", "product")); await p.screenshot({ path: path.join(OUT, "aa-site-product.png") }); console.log("wrote aa-site-product.png"); }
{ const p = await open(urlFor("en", ""), { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); await p.screenshot({ path: path.join(OUT, "aa-site-hero-mobile-390.png") }); console.log("wrote aa-site-hero-mobile-390.png"); }
{ const p = await open(urlFor("he", "")); await p.screenshot({ path: path.join(OUT, "aa-site-hero-hebrew.png") }); console.log("wrote aa-site-hero-hebrew.png"); }
{ const ctx = await ctxFor(); await ctx.addInitScript(() => localStorage.setItem("aicc_a11y", JSON.stringify({ contrast: "high" }))); const p = await ctx.newPage(); await p.goto(urlFor("en", ""), { waitUntil: "load" }); await p.waitForTimeout(2200); await p.screenshot({ path: path.join(OUT, "aa-site-hero-enhanced-contrast.png") });
  await stack(await crop(live, "#top a:first-of-type", 28), await crop(p, "main .aicc-btn--primary.aicc-btn--lg", 28), "aa-site-cta-live-vs-enhanced-2x.png"); }
await b.close();
