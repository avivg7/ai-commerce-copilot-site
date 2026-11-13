// npm run test:launch-offer-browser: layout, CTA navigation, accessibility and expiry of the launch offer in real Chromium (P32).
//   node scripts/test-launch-offer-browser.mjs --announce <dir> --open <dir> --off <dir> --shots <dir> [--expired <dir>] [--limited <dir>] [--port-base <n>]
//     (--limited: an OPEN export built with NEXT_PUBLIC_AICC_EA_LIMITED_NOTE=on; --port-base: the local servers listen on n, n+1, n+2, n+3 instead of ephemeral ports)
//     (--expired: an export built with the OPEN switch but a pinned build clock after the end: AICC_EA_TEST_SEAM=1 AICC_BUILD_NOW_MS=<end + 1 s>)
// * layout: Home, Pricing and the request page in all four languages at 1440 and 390 px (Hebrew right-to-left), no horizontal overflow, the header keeps its token height, the Hero shows the
//   owner's badge, headline, subtitle and its two actions above the fold, tap targets are at least 44 px; a screenshot of every page is written to --shots;
// * P34 (owner request): the two-part pill, the short support lines right under the Hero buttons (one line each, above the fold, right-aligned in Hebrew), the card label and the support lines
//   under the cards, each with its text contrast COMPUTED from the painted colours (axe does not evaluate it here); the Home guarantee line is not visible while the offer is live;
// * CTA navigation (open): the Hero, the header (desktop and menu) and the plan cards lead to /request-access/ in the page language (cards with ?plan=); (announce): nothing leads anywhere;
// * accessibility: axe-core (WCAG 2.x A/AA + best-practice, zero violations) on the request page in its open, closed and done states and on the confirm page, four languages, two widths;
// * expiry: a stale open page loaded after the end instant shows the ended view (no request control visible), and a build made after the end carries nothing.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { launch } from "./lib/browser.mjs";
import { loadDictionaries } from "./lib/load.mjs";
import { startMock, fakeTurnstileScript } from "./lib/intake-mock.mjs";
import { REQUIRED_DATES } from "./lib/early-access-truth.mjs";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? path.resolve(args[i + 1]) : undefined; };
const dirs = { announce: arg("announce"), open: arg("open"), off: arg("off") }, SHOTS = arg("shots"), EXPIRED = arg("expired"), LIMITED = arg("limited");
const PB = (() => { const i = args.indexOf("--port-base"); return i >= 0 ? Number(args[i + 1]) : 0; })();
if (!dirs.announce || !dirs.open || !dirs.off || !SHOTS) { console.error("usage: --announce <dir> --open <dir> --off <dir> --shots <dir> [--expired <dir>]"); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });
const D = await loadDictionaries();
const LOCALES = ["en", "he", "es", "ru"];
const pre = (l) => (l === "en" ? "" : `/${l}`);
const norm = (t) => String(t).replace(/ /g, " ").replace(/\s+/g, " ").trim();
let failed = 0, total = 0;
const check = (cond, msg) => { total++; if (!cond) { failed++; console.error("  FAIL " + msg); } else console.log("  ok   " + msg); };
const END = Date.UTC(2026, 11, 31, 22, 0, 0);
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

const mocks = { announce: await startMock({ dir: dirs.announce, port: PB }), open: await startMock({ dir: dirs.open, port: PB ? PB + 1 : 0 }), off: await startMock({ dir: dirs.off, port: PB ? PB + 2 : 0 }), ...(LIMITED ? { limited: await startMock({ dir: LIMITED, port: PB ? PB + 3 : 0 }) } : {}) };
const browser = await launch();
async function view(mode, route, w, { now = END - 86400e3, h = 900, locale = "en", turnstile = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", locale: locale === "he" ? "he-IL" : "en-US" });
  await ctx.clock.setFixedTime(new Date(now));
  if (turnstile) await ctx.route("https://challenges.cloudflare.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: fakeTurnstileScript() }));
  const page = await ctx.newPage();
  await page.goto(mocks[mode].url + route, { waitUntil: "load" });
  await page.waitForTimeout(350);
  return { ctx, page };
}
const vis = (page, sel) => page.locator(sel).evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).map((e) => ({ href: e.getAttribute("href") || "", text: e.innerText })));

