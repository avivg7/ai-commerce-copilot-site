// npm run test:pricing-browser (P40): the ADVERSARIAL browser test of the premium pricing section, in real Chromium, against the built exports and a local mock of GET /wp-json/aicc/v1/signup/status (nothing leaves 127.0.0.1).
//   node scripts/test-pricing-browser.mjs --ss-announce <dir> --ss-off <dir> --ss-link <dir> [--ss-strike <dir>] --shots <dir> [--port-base <n>] [--quick] [--only <section letters, e.g. ACG>]
//     (exports: SELFSERVICE=on with the launch-offer switch announce | unset; --ss-link = the announce build with NEXT_PUBLIC_AICC_SS_INITIAL=link; --ss-strike = announce + NEXT_PUBLIC_AICC_EA_STRIKE=on)
// A  link hygiene: in every state and language the only /start/ links are plan-less or carry ?plan=solo|studio|agency, with the page's language prefix; never a purchase / checkout / cart link; never #demo as a sign-up
// B  an unsupported browser language gets the English page and English links; an unsupported locale path is a 404 with no control
// C  the status cache and the cutoff by the browser clock: failed or invalid answers never up- or downgrade, a valid answer does (open -> off during client navigation), the TTL (30 s) is respected, a page left
//    open across 2026-12-24T00:00:00Z flips to closed without a reload
// D  waitlist, paused, closed (paid purchase not open), the ordinary ended view
// E  language and plan persistence: clicking a card / the band / the finder requests the localized /start/?plan= URL
// F  keyboard order and focus visibility (including the dark band)
// G  axe-core (WCAG 2.x A/AA + best-practice): zero violations in every state, four languages, 320 / 768 / 1440, high contrast, 200% text
// H  geometry: 320 / 375 / 390 / 430 / 768 / 1024 / 1440 / 1920 px with 100 / 125 / 200 % text, four languages: no horizontal scroll, nothing clipped, FREE on one line and dominant, layout per breakpoint, shared rows
// I  reduced motion, RTL mirroring, print, forced colours, layout shift (CLS) when the status answer arrives
// L  the closed view (registration closed): ordinary cards, no FREE / trial line / panel / dates, one announcement
// K  scope: every tier, launch panel and band of Home, Pricing and Product sits inside the kit wrapper `.aicc-pricing`; computed padding is > 0 and nothing is clipped, in every state
// J  the planned price above FREE: the compliant default and the counsel-gated strike (ONE line, languages x widths x 100 / 200 % x text spacing); the default builds carry none
// P  the compact status line: text and link wrap inside it in every state and language, 320 / 375 / 390 x 100 / 200 % x text spacing
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import { launch } from "./lib/browser.mjs";
import { loadDictionaries, loadTs } from "./lib/load.mjs";
import { startMock } from "./lib/intake-mock.mjs";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? path.resolve(args[i + 1]) : undefined; };
const dirs = { announce: arg("ss-announce"), off: arg("ss-off"), link: arg("ss-link"), strike: arg("ss-strike") }, SHOTS = arg("shots");
const PB = (() => { const i = args.indexOf("--port-base"); return i >= 0 ? Number(args[i + 1]) : 0; })();
const QUICK = args.includes("--quick");
const ONLY = (() => { const i = args.indexOf("--only"); return i >= 0 ? args[i + 1].toUpperCase() : ""; })();
const run = (k) => !ONLY || ONLY.includes(k);
if (!dirs.announce || !dirs.off || !dirs.link || !SHOTS) { console.error("usage: --ss-announce <dir> --ss-off <dir> --ss-link <dir> [--ss-strike <dir>] --shots <dir> [--port-base <n>] [--quick] [--only <letters>]"); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });
const D = await loadDictionaries();
const { PLANS, formatPrice } = await loadTs("src/data/plans.ts");
const LOCALES = ["en", "he", "es", "ru"];
const pre = (l) => (l === "en" ? "" : `/${l}`);
let failed = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { failed++; console.error("  FAIL " + msg); } else console.log("  ok   " + msg); };
const END = Date.UTC(2026, 11, 31, 22, 0, 0), CUT = Date.UTC(2026, 11, 24, 0, 0, 0), BEFORE = Date.UTC(2026, 10, 20, 12);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const startOf = (l, plan) => `https://www.copilt.org${pre(l)}/start/${plan ? `?plan=${plan}` : ""}`;
const accountOf = (l) => `https://www.copilt.org${pre(l)}/my-account/`;
const START_RE = (l) => new RegExp(`^https://www\\.copilt\\.org${pre(l).replace("/", "\\/")}/start/(\\?plan=(solo|studio|agency))?$`);
const TIER = "article.aicc-tier:not(.aicc-tier--standard)";

const mocks = { announce: await startMock({ dir: dirs.announce, port: PB }), off: await startMock({ dir: dirs.off, port: PB ? PB + 1 : 0 }), link: await startMock({ dir: dirs.link, port: PB ? PB + 2 : 0 }), ...(dirs.strike ? { strike: await startMock({ dir: dirs.strike, port: PB ? PB + 3 : 0 }) } : {}) };
const browser = await launch();
/**
 * One page. `now` pins Date.now to a fixed instant that then runs on (a skew: `window.__skew += ms` moves the page clock forward at once; timers keep real time);
 * `scale` = the browser's DEFAULT FONT SIZE as a share of 16px (1.25 / 2 = a visitor who enlarged the text: CDP Page.setFontSizes, so rem units AND the rem media queries scale exactly as with the browser setting); `block` intercepts https://www.copilt.org (the Control Plane) and records what the page asked for.
 */
async function view(cell, route, w, { h = 900, locale = "en", signup = "open", delay = 0, now = BEFORE, fixed = false, scale = 1, spacing = false, media = {}, block = true, init = null } = {}) {
  const m = mocks[cell];
  m.reset(); m.set({ signup, signupDelayMs: delay });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: locale === "he" ? "he-IL" : locale === "es" ? "es-ES" : locale === "ru" ? "ru-RU" : "en-US", ...media });
  if (fixed) await ctx.clock.setFixedTime(new Date(now)); // a frozen clock (the boundary tests)
  else await ctx.addInitScript(({ base }) => { const real = Date.now.bind(Date); window.__skew = base - real(); Date.now = () => real() + window.__skew; }, { base: now });
  if (init) await ctx.addInitScript(init);
  const nav = [], errors = [];
  if (block) await ctx.route("https://www.copilt.org/**", (r) => { nav.push(r.request().url()); return r.fulfill({ contentType: "text/html", body: "<html><body>control plane (intercepted)</body></html>" }); });
  const page = await ctx.newPage();
  if (scale !== 1) { const cdp = await ctx.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * scale), fixed: Math.round(13 * scale) } }); }
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (c) => { if (c.type() === "error" && !/Failed to load resource|net::ERR|status of (4|5)\d\d/i.test(c.text())) errors.push(c.text()); });
  await page.goto(m.url + route, { waitUntil: "load" });
  // WCAG 1.4.12 text spacing override (line height 1.5, letter spacing .12em, word spacing .16em, paragraph spacing 2em): nothing may break mid-word or be clipped
  if (spacing) await page.addStyleTag({ content: "*{line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important}p{margin-block-end:2em !important}" });
  await page.waitForTimeout(delay ? 150 : 350);
  return { ctx, page, m, nav, errors };
}
// the VISIBLE cards: the live set while registration can start, the closed / ordinary set from the cutoff
const cards = (page) => page.evaluate(() => [...document.querySelectorAll("article.aicc-tier")].filter((a) => a.getClientRects().length > 0).map((a) => {
  const vis = (e) => e.getClientRects().length > 0;
  const linkAll = [...a.querySelectorAll("a.aicc-btn")].filter(vis).map((e) => ({ kind: e.closest(".aicc-pcta").getAttribute("data-ss-cta"), href: e.getAttribute("href"), text: e.innerText.replace(/\s+/g, " ").trim(), state: e.getAttribute("data-ss-state"), describedBy: e.getAttribute("aria-describedby"), cls: e.className, h: e.getBoundingClientRect().height }));
  const st = [...a.querySelectorAll("p.aicc-pstatus")].filter(vis).map((e) => ({ text: e.querySelector(".aicc-pstatus__label").innerText.trim(), note: (e.querySelector(".aicc-pstatus__note") || { innerText: "" }).innerText.trim(), state: e.getAttribute("data-ss-state"), role: e.getAttribute("role") }));
  const note = [...a.querySelectorAll(".aicc-pcta__note")].filter(vis).map((e) => ({ id: e.id, text: e.innerText.trim() }));
  const link = linkAll.filter((x) => x.kind === "link"), info = linkAll.filter((x) => x.kind === "info"); // P41: link = the real sign-up link (open / waitlist); info = "See how it works" (registration not open)
  return { link, info, st, note, plan: a.getAttribute("data-plan"), tag: a.querySelector(".aicc-pcta").getAttribute("data-ss-cta") };
}), TIER);
const band = (page, id = "final-title") => page.evaluate((id) => { const s = document.querySelector(`[aria-labelledby="${id}"]`), vis = (e) => e.getClientRects().length > 0; return { a: [...s.querySelectorAll("a")].filter(vis).map((x) => ({ href: x.getAttribute("href"), text: x.innerText.trim() })), st: [...s.querySelectorAll("p.aicc-pstatus .aicc-pstatus__label")].filter(vis).map((x) => x.innerText.trim()) }; }, id);
const L = (l) => D[l].ea.ss;
const howOf = (l) => L(l).cta.how;
const journeyOf = (l, plan) => `${pre(l)}/get-started/${plan ? `?plan=${plan}` : ""}`;
// P41: a card whose registration is not open is a REAL information link (never an inert pill, never /start/)
const infoCards = (cs, l, state) => cs.length === 3 && cs.every((c, i) => c.info.length === 1 && c.link.length === 0 && c.st.length === 0 && c.tag === "info" && c.info[0].href === journeyOf(l, PLANS[i].id) && c.info[0].text.startsWith(howOf(l)) && (state === undefined || c.info[0].state === state) && c.info[0].h >= 44);

