// npm run test:selfservice-browser: the P37/P39/P40 self-service controls in real Chromium, against local exports and a local mock of GET /wp-json/aicc/v1/signup/status (nothing leaves 127.0.0.1).
//   node scripts/test-selfservice-browser.mjs --ss-off <dir> --ss-announce <dir> --ss-open <dir> --ss-link <dir> --shots <dir> [--port-base <n>]
//     (exports built with NEXT_PUBLIC_AICC_SELFSERVICE=on and the launch-offer switch unset | announce | open; --ss-link: the ANNOUNCE build made with NEXT_PUBLIC_AICC_SS_INITIAL=link;
//      --port-base: the four local servers listen on n .. n+3)
// P39 matrix. Static HTML of the default (coming_soon) build: every plan card carries the plain status text "Free trial registration opens soon" (<p role="status">), no sign-up link or button. A real link
// `/<lang>/start/?plan=<solo|studio|agency>` exists ONLY after the status answer open (label "Start free trial") or waitlist ("Join the waitlist"); closed_cutoff / paused / off show plain text; every failed or invalid
// answer (404, 500, malformed JSON, dropped, inconsistent, unknown mode) keeps the build's static state. The link build (initial=link) keeps its static link under failures.
// * layout + screenshots: Home and Pricing in four languages at 1440 and 390 px (Hebrew right-to-left: no overflow, logical properties, icon/text order), the Hero shows Try Live Demo and See Pricing;
// * the state matrix in the browser for both builds, one request per page load, no cookie, no hydration error; the Hero, the demo links and "Sign in" are identical in every state; no signup control ever targets #demo or /start/ while sign-up is not known to work;
// * "Get started" (header, menu, Product hero): the account page until open / waitlist, then the sign-up page;
// * clicking a card control in the open and waitlist states goes to {CP}/start/?plan=<id> in the page language (four languages, three plans); the closing bands and the plan finder follow the same table;
// * language switching preserves the page; keyboard: tab order and focus ring, the status text is not a tab stop; reduced motion; the ended view;
// * axe-core (WCAG 2.x A/AA + best-practice, colour contrast ON): zero violations on Home and Pricing, four languages, every state, desktop and mobile.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { launch } from "./lib/browser.mjs";
import { loadDictionaries, loadTs } from "./lib/load.mjs";
import { startMock } from "./lib/intake-mock.mjs";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? path.resolve(args[i + 1]) : undefined; };
const dirs = { off: arg("ss-off"), announce: arg("ss-announce"), open: arg("ss-open"), link: arg("ss-link") }, SHOTS = arg("shots");
const PB = (() => { const i = args.indexOf("--port-base"); return i >= 0 ? Number(args[i + 1]) : 0; })();
if (!dirs.off || !dirs.announce || !dirs.open || !dirs.link || !SHOTS) { console.error("usage: --ss-off <dir> --ss-announce <dir> --ss-open <dir> --ss-link <dir> --shots <dir> [--port-base <n>]"); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });
const D = await loadDictionaries();
const { PLANS } = await loadTs("src/data/plans.ts");
const LOCALES = ["en", "he", "es", "ru"];
const pre = (l) => (l === "en" ? "" : `/${l}`);
let failed = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { failed++; console.error("  FAIL " + msg); } else console.log("  ok   " + msg); };
const END = Date.UTC(2026, 11, 31, 22, 0, 0);
const REG_CLOSE = Date.UTC(2026, 11, 24, 0, 0, 0); // the registration cutoff 2026-12-24T00:00:00Z (CP REGISTRATION_CUTOFF_UNIX 1798070400)
const BEFORE_CUTOFF = Date.UTC(2026, 10, 20, 12); // every state test runs on a clock BEFORE the cutoff unless it says otherwise
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const startOf = (l, plan) => `https://www.copilt.org${l === "en" ? "" : `/${l}`}/start/${plan ? `?plan=${plan}` : ""}`;
const accountOf = (l) => `https://www.copilt.org${l === "en" ? "" : `/${l}`}/my-account/`;

const mocks = { off: await startMock({ dir: dirs.off, port: PB }), announce: await startMock({ dir: dirs.announce, port: PB ? PB + 1 : 0 }), open: await startMock({ dir: dirs.open, port: PB ? PB + 2 : 0 }), link: await startMock({ dir: dirs.link, port: PB ? PB + 3 : 0 }) };
const browser = await launch();
async function view(cell, route, w, { h = 900, locale = "en", signup = "open", delay = 0, cookie = false, block = true, now = BEFORE_CUTOFF, reduced = true } = {}) {
  const m = mocks[cell];
  m.reset(); m.set({ signup, signupDelayMs: delay });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? "reduce" : "no-preference", locale: locale === "he" ? "he-IL" : "en-US" });
  await ctx.clock.setFixedTime(new Date(now));
  if (cookie) await ctx.addCookies([{ name: "aicc_probe", value: "1", url: m.url }]);
  const nav = [], errors = [];
  if (block) await ctx.route("https://www.copilt.org/**", (r) => { nav.push(r.request().url()); return r.fulfill({ contentType: "text/html", body: "<html><body>control plane (intercepted)</body></html>" }); });
  const page = await ctx.newPage();
  // hydration or script errors (a failed status request is a network line, not a script error: those console lines are ignored)
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (c) => { if (c.type() === "error" && !/Failed to load resource|net::ERR|status of (4|5)\d\d/i.test(c.text())) errors.push(c.text()); });
  await page.goto(m.url + route, { waitUntil: "load" });
  await page.waitForTimeout(400);
  return { ctx, page, m, nav, errors };
}
/** The controls of a page's LIVE plan cards (P40 `article.aicc-tier`, not the ordinary cards of the ended view): sign-up links (a.aicc-btn), status regions (p.aicc-pstatus), demo links (must be none), dates (must be none), every button-looking element. */
const TIER = "article.aicc-tier:not(.aicc-tier--standard)";
const cards = (page) => page.evaluate((TIER) => [...document.querySelectorAll(TIER)].map((a) => {
  const vis = (e) => e.getClientRects().length > 0;
  const link = [...a.querySelectorAll("a.aicc-btn")].filter(vis).map((e) => ({ href: e.getAttribute("href"), text: e.innerText.replace(/\s+/g, " ").trim(), h: e.getBoundingClientRect().height, state: e.getAttribute("data-ss-state"), cls: e.className }));
  const st = [...a.querySelectorAll("p.aicc-pstatus")].filter(vis).map((e) => ({ tag: e.tagName, text: e.querySelector(".aicc-pstatus__label").innerText.replace(/\s+/g, " ").trim(), note: (e.querySelector(".aicc-pstatus__note") || { innerText: "" }).innerText.replace(/\s+/g, " ").trim(), state: e.getAttribute("data-ss-state"), role: e.getAttribute("role"), insideAction: !!e.closest("a,button"), cls: e.className, tabindex: e.getAttribute("tabindex"), cursor: getComputedStyle(e).cursor, h: e.getBoundingClientRect().height }));
  const demo = [...a.querySelectorAll("[data-ss-demo], a[href$='#demo']")].filter(vis).length;
  const btns = [...a.querySelectorAll(".aicc-btn, button")].filter(vis).length;
  const dates = [...a.querySelectorAll("[data-ss-date], [data-ss-dates]")].filter(vis).length;
  return { link, st, demo, btns, dates, plan: a.getAttribute("data-plan") };
}), TIER);
const SOON = (l) => D[l].ea.ss.cta.soon;