// ───────── layout and screenshots ─────────
console.log("== layout: Home, Pricing and the request page, four languages, 1440 and 390 px");
const shots = [];
for (const mode of ["announce", "open"]) for (const l of LOCALES) for (const w of [1440, 390]) {
  const ea = D[l].ea, hero = D[l].home.hero;
  const routes = [["home", `${pre(l)}/`], ["pricing", `${pre(l)}/pricing/`], ...(mode === "open" ? [["request", `${pre(l)}/request-access/`], ["confirm", `${pre(l)}/request-access/confirm/#t=Abc123_-Abc123_-Abc123_-Abc`]] : [])];
  for (const [name, route] of routes) {
    const { ctx, page } = await view(mode, route, w, { locale: l, h: w === 390 ? 844 : 900 });
    const tag = `${mode} ${l} ${name} @${w}`;
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, dir: document.documentElement.dir, hdr: document.querySelector(".aicc-site-header").getBoundingClientRect().height, bar: (() => { const b = document.querySelector(".aicc-eabar"); return b ? { clip: b.scrollHeight > b.clientHeight + 1, top: b.getBoundingClientRect().top, hb: document.querySelector(".aicc-site-header").getBoundingClientRect().bottom } : null; })() }));
    check(m.sw <= m.iw && m.dir === (l === "he" ? "rtl" : "ltr") && (w < 1024 || Math.abs(m.hdr - 76) <= 1) && (!m.bar || (!m.bar.clip && m.bar.top >= m.bar.hb - 0.5)), `${tag}: no horizontal scroll (${m.sw}<=${m.iw}), dir=${m.dir}, header ${Math.round(m.hdr)}px, bar not clipped`);
    if (name === "home") {
      const g = await page.evaluate(() => {
        const vq = (q) => [...document.querySelectorAll(q)].find((e) => e.getClientRects().length > 0);
        const acts = [...document.querySelectorAll(".aicc-hero__copy > .aicc-hero-actions .aicc-btn")].filter((e) => e.getClientRects().length > 0);
        return { h1: vq("h1").innerText.replace(/\s+/g, " ").trim(), lead: vq(".aicc-hero-lead").innerText.trim(), badge: vq(".aicc-eyebrow-pill").innerText.trim(), acts: acts.map((a) => ({ t: a.innerText.trim(), tag: a.tagName, bottom: a.getBoundingClientRect().bottom, h: a.getBoundingClientRect().height })), vh: innerHeight, reco: !!document.querySelector(".aicc-hero__visual canvas, .aicc-hero__visual img, .aicc-hero__visual svg, .aicc-hero__visual [data-reco], .aicc-hero__visual *"), note: document.querySelectorAll(".aicc-eanote").length };
      });
      check(norm(g.h1) === norm(`${hero.titleLead} ${hero.titleAccent}`) && norm(g.lead) === norm(hero.lead), `${tag}: the Hero headline and subtitle are exactly the live P24 text`);
      const pillText = `${mode === "open" ? ea.hero.badgeTag : ea.hero.badgeTagAnnounce} ${ea.hero.badge}`;
      check(norm(g.badge).toLowerCase() === norm(pillText).toLowerCase(), `${tag}: the pill says "${pillText}" (tag, then the date line)`);
      const want = mode === "open" ? [ea.hero.ctaOpen, hero.ctaDemo, hero.ctaPlans] : [hero.ctaDemo, hero.ctaPlans]; // P36: Try Live Demo and See Pricing are the Hero actions in every mode
      check(g.acts.map((a) => norm(a.t)).join("|") === want.map(norm).join("|") && g.acts.every((a) => a.h >= 44) && g.acts.every((a) => a.bottom <= g.vh) && g.acts.every((a) => a.tag === "A"), `${tag}: Hero actions "${want.join('" and "')}" are real links, above the fold and at least 44 px tall`);
      { // P34 (owner request, replacing the P32 "nothing after the action row"): the short support lines are the next element after the actions, one line each, above the fold
        const sp = await page.evaluate(() => {
          const acts = document.querySelector(".aicc-hero__copy > .aicc-hero-actions"), ul = acts.nextElementSibling;
          if (!ul || !ul.matches("ul.aicc-easupport")) return null;
          const lis = [...ul.querySelectorAll("li")].map((li) => { const r = li.getBoundingClientRect(), lh = parseFloat(getComputedStyle(li).lineHeight) || parseFloat(getComputedStyle(li).fontSize) * 1.4; return { t: li.innerText.trim(), h: r.height, lh, bottom: r.bottom, left: r.left, right: r.right }; });
          const ar = acts.getBoundingClientRect(), ur = ul.getBoundingClientRect();
          return { lis, after: ur.top >= ar.bottom - 1, gap: Math.round(ur.top - ar.bottom), next: ul.nextElementSibling ? ul.nextElementSibling.className : null, fs: parseFloat(getComputedStyle(ul).fontSize), dir: getComputedStyle(ul).direction, iw: innerWidth };
        });
        const wantS = [ea.hero.support.noCard, ea.hero.support.noAuto, ea.hero.support.approval].map(norm);
        check(sp && JSON.stringify(sp.lis.map((x) => norm(x.t))) === JSON.stringify(wantS) && sp.after && sp.next === (mode === "announce" ? "aicc-eanote" : null), `${tag}: right under the Hero actions (${sp ? sp.gap : "?"} px) the support lines "${wantS.join('", "')}" and nothing else`);
        check(sp && sp.lis.every((x) => x.h <= x.lh * 1.5 + 2 && x.left >= 0 && x.right <= sp.iw) && sp.fs >= 13, `${tag}: each support line is a single line inside the viewport (${sp ? sp.lis.map((x) => Math.round(x.h)).join("/") : "?"} px, ${sp ? sp.fs : "?"} px text)`);
        check(sp && sp.lis.every((x) => x.bottom <= g.vh), `${tag}: the support lines are above the fold (${sp ? Math.round(Math.max(...sp.lis.map((x) => x.bottom))) : "?"} <= ${g.vh})`);
        if (l === "he") check(sp && sp.dir === "rtl", `${tag}: the support lines run right to left`);
      }
      check(g.reco, `${tag}: Reco and the Hero visual are present`);
      { // the date in the badge never breaks across lines (no-break spaces), at 390 px too
        const lastNb = REQUIRED_DATES[l][0].until.replace(/ /g, "\u00a0");
        const lines = await page.evaluate((d) => { const el = [...document.querySelectorAll(".aicc-eyebrow-pill")].find((e) => e.getClientRects().length); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const i = n.data.indexOf(d); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + d.length); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; } } return -1; }, lastNb);
        check(lines === 1, `${tag}: the date in the badge stays on one line (${lines === -1 ? "date not found" : lines + " line"})`); }
      if (mode === "announce") {
        const notes = await page.evaluate(() => [...document.querySelectorAll(".aicc-eanote")].filter((e) => e.getClientRects().length > 0).map((e) => ({ tag: e.tagName, cls: e.className, role: e.getAttribute("role"), tabindex: e.getAttribute("tabindex"), t: e.innerText.trim(), cursor: getComputedStyle(e).cursor, border: getComputedStyle(e).borderTopWidth, bg: getComputedStyle(e).backgroundColor })));
        check(notes.length >= 2 && notes.every((n) => n.tag === "P" && !/aicc-btn/.test(n.cls) && !n.role && n.tabindex === null && norm(n.t) === norm(ea.hero.ctaAnnounce) && n.border === "0px" && n.bg === "rgba(0, 0, 0, 0)"), `${tag}: "${ea.hero.ctaAnnounce}" is plain text (${notes.length} places: no button class, no border, no fill, no role)`);
      }
    }
    if (name === "pricing" || name === "home") { // P34: the card label and the support lines under the cards, visible; the Home guarantee line hidden while live
      const q = await page.evaluate(() => ({
        pills: [...document.querySelectorAll(".aicc-plan [data-ea-pill]")].filter((e) => e.getClientRects().length).map((e) => e.innerText.trim()),
        sup: [...document.querySelectorAll('[data-ea-support="plans"] li')].filter((e) => e.getClientRects().length).map((e) => ({ t: e.innerText.trim(), h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) })),
        conf: [...document.querySelectorAll(".aicc-pricing-confidence")].some((e) => e.getClientRects().length > 0),
      }));
      check(q.pills.length === 3 && q.pills.every((x) => norm(x) === norm(ea.plan.pill)), `${tag}: every card shows the label "${ea.plan.pill}"`);
      check(q.sup.length === 0, `${tag}: no repeated support lines under the cards (P36: the cards carry the checks)`);
      check(q.sup.every((x) => x.h <= x.lh * (w === 390 ? 2.5 : 1.5) + 2), `${tag}: the support lines under the cards stay short (${q.sup.map((x) => Math.round(x.h)).join("/")} px)`);
      if (name === "home") check(!q.conf, `${tag}: the ordinary list with the 14-day guarantee line is not visible while the offer is live`);
    }
    if (name === "pricing") {
      const cards = await page.locator(".aicc-plan").evaluateAll((els) => els.map((e) => ({ r: e.getBoundingClientRect().toJSON(), t: e.innerText.replace(/\s+/g, " "), iw: innerWidth })));
      check(cards.length === 3 && cards.every((c) => c.r.right <= c.iw + 1 && c.r.left >= -1), `${tag}: three plan cards fit the viewport`);
      const actions = await vis(page, ".aicc-plan .aicc-btn").then((x) => x.length);
      check(actions === 3, `${tag}: one action (or status) per card`);
    }
    if (name === "request") {
      await page.waitForSelector("[data-req-state=form]");
      const q = await page.evaluate(() => {
        const box = (e) => e.getBoundingClientRect();
        const ctl = [...document.querySelectorAll("#req-email, #req-store, #req-plan")].map((e) => ({ h: box(e).height, l: box(e).left, r: box(e).right }));
        const chk = [...document.querySelectorAll(".aicc-req__check")].map((e) => box(e).height);
        const sub = box(document.querySelector("button[type=submit]"));
        return { ctl, chk, sub: sub.height, iw: innerWidth };
      });
      check(q.ctl.every((c) => c.h >= 44 && c.l >= 0 && c.r <= q.iw) && q.chk.every((h) => h >= 44) && q.sub >= 44, `${tag}: inputs, checkbox rows and the submit button are at least 44 px and inside the viewport`);
      await page.waitForSelector("[data-fake-ts-button]");
    }
    if (name === "confirm") await page.waitForSelector("[data-req-confirm=ready]");
    const file = path.join(SHOTS, `${mode}-${l}-${name}-${w}.png`);
    await page.screenshot({ path: file, fullPage: name !== "home" });
    shots.push(file);
    if (name === "home" && (l === "en" || l === "he")) { const full = path.join(SHOTS, `${mode}-${l}-home-full-${w}.png`); await page.screenshot({ path: full, fullPage: true }); shots.push(full); } // P34: the support lines under the Home cards too
    await ctx.close();
  }
}
for (const l of LOCALES) { // the ordinary (OFF) Home for comparison
  const { ctx, page } = await view("off", `${pre(l)}/`, 1440, { locale: l });
  const file = path.join(SHOTS, `off-${l}-home-1440.png`); await page.screenshot({ path: file }); shots.push(file); await ctx.close();
}
{ // the request page in its closed and done states
  for (const state of ["closed", "done"]) for (const l of ["en", "he"]) {
    mocks.open.reset(); if (state === "closed") mocks.open.set({ status: "closed" });
    const { ctx, page } = await view("open", `${pre(l)}/request-access/`, 390, { locale: l, h: 844 });
    if (state === "done") { await page.waitForSelector("[data-req-state=form]"); await page.fill("#req-email", "a@shop.example"); await page.fill("#req-store", "https://shop.example"); await page.check("#req-operator"); await page.check("#req-consent"); await page.click("[data-fake-ts-button]"); await page.waitForTimeout(3100); await page.click("button[type=submit]"); await page.waitForSelector("[data-req-state=done]"); }
    else await page.waitForSelector("[data-req-state=closed]");
    const file = path.join(SHOTS, `open-${l}-request-${state}-390.png`); await page.screenshot({ path: file, fullPage: true }); shots.push(file); await ctx.close();
  }
  mocks.open.reset();
}
check(shots.length >= 50, `${shots.length} screenshots written to ${SHOTS}`);