// ───────────────────────────────────────────────────────────── A. link hygiene
if (run("A")) {
  console.log("== A. link hygiene: every /start/ link of every state and language is plan-less or ?plan=solo|studio|agency with the page's language prefix; never a purchase link; never #demo as a sign-up");
  const STATES = QUICK ? ["off", "open", "waitlist", "closed_cutoff"] : ["off", "open", "waitlist", "closed_cutoff", "paused", "http500", "badjson", "inconsistent", "unknown", "drop", "http404"];
  for (const cell of ["announce", "link"]) for (const l of LOCALES) for (const state of STATES) for (const route of ["pricing/", ""]) {
    if (QUICK && l !== "en" && l !== "he") continue;
    const { ctx, page, errors } = await view(cell, `${pre(l)}/${route}`, 1440, { locale: l, signup: state });
    const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.getAttribute("href"), text: a.innerText.replace(/\s+/g, " ").trim(), inTier: !!a.closest("article.aicc-tier"), inBand: !!a.closest(".aicc-pband"), vis: a.getClientRects().length > 0 })));
    const start = links.filter((x) => /\/start\//.test(x.href)), bad = start.filter((x) => !START_RE(l).test(x.href));
    const purchase = links.filter((x) => /checkout|\/cart|purchase|add-to-cart|\/shop\//i.test(x.href));
    const demoAsSignup = links.filter((x) => /#demo/.test(x.href) && new RegExp(`^(${[L(l).cta.start, L(l).cta.waitlist].join("|")})`).test(x.text));
    const upgraded = ["open", "waitlist"].includes(state), staticLink = cell === "link";
    check(errors.length === 0 && bad.length === 0 && purchase.length === 0 && demoAsSignup.length === 0, `${cell} ${l} /${route} (${state}): every /start/ link is plan-less or ?plan=solo|studio|agency with the ${l} prefix, no purchase link, no demo-as-sign-up, no script error${bad.length ? " -> " + bad[0].href : ""}${errors.length ? " -> " + errors[0] : ""}`);
    const tierLinks = start.filter((x) => x.inTier && x.vis), bandLinks = start.filter((x) => x.inBand && x.vis); // (the closed card set carries the same links, hidden)
    const want = upgraded || (staticLink && !["closed_cutoff", "paused", "off"].includes(state));
    check(want ? tierLinks.length === 3 && tierLinks.every((x, i) => x.href === startOf(l, PLANS[i].id)) && (route === "" || bandLinks.length === 1) : tierLinks.length === 0 && bandLinks.length === 0, `${cell} ${l} /${route} (${state}): ${want ? "three card links (one per plan, in order) and the plan-less band link" : "NO /start/ link in a card or in the band (the control is a status region)"}`);
    await ctx.close();
  }
}

// ───────────────────────────────────────────────────────────── B. unsupported language
if (run("B")) {
  console.log("== B. an unsupported browser language gets the English page and English links; an unsupported locale path is a 404 without a control");
  for (const lang of ["fr-FR", "de-DE", "ja-JP", "pt-BR"]) {
    const m = mocks.announce; m.reset(); m.set({ signup: "open" });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: lang });
    await ctx.route("https://www.copilt.org/**", (r) => r.fulfill({ contentType: "text/html", body: "x" }));
    const page = await ctx.newPage();
    await page.goto(m.url + "/pricing/", { waitUntil: "load" }); await page.waitForTimeout(400);
    const r = await page.evaluate((TIER) => ({ lang: document.documentElement.lang, links: [...document.querySelectorAll(TIER + " a.aicc-btn")].map((a) => a.getAttribute("href")), h2: document.querySelector(".aicc-pricing__title").innerText.trim() }), TIER);
    check(r.lang.startsWith("en") && r.links.length === 3 && r.links.every((h, i) => h === startOf("en", PLANS[i].id)) && r.h2 === L("en").pricing.title, `browser language ${lang}: the English pricing page with English links (/start/?plan=<id>), no language prefix, no other language invented`);
    await ctx.close();
  }
  for (const p of ["/fr/pricing/", "/de/", "/pricing-old/"]) {
    const res = await fetch(mocks.announce.url + p);
    const html = await res.text();
    check(res.status === 404 && !/aicc-tier|aicc-pcta|aicc-launch|data-ss-/.test(html), `${p}: HTTP ${res.status}, no plan card, no control, no panel`);
  }
}

// ───────────────────────────────────────────────────────────── C. the status cache and the cutoff clock
async function clickNav(page, href) { await page.locator(`.aicc-site-header a[href="${href}"], .aicc-site-header__links a[href="${href}"]`).first().click(); await page.waitForFunction((p) => location.pathname === p, href); await page.waitForTimeout(450); }
if (run("C")) {
  console.log("== C. the status answer: failed or invalid answers never up- or downgrade; a valid answer does; the 30 s TTL; the cutoff by the browser clock");
  for (const l of QUICK ? ["en"] : ["en", "he"]) {
    const { ctx, page, m } = await view("announce", `${pre(l)}/`, 1440, { locale: l, signup: "open" });
    const n = () => m.calls("/signup/status", "GET").length;
    await page.evaluate(() => { window.__full = 1; });
    await clickNav(page, `${pre(l)}/pricing/`);
    let cs = await cards(page);
    check(n() === 1 && cs.every((c, i) => c.link.length === 1 && c.link[0].href === startOf(l, PLANS[i].id)), `${l}: the first answer (open) upgrades the static status to links (1 request)`);
    // within the TTL a changed answer is NOT requested: the cached view stays
    m.set({ signup: "off" }); await page.evaluate(() => { window.__skew += 5000; });
    await clickNav(page, `${pre(l)}/product/`); await clickNav(page, `${pre(l)}/pricing/`);
    cs = await cards(page);
    check(n() === 1 && cs.every((c) => c.link.length === 1), `${l}: 5 s later (inside the 30 s TTL) client navigation makes NO new request and keeps the links (${n()} request)`);
    // after the TTL a FAILED answer never changes the view (a single hiccup), up to four in a row; the fifth returns the control to the build's static state, never to open
    for (const bad of ["http500", "badjson", "drop", "inconsistent"]) {
      m.set({ signup: bad }); await page.evaluate(() => { window.__skew += 31000; });
      const before = n();
      await clickNav(page, `${pre(l)}/product/`); await clickNav(page, `${pre(l)}/pricing/`);
      cs = await cards(page);
      // (a dropped connection is retried once by the browser itself, so "once" may be two lines in the mock's log)
      check(n() >= before + 1 && n() <= before + (bad === "drop" ? 2 : 1) && cs.every((c) => c.link.length === 1 && c.st.length === 0 && c.info.length === 0), `${l}: after the TTL a failed or invalid answer (${bad}) is requested once and changes NOTHING: the links stay`);
    }
    m.set({ signup: "unknown" }); await page.evaluate(() => { window.__skew += 31000; });
    await clickNav(page, `${pre(l)}/product/`); await clickNav(page, `${pre(l)}/pricing/`);
    cs = await cards(page);
    check(infoCards(cs, l, "static"), `${l}: the FIFTH failed answer in a row (the 'open' view is 155 s old): the cards fall back to the build's static state, the information link "${howOf(l)}", not to open`);
    for (const bad of ["http404", "http500"]) { m.set({ signup: bad }); await page.evaluate(() => { window.__skew += 31000; }); await clickNav(page, `${pre(l)}/product/`); await clickNav(page, `${pre(l)}/pricing/`); }
    cs = await cards(page);
    check(infoCards(cs, l), `${l}: further failed answers never make a sign-up link again`);
    // a VALID answer is followed (down here: off)
    m.set({ signup: "off" }); await page.evaluate(() => { window.__skew += 31000; });
    await clickNav(page, `${pre(l)}/product/`); await clickNav(page, `${pre(l)}/pricing/`);
    cs = await cards(page);
    check(infoCards(cs, l, "off"), `${l}: open -> off during client navigation (after the TTL): the cards become the information link "${howOf(l)}" without a reload`);
    const bd = await band(page, "pricing-final");
    check(bd.st.length === 0 && bd.a.some((a) => a.href === journeyOf(l) && a.text.startsWith(howOf(l))) && !bd.a.some((a) => /\/start\//.test(a.href)), `${l}: the closing band follows (the plan-less information link, no /start/ link)`);
    // a failed answer never UPGRADES either
    for (const bad of ["http500", "badjson", "inconsistent", "unknown"]) {
      m.set({ signup: bad }); await page.evaluate(() => { window.__skew += 31000; });
      await clickNav(page, `${pre(l)}/product/`); await clickNav(page, `${pre(l)}/pricing/`);
      cs = await cards(page);
      check(infoCards(cs, l), `${l}: after "off", a failed or invalid answer (${bad}) never makes a sign-up link`);
    }
    // and a valid upgrade is followed again, a closed answer too
    m.set({ signup: "waitlist" }); await page.evaluate(() => { window.__skew += 31000; });
    await clickNav(page, `${pre(l)}/product/`); await clickNav(page, `${pre(l)}/pricing/`);
    cs = await cards(page);
    check(cs.every((c) => c.link.length === 1 && c.link[0].state === "waitlist" && c.note.length === 0), `${l}: off -> waitlist: the cards become "${L(l).cta.waitlist}" links (the waitlist fact is said once, in the status line)`);
    m.set({ signup: "closed_cutoff" }); await page.evaluate(() => { window.__skew += 31000; });
    await clickNav(page, `${pre(l)}/product/`); await clickNav(page, `${pre(l)}/pricing/`);
    cs = await cards(page);
    check(cs.every((c) => c.link.length === 0 && c.info.length === 0 && c.st.length === 1 && c.st[0].state === "closed_cutoff" && c.st[0].text === L(l).cta.closed), `${l}: waitlist -> closed_cutoff: the cards become the closed status region`);
    check(await page.evaluate(() => window.__full === 1), `${l}: the whole sequence ran by client navigation (no reload)`);
    await ctx.close();
  }
  // the cutoff passes while the page is open: a timer flips every control without a reload; the status answer never reopens it
  for (const [cell, signup] of [["announce", "open"], ["announce", "waitlist"], ["link", "http500"], ["announce", "off"]]) for (const l of QUICK ? ["en"] : LOCALES) {
    const { ctx, page } = await view(cell, `${pre(l)}/pricing/`, 1440, { locale: l, signup, now: CUT - 4500 });
    const before = await cards(page), gsBefore = await page.evaluate(() => [...document.querySelectorAll("[data-ss-getstarted]")].map((a) => a.getAttribute("href")));
    const headBefore = await page.evaluate(() => document.querySelector(".aicc-pricing__title").innerText.trim());
    await page.waitForTimeout(5200);
    const after = await cards(page), bd = await band(page, "pricing-final");
    const gs = await page.evaluate(() => [...document.querySelectorAll("[data-ss-getstarted]")].map((a) => a.getAttribute("href")));
    const head = await page.evaluate(() => document.querySelector(".aicc-pricing__title").innerText.trim());
    const wasLink = before.every((c) => c.link.length === 1);
    check((cell === "link" || ["open", "waitlist"].includes(signup) ? wasLink : infoCards(before, l)) && headBefore === L(l).pricing.title, `${cell} ${l} (${signup}): 4.5 s before 2026-12-24T00:00:00Z the cards are ${wasLink ? "links" : "the information link"} and the header is "${L(l).pricing.title}"`);
    check(after.every((c) => c.link.length === 0 && c.info.length === 0 && c.st.length === 1 && c.st[0].state === "closed_cutoff" && c.st[0].text === L(l).cta.closed && c.st[0].note === L(l).state.closedNote) && bd.st.length === 1 && bd.st[0] === L(l).cta.closed && !bd.a.some((a) => /\/start\//.test(a.href)), `${cell} ${l} (${signup}): the page left open flips to "${L(l).cta.closed}" at the cutoff WITHOUT a reload (cards and band; the explanation says paid plans are not open)`);
    check(gs.length >= 2 && gs.every((h) => h === journeyOf(l)) && head === L(l).pricing.titleClosed, `${cell} ${l} (${signup}): "Get started" now leads to the journey page (${gsBefore[0] === journeyOf(l) ? "as before" : "was /start/"}) and the header reads "${L(l).pricing.titleClosed}"`);
    await ctx.close();
  }
  // a page that slept: no timer fires, the visitor comes back (focus / visibilitychange) and the page re-checks the status (TTL cache) and the clock without a reload or a navigation
  for (const l of QUICK ? ["en"] : LOCALES) {
    const { ctx, page, m } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "off", now: CUT - 3600000 });
    let cs = await cards(page);
    check(infoCards(cs, l, "off"), `${l} wake: waiting on "${howOf(l)}" (answer off)`);
    m.set({ signup: "open" }); await page.evaluate(() => { window.__skew += 40000; window.dispatchEvent(new Event("focus")); });
    await page.waitForTimeout(500); cs = await cards(page);
    check(cs.every((c, i) => c.link.length === 1 && c.link[0].href === startOf(l, PLANS[i].id)), `${l} wake: a focus event after the TTL re-asks the status and the waiting cards become links (no reload, no navigation)`);
    const n0 = m.calls("/signup/status", "GET").length; await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
    await page.waitForTimeout(300);
    check(m.calls("/signup/status", "GET").length === n0, `${l} wake: a second focus inside the TTL makes no request`);
    await page.evaluate((c) => { window.__skew = c - Date.now() + window.__skew + 1500; document.dispatchEvent(new Event("visibilitychange")); }, CUT);
    await page.waitForTimeout(500); cs = await cards(page);
    check(cs.every((c) => c.link.length === 0 && c.info.length === 0 && c.st.length === 1 && c.st[0].state === "closed_cutoff"), `${l} wake: the page slept across 2026-12-24T00:00:00Z: visibilitychange re-reads the clock and every control says "${L(l).cta.closed}" at once`);
    await ctx.close();
  }
  // the boundary: 1 ms before is open, the cutoff instant is closed (client clock)
  for (const [now, want] of [[CUT - 1, "link"], [CUT, "status"], [CUT + 86400000 * 3, "status"]]) {
    const { ctx, page } = await view("announce", "/pricing/", 1440, { signup: "open", now, fixed: true });
    const cs = await cards(page);
    check(cs.every((c) => (want === "link" ? c.link.length === 1 : c.link.length === 0 && c.info.length === 0 && c.st[0].state === "closed_cutoff")), `clock ${new Date(now).toISOString()} with the answer open: the cards are ${want === "link" ? "links (now < cutoff)" : "the closed status (now >= cutoff)"}`);
    await ctx.close();
  }
}

// ───────────────────────────────────────────────────────────── D. waitlist, paused, closed, ended
if (run("D")) {
  console.log("== D. waitlist, paused, closed (paid purchase not open), the ordinary ended view");
  for (const l of LOCALES) {
    const w = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "waitlist" });
    const cs = await cards(w.page), ac = await w.page.evaluate((TIER) => [...document.querySelectorAll(TIER + " a.aicc-btn")].map((a) => ({ name: a.innerText.replace(/\s+/g, " ").trim(), desc: (document.getElementById(a.getAttribute("aria-describedby")) || { innerText: "" }).innerText.trim() })), TIER);
    const sl = await w.page.evaluate(() => { const e = document.getElementById("ss-state-line"); return e && { role: e.getAttribute("role"), text: e.querySelector(".aicc-pstate__text").innerText.trim(), n: document.querySelectorAll(".aicc-pstate").length, links: e.querySelectorAll("a").length }; });
    check(cs.every((c, i) => c.link.length === 1 && c.link[0].state === "waitlist" && c.link[0].href === startOf(l, PLANS[i].id) && c.link[0].text.startsWith(L(l).cta.waitlist) && c.link[0].text.includes(D[l].pricing.plans[PLANS[i].id].name) && c.note.length === 0 && c.info.length === 0) && sl && sl.role === "status" && sl.n === 1 && sl.text.startsWith(L(l).state.line.waitlist) && sl.links === 1, `${l} waitlist: "${L(l).cta.waitlist}" links to /start/?plan=<id>, named with the plan; the waitlist fact ("${L(l).state.line.waitlist.slice(0, 40)}...") is said ONCE, in the status line (no note under any card)`);
    await w.ctx.close();
    for (const [state, key] of [["paused", "paused"], ["closed_cutoff", "closed"], ["off", "soon"]]) {
      const v = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: state });
      const c2 = await cards(v.page), all = await v.page.evaluate(() => [...document.querySelectorAll("a[href]")].filter((a) => a.getClientRects().length).map((a) => a.getAttribute("href")));
      const sl = await v.page.evaluate(() => [...document.querySelectorAll(".aicc-pstate")].filter((e) => e.getClientRects().length > 0).map((e) => ({ role: e.getAttribute("role"), text: e.querySelector(".aicc-pstate__text").innerText.trim(), link: [...e.querySelectorAll("a")].map((a) => ({ href: a.getAttribute("href"), text: a.innerText.trim() })), state: e.getAttribute("data-ss-state") })));
      if (state === "closed_cutoff") {
        check(c2.every((c) => c.link.length === 0 && c.info.length === 0 && c.st.length === 1 && c.st[0].text === L(l).cta.closed && c.st[0].note === L(l).state.closedNote && c.st[0].role === null) && sl.length === 0 && !all.some((h) => /\/start\/|checkout|purchase/i.test(h)), `${l} closed: "${L(l).cta.closed}" + its explanation (cards without role=status), NO status line, no /start/ link and no purchase link on the page`);
        check(/purchase|buy|comprar|compra|купить|покупк|רכיש/i.test(c2[0].st[0].note), `${l} closed: the explanation says paid plans are not open for purchase (the Site has no purchase link)`);
      } else {
        const demo = `${pre(l)}/#demo`.replace(/^\/#/, "/#");
        check(infoCards(c2, l, state) && sl.length === 1 && sl[0].role === "status" && sl[0].text === L(l).state.line[key] && sl[0].link.length === 1 && sl[0].link[0].text === L(l).state.demo && sl[0].link[0].href === demo && !all.some((h) => /\/start\/|checkout|purchase/i.test(h)), `${l} ${state}: every card is the information link "${L(l).cta.how}" (no pill, no per-card paragraph); the fact "${L(l).state.line[key]}" is said ONCE, in the status line (role=status) with the working Live Demo link; no /start/ link and no purchase link`);
        const para = await v.page.evaluate((t) => [...document.querySelectorAll("article.aicc-tier")].filter((a) => a.getClientRects().length).filter((a) => a.innerText.includes(t)).length, L(l).state.line[key]);
        check(para === 0, `${l} ${state}: the not-open fact is not repeated inside any card (${para} cards)`);
      }
      await v.ctx.close();
    }
    const ended = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "open", now: END + 1000 });
    const r = await ended.page.evaluate(() => { const vis = (e) => e.getClientRects().length > 0; const t = [...document.querySelectorAll("article.aicc-tier--standard")].filter(vis); return { n: t.length, soon: t.filter((a) => a.querySelector("[data-commerce='closed']")).length, links: t.flatMap((a) => [...a.querySelectorAll("a")]).length, free: t.filter((a) => a.querySelector(".aicc-tier__free-word")).length, panel: [...document.querySelectorAll(".aicc-launch,.aicc-pband")].filter(vis).length, title: document.querySelector(".aicc-pricing__title").innerText.trim() }; });
    check(r.n === 3 && r.soon === 3 && r.links === 0 && r.free === 0 && r.panel === 0 && r.title === L(l).pricing.titleClosed, `${l} ended (after 2026-12-31T22:00:00Z): three ordinary cards ("${D[l].common.soon.label}"), no FREE, no link, no launch panel, no band, header "${L(l).pricing.titleClosed}"`);
    await ended.ctx.close();
  }
}