// ───────── layout, RTL and screenshots ─────────
console.log("== layout: Home and Pricing, four languages, 1440 and 390 px (he right-to-left); screenshots in " + SHOTS);
for (const cell of ["announce", "off", "open"]) for (const l of LOCALES) for (const w of [1440, 390]) {
  if (cell !== "announce" && l !== "en" && l !== "he") continue;
  for (const [name, route] of [["pricing", `${pre(l)}/pricing/`], ["home", `${pre(l)}/`]]) {
    if (cell !== "announce" && name === "home" && l !== "en" && l !== "he") continue;
    const { ctx, page } = await view(cell, route, w, { locale: l, h: w === 390 ? 844 : 900, signup: "off" });
    const g = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, dir: document.documentElement.dir }));
    check(g.sw <= g.iw && g.dir === (l === "he" ? "rtl" : "ltr"), `ss-${cell} ${l} ${name} @${w}: no horizontal scroll (${g.sw}<=${g.iw}), dir=${g.dir}`);
    const cs = await cards(page);
    check(cs.length === 3 && cs.every((c) => c.link.length === 0 && c.btns === 0 && c.st.length === 1 && c.st[0].tag === "P" && c.st[0].role === "status" && c.st[0].text === SOON(l) && !c.st[0].insideAction && c.demo === 0 && c.dates === 0), `ss-${cell} ${l} ${name} @${w}: three cards, each the plain status "${SOON(l)}" (no button, no link), no per-card demo link, no date line (the dates are said once, in the launch panel)`);
    // every card fits: nothing inside a card is wider than the card; the dates and the status never overflow
    const fit = await page.evaluate((TIER) => [...document.querySelectorAll(TIER)].map((a) => { const r = a.getBoundingClientRect(); return [...a.querySelectorAll("*")].filter((e) => e.getClientRects().length).every((e) => { const q = e.getBoundingClientRect(); return q.left >= r.left - 1 && q.right <= r.right + 1; }); }), TIER);
    check(fit.length === 3 && fit.every(Boolean), `ss-${cell} ${l} ${name} @${w}: every element of every card stays inside the card`);
    if (l === "he") {
      // right-to-left: the plan name starts at the right edge, the status icon sits right of its text, the card and the panel timeline are rtl (the first step, "registration closes", is on the right)
      const rtl = await page.evaluate((TIER) => { const a = document.querySelector(TIER), r = a.getBoundingClientRect(), nm = a.querySelector(".aicc-tier__name").getBoundingClientRect(), p = a.querySelector(".aicc-pstatus__pill"), ic = p.querySelector("svg").getBoundingClientRect(), tx = p.querySelector(".aicc-pstatus__label").getBoundingClientRect(), tl = [...document.querySelectorAll(".aicc-timeline__step")].map((e) => e.getBoundingClientRect()); return { cardDir: getComputedStyle(a).direction, nameRight: r.right - nm.right, nameLeft: nm.left - r.left, iconRight: ic.left >= tx.right - 1, tlFirstRight: tl.length === 2 && tl[0].left > tl[1].left || tl.length === 2 && tl[0].top < tl[1].top }; }, TIER);
      check(rtl.cardDir === "rtl" && rtl.nameRight < rtl.nameLeft && rtl.iconRight && rtl.tlFirstRight, `ss-${cell} he ${name} @${w}: RTL card: the plan name starts at the right edge, the status icon is right of its text, the timeline's first step is on the right [${JSON.stringify(rtl)}]`);
    }
    if (name === "home") {
      const hero = await page.evaluate(() => [...document.querySelectorAll(".aicc-hero-actions a")].filter((e) => e.closest(".aicc-hero--home")).map((e) => ({ href: e.getAttribute("href"), text: e.innerText.trim(), top: e.getBoundingClientRect().top, vis: e.getClientRects().length > 0 })));
      check(hero.length === 2 && hero.every((x) => x.vis && x.top < (w === 390 ? 844 : 900)) && hero[0].href === "#demo" && hero[0].text === D[l].home.hero.ctaDemo && hero[1].href === `${pre(l)}/pricing/`.replace(/^$/, "/"), `ss-${cell} ${l} home @${w}: Try Live Demo (#demo) and See Pricing are the two Hero actions, visible above the fold`);
    }
    // the screenshots: the Hero view (Home, viewport) and the plan cards section (element), so the cards, the trial lines, the launch panel with the two dates are visible
    if (name === "home") await page.screenshot({ path: path.join(SHOTS, `ss-${cell}-${l}-home-hero-${w}.png`) });
    await page.locator(name === "home" ? '[aria-labelledby="pricing-title"]' : '[aria-labelledby="plans-title"]').screenshot({ path: path.join(SHOTS, `ss-${cell}-${l}-${name}-plans-${w}.png`) });
    await ctx.close();
  }
}
{
  // the source of the self-service CSS uses logical properties only (no physical left/right)
  const css = fs.readFileSync("src/components/ss/Ss.tsx", "utf8").match(/export const SS_CSS = \[([\s\S]*?)\]\.join/)[1];
  const phys = css.match(/(?<![a-z-])(left|right)\s*:|margin-(left|right)|padding-(left|right)|border-(left|right)|text-align\s*:\s*(left|right)|float\s*:/g);
  check(!phys, `the self-service CSS uses logical properties only (no left / right / float)${phys ? " -> " + phys.join(", ") : ""}`);
  const kit = fs.readFileSync("brand/aicc-brand.css", "utf8"), kp = kit.slice(kit.indexOf("P40 PRICING BEGIN"), kit.indexOf("P40 PRICING END")).replace(/\/\*[\s\S]*?\*\//g, "");
  const kphys = kp.match(/(?<![a-z-])(left|right)\s*:|margin-(left|right)|padding-(left|right)|border-(left|right)|text-align\s*:\s*(left|right)|float\s*:/g);
  check(kp.length > 5000 && !kphys, `the kit's P40 pricing CSS uses logical properties only (no left / right / float)${kphys ? " -> " + kphys.join(", ") : ""}`);
}

// ───────── the state matrix in the browser ─────────
console.log("== state matrix: what each answer of GET /signup/status shows (default build: static = plain text; link build: static = link)");
const L = D.en.ea.ss.cta;
const FAIL_ANSWERS = ["http404", "http500", "badjson", "drop", "inconsistent", "unknown"];
const MATRIX = [
  ["open", "link", L.start], ["waitlist", "link", L.waitlist], ["closed_cutoff", "text", L.closed], ["paused", "text", L.paused], ["off", "text", L.soon],
  ...FAIL_ANSWERS.map((a) => [a, "static", null]),
];
for (const initial of ["coming_soon", "link"]) {
  const cell = initial === "link" ? "link" : "announce";
  for (const [answer, kind0, label0] of MATRIX) {
    const kind = kind0 === "static" ? (initial === "link" ? "link" : "text") : kind0, label = kind0 === "static" ? (initial === "link" ? L.start : L.soon) : label0;
    const { ctx, page, m, errors } = await view(cell, "/pricing/", 1440, { signup: answer, cookie: true });
    const cs = await cards(page);
    const tag = `${initial} build, answer ${answer}`;
    check(errors.length === 0, `${tag}: no hydration or script error on the page (${errors.slice(0, 1).join("; ") || "none"})`);
    const calls = m.calls("/signup/status", "GET");
    check(calls.length === 1 && calls[0].headers.cookie === "", `${tag}: exactly ONE status request, no cookie sent (credentials omitted)`);
    if (kind === "link") check(cs.every((c, i) => c.link.length === 1 && c.st.length === 0 && c.link[0].text.startsWith(label) && c.link[0].href === startOf("en", PLANS[i].id) && c.link[0].h >= 44 && c.link[0].state === (answer === "open" || answer === "waitlist" ? answer : "static") && c.link[0].cls.includes(PLANS[i].featured ? "aicc-btn--primary" : "aicc-btn--outline")), `${tag}: every card has ONE real link to /start/?plan=<id> labelled "${label}" (>= 44 px tall, Studio primary, the others outline)${["open", "waitlist"].includes(answer) ? "" : " (the static link of a build made after activation)"}`);
    else check(cs.every((c) => c.link.length === 0 && c.btns === 0 && c.st.length === 1 && c.st[0].tag === "P" && c.st[0].role === "status" && c.st[0].text === label && c.st[0].note.length > 10 && !c.st[0].insideAction && !/aicc-btn/.test(c.st[0].cls) && c.st[0].tabindex === null && c.st[0].cursor !== "pointer"), `${tag}: every card shows the non-interactive STATUS "${label}" with its explanation: no link, no button, not inside an action, not focusable`);
    // no card carries a demo link or a date; the Hero, "Sign in" and the demo links never change
    check(cs.every((c) => c.demo === 0 && c.dates === 0), `${tag}: no card carries a demo link or a date line (the dates are said once, in the launch panel)`);
    const stay = await page.evaluate((startRe) => ({ hero: [...document.querySelectorAll("a")].filter((a) => a.getAttribute("href") === "#demo" || a.getAttribute("href") === "/pricing/").length, signIn: [...document.querySelectorAll("header a")].filter((a) => a.getAttribute("href") === "https://www.copilt.org/my-account/").length, demoAsSignup: [...document.querySelectorAll("a")].filter((a) => /#demo/.test(a.getAttribute("href") || "") && new RegExp(startRe, "i").test(a.innerText)).length }), `^(${[L.start, L.waitlist].join("|")})`);
    check(stay.hero >= 2 && stay.signIn >= 2 && stay.demoAsSignup === 0, `${tag}: the Hero links (#demo, /pricing/) and "Sign in" are unchanged, and no link to #demo is labelled as a sign-up`);
    // "Get started": the account page until the answer is open / waitlist (or the static link of a link build)
    const gs = await page.evaluate(() => [...document.querySelectorAll("header [data-ss-getstarted]")].map((a) => a.getAttribute("href")));
    const wantGs = (kind === "link") ? startOf("en") : accountOf("en");
    check(gs.length >= 2 && gs.every((h) => h === wantGs), `${tag}: the header "Get started" (desktop and menu) leads to ${wantGs}`);
    // never a /start/ link unless the answer allows it
    const startLinks = await page.evaluate(() => [...document.querySelectorAll("a")].filter((a) => /\/start\//.test(a.getAttribute("href") || "")).length);
    check(kind === "link" ? startLinks >= 3 : startLinks === 0, `${tag}: ${kind === "link" ? "the sign-up links exist" : "NO <a> to /start/ exists anywhere on the page"} (${startLinks})`);
    await ctx.close();
  }
}
console.log("== the same table in every language (open, waitlist, closed_cutoff, paused, off) on Pricing and on the Home closing band");
for (const l of LOCALES) for (const [answer, kind, key] of [["open", "link", "start"], ["waitlist", "link", "waitlist"], ["closed_cutoff", "text", "closed"], ["paused", "text", "paused"], ["off", "text", "soon"]]) {
  const lab = D[l].ea.ss.cta[key];
  const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1440, { signup: answer, locale: l });
  const cs = await cards(page);
  check(kind === "link" ? cs.every((c, i) => c.link.length === 1 && c.link[0].text.startsWith(lab) && c.link[0].href === startOf(l, PLANS[i].id)) : cs.every((c) => c.link.length === 0 && c.st.length === 1 && c.st[0].text === lab), `${l} ${answer}: cards show "${lab}" as ${kind === "link" ? "a link to " + startOf(l) : "a status region"}`);
  if (["closed_cutoff", "waitlist", "open"].includes(answer)) await page.locator('[aria-labelledby="plans-title"]').screenshot({ path: path.join(SHOTS, `ss-announce-${l}-pricing-plans-${answer}-1440.png`) });
  await ctx.close();
  const home = await view("announce", `${pre(l)}/`, 1440, { signup: answer, locale: l });
  const band = await home.page.evaluate(() => { const s = document.querySelector('[aria-labelledby="final-title"]'); return { a: [...s.querySelectorAll("a")].map((x) => ({ href: x.getAttribute("href"), text: x.innerText.trim() })), st: [...s.querySelectorAll("p.aicc-pstatus .aicc-pstatus__label")].map((x) => x.innerText.trim()), dates: s.querySelectorAll("[data-ss-date]").length }; });
  check(band.dates === 0 && (kind === "link" ? band.a.some((x) => x.href === startOf(l) && x.text.startsWith(lab)) : (!band.a.some((x) => /\/start\//.test(x.href)) && band.st.length === 1 && band.st[0] === lab)) && band.a.some((x) => x.href === "#demo"), `${l} ${answer}: the Home closing band follows the same table (${kind === "link" ? "sign-up link" : `status region "${lab}"`}), carries no date and keeps Try Live Demo`);
  await home.ctx.close();
}
console.log("== a slow answer: the static state works at once, the state arrives later");
{
  const { ctx, page, m } = await view("announce", "/pricing/", 1440, { signup: "open", delay: 1500 });
  const before = await cards(page);
  check(before.every((c) => c.link.length === 0 && c.st.length === 1 && c.st[0].text === L.soon), "before the answer (1.5 s delay) every card is the plain status (nothing clickable that could be wrong)");
  await page.waitForTimeout(1900);
  const after = await cards(page);
  check(m.calls("/signup/status", "GET").length === 1 && after.every((c, i) => c.link.length === 1 && c.link[0].href === startOf("en", PLANS[i].id)), "after the answer open the cards become the sign-up links (one request)");
  await ctx.close();
}

// ───────── navigation ─────────
console.log("== open: clicking each card goes to {CP}/start/?plan=<id> in the page language; waitlist: 'Join the waitlist' goes there too");
for (const l of LOCALES) for (const answer of ["open", "waitlist"]) {
  const { ctx, page, nav } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: answer });
  for (const [i, pl] of PLANS.entries()) {
    await page.goto(mocks.announce.url + `${pre(l)}/pricing/`, { waitUntil: "load" });
    await page.waitForSelector("article.aicc-tier:not(.aicc-tier--standard) a.aicc-btn");
    nav.length = 0;
    const label = await page.locator("article.aicc-tier:not(.aicc-tier--standard) a.aicc-btn").nth(i).innerText();
    await page.locator("article.aicc-tier:not(.aicc-tier--standard) a.aicc-btn").nth(i).click();
    await page.waitForTimeout(250);
    check(nav.length >= 1 && nav[0] === startOf(l, pl.id) && label.startsWith(D[l].ea.ss.cta[answer === "open" ? "start" : "waitlist"]), `${l} ${answer}: the ${pl.id} card ("${label.split("\n")[0]}") requests ${startOf(l, pl.id)} (${nav[0]})`);
  }
  await ctx.close();
}
for (const l of LOCALES) {
  const { ctx, page, nav } = await view("link", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "http500" });
  for (const [i, pl] of PLANS.entries()) {
    await page.goto(mocks.link.url + `${pre(l)}/pricing/`, { waitUntil: "load" });
    await page.waitForTimeout(250);
    nav.length = 0;
    await page.locator("article.aicc-tier:not(.aicc-tier--standard) a.aicc-btn").nth(i).click();
    await page.waitForTimeout(250);
    check(nav.length >= 1 && nav[0] === startOf(l, pl.id), `${l} link build: the ${pl.id} button requests ${startOf(l, pl.id)} (${nav[0]})`);
  }
  await ctx.close();
}
for (const answer of ["open", "waitlist"]) {
  const { ctx, page } = await view("announce", "/product/", 1440, { signup: answer });
  const hero = await page.evaluate(() => [...document.querySelectorAll(".aicc-hero-actions [data-ss-getstarted]")].map((a) => a.getAttribute("href")));
  check(hero.length === 1 && hero[0] === startOf("en"), `${answer}: the Product "Get started" leads to ${startOf("en")} (${hero})`);
  await ctx.close();
}
{
  const { ctx, page } = await view("announce", "/product/", 1440, { signup: "off" });
  const hero = await page.evaluate(() => [...document.querySelectorAll(".aicc-hero-actions [data-ss-getstarted]")].map((a) => a.getAttribute("href")));
  check(hero.length === 1 && hero[0] === accountOf("en"), `off: the Product "Get started" leads to the account page ${accountOf("en")} (${hero})`);
  await ctx.close();
}
{
  const { ctx, page } = await view("announce", "/", 1440);
  await page.locator('.aicc-hero--home a[href="#demo"]').first().click();
  await page.waitForTimeout(400);
  check(page.url().endsWith("#demo") && (await page.evaluate(() => { const e = document.getElementById("demo"); const r = e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; })), "Hero Try Live Demo scrolls to #demo with self-service on");
  await ctx.close();
}
console.log("== P40: NO card carries a Try Live Demo link (the per-card links are retired); the Hero's Try Live Demo is the demo action");
for (const l of LOCALES) {
  const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "off" });
  const r = await page.evaluate((TIER) => ({ demoInCards: [...document.querySelectorAll(TIER + " a, " + TIER + " [data-ss-demo]")].filter((e) => e.matches("[data-ss-demo], a[href$='#demo']") || /Try Live Demo/i.test(e.innerText)).length, band: [...document.querySelectorAll('[aria-labelledby="pricing-final"] a[href$="#demo"]')].length }), TIER);
  check(r.demoInCards === 0, `${l}: no per-card demo link on Pricing (${r.demoInCards}); the closing band may keep ONE demo action (${r.band})`);
  await ctx.close();
}
console.log("== the interactive demo still works with self-service on (the #demo section renders and its tabs / controls respond)");
{
  const { ctx, page } = await view("announce", "/", 1440, { signup: "off" });
  await page.locator("#demo").scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => document.querySelector("#demo").innerText.length);
  const tabs = page.locator('#demo [role="tab"]');
  const n = await tabs.count();
  let changed = false;
  if (n >= 2) { const panel = () => page.locator("#demo").getByRole("tabpanel").first().innerText().catch(() => ""); const first = await panel(); await tabs.nth(1).click(); await page.waitForTimeout(300); const second = await panel(); changed = first !== second; }
  const btn = page.locator('#demo button').first();
  const hasBtn = (await btn.count()) > 0;
  check(before > 200 && (changed || hasBtn), `the #demo section renders and responds (text ${before} chars, tabs: ${n}, a tab switch changes the panel: ${changed}, controls present: ${hasBtn})`);
  await ctx.close();
}

// ───────── language switching ─────────
console.log("== language switching keeps the page and the state");
for (const [from, to, route] of [["en", "he", "pricing"], ["he", "es", "pricing"], ["es", "ru", "pricing"], ["ru", "en", "pricing"], ["en", "ru", ""], ["he", "en", ""], ["en", "es", "product"]]) {
  const { ctx, page } = await view("announce", `${pre(from)}/${route ? route + "/" : ""}`, 1440, { locale: from, signup: "off" });
  await page.locator(".aicc-site-header .aicc-lang__btn").first().click();
  await page.locator(`.aicc-site-header .aicc-lang__item[data-lang="${to}"]`).first().click();
  await page.waitForLoadState("load");
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ path: location.pathname, lang: document.documentElement.lang, dir: document.documentElement.dir }));
  const want = `${pre(to)}/${route ? route + "/" : ""}`;
  const cs = route === "product" ? [] : await cards(page);
  check(r.path === want && r.lang.startsWith(to) && (route === "product" || (cs.length === 3 && cs.every((c) => c.st.length === 1 && c.st[0].text === SOON(to)))), `${from} -> ${to} on /${route}: lands on ${want}, html lang ${r.lang}, dir ${r.dir}${route === "product" ? "" : `, cards in ${to} ("${SOON(to)}")`}`);
  await ctx.close();
}

// ───────── P39 round 2 (M1): the registration cutoff by the browser clock ─────────
console.log("== from 2026-12-24T00:00:00Z the browser clock alone forces the closed text: no link, whatever the build or the status answer says");
for (const [cell, initial] of [["announce", "coming_soon"], ["link", "link"]]) for (const answer of ["off", "http500", "badjson", "open", "waitlist", "closed_cutoff"]) {
  const { ctx, page } = await view(cell, "/pricing/", 1440, { signup: answer, now: REG_CLOSE + 1000 });
  const cs = await cards(page);
  check(cs.every((c) => c.link.length === 0 && c.btns === 0 && c.st.length === 1 && c.st[0].text === L.closed && c.st[0].state === "closed_cutoff" && c.st[0].role === "status" && !c.st[0].insideAction), `${initial} build, answer ${answer}, clock 2026-12-24T00:00:01Z: every card shows the plain text "${L.closed}" (no link, no button)`);
  const gs = await page.evaluate(() => [...document.querySelectorAll("[data-ss-getstarted]")].map((a) => a.getAttribute("href")));
  const links = await page.evaluate(() => [...document.querySelectorAll("a")].filter((a) => /\/start\//.test(a.getAttribute("href") || "")).length);
  check(gs.length >= 2 && gs.every((h) => h === accountOf("en")) && links === 0, `${initial} build, answer ${answer}, after the cutoff: "Get started" leads to the account page and NO link to /start/ exists (${links})`);
  await ctx.close();
}
for (const l of LOCALES) {
  const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "open", now: REG_CLOSE + 1000 });
  const cs = await cards(page);
  await page.locator("#plan-stores").fill("2"); await page.waitForTimeout(250);
  const f = await page.evaluate(() => { const fm = document.querySelector("#plan-stores").closest("form"); return { a: fm.querySelectorAll("a.aicc-btn").length, st: [...fm.querySelectorAll("p.aicc-pstatus .aicc-pstatus__label")].map((e) => e.innerText.trim()) }; });
  const band = await page.evaluate(() => { const sec = document.querySelector('[aria-labelledby="pricing-final"]'); return { a: [...sec.querySelectorAll("a")].filter((x) => /\/start\//.test(x.getAttribute("href") || "")).length, st: [...sec.querySelectorAll("p.aicc-pstatus .aicc-pstatus__label")].map((e) => e.innerText.trim()) }; });
  check(cs.every((c) => c.link.length === 0 && c.st.length === 1 && c.st[0].text === D[l].ea.ss.cta.closed) && f.a === 0 && f.st.length === 1 && f.st[0] === D[l].ea.ss.cta.closed && band.a === 0 && band.st.length === 1 && band.st[0] === D[l].ea.ss.cta.closed, `${l}: a late status answer "open" after the cutoff never makes a link: cards, finder and band all say "${D[l].ea.ss.cta.closed}"`);
  await ctx.close();
}
{
  // the boundary: the last millisecond before the cutoff is still open
  const before = await view("announce", "/pricing/", 1440, { signup: "open", now: REG_CLOSE - 1 });
  const cb = await cards(before.page);
  check(cb.every((c, i) => c.link.length === 1 && c.link[0].href === startOf("en", PLANS[i].id)), "2026-12-23T23:59:59.999Z with the answer open: the cards are still links (the server accepts now < cutoff)");
  await before.ctx.close();
  const pr = await view("announce", "/product/", 1440, { signup: "open", now: REG_CLOSE + 1000 });
  const g = await pr.page.evaluate(() => [...document.querySelectorAll(".aicc-hero-actions [data-ss-getstarted]")].map((a) => a.getAttribute("href")));
  check(g.length === 1 && g[0] === accountOf("en"), "after the cutoff the Product \"Get started\" leads to the account page even when the answer is open");
  await pr.ctx.close();
}

// ───────── P39 round 2 (H2): the Product page ended view ─────────
console.log("== after the trial end instant the Product page shows the ordinary bands and Get started (failing status, clock 2026-12-31T22:00:01Z)");
for (const l of ["en", "he", "es", "ru"]) {
  const { ctx, page } = await view("announce", `${pre(l)}/product/`, 1440, { locale: l, signup: "http500", now: END + 1000 });
  const r = await page.evaluate(() => {
    const vis = (e) => e.getClientRects().length > 0;
    const band = (id) => { const s = document.querySelector(`[aria-labelledby="${id}"]`); return { ss: [...s.querySelectorAll("[data-ss-band],[data-ss-state],[data-ss-dates]")].filter(vis).length, primary: [...s.querySelectorAll("a.aicc-btn--primary")].filter(vis).map((a) => a.getAttribute("href")), contact: [...s.querySelectorAll("a[href^='mailto:']")].filter(vis).length }; };
    return { b1: band("safety-cta"), b2: band("product-final"), live: [...document.querySelectorAll("main [data-ss-getstarted],main [data-ss-band],main [data-ss-state],main [data-ss-dates],main [data-ss-terms]")].filter(vis).length, gs: [...document.querySelector(".aicc-hero-actions").querySelectorAll("a.aicc-btn--primary")].filter(vis).map((a) => a.getAttribute("href")) };
  });
  check(r.live === 0 && r.b1.ss === 0 && r.b2.ss === 0 && r.b1.primary.length === 1 && r.b2.primary.length === 1 && r.b1.contact >= 1 && r.b2.contact >= 1 && r.gs.length === 1 && r.gs[0] === accountOf(l), `${l} /product/ after the end: no trial band, no date line, no status text and no sign-up "Get started" is visible; the ordinary bands (See pricing + contact) and the ordinary Get started (${accountOf(l)}) are [${JSON.stringify(r)}]`);
  await ctx.close();
}

// ───────── P39 round 2 (M3): one status request per full page load, none for client-side navigation within the TTL ─────────
console.log("== client-side navigation reuses the status answer (one request per full page load)");
for (const l of ["en", "he"]) {
  const { ctx, page, m } = await view("announce", `${pre(l)}/`, 1440, { locale: l, signup: "open" });
  await page.evaluate(() => { window.__fullLoad = 1; });
  const hops = [`${pre(l)}/pricing/`, `${pre(l)}/product/`, `${pre(l)}/`];
  const marks = [];
  for (const h of hops) {
    await page.locator(`.aicc-site-header a[href="${h}"], .aicc-site-header__links a[href="${h}"]`).first().click();
    await page.waitForFunction((p) => location.pathname === p, h);
    await page.waitForTimeout(500);
    marks.push(await page.evaluate(() => window.__fullLoad === 1));
  }
  const n = m.calls("/signup/status", "GET").length;
  check(marks.every(Boolean) && n === 1, `${l}: Home -> Pricing -> Product -> Home by client-side navigation (no full reload: ${marks}) makes ONE status request in total (${n})`);
  const cs = await (async () => { await page.goto(m.url + `${pre(l)}/pricing/`, { waitUntil: "load" }); await page.waitForTimeout(400); return cards(page); })();
  check(cs.every((c) => c.link.length === 1) && m.calls("/signup/status", "GET").length === 2, `${l}: a new full page load makes exactly one more request (${m.calls("/signup/status", "GET").length})`);
  await ctx.close();
}

// ───────── P39 round 2 (M2): no horizontal scroll on phones, Russian included ─────────
console.log("== no horizontal scroll at 320 / 360 / 390 px (also with Larger text) on Home, Pricing and Product, four languages");
for (const [w, large] of [[320, false], [320, true], [360, false], [390, false]]) for (const l of LOCALES) for (const route of ["", "pricing/", "product/"]) {
  const { ctx, page } = await view("announce", `${pre(l)}/${route}`, w, { h: 800, locale: l, signup: "off" });
  if (large) { await page.evaluate(() => document.documentElement.setAttribute("data-aicc-text", "large")); await page.waitForTimeout(200); }
  const r = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, cards: [...document.querySelectorAll("article.aicc-tier")].filter((a) => a.getBoundingClientRect().right > innerWidth + 1 || a.getBoundingClientRect().left < -1 || a.scrollWidth > a.clientWidth + 1).length }));
  check(r.over <= 0 && r.cards === 0, `${l} /${route} @${w}${large ? " + Larger text" : ""}: no horizontal scroll (+${r.over}px) and every plan card fits (${r.cards} overflowing)`);
  await ctx.close();
}

// ───────── the ended view (a launch-offer build loaded after the end instant) ─────────
console.log("== after the end instant (a stale page of a launch-offer + self-service build): the ordinary ended view, no sign-up promise");
for (const l of ["en", "he"]) {
  const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, now: END + 1000 });
  const r = await page.evaluate(() => { const vis = (e) => e.getClientRects().length > 0; return { cardLinks: [...document.querySelectorAll("article.aicc-tier a")].filter(vis).length, chips: [...document.querySelectorAll("article.aicc-tier--standard [data-commerce='closed']")].filter(vis).length, std: [...document.querySelectorAll("article.aicc-tier--standard")].filter(vis).length, live: [...document.querySelectorAll("article.aicc-tier:not(.aicc-tier--standard)")].filter(vis).length, bar: [...document.querySelectorAll(".aicc-eabar")].filter(vis).length, trial: [...document.querySelectorAll("[data-ss-checks],[data-ss-terms],[data-ss-band],[data-ss-dates],[data-ss-state],[data-ss-demo],[data-ss-free],.aicc-launch,.aicc-pband")].filter(vis).length, titleClosed: document.querySelector(".aicc-pricing__title").innerText.trim() }; });
  check(r.cardLinks === 0 && r.chips === 3 && r.std === 3 && r.live === 0 && r.bar === 0 && r.trial === 0 && r.titleClosed === D[l].ea.ss.pricing.titleClosed, `${l}: after 2026-12-31T22:00:00Z a stale self-service + announce page shows the ordinary ended view (three ordinary cards with "purchases open soon", the closed header "${D[l].ea.ss.pricing.titleClosed}", no sign-up control, no trial text, no panel, no dates, no bar) [${JSON.stringify(r)}]`);
  await ctx.close();
}

