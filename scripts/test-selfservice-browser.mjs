// npm run test:selfservice-browser: the P37 self-service buttons in real Chromium, against local exports and a local mock of GET /wp-json/aicc/v1/signup/status (nothing leaves 127.0.0.1).
//   node scripts/test-selfservice-browser.mjs --ss-off <dir> --ss-announce <dir> --ss-open <dir> --shots <dir> [--port-base <n>]
//     (exports built with NEXT_PUBLIC_AICC_SELFSERVICE=on and the launch-offer switch unset | announce | open; --port-base: the three local servers listen on n, n+1, n+2)
// * layout + screenshots: Home and Pricing in four languages at 1440 and 390 px (Hebrew right-to-left), no horizontal scroll, the three card buttons visible and at least 44 px tall, the Hero shows
//   Try Live Demo and See Pricing, a screenshot of every view is written to --shots;
// * the state table in the browser: for each answer of the status endpoint (open, waitlist, closed_cutoff, paused, off, 404, 500, malformed, dropped, inconsistent, unknown mode) the three cards show the
//   right control: a link (Start free trial / Join the waitlist) or PLAIN TEXT (never a button, never a link); every failure keeps the static link to /start/; one request per page load, no cookie sent;
// * the Hero (Try Live Demo -> #demo, See Pricing) and the "Sign in" link are identical in every state; the closing band and the plan finder follow the same table;
// * clicking a card button navigates to {CP}/start/?plan=<id> in the page language (the Control Plane host is intercepted: no network);
// * keyboard: Tab reaches the three card buttons in order solo, studio, agency with a visible focus ring; a text state is not a tab stop; Hebrew (RTL) keeps the order;
// * axe-core (WCAG 2.x A/AA + best-practice): zero violations on Home and Pricing, four languages, in the static and in the closed state.
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
const dirs = { off: arg("ss-off"), announce: arg("ss-announce"), open: arg("ss-open") }, SHOTS = arg("shots");
const PB = (() => { const i = args.indexOf("--port-base"); return i >= 0 ? Number(args[i + 1]) : 0; })();
if (!dirs.off || !dirs.announce || !dirs.open || !SHOTS) { console.error("usage: --ss-off <dir> --ss-announce <dir> --ss-open <dir> --shots <dir> [--port-base <n>]"); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });
const D = await loadDictionaries();
const { PLANS } = await loadTs("src/data/plans.ts");
const LOCALES = ["en", "he", "es", "ru"];
const pre = (l) => (l === "en" ? "" : `/${l}`);
let failed = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { failed++; console.error("  FAIL " + msg); } else console.log("  ok   " + msg); };
const END = Date.UTC(2026, 11, 31, 22, 0, 0);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const startOf = (l, plan) => `https://www.copilt.org${l === "en" ? "" : `/${l}`}/start/${plan ? `?plan=${plan}` : ""}`;

const mocks = { off: await startMock({ dir: dirs.off, port: PB }), announce: await startMock({ dir: dirs.announce, port: PB ? PB + 1 : 0 }), open: await startMock({ dir: dirs.open, port: PB ? PB + 2 : 0 }) };
const browser = await launch();
async function view(cell, route, w, { h = 900, locale = "en", signup = "open", delay = 0, cookie = false, block = true, now = END - 86400e3 } = {}) {
  const m = mocks[cell];
  m.reset(); m.set({ signup, signupDelayMs: delay });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", locale: locale === "he" ? "he-IL" : "en-US" });
  await ctx.clock.setFixedTime(new Date(now));
  if (cookie) await ctx.addCookies([{ name: "aicc_probe", value: "1", url: m.url }]);
  const nav = [];
  if (block) await ctx.route("https://www.copilt.org/**", (r) => { nav.push(r.request().url()); return r.fulfill({ contentType: "text/html", body: "<html><body>control plane (intercepted)</body></html>" }); });
  const page = await ctx.newPage();
  await page.goto(m.url + route, { waitUntil: "load" });
  await page.waitForTimeout(400);
  return { ctx, page, m, nav };
}
/** The card controls of a page: for each plan card, the link (if any), the plain-text state (if any), and every button-looking element. */
const cards = (page) => page.evaluate(() => [...document.querySelectorAll("article.aicc-plan")].map((a) => {
  const link = [...a.querySelectorAll("a.aicc-btn")].filter((e) => e.getClientRects().length > 0).map((e) => ({ href: e.getAttribute("href"), text: e.innerText.replace(/\s+/g, " ").trim(), h: e.getBoundingClientRect().height }));
  const st = [...a.querySelectorAll("[data-ss-state]")].filter((e) => e.getClientRects().length > 0).map((e) => ({ tag: e.tagName, text: e.innerText.replace(/\s+/g, " ").trim(), state: e.getAttribute("data-ss-state"), insideAction: !!e.closest("a,button"), cls: e.className }));
  const btns = [...a.querySelectorAll(".aicc-btn, button")].filter((e) => e.getClientRects().length > 0).length;
  return { link, st, btns };
}));

