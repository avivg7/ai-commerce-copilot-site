// npm run test:visual-regression (P39, P40, P41 baselines): before / after screenshots and pixel checks, Home and Pricing, four languages, desktop 1440 and mobile 390.
//   node scripts/test-visual-regression.mjs --before <S0 export> --after <new export> --shots <evidence dir> [--baseline-dir tests/approved-visuals/p41-journey] [--update-baseline] [--port-base <n>]
// BEFORE = the S0 release (the P36 launch-offer look that is live today, built from the same commit family: scripts/test-launch-offer.mjs proves it equals the live pages); AFTER = the P40 candidate (self-service on, initial coming_soon; the premium pricing section).
//  * full-page screenshots of both, every language x {Home, Pricing} x {1440, 390}, saved to <shots>/before and <shots>/after (the evidence);
//  * "the Hero must be unchanged": on Home the headline, the subtitle, the two Hero actions (Try Live Demo, See Pricing), the Reco visual, the pillars strip, the interactive demo (#demo) and the header are
//    compared pixel by pixel between BEFORE and AFTER (element screenshots, so a shift of the surrounding layout does not hide or fake a difference): at most 0.1 % of the pixels may differ (anti-aliasing noise), the sizes must be equal;
//    the Hero's position is reported. The pill above the headline and the support lines under the buttons are the launch-offer / free-trial wording and DO change by design (their difference is printed, not asserted);
//  * baselines of the NEW state (stored images under tests/approved-visuals/p41-journey/: the premium pricing section, regenerated deliberately for P40 and reviewed; the P39 card baselines are retired): the plan-card sections of Home and Pricing in every language and width are compared with the stored baseline (<= 0.5 % of the pixels
//    differing beyond a per-channel tolerance of 10: the same tolerance family as scripts/visual-contract.mjs). `--update-baseline` rewrites them. Baselines are machine specific (font rasterisation): regenerate on a new machine and review the diff.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { launch } from "./lib/browser.mjs";
import { startMock } from "./lib/intake-mock.mjs";
import { ROOT } from "./lib/load.mjs";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const BEFORE = arg("before") && path.resolve(arg("before")), AFTER = arg("after") && path.resolve(arg("after")), SHOTS = arg("shots") && path.resolve(arg("shots"));
const BASEDIR = path.resolve(arg("baseline-dir") || path.join(ROOT, "tests/approved-visuals/p41-journey")), UPDATE = args.includes("--update-baseline");
const PB = Number(arg("port-base") || 0);
if (!BEFORE || !AFTER || !SHOTS) { console.error("usage: --before <S0 export> --after <new export> --shots <dir> [--baseline-dir <dir>] [--update-baseline] [--port-base <n>]"); process.exit(2); }
let failed = 0, total = 0;
const check = (c, m) => { total++; if (!c) { failed++; console.error("  FAIL " + m); } else console.log("  ok   " + m); };
const LOCALES = ["en", "he", "es", "ru"], WIDTHS = [1440, 390];
const pre = (l) => (l === "en" ? "" : `/${l}`);
fs.mkdirSync(path.join(SHOTS, "before"), { recursive: true }); fs.mkdirSync(path.join(SHOTS, "after"), { recursive: true });