// ───────── the plan finder ─────────
console.log("== plan finder (Which plan?): the suggestion is the plan, its paid capacity and the same control as the cards: no dates, no trial conditions");
for (const l of LOCALES) {
  const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "off" });
  await page.locator("#plan-stores").fill("2");
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => { const f = document.querySelector("#plan-stores").closest("form"); return { a: [...f.querySelectorAll("a.aicc-btn")].length, soon: f.querySelectorAll(".aicc-btn--soon").length, st: [...f.querySelectorAll("p.aicc-pstatus .aicc-pstatus__label")].map((e) => e.innerText.trim()), dates: f.querySelectorAll("[data-ss-date], [data-ss-dates]").length, cap: (f.querySelector("[data-ss-finder-cap]") || { innerText: "" }).innerText.trim(), text: f.innerText.replace(/\s+/g, " ") }; });
  const ss = D[l].ea.ss, conds = [ss.launch.fact.store, ss.launch.fact.payment, ss.launch.fact.noAuto, ss.plan.regLabel, ss.plan.endLabel].map((x) => x.replace(/\u00a0/g, " "));
  check(r.a === 0 && r.soon === 0 && r.st.length === 1 && r.st[0] === SOON(l) && r.dates === 0 && r.cap === ss.plan.paidMany.replace("{n}", "3") && conds.every((c) => !r.text.includes(c)) && !/UTC|Dec 2|2026/.test(r.text), `${l}: 2 stores -> ${D[l].pricing.plans.studio.name}: the finder shows the plan, its paid capacity ("${ss.plan.paidMany.replace("{n}", "3")}") and the status region only (no date, no trial condition, no button, no inert chip)`);
  await ctx.close();
}
for (const l of ["en", "he"]) {
  const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "open" });
  await page.locator("#plan-stores").fill("2");
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => { const f = document.querySelector("#plan-stores").closest("form"); return { a: [...f.querySelectorAll("a.aicc-btn")].map((e) => e.getAttribute("href")), soon: f.querySelectorAll(".aicc-btn--soon").length }; });
  check(r.a.length === 1 && r.a[0] === startOf(l, "studio") && r.soon === 0, `${l}: open: 2 stores -> Studio -> the finder offers ${startOf(l, "studio")} (${r.a.join(", ")})`);
  await ctx.close();
}

