// npm run test:shopper-demo -- --url http://127.0.0.1:3011 [--surface site|cp] [--path /] [--locales en,he]
//
// Pins the OWNER-APPROVED shopper demo ("What shoppers see": Product page | Cart inside ONE interactive demo, WooCommerce vs AICC, merchant view)
// on a LIVE rendering, on either surface that carries it: the marketing Site export (--surface site) or the Control Plane theme (--surface cp).
//   1. SEMANTIC invariants (what the owner approved, not generic structure).
//   2. LAYOUT sanity (the Control Plane once rendered the approved demo collapsed because the theme styles `.aicc-store` too: geometry is asserted).
//   3. APPROVED VISUAL snapshots of the five key states (tests/approved-visuals/shopper-demo/<surface>/), compared pixel for pixel.
// Baselines are NEVER written by a normal run. Updating them is an explicit owner-review action:
//   AICC_APPROVE_SHOPPER_DEMO=owner-reviewed npm run test:shopper-demo -- --url ... --surface site --update-baseline
// A missing baseline is a FAILURE (a merge or a sync must not silently create its own expectation).
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import { ROOT } from "./lib/load.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);
const URL0 = (arg("url", process.env.AICC_BASE_URL || "http://127.0.0.1:3011")).replace(/\/$/, "");
const SURFACE = arg("surface", "site");
const PATH0 = arg("path", "/");
const LOCALES = arg("locales", "en,he").split(",");
const WIDTHS = arg("widths", "1280,390").split(",").map(Number);
const UPDATE = flag("update-baseline");
const CAPTURE_ONLY = arg("capture-only", "");           // write the five states to this dir and exit (used to prove a refactor is pixel-neutral)
const DUMP = process.env.AICC_GUARD_DUMP || "";
const BASE_DIR = path.join(ROOT, "tests", "approved-visuals", "shopper-demo", SURFACE);
const TOLERANCE = Number(process.env.AICC_GUARD_TOLERANCE || 0.002);   // share of pixels allowed to differ by more than 6/765 summed channels
if (!["site", "cp"].includes(SURFACE)) { console.error("--surface must be site or cp"); process.exit(2); }
if (UPDATE && process.env.AICC_APPROVE_SHOPPER_DEMO !== "owner-reviewed") {
  console.error("Refusing to write approved baselines: this is an OWNER-REVIEW action. Re-run with AICC_APPROVE_SHOPPER_DEMO=owner-reviewed after the owner has seen the new states.");
  process.exit(2);
}

let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { if (ok) passed++; else { failed++; console.log(`FAIL  ${name}${detail ? "  -> " + String(detail).slice(0, 400) : ""}`); } };

const STATES = [
  ["page-woo", { surface: "page", mode: "without", view: "shopper" }],
  ["page-aicc", { surface: "page", mode: "with", view: "shopper" }],
  ["cart-woo", { surface: "cart", mode: "without", view: "shopper" }],
  ["cart-aicc", { surface: "cart", mode: "with", view: "shopper" }],
  ["merchant", { surface: "page", mode: "with", view: "merchant" }],
];

const FREEZE = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
.aicc-site-header,header.aicc-header,#aicc-lang-toast,.aicc-lang-toast,.aicc-skip,[class*="a11y-trigger"],[class*="cookie"],[id*="wpadminbar"]{display:none!important}`;

async function openDemo(browser, locale, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce", deviceScaleFactor: 1, locale: locale === "he" ? "he-IL" : "en-US" });
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "1"); localStorage.setItem("aicc_a11y", JSON.stringify({ motion: "reduce" })); } catch {} });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const base = URL0 + (locale === "en" ? "" : `/${locale}`) + (PATH0 === "/" ? "/" : PATH0);
  await p.goto(base, { waitUntil: "load", timeout: 120000 });
  await p.addStyleTag({ content: FREEZE });
  await p.evaluate(() => (document.querySelector("#demo") || document.querySelector(".aicc-fbt"))?.scrollIntoView());
  await p.waitForSelector(".aicc-fbt [data-surface]", { state: "attached", timeout: 30000 });
  await p.evaluate(() => document.fonts && document.fonts.ready);
  return { ctx, p, errors };
}

async function setState(p, st) {
  await p.click(`.aicc-fbt [data-view=shopper]`);
  await p.click(`.aicc-fbt [data-surface=${st.surface}]`);
  await p.click(`.aicc-fbt [data-mode=${st.mode}]`);
  if (st.view === "merchant") await p.click(`.aicc-fbt [data-view=merchant]`);
  await p.waitForTimeout(350);
  await p.evaluate(() => document.fonts && document.fonts.ready);
}

async function shot(p) {
  const el = await p.$(".aicc-fbt");
  return el.screenshot({ type: "png", animations: "disabled" });
}