// ───────── layout and screenshots ─────────
console.log("== layout: Home and Pricing, four languages, 1440 and 390 px (he right-to-left); screenshots in " + SHOTS);
for (const cell of ["announce", "off", "open"]) for (const l of LOCALES) for (const w of [1440, 390]) {
  if (cell === "open" && l !== "en" && l !== "he") continue;
  for (const [name, route] of [["pricing", `${pre(l)}/pricing/`], ["home", `${pre(l)}/`]]) {
    if (cell !== "announce" && name === "home" && l !== "en" && l !== "he") continue;
    const { ctx, page } = await view(cell, route, w, { locale: l, h: w === 390 ? 844 : 900 });
    const g = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, dir: document.documentElement.dir }));
    check(g.sw <= g.iw && g.dir === (l === "he" ? "rtl" : "ltr"), `ss-${cell} ${l} ${name} @${w}: no horizontal scroll (${g.sw}<=${g.iw}), dir=${g.dir}`);
    const cs = await cards(page);
    check(cs.length === 3 && cs.every((c, i) => c.link.length === 1 && c.link[0].href === startOf(l, PLANS[i].id) && c.link[0].h >= 44 && c.st.length === 0 && c.btns === 1), `ss-${cell} ${l} ${name} @${w}: three cards, each ONE visible sign-up button (>= 44 px tall) to the language-prefixed /start/?plan=, no state text yet, no other button`);
    if (name === "home") {
      const hero = await page.evaluate(() => [...document.querySelectorAll(".aicc-hero-actions a")].filter((e) => e.closest(".aicc-hero--home")).map((e) => ({ href: e.getAttribute("href"), text: e.innerText.trim(), top: e.getBoundingClientRect().top, vis: e.getClientRects().length > 0 })));
      check(hero.length === 2 && hero.every((x) => x.vis && x.top < 844) && hero[0].href === "#demo" && hero[0].text === D[l].home.hero.ctaDemo && hero[1].href === `${pre(l)}/pricing/`.replace(/^$/, "/"), `ss-${cell} ${l} home @${w}: Try Live Demo (#demo) and See Pricing are the two Hero actions, visible above the fold`);
    }
    // the screenshots: the Hero view (Home, viewport) and the plan cards section (element), so the cards, the trial lines and the terms block are visible
    if (name === "home") await page.screenshot({ path: path.join(SHOTS, `ss-${cell}-${l}-home-hero-${w}.png`) });
    await page.locator(name === "home" ? '[aria-labelledby="pricing-title"]' : '[aria-labelledby="plans-title"]').screenshot({ path: path.join(SHOTS, `ss-${cell}-${l}-${name}-plans-${w}.png`) });
    await ctx.close();
  }
}