// ───────── the launch Hero IS the final P24 Hero (structure and computed sizes) ─────────
console.log("== hero parity: the launch hero against the ordinary P24 hero (only the badge line, the two action labels and, P34, the support lines under the actions may differ)");
{
  const probe = () => {
    const q = (sel) => document.querySelector(sel);
    const cs = (e, k) => parseFloat(getComputedStyle(e)[k]);
    const hero = q(".aicc-hero--home"), h1 = q(".aicc-hero-title"), lead = q(".aicc-hero-lead"), acts = q(".aicc-hero__copy > .aicc-hero-actions"), grid = q(".aicc-hero__grid");
    const btns = [...acts.querySelectorAll(".aicc-btn")].filter((b) => b.getClientRects().length > 0);
    const r = (e) => e.getBoundingClientRect();
    const heroCs = getComputedStyle(hero);
    // the skeleton: every class used inside the hero, minus the status variant of the announce button and the arrow icon of the request button
    // P34: and the classes of the two-part pill and of the support lines (the only additions the owner asked for; everything they do not touch is still compared)
    const classes = [...new Set([...hero.querySelectorAll("*")].flatMap((e) => [...e.classList]))].filter((c) => !/^aicc-(btn--soon|eastatus|flip|eabadge|eabadge__tag|eabadge__text|easupport|eanote)$|^lucide/.test(c)).sort();
    return {
      h1: { size: cs(h1, "fontSize"), lh: getComputedStyle(h1).lineHeight, mt: cs(h1, "marginTop"), ls: getComputedStyle(h1).letterSpacing }, lead: { size: cs(lead, "fontSize"), mt: cs(lead, "marginTop"), w: getComputedStyle(lead).maxWidth },
      actionsMt: cs(acts, "marginTop"), btnH: btns.map((b) => Math.round(r(b).height)), pb: heroCs.paddingBottom, minH: heroCs.minHeight === "0px" ? "0" : "set", display: heroCs.display, gridGap: getComputedStyle(grid).columnGap,
      gapH1Lead: Math.round(r(lead).top - r(h1).bottom), gapLeadActions: Math.round(r(acts).top - r(lead).bottom), classes, ctaCount: btns.length,
      secondaryBorder: getComputedStyle(btns[btns.length - 1]).borderTopWidth, anim: getComputedStyle(h1.closest(".aicc-fade-up") || h1).animationName,
      vis: !!q(".aicc-hero__visual"), top: Math.round(r(h1).top),
    };
  };
  const VIEWS = [[1440, 900], [1280, 720], [1024, 768], [768, 1024], [390, 844]];
  for (const l of ["en", "he", "ru"]) for (const [w, h] of VIEWS) for (const mode of ["open", "announce"]) {
    const o = await view("off", `${pre(l)}/`, w, { locale: l, h }); const a = await o.page.evaluate(probe); await o.ctx.close();
    const c = await view(mode, `${pre(l)}/`, w, { locale: l, h }); const b = await c.page.evaluate(probe); await c.ctx.close();
    const bOpen = mode === "open" ? { ...b, btnH: b.btnH.slice(1), ctaCount: b.ctaCount - 1 } : b; // P36: an OPEN Hero adds one real "Request Free Access" link before Try Live Demo and See Pricing; every other metric must equal the P24 Hero
    const same = JSON.stringify([a.h1, a.lead, a.actionsMt, a.btnH, a.pb, a.minH, a.display, a.gridGap, a.gapH1Lead, a.gapLeadActions, a.classes, a.ctaCount, a.secondaryBorder, a.anim, a.vis]) === JSON.stringify([b.h1, b.lead, b.actionsMt, bOpen.btnH, b.pb, b.minH, b.display, b.gridGap, b.gapH1Lead, b.gapLeadActions, b.classes, bOpen.ctaCount, b.secondaryBorder, b.anim, b.vis]);
    check(same, `${mode} ${l} @${w}x${h}: the launch hero equals the P24 hero (headline ${b.h1.size}px/${b.h1.lh}, subtitle ${b.lead.size}px, gaps ${b.gapH1Lead}/${b.gapLeadActions}, buttons ${b.btnH.join("+")}, padding-bottom ${b.pb}, min-height ${b.minH})${same ? "" : " <> OFF " + JSON.stringify({ h1: a.h1, lead: a.lead, gaps: [a.gapH1Lead, a.gapLeadActions], btn: a.btnH, pb: a.pb, minH: a.minH })}`);
  }
}