// ───────── keyboard, reduced motion, status semantics ─────────
console.log("== keyboard: Tab order and focus ring; the status text is not a tab stop; reduced motion");
async function tabs(page, max = 120, stop = 0, pick = () => false) {
  const seq = [];
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    seq.push(await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); return { href: e.getAttribute("href"), cls: e.className, text: (e.innerText || "").trim().slice(0, 40), inCard: !!e.closest("article.aicc-tier"), demo: false, ring: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none" }; }));
    if (stop && seq.filter((x) => x && pick(x)).length >= stop) break;
  }
  return seq.filter(Boolean);
}
for (const l of ["en", "he"]) {
  // static state: NO tab stop inside the cards (the status regions are not focusable and the per-card demo links are gone)
  const a = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "off" });
  const seq = await tabs(a.page, 160);
  check(seq.filter((s) => s.inCard).length === 0, `${l} static: Tab never lands inside a plan card (the status region is not a tab stop; no per-card demo link) [${seq.filter((s) => s.inCard).length}]`);
  await a.ctx.close();
  // open: ONE sign-up link per card, in the DOM order solo, studio, agency, each with a visible focus ring
  const o = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "open" });
  const seq2 = await tabs(o.page, 200, 3, (s) => s.inCard);
  const c2 = seq2.filter((s) => s.inCard);
  check(c2.length === 3 && [0, 1, 2].every((k) => /aicc-btn/.test(c2[k].cls) && c2[k].href === startOf(l, PLANS[k].id)) && c2.every((s) => s.ring), `${l} open: Tab order = the sign-up link of Solo, Studio, Agency (one stop per card), every stop with a visible focus ring`);
  await o.ctx.close();
}
{
  const { ctx, page } = await view("announce", "/pricing/", 1440, { signup: "closed_cutoff" });
  const seq = await tabs(page, 90);
  check(seq.filter((s) => s.inCard).length === 0, "closed_cutoff: no card control is a tab stop (the state is a status region)");
  await ctx.close();
}
{
  const { ctx, page } = await view("announce", "/pricing/", 1440, { signup: "off", reduced: true });
  const r = await page.evaluate(() => { const els = [...document.querySelectorAll(".aicc-tier, .aicc-tier *, .aicc-launch, .aicc-launch *, .aicc-pband, .aicc-pband *")]; const dur = (e) => Math.max(...getComputedStyle(e).transitionDuration.split(",").map((x) => parseFloat(x) || 0)); return { n: els.length, anim: els.filter((e) => getComputedStyle(e).animationName !== "none").length, trans: els.filter((e) => dur(e) > 0.001).length, motion: matchMedia("(prefers-reduced-motion: reduce)").matches }; });
  check(r.motion && r.n >= 100 && r.anim === 0 && r.trans === 0, `reduced motion: the cards, the launch panel and the band have no animation and no transition longer than 1 ms (${r.n} elements)`);
  await ctx.close();
}
{
  const { ctx, page } = await view("announce", "/pricing/", 1440, { signup: "paused" });
  const r = await page.evaluate(() => { const p = document.querySelector("article.aicc-tier p.aicc-pstatus"), pill = p.querySelector(".aicc-pstatus__pill"), cs = getComputedStyle(pill), icon = pill.querySelector("svg"); return { role: p.getAttribute("role"), tag: p.tagName, borderStyle: cs.borderTopStyle, radius: parseFloat(cs.borderTopLeftRadius), cursor: getComputedStyle(p).cursor, disabled: p.getAttribute("aria-disabled"), isBtn: !!p.closest("a,button"), icon: !!icon && icon.getAttribute("aria-hidden") === "true", note: !!p.querySelector(".aicc-pstatus__note"), minH: pill.getBoundingClientRect().height }; });
  check(r.role === "status" && r.tag === "P" && r.borderStyle === "dashed" && r.radius >= 20 && r.cursor !== "pointer" && r.disabled === null && !r.isBtn && r.icon && r.note && r.minH >= 44, `the status region is a dashed, tinted, non-interactive pill with an icon and an explanation line (different from an enabled button by shape, fill, icon and text, not colour only) [${JSON.stringify(r)}]`);
  await ctx.close();
}

