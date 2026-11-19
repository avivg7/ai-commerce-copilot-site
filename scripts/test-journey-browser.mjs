// npm run test:journey-browser (P41): the ONBOARDING JOURNEY in real Chromium, against local self-service exports and a local mock of GET /wp-json/aicc/v1/signup/status (nothing leaves 127.0.0.1).
//   node scripts/test-journey-browser.mjs --ss-announce <dir> --ss-off <dir> --ss-link <dir> --shots <dir> [--port-base <n>] [--quick]
// A  the /get-started/ page exists in every self-service build in four languages (and in NO other build), nine steps in order, one h1, plan chips, the trial terms with the dates ONCE
// B  state-aware action: not open (off / static / paused / failed answers) = the honest statement + the working Live Demo + See pricing and NO link to /start/; waitlist / open = the real link to /<lang>/start/?plan=<plan>; closed = closed text
// C  the plan is carried through: ?plan=solo|studio|agency (validated; unknown values and unknown parameters ignored) to the start link; the chips select in place and keep the URL
// D  the pricing cards and the header "Get started" lead to the journey page while registration is not open, and FLIP BY THEMSELVES to the real "Get started free" link (plan + language preserved) when the status route answers open / waitlist
// E  axe (WCAG 2.x A/AA + best-practice, 2.2 AA tags) zero violations, keyboard order and focus, reduced motion, RTL (Hebrew), 320..1920 px (no horizontal scroll, nothing clipped), 200% text
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
const dirs = { announce: arg("ss-announce"), off: arg("ss-off"), link: arg("ss-link") }, SHOTS = arg("shots");
const PB = (() => { const i = args.indexOf("--port-base"); return i >= 0 ? Number(args[i + 1]) : 0; })();
const QUICK = args.includes("--quick");
if (!dirs.announce || !dirs.off || !dirs.link || !SHOTS) { console.error("usage: --ss-announce <dir> --ss-off <dir> --ss-link <dir> --shots <dir> [--port-base <n>] [--quick]"); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });
const D = await loadDictionaries();
const { PLANS } = await loadTs("src/data/plans.ts");
const LOCALES = ["en", "he", "es", "ru"];
const pre = (l) => (l === "en" ? "" : `/${l}`);
let failed = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { failed++; console.error("  FAIL " + msg); } else console.log("  ok   " + msg); };
const CUT = Date.UTC(2026, 11, 24, 0, 0, 0), BEFORE = Date.UTC(2026, 10, 20, 12);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const startOf = (l, plan) => `https://www.copilt.org${pre(l)}/start/${plan ? `?plan=${plan}` : ""}`;
const START_RE = (l) => new RegExp(`^https://www\\.copilt\\.org${pre(l).replace("/", "\\/")}/start/(\\?plan=(solo|studio|agency))?$`);
const J = (l) => D[l].ea.journey, S = (l) => D[l].ea.ss;
const mocks = { announce: await startMock({ dir: dirs.announce, port: PB }), off: await startMock({ dir: dirs.off, port: PB ? PB + 1 : 0 }), link: await startMock({ dir: dirs.link, port: PB ? PB + 2 : 0 }) };
const browser = await launch();
async function view(cell, route, w, { h = 900, locale = "en", signup = "off", delay = 0, now = BEFORE, scale = 1, media = {}, block = true } = {}) {
  const m = mocks[cell];
  m.reset(); m.set({ signup, signupDelayMs: delay });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: locale === "he" ? "he-IL" : locale === "es" ? "es-ES" : locale === "ru" ? "ru-RU" : "en-US", ...media });
  await ctx.addInitScript(({ base }) => { const real = Date.now.bind(Date); window.__skew = base - real(); Date.now = () => real() + window.__skew; }, { base: now });
  const nav = [], errors = [];
  if (block) await ctx.route("https://www.copilt.org/**", (r) => { nav.push(r.request().url()); return r.fulfill({ contentType: "text/html", body: "<html><body>control plane (intercepted)</body></html>" }); });
  const page = await ctx.newPage();
  if (scale !== 1) { const cdp = await ctx.newCDPSession(page); await cdp.send("Page.enable"); await cdp.send("Page.setFontSizes", { fontSizes: { standard: Math.round(16 * scale), fixed: Math.round(13 * scale) } }); }
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (c) => { if (c.type() === "error" && !/Failed to load resource|net::ERR|status of (4|5)\d\d/i.test(c.text())) errors.push(c.text()); });
  await page.goto(m.url + route, { waitUntil: "load" });
  await page.waitForTimeout(delay ? 150 : 400);
  return { ctx, page, m, nav, errors };
}
const act = (page) => page.evaluate(() => { const p = document.querySelector("[data-jr-panel]"), vis = (e) => e.getClientRects().length > 0; return { state: p.querySelector("[data-jr-state]").getAttribute("data-jr-state"), line: p.querySelector("[data-jr-line]").innerText.trim(), role: p.querySelector("[data-jr-line]").getAttribute("role"), links: [...p.querySelectorAll("a[data-jr-act]")].filter(vis).map((a) => ({ href: a.getAttribute("href"), text: a.innerText.replace(/\s+/g, " ").trim(), cls: a.className, h: a.getBoundingClientRect().height })), text: p.innerText }; });