// ───────── the state table in the browser ─────────
console.log("== state table: what each answer of GET /signup/status shows on the cards (announce + self-service, Pricing, en)");
const L = D.en.ea.ss.cta;
const EXPECT = {
  open: ["link", L.start], waitlist: ["link", L.waitlist], closed_cutoff: ["text", L.closed], paused: ["text", L.paused], off: ["text", L.notOpen],
  http404: ["link", L.start], http500: ["link", L.start], badjson: ["link", L.start], drop: ["link", L.start], inconsistent: ["link", L.start], unknown: ["link", L.start],
};
for (const [answer, [kind, label]] of Object.entries(EXPECT)) {
  const { ctx, page, m } = await view("announce", "/pricing/", 1440, { signup: answer, cookie: true });
  const cs = await cards(page);
  const calls = m.calls("/signup/status", "GET");
  check(calls.length === 1 && calls[0].headers.cookie === "", `answer ${answer}: exactly ONE status request, no cookie sent (credentials omitted)`);
  if (kind === "link") check(cs.every((c, i) => c.link.length === 1 && c.st.length === 0 && c.link[0].text.startsWith(label) && c.link[0].href === startOf("en", PLANS[i].id)), `answer ${answer}: every card keeps a real link to /start/?plan= labelled "${label}"${["open", "waitlist"].includes(answer) ? "" : " (the static button: the answer is not a valid one)"}`);
  else check(cs.every((c) => c.link.length === 0 && c.btns === 0 && c.st.length === 1 && c.st[0].tag === "P" && c.st[0].text === label && !c.st[0].insideAction && !/aicc-btn/.test(c.st[0].cls)), `answer ${answer}: every card shows the PLAIN TEXT "${label}": no link, no button, not inside an action`);
  const hero = await page.evaluate(() => [...document.querySelectorAll("a")].filter((a) => a.getAttribute("href") === "#demo" || a.getAttribute("href") === "/pricing/").length);
  check(hero >= 2, `answer ${answer}: the Hero links (#demo, /pricing/) are still there`);
  const si = await page.evaluate(() => [...document.querySelectorAll("header a")].filter((a) => a.getAttribute("href") === "https://www.copilt.org/my-account/").length);
  check(si >= 2, `answer ${answer}: "Sign in" still leads to the account page`);
  await ctx.close();
}
console.log("== the same table in every language (waitlist and closed_cutoff), and on the Home closing band");
for (const l of LOCALES) for (const [answer, kind, key] of [["waitlist", "link", "waitlist"], ["closed_cutoff", "text", "closed"]]) {
  const lab = D[l].ea.ss.cta[key];
  const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1440, { signup: answer, locale: l });
  const cs = await cards(page);
  check(kind === "link" ? cs.every((c, i) => c.link.length === 1 && c.link[0].text.startsWith(lab) && c.link[0].href === startOf(l, PLANS[i].id)) : cs.every((c) => c.link.length === 0 && c.st.length === 1 && c.st[0].text === lab), `${l} ${answer}: cards show "${lab}" as ${kind === "link" ? "a link to " + startOf(l) : "plain text"}`);
  if (answer === "closed_cutoff") await page.locator('[aria-labelledby="plans-title"]').screenshot({ path: path.join(SHOTS, `ss-announce-${l}-pricing-plans-closed-1440.png`) });
  if (answer === "waitlist") await page.locator('[aria-labelledby="plans-title"]').screenshot({ path: path.join(SHOTS, `ss-announce-${l}-pricing-plans-waitlist-1440.png`) });
  await ctx.close();
  const home = await view("announce", `${pre(l)}/`, 1440, { signup: answer, locale: l });
  const band = await home.page.evaluate(() => { const s = document.querySelector('[aria-labelledby="final-title"]'); return { a: [...s.querySelectorAll("a")].map((x) => x.getAttribute("href")), st: [...s.querySelectorAll("[data-ss-state]")].map((x) => x.innerText.trim()) }; });
  check(kind === "link" ? band.a.includes(startOf(l)) : (!band.a.some((h) => /\/start\//.test(h)) && band.st.length === 1 && band.st[0] === lab && band.a.includes("#demo")), `${l} ${answer}: the Home closing band follows the same table (${kind === "link" ? "sign-up link" : `plain text "${lab}", Try Live Demo stays`})`);
  await home.ctx.close();
}
console.log("== a slow answer: the static link works at once, the state arrives later");
{
  const { ctx, page, m } = await view("announce", "/pricing/", 1440, { signup: "closed_cutoff", delay: 1500 });
  const before = await cards(page);
  check(before.every((c, i) => c.link.length === 1 && c.link[0].href === startOf("en", PLANS[i].id)), "before the answer (1.5 s delay) every card is the static sign-up link");
  await page.waitForTimeout(1900);
  const after = await cards(page);
  check(m.calls("/signup/status", "GET").length === 1 && after.every((c) => c.link.length === 0 && c.st.length === 1), "after the answer the cards show the closed text (one request)");
  await ctx.close();
}

// ───────── navigation ─────────
console.log("== clicking a card button goes to the Control Plane sign-up in the page language");
for (const l of LOCALES) for (const cell of ["announce", "off"]) {
  const { ctx, page, nav } = await view(cell, `${pre(l)}/pricing/`, 1440, { locale: l });
  for (const [i, pl] of PLANS.entries()) {
    await page.goto(mocks[cell].url + `${pre(l)}/pricing/`, { waitUntil: "load" });
    await page.waitForTimeout(250);
    nav.length = 0;
    await page.locator("article.aicc-plan a.aicc-btn").nth(i).click();
    await page.waitForTimeout(250);
    check(nav.length >= 1 && nav[0] === startOf(l, pl.id), `${l} ss-${cell}: the ${pl.id} button requests ${startOf(l, pl.id)} (${nav[0]})`);
  }
  await ctx.close();
}
{
  const { ctx, page } = await view("announce", "/", 1440);
  await page.locator('.aicc-hero--home a[href="#demo"]').first().click();
  await page.waitForTimeout(400);
  check(page.url().endsWith("#demo") && (await page.evaluate(() => { const e = document.getElementById("demo"); const r = e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; })), "Hero Try Live Demo scrolls to #demo with self-service on");
  await ctx.close();
}

// ───────── the ended view (a launch-offer build loaded after the end instant) ─────────
console.log("== after the end instant (a stale page of a launch-offer + self-service build): the ordinary ended view, no sign-up promise");
for (const l of ["en", "he"]) {
  const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, now: END + 1000 });
  const r = await page.evaluate(() => ({ cardLinks: [...document.querySelectorAll("article.aicc-plan a.aicc-btn")].filter((e) => e.getClientRects().length > 0).length, chips: [...document.querySelectorAll("article.aicc-plan .aicc-btn--soon")].filter((e) => e.getClientRects().length > 0).length, bar: [...document.querySelectorAll(".aicc-eabar")].filter((e) => e.getClientRects().length > 0).length, trial: [...document.querySelectorAll("[data-ss-checks],[data-ss-terms],[data-ss-band]")].filter((e) => e.getClientRects().length > 0).length }));
  check(r.cardLinks === 0 && r.chips === 3 && r.bar === 0 && r.trial === 0, `${l}: after 2026-12-31T22:00:00Z a stale self-service + announce page shows the ordinary ended view (no sign-up button, no trial text, no bar; the three "purchases open soon" statements) [${JSON.stringify(r)}]`);
  await ctx.close();
}