// ───────── P34: computed text contrast of the new elements (measured from the painted pixels: the text is made transparent, the background behind each text box is sampled) ─────────
console.log("== P34 contrast: pill tag and date line, Hero support lines, card label, support lines under the cards (en, he; 1440 and 390; announce and open)");
async function p34Contrast(page) {
  const SEL = [".aicc-eabadge__tag", ".aicc-eabadge__text", '[data-ea-support="hero"] li span', ".aicc-plan [data-ea-pill] .aicc-badge", ".aicc-plan__checks li span", ".aicc-plan__free-until", ".aicc-plan__regular-line", ".aicc-plan__regular-label", ".aicc-eanote span"];
  const items = await page.evaluate((SEL) => {
    const pf = (c) => { const p = c.match(/rgba?\(([^)]+)\)/)[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; };
    // P36: the opaque background colour behind an element, or null when a gradient/image paints behind it first (then the pixels are sampled instead)
    const solidBg = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n); if (c.backgroundImage && c.backgroundImage !== "none") return null; const b = pf(c.backgroundColor); if (b[3] === 1) return b.slice(0, 3); if (b[3] > 0) return null; } return [255, 255, 255]; };
    // the boxes of the TEXT itself (a Range over the element's text), not the element box: the curved corners of a pill lie outside its painted background
    return SEL.flatMap((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length).flatMap((e) => { const cs = getComputedStyle(e); const rg = document.createRange(); rg.selectNodeContents(e); return [...rg.getClientRects()].filter((r) => r.width > 2 && r.height > 2).map((r) => ({ sel, t: e.innerText.trim().slice(0, 40), fg: pf(cs.color), bg: solidBg(e), fs: parseFloat(cs.fontSize), fw: parseInt(cs.fontWeight), y: r.top + scrollY, x: r.left + scrollX, w: r.width, h: r.height })); }));
  }, SEL);
  // P36: the FREE word is gradient text (a clipped BACKGROUND, so transparent text does not remove it): it is measured separately below and hidden here so it cannot pollute a neighbouring sample
  await page.addStyleTag({ content: "*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important} svg{visibility:hidden!important} .aicc-plan__free-word{background:none!important}" });
  // P36: fixed and sticky layers (the header, the language hint) can sit over a measured text box at some scroll positions and corrupt the pixel sample: they are hidden for the measurement only
  await page.evaluate(() => { for (const e of document.querySelectorAll("*")) { const p = getComputedStyle(e).position; if (p === "fixed" || p === "sticky") e.style.visibility = "hidden"; } });
  await page.waitForTimeout(150);
  const out = [], direct = [];
  for (const it of items) {
    if (it.bg) { direct.push({ sel: it.sel, t: it.t, fg: it.fg, bg: it.bg, fs: it.fs, fw: it.fw }); continue; }
    await page.evaluate((y) => scrollTo(0, Math.max(0, y - 200)), it.y);
    const sy = await page.evaluate(() => scrollY);
    const buf = await page.screenshot({ clip: { x: Math.max(0, it.x), y: it.y - sy, width: Math.max(2, it.w), height: Math.max(2, it.h) }, animations: "disabled" });
    out.push({ ...it, png: buf.toString("base64") });
  }
  const pg = await page.context().newPage(); await pg.setContent("<canvas id=c></canvas>");
  const res = await pg.evaluate(async (out) => {
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const cv = document.getElementById("c"), g = cv.getContext("2d", { willReadFrequently: true });
    const r = [];
    for (const it of out) {
      const bm = await createImageBitmap(await (await fetch("data:image/png;base64," + it.png)).blob()); cv.width = bm.width; cv.height = bm.height; g.drawImage(bm, 0, 0);
      const d = g.getImageData(0, 0, bm.width, bm.height).data; let worst = 99;
      for (let i = 0; i < d.length; i += 4 * 7) { const bg = [d[i], d[i + 1], d[i + 2]], a = it.fg[3], fg = [it.fg[0] * a + bg[0] * (1 - a), it.fg[1] * a + bg[1] * (1 - a), it.fg[2] * a + bg[2] * (1 - a)]; worst = Math.min(worst, ratio(fg, bg)); }
      r.push({ sel: it.sel, t: it.t, ratio: +worst.toFixed(2), large: it.fs >= 24 || (it.fs >= 18.66 && it.fw >= 700) });
    }
    return r;
  }, out);
  await pg.close();
  {
    const lumv = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    for (const d of direct) { const a = d.fg[3], fg = [0, 1, 2].map((i) => d.fg[i] * a + d.bg[i] * (1 - a)); const [x, y] = [lumv(fg), lumv(d.bg)].sort((p, q) => q - p); res.push({ sel: d.sel, t: d.t, ratio: +(((x + 0.05) / (y + 0.05)).toFixed(2)), large: d.fs >= 24 || (d.fs >= 18.66 && d.fw >= 700) }); }
  }
  return res;
}
for (const mode of ["announce", "open"]) for (const l of ["en", "he"]) for (const w of [1440, 390]) for (const route of ["/", "/pricing/"]) {
  const { ctx, page } = await view(mode, `${pre(l)}${route}`, w, { locale: l, h: w === 390 ? 844 : 900 });
  { // P36: the FREE word is brand-gradient TEXT (transparent fill), so it cannot be sampled from pixels: both ends of the gradient must reach 3:1 (large text) against the card background
    const g = await page.evaluate(() => { const e = document.querySelector(".aicc-plan .aicc-plan__free-word"); if (!e || !e.getClientRects().length) return null; const cs = getComputedStyle(e); let bg = null; for (let n = e; n && !bg; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)") bg = c; } return { img: cs.backgroundImage, fs: parseFloat(cs.fontSize), fw: Number(cs.fontWeight), bg }; });
    const px = (c) => c.match(/rgba?\(([^)]+)\)/)[1].split(/[ ,/]+/).filter(Boolean).map(Number).slice(0, 3);
    const lum = ([r, gg, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    if (g) { const ends = (g.img.match(/rgba?\([^)]+\)/g) || []).map(px); const worst = Math.min(...ends.map((c) => ratio(c, px(g.bg)))); check(ends.length >= 2 && g.fs >= 24 && worst >= 3, `${mode} ${l}${route} @${w}: the FREE gradient text keeps ${worst.toFixed(2)}:1 or more against the card (large text needs 3:1; ${g.fs}px)`); }
  }
  const res = await p34Contrast(page);
  const need = route === "/" ? [".aicc-eabadge__tag", ".aicc-eabadge__text", '[data-ea-support="hero"] li span', ".aicc-plan [data-ea-pill] .aicc-badge", ".aicc-plan__checks li span", ".aicc-plan__free-until", ".aicc-plan__regular-line", ".aicc-plan__regular-label"] : [".aicc-plan [data-ea-pill] .aicc-badge", ".aicc-plan__checks li span", ".aicc-plan__free-until", ".aicc-plan__regular-line", ".aicc-plan__regular-label"]; // the measured text kinds of the P36 design (the FREE word is a gradient: measured separately below)
  const kinds = new Set(res.map((r) => r.sel));
  const low = res.filter((r) => r.ratio < (r.large ? 3 : 4.5));
  check(need.every((k) => kinds.has(k)) && (mode !== "announce" || kinds.has(".aicc-eanote span")) && low.length === 0, `${mode} ${l}${route} @${w}: ${res.length} new text runs measured, lowest ${Math.min(...res.map((r) => r.ratio)).toFixed(2)}:1 (need 4.5:1)${low.length ? " -> " + low.slice(0, 3).map((r) => `${r.ratio} "${r.t}" ${r.sel}`).join(" | ") : ""}`);
  await ctx.close();
}

// ───────── P34: "Limited availability" only with its switch ─────────
if (LIMITED) {
  console.log("== P34: NEXT_PUBLIC_AICC_EA_LIMITED_NOTE=on (an OPEN export)");
  for (const l of LOCALES) for (const w of [1440, 390]) {
    const { ctx, page } = await view("limited", `${pre(l)}/`, w, { locale: l, h: w === 390 ? 844 : 900 });
    const t = await page.evaluate(() => [...document.querySelectorAll('[data-ea-support="hero"] li')].filter((e) => e.getClientRects().length).map((e) => ({ t: e.innerText.trim(), b: e.getBoundingClientRect().bottom, icon: !!e.querySelector("svg") })));
    // P36 (UX spec): the three checks are no card, no automatic renewal, approval required; "Limited availability" is the fourth item, a plain chip (this block still expected the P34 three-line list until P37)
    check(t.length === 4 && t[3].icon === false && t[0].icon && t[1].icon && t[2].icon, `${l} @${w}: "Limited availability" is a plain chip without a check icon (review P34-5)`);
    const want = [D[l].ea.hero.support.noCard, D[l].ea.hero.support.noAuto, D[l].ea.hero.support.approval, D[l].ea.hero.support.limited].map(norm);
    check(JSON.stringify(t.map((x) => norm(x.t))) === JSON.stringify(want) && t.every((x) => !/\d/.test(x.t)), `${l} @${w}: the Hero support lines are "${want.join('", "')}" (no number, no countdown)`);
    if (l === "en" || l === "he") { const file = path.join(SHOTS, `limited-${l}-home-${w}.png`); await page.screenshot({ path: file }); }
    await ctx.close();
  }
  for (const l of LOCALES) { const { ctx, page } = await view("limited", `${pre(l)}/`, 1440, { locale: l }); await axe(page, `limited ${l}/ @1440`); await ctx.close(); }
}
for (const l of LOCALES) { // and never without it
  const { ctx, page } = await view("open", `${pre(l)}/`, 1440, { locale: l });
  const n = await page.evaluate((x) => document.body.innerText.includes(x), D[l].ea.hero.support.limited);
  check(!n, `${l}: without the switch the page never says "${D[l].ea.hero.support.limited}"`);
  await ctx.close();
}

// ───────── CTA navigation ─────────
console.log("== CTA navigation");
for (const l of LOCALES) {
  const want = `${pre(l)}/request-access/`;
  const path_ = async (p) => new URL(p.url()).pathname;
  { // Hero
    const { ctx, page } = await view("open", `${pre(l)}/`, 1440, { locale: l });
    await page.locator(".aicc-hero__copy > .aicc-hero-actions a.aicc-btn--primary").first().click();
    await page.waitForURL(/request-access/); check((await path_(page)) === want, `${l}: the Hero button opens ${want}`);
    await ctx.close(); }
  { // header (desktop)
    const { ctx, page } = await view("open", `${pre(l)}/pricing/`, 1440, { locale: l });
    await page.locator(".aicc-site-header a[data-ea-live]:visible").first().click();
    await page.waitForURL(/request-access/); check((await path_(page)) === want, `${l}: the header button opens ${want}`);
    await ctx.close(); }
  { // header (mobile menu)
    const { ctx, page } = await view("open", `${pre(l)}/`, 390, { locale: l, h: 844 });
    await page.click("[data-aicc-menu-btn]"); await page.waitForTimeout(150);
    await page.locator("#aicc-menu-panel a[data-ea-live]:visible").first().click();
    await page.waitForURL(/request-access/); check((await path_(page)) === want, `${l}: the mobile menu button opens ${want}`);
    await ctx.close(); }
  for (const plan of ["solo", "studio", "agency"]) { // plan cards
    const { ctx, page } = await view("open", `${pre(l)}/pricing/`, 1440, { locale: l });
    const idx = ["solo", "studio", "agency"].indexOf(plan);
    await page.locator(".aicc-plan").nth(idx).locator("a.aicc-btn").click();
    await page.waitForURL(/request-access/); const u = new URL(page.url());
    await page.waitForSelector("[data-req-state=form]");
    check(u.pathname === want && u.searchParams.get("plan") === plan && (await page.inputValue("#req-plan")) === plan, `${l}: the ${plan} card opens ${want}?plan=${plan} and preselects the plan`);
    await ctx.close(); }
  { // announce: nothing to click
    const { ctx, page } = await view("announce", `${pre(l)}/`, 1440, { locale: l });
    const before = page.url();
    await page.locator(".aicc-hero [data-ea-soon]").click({ trial: false }).catch(() => {});
    await page.waitForTimeout(200);
    const links = await vis(page, "a").then((all) => all.filter((a) => /request/.test(a.href)).length);
    check(page.url() === before && links === 0, `${l}: announce: clicking the Hero request status changes nothing and no link leads to a request page`);
    await ctx.close(); }
}

// ───────── accessibility (axe) ─────────
console.log("== accessibility: axe-core on the request pages (open, closed and done states) and the confirm page");
async function axe(page, label) {
  await page.evaluate(axeSource);
  const res = await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] }), TAGS);
  check(res.violations.length === 0, `axe ${label}: ${res.violations.length} violation(s)${res.violations.length ? " -> " + res.violations.map((v) => `${v.id}(${v.impact}) ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(";")}`).join(" | ") : ""}`);
}
for (const l of LOCALES) for (const w of [1440, 390]) {
  mocks.open.reset();
  { const { ctx, page } = await view("open", `${pre(l)}/request-access/`, w, { locale: l, h: 844 }); await page.waitForSelector("[data-fake-ts-button]"); await axe(page, `${l} request (form) @${w}`);
    // error state: submit empty so the summary and the field errors are on the page
    await page.click("button[type=submit]"); await page.waitForTimeout(200); await axe(page, `${l} request (errors) @${w}`);
    // keyboard: every control is reachable and shows a focus ring; the form submits with the keyboard
    if (w === 1440) {
      const order = []; await page.evaluate(() => document.querySelector("main").focus());
      for (let i = 0; i < 25; i++) { await page.keyboard.press("Tab"); const id = await page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("name") || document.activeElement?.tagName); order.push(id); }
      check(["req-email", "req-store", "req-plan", "req-operator", "req-consent"].every((x) => order.includes(x)) && !order.includes("website"), `${l}: Tab reaches e-mail, store, plan, both checkboxes and the submit button, and skips the honeypot (${order.slice(0, 12).join(" > ")})`);
      const ring = await page.evaluate(() => { const e = document.querySelector("#req-email"); e.focus(); const cs = getComputedStyle(e); return cs.outlineStyle !== "none" || cs.boxShadow !== "none"; });
      check(ring, `${l}: a focused field shows a focus indicator`);
    }
    await ctx.close(); }
  { mocks.open.set({ status: "closed" }); const { ctx, page } = await view("open", `${pre(l)}/request-access/`, w, { locale: l, h: 844 }); await page.waitForSelector("[data-req-state=closed]"); await axe(page, `${l} request (closed) @${w}`); await ctx.close(); mocks.open.reset(); }
  { const { ctx, page } = await view("open", `${pre(l)}/request-access/`, w, { locale: l, h: 844 }); await page.waitForSelector("[data-req-state=form]"); await page.fill("#req-email", "a@shop.example"); await page.fill("#req-store", "https://shop.example"); await page.check("#req-operator"); await page.check("#req-consent"); await page.click("[data-fake-ts-button]"); await page.waitForTimeout(3100); await page.click("button[type=submit]"); await page.waitForSelector("[data-req-state=done]");
    check(await page.evaluate(() => document.activeElement?.getAttribute("data-req-state") === "done"), `${l} @${w}: focus moves to the result after a submit`); await axe(page, `${l} request (done) @${w}`); await ctx.close(); }
  { const { ctx, page } = await view("open", `${pre(l)}/request-access/confirm/#t=Abc123_-Abc123_-Abc123_-Abc`, w, { locale: l, h: 844 }); await page.waitForSelector("[data-req-confirm=ready]"); await axe(page, `${l} confirm (ready) @${w}`); await page.click("[data-req-confirm] button"); await page.waitForSelector("[data-req-confirm=done]"); await axe(page, `${l} confirm (result) @${w}`); await ctx.close(); }
}
for (const mode of ["announce", "open"]) for (const l of LOCALES) for (const route of ["/", "/pricing/"]) {
  const { ctx, page } = await view(mode, `${pre(l)}${route}`, 1440, { locale: l }); await axe(page, `${mode} ${l}${route} @1440`); await ctx.close();
}

