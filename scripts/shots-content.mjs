// npm run shots:content: screenshots for the content pass (English) at 1280 and 390: hero, loop strip, full pages, the signature demo (shopper and merchant
// views), each tab of the workspace (understand, control, find opportunities, ask Reco), the safety section, Product, Pricing, Questions (and a filtered state)
// and Data & Trust.
//   AICC_SHOTS_DIR=<dir> node scripts/shots-content.mjs   (needs the export served; AICC_BASE_URL, default http://localhost:3011)
//   AICC_SLICES=1 also writes every full-page shot as readable full-resolution slices (<name>-sNN.png, 1800px tall at 1280 wide, 2200px at 390)
import fs from "node:fs";
import path from "node:path";
import { launch, urlFor } from "./lib/browser.mjs";

const OUT = process.env.AICC_SHOTS_DIR || path.resolve("shots-content");
fs.mkdirSync(OUT, { recursive: true });
const b = await launch();
const wait = (p, ms = 400) => p.waitForTimeout(ms);
for (const [w, h] of [[1280, 900], [390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
  await ctx.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "en"); } catch {} });
  const p = await ctx.newPage();
  const SLICE = w > 600 ? 1800 : 2200;
  const hideChrome = () => p.addStyleTag({ content: ".aicc-skip{visibility:hidden!important}" });
  const shot = async (name, target) => {
    await hideChrome();
    const f = path.join(OUT, `${w}-${name}.png`);
    if (target) await target.screenshot({ path: f }); else await p.screenshot({ path: f, fullPage: true });
    console.log("wrote", path.basename(f));
    if (!target && process.env.AICC_SLICES) {
      const H = await p.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0, i = 1; y < H; y += SLICE, i++) await p.screenshot({ path: path.join(OUT, `${w}-${name}-s${String(i).padStart(2, "0")}.png`), fullPage: true, clip: { x: 0, y, width: w, height: Math.min(SLICE, H - y) } });
    }
  };
  const section = async (sel) => { const el = p.locator(sel).first(); await el.scrollIntoViewIfNeeded(); await wait(p, 500); await p.addStyleTag({ content: ".aicc-site-header,.aicc-skip{visibility:hidden!important}" }); return el; };
  const reveal = async (sels) => { for (const sel of sels) { const el = p.locator(sel).first(); if (await el.count()) { await el.scrollIntoViewIfNeeded(); await wait(p, 600); } } await p.evaluate(() => scrollTo(0, 0)); await wait(p, 300); };

  // Home
  await p.goto(urlFor("en", ""), { waitUntil: "load" }); await wait(p, 1500);
  await hideChrome();
  await p.screenshot({ path: path.join(OUT, `${w}-home-hero.png`) }); console.log("wrote", `${w}-home-hero.png`);
  await shot("home-loop-strip", await section(".aicc-loopband"));
  await reveal(["#demo", "#workspace"]);
  await shot("home-full");
  const demo = await section("#demo"); await p.waitForSelector(".aicc-fbt input[type=checkbox]");
  await shot("demo-1-without", demo);
  await p.locator(".aicc-fbt button[data-mode=with]").click(); await p.locator(".aicc-fbt input[type=checkbox]").nth(1).check(); await wait(p, 400); await shot("demo-2-with", demo);
  await p.locator(".aicc-fbt button[data-view=merchant]").click(); await wait(p, 400); await shot("demo-3-merchant", demo);
  await p.locator(".aicc-fbt select[data-rule=grinder]").selectOption("pin"); await wait(p, 300); await shot("demo-4-merchant-pinned", demo);
  const ws = await section("#workspace");
  await shot("workspace-1-understand", ws);
  await p.locator("#ws-t-control").click(); await wait(p, 700);
  const rules = p.locator("[data-aicc-rules]"); await shot("workspace-2-control", await section("#workspace"));
  await rules.locator("[data-product]").selectOption("towel"); await rules.locator("button[data-action=prefer]").click(); await rules.locator("[data-product]").selectOption("filters"); await rules.locator("button[data-action=exclude]").click(); await wait(p, 300);
  await shot("workspace-2-control-used", await section("#workspace"));
  await p.locator("#ws-t-insights").click(); await wait(p, 500); await shot("workspace-3-find-opportunities", await section("#workspace"));
  await p.locator("#ws-t-ask").click(); await wait(p, 500); await shot("workspace-4-ask-reco", await section("#workspace"));
  await shot("safety-section", await section("[aria-labelledby=safety-title]"));

  // The other pages
  for (const [name, route] of [["product", "product"], ["pricing", "pricing"], ["questions", "questions"], ["data-and-trust", "data-and-trust"]]) {
    await p.goto(urlFor("en", route), { waitUntil: "load" }); await wait(p, 600);
    await reveal(["#demo", "[data-aicc-rules]", ".aicc-ask"]);
    await shot(`${name}-full`);
  }
  await p.goto(urlFor("en", "questions") + "?q=refund", { waitUntil: "load" }); await wait(p, 800);
  await shot("questions-filtered", await section("#search"));
  await ctx.close();
}
await b.close();