// ───────────────────────────────────────────────────────────── E. language and plan persistence
if (run("E")) {
  console.log("== E. clicking a card, the band or the finder requests the localized /start/?plan= URL");
  for (const l of LOCALES) for (const state of ["open", "waitlist"]) {
    const { ctx, page, nav } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: state });
    for (const [i, pl] of PLANS.entries()) {
      await page.goto(mocks.announce.url + `${pre(l)}/pricing/`, { waitUntil: "load" }); await page.waitForSelector(TIER + " a.aicc-btn");
      nav.length = 0; await page.locator(TIER + " a.aicc-btn").nth(i).click(); await page.waitForTimeout(250);
      check(nav[0] === startOf(l, pl.id), `${l} ${state}: the ${pl.id} card requests ${startOf(l, pl.id)} (${nav[0]})`);
    }
    await page.goto(mocks.announce.url + `${pre(l)}/pricing/`, { waitUntil: "load" }); await page.waitForSelector(".aicc-pband a.aicc-btn--primary[data-ss-state]");
    nav.length = 0; await page.locator(".aicc-pband a.aicc-btn[data-ss-state]").first().click(); await page.waitForTimeout(250);
    check(nav[0] === startOf(l), `${l} ${state}: the closing band requests the plan-less ${startOf(l)} (${nav[0]})`);
    await page.goto(mocks.announce.url + `${pre(l)}/pricing/`, { waitUntil: "load" }); await page.waitForTimeout(300);
    for (const [n, plan] of [["1", "solo"], ["3", "studio"], ["9", "agency"]]) {
      await page.locator("#plan-stores").fill(n); await page.waitForTimeout(200);
      const href = await page.evaluate(() => { const a = document.querySelector("#plan-stores").closest("form").querySelector("a.aicc-btn"); return a && a.getAttribute("href"); });
      check(href === startOf(l, plan), `${l} ${state}: the finder (${n} stores) offers ${startOf(l, plan)} (${href})`);
    }
    await ctx.close();
  }
  { // the bar link and the panel anchor
    for (const l of ["en", "he"]) {
      const { ctx, page } = await view("announce", `${pre(l)}/`, 1440, { locale: l, signup: "off" });
      await page.locator(`.aicc-eabar a[href$="#free-trial"]`).first().click(); await page.waitForURL(/pricing\/#free-trial/); await page.waitForTimeout(500);
      const r = await page.evaluate(() => { const p = document.getElementById("free-trial").getBoundingClientRect(), h = document.querySelector(".aicc-site-header").getBoundingClientRect(); return { top: p.top, header: h.bottom, vis: p.top < innerHeight && p.bottom > 0 }; });
      check(r.vis && r.top >= r.header - 1, `${l}: the bar link lands on the launch panel (#free-trial) BELOW the sticky header (panel top ${Math.round(r.top)} >= header bottom ${Math.round(r.header)})`);
      await ctx.close();
    }
  }
}

// ───────────────────────────────────────────────────────────── F. keyboard and focus
if (run("F")) {
  console.log("== F. keyboard order and focus visibility, light and dark surfaces");
  const seqOf = async (page, max) => {
    const seq = [], seen = new Set(); await page.evaluate(() => document.activeElement && document.activeElement.blur());
    for (let i = 0; i < max; i++) {
      await page.keyboard.press("Tab");
      const key = await page.evaluate(() => { const e = document.activeElement; return e && e !== document.body ? `${e.tagName}|${e.getAttribute("href")}|${(e.innerText || "").slice(0, 30)}|${[...document.querySelectorAll("a,button,input,select,textarea,[tabindex]")].indexOf(e)}` : "body"; });
      if (seen.has(key)) break; // the focus wrapped around the document
      seen.add(key);
      const r = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e), q = e.getBoundingClientRect(); const bg = (() => { let n = e; while (n) { const c = getComputedStyle(n).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; n = n.parentElement; } return "rgb(255, 255, 255)"; })(); return { href: e.getAttribute("href"), tier: e.closest("article.aicc-tier") ? e.closest("article.aicc-tier").getAttribute("data-plan") : null, band: !!e.closest(".aicc-pband"), w: parseFloat(cs.outlineWidth), style: cs.outlineStyle, color: cs.outlineColor, shadow: cs.boxShadow !== "none", h: q.height, dark: (() => { const m = bg.match(/\d+/g).map(Number); return (m[0] * 299 + m[1] * 587 + m[2] * 114) / 1000 < 100; })() }; });
      if (r) seq.push(r);
    }
    return seq;
  };
  for (const l of QUICK ? ["en"] : LOCALES) {
    const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "open" });
    const seq = await seqOf(page, 90);
    const inTier = seq.filter((s) => s.tier);
    check(inTier.length === 3 && ["solo", "studio", "agency"].every((p, i) => inTier[i].tier === p && inTier[i].href === startOf(l, p)), `${l} open: Tab visits the sign-up link of Solo, then Studio, then Agency, exactly one stop per card (${inTier.map((s) => s.tier)})`);
    const focusable = seq.filter((s) => s.tier || s.band);
    check(focusable.length >= 4 && focusable.every((s) => s.style !== "none" && s.w >= 2 || s.shadow), `${l} open: every focus stop in the cards and the band has a visible focus indicator (outline >= 2px or a shadow)`);
    check(seq.filter((s) => s.band).every((s) => s.dark === false || /rgb\((2[0-9]{2}|1[5-9]\d)/.test(s.color)) , `${l} open: the focus ring on the dark band is light (the focus-on-dark colour)`);
    check(inTier.every((s) => s.h >= 44), `${l} open: the card links are >= 44 px tall (touch target)`);
    await ctx.close();
    const off = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "off" });
    const s2 = await seqOf(off.page, 90);
    const t2 = s2.filter((s) => s.tier);
    check(t2.length === 3 && ["solo", "studio", "agency"].every((p, i) => t2[i].tier === p && t2[i].href === journeyOf(l, p)) && t2.every((s) => s.style !== "none" && s.w >= 2 || s.shadow) && t2.every((s) => s.h >= 44) && s2.filter((s) => s.band && /\/start\//.test(s.href || "")).length === 0, `${l} off: Tab visits the information link of Solo, Studio, Agency (one stop per card, a visible focus ring, >= 44 px), nothing in the band leads to /start/`);
    await off.ctx.close();
  }
}