// ───────── A. the page
console.log("== A. /get-started/ exists in every self-service build, four languages: one h1, nine steps in order, the plan chips, the trial terms and the dates ONCE");
for (const cell of ["announce", "off", "link"]) for (const l of QUICK && cell !== "announce" ? ["en"] : LOCALES) {
  const { ctx, page, errors } = await view(cell, `${pre(l)}/get-started/`, 1440, { locale: l });
  const r = await page.evaluate(() => {
    const steps = [...document.querySelectorAll("[data-jr-step]")].map((li) => ({ n: Number(li.getAttribute("data-jr-step")), t: li.querySelector("h3").innerText.trim(), b: li.querySelector("p").innerText.trim() }));
    return { lang: document.documentElement.lang, dir: document.documentElement.dir, h1: [...document.querySelectorAll("h1")].map((e) => e.innerText.trim()), title: document.title, canon: document.querySelector('link[rel="canonical"]')?.href, alts: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((e) => e.getAttribute("hreflang")).sort(), steps, lists: document.querySelectorAll("ol.aicc-jr__list").length, dates: [...document.querySelectorAll("[data-ss-date]")].map((e) => e.innerText.replace(/\s+/g, " ").trim()), text: document.querySelector("main").innerText, chips: [...document.querySelectorAll(".aicc-jr__chip")].map((a) => ({ plan: a.getAttribute("data-plan"), href: a.getAttribute("href") })) };
  });
  const j = J(l), ss = S(l);
  const want = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => j.steps["s" + n]);
  check(r.h1.length === 1 && r.h1[0] === j.title && errors.length === 0 && r.title === j.meta.title, `${cell} ${l}: one h1 "${j.title}", the page title is the journey title, no script error (${errors[0] || "none"})`);
  check(r.steps.length === 9 && r.steps.every((s, i) => s.n === i + 1 && s.t === want[i].t && s.b === want[i].b.replace("{path}", j.path)), `${cell} ${l}: nine steps, in order 1..9, with their exact titles and texts`);
  check(r.lists === 3 && r.lang.startsWith(l) && r.dir === (l === "he" ? "rtl" : "ltr"), `${cell} ${l}: three phases (account, store, recommendations), html lang ${r.lang}, dir ${r.dir}`);
  const dt = [ss.plan.regLabel + " " + ss.plan.regValue, ss.plan.endLabel + " " + ss.plan.endValue].map((x) => x.replace(/[ ⁦⁩]/g, " ").replace(/\s+/g, " "));
  const got = r.dates.map((x) => x.replace(/[ ⁦⁩]/g, " ").replace(/\s+/g, " "));
  const body = r.text.replace(/[ ⁦⁩]/g, " ").replace(/\s+/g, " ");
  const occurrences = (needle) => body.split(needle).length - 1;
  check(got.length === 2 && got[0] === dt[0] && got[1] === dt[1] && occurrences(S(l).plan.regValue.replace(/[ ⁦⁩]/g, " ").replace(/\s+/g, " ").replace(/\{regShort\}.*/, "")) <= 1 && !/Israel|ישראל/.test(r.text), `${cell} ${l}: the two UTC dates are on the page exactly twice-labelled ONCE each (${got.join(" | ")})`);
  check(r.chips.length === 3 && r.chips.every((c, i) => c.plan === PLANS[i].id), `${cell} ${l}: three plan chips in order Solo, Studio, Agency`);
  const tn = await page.evaluate(() => ({ aside: document.querySelector("aside.aicc-jr__aside").getAttribute("aria-label"), end: (document.querySelector("[data-jr-end]") || { innerText: "" }).innerText.trim(), paid: (document.querySelector("[data-jr-paid]") || { innerText: "" }).innerText.trim(), inTerms: !!document.querySelector("[data-jr-terms] [data-jr-end]") && !!document.querySelector("[data-jr-terms] [data-jr-paid]") }));
  check(tn.aside === j.asideLabel && tn.end === j.terms.end && tn.paid === ss.launch.foot.paid && tn.inTerms, `${cell} ${l}: the terms card says what happens at the end of the trial ("${j.terms.end.slice(0, 50)}...") and that paid plans are not open for purchase yet (ss.launch.foot.paid); the aside is labelled "${j.asideLabel}"`);
  await ctx.close();
}
for (const [cell, dir] of [["announce", dirs.announce]]) {
  // the sitemap and hreflang cluster: four languages, reciprocal, canonical on the www origin
  const sm = fs.readFileSync(path.join(dir, "sitemap.xml"), "utf8");
  check(LOCALES.every((l) => sm.includes(`<loc>https://www.copilt.org${pre(l)}/get-started/</loc>`)), "the sitemap lists /get-started/ in four languages");
  for (const l of LOCALES) {
    const h = fs.readFileSync(path.join(dir, pre(l).slice(1), "get-started/index.html"), "utf8");
    check(new RegExp(`<link rel="canonical" href="https://www\\.copilt\\.org${pre(l)}/get-started/"`).test(h) && LOCALES.every((x) => h.includes(`hrefLang="${x}"`)) && h.includes('hrefLang="x-default"') && !/noindex/.test(h), `${l}: the page is indexable with its canonical on www and the four-language hreflang cluster (+ x-default)`);
  }
}