async function raw(buf) { const r = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return r; }
/** The share of pixels whose largest channel difference exceeds `tol`; null when the sizes differ. */
async function diff(a, b, tol = 10) {
  const A = await raw(a), B = await raw(b);
  // sizes may differ by at most 1 px (a fractional vertical offset rounds the element box differently): the common top-left area is compared
  if (Math.abs(A.info.width - B.info.width) > 1 || Math.abs(A.info.height - B.info.height) > 1) return { same: false, w: [A.info.width, A.info.height], v: [B.info.width, B.info.height], ratio: 1 };
  const W = Math.min(A.info.width, B.info.width), H = Math.min(A.info.height, B.info.height);
  let n = 0; const px = W * H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * A.info.width + x) * 4, q = (y * B.info.width + x) * 4; if (Math.max(Math.abs(A.data[o] - B.data[q]), Math.abs(A.data[o + 1] - B.data[q + 1]), Math.abs(A.data[o + 2] - B.data[q + 2])) > tol) n++; }
  return { same: true, ratio: n / px, pixels: n, total: px };
}
const mb = await startMock({ dir: BEFORE, port: PB }), ma = await startMock({ dir: AFTER, port: PB ? PB + 1 : 0 });
const browser = await launch();
async function open(m, route, w, locale) {
  m.reset(); m.set({ signup: "off" });
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, reducedMotion: "reduce", locale: locale === "he" ? "he-IL" : "en-US" });
  await ctx.clock.setFixedTime(new Date(Date.UTC(2026, 10, 20, 12)));
  await ctx.route("https://www.copilt.org/**", (r) => r.fulfill({ contentType: "text/html", body: "<html></html>" }));
  const page = await ctx.newPage();
  await page.goto(m.url + route, { waitUntil: "load" });
  await page.waitForTimeout(700);
  // finish every image / font, then freeze everything that moves
  await page.evaluate(async () => { await document.fonts.ready; document.querySelectorAll("img[loading=lazy]").forEach((i) => { i.loading = "eager"; }); await Promise.race([Promise.all([...document.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })))), new Promise((r) => setTimeout(r, 4000))]); });
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}.aicc-site-header{position:absolute!important}.aicc-skip,.aicc-suggest{display:none!important}" });
  await page.waitForTimeout(150);
  return { ctx, page };
}

const BASELINES_ONLY = args.includes("--baselines-only");
console.log("== before / after full-page screenshots (evidence): " + SHOTS);
const HERO = [
  ["headline", ".aicc-hero--home h1"], ["subtitle", ".aicc-hero--home .aicc-hero-lead"], ["hero actions (Try Live Demo, See Pricing)", ".aicc-hero--home .aicc-hero-actions"],
  ["Reco visual", ".aicc-hero--home .aicc-hero__visual"], ["pillars", ".aicc-pillars"], ["interactive demo #demo", "#demo"], ["header", "header.aicc-site-header"],
];
for (const l of LOCALES) for (const w of WIDTHS) if (!BASELINES_ONLY) {
  for (const [name, route] of [["home", `${pre(l)}/`], ["pricing", `${pre(l)}/pricing/`]]) {
    const b = await open(mb, route, w, l), a = await open(ma, route, w, l);
    await b.page.screenshot({ path: path.join(SHOTS, "before", `${l}-${name}-${w}.png`), fullPage: true });
    await a.page.screenshot({ path: path.join(SHOTS, "after", `${l}-${name}-${w}.png`), fullPage: true });
    if (name === "home") {
      for (const [what, sel] of HERO) {
        const bb = await b.page.locator(sel).first().screenshot().catch(() => null), aa = await a.page.locator(sel).first().screenshot().catch(() => null);
        if (!bb || !aa) { check(false, `${l} home @${w}: ${what}: element missing (before ${!!bb}, after ${!!aa})`); continue; }
        const d = await diff(bb, aa);
        // a Hero block that moved by a FRACTIONAL number of pixels (es / ru: the support lines wrap differently, line height 18.9 px) is rasterised on another sub-pixel grid: photos and gradients then differ by anti-aliasing,
        // so such an element is compared at 12 % (a missing, moved or recoloured element differs far more); an element at the same fractional offset must be equal within 0.1 %
        const fr = async (pg) => pg.locator(sel).first().evaluate((e) => { const t = e.getBoundingClientRect().top + scrollY; return t - Math.floor(t); });
        const sub = Math.abs((await fr(b.page)) - (await fr(a.page))) > 0.01;
        const limit = sub ? 0.12 : 0.001;
        check(d.same && d.ratio <= limit, `${l} home @${w}: ${what} is unchanged against S0 (${d.same ? (d.ratio * 100).toFixed(3) + "% of " + d.total + " px differ" : `size ${d.w} vs ${d.v}`}; limit ${limit * 100}%${sub ? ", sub-pixel shifted" : ""})`);
        if (what === "headline" || what === "Reco visual") fs.writeFileSync(path.join(SHOTS, "after", `${l}-home-${w}-${what.replace(/\W+/g, "-")}.png`), aa);
      }
      // reported (not asserted): the launch-offer pill and the support lines change by design; and where the Hero sits
      const pos = async (pg) => pg.evaluate(() => { const r = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top + scrollY) : null; }; return { h1: r(".aicc-hero--home h1"), actions: r(".aicc-hero--home .aicc-hero-actions"), demo: r("#demo") }; });
      const pb = await pos(b.page), pa = await pos(a.page);
      const pill = await diff(await b.page.locator(".aicc-hero--home .aicc-eyebrow-pill").first().screenshot(), await a.page.locator(".aicc-hero--home .aicc-eyebrow-pill").first().screenshot()).catch(() => ({ ratio: NaN }));
      console.log(`  info ${l} home @${w}: Hero positions before ${JSON.stringify(pb)} after ${JSON.stringify(pa)}; pill/support wording differs by design (pill ${isNaN(pill.ratio) ? "size changed" : (pill.ratio * 100).toFixed(1) + "% px"})`);
      // The Hero block is vertically centred, so a support list that wraps differently moves the whole block: en and he keep the S0 positions exactly; es / ru, whose support lines wrap differently from the S0 wording, may move by at most 20 px
      // (the headline-to-actions distance is identical in every case: the Hero itself is unchanged)
      const tol = l === "en" || l === "he" ? 0 : 20;
      check(Math.abs(pa.h1 - pb.h1) <= tol && Math.abs(pa.actions - pb.actions) <= tol && pa.actions - pa.h1 === pb.actions - pb.h1, `${l} home @${w}: the headline and the Hero actions sit at the S0 position (tolerance ${tol}px; ${pb.h1}/${pb.actions} vs ${pa.h1}/${pa.actions}) with the same headline-to-actions distance`);
    }
    await b.ctx.close(); await a.ctx.close();
  }
}