// compare two PNG buffers inside a throwaway page (no image library needed)
async function comparePng(browser, a, b) {
  const pg = await browser.newPage();
  const r = await pg.evaluate(async ([x, y]) => {
    const ld = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
    const [A, B] = await Promise.all([ld(x), ld(y)]);
    if (A.width !== B.width || A.height !== B.height) return { size: [A.width, A.height, B.width, B.height] };
    const px = (I) => { const c = document.createElement("canvas"); c.width = I.width; c.height = I.height; const g = c.getContext("2d"); g.drawImage(I, 0, 0); return g.getImageData(0, 0, I.width, I.height).data; };
    const da = px(A), db = px(B); let n = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 6) n++;
    return { n, total: A.width * A.height, w: A.width, h: A.height };
  }, ["data:image/png;base64," + a.toString("base64"), "data:image/png;base64," + b.toString("base64")]);
  await pg.close();
  return r;
}

const browser = await launch();

// ---------------------------------------------------------------- capture-only mode
if (CAPTURE_ONLY) {
  fs.mkdirSync(CAPTURE_ONLY, { recursive: true });
  for (const w of WIDTHS) {
    const { ctx, p } = await openDemo(browser, "en", w);
    for (const [name, st] of STATES) { await setState(p, st); fs.writeFileSync(path.join(CAPTURE_ONLY, `${name}-${w}.png`), await shot(p)); }
    await ctx.close();
  }
  await browser.close();
  console.log(`captured ${STATES.length * WIDTHS.length} snapshots into ${CAPTURE_ONLY}`);
  process.exit(0);
}

// ---------------------------------------------------------------- 1 + 2: semantic and layout invariants (per locale, desktop)
const READ = () => {
  const f = document.querySelector(".aicc-fbt"), q = (x) => f.querySelector(x), qa = (x) => [...f.querySelectorAll(x)];
  const vis = (e) => !!e && !e.hidden && !e.closest("[hidden]") && getComputedStyle(e).display !== "none";
  const cards = qa("[data-cands] .aicc-fbt-card");
  const plain = qa("[data-plainlist] li");
  const store = q(".aicc-fbt-store"), page = q(".aicc-fbt-store__page"), chrome = q(".aicc-fbt-store__chrome");
  const r = (e) => e && e.getBoundingClientRect();
  return {
    surface: qa("[data-surface][aria-pressed=true]").map((b) => b.dataset.surface).join(),
    mode: f.dataset.mode, view: f.dataset.view,
    surfaceLabels: qa("[data-surface]").map((b) => b.textContent.trim()),
    modeLabels: qa("[data-mode]").map((b) => b.textContent.trim()),
    viewLabels: qa("[data-view]").map((b) => b.textContent.trim()),
    title: q("[data-title]")?.textContent.trim(), sub: q("[data-sub]")?.textContent.trim(), hint: q("[data-plainhint]")?.textContent.trim(), result: q("[data-result]")?.textContent.trim(),
    why: q("[data-why]")?.textContent.trim(),
    bundleVisible: vis(q("[data-bundle]")), plainVisible: vis(q("[data-plain]")),
    cardNames: cards.map((c) => c.querySelector(".aicc-fbt-card__name")?.textContent.trim()),
    anchor: cards.filter((c) => c.dataset.anchor).length, lockedBoxes: qa("[data-cands] input:disabled").length,
    tickedBoxes: cards.filter((c) => c.querySelector("input")?.checked).length,
    total: q("[data-total]")?.textContent.trim(), addText: q("[data-add-text]")?.textContent.trim(), brand: q(".aicc-fbt__brand")?.textContent.replace(/\s+/g, " ").trim(),
    plainNames: plain.map((li) => li.querySelector(".aicc-fbt-card__name")?.textContent.trim()),
    plainTags: qa("[data-plainlist] .aicc-fbt-plain__tag").map((x) => x.textContent.trim()),
    plainControls: qa("[data-plain] input, [data-plain] button, [data-plain] [data-total], [data-plain] [data-add]").length,
    storeProduct: !!q("[data-store] .aicc-fbt-store__product"), storeCart: !!q("[data-store] .aicc-fbt-cart"),
    cartLines: qa("[data-store] .aicc-fbt-cart__line .aicc-fbt-cart__name").map((x) => x.textContent.trim()), checkout: q("[data-store] .aicc-fbt-cart__checkout")?.textContent.trim(),
    merchantVisible: vis(q("[data-panel=merchant]")), merchantRows: qa("[data-rows] .aicc-fbt-row").length, ruleSelects: qa("[data-rows] select[data-rule]").length, tiles: qa("[data-tiles] li").length,
    geo: store && page && chrome ? { storeW: r(store).width, pageW: r(page).width, pageLeft: r(page).left - r(store).left, chromeW: r(chrome).width, chromeAbove: r(chrome).bottom <= r(page).top + 1, pageDisplay: getComputedStyle(page).display, chromeDisplay: getComputedStyle(chrome).display } : null,
    cardMinW: ((w) => (w.length ? Math.min(...w) : null))(cards.map((c) => r(c).width).filter((x) => x > 0)), plainMinW: ((w) => (w.length ? Math.min(...w) : null))(plain.map((c) => r(c).width).filter((x) => x > 0)),
    demoText: f.textContent.replace(/\s+/g, " "),
  };
};

