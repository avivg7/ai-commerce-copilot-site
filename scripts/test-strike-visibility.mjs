// npm run test:strike-visibility (P41 final integration): WHEN the counsel-gated struck price may be VISIBLE, in real Chromium, against local exports of the STRIKE build only
// (NEXT_PUBLIC_AICC_EA_STRIKE=on, a non-production / preview build) and a local mock of GET /wp-json/aicc/v1/signup/status (nothing leaves 127.0.0.1).
//   node scripts/test-strike-visibility.mjs --strike <announce+strike dir> --strike-link <announce+strike+SS_INITIAL=link dir> --shots <dir> [--port-base <n>] [--quick]
//
// The rule (compliance memo s.7, Codex correction): the struck price is visible ONLY after a CONFIRMED status answer "open" (a valid GET .../signup/status answer open:true, mode open), before the
// browser-clock cutoff 2026-12-24T00:00:00Z. Never visible for: the static HTML first paint (before any answer), no JavaScript, status unreachable (dropped connection, 404, 500, bad JSON, unknown or
// inconsistent answer), off, paused, waitlist, closed_cutoff, and the STATIC OPEN FALLBACK of a link build (NEXT_PUBLIC_AICC_SS_INITIAL=link: the sign-up link shows, but nothing has CONFIRMED that the
// state is open). Matrix: four languages x 320 / 375 / 390 / 430 / 768 / 1024 / 1440 / 1920 px x 100 / 200 % text size (the browser's default font size). The mock answers only inside the test browser.
// Also: flips open -> paused -> open and the browser clock at the cutoff, with layout shift below 0.1.
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import { startMock } from "./lib/intake-mock.mjs";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const STRIKE = arg("strike"), LINK = arg("strike-link"), SHOTS = arg("shots"), PB = Number(arg("port-base") || 0), QUICK = args.includes("--quick");
if (!STRIKE || !LINK || !SHOTS) { console.error("usage: --strike <dir> --strike-link <dir> --shots <dir> [--port-base <n>] [--quick]"); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { failed++; console.error("  FAIL " + msg); } else console.log("  ok   " + msg); };
const LOCALES = ["en", "he", "es", "ru"];
const pre = (l) => (l === "en" ? "" : `/${l}`);
const WIDTHS = QUICK ? [320, 390, 1440] : [320, 375, 390, 430, 768, 1024, 1440, 1920];
const SCALES = QUICK ? [1, 2] : [1, 2];
const CUT = Date.UTC(2026, 11, 24, 0, 0, 0), BEFORE = Date.UTC(2026, 10, 20, 12);

const mocks = { strike: await startMock({ dir: STRIKE, port: PB }), link: await startMock({ dir: LINK, port: PB ? PB + 1 : 0 }) };
const browser = await launch();

async function open(cell, route, w, { h = 900, locale = "en", signup = "open", delay = 0, now = BEFORE, fixed = false, scale = 1, js = true, init = null, wait = "load", settle = true } = {}) {
  const m = mocks[cell];
  m.reset(); m.set({ signup, signupDelayMs: delay });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, javaScriptEnabled: js, reducedMotion: "reduce", locale: locale === "he" ? "he-IL" : locale === "es" ? "es-ES" : locale === "ru" ? "ru-RU" : "en-US" });
  if (js) {
    if (fixed) await ctx.clock.setFixedTime(new Date(now));
    else await ctx.addInitScript(({ base }) => { const real = Date.now.bind(Date); window.__skew = base - real(); Date.now = () => real() + window.__skew; }, { base: now });
    if (init) await ctx.addInitScript(init);
  }
  await ctx.route("https://www.copilt.org/**", (r) => r.fulfill({ contentType: "text/html", body: "<html><body>control plane (intercepted)</body></html>" }));
  const page = await ctx.newPage();
  if (scale !== 1 && js) { const cdp = await ctx.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * scale), fixed: Math.round(13 * scale) } }); }
  await page.goto(m.url + route, { waitUntil: wait });
  if (settle) await page.waitForTimeout(delay ? 150 : 450);
  return { ctx, page, m };
}
/** what a visitor can SEE of the strike: struck elements, any struck-through text, the strike block / disclosure, the screen-reader text; and what the default design shows */
const probe = (page) => page.evaluate(() => {
  const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" && getComputedStyle(e).display !== "none";
  const card = [...document.querySelectorAll("article.aicc-tier:not(.aicc-tier--standard)")].filter(vis);
  const within = (sel) => card.flatMap((c) => [...c.querySelectorAll(sel)]).filter(vis).length;
  return {
    cards: card.length,
    s: within("s, del"),
    line: card.flatMap((c) => [...c.querySelectorAll("*")]).filter((e) => vis(e) && getComputedStyle(e).textDecorationLine.includes("through")).length,
    strikeBlocks: within(".aicc-tier__offer--strike"),
    notes: within(".aicc-tier__offer-note"),
    sr: within(".aicc-tier__offer--strike .aicc-sr-only"),
    planned: within(".aicc-tier__offer--planned"),
    pills: within(".aicc-tier__offer-pill"),
    attr: document.documentElement.hasAttribute("data-ss-open"),
    inDom: document.querySelectorAll("main s").length,
  };
});
const none = (r) => r.s === 0 && r.line === 0 && r.strikeBlocks === 0 && r.notes === 0 && r.sr === 0 && r.attr === false;
const defaultShows = (r) => r.cards === 3 && r.planned === 3 && r.pills === 3;
const shown = (r) => r.cards === 3 && r.s === 3 && r.strikeBlocks === 3 && r.notes === 3 && r.planned === 0 && r.attr === true;
const tag = (l, w, scale, what) => `${l} @${w}px ${scale * 100}% ${what}`;