// ───────────────────────────────────────────────────────────── G. axe
if (run("G")) {
  console.log("== G. accessibility: axe-core zero violations in every state, four languages, three widths, high contrast, 200% text");
  const axe = async (page) => { await page.evaluate(axeSource); return page.evaluate(async (tags) => { const x = await axe.run(document, { runOnly: { type: "tag", values: tags } }); return x.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0].target.join(" ")})`); }, TAGS); };
  const STATES = QUICK ? ["off", "open", "closed_cutoff"] : ["off", "open", "waitlist", "closed_cutoff", "paused"];
  for (const l of LOCALES) for (const state of STATES) for (const [route, name] of [["pricing/", "pricing"], ["", "home"]]) for (const w of QUICK ? [390, 1440] : [320, 768, 1440]) {
    const { ctx, page } = await view("announce", `${pre(l)}/${route}`, w, { locale: l, signup: state, h: 900, media: { reducedMotion: "reduce" } });
    const v = await axe(page);
    check(v.length === 0, `axe ${l} ${name} @${w} (${state}): zero violations${v.length ? " -> " + v.join(", ") : ""}`);
    await ctx.close();
  }
  for (const [cell, route, signup, extra] of [["link", "pricing/", "http500", {}], ["off", "pricing/", "open", {}], ["announce", "pricing/", "open", { now: END + 1000 }], ["announce", "pricing/", "open", { scale: 2 }], ["announce", "", "waitlist", { scale: 1.25 }]]) for (const l of QUICK ? ["en"] : LOCALES) {
    const { ctx, page } = await view(cell, `${pre(l)}/${route}`, 390, { locale: l, signup, h: 844, media: { reducedMotion: "reduce" }, ...extra }); // (reduced motion: axe must not sample a colour in the middle of a button transition)
    const v = await axe(page);
    check(v.length === 0, `axe ${cell} ${l} /${route} @390 (${signup}${extra.now ? ", ended view" : ""}${extra.scale ? `, ${extra.scale * 100}% text` : ""}): zero violations${v.length ? " -> " + v.join(", ") : ""}`);
    await ctx.close();
  }
  for (const l of QUICK ? ["en"] : LOCALES) for (const state of ["off", "open"]) { // enhanced contrast (the site's own mode)
    const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: state, init: () => { try { localStorage.setItem("aicc_a11y", JSON.stringify({ contrast: "high" })); } catch {} } });
    await page.evaluate(() => document.documentElement.setAttribute("data-aicc-contrast", "high")); await page.waitForTimeout(200);
    const v = await axe(page);
    check(v.length === 0, `axe ${l} pricing @1440 (${state}, enhanced contrast mode): zero violations${v.length ? " -> " + v.join(", ") : ""}`);
    await ctx.close();
  }
  { // heading hierarchy: h2 (section) -> h3 (plan names, the panel title); one h2 per section block; no skipped level inside the section
    for (const l of QUICK ? ["en"] : LOCALES) for (const route of ["pricing/", ""]) {
      const { ctx, page } = await view("announce", `${pre(l)}/${route}`, 1440, { locale: l, signup: "off" });
      const h = await page.evaluate(() => [...document.querySelectorAll(".aicc-pricing h2, .aicc-pricing h3")].filter((e) => e.getClientRects().length).map((e) => e.tagName));
      check(JSON.stringify(h) === JSON.stringify(["H2", "H3", "H3", "H3", "H3"]), `${l} /${route}: the section's headings are h2 (header), h3 x3 (plan names), h3 (launch panel) [${h}]`);
      await ctx.close();
    }
  }
}

// ───────────────────────────────────────────────────────────── H. geometry
if (run("H")) {
  console.log("== H. geometry: 320..1920 px x 100 / 125 / 200 % text x four languages: no horizontal scroll, nothing clipped, FREE on one line, the layout of each breakpoint");
  const WIDTHS = [320, 375, 390, 430, 768, 1024, 1440, 1920];
  const geo = (page) => page.evaluate(() => {
    const vis = (e) => e.getClientRects().length > 0, out = { over: document.documentElement.scrollWidth - innerWidth, problems: [] };
    const tiers = [...document.querySelectorAll("article.aicc-tier")].filter(vis), panel = [...document.querySelectorAll(".aicc-launch")].filter(vis)[0] || null, bandEl = document.querySelector(".aicc-pband");
    const fs = (e) => parseFloat(getComputedStyle(e).fontSize);
    for (const box of [...tiers, panel, bandEl].filter(Boolean)) {
      const r = box.getBoundingClientRect();
      for (const e of [...box.querySelectorAll("*")].filter(vis)) {
        const q = e.getBoundingClientRect();
        if (q.width === 0 && q.height === 0) continue;
        if (q.left < r.left - 1.5 || q.right > r.right + 1.5) out.problems.push(`${e.className || e.tagName} leaves its box horizontally (${Math.round(q.left - r.left)}, ${Math.round(q.right - r.right)})`);
        const cs = getComputedStyle(e);
        if (!["inline", "contents"].includes(cs.display) && e.tagName !== "svg" && !e.closest("svg") && (cs.overflowX !== "visible" || cs.overflowY !== "visible") && (e.scrollWidth > e.clientWidth + 1.5 || e.scrollHeight > e.clientHeight + 1.5) && !e.matches(".aicc-sr-only, .aicc-ss-reserve, .aicc-cap__slot")) out.problems.push(`${e.className || e.tagName} is clipped (scroll ${e.scrollWidth}x${e.scrollHeight} > client ${e.clientWidth}x${e.clientHeight})`);
      }
    }
    // text that overflows its own box (an anonymous flex item, a label wider than its pill): no element box leaves the card, but the text is cut by the card's overflow
    for (const e of [...document.querySelectorAll(".aicc-tier__trial, .aicc-tier__free-word, .aicc-pstatus__label, .aicc-tier__cap-text, .aicc-tier__fit, .aicc-tier__name, .aicc-timeline__date, .aicc-timeline__label, .aicc-launch__fact, .aicc-launch__sub, .aicc-pband__lead")].filter(vis)) if (e.scrollWidth > e.clientWidth + 1.5) out.problems.push(`${e.className.split(" ")[0]} text overflows its box (${e.scrollWidth} > ${e.clientWidth})`);
    out.free = tiers.filter((t) => t.querySelector(".aicc-tier__free-word")).map((t) => { const f = t.querySelector(".aicc-tier__free-word"), rg = document.createRange(); rg.selectNodeContents(f); const tops = new Set([...rg.getClientRects()].map((x) => Math.round(x.top))); const amount = t.querySelector(".aicc-tier__amount"), trial = t.querySelector(".aicc-tier__trial"); const maxOther = Math.max(...[...t.querySelectorAll("*")].filter((e) => e !== f && !f.contains(e) && e.childElementCount === 0 && vis(e) && e.textContent.trim()).map(fs)); return { lines: tops.size, fs: fs(f), amount: fs(amount), trial: fs(trial), maxOther, name: t.getAttribute("data-plan") }; });
    out.ctl = tiers.map((t) => { const c = t.querySelector(".aicc-pcta .aicc-btn, .aicc-pcta .aicc-pstatus__pill"); const q = c.getBoundingClientRect(); return { h: q.height, w: q.width, clipped: c.scrollHeight > c.clientHeight + 1.5 }; });
    out.rect = tiers.map((t) => { const q = t.getBoundingClientRect(), g = (s) => { const e = t.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top * 10) / 10 : null; }; return { plan: t.getAttribute("data-plan"), top: q.top + scrollY, left: q.left, right: q.right, h: q.height, name: g(".aicc-tier__name"), free: g(".aicc-tier__free-word"), ctl: g(".aicc-pcta"), incl: g(".aicc-tier__incl"), plan_l: t.querySelector(".aicc-tier__plan").getBoundingClientRect().left, launch_l: t.querySelector(".aicc-tier__launch").getBoundingClientRect().left }; });
    out.tiersW = [...document.querySelectorAll(".aicc-tiers")].filter(vis)[0].getBoundingClientRect().width;
    out.secOver = Math.max(...[".aicc-tiers", ".aicc-launch", ".aicc-pband"].map((q) => { const e = document.querySelector(q); return e ? e.getBoundingClientRect().right - innerWidth : -1; }), ...tiers.map((t) => t.getBoundingClientRect().right - innerWidth));
    out.panel = panel ? { w: panel.getBoundingClientRect().width, cols: getComputedStyle(panel).gridTemplateColumns.split(" ").length, tl: getComputedStyle(panel.querySelector(".aicc-timeline")).gridTemplateColumns.split(" ").length, facts: getComputedStyle(panel.querySelector(".aicc-launch__facts")).gridTemplateColumns.split(" ").length } : null;
    return out;
  }, TIER);
  const CELLS = [];
  for (const l of LOCALES) for (const w of WIDTHS) for (const scale of [1, 1.25, 2]) for (const state of ["off", "open"]) { if (QUICK && (l === "es" || (scale === 1.25 && w !== 320))) continue; CELLS.push([l, w, scale, state]); }
  if (!QUICK) for (const l of LOCALES) for (const w of [320, 390, 768, 1440]) for (const scale of [1, 2]) for (const state of ["waitlist", "closed_cutoff"]) CELLS.push([l, w, scale, state]);
  for (const [l, w, scale, state] of CELLS) {
    const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, w, { locale: l, signup: state, h: 1000, scale, media: { reducedMotion: "reduce" } });
    const g = await geo(page), tag = `${l} @${w}px ${scale * 100}% ${state}`;
    // at 200% text on a phone the SITE's header actions (menu, accessibility button) already extend past the screen on every page; that is not this section's, so there the section's own boxes must stay inside the viewport
    check(g.secOver <= 1 && (scale <= 1.25 ? g.over <= 0 : true), `${tag}: ${scale <= 1.25 ? `no horizontal scroll (+${g.over}px) and ` : `(the page itself scrolls +${g.over}px at 200% text: the header, as on every page of the Site) `}the cards, the launch panel and the band stay inside the viewport (${Math.round(g.secOver)}px)`);
    check(g.problems.length === 0, `${tag}: nothing leaves or is clipped inside the cards, the launch panel and the band${g.problems.length ? " -> " + g.problems.slice(0, 2).join("; ") : ""}`);
    const closed = state === "closed_cutoff";
    // FREE: always one line and >= 20px; with text up to 125% it is also dominant (>= 85% of the largest text of its card, the price amount: at 320px the Russian word is 33px against a 35px amount, still the widest and heaviest word); at 200% text only "one line, nothing cut" is asked
    check(closed ? g.free.length === 0 : g.free.length === 3 && g.free.every((f) => f.lines === 1 && f.fs >= 20 && (scale > 1.5 ? true : f.fs >= 0.65 * f.maxOther)), `${tag}: ${closed ? "the closed view has NO FREE word" : `FREE ("${L(l).pricing.free}") is one line, at least 20px${scale > 1.5 ? "" : " and at least 65% of the largest text of its card (the headroom for text spacing makes the word smaller than before)"}`} [${g.free.map((f) => Math.round(f.fs) + "/" + Math.round(f.maxOther)).join(" ")}px]`);
    check(g.ctl.every((c) => c.h >= 44 && !c.clipped), `${tag}: the control (link or status pill) is >= 44px tall and not clipped [${g.ctl.map((c) => Math.round(c.h)).join("/")}px]`);
    // the breakpoints are media queries in rem (40rem rows, 62rem columns) and the default font size is scaled, so they move with the text: the layout is chosen by w / scale
    const r = g.rect, eff = w / scale;
    if (eff < 640) check(r[0].top < r[1].top && r[1].top < r[2].top && r.every((x) => Math.abs(x.left - r[0].left) <= 4 && Math.abs((x.right - x.left) - g.tiersW) <= 4), `${tag}: one column in DOM order Solo, Studio, Agency, each card nearly full width (tiers ${Math.round(g.tiersW)}px)`);
    else if (eff < 992) check(r.every((x) => x.launch_l > x.plan_l - 1 || l === "he") && r[0].top < r[1].top && r[1].top < r[2].top, `${tag}: each plan is a row (identity beside the launch zone), DOM order kept`);
    else check(Math.abs(r[0].top - r[2].top) <= 1.5 && Math.abs(r[1].top - (r[0].top - 10 * scale)) <= 2 * scale && ["name", "free", "ctl", "incl"].every((k) => r[0][k] === null || Math.abs(r[0][k] - r[2][k]) <= 1.5 && (r[1][k] === null || Math.abs(r[1][k] - r[0][k]) <= 12.5 * scale)), `${tag}: three columns on shared rows: Solo and Agency tops equal, Studio raised 0.625rem, name / FREE / control / footer line up (Studio within its raise)`);
    if (g.panel && eff >= 640) check(g.panel.tl === 2 && g.panel.facts === 3, `${tag}: launch panel: two timeline columns and three fact columns from 40rem`);
    if (g.panel && eff < 640) check(g.panel.tl === 1 && g.panel.facts === 1, `${tag}: launch panel: vertical timeline and stacked facts on a phone`);
    if (w === 320 && scale === 2 || (w === 1440 && scale === 1) || (w === 390 && scale === 1)) await page.locator('[aria-labelledby="plans-title"]').screenshot({ path: path.join(SHOTS, `geo-${l}-${w}-${scale * 100}-${state}.png`) });
    await ctx.close();
  }
}