// ───────── accessibility ─────────
console.log("== accessibility: axe-core (colour contrast on), Home and Pricing, four languages, every state, desktop and mobile");
async function axe(page) {
  await page.evaluate(axeSource);
  return page.evaluate(async (tags) => { const x = await axe.run(document, { runOnly: { type: "tag", values: tags } }); return x.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0].target.join(" ")})`); }, TAGS);
}
for (const l of LOCALES) for (const [name, route] of [["pricing", `${pre(l)}/pricing/`], ["home", `${pre(l)}/`]]) for (const signup of ["off", "open", "waitlist", "closed_cutoff", "paused"]) {
  const { ctx, page } = await view("announce", route, 1440, { locale: l, signup });
  const r = await axe(page);
  check(r.length === 0, `axe ${l} ${name} @1440 (${signup}): zero violations${r.length ? " -> " + r.join(", ") : ""}`);
  await ctx.close();
}
for (const l of LOCALES) for (const [name, route] of [["pricing", `${pre(l)}/pricing/`], ["home", `${pre(l)}/`]]) for (const signup of ["off", "open"]) {
  const { ctx, page } = await view("announce", route, 390, { h: 844, locale: l, signup });
  const r = await axe(page);
  check(r.length === 0, `axe ${l} ${name} @390 (${signup}): zero violations${r.length ? " -> " + r.join(", ") : ""}`);
  await ctx.close();
}
for (const [cell, route] of [["link", "/pricing/"], ["off", "/pricing/"], ["open", "/"], ["announce", "/product/"], ["announce", "/he/product/"]]) {
  const { ctx, page } = await view(cell, route, 1440, { signup: "waitlist" });
  const r = await axe(page);
  check(r.length === 0, `axe ss-${cell} ${route} @1440 (waitlist): zero violations${r.length ? " -> " + r.join(", ") : ""}`);
  await ctx.close();
}

await browser.close();
for (const m of Object.values(mocks)) await m.close();
console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:selfservice-browser (${failed})`); process.exit(1); }
console.log("PASS test:selfservice-browser");