for (const locale of LOCALES) {
  const { ctx, p, errors } = await openDemo(browser, locale, 1280);
  const L = `[${SURFACE}/${locale}]`;
  const sections = await p.evaluate(() => ({ surfacesSection: !!document.getElementById("surfaces") || !!document.querySelector(".aicc-surfaces, [id^='surf-p-'], [id^='surf-t-']"), demoCount: document.querySelectorAll(".aicc-fbt").length }));
  check(`${L} no standalone Product page / Cart proof ("Surfaces") section exists`, !sections.surfacesSection);
  check(`${L} exactly one interactive demo`, sections.demoCount === 1, sections.demoCount);
  const s = {};
  for (const [name, st] of STATES) { await setState(p, st); s[name] = await p.evaluate(READ); }
  const A = s["page-aicc"], B = s["page-woo"], C = s["cart-woo"], D = s["cart-aicc"], M = s["merchant"];
  check(`${L} Product page | Cart switch inside the demo (exactly two surfaces)`, A.surfaceLabels.length === 2 && (locale !== "en" || A.surfaceLabels.join("|") === "Product page|Cart"), A.surfaceLabels.join("|"));
  check(`${L} comparison switch (WooCommerce | With AICC) and view tabs (shoppers | merchant) exist`, A.modeLabels.length === 2 && A.viewLabels.length === 2, JSON.stringify([A.modeLabels, A.viewLabels]));
  check(`${L} state flags follow the controls`, A.surface === "page" && A.mode === "with" && B.mode === "without" && C.surface === "cart" && C.mode === "without" && D.surface === "cart" && D.mode === "with" && M.view === "merchant");
  // structural distinctness
  check(`${L} Product page and Cart are structurally distinct (product block vs cart lines + totals)`, A.storeProduct && !A.storeCart && D.storeCart && !D.storeProduct && C.storeCart && !C.storeProduct && B.storeProduct && !B.storeCart);
  check(`${L} cart context shows existing cart lines, totals and a neutral checkout control`, D.cartLines.length === 2 && !!D.checkout && C.cartLines.length === 2, JSON.stringify([D.cartLines, D.checkout]));
  // WooCommerce product page
  check(`${L} WooCommerce Product page: related products block, neutral, no AICC controls, no manual-link tags`, B.plainVisible && !B.bundleVisible && B.plainNames.length === 3 && B.plainControls === 0 && B.plainTags.length === 0, JSON.stringify([B.plainNames, B.plainControls, B.plainTags]));
  // WooCommerce cart
  check(`${L} WooCommerce Cart: manually linked cross-sells, each tagged, no AICC controls/total/CTA`, C.plainVisible && !C.bundleVisible && C.plainNames.length >= 2 && C.plainTags.length === C.plainNames.length && C.plainControls === 0, JSON.stringify([C.plainNames, C.plainTags, C.plainControls]));
  check(`${L} WooCommerce Cart cross-sells never repeat what is already in the cart`, !C.plainNames.some((n) => C.cartLines.includes(n)), JSON.stringify([C.plainNames, C.cartLines]));
  if (locale === "en") {
    check(`${L} WooCommerce Cart tag text is "Manually linked"`, C.plainTags.every((t) => t === "Manually linked"), C.plainTags.join("|"));
    check(`${L} WooCommerce Cart copy: merchant links cross-sells manually; WooCommerce does not learn them from what shoppers buy together`, /manually link/i.test(C.sub) && /does not learn/i.test(C.hint) && /by hand/i.test(C.result) && /does not learn/i.test(C.result) && /does not learn/i.test(C.why), JSON.stringify([C.sub, C.hint]));
    check(`${L} WooCommerce Cart does not claim WooCommerce lacks cart recommendations`, !/(no|without|lacks?|does not (have|support|offer)) (any )?cart (recommendation|cross)/i.test(C.demoText));
    check(`${L} WooCommerce Product page copy states the category/tag basis truthfully`, /same category or tags|same category/i.test(B.sub + " " + B.result), B.sub);
  }
  // AICC product page
  check(`${L} AICC Product page: viewed product first, ticked and locked; real-widget anatomy (title, total, CTA, signature)`, A.anchor === 1 && A.lockedBoxes === 1 && A.tickedBoxes === 1 && A.bundleVisible && !A.plainVisible && /\$38\.00$/.test(A.total) && /AI Commerce Copilot/.test(A.brand || "") && A.cardNames.length >= 4, JSON.stringify([A.anchor, A.lockedBoxes, A.total, A.brand]));
  if (locale === "en") check(`${L} AICC Product page widget text`, A.title === "Frequently Bought Together" && A.addText === "Add 1 product to cart" && /Powered by AI Commerce Copilot/.test(A.brand), JSON.stringify([A.title, A.addText, A.brand]));
  // AICC cart
  check(`${L} AICC Cart: no viewed-product card, nothing already in the cart is offered, recommendations start unticked, selectable, with total and CTA`, D.anchor === 0 && D.lockedBoxes === 0 && D.tickedBoxes === 0 && D.bundleVisible && !D.plainVisible && D.cardNames.length >= 3 && !D.cardNames.some((n) => D.cartLines.includes(n)) && /0\.00/.test(D.total || ""), JSON.stringify([D.anchor, D.cardNames, D.cartLines, D.total]));
  // merchant view
  check(`${L} merchant view (What you see and control) is intact: evidence rows, rule selects, tiles`, M.merchantVisible && M.merchantRows >= 3 && M.ruleSelects >= 3 && M.tiles >= 3, JSON.stringify([M.merchantRows, M.ruleSelects, M.tiles]));
  // ticking in the AICC cart updates the total (real interactivity, not a static mock)
  await setState(p, STATES[3][1]);
  const before = await p.evaluate(() => document.querySelector(".aicc-fbt [data-total]").textContent);
  await p.focus(".aicc-fbt [data-cands] input:not(:disabled)"); await p.keyboard.press("Space"); await p.waitForTimeout(500);
  const after = await p.evaluate(() => document.querySelector(".aicc-fbt [data-total]").textContent);
  check(`${L} AICC Cart is interactive: ticking a recommendation changes the bundle total`, before !== after, `${before} -> ${after}`);
  // thin-history / positioning truth on everything the demo prints, in every state
  const all = Object.values(s).map((x) => x.demoText).join(" ");
  if (locale === "en") {
    check(`${L} no AICC "same-category fallback" positioning and no AI / semantic claim in the demo`, !/same[- ]category fallback/i.test(all) && !/\b(semantic|embedding|machine[- ]learning|neural|AI[- ]powered cold)/i.test(all), "");
  }
  // layout sanity (the CP collision showed up as a collapsed store frame)
  for (const [name, x] of Object.entries(s)) {
    if (name === "merchant") continue;
    const g = x.geo;
    check(`${L} ${name}: the store frame lays out as a column (chrome above page, page spans the frame)`, !!g && g.chromeAbove && g.pageW >= 0.9 * g.storeW && Math.abs(g.pageLeft) <= 2 && g.chromeW >= 0.9 * g.storeW && g.pageDisplay === "grid", JSON.stringify(g));
    check(`${L} ${name}: cards and tiles are not squeezed`, (x.cardMinW === null || x.cardMinW >= 90) && (x.plainMinW === null || x.plainMinW >= 90), JSON.stringify([x.cardMinW, x.plainMinW]));
  }
  check(`${L} no page errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// ---------------------------------------------------------------- 3: approved visual snapshots (en)
for (const w of WIDTHS) {
  const { ctx, p } = await openDemo(browser, "en", w);
  for (const [name, st] of STATES) {
    await setState(p, st);
    const png = await shot(p);
    const file = path.join(BASE_DIR, `${name}-${w}.png`);
    if (UPDATE) { fs.mkdirSync(BASE_DIR, { recursive: true }); fs.writeFileSync(file, png); console.log(`baseline written: ${path.relative(ROOT, file)}`); passed++; continue; }
    if (!fs.existsSync(file)) { check(`[${SURFACE}] approved snapshot ${name}@${w}`, false, `missing baseline ${path.relative(ROOT, file)} (create it ONLY by the owner-review command in the file header)`); continue; }
    const r = await comparePng(browser, fs.readFileSync(file), png);
    const ok = !r.size && r.n / r.total <= TOLERANCE;
    if (!ok && DUMP) { fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(path.join(DUMP, `${SURFACE}-${name}-${w}.actual.png`), png); }
    check(`[${SURFACE}] approved snapshot ${name}@${w} matches the owner-approved baseline`, ok, r.size ? `size ${r.size.join("x")} vs baseline` : `${r.n} of ${r.total} pixels differ (${((100 * r.n) / r.total).toFixed(3)}%, limit ${(TOLERANCE * 100).toFixed(2)}%)`);
  }
  await ctx.close();
}
await browser.close();
console.log(`shopper-demo-guard [${SURFACE}] ${URL0}${PATH0}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