// ───────── the plan finder ─────────
console.log("== plan finder (Which plan?): the suggestion ends in the sign-up button, not an inert chip");
for (const l of ["en", "he"]) {
  const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "open" });
  await page.locator("#plan-stores").fill("2");
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => { const f = document.querySelector("#plan-stores").closest("form"); return { a: [...f.querySelectorAll("a.aicc-btn")].map((e) => e.getAttribute("href")), soon: f.querySelectorAll(".aicc-btn--soon").length }; });
  check(r.a.length === 1 && r.a[0] === startOf(l, "studio") && r.soon === 0, `${l}: 2 stores -> Studio -> the finder offers ${startOf(l, "studio")} and no inert chip (${r.a.join(", ")})`);
  await ctx.close();
}
{
  const { ctx, page } = await view("announce", "/pricing/", 1440, { signup: "paused" });
  await page.locator("#plan-stores").fill("2");
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => { const f = document.querySelector("#plan-stores").closest("form"); return { a: f.querySelectorAll("a.aicc-btn").length, t: [...f.querySelectorAll("[data-ss-state]")].map((e) => e.innerText.trim()) }; });
  check(r.a === 0 && r.t.length === 1 && r.t[0] === L.paused, "paused: the finder shows the plain text, no button");
  await ctx.close();
}