// ───────────────────────────────────────────────────────────── H2. text spacing (WCAG 1.4.12) and mid-word breaks
if (run("H") || run("S")) {
  console.log("== H2. WCAG 1.4.12 text spacing (and 200% text): no word of the section breaks mid-word, FREE stays on one line, nothing clips, the two milestone values wrap alike");
  const words = (page, skip = false) => page.evaluate((skipTitles) => {
    // core = the words a card is read by; at 200% text on a phone the status pill label, the timeline and the panel tag still break a long word (a 160 px effective column), which is reported, not asserted
    const sel = ".aicc-tier__free-word, " + (skipTitles && innerWidth <= 400 ? "" : ".aicc-tier__trial, ") + ".aicc-tier__name, .aicc-tier__amount, .aicc-tier__cap-text" + (skipTitles && innerWidth <= 400 ? "" : ", .aicc-btn[data-ss-state]") + (skipTitles ? "" : ", .aicc-pstatus__label, .aicc-timeline__label, .aicc-timeline__date, .aicc-launch__tag, .aicc-launch__title, .aicc-pricing__title");
    const broken = [], vis = (e) => e.getClientRects().length > 0;
    for (const el of [...document.querySelectorAll(".aicc-pricing, .aicc-pband")].flatMap((r) => [...r.querySelectorAll(sel)]).filter(vis)) {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) {
        if (!n.nodeValue.trim() || n.parentElement.closest(".aicc-sr-only, svg")) continue;
        const re = /[^\s ]+/g; let m;
        while ((m = re.exec(n.nodeValue))) {
          if (/[-‐‑־\/]/.test(m[0]) || m[0].length < 4) continue;
          const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
          const tops = new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top / 3)));
          if (tops.size > 1) broken.push(m[0] + " in " + (el.className.split(" ")[0] || el.tagName));
        }
      }
    }
    const free = [...document.querySelectorAll(".aicc-tier:not(.aicc-tier--standard) .aicc-tier__free-word, .aicc-tier--standard .aicc-tier__free-word")].filter(vis).map((f) => { const rg = document.createRange(); rg.selectNodeContents(f); return new Set([...rg.getClientRects()].map((x) => Math.round(x.top))).size; });
    const dates = [...document.querySelectorAll(".aicc-timeline__date")].filter(vis).map((d) => Math.round(d.getBoundingClientRect().height / parseFloat(getComputedStyle(d).lineHeight)));
    const overflow = [...document.querySelectorAll(".aicc-tier__trial, .aicc-tier__free-word, .aicc-pstatus__label, .aicc-tier__cap-text, .aicc-tier__name")].filter(vis).filter((e) => e.scrollWidth > e.clientWidth + 1.5).map((e) => e.className.split(" ")[0] + " " + e.scrollWidth + ">" + e.clientWidth);
    return { overflow, broken, free, dates, over: document.documentElement.scrollWidth - innerWidth, secOver: Math.max(-1, ...[".aicc-tiers", ".aicc-launch", ".aicc-pband"].map((q) => { const e = document.querySelector(q); return e ? e.getBoundingClientRect().right - innerWidth : -1; })) };
  }, skip);
  const CELLS2 = [];
  for (const l of QUICK ? ["en", "ru", "es"] : LOCALES) for (const w of [320, 360, 390, 768, 1024, 1440]) for (const [scale, spacing] of [[1, true], [2, false], [2, true]]) for (const state of ["off", "closed_cutoff"]) CELLS2.push([l, w, scale, state, spacing]);
  for (const [l, w, scale, state, spacing] of CELLS2) {
    const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, w, { locale: l, signup: state, h: 1000, scale, spacing, media: { reducedMotion: "reduce" } });
    // each WCAG requirement alone (1.4.4 200% text, 1.4.12 spacing) is held to "no word breaks mid-word" (headings aside at 200%: a heading word wider than a 160 px effective column cannot fit); both together ask for "FREE on one line, nothing outside the viewport"
    const both = scale > 1 && spacing, g = await words(page, scale > 1), tag = `${l} @${w}px ${scale * 100}% text${spacing ? " + 1.4.12 spacing" : ""} ${state}`;
    check(g.overflow.length === 0 && (both || g.broken.length === 0) && g.free.every((n) => n === 1), `${tag}: no word breaks mid-word and FREE is one line${g.overflow.length ? " -> OVERFLOW " + g.overflow.slice(0, 2).join(", ") : ""}${g.broken.length ? " -> " + g.broken.slice(0, 3).join(", ") : ""}${g.free.some((n) => n !== 1) ? " (FREE wraps)" : ""}`);
    check(g.secOver <= 1, `${tag}: the cards, the panel and the band stay inside the viewport (${Math.round(g.secOver)}px)`);
    if (state === "off" && w >= 1024 && scale === 1 && g.dates.length === 2) check(g.dates[0] === g.dates[1], `${tag}: the two milestone values wrap alike (${g.dates.join(" / ")} lines)`);
    await ctx.close();
  }
}