// ───────── expiry ─────────
console.log("== expiry");
for (const l of LOCALES) {
  const { ctx, page } = await view("open", `${pre(l)}/`, 1440, { locale: l, now: END + 1000 });
  const links = await vis(page, "a[href*='request-access']").then((a) => a.length);
  const bar = await vis(page, ".aicc-eabar").then((a) => a.length);
  const acts = (await vis(page, ".aicc-hero__copy > .aicc-hero-actions .aicc-btn")).map((a) => norm(a.text)).join(" | ");
  check(links === 0 && bar === 0 && acts === `${D[l].home.hero.ctaDemo} | ${D[l].home.hero.ctaPlans}`, `${l}: a stale OPEN page loaded 1 s after 2026-12-31T22:00:00Z shows the ended view (no request link, no bar, Hero "${acts}")`);
  { // review P34-6: the ended view shows the ordinary Home list (from its div data-ea-after) without the guarantee line, and none of the P34 support lines
    const v = await page.evaluate((g) => ({ conf: [...document.querySelectorAll(".aicc-pricing-confidence")].filter((e) => e.getClientRects().length).map((e) => e.innerText), sup: [...document.querySelectorAll("[data-ea-support]")].some((e) => e.getClientRects().length), g: document.body.innerText.includes(g) }), D[l].home.pricing.confidence.guarantee);
    check(v.conf.length === 1 && !v.sup && !v.g, `${l}: ended view: the ordinary price/renewal list is visible again, the support lines are gone, no guarantee line`);
  }
  await ctx.close();
}
for (const l of ["en", "he"]) {
  const { ctx, page } = await view("open", `${pre(l)}/pricing/`, 1440, { locale: l, now: END - 1 });
  check((await vis(page, "a[href*='request-access']").then((a) => a.length)) >= 4, `${l}: 1 ms before the end the request buttons are still live`);
  await ctx.close();
}
if (EXPIRED) {
  const fs2 = await import("node:fs");
  const home = fs2.readFileSync(path.join(EXPIRED, "index.html"), "utf8");
  check(!/data-ea-mode|aicc-eabar|Request Free Access|request-access/.test(home) && !fs2.existsSync(path.join(EXPIRED, "request-access")), "a build made with the OPEN switch after the end (pinned build clock) ignores it: no campaign, no request pages");
}

await browser.close();
for (const m of Object.values(mocks)) await m.close();
console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:launch-offer-browser (${failed})`); process.exit(1); }
console.log("PASS test:launch-offer-browser");