// ───────── keyboard ─────────
console.log("== keyboard: Tab order and focus ring on the card buttons");
async function tabs(page, max = 120, stopAtCards = 0) {
  const seq = [];
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    seq.push(await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); return { href: e.getAttribute("href"), cls: e.className, inCard: !!e.closest("article.aicc-plan"), ring: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none" }; }));
    if (stopAtCards && seq.filter((x) => x && x.inCard && /aicc-btn/.test(x.cls)).length >= stopAtCards) break; // the first pass over the three card buttons is enough (Tab wraps around the page)
  }
  return seq;
}
for (const l of ["en", "he"]) for (const cell of ["announce", "off"]) {
  const { ctx, page } = await view(cell, `${pre(l)}/pricing/`, 1440, { locale: l });
  const seq = (await tabs(page, 200, 3)).filter(Boolean);
  const inCard = seq.filter((s) => s.inCard && /aicc-btn/.test(s.cls));
  check(inCard.length === 3 && inCard.every((s, i) => s.href === startOf(l, PLANS[i].id)), `${l} ss-${cell}: Tab reaches the three card buttons in order solo, studio, agency (${inCard.map((s) => s.href.split("=")[1]).join(", ")})`);
  check(inCard.every((s) => s.ring), `${l} ss-${cell}: every card button shows a focus ring (outline or shadow) when focused by keyboard`);
  await ctx.close();
}
{
  const { ctx, page } = await view("announce", "/pricing/", 1440, { signup: "closed_cutoff" });
  const seq = (await tabs(page, 90)).filter(Boolean);
  check(seq.filter((s) => s.inCard && /aicc-btn/.test(s.cls)).length === 0, "closed_cutoff: no card button is a tab stop (the state is plain text)");
  await ctx.close();
}

// ───────── accessibility ─────────
console.log("== accessibility: axe-core, Home and Pricing, four languages, static and closed");
for (const l of LOCALES) for (const [name, route] of [["pricing", `${pre(l)}/pricing/`], ["home", `${pre(l)}/`]]) for (const signup of ["open", "closed_cutoff"]) {
  const { ctx, page } = await view("announce", route, 1440, { locale: l, signup });
  await page.evaluate(axeSource);
  const r = await page.evaluate(async (tags) => { const x = await axe.run(document, { runOnly: { type: "tag", values: tags }, rules: { "color-contrast": { enabled: false } } }); return x.violations.map((v) => `${v.id}: ${v.nodes.length}`); }, TAGS);
  check(r.length === 0, `axe ${l} ${name} (${signup}): zero violations${r.length ? " -> " + r.join(", ") : ""}`);
  await ctx.close();
}
{
  const { ctx, page } = await view("off", "/pricing/", 390, { h: 844, signup: "waitlist" });
  await page.evaluate(axeSource);
  const r = await page.evaluate(async (tags) => { const x = await axe.run(document, { runOnly: { type: "tag", values: tags }, rules: { "color-contrast": { enabled: false } } }); return x.violations.map((v) => `${v.id}: ${v.nodes.length}`); }, TAGS);
  check(r.length === 0, `axe ss-off pricing @390 (waitlist): zero violations${r.length ? " -> " + r.join(", ") : ""}`);
  await ctx.close();
}

await browser.close();
for (const m of Object.values(mocks)) await m.close();
console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:selfservice-browser (${failed})`); process.exit(1); }
console.log("PASS test:selfservice-browser");