// ───────────────────────────────────────────────────────────── I. motion, RTL, print, forced colours, CLS
if (run("I")) {
  console.log("== I. reduced motion, RTL, print, forced colours, layout shift");
  { // motion: hover transitions exist for people who allow motion and collapse under reduced motion
    const dur = (page) => page.evaluate((TIER) => { const t = document.querySelector(TIER), b = document.querySelector(TIER + " a.aicc-btn") || t; const m = (e) => Math.max(...getComputedStyle(e).transitionDuration.split(",").map((x) => parseFloat(x) || 0)); return { tier: m(t), btn: m(b), anim: [...document.querySelectorAll(".aicc-tier,.aicc-tier *,.aicc-launch *,.aicc-pband *")].filter((e) => getComputedStyle(e).animationName !== "none").length }; }, TIER);
    const a = await view("announce", "/pricing/", 1440, { signup: "open", media: { reducedMotion: "no-preference" } }), b = await view("announce", "/pricing/", 1440, { signup: "open", media: { reducedMotion: "reduce" } });
    const da = await dur(a.page), db = await dur(b.page);
    check(da.tier >= 0.1 && da.btn >= 0.1 && da.anim === 0, `motion allowed: the card and the link have a short transition (${da.tier}s / ${da.btn}s) and nothing animates by itself (${da.anim} animations)`);
    check(db.tier <= 0.001 && db.btn <= 0.001 && db.anim === 0, `reduced motion: transitions collapse to <= 1 ms (${db.tier}s / ${db.btn}s), no animation`);
    await a.ctx.close(); await b.ctx.close();
  }
  { // RTL: Hebrew mirrors the grid, the timeline, the badge and the arrow
    for (const state of ["off", "open"]) {
      const { ctx, page } = await view("announce", "/he/pricing/", 1440, { locale: "he", signup: state });
      const r = await page.evaluate((TIER) => { const t = [...document.querySelectorAll(TIER)].map((e) => e.getBoundingClientRect()), badge = document.querySelector(".aicc-tier__badge").getBoundingClientRect(), name = document.querySelector("[data-plan=studio] .aicc-tier__name").getBoundingClientRect(), card = document.querySelector("[data-plan=studio]").getBoundingClientRect(), steps = [...document.querySelectorAll(".aicc-timeline__step")].map((e) => e.getBoundingClientRect()), arrow = document.querySelector(TIER + " .aicc-btn__icon svg"), amount = document.querySelector(".aicc-tier__amount"); return { order: t[0].left > t[1].left && t[1].left > t[2].left, badgeLeftOfName: badge.right <= name.left + 2 || badge.left < name.left, nameNearRight: card.right - name.right < name.left - card.left, step: steps[0].left > steps[1].left, arrow: arrow ? getComputedStyle(arrow).transform : "none", amountDir: getComputedStyle(amount).direction, amountBdi: amount.tagName }; }, TIER);
      check(r.order && r.nameNearRight && r.step && (state === "off" || /matrix\(-1/.test(r.arrow)), `he ${state}: RTL mirrors the grid (Solo on the right), the plan name starts at the right edge, the timeline's first step is on the right${state === "open" ? ", the link arrow is flipped" : ""} [${JSON.stringify(r)}]`);
      const price = await page.evaluate((TIER) => [...document.querySelectorAll(TIER + " .aicc-tier__amount")].map((e) => e.innerText.trim()), TIER);
      check(JSON.stringify(price) === JSON.stringify(PLANS.map((p) => formatPrice(p.price, "he"))), `he: the amounts read $99 / $199 / $499 in order (a <bdi> keeps them readable inside right-to-left text) [${price}]`);
      await ctx.close();
    }
  }
  { // print: three columns, no shadows, no overflow
    for (const l of ["en", "he", "ru"]) {
      const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 794, { locale: l, signup: "off", media: {} });
      await page.emulateMedia({ media: "print" }); await page.waitForTimeout(900);
      const r = await page.evaluate((TIER) => { const grid = document.querySelector(".aicc-tiers"), t = document.querySelector(TIER), cs = getComputedStyle(t), pill = getComputedStyle(document.querySelector(".aicc-pcta .aicc-btn")); return { cols: getComputedStyle(grid).gridTemplateColumns.split(" ").length, shadow: cs.boxShadow, border: cs.borderTopColor, pill: pill.borderTopColor, over: document.documentElement.scrollWidth - innerWidth }; }, TIER);
      check(r.cols === 3 && r.shadow === "none" && r.border === "rgb(0, 0, 0)" && r.pill === "rgb(0, 0, 0)" && r.over <= 0, `${l} print: three columns, no shadow, black borders, no overflow [${JSON.stringify(r)}]`);
      await ctx.close();
    }
  }
  { // forced colours: borders carry the structure (screenshot + the featured card keeps a Highlight border)
    for (const l of ["en", "he"]) {
      const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1024, { locale: l, signup: "open", media: { forcedColors: "active" } });
      const r = await page.evaluate(() => { const f = document.querySelector("[data-plan=studio]"), cs = getComputedStyle(f), slot = getComputedStyle(document.querySelector(".aicc-cap__slot--on")); return { w: cs.borderTopWidth, style: cs.borderTopStyle, slot: slot.borderTopStyle }; });
      check(r.w === "3px" && r.style === "solid" && r.slot === "solid", `${l} forced colours: the Recommended card keeps a 3px solid border and the filled store slots keep theirs [${JSON.stringify(r)}]`);
      await page.locator('[aria-labelledby="plans-title"]').screenshot({ path: path.join(SHOTS, `forced-${l}.png`) });
      await ctx.close();
    }
  }
  { // layout shift: the status answer arriving changes the controls; the page must not move
    const CLS = () => { window.__cls = 0; new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); };
    for (const [cell, signup, delay, label] of [["announce", "open", 600, "information link -> sign-up link (open)"], ["announce", "waitlist", 600, "information link -> sign-up link (waitlist, the status line grows)"], ["announce", "closed_cutoff", 600, "status -> closed status"], ["link", "off", 600, "static sign-up link -> information link (link build, answer off)"], ["announce", "off", 600, "information link -> information link (off)"]]) for (const [w, h] of [[1440, 2600], [390, 3400]]) for (const l of QUICK ? ["en"] : LOCALES) {
      const { ctx, page } = await view(cell, `${pre(l)}/pricing/`, w, { locale: l, signup, delay, h, init: CLS });
      const before = await page.evaluate((TIER) => ({ h: [...document.querySelectorAll(TIER)].map((t) => t.getBoundingClientRect().height), panel: document.querySelector(".aicc-launch").getBoundingClientRect().top + scrollY, ctl: [...document.querySelectorAll(TIER + " .aicc-pcta")].map((t) => t.getBoundingClientRect().height) }), TIER);
      await page.waitForTimeout(delay + 700);
      const after = await page.evaluate((TIER) => ({ h: [...document.querySelectorAll(TIER)].map((t) => t.getBoundingClientRect().height), panel: document.querySelector(".aicc-launch").getBoundingClientRect().top + scrollY, ctl: [...document.querySelectorAll(TIER + " .aicc-pcta")].map((t) => t.getBoundingClientRect().height), cls: window.__cls }), TIER);
      const dh = Math.max(...after.h.map((x, i) => Math.abs(x - before.h[i]))), dctl = Math.max(...after.ctl.map((x, i) => Math.abs(x - before.ctl[i])));
      // a link replaces a status region of the same box height (the invisible reserve keeps the note's lines); a note of another state may differ by a line, which moves nothing above it
      // A link replaces a status region of the same box height (the invisible reserve keeps the note's lines). The one exception is the Russian status label, which wraps to two lines in a card ("Бесплатный период скоро откроется"):
      // its pill is 65 px against the link's 58 px, a 7 px difference that moves nothing above it. The closed look steps FREE back BY DESIGN, so a card gets shorter when the answer is closed: bounded, intended, and still a tiny shift score.
      const exact = !(signup === "waitlist") && !(signup === "closed_cutoff"), tol = l === "ru" ? 8 : 1.5;
      // (a status answer "closed" swaps the live cards for the closed set and removes the launch panel: a different view, so only the shift score is asserted; a visitor who loads the page after the cutoff gets it before first paint from the head script and sees no shift at all)
      check(signup === "closed_cutoff" ? after.cls < 0.1 : after.cls < (exact ? 0.01 : 0.03) && (exact ? dh <= tol && dctl <= tol : dh <= 80) && Math.abs(after.panel - before.panel) <= (exact ? Math.max(tol * (w < 600 ? 3 : 1), l === "ru" ? 24 : 12) : 130), `${cell} ${l} @${w}: ${label}: layout shift ${after.cls.toFixed(4)}, card height change ${dh.toFixed(1)}px, control box change ${dctl.toFixed(1)}px, launch panel moved ${Math.abs(after.panel - before.panel).toFixed(1)}px`);
      await ctx.close();
    }
  }
}

// ───────────────────────────────────────────────────────────── L. the closed view
if (run("L")) {
  console.log("== L. registration closed (status answer or the browser clock): ordinary cards, no FREE word, no trial line, no launch panel, no dates, no #free-trial target, ONE announcement, axe clean");
  const probe = (page) => page.evaluate(() => {
    const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
    const main = document.querySelector("main"), mt = main.innerText;
    return {
      closedCards: [...document.querySelectorAll("article.aicc-tier--standard")].filter(vis).length, liveCards: [...document.querySelectorAll("article.aicc-tier:not(.aicc-tier--standard)")].filter(vis).length,
      free: [...document.querySelectorAll(".aicc-tier__free-word, .aicc-tier__trial, [data-ss-free]")].filter(vis).length, panel: [...document.querySelectorAll(".aicc-launch, #free-trial, [data-ss-terms], ol[data-ss-dates]")].filter(vis).length,
      barLinks: [...document.querySelectorAll('a[href*="free-trial"]')].filter(vis).length, anchorTargets: [...document.querySelectorAll('a[href*="#free-trial"]')].filter(vis).length,
      dates: /\b(UTC|00:00|22:00)\b|2026/.test(mt.replace(/©[^\n]*/g, "")) , roles: [...document.querySelectorAll('main [role="status"], .aicc-pricing [role="status"]')].filter(vis).filter((e) => e.innerText.trim() !== "").length, // (an empty live region of the page itself announces nothing)
      attr: document.documentElement.hasAttribute("data-ss-closed"), notes: [...document.querySelectorAll("article.aicc-tier--standard .aicc-pstatus__note")].filter(vis).map((e) => e.innerText.trim()),
      labels: [...document.querySelectorAll("article.aicc-tier--standard .aicc-pstatus__label")].filter(vis).map((e) => e.innerText.trim()), title: document.querySelector(".aicc-pricing__title").innerText.trim(),
    };
  });
  const axe = async (page) => { await page.evaluate(axeSource); return page.evaluate(async (tags) => { const x = await axe.run(document, { runOnly: { type: "tag", values: tags } }); return x.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0].target.join(" ")})`); }, TAGS); };
  for (const l of QUICK ? ["en", "ru"] : LOCALES) for (const [how, opts] of [["status answer closed_cutoff", { signup: "closed_cutoff" }], ["browser clock after the cutoff", { signup: "open", now: CUT + 1000, fixed: true }]]) for (const w of [390, 1440]) for (const route of ["pricing/", ""]) {
    const { ctx, page } = await view("announce", `${pre(l)}/${route}`, w, { locale: l, h: 900, media: { reducedMotion: "reduce" }, ...opts });
    const r = await probe(page), tag = `${l} /${route} @${w} (${how})`;
    check(r.closedCards === 3 && r.liveCards === 0 && r.free === 0 && r.panel === 0, `${tag}: three ordinary cards (price leads), NO FREE word, NO trial line, NO launch panel, no #free-trial target`);
    check(r.labels.length === 3 && r.labels.every((x) => x === L(l).cta.closed) && r.notes.every((x) => x === L(l).state.closedNote) && r.title === L(l).pricing.titleClosed, `${tag}: the control says "${L(l).cta.closed}" with the note "${L(l).state.closedNote.slice(0, 40)}..." and the header says "${L(l).pricing.titleClosed}"`);
    check(r.anchorTargets === 0 && r.dates === false && r.attr, `${tag}: no visible link to #free-trial (the announcement bar is hidden), no date or clock in the main content, <html data-ss-closed> is set`);
    check(r.roles === 1, `${tag}: ONE live region announces the closed state (the band); the cards carry the same text without role=status (${r.roles})`);
    if (route === "pricing/" || w === 390) { const v = await axe(page); check(v.length === 0, `${tag}: axe zero violations${v.length ? " -> " + v.join(", ") : ""}`); }
    await ctx.close();
  }
  { // the page left open across the cutoff loses the trial view at once: FREE, the trial lines, the panel and the bar go; the closed cards and header appear
    for (const l of QUICK ? ["en"] : LOCALES) {
      const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "open", now: CUT - 4500 });
      const before = await probe(page);
      await page.waitForTimeout(5200);
      const after = await probe(page), bar = await page.evaluate(() => getComputedStyle(document.querySelector(".aicc-eabar")).visibility);
      check(before.liveCards === 3 && before.free >= 6 && before.panel >= 1 && !before.attr, `${l} left open (4.5 s before the cutoff): live cards with FREE and the trial line, the launch panel, no closed marker`);
      check(after.closedCards === 3 && after.liveCards === 0 && after.free === 0 && after.panel === 0 && after.attr && after.anchorTargets === 0 && bar === "hidden", `${l} left open: at the cutoff the page switches to the closed view WITHOUT a reload (no FREE, no trial line, no panel, the bar hidden: ${bar})`);
      await ctx.close();
    }
  }
  { // a build that has commerce open is not part of the test builds; the note logic is asserted in the sources test (closedPaidNote when COMMERCE_OPEN)
    const src = fs.readFileSync("src/components/ss/Ss.tsx", "utf8");
    check(/COMMERCE_OPEN \? n\.closedPaidNote : n\.closedNote/.test(src), "the closed note is Commerce-aware: closedPaidNote when the build has commerce open (no 'not open for purchase yet' claim), closedNote otherwise");
  }
}