console.log("== 1. matrix: where the struck price is NOT visible, and where it is (strike preview build, /pricing/)");
for (const l of LOCALES) for (const w of WIDTHS) for (const scale of SCALES) {
  const route = `${pre(l)}/pricing/`;
  { // no JavaScript: the static HTML alone
    const { ctx, page } = await open("strike", route, w, { locale: l, scale, js: false });
    const r = await probe(page);
    check(none(r) && defaultShows(r) && r.inDom === 3, tag(l, w, scale, "NO JavaScript: static HTML shows the default planned design, no struck price, label or disclosure (the strike markup is in the HTML but hidden)"));
    await ctx.close();
  }
  { // first paint: the status answer is slow; nothing struck before it, the struck price after the confirmed open
    const { ctx, page } = await open("strike", route, w, { locale: l, scale, signup: "open", delay: 2200, wait: "domcontentloaded", settle: false });
    const before = await probe(page);
    await page.waitForTimeout(400);
    const during = await probe(page);
    await page.waitForTimeout(2600);
    const after = await probe(page);
    check(none(before) && none(during) && defaultShows(during) && shown(after), tag(l, w, scale, `static first paint and while the status answer is pending: not visible (${before.s}/${during.s}); only after the confirmed open: visible (${after.s})`));
    await ctx.close();
  }
  for (const state of ["drop", "off", "paused", "waitlist", "closed_cutoff"]) { // unreachable (dropped connection), off, paused, waitlist, closed
    const { ctx, page } = await open("strike", route, w, { locale: l, scale, signup: state });
    const r = await probe(page);
    check(none(r) && (state === "closed_cutoff" ? r.cards === 0 || r.planned === 0 : defaultShows(r)), tag(l, w, scale, `status ${state === "drop" ? "unreachable" : state}: no struck price, label or disclosure${state === "closed_cutoff" ? " (the live cards are hidden: closed view)" : "; the default planned design shows"}`));
    await ctx.close();
  }
  { // the STATIC OPEN FALLBACK: a link build shows the sign-up link before any answer, but nothing has confirmed that the state is open
    const { ctx, page } = await open("link", route, w, { locale: l, scale, signup: "drop" });
    const r = await probe(page);
    const links = await page.evaluate(() => [...document.querySelectorAll("article.aicc-tier:not(.aicc-tier--standard) [data-ss-cta]")].map((e) => e.getAttribute("data-ss-cta")));
    check(none(r) && defaultShows(r) && links.length === 3 && links.every((k) => k === "link"), tag(l, w, scale, `static open fallback (link build, status unreachable): the sign-up link shows (${links.join(",")}) but NO struck price, label or disclosure`));
    await ctx.close();
    const nj = await open("link", route, w, { locale: l, scale, js: false });
    const r2 = await probe(nj.page);
    check(none(r2) && defaultShows(r2), tag(l, w, scale, "static open fallback without JavaScript (link build): no struck price"));
    await nj.ctx.close();
  }
  { // the confirmed open answer, before the clock cutoff: visible; the same page with the clock at the cutoff: not visible
    const { ctx, page } = await open("strike", route, w, { locale: l, scale, signup: "open" });
    const r = await probe(page);
    check(shown(r), tag(l, w, scale, `confirmed open answer before the cutoff: three struck prices with their labels and disclosures (s ${r.s}, blocks ${r.strikeBlocks}, notes ${r.notes}), the planned block hidden`));
    if (w === 390 || w === 1440 || w === 320) await page.screenshot({ path: path.join(SHOTS, `open-${l}-${w}-${scale * 100}.png`), fullPage: false });
    await ctx.close();
    const c = await open("strike", route, w, { locale: l, scale, signup: "open", now: CUT, fixed: true });
    const rc = await probe(c.page);
    check(none(rc), tag(l, w, scale, "open answer but the browser clock at 2026-12-24T00:00:00Z: nothing struck is visible (closed view)"));
    await c.ctx.close();
  }
}