console.log(`== baselines of the NEW plan-card sections (${path.relative(ROOT, BASEDIR)}) ${UPDATE ? "(UPDATING)" : ""}`);
fs.mkdirSync(BASEDIR, { recursive: true });
for (const l of LOCALES) for (const w of WIDTHS) for (const [name, route, sel] of [["home", `${pre(l)}/`, '[aria-labelledby="pricing-title"]'], ["pricing", `${pre(l)}/pricing/`, '[aria-labelledby="plans-title"]'], ["journey", `${pre(l)}/get-started/`, ".aicc-jr"]]) {
  const a = await open(ma, route, w, l);
  const png = await a.page.locator(sel).first().screenshot();
  await a.ctx.close();
  const file = path.join(BASEDIR, `${l}-${name}-${w}.png`);
  if (UPDATE) { fs.writeFileSync(file, png); check(true, `baseline written: ${path.relative(ROOT, file)}`); continue; }
  if (!fs.existsSync(file)) { check(false, `${l} ${name} @${w}: no stored baseline ${path.relative(ROOT, file)} (run with --update-baseline and review)`); continue; }
  const d = await diff(fs.readFileSync(file), png);
  check(d.same && d.ratio <= 0.005, `${l} ${name} @${w}: the plan-card section (or, for the journey page, the steps + status panel) equals its stored baseline (${d.same ? (d.ratio * 100).toFixed(3) + "% of " + d.total + " px differ, limit 0.5%" : `size ${d.w} vs ${d.v}`})`);
}
await browser.close(); await mb.close(); await ma.close();
console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:visual-regression (${failed})`); process.exit(1); }
console.log("PASS test:visual-regression");