// ───────── B. the state-aware action
console.log("== B. the state-aware action: not open = honest statement + working Live Demo + See pricing (NO /start/); waitlist / open = the real link; closed = closed text");
const STATES = [["off", "soon", false], ["paused", "paused", false], ["http500", "soon", false], ["badjson", "soon", false], ["drop", "soon", false], ["http404", "soon", false], ["inconsistent", "soon", false], ["unknown", "soon", false], ["waitlist", "waitlist", true], ["open", "open", true], ["closed_cutoff", "closed", false]];
for (const l of QUICK ? ["en", "he"] : LOCALES) for (const [answer, key, real] of STATES) {
  const { ctx, page, errors } = await view("announce", `${pre(l)}/get-started/?plan=studio`, 1440, { locale: l, signup: answer });
  const a = await act(page), ss = S(l);
  const lineWant = key === "closed" ? ss.state.closedPaidNote : ss.state.line[key];
  check(errors.length === 0 && a.state === key && a.line === lineWant && a.role === "status", `${l} (${answer}): the status line says "${lineWant}" (role=status), no script error`);
  if (real) check(a.links.length === 2 && a.links[0].href === startOf(l, "studio") && a.links[0].text.startsWith(key === "open" ? ss.cta.start : ss.cta.waitlist) && a.links[0].cls.includes("aicc-btn--primary"), `${l} (${answer}): the primary action is the REAL link ${startOf(l, "studio")} "${key === "open" ? ss.cta.start : ss.cta.waitlist}" (plan and language preserved)`);
  else check(a.links.every((x) => !/\/start\//.test(x.href)) && a.links.length === 2 && ((key === "closed") ? a.links[0].href === `${pre(l)}/pricing/` && a.links[1].href === `${pre(l)}/#demo` : a.links[0].href === `${pre(l)}/#demo` && a.links[0].text.startsWith(ss.state.demo) && a.links[1].href === `${pre(l)}/pricing/`), `${l} (${answer}): NO link to /start/ while registration is not open; the actions are the working Live Demo (${pre(l)}/#demo) and See pricing (${pre(l)}/pricing/)`);
  await ctx.close();
}
for (const l of QUICK ? ["en"] : LOCALES) { // the Live Demo link really lands on the demo section of the Home page, and See pricing on the pricing page
  const { ctx, page } = await view("announce", `${pre(l)}/get-started/`, 1440, { locale: l, signup: "off" });
  await page.locator("a[data-jr-act]").first().click(); await page.waitForURL(/#demo$/); await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ path: location.pathname, demo: !!document.getElementById("demo"), vis: (() => { const e = document.getElementById("demo"); const q = e.getBoundingClientRect(); return q.top < innerHeight && q.bottom > 0; })() }));
  check(r.path === `${pre(l)}/` .replace(/^$/, "/") && r.demo && r.vis, `${l}: the Live Demo link works: it lands on the Home page's #demo section (${r.path})`);
  await ctx.close();
}
{ // the clock alone closes it, whatever the answer says (a stale page, a late answer of open)
  const { ctx, page } = await view("announce", "/get-started/?plan=agency", 1440, { signup: "open", now: CUT + 1000 });
  const a = await act(page);
  check(a.state === "closed" && a.links.length === 2 && a.links.every((x) => !/\/start\//.test(x.href)), "at or after 2026-12-24T00:00:00Z the action is the closed text (never the sign-up link), even when the answer is open");
  const terms = await page.evaluate(() => document.querySelector("[data-jr-terms]").getClientRects().length);
  check(terms === 0, "the closed view hides the trial terms block (and with it the dates)");
  await ctx.close();
}
{ // a page left open across the cutoff flips by itself
  const { ctx, page } = await view("announce", "/get-started/", 1440, { signup: "open", now: CUT - 4500 });
  const before = await act(page); await page.waitForTimeout(5200); const after = await act(page);
  check(before.state === "open" && after.state === "closed" && after.links.every((x) => !/\/start\//.test(x.href)), "a page left open across the cutoff flips from the real link to the closed text without a reload");
  await ctx.close();
}
{ // the link build: the static state is the real link, failures keep it, the clock closes it
  const { ctx, page } = await view("link", "/get-started/?plan=solo", 1440, { signup: "http500" });
  const a = await act(page);
  check(a.state === "open" && a.links[0].href === startOf("en", "solo"), "the link build keeps its static real link under a failed answer");
  await ctx.close();
}

// ───────── C. the plan is carried through
console.log("== C. ?plan= is validated and carried to the start link; the chips select in place; unknown parameters and values are ignored");
for (const l of LOCALES) for (const [q, want] of [["?plan=solo", "solo"], ["?plan=studio", "studio"], ["?plan=agency", "agency"], ["?plan=Studio", null], ["?plan=enterprise", null], ["?plan=", null], ["?utm_source=x&plan=agency&foo=1", "agency"], ["?foo=bar", null], ["", null]]) {
  if (QUICK && l !== "en" && l !== "he") continue;
  const { ctx, page } = await view("announce", `${pre(l)}/get-started/${q}`, 1440, { locale: l, signup: "open" });
  const a = await act(page), sel = await page.evaluate(() => [...document.querySelectorAll(".aicc-jr__chip[aria-current=true]")].map((e) => e.getAttribute("data-plan")));
  check(a.links[0].href === startOf(l, want) && JSON.stringify(sel) === JSON.stringify(want ? [want] : []) && !/utm_source|foo/.test(a.links[0].href), `${l} ${JSON.stringify(q)}: the start link is ${startOf(l, want)} and the selected chip is ${want || "none"} (no other parameter forwarded)`);
  await ctx.close();
}
for (const l of ["en", "he"]) { // a click on a chip selects it in place, keeps the language, updates the link and the URL; keyboard (Enter) works
  const { ctx, page } = await view("announce", `${pre(l)}/get-started/`, 1440, { locale: l, signup: "open" });
  await page.evaluate(() => { window.__full = 1; });
  await page.locator('.aicc-jr__chip[data-plan="agency"]').click(); await page.waitForTimeout(250);
  let a = await act(page); let u = await page.evaluate(() => ({ s: location.search, full: window.__full }));
  check(a.links[0].href === startOf(l, "agency") && u.s === "?plan=agency" && u.full === 1, `${l}: clicking the Agency chip selects it in place (no reload), the start link becomes ${startOf(l, "agency")} and the URL ${u.s}`);
  await page.locator('.aicc-jr__chip[data-plan="solo"]').focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(250);
  a = await act(page);
  check(a.links[0].href === startOf(l, "solo"), `${l}: Enter on the focused Solo chip selects it (keyboard operable)`);
  await ctx.close();
}

// ───────── D. the cards, the band and the header lead here and flip by themselves
console.log("== D. while registration is not open the cards / band / header lead to the journey page; they FLIP BY THEMSELVES to the real link when the status route says open or waitlist (plan + language preserved)");
const TIER = "article.aicc-tier:not(.aicc-tier--standard)";
const ctl = (page) => page.evaluate((TIER) => [...document.querySelectorAll(TIER + " .aicc-pcta")].map((c) => { const a = c.querySelector("a.aicc-btn"); return { kind: c.getAttribute("data-ss-cta"), href: a && a.getAttribute("href"), text: a && a.innerText.replace(/\s+/g, " ").trim(), state: a && a.getAttribute("data-ss-state"), pill: !!c.querySelector(".aicc-pstatus__pill") }; }), TIER);
for (const l of LOCALES) {
  const { ctx, page, m } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "off", delay: 700 });
  const before = await ctl(page), hb = await page.evaluate(() => [...document.querySelectorAll("[data-ss-getstarted]")].map((a) => a.getAttribute("href")));
  check(before.length === 3 && before.every((c, i) => c.kind === "info" && c.href === `${pre(l)}/get-started/?plan=${PLANS[i].id}` && c.text.startsWith(S(l).cta.how) && !c.pill), `${l} off (before the answer): each card control is a REAL link "${S(l).cta.how}" to ${pre(l)}/get-started/?plan=<id> (no inert pill)`);
  check(hb.length >= 2 && hb.every((h) => h === `${pre(l)}/get-started/`), `${l} off: the header "Get started" (desktop and menu) leads to ${pre(l)}/get-started/ (not to the account page)`);
  m.set({ signup: "open" });
  await page.waitForTimeout(2200); // the answer (still "off" at that moment) arrives; then flip the mock and force a re-check
  await page.evaluate(() => { window.__skew += 40000; window.dispatchEvent(new Event("focus")); });
  await page.waitForTimeout(900);
  const after = await ctl(page), ha = await page.evaluate(() => [...document.querySelectorAll("[data-ss-getstarted]")].map((a) => a.getAttribute("href")));
  check(after.every((c, i) => c.kind === "link" && c.href === startOf(l, PLANS[i].id) && c.text.startsWith(S(l).cta.start) && c.state === "open"), `${l}: the cards flip BY THEMSELVES from "${S(l).cta.how}" to the real "${S(l).cta.start}" link ${startOf(l, "studio")} (plan + language preserved) when the status route answers open (no reload)`);
  check(ha.every((h) => h === startOf(l)), `${l}: the header "Get started" flips to ${startOf(l)} too`);
  m.set({ signup: "waitlist" }); await page.evaluate(() => { window.__skew += 40000; window.dispatchEvent(new Event("focus")); }); await page.waitForTimeout(900);
  const wl = await ctl(page);
  check(wl.every((c, i) => c.kind === "link" && c.href === startOf(l, PLANS[i].id) && c.text.startsWith(S(l).cta.waitlist)), `${l}: open -> waitlist keeps the real link ("${S(l).cta.waitlist}")`);
  m.set({ signup: "off" }); await page.evaluate(() => { window.__skew += 40000; window.dispatchEvent(new Event("focus")); }); await page.waitForTimeout(900);
  const back = await ctl(page);
  check(back.every((c, i) => c.kind === "info" && c.href === `${pre(l)}/get-started/?plan=${PLANS[i].id}`), `${l}: waitlist -> off flips back to the information link (never a dead end)`);
  await ctx.close();
}
for (const l of LOCALES) { // clicking the info link of each card lands on the journey page in the same language with the same plan selected
  const { ctx, page } = await view("announce", `${pre(l)}/pricing/`, 1440, { locale: l, signup: "off" });
  for (const [i, pl] of PLANS.entries()) {
    await page.goto(mocks.announce.url + `${pre(l)}/pricing/`, { waitUntil: "load" }); await page.waitForSelector(TIER + " a.aicc-btn");
    await page.locator(TIER + " a.aicc-btn").nth(i).click(); await page.waitForURL(/get-started/); await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({ path: location.pathname + location.search, lang: document.documentElement.lang, sel: [...document.querySelectorAll(".aicc-jr__chip[aria-current=true]")].map((e) => e.getAttribute("data-plan")), h1: document.querySelector("h1").innerText.trim() }));
    check(r.path === `${pre(l)}/get-started/?plan=${pl.id}` && r.lang.startsWith(l) && JSON.stringify(r.sel) === JSON.stringify([pl.id]) && r.h1 === J(l).title, `${l}: the ${pl.id} card leads to ${r.path} in ${l} with the ${pl.id} chip selected`);
  }
  await ctx.close();
}
for (const l of ["en", "he"]) { // header Get started in the off state, the Product page too, and the band on Home
  const { ctx, page } = await view("announce", `${pre(l)}/product/`, 1440, { locale: l, signup: "off" });
  const hero = await page.evaluate(() => [...document.querySelectorAll(".aicc-hero-actions [data-ss-getstarted]")].map((a) => a.getAttribute("href")));
  check(hero.length === 1 && hero[0] === `${pre(l)}/get-started/`, `${l}: the Product page "Get started" leads to the journey page while registration is not open`);
  await ctx.close();
  const h = await view("announce", `${pre(l)}/`, 1440, { locale: l, signup: "off" });
  const band = await h.page.evaluate(() => [...document.querySelectorAll('[aria-labelledby="final-title"] a.aicc-btn[data-ss-state]')].map((a) => a.getAttribute("href")));
  check(band.length === 1 && band[0] === `${pre(l)}/get-started/`, `${l}: the Home closing band control is the plan-less information link ${pre(l)}/get-started/ (${band})`);
  await h.ctx.close();
}

// ───────── E. accessibility, keyboard, motion, RTL, geometry
console.log("== E. axe (WCAG 2.x A/AA + 2.2 AA), keyboard, reduced motion, RTL, 320..1920 px, 200% text");
const axe = async (page) => { await page.evaluate(axeSource); return page.evaluate(async (tags) => { const x = await axe.run(document, { runOnly: { type: "tag", values: tags } }); return x.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0].target.join(" ")})`); }, TAGS); };
for (const l of LOCALES) for (const signup of QUICK ? ["off", "open"] : ["off", "open", "waitlist", "closed_cutoff", "paused"]) for (const w of QUICK ? [390, 1440] : [320, 768, 1440]) {
  const { ctx, page } = await view("announce", `${pre(l)}/get-started/?plan=studio`, w, { locale: l, signup, h: 900, media: { reducedMotion: "reduce" } });
  const v = await axe(page);
  check(v.length === 0, `axe ${l} /get-started/ @${w} (${signup}): zero violations${v.length ? " -> " + v.join(", ") : ""}`);
  await ctx.close();
}
for (const l of ["en", "he"]) { // enhanced contrast mode and 200% text
  const { ctx, page } = await view("announce", `${pre(l)}/get-started/`, 1024, { locale: l, signup: "off", media: { reducedMotion: "reduce" } });
  await page.evaluate(() => document.documentElement.setAttribute("data-aicc-contrast", "high")); await page.waitForTimeout(200);
  const v = await axe(page); check(v.length === 0, `axe ${l} /get-started/ (enhanced contrast): zero violations${v.length ? " -> " + v.join(", ") : ""}`);
  await ctx.close();
}
for (const l of ["en", "he"]) { // keyboard: the first stops are the skip link, the header, then the page: the plan chips and the actions are reachable in DOM order, each with a visible focus indicator
  const { ctx, page } = await view("announce", `${pre(l)}/get-started/`, 1440, { locale: l, signup: "off", media: { reducedMotion: "reduce" } });
  const seq = [];
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let i = 0; i < 40; i++) { await page.keyboard.press("Tab"); seq.push(await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); return { href: e.getAttribute("href"), cls: e.className, main: !!e.closest("main"), ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2 || cs.boxShadow !== "none" }; })); }
  const inMain = seq.filter((s) => s && s.main);
  check(inMain.length >= 5 && /aicc-btn--primary/.test(inMain.find((s) => /data-jr-act|aicc-btn/.test(s.cls))?.cls || "") && inMain.every((s) => s.ring), `${l}: Tab reaches the actions, the plan chips and the bar link in order inside main, every stop has a visible focus indicator (${inMain.length} stops)`);
  const order = inMain.map((s) => s.href);
  const iDemo = order.findIndex((h) => /#demo$/.test(h || "")), iChip = order.findIndex((h) => /get-started\/\?plan=solo/.test(h || ""));
  check(iDemo >= 0 && iChip > iDemo, `${l}: the DOM / tab order is the reading order: the status panel (Live Demo) comes before the plan chips of step 1`);
  await ctx.close();
}
{ // reduced motion: nothing animates, transitions collapse
  const { ctx, page } = await view("announce", "/get-started/", 1440, { signup: "off", media: { reducedMotion: "reduce" } });
  const r = await page.evaluate(() => { const els = [...document.querySelectorAll(".aicc-jr, .aicc-jr *")]; const dur = (e) => Math.max(...getComputedStyle(e).transitionDuration.split(",").map((x) => parseFloat(x) || 0)); return { n: els.length, anim: els.filter((e) => getComputedStyle(e).animationName !== "none").length, trans: els.filter((e) => dur(e) > 0.001).length, motion: matchMedia("(prefers-reduced-motion: reduce)").matches }; });
  check(r.motion && r.n > 50 && r.anim === 0 && r.trans === 0, `reduced motion: the journey page has no animation and no transition longer than 1 ms (${r.n} elements)`);
  await ctx.close();
}
for (const l of ["he"]) {
  const { ctx, page } = await view("announce", `/${l}/get-started/`, 1440, { locale: l, signup: "off" });
  const r = await page.evaluate(() => { const t = document.querySelector(".aicc-jr__step-title").getBoundingClientRect(), n = document.querySelector(".aicc-jr__step"), nb = n.getBoundingClientRect(), steps = document.querySelector(".aicc-jr__steps").getBoundingClientRect(), aside = document.querySelector(".aicc-jr__aside").getBoundingClientRect(), path = document.querySelector(".aicc-jr__path"); return { dir: getComputedStyle(n).direction, titleRight: Math.round(nb.right - t.right) <= 56 + 4, stepsRightOfAside: steps.left > aside.left, path: path && path.getAttribute("dir"), padStart: getComputedStyle(n).paddingRight }; });
  check(r.dir === "rtl" && r.titleRight && r.stepsRightOfAside === true && r.path === "ltr", `he: RTL mirrors the layout (steps column on the right, step numbers on the right edge), the WordPress menu path is a left-to-right isolate [${JSON.stringify(r)}]`);
  await ctx.close();
}
for (const l of QUICK ? ["en", "ru"] : LOCALES) for (const w of [320, 375, 390, 430, 768, 1024, 1440, 1920]) for (const scale of QUICK && w > 430 ? [1] : [1, 2]) {
  const { ctx, page } = await view("announce", `${pre(l)}/get-started/?plan=agency`, w, { locale: l, signup: "open", h: 1000, scale, media: { reducedMotion: "reduce" } });
  const g = await page.evaluate(() => { const vis = (e) => e.getClientRects().length > 0, probs = []; for (const box of [...document.querySelectorAll(".aicc-jr__act, .aicc-jr__terms, .aicc-jr__step")].filter(vis)) { const r = box.getBoundingClientRect(); for (const e of [...box.querySelectorAll("*")].filter(vis)) { const q = e.getBoundingClientRect(); if (q.width && (q.left < r.left - 1.5 || q.right > r.right + 1.5) && !e.closest("svg")) probs.push(`${e.className || e.tagName} leaves ${box.className.split(" ")[0]}`); if (!e.closest("svg") && e.scrollWidth > e.clientWidth + 1.5 && getComputedStyle(e).display !== "inline") probs.push(`${e.className || e.tagName} text overflows`); } } return { over: document.documentElement.scrollWidth - innerWidth, probs, btn: Math.min(...[...document.querySelectorAll("a[data-jr-act]")].map((a) => a.getBoundingClientRect().height)), cols: getComputedStyle(document.querySelector(".aicc-jr")).gridTemplateColumns.split(" ").length }; });
  check((scale > 1.5 ? true : g.over <= 0) && g.probs.length === 0 && g.btn >= 44, `${l} @${w}px ${scale * 100}%: ${scale > 1.5 ? "" : `no horizontal scroll (+${g.over}px), `}nothing leaves its box or overflows its text, the actions are >= 44px tall${g.probs.length ? " -> " + g.probs.slice(0, 2).join("; ") : ""}`);
  if (scale === 1) check(w * scale >= 992 ? g.cols === 2 : g.cols === 1, `${l} @${w}px: ${w >= 992 ? "two columns (steps + sticky status panel)" : "one column (status panel first, then the steps)"} [${g.cols}]`);
  if ((w === 390 || w === 1440 || w === 320) && scale === 1) await page.screenshot({ path: path.join(SHOTS, `journey-${l}-${w}.png`), fullPage: true });
  await ctx.close();
}
for (const l of LOCALES) { // WCAG 1.4.12 text spacing: no word breaks mid-word, nothing clipped
  const { ctx, page } = await view("announce", `${pre(l)}/get-started/`, 390, { locale: l, signup: "open", h: 900, media: { reducedMotion: "reduce" } });
  await page.addStyleTag({ content: "*{line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important}p{margin-block-end:2em !important}" }); await page.waitForTimeout(300);
  const g = await page.evaluate(() => { const vis = (e) => e.getClientRects().length > 0, broken = []; for (const el of [...document.querySelectorAll(".aicc-jr__step-body, .aicc-jr__state, .aicc-jr__act-text, .aicc-btn")].filter(vis)) { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (!n.nodeValue.trim() || n.parentElement.closest(".aicc-sr-only, svg")) continue; const re = /[^\s ]+/g; let m; while ((m = re.exec(n.nodeValue))) { if (/[-‐‑־\/>]/.test(m[0]) || m[0].length < 4) continue; const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length); const tops = new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top / 3))); if (tops.size > 1) broken.push(m[0]); } } } return { broken, over: document.documentElement.scrollWidth - innerWidth }; });
  check(g.broken.length === 0 && g.over <= 0, `${l} @390 with WCAG 1.4.12 text spacing: no word of the body text, the state line or the buttons breaks mid-word (the site hyphenates phone headings by design), no horizontal scroll${g.broken.length ? " -> " + g.broken.slice(0, 3).join(", ") : ""}`);
  await ctx.close();
}
for (const l of LOCALES) { const { ctx, page } = await view("announce", `${pre(l)}/get-started/`, 1440, { locale: l, signup: "off" }); await page.screenshot({ path: path.join(SHOTS, `journey-${l}-1440-viewport.png`) }); await ctx.close(); }

// ───────── F. review fixes: the aside never cuts the trial end date off, the install path chip keeps its comma, phone step titles are not hyphenated, off-state captures
console.log("== F. the sticky aside, the path chip, phone step titles, off-state captures (4 languages)");
for (const l of LOCALES) for (const h of QUICK ? [800, 1200] : [700, 800, 900, 1080, 1200]) {
  const { ctx, page } = await view("announce", `${pre(l)}/get-started/`, 1440, { locale: l, signup: "off", h });
  const g = await page.evaluate(() => { const a = document.querySelector(".aicc-jr__aside"), cs = getComputedStyle(a), r = a.getBoundingClientRect(); return { pos: cs.position, top: parseFloat(cs.top) || 0, h: r.height, vh: innerHeight, endDate: !!document.querySelector("[data-ss-date=end]") }; });
  const sticky = g.pos === "sticky";
  check(sticky ? g.h + g.top <= g.vh : g.pos === "static", `${l} @1440x${h}: the aside (${Math.round(g.h)}px tall) is ${sticky ? "sticky only because it fits below the header (" + Math.round(g.h + g.top) + " <= " + g.vh + ")" : "not sticky in a viewport too short to show all of it"}: no line of it is cut off while scrolling`);
  if (sticky) { await page.evaluate(() => window.scrollTo(0, 500)); await page.waitForTimeout(250); const b = await page.evaluate(() => { const e = document.querySelector("[data-ss-date=end]").getBoundingClientRect(); return { bottom: e.bottom, vh: innerHeight }; }); check(b.bottom <= b.vh, `${l} @1440x${h}: scrolled 500px, the "Trial access ends" date is still fully visible (${Math.round(b.bottom)} <= ${b.vh})`); }
  await ctx.close();
}
for (const l of LOCALES) for (const w of [320, 360]) for (const scale of [1, 2]) {
  const { ctx, page } = await view("announce", `${pre(l)}/get-started/`, w, { locale: l, signup: "off", h: 900, scale, media: { reducedMotion: "reduce" } });
  const r = await page.evaluate(() => { const c = document.querySelector(".aicc-jr__path"), after = c.nextSibling, txt = after && after.nodeValue || ""; const m = /^\u2060?([,.;:])/.exec(txt); const rects = [...c.getClientRects()]; const last = rects[rects.length - 1]; let punct = null; if (m) { const rg = document.createRange(); rg.setStart(after, txt.indexOf(m[1])); rg.setEnd(after, txt.indexOf(m[1]) + 1); const q = rg.getBoundingClientRect(); punct = { top: q.top, bottom: q.bottom }; } return { hasPunct: !!m, joiner: txt.startsWith("\u2060"), last: last && { top: last.top, bottom: last.bottom }, punct, over: document.documentElement.scrollWidth - innerWidth, titleBroken: (() => { const bad = []; for (const el of document.querySelectorAll(".aicc-jr__step-title")) { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const re = /[^\s\u00a0]+/g; let q; while ((q = re.exec(n.nodeValue))) { if (q[0].length < 5) continue; const rg = document.createRange(); rg.setStart(n, q.index); rg.setEnd(n, q.index + q[0].length); const tops = new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top / 3))); if (tops.size > 1) bad.push(q[0]); } } } return bad; })() }; });
  check(!r.hasPunct || (r.joiner && r.last && r.punct && r.punct.top >= r.last.top - 2 && r.punct.bottom <= r.last.bottom + 2), `${l} @${w}px ${scale * 100}%: the punctuation after the path chip stays on the chip's last line (word joiner, no orphan line)`);
  check(scale > 1.5 || r.titleBroken.length === 0, `${l} @${w}px ${scale * 100}%: no step title word is broken or hyphenated mid-word${r.titleBroken.length ? " -> " + r.titleBroken.slice(0, 2).join(", ") : ""}`);
  await ctx.close();
}
for (const l of LOCALES) for (const w of [320, 390]) { // off-state full-page captures (evidence)
  const { ctx, page } = await view("announce", `${pre(l)}/get-started/`, w, { locale: l, signup: "off", h: 900, media: { reducedMotion: "reduce" } });
  await page.screenshot({ path: path.join(SHOTS, `journey-off-${l}-${w}.png`), fullPage: true });
  const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(o <= 0, `${l} @${w}px (off): captured ${path.join(SHOTS, `journey-off-${l}-${w}.png`).split("/").slice(-2).join("/")}, no horizontal scroll`);
  await ctx.close();
}

await browser.close();
for (const m of Object.values(mocks)) await m.close();
console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:journey-browser (${failed})`); process.exit(1); }
console.log("PASS test:journey-browser");