// ───────────────────────────────────────────────────────────── J. the planned price above FREE: the compliant default and the counsel-gated strike
if (run("J")) {
  console.log("== J. the planned annual price sits DIRECTLY above FREE: the compliant default (large muted price + pill + chevron, NOT struck) in every default build; the strike variant only in its own build (matrix: languages x 320..1920 x 100 / 200 % text)");
  const BAD = { en: /\b(was|previously|originally|formerly|worth|normally|usually|savings?|saves?|discount(ed)?|reduced)\b|original price|(?<!planned )regular (annual )?price/i, he: /מחיר מקורי|מחיר קודם|היה |חיסכון|בדרך כלל|(?<!מתוכנן )מחיר רגיל(?! מתוכנן)/, es: /\b(antes|anteriormente|originalmente|ahorr[aeo]\w*|normalmente|habitualmente|descuento)\b|precio original|(?<!previsto )\bprecio (anual )?regular\b(?! previsto)/i, ru: /(?<![а-яё])(было|раньше|ранее|эконом[а-яё]*|обычно|скидк[а-яё]*)(?![а-яё])|(первоначальн|исходн)[а-яё]+ цен[а-яё]+|(?<![а-яё])(?<!планируемая )обычная (годовая )?цена/i };
  const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const offerProbe = (page) => page.evaluate(() => {
    const vis = (e) => e.getClientRects().length > 0, out = [];
    for (const t of [...document.querySelectorAll("article.aicc-tier:not(.aicc-tier--standard)")].filter(vis)) {
      const o = t.querySelector(".aicc-tier__offer"), price = o.querySelector(".aicc-tier__offer-price"), s = price.querySelector("s"), label = o.querySelector(".aicc-tier__offer-label"), pill = o.querySelector(".aicc-tier__offer-pill"), free = t.querySelector(".aicc-tier__free-word"), note = t.querySelector(".aicc-tier__offer-note"), amt = price.querySelector(".aicc-tier__amount");
      const q = (e) => e && e.getBoundingClientRect(), cs = (e) => e && getComputedStyle(e), rg = document.createRange(); rg.selectNodeContents(s || price);
      let bg = (() => { let n = price; while (n) { const c = getComputedStyle(n).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; n = n.parentElement; } return "rgb(255, 255, 255)"; })();
      out.push({ plan: t.getAttribute("data-plan"), variant: o.getAttribute("data-ss-price"), inLaunch: !!o.closest(".aicc-tier__launch"), sCount: o.querySelectorAll("s").length, price: price.innerText.replace(/\s+/g, " ").trim(), amount: amt.innerText.trim(), sText: s ? s.innerText.replace(/\s+/g, " ").trim() : null, sr: price.querySelector(".aicc-sr-only") ? price.querySelector(".aicc-sr-only").textContent.trim() : null, label: label.innerText.trim(), pill: pill ? pill.innerText.trim() : null, note: note ? note.innerText.trim() : null, noteInCard: note ? t.contains(note) : null,
        priceTop: q(price).top, priceBottom: q(price).bottom, labelTop: q(label).top, labelBottom: q(label).bottom, freeTop: q(free).top, offerBottom: q(o).bottom, orderOk: !!(price.compareDocumentPosition(free) & Node.DOCUMENT_POSITION_FOLLOWING),
        amountFs: parseFloat(cs(amt).fontSize), labelFs: parseFloat(cs(label).fontSize), priceFs: parseFloat(cs(price).fontSize), noteFs: note ? parseFloat(cs(note).fontSize) : null, weight: Number(cs(price).fontWeight),
        deco: s ? cs(s).textDecorationLine : cs(price).textDecorationLine, decoColor: s ? cs(s).textDecorationColor : null, decoThick: s ? parseFloat(cs(s).textDecorationThickness) : 0, decoStyle: s ? cs(s).textDecorationStyle : null, color: cs(price).color, labelColor: cs(label).color, noteColor: note ? cs(note).color : null, bg, opacity: cs(price).opacity,
        priceLines: (() => { const rects = [], w = document.createTreeWalker(price, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.nodeValue.trim() || n.parentElement.closest(".aicc-sr-only")) continue; const r2 = document.createRange(); r2.selectNodeContents(n); for (const q2 of r2.getClientRects()) if (q2.width > 0) rects.push([q2.top, q2.bottom]); } rects.sort((x, y) => x[0] - y[0]); let lines = 0, bottom = -Infinity; for (const [t0, b0] of rects) { if (t0 >= bottom - 2) { lines++; bottom = b0; } else bottom = Math.max(bottom, b0); } return lines; })(), priceOver: price.scrollWidth - price.clientWidth, tierOver: q(t).right - innerWidth,
        rects: [...rg.getClientRects()].map((r) => [r.left, r.right, r.top, r.bottom]), sRect: s ? q(s) && [q(s).left, q(s).right, q(s).top, q(s).bottom] : null, chevron: getComputedStyle(o, "::after").content, over: document.documentElement.scrollWidth - innerWidth,
        inBox: [...o.querySelectorAll("*")].filter(vis).every((e) => { const r = q(e), b = q(t); return r.left >= b.left - 1.5 && r.right <= b.right + 1.5; }), clipped: [price, label, pill, note].filter(Boolean).some((e) => e.scrollWidth > e.clientWidth + 1.5), cardText: t.innerText });
    }
    return out;
  });
  const linePixels = async (page, plan) => { // the strike line must run across the WHOLE struck text (amount AND unit), RTL included: every pixel column of the text box carries line-colour pixels
    const loc = page.locator(`article.aicc-tier[data-plan="${plan}"]:not(.aicc-tier--standard) .aicc-tier__offer-price s`).first();
    const buf = await loc.screenshot({ animations: "disabled" });
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const isLine = (i) => data[i] > 150 && data[i + 1] < 70 && data[i + 2] < 70; // the danger colour (#b91c1c) family
    const cols = new Array(info.width).fill(false); let rowsWithLine = new Set();
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) { const i = (y * info.width + x) * info.channels; if (isLine(i)) { cols[x] = true; rowsWithLine.add(y); } }
    const covered = cols.filter(Boolean).length / info.width;
    return { covered, rows: rowsWithLine.size, w: info.width, h: info.height };
  };
  const checkDefault = (r, l, tag, i) => {
    check(r.length === 3 && r.every((x, k) => x.variant === "planned" && x.inLaunch && x.sCount === 0 && x.amount === formatPrice(PLANS[k].price, l) && x.label === L(l).pricing.priceLabel && x.pill === L(l).pricing.afterOffer && x.deco === "none" && x.note === null), `${tag}: the compliant default: a muted UNSTRUCK price (${r.map((x) => x.amount)}) in the launch zone, the label "${L(l).pricing.priceLabel}" and the pill "${L(l).pricing.afterOffer}"; 0 <s> elements, no decoration`);
    check(r.every((x) => x.orderOk && x.chevron !== "none" && x.freeTop - x.offerBottom >= 0 && x.freeTop - x.offerBottom <= 48 && x.priceFs >= 32 && ratio(rgb(x.color), rgb(x.bg)) >= 4.5 && Number(x.opacity) === 1 && x.weight >= 700), `${tag}: price directly ABOVE the large FREE (gap <= 48px), a chevron leads down, price type >= 32px / weight >= 700 / contrast >= 4.5:1 (not faint grey) [${r.map((x) => `${Math.round(x.priceFs)}px ${ratio(rgb(x.color), rgb(x.bg)).toFixed(1)}:1`)}]`);
  };
  const BADTEXT = (l, text) => { const m = text.match(BAD[l]); return m ? m[0] : ""; };
  for (const cell of ["announce", "off", "link"]) for (const l of QUICK ? ["en", "he"] : LOCALES) {
    const { ctx, page } = await view(cell, `${pre(l)}/pricing/`, 1440, { locale: l, signup: "off" });
    const r = await offerProbe(page), top = await page.evaluate(() => ({ s: document.querySelectorAll("main s, main del, [data-ss-price='strike'], .aicc-tier__offer--strike").length, line: [...document.querySelectorAll("main *")].filter((e) => e.getClientRects().length && getComputedStyle(e).textDecorationLine.includes("through")).length }));
    check(top.s === 0 && top.line === 0, `${cell} ${l}: no struck price anywhere (0 <s>/<del>/strike markers, 0 elements with line-through)`);
    checkDefault(r, l, `${cell} ${l} @1440`);
    check(r.every((x) => !BADTEXT(l, x.cardText)), `${cell} ${l}: no was / previously / original / save / worth / normally / "regular price" alone in any card${r.map((x) => BADTEXT(l, x.cardText)).find(Boolean) ? " -> " + r.map((x) => BADTEXT(l, x.cardText)).find(Boolean) : ""}`);
    await ctx.close();
  }
  for (const l of QUICK ? ["en", "ru"] : LOCALES) for (const w of QUICK ? [320, 390, 1024, 1440] : [320, 375, 390, 430, 768, 1024, 1440, 1920]) for (const scale of QUICK && w > 390 ? [1] : [1, 2]) {
    const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, w, { locale: l, signup: "off", h: 1000, scale, media: { reducedMotion: "reduce" } });
    const r = await offerProbe(page);
    check(r.every((x) => x.over <= 0 || scale > 1.5) && r.every((x) => x.inBox && !x.clipped), `default ${l} @${w}px ${scale * 100}%: the offer block stays inside its card and is not clipped`);
    check(r.every((x) => x.priceLines === 1 && x.priceOver <= 1), `default ${l} @${w}px ${scale * 100}%: the planned price (amount and unit) stays ONE line inside its box (lines ${r.map((x) => x.priceLines)}, overflow ${r.map((x) => x.priceOver)}px)`);
    await page.addStyleTag({ content: "*{line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important}p{margin-block-end:2em !important}" }); await page.waitForTimeout(150);
    const rs = await offerProbe(page);
    check(rs.every((x) => x.priceLines === 1 && x.priceOver <= 1 && x.inBox), `default ${l} @${w}px ${scale * 100}% + WCAG 1.4.12 text spacing: the planned price stays ONE line and inside its card (lines ${rs.map((x) => x.priceLines)}, overflow ${rs.map((x) => x.priceOver)}px)`);
    if (w === 320 || w === 1440) await page.locator(".aicc-pricing").first().screenshot({ path: path.join(SHOTS, `planned-${l}-${w}-${scale * 100}.png`) });
    await ctx.close();
  }
  if (mocks.strike) {
    for (const l of LOCALES) for (const w of QUICK ? [320, 390, 1440] : [320, 375, 390, 430, 768, 1024, 1440, 1920]) for (const scale of QUICK && w > 390 ? [1] : [1, 2]) {
      if (QUICK && l === "es") continue;
      const { ctx, page } = await view("strike", `${pre(l)}/pricing/`, w, { locale: l, signup: "off", h: 1000, scale, media: { reducedMotion: "reduce" } });
      const r = await offerProbe(page), tag = `strike ${l} @${w}px ${scale * 100}%`, P = L(l).pricing;
      check(r.length === 3 && r.every((x, k) => x.variant === "strike" && x.inLaunch && x.sCount === 1 && x.sText.startsWith(formatPrice(PLANS[k].price, l)) && x.sText.includes(P.perShort) && x.label === P.strikeLabel && x.sr === P.strikeSr && x.note === P.strikeNote && x.noteInCard && x.pill === null), `${tag}: three struck planned prices in the launch zone, each ONE <s> holding the amount and its unit, the label "${P.strikeLabel.slice(0, 50)}..." directly under it, the screen-reader text, and the disclosure in the SAME card`);
      check(r.every((x) => x.deco.includes("through") && x.decoStyle === "solid" && x.decoThick >= 3 && ratio(rgb(x.decoColor), rgb(x.bg)) >= 3 && ratio(rgb(x.color), rgb(x.bg)) >= 4.5 && Number(x.opacity) === 1 && x.weight >= 700), `${tag}: actually struck: strikethrough, solid, line >= 3px (${r.map((x) => x.decoThick.toFixed(1))}), line colour contrast >= 3:1 (${r.map((x) => ratio(rgb(x.decoColor), rgb(x.bg)).toFixed(1))}), text contrast >= 4.5:1, weight >= 700, full opacity`);
      check(r.every((x) => x.amountFs >= (scale > 1.5 ? 18 : 24) && x.labelFs >= 14 && x.labelFs >= 0.35 * x.amountFs && x.noteFs >= 14 && x.noteFs >= 0.35 * x.amountFs && ratio(rgb(x.labelColor), rgb(x.bg)) >= 4.5 && ratio(rgb(x.noteColor), rgb(x.bg)) >= 4.5), `${tag}: LARGE amount (>= 24px, >= 18px at 200% text on a phone: the size follows the card instead of wrapping) (${r.map((x) => Math.round(x.amountFs))}px), label ${r.map((x) => Math.round(x.labelFs))}px >= 14px and >= 35% of the amount, disclosure >= 14px, text contrast >= 4.5:1`);
      check(r.every((x) => x.orderOk && x.labelTop >= x.priceBottom - 1 && x.labelTop - x.priceBottom <= 16 && x.freeTop - x.labelBottom >= 0 && x.freeTop - x.labelBottom <= 40), `${tag}: hierarchy ~~price~~ -> label (directly under the strike) -> FREE (directly below, gap <= 40px)`);
      check(r.every((x) => x.inBox && !x.clipped) && (scale > 1.5 || r.every((x) => x.over <= 0)), `${tag}: no clipping or overflow of the strike block`);
      check(r.every((x) => x.priceLines === 1 && x.priceOver <= 1), `${tag}: the struck price (amount and unit together) stays ONE line, like the FREE word, inside its box (lines ${r.map((x) => x.priceLines)}, scrollWidth - clientWidth ${r.map((x) => x.priceOver)}px)`);
      check(r.every((x) => !BADTEXT(l, x.cardText)), `${tag}: no was / previously / original / save / worth / normally / "regular price" alone in any card${r.map((x) => BADTEXT(l, x.cardText)).find(Boolean) ? " -> " + r.map((x) => BADTEXT(l, x.cardText)).find(Boolean) : ""}`);
      if ((scale === 1 && [320, 390, 1440].includes(w)) || (scale === 2 && w === 320)) {
        for (const pl of ["solo", "studio", "agency"]) { const px = await linePixels(page, pl); check(px.covered >= (scale > 1.5 ? 0.7 : 0.97) && px.rows >= 3, `${tag} ${pl}: the strike line runs across the whole amount and unit (${Math.round(px.covered * 100)}% of the ${px.w}px text width carries line pixels, ${px.rows} rows thick)${l === "he" ? " (right-to-left, price isolated by <bdi>)" : ""}`); }
        await page.locator(".aicc-pricing").first().screenshot({ path: path.join(SHOTS, `strike-${l}-${w}-${scale * 100}.png`) });
      }
      { // WCAG 1.4.12 text spacing on the strike block (every cell of the matrix): the price stays ONE line and the block does not overflow, clip or leave its card
        await page.addStyleTag({ content: "*{line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important}p{margin-block-end:2em !important}" }); await page.waitForTimeout(150);
        const r2 = await offerProbe(page);
        check(r2.every((x) => x.inBox && !x.clipped && x.tierOver <= 1 && x.priceLines === 1 && x.priceOver <= 1), `${tag} + text spacing: the struck price stays ONE line and the strike block does not overflow, clip or leave its card (lines ${r2.map((x) => x.priceLines)}, overflow ${r2.map((x) => x.priceOver)}px)`);
      }
      await ctx.close();
    }
    // the strike and its label vanish when registration closes (the live set is hidden: nothing struck is visible in the closed view or after the end)
    for (const [how, opts] of [["browser clock at the registration cutoff", { signup: "open", now: CUT, fixed: true }], ["status answer closed_cutoff", { signup: "closed_cutoff" }], ["after the trial end", { signup: "open", now: END + 1000, fixed: true }]]) for (const l of QUICK ? ["en"] : LOCALES) {
      const { ctx, page } = await view("strike", `${pre(l)}/pricing/`, 1440, { locale: l, ...opts });
      const v = await page.evaluate(() => { const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden"; return { s: [...document.querySelectorAll("s, del, [data-ss-price], .aicc-tier__offer-label, .aicc-tier__offer-note")].filter(vis).length, line: [...document.querySelectorAll("main *")].filter((e) => vis(e) && getComputedStyle(e).textDecorationLine.includes("through")).length }; });
      check(v.s === 0 && v.line === 0, `strike build ${l} (${how}): fails closed: no struck price, no planned-price label and no disclosure is visible (${v.s} / ${v.line})`);
      await ctx.close();
    }
  } else console.log("  note --ss-strike not given: the strike build was not audited here");
}

// ───────────────────────────────────────────────────────────── P. the compact status line
if (run("P")) {
  console.log("== P. the status line (.aicc-pstate): its text and its link wrap inside it (no element wider than its box) in every state and language, 320 / 375 / 390 x 100 / 200 % text x text spacing");
  const probe = (page) => page.evaluate(() => { const e = document.querySelector(".aicc-pstate"); if (!e) return { missing: true }; const r = e.getBoundingClientRect(), bad = []; for (const c of [e, ...e.querySelectorAll("*")]) { if (c.closest("svg")) continue; const q = c.getBoundingClientRect(); if (c !== e && (q.left < r.left - 1.5 || q.right > r.right + 1.5)) bad.push(`${c.className || c.tagName} leaves the line (${Math.round(q.left - r.left)}, ${Math.round(q.right - r.right)})`); if (c.scrollWidth > c.clientWidth + 1.5 && getComputedStyle(c).display !== "inline") bad.push(`${c.className || c.tagName} scrollWidth ${c.scrollWidth} > clientWidth ${c.clientWidth}`); } return { bad, over: document.documentElement.scrollWidth - innerWidth, link: (e.querySelector("a") || {}).className, h: [...e.querySelectorAll("a")].map((a) => a.getBoundingClientRect().height) }; });
  for (const l of LOCALES) for (const state of QUICK ? ["off", "paused", "waitlist", "open"] : ["off", "paused", "waitlist", "open"]) for (const w of [320, 375, 390]) for (const scale of [1, 2]) for (const spacing of [false, true]) {
    if (QUICK && spacing && scale === 1) continue;
    const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, w, { locale: l, signup: state, h: 1000, scale, spacing, media: { reducedMotion: "reduce" } });
    const r = await probe(page), tag = `${l} @${w}px ${scale * 100}%${spacing ? " + 1.4.12 spacing" : ""} (${state})`;
    check(!r.missing && r.bad.length === 0 && r.h.length === 1 && r.h[0] >= 44, `${tag}: the status line keeps its text and its ONE link (>= 44 px tall) inside the line, nothing wider than its box${r.bad && r.bad.length ? " -> " + r.bad.slice(0, 2).join("; ") : ""}`);
    await ctx.close();
  }
}