console.log("== 2. other failures of the status route (1440 and 390 px, four languages): never a struck price");
for (const l of LOCALES) for (const w of [390, 1440]) for (const state of ["http404", "http500", "badjson", "unknown", "inconsistent"]) {
  const { ctx, page } = await open("strike", `${pre(l)}/pricing/`, w, { locale: l, signup: state });
  const r = await probe(page);
  check(none(r) && defaultShows(r), `${l} @${w}px status answer ${state}: no struck price (default planned design)`);
  await ctx.close();
}

console.log("== 3. the Home page plan section follows the same rule (four languages x 390 / 1440)");
for (const l of LOCALES) for (const w of [390, 1440]) for (const state of ["off", "waitlist", "open"]) {
  const { ctx, page } = await open("strike", `${pre(l)}/`, w, { locale: l, signup: state });
  const r = await probe(page);
  check(state === "open" ? shown(r) : none(r) && defaultShows(r), `${l} Home @${w}px ${state}: ${state === "open" ? "struck prices visible after the confirmed open" : "default design, no struck price"}`);
  await ctx.close();
}

console.log("== 4. flips: open -> paused -> open, then the clock at the cutoff, layout shift below 0.1 (four languages x 390 / 1440)");
for (const l of LOCALES) for (const w of QUICK ? [390] : [320, 390, 1440]) {
  const CLS = () => { window.__cls = 0; new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); };
  const { ctx, page, m } = await open("strike", `${pre(l)}/pricing/`, w, { locale: l, signup: "off", delay: 400, h: 2600, init: CLS });
  const wake = async () => { await page.evaluate(() => { window.__skew += 40000; window.dispatchEvent(new Event("focus")); }); await page.waitForTimeout(900); };
  const vis = async () => (await probe(page)).s;
  const c0 = await vis();
  m.set({ signup: "open" }); await page.waitForTimeout(1200); await wake();
  const c1 = await vis(), cls1 = await page.evaluate(() => window.__cls);
  m.set({ signup: "paused" }); await wake();
  const c2 = await vis();
  m.set({ signup: "open" }); await wake();
  const c3 = await vis(), clsFlips = await page.evaluate(() => window.__cls);
  m.set({ signup: "unknown" }); await wake(); // an unconfirmable answer after an open one: the stored state falls back, the struck price goes
  const c4 = await vis();
  m.set({ signup: "open" }); await wake();
  const c5 = await vis();
  await page.evaluate((c) => { window.__skew = c - Date.now() + window.__skew + 1500; document.dispatchEvent(new Event("visibilitychange")); }, CUT);
  await page.waitForTimeout(700);
  const c6 = await vis(), closed = await page.evaluate(() => document.documentElement.hasAttribute("data-ss-closed") && !document.documentElement.hasAttribute("data-ss-open"));
  const cls = await page.evaluate(() => window.__cls);
  check(c0 === 0 && c1 === 3 && c2 === 0 && c3 === 3 && c4 === 0 && c5 === 3, `${l} @${w}px flips: off 0 -> open 3 -> paused 0 -> open 3 -> unconfirmable 0 -> open 3 (${[c0, c1, c2, c3, c4, c5].join(",")})`);
  check(c6 === 0 && closed, `${l} @${w}px: the browser clock reaching the cutoff on the same page hides it (${c6}), data-ss-closed set and data-ss-open removed`);
  check(cls1 < 0.1 && clsFlips < 0.1 && cls - clsFlips < 0.1, `${l} @${w}px: layout shift below 0.1 (off -> open ${cls1.toFixed(4)}, five state flips ${clsFlips.toFixed(4)}, the cutoff closed view alone ${(cls - clsFlips).toFixed(4)})`);
  await ctx.close();
}

console.log("== 5. the browser clock the other way: a page whose clock moves from AFTER the cutoff back to before it");
for (const l of QUICK ? ["en"] : LOCALES) {
  const { ctx, page, m } = await open("strike", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "open", now: CUT + 3600_000 });
  const a = await probe(page);
  await page.evaluate((c) => { window.__skew = c - 3600_000 - Date.now() + window.__skew; document.dispatchEvent(new Event("visibilitychange")); }, CUT);
  await m.set({ signup: "open" });
  await page.waitForTimeout(900);
  await page.evaluate(() => { window.__skew += 40000; window.dispatchEvent(new Event("focus")); }); await page.waitForTimeout(900);
  const b = await probe(page);
  // closing is STICKY by design (a registration that has closed does not reopen because a clock moved back): both outcomes are reported, only "never visible while closed" is asserted
  check(none(a), `${l}: loaded with the clock after the cutoff: nothing struck is visible`);
  console.log(`  note ${l}: clock moved back before the cutoff on the same page: struck prices visible = ${b.s} (${b.s === 0 ? "closed stays closed: sticky" : "reopened"})`);
  await ctx.close();
}

await browser.close();
for (const m of Object.values(mocks)) await m.close?.();
console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:strike-visibility (${failed})`); process.exit(1); }
console.log("PASS test:strike-visibility");
process.exit(0);