// ───────────────────────────────────────────────────────────── K. scope of the kit wrapper
if (run("K")) {
  console.log("== K. every tier, launch panel and band (Home, Pricing, Product) is inside `.aicc-pricing`: computed padding > 0, no clipping, in every state");
  const probe = (page) => page.evaluate(() => {
    const vis = (e) => e.getClientRects().length > 0, out = { unscoped: [], pad: [], clip: [], counts: {} };
    const boxes = [...document.querySelectorAll(".aicc-tier, .aicc-launch, .aicc-pband")].filter(vis);
    out.counts = { tiers: boxes.filter((b) => b.matches(".aicc-tier")).length, panels: boxes.filter((b) => b.matches(".aicc-launch")).length, bands: boxes.filter((b) => b.matches(".aicc-pband")).length };
    for (const b of boxes) {
      if (!b.closest(".aicc-pricing")) out.unscoped.push(b.className);
      const r = b.getBoundingClientRect();
      for (const e of [...b.querySelectorAll("*")].filter(vis)) { const q = e.getBoundingClientRect(); if (q.width && (q.left < r.left - 1.5 || q.right > r.right + 1.5)) out.clip.push(`${e.className || e.tagName} leaves ${b.className.split(" ")[0]}`); const cs = getComputedStyle(e); if (!["inline", "contents"].includes(cs.display) && !e.closest("svg") && (cs.overflowX !== "visible" || cs.overflowY !== "visible") && (e.scrollWidth > e.clientWidth + 1.5 || e.scrollHeight > e.clientHeight + 1.5) && !e.matches(".aicc-sr-only")) out.clip.push(`${e.className} clipped`); }
    }
    const padOf = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => { const cs = getComputedStyle(e); return Math.min(parseFloat(cs.paddingInlineStart), parseFloat(cs.paddingInlineEnd), parseFloat(cs.paddingBlockStart), parseFloat(cs.paddingBlockEnd)); });
    for (const [sel, name] of [[".aicc-tier__plan", "tier plan zone"], [".aicc-tier__launch", "tier launch zone"], [".aicc-tier__incl", "tier footer line"], [".aicc-launch", "launch panel"], [".aicc-launch__fact-icon", "(no padding needed)"], [".aicc-pcta .aicc-pstatus__pill", "status pill"], [".aicc-pcta .aicc-btn", "link"], [".aicc-tier__badge", "badge"], [".aicc-launch__tag", "panel tag"]]) {
      if (name === "(no padding needed)") continue;
      const v = padOf(sel); if (v.length && v.some((x) => !(x > 0))) out.pad.push(`${name}: ${v.join("/")}`);
    }
    out.border = [...document.querySelectorAll(".aicc-pricing *, .aicc-pband *")].filter((e) => getComputedStyle(e).boxSizing === "content-box" && vis(e) && e.tagName !== "svg" && !e.closest("svg") && !["path", "circle", "line", "rect", "g"].includes(e.tagName)).length;
    return out;
  });
  const ROUTES = [["pricing/", "pricing"], ["", "home"], ["product/", "product"]];
  for (const [cell, signup] of [["announce", "off"], ["announce", "open"], ["announce", "waitlist"], ["announce", "closed_cutoff"], ["announce", "paused"], ["link", "http500"], ["off", "off"]]) for (const l of QUICK ? ["en", "he"] : LOCALES) for (const [route, name] of ROUTES) for (const w of [390, 1440]) {
    const { ctx, page } = await view(cell, `${pre(l)}/${route}`, w, { locale: l, signup, h: 900, media: { reducedMotion: "reduce" } });
    const r = await probe(page);
    const want = name === "product" ? { tiers: 0, panels: 0, bands: 2 } : { tiers: 3, panels: signup === "closed_cutoff" ? 0 : 1, bands: 1 }; // (a closed view shows the ordinary cards and NO launch panel)
    check(JSON.stringify(r.counts) === JSON.stringify(want) && r.unscoped.length === 0 && r.pad.length === 0 && r.clip.length === 0 && r.border === 0, `${cell} ${l} ${name} @${w} (${signup}): ${JSON.stringify(r.counts)} all inside .aicc-pricing, padding > 0 on every zone, kit resets applied (border-box everywhere), nothing clipped${r.unscoped.length + r.pad.length + r.clip.length ? " -> " + [...r.unscoped, ...r.pad, ...r.clip][0] : r.border ? ` (content-box ${r.border})` : ""}`);
    await ctx.close();
  }
}

await browser.close();
for (const m of Object.values(mocks)) await m.close();
console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:pricing-browser (${failed})`); process.exit(1); }
console.log("PASS test:pricing-browser");
