// npm run test:interaction: keyboard-only walks through the language switcher, accessibility control, mobile menu,
// FAQ accordion and the demo, plus reduced-motion behaviour and the language-persistence rules. Needs the export served.
import fs from "node:fs";
import { launch, urlFor, BASE, ROUTES as ROUTES_ALL } from "./lib/browser.mjs";
import { loadFallbacks, loadDictionaries } from "./lib/load.mjs";

const DICTS = await loadDictionaries(); // the strings each locale renders (translated, or English where a unit still falls back)
const FALLBACK_UNITS = await loadFallbacks(); // which kit sets of each locale are still English (a translated set carries the page language instead)

const PACK = JSON.parse(fs.readFileSync(new URL("../brand/content/faq.en.json", import.meta.url), "utf8"));
const ACTIVE = Object.keys(PACK.items);
const MOST = PACK.mostAskedBeforeBuying;
const PUBLIC_LD = ACTIVE.filter((id) => !PACK.items[id].legalReview); // legal-flagged answers stay out of FAQPage JSON-LD until approved
const TR = Object.fromEntries(["he", "es", "ru"].map((l) => [l, JSON.parse(fs.readFileSync(new URL(`../brand/content/faq.${l}.json`, import.meta.url), "utf8"))]));

const PREFIX = new URL(BASE).pathname.replace(/\/$/, "");

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); };
const browser = await launch();
const fresh = async (opts = {}) => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts }); return [ctx, await ctx.newPage()]; };
const active = (p) => p.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}|${a.className}|${a.getAttribute("aria-label") || ""}|${(a.textContent || "").trim().slice(0, 30)}` : ""; });
async function tabTo(p, test, max = 40) { for (let i = 0; i < max; i++) { await p.keyboard.press("Tab"); if (await p.evaluate(test)) return true; } return false; }

// 1. Language switcher + persistence (desktop)
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", "pricing"));
  await p.waitForSelector("[data-aicc-lang][data-aicc-ready]"); // the kit has wired the menu (keys pressed before hydration would be lost)
  const found = await tabTo(p, () => document.activeElement?.closest(".aicc-lang") && document.activeElement.tagName === "BUTTON");
  check("language: ONE compact control (globe + code + chevron) and the old inline links are gone", await p.evaluate(() => [...document.querySelectorAll(".aicc-site-header .aicc-lang")].filter((e) => e.getBoundingClientRect().width > 0).length === 1 && !!document.querySelector(".aicc-lang__btn svg") && !document.querySelector(".aicc-lang__chip")));
  check("language: reachable with Tab", found);
  await p.keyboard.press("Enter");
  check("language: Enter opens menu", await p.evaluate(() => !document.querySelector(".aicc-lang__menu").hidden && document.querySelector(".aicc-lang button").getAttribute("aria-expanded") === "true"));
  await p.keyboard.press("Escape");
  check("language: Esc closes and returns focus to the button", await p.evaluate(() => document.querySelector(".aicc-lang__menu").hidden && document.activeElement === document.querySelector(".aicc-lang button")));
  await p.keyboard.press("Enter");
  const links = await p.$$eval(".aicc-site-header__actions .aicc-lang__menu a", (as) => as.map((a) => [a.lang, a.getAttribute("hreflang"), a.getAttribute("href")]));
  check("language: 4 links with lang/hreflang, same page in each language", links.length === 4 && links.every((l) => l[0] && l[1]) && links.some((l) => l[2].endsWith("/he/pricing/")), JSON.stringify(links));
  check("language: Enter opened the menu with focus on the current language", (await active(p)).includes("English"), await active(p));
  await p.keyboard.press("ArrowDown"); // en -> he (arrow keys move through the items, no wrap)
  check("language: ArrowDown moves to the next language", (await active(p)).includes("עברית"), await active(p));
  await p.keyboard.press("Enter");
  await p.waitForURL("**/he/pricing/");
  const st = await p.evaluate(() => ({ ls: localStorage.getItem("aicc_lang"), cookie: document.cookie, dir: document.documentElement.dir, lang: document.documentElement.lang }));
  check("language: choice stored in cookie AND localStorage; html lang/dir correct", st.ls === "he" && /aicc_lang=he/.test(st.cookie) && st.dir === "rtl" && st.lang === "he", JSON.stringify(st));
  await p.goto(urlFor("en", "product"));
  await p.waitForTimeout(400);
  check("language: no auto-redirect (stays on /product/ with Hebrew saved)", p.url().endsWith("/product/"), p.url());
  const sug = await p.$(".aicc-suggest");
  check("language: suggestion banner offers the saved language (in that language)", sug && (await sug.getAttribute("lang")) === "he" && (await sug.textContent()).includes("עברית"));
  await p.click(".aicc-suggest .aicc-btn--ghost");
  check("language: banner can be dismissed", !(await p.$(".aicc-suggest")));
  await ctx.close();
}
// 1b. first visit uses the URL; browser-language suggestion only when nothing is saved
{
  const [ctx, p] = await fresh({ locale: "ru-RU" });
  await p.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["ru-RU", "ru"] }));
  await p.goto(urlFor("en", ""));
  await p.waitForTimeout(500);
  check("language: first visit stays on the URL's language (no redirect)", new URL(p.url()).pathname === `${PREFIX}/`);
  check("language: browser-language suggestion appears (Russian)", await p.evaluate(() => document.querySelector(".aicc-suggest")?.lang === "ru"));
  await ctx.close();
}

// 2. Accessibility control
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", ""));
  const found = await tabTo(p, () => document.activeElement?.classList.contains("aicc-a11y-trigger"));
  check("a11y control: reachable with Tab in the header", found);
  await p.keyboard.press("Enter");
  check("a11y control: Enter opens a modal dialog and focus moves inside", await p.evaluate(() => document.querySelector("dialog[open]") && document.querySelector("dialog[open]").contains(document.activeElement)));
  let stayed = true;
  for (let i = 0; i < 9; i++) { await p.keyboard.press("Tab"); if (!(await p.evaluate(() => { const d = document.querySelector("dialog[open]"); const a = document.activeElement; return d?.contains(a) || a === document.body; }))) stayed = false; }
  check("a11y control: focus never reaches the page behind the modal (9 Tabs; it may leave to browser UI, never to the page)", stayed);
  const sw = await p.$$('dialog[open] [role="switch"]');
  for (const s of sw) { await s.focus(); await p.keyboard.press("Space"); }
  const attrs = await p.evaluate(() => [...["motion", "contrast", "text"]].map((k) => document.documentElement.getAttribute("data-aicc-" + k)));
  check("a11y control: Space toggles reduce motion / higher contrast / larger text on <html>", attrs.join() === "reduce,high,large", attrs.join());
  check("a11y control: switches expose aria-checked=true", (await p.$$eval('dialog[open] [role="switch"]', (e) => e.map((x) => x.getAttribute("aria-checked")))).every((v) => v === "true"));
  const rootFont = await p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  check("a11y control: larger text really scales the root font (19px)", Math.abs(rootFont - 19) < 0.6, String(rootFont));
  await p.keyboard.press("Escape");
  check("a11y control: Esc closes and focus returns to the trigger", await p.evaluate(() => !document.querySelector("dialog[open]") && document.activeElement?.classList.contains("aicc-a11y-trigger")));
  await p.reload();
  const persisted = await p.evaluate(() => document.documentElement.getAttribute("data-aicc-motion") + "," + document.documentElement.getAttribute("data-aicc-contrast") + "," + document.documentElement.getAttribute("data-aicc-text"));
  check("a11y control: settings persist across reload", persisted === "reduce,high,large", persisted);
  const html = await (await fetch(urlFor("en", ""))).text();
  const headEnd = html.indexOf("</head>");
  check("a11y control: preference script runs in <head> (applied before first paint)", html.indexOf("aicc_a11y") > 0 && html.indexOf("aicc_a11y") < headEnd);
  await p.click(".aicc-a11y-trigger"); await p.click("dialog[open] .aicc-btn--quiet");
  const cleared = await p.evaluate(() => ["motion", "contrast", "text"].every((k) => !document.documentElement.hasAttribute("data-aicc-" + k)) && !localStorage.getItem("aicc_a11y"));
  check("a11y control: Reset clears attributes and storage", cleared);
  check("a11y control: links to the accessibility statement", await p.$eval("dialog[open] a", (a) => a.getAttribute("href").includes("/accessibility/")));
  await ctx.close();
}

// 3. Mobile menu (390 wide)
{
  const [ctx, p] = await fresh({ viewport: { width: 390, height: 844 } });
  await p.goto(urlFor("en", ""));
  const btn = ".aicc-site-header__menu-btn";
  check("mobile menu: button visible at 390px, desktop nav hidden", (await p.isVisible(btn)) && !(await p.isVisible(".aicc-site-header__nav")));
  await p.focus(btn); await p.keyboard.press("Enter");
  check("mobile menu: Enter opens (aria-expanded=true, panel visible)", (await p.getAttribute(btn, "aria-expanded")) === "true" && (await p.isVisible(".aicc-site-header__panel")));
  await p.keyboard.press("Tab");
  check("mobile menu: Tab goes into the panel (first link)", (await active(p)).startsWith("a|aicc-navlink"), await active(p));
  await p.keyboard.press("Escape");
  check("mobile menu: Esc closes and focus returns to the menu button", (await p.getAttribute(btn, "aria-expanded")) === "false" && (await p.evaluate((b) => document.activeElement === document.querySelector(b), btn)));
  await p.click(btn); await p.click(`.aicc-site-header__panel a[href='${PREFIX}/pricing/']`); await p.waitForURL("**/pricing/");
  await p.waitForTimeout(300);
  check("mobile menu: choosing a link navigates and closes the menu", (await p.getAttribute(btn, "aria-expanded")) === "false" && !(await p.isVisible(".aicc-site-header__panel")));
  check("mobile menu: aria-current marks the current page", await p.evaluate(() => !!document.querySelector('.aicc-site-header a[aria-current="page"]')));
  await ctx.close();
}

// 4. FAQ accordion + the Questions page structure (content pack: brand/content)
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", "questions"));
  await p.focus("summary");
  await p.keyboard.press("Enter");
  check("faq: Enter on a question opens it", await p.evaluate(() => document.querySelector("details").open));
  await p.keyboard.press("Space");
  check("faq: Space closes it again", await p.evaluate(() => !document.querySelector("details").open));
  check(`faq: every active question is present once with a stable #qNN anchor (${ACTIVE.length}), and "Most asked before buying" repeats ${MOST.length} of them under unique ids`, (await p.$$("details[id^='q']")).length === ACTIVE.length && (await p.$$eval("details[id^='q']", (d) => d.every((x) => /^q\d{2}$/.test(x.id)))) && (await p.$$("details[id^='top-q']")).length === MOST.length && (await p.evaluate(() => { const ids = [...document.querySelectorAll("[id]")].map((e) => e.id); return ids.length === new Set(ids).size; })));
  check("questions: no count language anywhere on the page", await p.evaluate(() => !/\ball \d+\b|\b\d+ (questions|answers)\b/i.test(document.body.innerText)));
  const jump = await p.$$eval(".aicc-qnav a[href^='#topic-']", (a) => a.map((x) => x.getAttribute("href")));
  check(`questions: in-page topic jump links resolve to a heading (${jump.length} topics)`, jump.length === PACK.topics.length && (await p.evaluate((h) => h.every((x) => !!document.getElementById(x.slice(1))), jump)));
  const ld = await p.$$eval('script[type="application/ld+json"]', (s) => s.map((x) => JSON.parse(x.textContent)));
  const faq = ld.find((x) => x["@type"] === "FAQPage");
  const visibleQs = await p.$$eval("details[id^='q'] summary span", (e) => e.map((x) => x.textContent.trim()));
  check(`faq: FAQPage JSON-LD lists only visible Q&As and omits the legal-flagged ones until approved (${PUBLIC_LD.length} of ${ACTIVE.length})`, faq && faq.mainEntity.length === PUBLIC_LD.length && faq.mainEntity.every((q) => visibleQs.some((v) => v.startsWith(q.name))), String(faq?.mainEntity?.length));
  const order = await p.$$eval("main h2", (h) => h.map((x) => x.textContent.trim()));
  check("questions: order is search first, then Most asked before buying, then Browse questions by topic", order.indexOf("Find an answer") === 0 && order.indexOf("Most asked before buying") === 1 && order.indexOf("Browse questions by topic") === 2, order.join(" | "));
  await p.goto(urlFor("en", "questions") + "#q07");
  await p.waitForTimeout(200);
  check("faq: the retired id #q07 resolves to q51 and opens it", await p.evaluate(() => document.getElementById("q51").open === true));
  await p.goto(urlFor("en", "questions") + "#q41");
  await p.waitForTimeout(200);
  check("faq: a #qNN deep link opens that answer", await p.evaluate(() => document.getElementById("q41").open === true));
  // Pages show their own selection only.
  for (const [route, key] of [["", "home"], ["product", "product"], ["pricing", "pricing"]]) {
    await p.goto(urlFor("en", route));
    const ids = await p.$$eval("details[id^='q']", (d) => d.map((x) => x.id));
    check(`faq: ${route || "home"} shows exactly its selection (${PACK.selection[key].length})`, JSON.stringify(ids) === JSON.stringify(PACK.selection[key]), ids.join());
  }
  await ctx.close();
}
// 4b. Explicit translation fallback: English text on a he/es/ru page is marked lang=en dir=ltr, translated text is not; the page lang stays correct.
for (const loc of ["he", "es", "ru"]) {
  const [ctx, p] = await fresh();
  await p.goto(urlFor(loc, "questions"));
  const r = await p.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, fb: [...document.querySelectorAll("details[id^='q']")].filter((d) => d.querySelector("summary > span[lang=en]")).map((d) => d.id) }));
  const missing = ACTIVE.filter((id) => !TR[loc].items[id]);
  check(`fallback[${loc}]: page lang/dir are the page language (${r.lang}/${r.dir}); ${r.fb.length} English questions carry lang=en dir=ltr`, r.lang === loc && (loc !== "he" || r.dir === "rtl") && JSON.stringify([...r.fb].sort()) === JSON.stringify([...missing].sort()), `${r.fb.length} vs ${missing.length}`);
  const own = await p.evaluate(() => [...document.querySelectorAll("details[id^='q']")].filter((d) => !d.querySelector("summary > span[lang=en]")).every((d) => !d.querySelector(".aicc-accordion__body[lang=en]")));
  check(`fallback[${loc}]: translated questions are NOT marked as English`, own);
  await p.goto(urlFor(loc, ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView()); await p.waitForTimeout(700);
  await p.click("#ws-t-control"); await p.waitForTimeout(700); await p.click("#ws-t-ask"); await p.waitForTimeout(300);
  const kit = await p.evaluate(async () => { for (const sel of ["#demo", "[data-aicc-rules]", "[data-aicc-dash], .aicc-dash", ".aicc-ask"]) { document.querySelector(sel)?.scrollIntoView(); await new Promise((r) => setTimeout(r, 300)); } return { demo: document.querySelector(".aicc-fbt")?.getAttribute("lang") + "/" + document.querySelector(".aicc-fbt")?.getAttribute("dir"), rules: document.querySelector("[data-aicc-rules]")?.getAttribute("lang") + "/" + document.querySelector("[data-aicc-rules]")?.getAttribute("dir"), dash: document.querySelector(".aicc-dash")?.getAttribute("lang"), ask: document.querySelector(".aicc-ask")?.getAttribute("lang"), flow: document.querySelector(".aicc-flow")?.getAttribute("lang") }; });
  const dirOf = loc === "he" ? "rtl" : "ltr";
  const want = (unit, withDir) => (FALLBACK_UNITS[loc].includes(unit) ? (withDir ? "en/ltr" : "en") : (withDir ? `${loc}/${dirOf}` : loc)); // English fallback -> lang=en dir=ltr; translated -> the page language
  check(`fallback[${loc}]: kit demo, rules, dashboard preview, Ask Reco and flow diagrams carry the right language (${JSON.stringify(kit)})`, kit.demo === want("demo", true) && kit.rules === want("rules", true) && kit.dash === want("dash", false) && kit.ask === want("ask", false) && kit.flow === want("flows", false), JSON.stringify(kit));
  await ctx.close();
}

// 4c. The fallback mechanism itself, with a SYNTHETIC English fallback (every locale is fully translated now, so nothing falls back for real).
// The served he/es home pages get English kit strings flagged _fallback:true (exactly what kitStrings() emits for an untranslated unit): every kit module must mark itself lang=en dir=ltr,
// must not wrap admin labels (it is all English already), and the page itself must stay in its own language.
for (const loc of ["he", "es"]) {
  const [ctx, p] = await fresh();
  const enHtml = await (await ctx.request.get(urlFor("en", ""))).text();
  const attr = (h) => [...h.matchAll(/data-strings="([^"]*)"/g)].map((m) => m[1]);
  const enAttrs = attr(enHtml);
  let swapped = 0;
  await p.route(new RegExp(`/${loc}/$`), async (r) => {
    const res = await r.fetch();
    const html = await res.text();
    let i = 0;
    const body = html.replace(/data-strings="([^"]*)"/g, () => { const en = enAttrs[i++]; swapped++; return `data-strings="${en.replace(/^\{/, "{&quot;_fallback&quot;:true,")}"`; });
    const headers = { ...res.headers() }; delete headers["content-length"];
    await r.fulfill({ status: res.status(), headers, body });
  });
  await p.goto(urlFor(loc, ""));
  await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView()); await p.waitForTimeout(700);
  await p.click("#ws-t-control"); await p.waitForTimeout(700); await p.click("#ws-t-insights"); await p.waitForTimeout(500); await p.click("#ws-t-ask"); await p.waitForTimeout(300);
  const probe = await p.evaluate(async () => { for (const sel of ["#demo", "[data-aicc-rules]", ".aicc-dash", ".aicc-ask"]) { document.querySelector(sel)?.scrollIntoView(); await new Promise((r) => setTimeout(r, 400)); } const at = (sel) => { const e = document.querySelector(sel); return e ? `${e.getAttribute("lang")}/${e.getAttribute("dir")}` : "missing"; }; return { doc: document.documentElement.lang, demo: at(".aicc-fbt"), rules: at("[data-aicc-rules]"), dash: at(".aicc-dash"), ask: at(".aicc-ask"), labels: document.querySelectorAll(".aicc-fbt .aicc-admin-label, [data-aicc-rules] .aicc-admin-label").length }; });
  check(`synthetic fallback[${loc}]: ${swapped} client-mounted kit string sets swapped for English + _fallback; the demo and the rules demo become lang=en dir=ltr, the page stays ${loc} (${JSON.stringify(probe)})`, swapped >= 2 && probe.doc === loc && probe.demo === "en/ltr" && probe.rules === "en/ltr", JSON.stringify(probe));
  check(`synthetic fallback[${loc}]: an English fallback does not wrap admin labels again (everything is already lang=en)`, probe.labels === 0, String(probe.labels));
  await ctx.close();
}
// The server-rendered kit renderers (dashboard preview, Ask Reco, flows, loop) take the same flag: English + _fallback -> lang=en dir=ltr and no label re-wrapping; translated -> the page language,
// with each real English admin label (es, ru) a lang=en dir=ltr leaf and Hebrew labels left as Hebrew.
{
  const dashMod = await import(new URL("../brand/js/dash-preview.js", import.meta.url));
  const askMod = await import(new URL("../brand/js/reco-ask.js", import.meta.url));
  for (const loc of ["he", "es", "ru"]) {
    const dir = loc === "he" ? "rtl" : "ltr";
    const synth = dashMod.renderDashPreviewHTML({ ...DICTS.en.dash, _fallback: true }, { locale: loc, dir, variant: "full" });
    check(`synthetic fallback[${loc}]: the dashboard preview renderer marks an English fallback lang=en dir=ltr and adds no label wrappers`, /lang="en" dir="ltr"/.test(synth) && !/aicc-admin-label/.test(synth));
    const real = dashMod.renderDashPreviewHTML(DICTS[loc].dash, { locale: loc, dir, variant: "full" });
    const leaf = [...real.matchAll(/<span lang="en" dir="ltr" class="aicc-admin-label">([^<]*)<\/span>/g)].map((m) => m[1]);
    check(`replica labels[${loc}]: ${loc === "he" ? "the Hebrew admin labels are not wrapped as English" : `English admin labels are lang=en dir=ltr leaves (${leaf.length}: ${leaf.slice(0, 3).join(", ")} ...)`}`, loc === "he" ? leaf.length === 0 && /צפיות בהמלצות/.test(real) : leaf.length >= 8 && leaf.includes("Recommendation Views") && leaf.includes("Merchant Insights") && !leaf.some((x) => /\p{L}/u.test(x.replace(/[A-Za-z0-9\s,.\-+{}%/]/g, ""))));
    const askSynth = askMod.renderRecoAskHTML({ ...DICTS.en.ask, _fallback: true }, { locale: loc, dir, assetsBase: "" });
    check(`synthetic fallback[${loc}]: the Ask Reco renderer marks an English fallback lang=en dir=ltr`, /lang="en" dir="ltr"/.test(askSynth) && !/aicc-admin-label/.test(askSynth));
  }
}
// Node-level proof of the merge itself: an untranslated unit comes back as English and is reported, a translated one is kept.
{
  const { loadTs } = await import("./lib/load.mjs");
  const { mergeOverEnglish, unitOf } = await loadTs("src/i18n/merge.ts");
  const en = { home: { hero: { title: "Hello", lead: "World" }, why: { title: "Why" } }, demo: { a: "A", b: "B" } };
  const { dict, fallback } = mergeOverEnglish(en, { home: { hero: { title: "Shalom" }, why: { title: "Lama" } }, demo: { a: "Alef", b: "Bet" } });
  check("merge: a unit with a missing string falls back WHOLE to English and is reported (home.hero), a complete unit is kept (home.why, demo)", fallback.has("home.hero") && dict.home.hero.title === "Hello" && dict.home.hero.lead === "World" && !fallback.has("home.why") && dict.home.why.title === "Lama" && !fallback.has("demo") && dict.demo.a === "Alef" && unitOf("demo.b") === "demo");
  const none = mergeOverEnglish(en, undefined);
  check("merge: with no translation at all, every unit is English and reported", ["home.hero", "home.why", "demo"].every((u) => none.fallback.has(u)) && none.dict.demo.a === "A");
}

// 5. Demo
for (const loc of ["en", "he", "es", "ru"]) {
  const [ctx, p] = await fresh();
  await p.goto(urlFor(loc, ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-fbt input[type=checkbox]", { timeout: 5000 });
  const boxes = await p.$$(".aicc-fbt input[type=checkbox]");
  check(`demo[${loc}]: at least 3 product cards with real checkboxes`, boxes.length >= 4);
  check(`demo[${loc}]: opens on "With AICC" (the result first) with a one-sentence result line and the short nudge`, (await p.$eval(".aicc-fbt", (e) => e.dataset.mode)) === "with" && !!(await p.$(".aicc-fbt__nudge")) && (await p.$eval("[data-result]", (e) => e.textContent.length > 20)));
  check(`demo[${loc}]: exactly one status region inside the demo (summary), no aria-live on the rationale`, (await p.$$eval(".aicc-fbt [role=status]", (e) => e.length)) === 1 && !(await p.$(".aicc-fbt__why p:not(.aicc-fbt__bubble)[aria-live]")));
  check(`demo[${loc}]: labelled "Illustrative demo" and no store data`, await p.evaluate(() => !!document.querySelector(".aicc-fbt__label") && !/%|revenue|conversion/i.test(document.querySelector(".aicc-fbt").textContent)));
  const total = () => p.$eval(".aicc-fbt__total strong", (e) => e.textContent.trim());
  const t0 = await total();
  await boxes[2].focus(); await p.keyboard.press("Space");
  await p.waitForTimeout(500);
  const t1 = await total();
  check(`demo[${loc}]: Space ticks a product and the bundle total updates (${t0} -> ${t1})`, t0 !== t1 && (await boxes[2].isChecked()));
  const live = await p.$$(".aicc-fbt input[type=checkbox]:not(:disabled)"); // the viewed product's tick is locked (disabled) on the Product page, like the real widget
  await live[0].focus();
  // The Hebrew demo is an English fallback (lang=en dir=ltr), so arrows follow ITS direction, not the page's.
  const dirNow = await p.$eval(".aicc-fbt", (e) => getComputedStyle(e).direction);
  const nextKey = dirNow === "rtl" ? "ArrowLeft" : "ArrowRight";
  await p.keyboard.press(nextKey);
  check(`demo[${loc}]: ${nextKey} moves to the next product (follows the demo's own reading direction: ${dirNow})`, await p.evaluate(() => document.activeElement === document.querySelectorAll(".aicc-fbt input[type=checkbox]:not(:disabled)")[1]));
  await p.keyboard.press("ArrowDown");
  check(`demo[${loc}]: ArrowDown moves on`, await p.evaluate(() => document.activeElement === document.querySelectorAll(".aicc-fbt input[type=checkbox]:not(:disabled)")[2]));
  const why1 = await p.$eval(".aicc-fbt__why p[data-why]", (e) => e.textContent);
  await p.click(".aicc-fbt__mode[aria-pressed=false]");
  const mode = await p.$eval(".aicc-fbt", (e) => e.dataset.mode);
  const why2 = await p.$eval(".aicc-fbt__why p[data-why]", (e) => e.textContent);
  const plain = await p.evaluate(() => ({ list: [...document.querySelectorAll("[data-plainlist] li")].length, ticks: document.querySelectorAll("[data-plain] input").length, total: !!document.querySelector("[data-plain] [data-total], [data-plain] [data-add]"), heading: document.querySelector("[data-title]").textContent, result: document.querySelector("[data-result]").textContent }));
  check(`demo[${loc}]: "Plain related products" draws WooCommerce's own block (a heading and ${plain.list} product tiles; no ticks, total or button) and the result line says so`, mode === "without" && plain.list === 3 && plain.ticks === 0 && !plain.total && plain.heading === DICTS[loc].demo.plain.title && plain.result.startsWith(DICTS[loc].demo.result.without.split("{names}")[0]), JSON.stringify(plain));
  check(`demo[${loc}]: the rationale changes between the two states`, why1 !== why2);
  const ow = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check(`demo[${loc}]: no horizontal scroll at 1280`, ow);
  await ctx.close();
}
// 5b. demo at 360, reduced motion
for (const loc of ["en", "he", "es", "ru"]) {
  const [ctx, p] = await fresh({ viewport: { width: 360, height: 740 }, reducedMotion: "reduce" });
  await p.goto(urlFor(loc, ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-fbt input[type=checkbox]");
  const fits = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll(".aicc-fbt *")].filter((e) => !e.closest(".aicc-fbt__cands") || e.matches(".aicc-fbt__cands")).every((e) => e.getBoundingClientRect().right <= innerWidth + 1)); // the card rail scrolls inside itself (like the real widget); the rail box must fit
  check(`demo[${loc}] @360: fits without horizontal scroll`, fits);
  const boxes = await p.$$(".aicc-fbt input[type=checkbox]");
  await boxes[3].focus(); await p.keyboard.press("Space");
  await p.waitForTimeout(40);
  const t = await p.$eval(".aicc-fbt__total strong", (e) => e.textContent.trim());
  check(`demo[${loc}] @360 reduced motion: total updates immediately without counting animation (${t})`, t === "$54.00", t);
  await p.click(".aicc-fbt__mode[aria-pressed=false]");
  check(`demo[${loc}] @360: no Strong/Medium/Light strength bars exist (tiers are not in the product)`, await p.evaluate(() => !document.querySelector(".aicc-fbt__bar") && !/\b(strong|medium|light) link/i.test(document.querySelector(".aicc-fbt").textContent)));
  check(`demo[${loc}] @360: still fits after switching to With AICC`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await ctx.close();
}
{ // site's own motion attribute
  const [ctx, p] = await fresh();
  await p.addInitScript(() => localStorage.setItem("aicc_a11y", JSON.stringify({ motion: "reduce" })));
  await p.goto(urlFor("en", ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-fbt input[type=checkbox]");
  const boxes = await p.$$(".aicc-fbt input[type=checkbox]");
  await boxes[3].focus(); await p.keyboard.press("Space"); await p.waitForTimeout(40);
  const t = await p.$eval(".aicc-fbt__total strong", (e) => e.textContent.trim());
  await p.click(".aicc-fbt__mode[aria-pressed=false]");
  check(`demo: data-aicc-motion="reduce" disables counters (${t})`, t === "$54.00", t);
  const heroAnim = await p.evaluate(() => getComputedStyle(document.querySelector(".aicc-hero__copy .aicc-fade-up")).animationName);
  check(`site: data-aicc-motion="reduce" removes the hero entrance animation (${heroAnim})`, heroAnim === "none", heroAnim);
  await ctx.close();
}
// 5c. Review-round regressions
{
  // S2: one dialog; Esc inside it does not close the mobile menu behind it; focus returns to a visible trigger
  const [ctx, p] = await fresh({ viewport: { width: 390, height: 844 } });
  await p.goto(urlFor("en", ""));
  check("a11y: exactly one dialog element on the page", (await p.$$("dialog")).length === 1);
  await p.click(".aicc-site-header__menu-btn");
  await p.click(".aicc-site-header__panel button.aicc-btn");
  check("a11y: dialog opens from the mobile menu", await p.evaluate(() => !!document.querySelector("dialog[open]")));
  await p.keyboard.press("Escape");
  const st = await p.evaluate(() => ({ dlg: !!document.querySelector("dialog[open]"), menu: document.querySelector(".aicc-site-header__menu-btn").getAttribute("aria-expanded"), vis: (() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(a).visibility !== "hidden"; })() }));
  check("a11y: Esc closes only the dialog; the menu stays open and focus lands on a visible control", !st.dlg && st.menu === "true" && st.vis, JSON.stringify(st));
  await ctx.close();
}
for (const [w, h] of [[390, 844], [320, 256]]) {
  // S1: the language suggestion never hides the focused control
  const [ctx, p] = await fresh({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
  await p.addInitScript(() => localStorage.setItem("aicc_lang", "he"));
  await p.goto(urlFor("en", ""));
  await p.waitForSelector(".aicc-suggest");
  const first = await p.evaluate(() => { document.activeElement?.blur(); return null; });
  void first;
  let hidden = 0, steps = 0;
  const firstTabbed = [];
  for (let i = 0; i < 90; i++) {
    await p.keyboard.press("Tab"); steps++;
    await p.waitForTimeout(15);
    const r = await p.evaluate(() => {
      const a = document.activeElement; if (!a || a === document.body) return null;
      const ar = a.getBoundingClientRect(); const b = document.querySelector(".aicc-suggest");
      if (!b) return { ok: true, id: a.className };
      const br = b.getBoundingClientRect(); if (getComputedStyle(b).position !== "fixed") return { ok: true, id: a.className };
      const fully = ar.top >= br.top - 0.5 && ar.bottom <= br.bottom + 0.5 && ar.left >= br.left - 0.5 && ar.right <= br.right + 0.5 && !b.contains(a);
      const inView = ar.bottom > 0 && ar.top < innerHeight;
      return { ok: !fully && inView, id: a.className || a.tagName };
    });
    if (r && !r.ok) hidden++;
    if (i < 2) firstTabbed.push(await p.evaluate(() => document.activeElement?.closest(".aicc-suggest") ? "suggest" : "other"));
  }
  check(`suggestion @${w}x${h}: no focused control is hidden behind it (${steps} Tab stops)`, hidden === 0, `${hidden} hidden`);
  check(`suggestion @${w}x${h}: it is right after the skip link in the tab order and labelled "Language suggestion" in the suggested language`, firstTabbed[1] === "suggest" && (await p.$eval(".aicc-suggest", (e) => e.getAttribute("aria-label"))).length > 3);
  await ctx.close();
}
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", ""));
  check("language button name is 'Language: English, EN' (contains its visible code as a word: WCAG 2.5.3)", (await p.getAttribute(".aicc-lang button", "aria-label")) === "Language: English, EN");
  await p.click(".aicc-lang button"); await p.focus(".aicc-lang__menu a"); await p.keyboard.press("Shift+Tab"); await p.keyboard.press("Shift+Tab"); await p.keyboard.press("Shift+Tab");
  check("language menu closes when focus leaves it", await p.evaluate(() => document.querySelector(".aicc-lang__menu").hidden));
  check("home has no draft pills and no pending lines; hero says the new headline", await p.evaluate(() => !document.querySelector("[data-legal-draft]") && !document.querySelector("[data-pending]") && /smarter selling opportunity\./.test(document.querySelector("h1").textContent)));
  await p.goto(urlFor("en", "pricing"));
  check("pricing: no draft pill on marketing content; one muted pending line pattern absent here", await p.evaluate(() => !document.querySelector("[data-legal-draft]")));
  const tops = await p.$$eval(".aicc-plan__amount", (e) => e.map((x) => Math.round(x.getBoundingClientRect().top)));
  check(`pricing: the three prices align (badge row reserved): ${tops.join(",")}`, tops.length === 3 && Math.max(...tops) - Math.min(...tops) <= 1);
  const btn = await p.$$eval(".aicc-plan .aicc-btn", (e) => e.map((x) => x.classList.contains("aicc-btn--primary")));
  check("pricing: only Studio's button uses the action gradient", btn.join() === "false,true,false");
  await p.goto(urlFor("en", "privacy"));
  check("privacy: ONE draft notice per page (not one per section) and the muted pending lines are visible on the legal page", await p.evaluate(() => document.querySelectorAll("[data-legal-draft]").length === 1 && document.querySelectorAll("[data-pending]").length > 0 && !/\[.*pending.*\]/.test(document.querySelector("main").textContent)));
  await ctx.close();
}
{
  // M6: smooth scrolling respects the OS setting; Heebo only on Hebrew pages
  for (const [pref, want] of [["reduce", "auto"], ["no-preference", "smooth"]]) {
    const [ctx, p] = await fresh({ reducedMotion: pref });
    await p.goto(urlFor("en", ""));
    const sb = await p.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
    check(`smooth scroll with prefers-reduced-motion:${pref} is ${want}`, sb === want, sb);
    await ctx.close();
  }
  for (const [loc, expect] of [["en", false], ["he", true]]) {
    const [ctx, p] = await fresh();
    const fonts = [];
    p.on("request", (r) => /heebo/i.test(r.url()) && fonts.push(r.url()));
    await p.goto(urlFor(loc, ""));
    await p.waitForTimeout(800);
    check(`Heebo is ${expect ? "" : "not "}loaded on the ${loc} page`, (fonts.length > 0) === expect, fonts.join());
    await ctx.close();
  }
}
// M1: demo reflow at 320 wide with Larger text, in en/es/ru (and he)
for (const loc of ["en", "es", "ru", "he"]) {
  const [ctx, p] = await fresh({ viewport: { width: 320, height: 640 } });
  await p.addInitScript(() => localStorage.setItem("aicc_a11y", JSON.stringify({ text: "large" })));
  await p.goto(urlFor(loc, ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-fbt input[type=checkbox]");
  await p.click(".aicc-fbt__mode[aria-pressed=false]");
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, out: [...document.querySelectorAll(".aicc-fbt *")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1); }).length }));
  check(`demo[${loc}] @320 + Larger text: no horizontal overflow (scrollWidth ${r.sw}/${r.iw}, ${r.out} elements outside)`, r.sw <= r.iw && r.out === 0);
  await ctx.close();
}
// 6. 404
{
  const [ctx, p] = await fresh();
  const r = await p.goto(`${BASE}/he/nope/`);
  await p.waitForTimeout(400);
  check("404: unknown URL returns 404 with the branded page, in Hebrew under /he/, with a translated title", r.status() === 404 && (await p.evaluate(() => document.documentElement.lang === "he" && document.documentElement.dir === "rtl" && !!document.querySelector("h1") && !/not found/i.test(document.title) && document.title.length > 2)), await p.title());
  await ctx.close();
}
// 7. Default look meets AA on its own; Enhanced contrast is a stronger optional mode
{
  const wcag = `(() => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const L = (c) => 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); return (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }; })()`;
  // 7a. `.aicc-text-gradient` only ever paints display-size text (>= 24px, or >= 18.66px bold): all locales, phone to desktop, Larger text
  for (const loc of ["en", "he", "es", "ru"]) for (const route of ["", "product", "pricing"]) {
    const sizes = [];
    for (const [w, large] of [[320, true], [360, false], [390, false], [768, false], [1280, false]]) {
      const [ctx, p] = await fresh({ viewport: { width: w, height: 900 } });
      if (large) await ctx.addInitScript(() => localStorage.setItem("aicc_a11y", JSON.stringify({ text: "large" })));
      await p.goto(urlFor(loc, route)); await p.waitForTimeout(250);
      sizes.push(...(await p.$$eval(".aicc-text-gradient", (els) => els.map((e) => { const c = getComputedStyle(e); return { px: parseFloat(c.fontSize), wt: Number(c.fontWeight) || 400 }; }))));
      await ctx.close();
    }
    check(`headline gradient[${loc}/${route || "home"}]: every .aicc-text-gradient is display text (${sizes.length} instances, smallest ${sizes.length ? Math.min(...sizes.map((x) => x.px)) : "-"}px)`, sizes.every((x) => x.px >= 24 || (x.px >= 18.66 && x.wt >= 700)), JSON.stringify(sizes));
  }
  // 7b. default vs Enhanced: the stronger mode must exceed the default on all three treatments, and the default must already pass
  const read = (p) => p.evaluate((wcagSrc) => {
    const ratio = eval(wcagSrc);
    const rgbs = (img) => [...img.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => m[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number));
    const btn = getComputedStyle(document.querySelector("main .aicc-btn--primary.aicc-btn--lg"));
    const stops = rgbs(btn.backgroundImage); const endRatio = ratio(stops[stops.length - 1], [255, 255, 255]);
    const hl = document.querySelector(".aicc-text-gradient"); const hs = getComputedStyle(hl);
    const hlSolid = hs.backgroundImage === "none" || !/gradient/.test(hs.backgroundImage) || new Set(rgbs(hs.backgroundImage).map(String)).size === 1;
    const eb = document.querySelector(".aicc-eyebrow-pill"); const es = getComputedStyle(eb);
    const fg = es.color.match(/[\d.]+/g).slice(0, 3).map(Number);
    return { endRatio, hlSolid, hlColor: hs.webkitTextFillColor, eyebrowFg: fg, eyebrowBg: es.backgroundColor, attr: document.documentElement.getAttribute("data-aicc-contrast") };
  }, wcag);
  const [c1, p1] = await fresh({ viewport: { width: 1280, height: 900 } });
  await p1.goto(urlFor("en", "")); await p1.waitForTimeout(400);
  const def = await read(p1); await c1.close();
  const [c2, p2] = await fresh({ viewport: { width: 1280, height: 900 } });
  await p2.addInitScript(() => localStorage.setItem("aicc_a11y", JSON.stringify({ contrast: "high" })));
  await p2.goto(urlFor("en", "")); await p2.waitForTimeout(400);
  const hi = await read(p2); await c2.close();
  check(`default look: primary button gradient end is AA with white text (${def.endRatio.toFixed(2)}:1, no data-aicc-contrast attribute)`, def.endRatio >= 4.5 && !def.attr, JSON.stringify(def));
  check(`Enhanced contrast: button gradient end is darker than the default (${hi.endRatio.toFixed(2)}:1 vs ${def.endRatio.toFixed(2)}:1)`, hi.attr === "high" && hi.endRatio > def.endRatio + 0.3, JSON.stringify(hi));
  check("Enhanced contrast: headline becomes solid dark text (no gradient); the default keeps the gradient", hi.hlSolid && !def.hlSolid, `${def.hlSolid} / ${hi.hlSolid}`);
  const lumOf = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  check("Enhanced contrast: eyebrow text is darker than the default", lumOf(hi.eyebrowFg) < lumOf(def.eyebrowFg), `${def.eyebrowFg} -> ${hi.eyebrowFg}`);
}
// 8. Signature demo: the second control "What the shopper sees | What you see", for the SAME sample bundle
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-fbt input[type=checkbox]");
  const views = await p.$$eval("button[data-view]", (b) => b.map((x) => [x.dataset.view, x.getAttribute("aria-pressed"), x.textContent.trim()]));
  check(`view toggle: two native buttons "${views.map((v) => v[2]).join(" | ")}" with aria-pressed (shopper pressed first)`, views.length === 2 && views[0][1] === "true" && views[1][1] === "false" && views[0][0] === "shopper");
  await p.focus('button[data-view="merchant"]'); await p.keyboard.press("Enter");
  const m = await p.evaluate(() => ({ pressed: document.querySelector('button[data-view="merchant"]').getAttribute("aria-pressed"), shopperHidden: document.querySelector('[data-panel="shopper"]').hidden, merchantShown: !document.querySelector('[data-panel="merchant"]').hidden, modes: [...document.querySelectorAll("[data-modes] button")].every((b) => b.disabled), sample: /Sample data: not from a real store/.test(document.querySelector(".aicc-fbt").textContent), rows: [...document.querySelectorAll(".aicc-fbt-row[data-id]")].map((r) => r.dataset.id + ":" + r.querySelector(".aicc-fbt-row__why").textContent.trim()) }));
  check("view toggle: Enter switches to the merchant view (aria-pressed, panels; the compare group stays in place, disabled)", m.pressed === "true" && m.shopperHidden && m.merchantShown && m.modes, JSON.stringify(m));
  check("merchant view: counts say \"Bought together N times\" for learned partners and the fallback row says it has no count (no invented plugin label, no tiers)", m.rows.some((r) => /^filters:Bought together 9 times/.test(r)) && m.rows.some((r) => /^mug:No count: filled in from your catalog/.test(r)) && m.rows.some((r) => /^towel:No count: one of your newest in-stock products/.test(r)) && !m.rows.some((r) => /strong|medium|light/i.test(r)), m.rows.join(" | "));
  check("merchant view: labelled \"Sample data: not from a real store\"", m.sample);
  const adds0 = await p.$eval('[data-tile="adds"] strong', (e) => e.textContent.trim());
  await p.click('button[data-view="shopper"]');
  await p.click("[data-add]");
  await p.click('button[data-view="merchant"]');
  const adds1 = await p.$eval('[data-tile="adds"] strong', (e) => e.textContent.trim());
  check(`merchant view: adding the bundle in the shopper view records a Bundle Add-To-Cart (${adds0} -> ${adds1})`, +adds1 === +adds0 + 1);
  // rules in the merchant view: native selects, exclusion removes the row from the list and announces it
  await p.selectOption('select[data-rule="grinder"]', "pin");
  const first = await p.$eval(".aicc-fbt-row[data-id]", (e) => e.dataset.id);
  check("merchant view: Pin moves the product to the first place", first === "grinder", first);
  await p.selectOption('select[data-rule="mug"]', "exclude");
  const ex = await p.evaluate(() => ({ shown: [...document.querySelectorAll(".aicc-fbt-row[data-id]:not([data-hidden])")].map((r) => r.dataset.id), hidden: [...document.querySelectorAll(".aicc-fbt-row[data-hidden]")].map((r) => r.dataset.id), live: document.querySelector("[data-announce]").textContent }));
  check("merchant view: Exclude removes the product from the list; the change is announced in the one status region", !ex.shown.includes("mug") && ex.hidden.includes("mug") && /mug/i.test(ex.live), JSON.stringify(ex));
  await p.click('button[data-view="shopper"]'); await p.click('button[data-mode="with"]');
  const shopperNames = await p.$$eval("[data-bundle] .aicc-fbt-card__name", (e) => e.map((x) => x.textContent.trim()));
  check("shopper view reflects the rules (grinder first, mug gone)", /grinder/i.test(shopperNames[1]) && !shopperNames.some((n) => /mug/i.test(n)), shopperNames.join(" | "));
  await ctx.close();
}
// 8b. Simulated translated Hebrew: a non-fallback RTL demo uses ArrowLeft for "next"
{
  const [ctx, p] = await fresh();
  await p.route(/\/he\/$/, async (route) => { const r = await route.fetch(); let body = await r.text(); body = body.replace(/,&quot;_fallback&quot;:true/g, "").replace(/data-dir="ltr"/g, 'data-dir="rtl"'); await route.fulfill({ response: r, body }); });
  await p.goto(urlFor("he", ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-fbt input[type=checkbox]");
  const st = await p.evaluate(() => ({ lang: document.querySelector(".aicc-fbt").getAttribute("lang"), dir: getComputedStyle(document.querySelector(".aicc-fbt")).direction }));
  const live = await p.$$(".aicc-fbt input[type=checkbox]:not(:disabled)");
  await live[0].focus(); await p.keyboard.press("ArrowLeft");
  check(`demo (translated RTL simulation): not marked as fallback (lang=${st.lang}, ${st.dir}) and ArrowLeft moves to the next product`, st.lang === "he" && st.dir === "rtl" && (await p.evaluate(() => document.activeElement === document.querySelectorAll(".aicc-fbt input[type=checkbox]:not(:disabled)")[1])));
  await ctx.close();
}
// 8c. Merchant view on a phone: no squeezed columns (a product name never breaks letter by letter)
for (const w of [320, 360, 390]) {
  const [ctx, p] = await fresh({ viewport: { width: w, height: 800 } });
  await p.goto(urlFor("en", ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-fbt input[type=checkbox]");
  await p.click('button[data-view="merchant"]');
  const r = await p.evaluate(() => ({ narrow: [...document.querySelectorAll(".aicc-fbt-row__name")].filter((e) => e.getBoundingClientRect().width < 150).length, sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check(`merchant view @${w}: product names have room (name cell at least 150px wide) and the page does not scroll sideways`, r.narrow === 0 && r.sw <= r.iw, JSON.stringify(r));
  await ctx.close();
}
// 9. Rules demo "Control, not a black box"
for (const route of ["", "product"]) {
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", route));
  if (!route) await p.click("#ws-t-control"); // Home: the rules demo lives in the "Control" tab of the workspace
  await p.evaluate(() => document.querySelector("[data-aicc-rules]").scrollIntoView());
  await p.waitForSelector(".aicc-rules [data-list] li");
  const R = () => p.evaluate(() => ({ list: [...document.querySelectorAll(".aicc-rules [data-list] li")].map((l) => l.dataset.id), hidden: [...document.querySelectorAll(".aicc-rules [data-hidden] li:not(.aicc-rules__none) span")].map((x) => x.textContent.trim()), live: document.querySelector(".aicc-rules [data-announce]").textContent, help: document.querySelector(".aicc-rules [data-help]").textContent, pressed: [...document.querySelectorAll(".aicc-rules button[data-action]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.action) }));
  const tag = route || "home";
  const r0 = await R();
  check(`rules[${tag}]: starts as AICC ordered it; the out-of-stock sample is not in the list`, r0.list[0] === "filters" && !r0.list.includes("travel") && r0.hidden.length === 1, JSON.stringify(r0));
  check(`rules[${tag}]: four native action buttons with aria-pressed, a labelled product select and a Reset button`, (await p.$$eval(".aicc-rules button[data-action]", (b) => b.length === 4 && b.every((x) => x.hasAttribute("aria-pressed")))) && (await p.$eval(".aicc-rules label[for]", (l) => !!document.getElementById(l.getAttribute("for")))) && !!(await p.$("[data-reset]")));
  await p.selectOption(".aicc-rules [data-product]", "grinder");
  await p.focus('.aicc-rules button[data-action="pin"]'); await p.keyboard.press("Enter");
  let r = await R();
  check(`rules[${tag}]: Pin (keyboard) puts the product first; pressed state, help text and live region update`, r.list[0] === "grinder" && r.pressed.join() === "pin" && /near the top/.test(r.help) && /Gr|grinder/i.test(r.live), JSON.stringify(r));
  await p.selectOption(".aicc-rules [data-product]", "kettle");
  await p.click('.aicc-rules button[data-action="exclude"]');
  r = await R();
  check(`rules[${tag}]: Exclude removes the product and lists it as hidden`, !r.list.includes("kettle") && r.hidden.some((h) => /kettle/i.test(h)), JSON.stringify(r));
  await p.selectOption(".aicc-rules [data-product]", "towel");
  await p.click('.aicc-rules button[data-action="prefer"]');
  r = await R();
  check(`rules[${tag}]: Prefer nudges up exactly one place (towel above mug)`, r.list.indexOf("towel") === r.list.indexOf("mug") - 1, r.list.join());
  await p.selectOption(".aicc-rules [data-product]", "filters");
  await p.click('.aicc-rules button[data-action="deprioritize"]');
  r = await R();
  check(`rules[${tag}]: Deprioritize nudges down exactly one place and never removes it`, r.list.includes("filters") && r.list.indexOf("filters") === 1 + r.list.indexOf("grinder"), r.list.join());
  await p.selectOption(".aicc-rules [data-product]", "travel");
  await p.click('.aicc-rules button[data-action="pin"]');
  r = await R();
  check(`rules[${tag}]: an out-of-stock product stays out even when pinned`, !r.list.includes("travel"), r.list.join());
  await p.selectOption(".aicc-rules [data-product]", "kettle");
  await p.click('.aicc-rules button[data-action="pin"]');
  await p.click('.aicc-rules button[data-action="pin"]');
  r = await R();
  check(`rules[${tag}]: pressing an active action again clears the rule`, r.pressed.length === 0);
  await p.click("[data-reset]");
  r = await R();
  check(`rules[${tag}]: Reset restores AICC's own order and announces it`, JSON.stringify(r.list) === JSON.stringify(r0.list) && /reset|original|AICC/i.test(r.live), JSON.stringify(r));
  check(`rules[${tag}]: labelled as an illustration with sample products`, await p.evaluate(() => /Illustration with sample products/.test(document.querySelector(".aicc-rules").textContent)));
  await ctx.close();
}
// 9b. rules demo at 320 and with reduced motion
{
  const [ctx, p] = await fresh({ viewport: { width: 320, height: 640 }, reducedMotion: "reduce" });
  await p.goto(urlFor("en", ""));
  await p.click("#ws-t-control");
  await p.evaluate(() => document.querySelector("[data-aicc-rules]").scrollIntoView());
  await p.waitForSelector(".aicc-rules [data-list] li");
  await p.click('.aicc-rules button[data-action="pin"]');
  const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, anim: [...document.querySelectorAll(".aicc-rules *")].some((e) => { const c = getComputedStyle(e); return parseFloat(c.animationDuration) > 0.01 && c.animationName !== "none"; }) }));
  check(`rules @320 + reduced motion: no horizontal scroll (${r.sw}/${r.iw}) and no running animation`, r.sw <= r.iw && !r.anim, JSON.stringify(r));
  await ctx.close();
}
// 10. Dashboard preview, Ask Reco panel, flow diagrams
for (const route of ["", "product"]) {
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", route));
  const tag = route || "home";
  if (!route) { await p.click("#ws-t-understand"); }
  const d = await p.evaluate(() => { const txt = document.querySelector(".aicc-dash")?.textContent || ""; return { has: !!document.querySelector(".aicc-dash"), labels: ["Recommendation Views", "Recommendation Clicks", "Recommendation Click Rate", "Bundle Add-To-Carts", "Associated Orders", "Associated Revenue", "Merchant Insights", "Recommendation Preview"].filter((l) => !txt.includes(l)), sample: /Sample data: not from a real store/.test(txt), bought: /Bought together 9 times/.test(txt), fallback: /\$16\.00/.test(txt) && !/Same category — no purchase history/.test(txt) && !/\$16\.00\s*·/.test(txt), banned: /AI Assisted|widget views/i.test(txt) }; });
  check(`dashboard preview[${tag}]: the plugin's labels (missing: ${d.labels.join(", ") || "none"}), labelled SAMPLE, learned partners show a count, a fallback product shows only its price`, d.has && !d.labels.length && d.sample && d.bought && d.fallback && !d.banned, JSON.stringify(d));
  if (!route) await p.click("#ws-t-ask");
  await p.evaluate(() => document.querySelector(".aicc-ask").scrollIntoView());
  const a0 = await p.$$eval(".aicc-ask [data-pair]", (e) => e.map((x) => !x.hidden));
  await p.click('.aicc-ask button[data-qa="opportunity"]');
  const a1 = await p.evaluate(() => ({ pairs: [...document.querySelectorAll(".aicc-ask [data-pair]")].map((x) => !x.hidden), pressed: [...document.querySelectorAll(".aicc-ask button[data-qa]")].map((b) => b.getAttribute("aria-pressed")), sample: /Sample/.test(document.querySelector(".aicc-ask").textContent), claim: /changes? your settings|generative/i.test(document.querySelector(".aicc-ask__foot").textContent) }));
  check(`Ask Reco panel[${tag}]: sample question buttons switch the answer (aria-pressed), labelled as a sample, footnote states the boundaries`, a0.join() === "true,false,false,false" && a1.pairs.join() === "false,true,false,false" && a1.pressed.join() === "false,true,false,false" && a1.sample, JSON.stringify([a0, a1]));
  const f = await p.$$eval(".aicc-flow", (e) => e.map((x) => ({ kind: x.dataset.kind, steps: x.querySelectorAll("li").length, ol: x.querySelector("ol") !== null })));
  check(`flow diagrams[${tag}]: ${route ? "order, outage" : "order, outage"} diagrams are ordered lists of three steps`, f.length >= 2 && f.every((x) => x.steps === 3 && x.ol) && f.some((x) => x.kind === "order") && f.some((x) => x.kind === "down"), JSON.stringify(f));
  await ctx.close();
}
// 11. Page structure: one h1, sequential headings, in-page nav on Product
{
  const [ctx, p] = await fresh();
  for (const route of ["", "product", "pricing", "questions", "data-and-trust"]) {
    await p.goto(urlFor("en", route));
    const h = await p.$$eval("h1,h2,h3,h4,h5,h6", (e) => e.map((x) => +x.tagName[1]));
    const jumps = h.some((v, i) => i && v > h[i - 1] + 1);
    check(`headings[${route || "home"}]: exactly one h1 and no skipped levels (${h.length} headings)`, h.filter((v) => v === 1).length === 1 && !jumps, h.join(""));
  }
  await p.goto(urlFor("en", "product"));
  const chips = await p.$$eval(".aicc-subnav a[href^='#']", (a) => a.map((x) => x.getAttribute("href")));
  check(`product: in-page navigation anchors all resolve (${chips.length})`, chips.length >= 12 && (await p.evaluate((h) => h.every((x) => !!document.getElementById(x.slice(1))), chips)), chips.join());
  check("product: #how-decided exists (linked from Home)", await p.evaluate(() => !!document.getElementById("how-decided")));
  await ctx.close();
}
// 12. Home workspace: ARIA tabs (Understand / Control / Find opportunities / Ask Reco)
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", ""));
  await p.waitForSelector("#workspace [data-aicc-tabs][data-enhanced]");
  const t0 = await p.evaluate(() => ({ list: document.querySelector("#workspace [role=tablist]").getAttribute("aria-label"), labels: [...document.querySelectorAll("#workspace [role=tab]")].map((t) => t.textContent.trim()), sel: [...document.querySelectorAll("#workspace [role=tab]")].map((t) => t.getAttribute("aria-selected")), ti: [...document.querySelectorAll("#workspace [role=tab]")].map((t) => t.tabIndex), panels: [...document.querySelectorAll("#workspace [role=tabpanel]")].map((x) => !x.hidden && !x.inert), linked: [...document.querySelectorAll("#workspace [role=tab]")].every((t) => document.getElementById(t.getAttribute("aria-controls"))?.getAttribute("aria-labelledby") === t.id) }));
  check(`tabs: tablist with four tabs (${t0.labels.join(" | ")}), first selected, roving tabindex, one visible panel, tab/panel linked`, t0.labels.join() === "Understand,Control,Find opportunities,Ask Reco" && t0.sel.join() === "true,false,false,false" && t0.ti.join() === "0,-1,-1,-1" && t0.panels.join() === "true,false,false,false" && t0.linked && !!t0.list, JSON.stringify(t0));
  await p.focus("#ws-t-understand");
  await p.keyboard.press("ArrowRight");
  check("tabs: ArrowRight selects and focuses the next tab", await p.evaluate(() => document.activeElement.id === "ws-t-control" && document.activeElement.getAttribute("aria-selected") === "true" && !document.getElementById("ws-p-control").inert && document.getElementById("ws-p-understand").inert));
  await p.keyboard.press("End");
  check("tabs: End goes to the last tab, Home to the first", (await p.evaluate(() => document.activeElement.id)) === "ws-t-ask" && (await (async () => { await p.keyboard.press("Home"); return p.evaluate(() => document.activeElement.id); })()) === "ws-t-understand");
  await p.keyboard.press("ArrowLeft");
  check("tabs: arrows wrap around (ArrowLeft on the first tab selects the last)", await p.evaluate(() => document.activeElement.id === "ws-t-ask"));
  await p.keyboard.press("Tab");
  check("tabs: Tab moves into the selected panel's content, not to the next tab", await p.evaluate(() => !document.activeElement.matches("[role=tab]") && !!document.activeElement.closest("#ws-p-ask")));
  await p.click("#ws-t-insights");
  const ins = await p.evaluate(() => ({ kinds: [...document.querySelectorAll("#ws-p-insights .aicc-insight__kind")].map((x) => x.textContent.trim()), sample: /Sample data: not from a real store/.test(document.getElementById("ws-p-insights").textContent), gate: /at least 10 orders/.test(document.getElementById("ws-p-insights").textContent) }));
  check(`tabs: "Find opportunities" shows the four real insight kinds, labelled sample, with the 10-order gate (${ins.kinds.join(" | ")})`, ins.kinds.length === 4 && ins.sample && ins.gate && ins.kinds.includes("Strong Bundle Opportunity"), JSON.stringify(ins));
  check("tabs: the shopper-to-merchant connector links back to the demo", await p.evaluate(() => document.querySelector(".aicc-connector a")?.getAttribute("href") === "#demo"));
  await ctx.close();
}
{
  // RTL: arrows follow the reading direction (simulated translated Hebrew), and without JavaScript every panel is visible under its heading
  const [ctx, p] = await fresh();
  await p.route(/\/he\/$/, async (route) => { const r = await route.fetch(); let body = await r.text(); body = body.replace(/ lang="en" dir="ltr"/g, ""); await route.fulfill({ response: r, body }); });
  await p.goto(urlFor("he", ""));
  await p.waitForSelector("#workspace [data-aicc-tabs][data-enhanced]");
  await p.focus("#ws-t-understand"); await p.keyboard.press("ArrowLeft");
  check("tabs[he]: in a right-to-left page ArrowLeft selects the NEXT tab", await p.evaluate(() => document.activeElement.id === "ws-t-control"));
  await ctx.close();
  const [c2, p2] = await fresh({ javaScriptEnabled: false });
  await p2.goto(urlFor("en", ""));
  const nj = await p2.evaluate(() => ({ list: document.querySelector("#workspace [role=tablist]").hidden, panels: [...document.querySelectorAll("#workspace [role=tabpanel]")].map((x) => getComputedStyle(x).display !== "none"), heads: [...document.querySelectorAll(".aicc-tabs__ph")].every((h) => getComputedStyle(h).position !== "absolute") }));
  check("tabs without JavaScript: the tab list is hidden and all four panels show under visible headings", nj.list && nj.panels.every(Boolean) && nj.heads, JSON.stringify(nj));
  await c2.close();
}
// 13. Loop strip and hero fact hierarchy
for (const route of ["", "product"]) {
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", route));
  const l = await p.evaluate(() => ({ steps: [...document.querySelectorAll(".aicc-loop__step")].map((x) => x.textContent.trim().replace(/^\d/, "")), links: [...document.querySelectorAll(".aicc-loop__step a")].map((a) => a.getAttribute("href")), ol: !!document.querySelector("nav.aicc-loop ol"), label: document.querySelector("nav.aicc-loop")?.getAttribute("aria-label") }));
  check(`loop strip[${route || "home"}]: seven steps in one ordered list, each linking to a section that exists (${l.steps.join(" > ")})`, l.steps.length === 7 && l.ol && !!l.label && l.links.length === 7 && (await p.evaluate((h) => h.every((x) => !!document.querySelector(x)), l.links)), JSON.stringify(l));
  if (!route) {
    await p.click('.aicc-loop__step a[data-aicc-tab="ws-t-control"]');
    await p.waitForTimeout(300);
    check("loop strip[home]: the Control step opens the Control tab of the workspace", await p.evaluate(() => document.getElementById("ws-t-control").getAttribute("aria-selected") === "true" && location.hash === "#workspace"));
    const f = await p.evaluate(() => ({ conf: document.querySelector(".aicc-pricing-confidence")?.textContent.replace(/\s+/g, " ").trim(), inHero: !!document.querySelector(".aicc-hero .aicc-hero__confidence, .aicc-hero .aicc-pricing-confidence"), heroText: document.querySelector(".aicc-hero").innerText, inPricing: !!document.querySelector("[aria-labelledby=pricing-title] .aicc-pricing-confidence") }));
    check(`conversion pass: price, guarantee and renewal facts sit under the pricing cards, not in the hero (${f.conf})`, /Plans from \$99 a year/.test(f.conf) && /14-day money-back guarantee on your initial plan purchase/.test(f.conf) && /No automatic renewal/.test(f.conf) && f.inPricing && !f.inHero && !/money-back|automatic renewal|a year/i.test(f.heroText), JSON.stringify(f));
  }
  await ctx.close();
}
// 12b. Conversion pass: approved hero, outcome-first order, Product page / Cart switch, shopper vs merchant framing
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", ""));
  const h = await p.evaluate(() => ({ h1: document.querySelector("h1").textContent.replace(/\s+/g, " ").trim(), lead: document.querySelector(".aicc-hero-lead").textContent.replace(/\s+/g, " ").trim(), eyebrow: document.querySelector(".aicc-hero .aicc-eyebrow, .aicc-hero [class*=eyebrow]")?.textContent.trim(), cat: document.querySelector(".aicc-hero__category")?.textContent.trim(), ctas: [...document.querySelectorAll(".aicc-hero .aicc-hero-actions a, .aicc-hero .aicc-hero-actions button")].map((x) => x.textContent.trim()), hasDemoTrigger: !!document.querySelector(".aicc-hero .aicc-hero-actions [data-aicc-demo-trigger]") }));
  check(`home hero: approved headline, subheadline, category, availability and the two approved CTAs (${h.ctas.join(" | ")})`, h.h1 === "Turn every shopper journey into a smarter selling opportunity." && h.lead === "AI Commerce Copilot turns your store data into relevant recommendations and smarter merchandising \u2014 helping shoppers discover more while you manage less and stay in control." && /available for woocommerce/i.test(h.eyebrow) && h.cat === "Commerce recommendation and merchandising copilot" && h.ctas.join("|") === "See it in action|View plans" && h.hasDemoTrigger, JSON.stringify(h));
  const o = await p.evaluate(() => ({ titles: [...document.querySelectorAll(".aicc-pillars h3, .aicc-pillars [class*=title]")].map((x) => x.textContent.trim()), order: [...document.querySelectorAll("main > section[id], main > .aicc-section[id]")].map((x) => x.id) }));
  check(`home order: three merchant outcomes first (${o.titles.join(" | ")})`, o.titles.slice(0, 3).join("|") === "Help shoppers discover more|Merchandise less by hand|Stay in control", JSON.stringify(o));
  const ord = await p.evaluate(() => ["demo", "workspace", "why", "how-it-works"].map((id) => document.getElementById(id)?.getBoundingClientRect().top + scrollY));
  check(`home order: outcomes, then the interactive "What shoppers see" demo (which holds the Product page / Cart switch), then workspace, then mechanics (${ord.map(Math.round).join(" < ")})`, ord.every((v, i) => v > 0 && (i === 0 || v > ord[i - 1])) && !(await p.evaluate(() => !!document.getElementById("surfaces"))), JSON.stringify(ord));
  // The Product page / Cart switch lives INSIDE the demo: one canonical shopper-facing section, no separate proof section.
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView()); await p.waitForSelector(".aicc-fbt [data-surface]", { state: "attached", timeout: 8000 });
  const snap = () => p.evaluate(() => {
    const f = document.querySelector(".aicc-fbt"), q = (x) => f.querySelector(x), qa = (x) => [...f.querySelectorAll(x)];
    const cards = qa("[data-cands] .aicc-fbt-card");
    return { surface: qa("[data-surface][aria-pressed=true]").map((b) => b.dataset.surface).join(), mode: f.dataset.mode, title: q("[data-title]").textContent.trim(), sub: q("[data-sub]").textContent.trim(),
      cards: cards.length, anchor: cards.filter((c) => c.dataset.anchor).length, locked: qa("[data-cands] input:disabled").length, ticked: cards.filter((c) => c.querySelector("input").checked).length,
      names: cards.map((c) => c.querySelector(".aicc-fbt-card__name").textContent.trim()), arts: qa("[data-cands] .aicc-fbt-art").length, wrap: getComputedStyle(q("[data-cands]")).flexWrap,
      total: q("[data-total]").textContent.trim(), label: q(".aicc-fbt__total span").textContent.trim(), add: q("[data-add-text]").textContent.trim(), brand: q(".aicc-fbt__brand").textContent.replace(/\s+/g, " ").trim(),
      store: { product: !!q("[data-store] .aicc-fbt-store__product"), cart: !!q("[data-store] .aicc-fbt-cart"), lines: qa("[data-store] .aicc-fbt-cart__line").map((l) => l.querySelector(".aicc-fbt-cart__name").textContent.trim()), rows: qa("[data-store] .aicc-fbt-cart__row").map((r) => r.textContent.replace(/\s+/g, " ").trim()), checkout: q("[data-store] .aicc-fbt-cart__checkout")?.textContent.trim() || "" },
      plain: { shown: !q("[data-plain]").hidden, names: qa("[data-plainlist] .aicc-fbt-card__name").map((x) => x.textContent.trim()), ticks: qa("[data-plain] input").length }, result: q("[data-result]").textContent.trim() };
  });
  const surfaces = await p.evaluate(() => [...document.querySelectorAll(".aicc-fbt [data-surface]")].map((b) => b.textContent.trim()));
  const pg = await snap();
  check("shoppers demo: a Product page | Cart switch sits inside the demo (Product page selected first), next to the WooCommerce / With AICC comparison, with no separate section", surfaces.join("|") === "Product page|Cart" && pg.surface === "page" && pg.mode === "with" && pg.store.product && !pg.store.cart, JSON.stringify({ surfaces, pg: { surface: pg.surface, mode: pg.mode } }));
  check("shoppers demo / Product page: follows the real widget (title and subtitle, the viewed product first, ticked and locked, a non-wrapping card rail with product images, Bundle total, \"Add N product(s) to cart\", Powered by signature)",
    pg.title === "Frequently Bought Together" && pg.sub === "Customers often purchase these products together." && pg.cards === 5 && pg.anchor === 1 && pg.locked === 1 && pg.ticked === 1 && pg.names[0] === "Pour-over coffee set" && pg.arts === pg.cards && pg.label.toLowerCase() === "bundle total" && pg.total === "$38.00" && pg.add === "Add 1 product to cart" && /Powered by AI Commerce Copilot/.test(pg.brand) && pg.wrap === "nowrap", JSON.stringify(pg));
  await p.click(".aicc-fbt [data-surface=cart]"); await p.waitForTimeout(250);
  const ct = await snap();
  check("shoppers demo / Cart: shows what is already in the cart (lines, subtotal, shipping, total, a neutral checkout control) and recommends BELOW it: no viewed-product card, nothing already in the cart is offered, recommendations start unticked",
    ct.surface === "cart" && ct.store.cart && !ct.store.product && ct.store.lines.length === 2 && ct.store.rows.length === 3 && /^Subtotal\$86\.00$/.test(ct.store.rows[0]) && /^Total\$86\.00$/.test(ct.store.rows[2]) && ct.store.checkout === "Proceed to checkout" && ct.anchor === 0 && ct.locked === 0 && ct.ticked === 0 && ct.total === "$0.00" && !ct.names.some((n) => ct.store.lines.includes(n)) && ct.arts === ct.cards, JSON.stringify(ct));
  check("shoppers demo: the Product page and the Cart are structurally different (a product block vs cart lines and totals) and the widget's own result line follows the surface", pg.store.product && ct.store.cart && pg.result !== ct.result && /cart/i.test(ct.result), JSON.stringify({ a: pg.result, b: ct.result }));
  const order = await p.evaluate(() => { const f = document.querySelector(".aicc-fbt"); const cart = f.querySelector("[data-store] .aicc-fbt-cart").getBoundingClientRect(), w = f.querySelector(".aicc-fbt__widgetbox").getBoundingClientRect(); return w.top >= cart.bottom - 1; });
  check("shoppers demo / Cart: the widget sits under the cart (cart-page placement), not beside it", order);
  await p.click(".aicc-fbt [data-mode=without]"); await p.waitForTimeout(250);
  const cw = await snap();
  const cx = await p.evaluate(() => { const f = document.querySelector(".aicc-fbt"); return { btn: f.querySelector("[data-mode=without]").textContent.trim(), title: f.querySelector("[data-title]").textContent.trim(), sub: f.querySelector("[data-sub]").textContent.trim(), hint: f.querySelector("[data-plainhint]").textContent.trim(), why: f.querySelector("[data-why]").textContent.trim(), tags: [...f.querySelectorAll("[data-plainlist] .aicc-fbt-plain__tag")].map((x) => x.textContent.trim()), tiles: f.querySelectorAll("[data-plainlist] li").length, controls: f.querySelectorAll("[data-plain] input, [data-plain] button, [data-plain] [data-total], [data-plain] [data-add]").length, widgetHidden: f.querySelector("[data-bundle]").hidden, artFilter: getComputedStyle(f.querySelector("[data-plainlist] .aicc-fbt-art")).filter }; });
  check("shoppers demo / Cart + WooCommerce cross-sells: plain grey cross-sells block (no ticks, no total, no button), without the products already in the cart", cw.mode === "without" && cw.plain.shown && cw.plain.ticks === 0 && cw.plain.names.length >= 2 && !cw.plain.names.some((n) => cw.store.lines.includes(n)) && /cross-sell/i.test(cw.result), JSON.stringify(cw.plain));
  check("shoppers demo / Cart + WooCommerce: says plainly that cross-sells are manually linked and not learned (title, one-line note, per-product tag, hint and side explanation), with no controls and the AICC widget hidden",
    cx.btn === "WooCommerce manual cross-sells" && cx.title === "WooCommerce cart cross-sells" && cx.sub === "Products you manually link to items in your catalog can appear here." && cx.hint === "WooCommerce does not learn these from what shoppers buy together: the merchant chooses the cross-sells manually." && /links? to items by hand/.test(cx.why) && /does not learn them/.test(cx.why) && /a store with none configured shows none/.test(cx.why) && /by hand.*does not learn them/.test(cw.result) && cx.tiles >= 2 && cx.tags.length === cx.tiles && cx.tags.every((t) => t === "Manually linked") && cx.controls === 0 && cx.widgetHidden && /grayscale/.test(cx.artFilter), JSON.stringify(cx));
  await p.click(".aicc-fbt [data-surface=page]"); await p.waitForTimeout(250);
  const pw = await snap();
  check("shoppers demo / Product page + WooCommerce related products: the plain block, 3 tiles, the same two-way comparison, unchanged (no manual-link tag, category wording)", pw.surface === "page" && pw.mode === "without" && pw.plain.shown && pw.plain.names.length === 3 && pw.plain.ticks === 0 && /related/i.test(pw.result) && /same category/.test(pw.result) && (await p.$$(".aicc-fbt [data-plainlist] .aicc-fbt-plain__tag")).length === 0, JSON.stringify(pw.plain));
  const grey = await p.evaluate(() => { const li = document.querySelector("[data-plainlist] li"), art = li.querySelector(".aicc-fbt-art"); return { filter: getComputedStyle(art).filter, bg: getComputedStyle(li).backgroundColor }; });
  check("shoppers demo: the WooCommerce side is neutral grey (grayscale artwork, no brand colour)", /grayscale/.test(grey.filter), JSON.stringify(grey));
  await p.click(".aicc-fbt [data-mode=with]"); await p.click(".aicc-fbt [data-surface=cart]"); await p.waitForTimeout(250);
  const boxesNow = await p.$$(".aicc-fbt [data-cands] input:not(:disabled)");
  await boxesNow[0].focus(); await p.keyboard.press("Space"); await p.waitForTimeout(600);
  const ct2 = await snap();
  await p.click(".aicc-fbt [data-surface=page]"); await p.waitForTimeout(250);
  const back = await snap();
  await p.click(".aicc-fbt [data-surface=cart]"); await p.waitForTimeout(250);
  check("shoppers demo / Cart: ticking a recommendation updates the bundle total and the button label, and the Product page keeps its own selection", ct2.ticked === 1 && ct2.total !== "$0.00" && ct2.add === "Add 1 product to cart" && back.ticked === 1 && back.total === "$38.00", JSON.stringify({ ct2: [ct2.ticked, ct2.total, ct2.add], back: [back.ticked, back.total] }));
  await p.click(".aicc-fbt [data-view=merchant]"); await p.waitForTimeout(250);
  const mv = await p.evaluate(() => ({ disabled: [...document.querySelectorAll(".aicc-fbt [data-surface], .aicc-fbt [data-mode]")].every((b) => b.disabled), merchant: !document.querySelector(".aicc-fbt [data-panel=merchant]").hidden, rows: document.querySelectorAll(".aicc-fbt [data-rows] .aicc-fbt-row").length }));
  check("shoppers demo: the merchant view still works (evidence rows, rules) and the surface / comparison switches are unavailable there", mv.disabled && mv.merchant && mv.rows >= 3, JSON.stringify(mv));
  await p.click(".aicc-fbt [data-view=shopper]"); await p.waitForTimeout(250);
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView()); await p.waitForSelector(".aicc-fbt__view", { state: "attached", timeout: 8000 });
  const v = await p.evaluate(() => ({ titles: [...document.querySelectorAll("#demo .aicc-versus h3")].map((x) => x.textContent.trim()), toggle: [...document.querySelectorAll("#demo .aicc-fbt__view")].map((x) => x.textContent.trim()) }));
  check(`demo: "What shoppers see" versus "What you see and control" (${v.titles.join(" | ")})`, v.titles.join("|") === "What shoppers see|What you see and control" && v.toggle.includes("What you see and control"), JSON.stringify(v));
  const w = await p.evaluate(() => ({ title: document.querySelector("#workspace h2").textContent.trim(), lead: document.querySelector("#workspace .aicc-section-head p, #workspace .aicc-lead")?.textContent.trim() }));
  check("workspace: \"Recommendations are only the storefront.\" and the approved lead", w.title === "Recommendations are only the storefront." && /^Behind them, AI Commerce Copilot gives merchants the insight, controls and guidance to understand what is being recommended, shape what shoppers see, and improve merchandising decisions\.$/.test(w.lead || ""), JSON.stringify(w));
  await p.click("#ws-t-ask");
  const ask = await p.evaluate(() => ({ title: document.querySelector("#ws-p-ask h3")?.textContent.trim(), lead: document.querySelector("#ws-p-ask p")?.textContent.trim() }));
  check("Ask Reco tab: \"Know what to work on next.\" with the approved lead", ask.title === "Know what to work on next." && ask.lead === "Ask Reco turns your own store data into clear answers about opportunities, performance and next steps.", JSON.stringify(ask));
  const body = await p.evaluate(() => document.body.innerText);
  check("conversion pass: no outcome, growth or social-proof claims anywhere on the home page", !/boost(s|ing)? (your )?(conversion|sales|revenue)|increase(s|d)? (your )?(AOV|average order|revenue|sales)|guaranteed (growth|results)|trusted by|thousands of (stores|merchants)|sells for you|\b\d+(\.\d+)?\s?%\s?(more|higher|increase|lift)/i.test(body));
  await ctx.close();
}
// 12c. Conversion pass on a phone: light first viewport, the primary CTA and the first visual reachable, nothing overflows or orphans
for (const [w, h] of [[390, 844], [360, 740], [320, 640]]) {
  const [ctx, p] = await fresh({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  await p.goto(urlFor("en", ""));
  await p.waitForTimeout(500);
  const m = await p.evaluate(() => { const r = (q) => document.querySelector(q)?.getBoundingClientRect(); const lead = document.querySelector(".aicc-hero-lead"); return { sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight, cta: r(".aicc-hero-actions a, .aicc-hero-actions button")?.bottom, h1Lines: Math.round(r("h1").height / parseFloat(getComputedStyle(document.querySelector("h1")).lineHeight)), visual: r(".aicc-hero__visual, .aicc-reco-hero")?.top, pill: r(".aicc-pillars")?.top, words: document.querySelector(".aicc-hero").innerText.trim().split(/\s+/).length, lastWord: lead.textContent.trim().split(/\s+/).pop() }; });
  check(`phone ${w}x${h}: no horizontal scroll, the primary CTA is inside the first viewport, the hero stays light (${m.words} words), the headline wraps to at most five lines (${m.h1Lines})`, m.sw <= m.iw && m.cta < m.ih + (w < 340 ? 240 : 0) && m.words <= 70 && m.h1Lines <= 5, JSON.stringify(m));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView()); await p.waitForSelector(".aicc-fbt [data-surface]", { state: "attached", timeout: 8000 });
  const ov = {};
  for (const surf of ["page", "cart"]) {
    await p.click(`.aicc-fbt [data-surface=${surf}]`); await p.waitForTimeout(250);
    ov[surf] = await p.evaluate(() => { const f = document.querySelector(".aicc-fbt"), st = f.querySelector(".aicc-fbt-store").getBoundingClientRect(), rail = f.querySelector("[data-cands]"), rr = rail.getBoundingClientRect(), add = f.querySelector("[data-add]").getBoundingClientRect(), pills = [...f.querySelectorAll("[data-surface]")].map((b) => b.getBoundingClientRect()); const inside = (r) => r.left >= -1 && r.right <= innerWidth + 1; const out = { page: document.documentElement.scrollWidth <= innerWidth, storeInside: inside(st), railInside: inside(rr), railScrolls: rail.scrollWidth > rail.clientWidth, addInside: inside(add), addTall: add.height >= 44, pillsTall: pills.every((r) => r.height >= 44) };
      const cart = f.querySelector("[data-store] .aicc-fbt-cart"); if (cart) { const it = cart.querySelector(".aicc-fbt-cart__items").getBoundingClientRect(), sm = cart.querySelector(".aicc-fbt-cart__summary").getBoundingClientRect(); out.cartStacked = sm.top >= it.bottom - 1; out.cartInside = inside(it) && inside(sm); out.names = [...cart.querySelectorAll(".aicc-fbt-cart__name")].every((n) => n.getBoundingClientRect().width >= 60); } return out; });
  }
  check(`phone ${w}x${h}: the Product page and Cart stay inside the viewport (only the card rail scrolls, never the page); the cart summary stacks under the cart lines, product names stay readable and the add button is 44px+`, Object.values(ov).every((x) => Object.values(x).every(Boolean)), JSON.stringify(ov));
  await ctx.close();
}
// 14. FAQ search / filter (kit module faq-search.js)
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", "questions"));
  await p.waitForSelector("[data-aicc-faq-search] input[type=search]");
  const ui = await p.evaluate(() => { const i = document.querySelector("[data-aicc-faq-search] input"); const l = document.querySelector(`label[for="${i.id}"]`); return { label: l?.textContent.trim(), search: !!document.querySelector("form[role=search]"), live: document.querySelector("[data-aicc-faq-search] [role=status]")?.getAttribute("aria-live"), type: i.type }; });
  check(`faq search: a visible label (${ui.label}), type=search inside a search landmark, polite live region`, ui.label === "Search the questions" && ui.search && ui.live === "polite" && ui.type === "search", JSON.stringify(ui));
  await p.fill("[data-aicc-faq-search] input", "refund");
  const r1 = await p.evaluate(() => ({ shown: [...document.querySelectorAll("#faq-browse details[id^='q']")].filter((d) => !d.closest("[hidden]")).length, topHidden: document.getElementById("faq-top").hidden, live: document.querySelector("[data-aicc-faq-search] [data-count]").textContent, url: location.search }));
  check(`faq search: filtering "refund" shows matching questions only, hides the duplicate Most asked block, announces the count (${r1.live}) and keeps ?q= in the URL`, r1.shown > 0 && r1.shown < ACTIVE.length && r1.topHidden && /questions? match/.test(r1.live) && r1.url === "?q=refund", JSON.stringify(r1));
  await p.fill("[data-aicc-faq-search] input", "RÉFUND");
  const r2 = await p.evaluate(() => [...document.querySelectorAll("#faq-browse details[id^='q']")].filter((d) => !d.closest("[hidden]")).length);
  check("faq search: case- and diacritic-insensitive (RÉFUND matches refund)", r2 === r1.shown, `${r2} vs ${r1.shown}`);
  await p.fill("[data-aicc-faq-search] input", "zzqxv");
  const r3 = await p.evaluate(() => ({ empty: !document.querySelector("[data-empty]").hidden, text: document.querySelector("[data-empty-text]").textContent, clear: !!document.querySelector("[data-empty] [data-clear]"), list: document.getElementById("faq-browse").hidden }));
  check(`faq search: a useful empty state with a Clear button (${r3.text})`, r3.empty && /No question matches “zzqxv”\. Try fewer words, or browse by topic\./.test(r3.text) && r3.clear && r3.list, JSON.stringify(r3));
  await p.click("[data-empty] [data-clear]");
  const r4 = await p.evaluate(() => ({ val: document.querySelector("[data-aicc-faq-search] input").value, shown: [...document.querySelectorAll("#faq-browse details[id^='q']")].filter((d) => !d.closest("[hidden]")).length, url: location.search, focus: document.activeElement.type, top: document.getElementById("faq-top").hidden }));
  check("faq search: Clear restores the full list, the Most asked block and the URL, and returns focus to the input", r4.val === "" && r4.shown === ACTIVE.length && r4.url === "" && r4.focus === "search" && !r4.top, JSON.stringify(r4));
  await p.fill("[data-aicc-faq-search] input", "checkout"); await p.keyboard.press("Escape");
  check("faq search: Escape clears the query", (await p.$eval("[data-aicc-faq-search] input", (i) => i.value)) === "");
  const ldBefore = await p.$$eval('script[type="application/ld+json"]', (s) => s.map((x) => x.textContent).join("|").length);
  await p.fill("[data-aicc-faq-search] input", "stores");
  check("faq search: the FAQPage JSON-LD is unchanged by filtering", (await p.$$eval('script[type="application/ld+json"]', (s) => s.map((x) => x.textContent).join("|").length)) === ldBefore);
  await p.goto(urlFor("en", "questions") + "?q=renewal");
  await p.waitForSelector("[data-aicc-faq-search] input");
  const dl = await p.evaluate(() => ({ val: document.querySelector("[data-aicc-faq-search] input").value, filtering: document.querySelector("[data-aicc-faq-search]").dataset.filtering }));
  check("faq search: ?q=term is applied on load", dl.val === "renewal" && dl.filtering === "true", JSON.stringify(dl));
  await p.goto(urlFor("en", "questions") + "?q=renewal#q41");
  await p.waitForTimeout(500);
  check("faq search: a #qNN deep link beats a filter that would hide it (filter cleared, answer open)", await p.evaluate(() => document.getElementById("q41").open === true && !document.getElementById("q41").closest("[hidden]")));
  // network: no request carries the query
  const reqs = [];
  p.on("request", (r) => reqs.push(r.url()));
  await p.fill("[data-aicc-faq-search] input", "secretword");
  await p.waitForTimeout(300);
  check("faq search: the query is never sent anywhere (no request after typing) and never stored", reqs.filter((u) => /secretword/.test(u)).length === 0 && (await p.evaluate(() => !Object.keys(localStorage).concat(Object.keys(sessionStorage)).some((k) => /secretword/.test(localStorage.getItem(k) || sessionStorage.getItem(k) || "")))));
  // no JavaScript: the plain full list
  const [c2, p2] = await fresh({ javaScriptEnabled: false });
  await p2.goto(urlFor("en", "questions"));
  const nj = await p2.evaluate(() => ({ details: document.querySelectorAll("details[id^='q']").length, search: !!document.querySelector("input[type=search]") }));
  check(`faq search without JavaScript: the page is the plain full list (${nj.details} questions, no dead search box)`, nj.details === ACTIVE.length && !nj.search, JSON.stringify(nj));
  await c2.close();
  // he / es / ru: the search UI carries the page language when its strings are translated, and lang=en dir=ltr only while that unit is still an English fallback
  for (const loc of ["he", "es", "ru"]) {
    const [c3, p3] = await fresh();
    await p3.goto(urlFor(loc, "questions"));
    await p3.waitForSelector("[data-aicc-faq-search] input");
    const fb = FALLBACK_UNITS[loc].includes("faqSearch");
    const got = await p3.evaluate(() => { const e = document.querySelector("[data-aicc-faq-search]"); return { lang: e.getAttribute("lang"), dir: e.getAttribute("dir"), doc: document.documentElement.lang, placeholder: e.querySelector("input").getAttribute("placeholder") || "", label: (e.querySelector("label")?.textContent || "").trim() }; });
    const wantDir = fb ? "ltr" : loc === "he" ? "rtl" : "ltr";
    check(`faq search[${loc}]: the search UI is ${fb ? "an English fallback marked lang=en dir=ltr" : `translated (lang=${loc})`} on a ${loc} page`, got.doc === loc && (fb ? got.lang === "en" && got.dir === "ltr" : (got.lang === loc || got.lang === null) && (got.dir === wantDir || got.dir === null)) && got.label === DICTS[loc].faqSearch.label, JSON.stringify(got));
    await c3.close();
  }
  await ctx.close();
}
// 15. Review batch: Questions search (first, visible count, >= 2 characters, empty topics hidden, one Clear, debounced announcement)
{
  const [ctx, p] = await fresh({ viewport: { width: 1280, height: 800 } });
  await p.goto(urlFor("en", "questions"));
  await p.waitForSelector("[data-aicc-faq-search] input[type=search]");
  const pos = await p.evaluate(() => ({ search: document.querySelector("[data-aicc-faq-search]").getBoundingClientRect().top, top: document.getElementById("faq-top").getBoundingClientRect().top, h1: document.querySelector("h1").getBoundingClientRect().bottom }));
  check(`questions search: the field is directly under the heading and above "Most asked" (field y=${Math.round(pos.search)}, most asked y=${Math.round(pos.top)}, inside the first screen)`, pos.search > pos.h1 && pos.search < pos.top && pos.search < 800, JSON.stringify(pos));
  await p.fill("[data-aicc-faq-search] input", "a");
  const one = await p.evaluate(() => ({ shown: [...document.querySelectorAll("#faq-browse details[id^='q']")].filter((d) => !d.closest("[hidden]")).length, topHidden: document.getElementById("faq-top").hidden }));
  check("questions search: one character does not filter (needs at least 2)", one.shown === ACTIVE.length && !one.topHidden, JSON.stringify(one));
  await p.fill("[data-aicc-faq-search] input", "");
  await p.type("[data-aicc-faq-search] input", "refund", { delay: 40 });
  const mid = await p.$eval("[data-announce]", (e) => e.textContent);
  await p.waitForTimeout(700);
  const r = await p.evaluate(() => ({ visibleCount: document.querySelector("[data-count]").textContent, visible: getComputedStyle(document.querySelector("[data-count]")).display !== "none" && !document.querySelector("[data-count]").classList.contains("aicc-sr-only"), announced: document.querySelector("[data-announce]").textContent, groups: [...document.querySelectorAll("#faq-browse [data-faq-group]")].filter((g) => !g.hidden).map((g) => g.querySelectorAll("details:not([hidden])").length), emptyHeads: [...document.querySelectorAll("#faq-browse [data-faq-group]")].filter((g) => !g.hidden && ![...g.querySelectorAll(".aicc-accordion__item")].some((i) => !i.hidden)).length, chipsHidden: document.getElementById("faq-browse-head").hidden, results: [...document.querySelectorAll("#faq-browse details[id^='q']")].filter((d) => !d.closest("[hidden]")).length }));
  check(`questions search: a VISIBLE result count ("${r.visibleCount}") under the field; the screen-reader announcement waits for the typing to stop and says one final count ("${r.announced}", nothing announced mid-typing: "${mid}")`, /questions? match/.test(r.visibleCount) && r.visible && r.announced === r.visibleCount && mid === "", JSON.stringify(r));
  check("questions search: topic headings with no result and the topic chips are hidden while filtering", r.emptyHeads === 0 && r.chipsHidden && r.groups.length > 0 && r.groups.length < PACK.topics.length, JSON.stringify(r.groups));
  await p.fill("[data-aicc-faq-search] input", "zzqxv");
  const clears = await p.evaluate(() => [...document.querySelectorAll("[data-aicc-faq-search] [data-clear]")].filter((b) => !b.hidden && b.getBoundingClientRect().width > 0).length);
  check("questions search: the empty state shows ONE Clear button", clears === 1, String(clears));
  await p.goto(urlFor("en", "questions") + "?q=checkout");
  await p.waitForTimeout(900);
  const q = await p.evaluate(() => { const b = document.querySelector("[data-aicc-faq-search]").getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight, results: [...document.querySelectorAll("#faq-browse details[id^='q']")].filter((d) => !d.closest("[hidden]")).length }; });
  check(`questions search: ?q= scrolls the field and its results into view (field y=${q.top}, ${q.results} results)`, q.top >= 0 && q.top < 400 && q.results > 0, JSON.stringify(q));
  await ctx.close();
}
// 16. Watch demo: the owner-approved master plays in a real dialog (full playback checks live in `npm run test:demo`)
for (const route of ["", "product"]) {
  const [ctx, p] = await fresh({ viewport: { width: 1280, height: 800 } });
  await p.goto(urlFor("en", route));
  await p.waitForSelector("[data-aicc-demo-trigger][data-aicc-ready], [data-aicc-demo-trigger]");
  await p.click("[data-aicc-demo-trigger]");
  await p.waitForSelector("dialog[open]");
  const d = await p.evaluate(() => { const v = document.querySelector("dialog[open] video"); return { text: document.querySelector("dialog[open]").textContent, video: !!v, src: v?.querySelector("source")?.getAttribute("src"), controls: v?.controls, autoplay: v?.autoplay, track: v?.querySelector("track")?.kind, ph: !!document.querySelector("dialog[open] [data-demo-placeholder]") }; });
  check(`watch demo[${route || "home"}]: the dialog holds the approved demo video with controls and a captions track, no placeholder, no autoplay`, d.video && /\/demo\/aicc-demo\.mp4$/.test(d.src || "") && d.controls && !d.autoplay && d.track === "captions" && !d.ph && !/video is coming/.test(d.text), JSON.stringify(d));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({ open: !!document.querySelector("dialog[open]"), trig: document.activeElement?.hasAttribute("data-aicc-demo-trigger") }));
  check(`watch demo[${route || "home"}]: Escape closes it and focus returns to the Watch demo button`, !after.open && after.trig, JSON.stringify(after));
  await ctx.close();
}
// 17. In-page anchors land on their target on a phone (lazy modules above the target used to push it ~800px down after the jump)
for (const [w, h] of [[390, 844], [360, 740]]) {
  for (const [route, links] of [["product", ["#control", "#ask", "#safety"]], ["", ['.aicc-loop__step a[data-aicc-tab="ws-t-control"]', '.aicc-loop__step a[data-aicc-tab="ws-t-insights"]']]]) {
    const [ctx, p] = await fresh({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    await p.goto(urlFor("en", route));
    await p.waitForTimeout(500);
    for (const l of links) {
      await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(250);
      const sel = l.startsWith("#") ? `.aicc-subnav a[href="${l}"]` : l;
      if (route === "product") await p.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "nearest", inline: "center" }), sel);
      await p.tap(sel);
      await p.waitForTimeout(4200);
      const target = l.startsWith("#") ? l : "#workspace";
      const top = await p.evaluate((t) => Math.round(document.querySelector(t).getBoundingClientRect().top), target);
      check(`anchors @${w}: the first tap on ${route || "home"} ${l.startsWith("#") ? l : "loop step " + l.slice(-12)} lands on its section (top ${top}px of ${h})`, top > -40 && top < h * 0.45, String(top));
    }
    await ctx.close();
  }
}
// 18. Ask Reco panel: a labelled sample conversation, real question buttons, no decoy input
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", ""));
  await p.click("#ws-t-ask");
  const a = await p.evaluate(() => ({ label: document.querySelector(".aicc-ask__label")?.textContent.trim(), inputs: document.querySelectorAll(".aicc-ask input, .aicc-ask textarea, .aicc-ask [contenteditable]").length, decoy: !!document.querySelector(".aicc-ask__input"), chips: [...document.querySelectorAll(".aicc-ask button[data-qa]")].map((b) => b.tagName), answer: document.querySelector(".aicc-ask [data-pair]:not([hidden]) .aicc-ask__a")?.textContent }));
  check(`Ask Reco: labelled "Sample conversation", real <button> questions, no input or decoy field`, a.label === "Sample conversation" && a.inputs === 0 && !a.decoy && a.chips.length >= 2 && a.chips.every((t) => t === "BUTTON"), JSON.stringify(a));
  check("Ask Reco: the sample answer keeps the word Optional and ends with the real button label (Go to Order History)", /Optional next step: import up to 24 months/.test(a.answer) && /Go to Order History/.test(a.answer), a.answer);
  await ctx.close();
}
// 19. Demo merchant view: the shopper list is visible beside the rules and updates live; Reco and the observation never promote an excluded product
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-fbt input[type=checkbox]");
  await p.click('button[data-view="merchant"]');
  const before = await p.$eval("[data-now-list]", (e) => e.textContent);
  await p.selectOption('select[data-rule="grinder"]', "pin");
  const afterPin = await p.$eval("[data-now-list]", (e) => e.textContent);
  check(`demo merchant view: "The shopper sees now" updates live next to the rule selects (${before} -> ${afterPin})`, /^Hand grinder/.test(afterPin) && before !== afterPin && /^Paper filters/.test(before), `${before} | ${afterPin}`);
  await p.selectOption('select[data-rule="filters"]', "exclude");
  const ex = await p.evaluate(() => ({ now: document.querySelector("[data-now-list]").textContent, extras: document.querySelector("[data-extras]").textContent }));
  check("demo merchant view: after excluding Paper filters, neither the observation nor the Ask Reco answer mentions it, and both name the strongest partner that is still listed", !/Paper filters/.test(ex.now) && !/Paper filters/.test(ex.extras) && /Hand grinder/.test(ex.extras), JSON.stringify(ex));
  check("demo: the Without/With group stays in place (disabled) in the merchant view and the page opens on the shopper view", await p.evaluate(() => document.querySelectorAll("[data-modes] button").length === 2 && [...document.querySelectorAll("[data-modes] button")].every((b) => b.disabled)));
  const cp = await fresh({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await cp[1].goto(urlFor("en", ""));
  await cp[1].evaluate(() => document.querySelector("#demo").scrollIntoView());
  await cp[1].waitForSelector(".aicc-fbt input[type=checkbox]");
  check("demo: the keyboard hint is not shown on touch devices", await cp[1].evaluate(() => getComputedStyle(document.querySelector(".aicc-fbt__hint[data-kbd]")).display === "none"));
  await cp[0].close();
  // one announcement per tick: the Reco bubble is not a live region
  const one = await p.evaluate(() => !document.querySelector("[data-bubble]").hasAttribute("aria-live"));
  check("demo: ticking announces once (the Reco bubble is not a second live region)", one);
  await ctx.close();
}
// 20. Hero pause control (WCAG 2.2.2)
{
  const [ctx, p] = await fresh({ viewport: { width: 1280, height: 800 } });
  await p.goto(urlFor("en", ""));
  await p.waitForSelector("[data-aicc-pause]");
  const b = await p.evaluate(() => { const r = document.querySelector("[data-aicc-pause]").getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), label: document.querySelector("[data-aicc-pause]").getAttribute("aria-label"), pressed: document.querySelector("[data-aicc-pause]").getAttribute("aria-pressed"), chipsHidden: [...document.querySelectorAll(".aicc-reco-hero__chip")].every((c) => c.getAttribute("aria-hidden") === "true") }; });
  check(`hero: a visible Pause control (${b.w}x${b.h}px, "${b.label}") and the decorative chips are hidden from screen readers`, b.w >= 44 && b.h >= 44 && b.label === "Pause animation" && b.pressed === "false" && b.chipsHidden, JSON.stringify(b));
  await p.click("[data-aicc-pause]");
  await p.waitForTimeout(300);
  const a = await p.evaluate(() => ({ paused: document.querySelector(".aicc-reco-hero video").paused, pressed: document.querySelector("[data-aicc-pause]").getAttribute("aria-pressed"), label: document.querySelector("[data-aicc-pause]").getAttribute("aria-label"), chips: [...new Set([...document.querySelectorAll(".aicc-reco-hero__chip")].map((c) => getComputedStyle(c).animationPlayState))].join() }));
  check(`hero: Pause stops the video and the floating chips and becomes "${a.label}"`, a.paused && a.pressed === "true" && a.label === "Play animation" && a.chips === "paused", JSON.stringify(a));
  await p.click("[data-aicc-pause]");
  check("hero: Play resumes (pressed state clears)", (await p.$eval("[data-aicc-pause]", (e) => e.getAttribute("aria-pressed"))) === "false");
  await ctx.close();
  const [c2, p2] = await fresh({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  await p2.goto(urlFor("en", ""));
  const rm = await p2.evaluate(() => ({ ctrl: getComputedStyle(document.querySelector("[data-aicc-pause]")).display, paused: document.querySelector(".aicc-reco-hero video").paused }));
  check("hero: under reduced motion the video stays paused and the (pointless) control is hidden", rm.ctrl === "none" && rm.paused, JSON.stringify(rm));
  await c2.close();
}
// 21. Keyboard focus is visible in the dark regions (final CTA band, footer): a CSS typo once removed the ring there and no scanner can see it
for (const [route, contrast] of [["", false], ["", true], ["pricing", false], ["product", false], ["questions", false], ["questions", true]]) {
  const [ctx, p] = await fresh({ viewport: { width: 1280, height: 800 } });
  if (contrast) await p.addInitScript(() => localStorage.setItem("aicc_a11y", JSON.stringify({ contrast: "high" })));
  await p.goto(urlFor("en", route));
  const res = await p.evaluate(async () => {
    const els = [...document.querySelectorAll(".aicc-on-dark a[href], .aicc-on-dark button")].filter((e) => !e.closest("[hidden]") && e.getBoundingClientRect().width > 0);
    const bad = [];
    for (const e of els) {
      e.focus({ focusVisible: true });
      await new Promise((r) => requestAnimationFrame(r));
      const c = getComputedStyle(e);
      const ring = (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) || (c.boxShadow && c.boxShadow !== "none");
      if (!ring) bad.push((e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 30));
      e.blur();
    }
    return { n: els.length, bad };
  });
  check(`focus ring in dark regions[${route || "home"}${contrast ? ", enhanced contrast" : ""}]: all ${res.n} links and buttons show a ring when keyboard-focused`, res.n > 5 && res.bad.length === 0, res.bad.join(" | "));
  await ctx.close();
}
// 22. Language suggestion: "Not now" must not drop focus to <body>
{
  const [ctx, p] = await fresh({ viewport: { width: 1280, height: 800 } });
  await p.addInitScript(() => localStorage.setItem("aicc_lang", "he"));
  await p.goto(urlFor("en", ""));
  await p.waitForSelector(".aicc-suggest");
  await p.click(".aicc-suggest button");
  await p.waitForTimeout(300);
  const f = await p.evaluate(() => ({ tag: document.activeElement?.tagName, cls: document.activeElement?.className }));
  check(`language suggestion: "Not now" moves focus to the skip link (${f.tag}.${f.cls})`, f.tag === "A" && /aicc-skip/.test(f.cls), JSON.stringify(f));
  check("language button: no aria-haspopup promising a menu that is a list of links", await p.evaluate(() => !document.querySelector(".aicc-lang__btn").hasAttribute("aria-haspopup")));
  await ctx.close();
}
// 23. Plan finder: errors only for real invalid input, with a support path above 10
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", "pricing"));
  await p.focus("#plan-stores"); await p.keyboard.press("Tab");
  check("plan finder: tabbing through the empty field raises no error", (await p.$$("#plan-stores-error")).length === 0);
  for (const [v, re] of [["11", /More than 10 stores\? Contact support/], ["0", /whole number from 1 to 10/], ["abc", /whole number from 1 to 10/], ["2.5", /whole number from 1 to 10/]]) {
    await p.fill("#plan-stores", v);
    const e = await p.$eval("#plan-stores-error", (x) => x.textContent).catch(() => "");
    check(`plan finder: "${v}" shows "${e}" at once (no blur needed) and marks the field invalid`, re.test(e) && (await p.$eval("#plan-stores", (x) => x.getAttribute("aria-invalid"))) === "true", e);
  }
  await p.fill("#plan-stores", "2");
  check("plan finder: 2 stores suggests Studio", /Studio/.test(await p.$eval("main", (m) => m.textContent)) && (await p.$$("#plan-stores-error")).length === 0);
  await ctx.close();
}
// 24. Tabs: the workspace keeps its height when you switch tabs (wide screens); hidden panels are inert; panels are focusable; secondary buttons have a visible border
{
  const [ctx, p] = await fresh({ viewport: { width: 1280, height: 900 } });
  await p.goto(urlFor("en", ""));
  await p.waitForSelector("[data-aicc-tabs][data-enhanced]");
  await p.waitForTimeout(3500);
  const hs = [];
  for (const t of ["understand", "control", "insights", "ask"]) { await p.click(`#ws-t-${t}`); await p.waitForTimeout(250); hs.push(await p.$eval(".aicc-tabs__stack", (e) => Math.round(e.getBoundingClientRect().height))); }
  check(`tabs: the panel area keeps one height across all four tabs (${hs.join(", ")}px), so nothing below jumps`, new Set(hs).size === 1, hs.join());
  const st = await p.evaluate(() => ({ inert: [...document.querySelectorAll("#workspace [role=tabpanel]")].map((x) => x.inert), ti: [...document.querySelectorAll("#workspace [role=tabpanel]")].map((x) => x.getAttribute("tabindex")) }));
  check("tabs: exactly one panel is interactive (the others are inert) and every panel is focusable (tabindex=0)", st.inert.filter((x) => !x).length === 1 && st.ti.every((x) => x === "0"), JSON.stringify(st));
  const bc = await p.evaluate(() => getComputedStyle(document.querySelector(".aicc-btn--secondary")).borderTopColor);
  check(`secondary buttons have a visible boundary (${bc}, slate-500 = 4.76:1)`, bc === "rgb(100, 116, 139)", bc);
  const tap = await p.evaluate(() => Math.round(document.querySelector(".aicc-connector a").getBoundingClientRect().height));
  check(`"Back to the demo" has a 44px tap area (${tap}px)`, tap >= 44, String(tap));
  await ctx.close();
}
// 25. Product page: the in-page navigation is one sticky bar; the comparison comes before the dashboard; a CTA follows the safety section
{
  const [ctx, p] = await fresh({ viewport: { width: 1280, height: 800 } });
  await p.goto(urlFor("en", "product"));
  const order = await p.$$eval("main section[id], main nav.aicc-subnav", (e) => e.map((x) => x.id || "subnav"));
  const idx = (id) => order.indexOf(id);
  check(`product: order is demo, how it learns, thin history, comparison, dashboard, ... safety, then a CTA band (${order.join(" > ")})`, idx("demo") < idx("how-decided") && idx("how-decided") < idx("sparse") && idx("sparse") < idx("compare") && idx("compare") < idx("dashboard") && idx("dashboard") < idx("control") && idx("safety") < idx("history"), order.join());
  await p.evaluate(() => scrollTo(0, 3000)); await p.waitForTimeout(400);
  const sticky = await p.evaluate(() => { const r = document.querySelector(".aicc-subnav").getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) }; });
  check(`product: the in-page navigation stays visible while reading (sticky at y=${sticky.top}px, ${sticky.h}px tall)`, sticky.top >= 0 && sticky.top < 120 && sticky.h <= 70, JSON.stringify(sticky));
  check("product: a call to action follows the safety section", await p.evaluate(() => { const s = document.getElementById("safety"); return !!s?.nextElementSibling?.querySelector("a[href*='my-account'], a.aicc-btn--primary"); }));
  await ctx.close();
}
// 26. i18n/RTL review fixes
// F2: in Hebrew a Latin run never swallows the sentence-final period ("AA." rendered ". AA"), and "WCAG 2.2" is ONE isolate
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("he", "accessibility"));
  const r = await p.evaluate(() => {
    const bdis = [...document.querySelectorAll("main bdi")];
    const trailing = bdis.filter((b) => /[.,:;!?]$/.test(b.textContent.trim())).map((b) => b.textContent);
    const wcag = bdis.filter((b) => /^WCAG 2\.2$/.test(b.textContent.trim())).length;
    const aa = bdis.find((b) => b.textContent.trim() === "AA");
    const afterAA = aa ? (aa.nextSibling?.textContent || "").slice(0, 1) : "(no AA isolate)";
    return { trailing, wcag, afterAA };
  });
  check(`rtl: no Latin isolate ends in punctuation on /he/accessibility/ (${JSON.stringify(r.trailing)}); "WCAG 2.2" is one isolate (${r.wcag}); the period follows the closing isolate of "AA" (next char "${r.afterAA}")`, r.trailing.length === 0 && r.wcag >= 1 && r.afterAA === ".", JSON.stringify(r));
  for (const route of ["privacy", "data-and-trust", "pricing"]) {
    await p.goto(urlFor("he", route));
    const tr = await p.$$eval("main bdi", (bs) => bs.map((b) => b.textContent.trim()).filter((t) => /[.,:;!?]$/.test(t)));
    check(`rtl: no Latin isolate ends in punctuation on /he/${route}/ (${tr.length})`, tr.length === 0, JSON.stringify(tr));
  }
  await ctx.close();
}
// F13: switching language keeps the FAQ search query and the #anchor
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("es", "questions") + "?q=pago");
  await p.waitForSelector("[data-aicc-lang][data-aicc-ready]");
  await p.click(".aicc-site-header__actions .aicc-lang__btn");
  const hrefs = await p.$$eval(".aicc-site-header__actions .aicc-lang__menu a", (as) => as.map((a) => a.getAttribute("href")));
  check(`language switch keeps the FAQ search query (${hrefs.join(" , ")})`, hrefs.length === 4 && hrefs.every((h) => h.endsWith("/questions/?q=pago")), JSON.stringify(hrefs));
  await p.keyboard.press("Escape");
  await p.fill("[data-aicc-faq-search] input", "plan");
  await p.click(".aicc-site-header__actions .aicc-lang__btn");
  const h1 = await p.$$eval(".aicc-site-header__actions .aicc-lang__menu a", (as) => as.map((a) => a.getAttribute("href")));
  check(`language switch follows the query as it is typed (${h1[0]})`, h1.every((h) => h.endsWith("/questions/?q=plan")), JSON.stringify(h1));
  await p.goto(urlFor("es", "questions") + "#q41");
  await p.waitForSelector("[data-aicc-lang][data-aicc-ready]");
  await p.click(".aicc-site-header__actions .aicc-lang__btn");
  const h0 = await p.$$eval(".aicc-site-header__actions .aicc-lang__menu a", (as) => as.map((a) => a.getAttribute("href")));
  check(`language switch keeps the #anchor of a question (${h0[1]})`, h0.every((h) => h.endsWith("/questions/#q41")), JSON.stringify(h0));
  await p.goto(urlFor("ru", "product") + "#compare");
  await p.waitForSelector("[data-aicc-lang][data-aicc-ready]");
  await p.click(".aicc-site-header__actions .aicc-lang__btn");
  const h2 = await p.$$eval(".aicc-site-header__actions .aicc-lang__menu a", (as) => as.map((a) => a.getAttribute("href")));
  check(`language switch keeps #compare on the Product page (${h2.join(" , ")})`, h2.every((h) => h.endsWith("/product/#compare")), JSON.stringify(h2));
  await ctx.close();
}
// F14: FAQ search: apostrophe variants, stems, accents
{
  const [ctx, p] = await fresh();
  const count = async (loc, q) => { await p.goto(urlFor(loc, "questions") + "?q=" + encodeURIComponent(q)); await p.waitForSelector("[data-aicc-faq-search] input"); await p.waitForTimeout(250); return p.$$eval("#faq-browse details[id^='q']:not([hidden]), details[id^='q']", (ds) => ds.filter((d) => !d.closest("[hidden]")).length); };
  const he1 = await count("he", "וידג׳ט"); const he2 = await count("he", "וידג'ט");
  check(`faq search[he]: an ASCII apostrophe finds what the geresh finds ("וידג'ט" ${he2} vs "וידג׳ט" ${he1})`, he1 > 0 && he2 === he1, `${he1} ${he2}`);
  const ru1 = await count("ru", "лицензия");
  check(`faq search[ru]: "лицензия" finds "лицензионный" through the stem fallback (${ru1} questions)`, ru1 > 0, String(ru1));
  const ru2 = await count("ru", "продлить");
  check(`faq search[ru]: "продлить" finds "продление" (${ru2} questions)`, ru2 > 0, String(ru2));
  const es1 = await count("es", "politica"); const es2 = await count("es", "política");
  check(`faq search[es]: accent-insensitive ("politica" ${es1} = "política" ${es2})`, es1 > 0 && es1 === es2, `${es1} ${es2}`);
  const en0 = await count("en", "zzzzqqqq");
  check("faq search: a query that matches nothing, even by stem, still shows the empty state", en0 === 0, String(en0));
  await ctx.close();
}
// F7: reflow at 320px + Larger text: no horizontal overflow on any page in any language; hidden table headers never break a word
{
  const PAGES = ["", "product", "pricing", "questions", "data-and-trust", "privacy", "terms", "refund-policy", "accessibility"];
  const bad = [];
  for (const loc of ["en", "he", "es", "ru"]) for (const route of PAGES) {
    const [ctx, p] = await fresh({ viewport: { width: 320, height: 800 }, reducedMotion: "reduce" });
    await p.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "1"); } catch {} });
    await p.goto(urlFor(loc, route));
    await p.evaluate(() => { document.documentElement.setAttribute("data-aicc-text", "large"); document.querySelectorAll("details").forEach((d) => (d.open = true)); });
    await p.waitForTimeout(250);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (sw > 0) bad.push(`${loc}/${route || "home"} +${sw}px`);
    await ctx.close();
  }
  check(`reflow: no horizontal overflow at 320px with Larger text on ${PAGES.length} pages x 4 languages${bad.length ? " (" + bad.join(", ") + ")" : ""}`, bad.length === 0, bad.join(", "));
  const [ctx, p] = await fresh({ viewport: { width: 390, height: 800 } });
  await p.goto(urlFor("en", "product"));
  const th = await p.$$eval("#compare thead th", (ts) => ts.map((t) => getComputedStyle(t).whiteSpace));
  check(`table: the visually hidden header cells on phones do not wrap, so no word breaks mid-way (${th.join(",")})`, th.length === 3 && th.every((w) => w === "nowrap"), th.join());
  await ctx.close();
}
// F15: an English admin label never leaves the punctuation that follows it alone at the start of a new line (es, ru; measured line by line at 390 and 320)
{
  const bad = [];
  let seen = 0;
  for (const loc of ["es", "ru"]) for (const w of [390, 320]) for (const route of ["", "product"]) {
    const [ctx, p] = await fresh({ viewport: { width: w, height: 800 } });
    await p.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "1"); } catch {} });
    await p.goto(urlFor(loc, route));
    await p.evaluate(async () => { document.querySelectorAll("details").forEach((d) => (d.open = true)); document.querySelector("#demo")?.scrollIntoView(); await new Promise((r) => setTimeout(r, 800)); document.querySelector(".aicc-fbt__view:not([aria-pressed=true])")?.click(); for (const t of document.querySelectorAll('[role="tab"]')) { t.click(); await new Promise((r) => setTimeout(r, 200)); } });
    await p.waitForTimeout(600);
    const r = await p.evaluate(() => {
      const bad = []; let seen = 0;
      for (const l of document.querySelectorAll(".aicc-admin-label")) {
        if (!l.getClientRects().length) continue;
        const n = l.nextSibling;
        if (!(n && n.nodeType === 3 && /^[,.;:!?)»”]/.test(n.textContent))) continue;
        seen++;
        const rg = document.createRange(); rg.setStart(n, 0); rg.setEnd(n, 1);
        const pr = rg.getClientRects()[0]; const lr = [...l.getClientRects()].pop();
        if (pr && lr && pr.top > lr.bottom - 3) bad.push(l.textContent + "|" + n.textContent.slice(0, 8));
      }
      return { bad, seen };
    });
    seen += r.seen;
    if (r.bad.length) bad.push(`${loc}@${w}/${route || "home"}: ${r.bad.slice(0, 3).join("; ")}`);
    await ctx.close();
  }
  check(`labels: no punctuation is orphaned at the start of a line after an English label in es/ru (${seen} label+punctuation pairs measured)${bad.length ? " " + bad.join(" / ") : ""}`, bad.length === 0, bad.join(" / "));
}
// F18: Russian prices in one sentence say "(USD)" once
{
  const [ctx, p] = await fresh();
  const counts = [];
  for (const route of ["", "pricing"]) { await p.goto(urlFor("ru", route)); counts.push(await p.evaluate(() => (document.querySelector('meta[name="description"]')?.content.match(/\(USD\)/g) || []).length)); }
  check(`ru meta descriptions state "(USD)" at most once (${counts.join(", ")})`, counts.every((c) => c <= 1), counts.join());
  await ctx.close();
}
// 27. Final merchant review: phone demo cue, Escape on the mobile menu, scroll cue on the Product strip, FAQ synonyms
{
  const [ctx, p] = await fresh({ viewport: { width: 390, height: 844 } });
  await p.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "1"); } catch {} });
  await p.goto(urlFor("en", ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-fbt input[type=checkbox]", { state: "attached", timeout: 8000 });
  await p.waitForTimeout(600);
  const before = await p.$eval("[data-why-inline]", (e) => e.textContent.trim());
  const second = (await p.$$(".aicc-fbt input[type=checkbox]"))[1];
  await second.evaluate((e) => e.closest("li, label, div").scrollIntoView({ block: "center" }));
  await second.check({ force: true });
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const box = document.querySelector(".aicc-fbt__whyinline"), txt = box.querySelector("[data-why-inline]");
    const cards = [...document.querySelectorAll(".aicc-fbt [data-bundle] .aicc-fbt-card")], last = cards[cards.length - 1].getBoundingClientRect();
    const total = document.querySelector(".aicc-fbt__foot").getBoundingClientRect(), c = box.getBoundingClientRect();
    const pos = getComputedStyle(box).position;
    return { text: txt.textContent.trim(), head: box.querySelector("h3").textContent.trim(), shown: getComputedStyle(box).display !== "none", pos, gap: Math.round(c.top - last.bottom), belowTotal: Math.round(total.top - c.bottom), fromBox: Math.round(c.top - document.querySelectorAll(".aicc-fbt input[type=checkbox]")[1].getBoundingClientRect().bottom), reco: /^Reco/.test(txt.textContent.trim()), cue: !!document.querySelector("[data-cue]") };
  });
  check(`phone demo: a neutral caption ("${r.head}") is docked IN FLOW right under the product list (position ${r.pos}, ${r.gap}px below the last card, ${r.belowTotal}px above the total, ${r.fromBox}px from the ticked box) and changes on a tap ("${before.slice(0, 24)}" -> "${r.text.slice(0, 40)}"), with no overlay and no Reco voice`, r.shown && r.text && r.text !== before && r.pos === "static" && r.gap >= 0 && r.gap < 60 && r.belowTotal >= 0 && r.fromBox >= 0 && r.fromBox < 420 && !r.reco && !r.cue && r.head === "Why this product (illustration)", JSON.stringify(r));
  await p.goto(urlFor("en", ""));
  await p.waitForSelector("[data-aicc-header][data-aicc-ready]");
  await p.click("[data-aicc-menu-btn]");
  await p.keyboard.press("Tab");
  await p.keyboard.press("Escape");
  const m = await p.evaluate(() => ({ expanded: document.querySelector("[data-aicc-menu-btn]").getAttribute("aria-expanded"), hidden: document.querySelector("[data-aicc-menu-panel]").hidden, onBtn: document.activeElement === document.querySelector("[data-aicc-menu-btn]") }));
  check("mobile menu: Escape closes it and returns focus to the menu button", m.expanded === "false" && m.hidden && m.onBtn, JSON.stringify(m));
  await p.goto(urlFor("en", "product"));
  const sn = await p.$eval(".aicc-subnav ul", (u) => ({ overflow: u.scrollWidth > u.clientWidth, bg: getComputedStyle(u).backgroundImage, att: getComputedStyle(u).backgroundAttachment }));
  check(`product in-page strip: it overflows at 390px and carries an edge-fade scroll cue (local covers + scroll shadows: ${sn.att})`, sn.overflow && (sn.bg.match(/gradient/g) || []).length === 4 && /local/.test(sn.att) && /scroll/.test(sn.att), JSON.stringify(sn));
  await p.goto(urlFor("en", "product"));
  await ctx.close();
}
{
  const [ctx, p] = await fresh();
  const has = async (q, id) => { await p.goto(urlFor("en", "questions") + "?q=" + encodeURIComponent(q)); await p.waitForSelector("[data-aicc-faq-search] input"); await p.waitForTimeout(250); return p.evaluate((i) => { const d = document.getElementById(i); return !!d && !d.closest("[hidden]"); }, id); };
  check("faq: 'small store', 'minimum' and 'volume' find 'How many orders does AICC need?' (q59); 'uninstall' finds q40", (await has("small store", "q59")) && (await has("minimum", "q59")) && (await has("volume", "q59")) && (await has("uninstall", "q40")));
  await p.goto(urlFor("en", ""));
  const ids = await p.$$eval("details[id^='q']", (d) => d.map((x) => x.id));
  check(`faq: q59 is on the Home page and q51 is not (${ids.join(",")})`, ids.includes("q59") && !ids.includes("q51"), ids.join());
  await ctx.close();
}
// 28. Positioning v3: quiet accessibility control, outcome-led hero, pillars strip, renamed demo section
for (const w of [1280, 390, 320]) {
  const [ctx, p] = await fresh({ viewport: { width: w, height: 800 } });
  await p.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "1"); } catch {} });
  await p.goto(urlFor("en", ""));
  const a = await p.$eval(".aicc-site-header__bar .aicc-a11y-trigger", (e) => { const r = e.getBoundingClientRect(); return { name: e.getAttribute("aria-label"), w: Math.round(r.width), h: Math.round(r.height), text: e.textContent.trim(), vis: r.width > 0 && getComputedStyle(e).visibility !== "hidden" }; });
  const fit = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check(`a11y trigger @${w}: a small icon button in the header bar named "Accessibility settings", ${a.w}x${a.h}px target, no label text, header fits`, a.name === "Accessibility settings" && a.vis && a.w >= 44 && a.h >= 44 && a.text === "" && fit, JSON.stringify(a));
  if (w === 390) {
    await p.click(".aicc-a11y-trigger");
    check("a11y trigger @390: opens the settings dialog from the header bar (no need to open the menu)", await p.evaluate(() => !!document.querySelector("dialog[open]")));
  }
  await ctx.close();
}
{
  const [ctx, p] = await fresh({ viewport: { width: 1280, height: 800 } });
  await p.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "1"); } catch {} });
  await p.goto(urlFor("en", ""));
  const h = await p.evaluate(() => ({
    eyebrow: document.querySelector(".aicc-eyebrow-pill")?.textContent.trim(), h1: document.querySelector("h1")?.textContent.replace(/\s+/g, " ").trim(),
    paras: document.querySelectorAll(".aicc-hero__copy > p").length, lead: document.querySelector(".aicc-hero-lead")?.textContent.trim(),
    ctas: [...document.querySelectorAll(".aicc-hero .aicc-hero-actions > *")].map((e) => e.textContent.trim()),
    category: document.querySelector(".aicc-hero__category")?.textContent.trim(),
    conf: [...document.querySelectorAll(".aicc-hero__confidence li")].map((e) => e.textContent.trim()),
    order: [...document.querySelectorAll(".aicc-hero__copy > *")].map((e) => e.className.split(" ")[0]),
    strip: [...document.querySelectorAll(".aicc-pillars__title")].map((e) => e.textContent.trim()),
    stripLinks: [...document.querySelectorAll(".aicc-pillars__link")].map((e) => e.getAttribute("href")),
    demoTitle: document.querySelector("#demo-title")?.textContent.replace(/\s+/g, " ").trim(),
    stripBeforeDemo: !!(document.querySelector(".aicc-pillars")?.compareDocumentPosition(document.querySelector("#demo")) & Node.DOCUMENT_POSITION_FOLLOWING),
    heroBottom: Math.round(document.querySelector(".aicc-hero").getBoundingClientRect().bottom),
    words: document.querySelector(".aicc-hero__copy").textContent.trim().split(/\s+/).length,
  }));
  check(`hero: category cue and "Available for WooCommerce", the approved H1, ONE sentence, the two approved CTAs, nothing else competing, in that order (${h.words} words in the copy column)`,
    h.eyebrow?.toLowerCase() === "available for woocommerce" && h.h1 === "Turn every shopper journey into a smarter selling opportunity." && h.paras === 1 && h.lead === "AI Commerce Copilot turns your store data into relevant recommendations and smarter merchandising \u2014 helping shoppers discover more while you manage less and stay in control." &&
    h.ctas.join("|") === "See it in action|View plans" && h.category === "Commerce recommendation and merchandising copilot" && h.conf.length === 0 && h.words <= 60 &&
    h.order.join(",") === "aicc-hero__kicker,aicc-hero-title,aicc-hero-lead,aicc-hero-actions", JSON.stringify(h));
  check(`pillars strip: three pillars with one line each and anchor links, right after the hero and before the demo (${h.strip.join(" / ")}; ${h.stripLinks.join(" ")})`, h.strip.length === 3 && h.stripLinks.join() === "#demo,#workspace,#demo" && h.stripBeforeDemo);
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView()); await p.waitForSelector(".aicc-fbt input[type=checkbox]", { state: "attached", timeout: 8000 });
  check(`demo section: titled "See what each recommendation is based on." (not the Frequently Bought Together category line); the widget inside keeps its own heading`, h.demoTitle === "See what each recommendation is based on." && /Frequently Bought Together/.test(await p.evaluate(() => document.querySelector(".aicc-fbt")?.textContent || "")), h.demoTitle);
  check("hero: nothing about Frequently Bought Together in the eyebrow, headline or hero sentence", !/frequently[- ]bought/i.test(`${h.eyebrow} ${h.h1} ${h.lead}`));
  const tabbed = await p.evaluate(async () => { document.querySelector('.aicc-pillars__link[data-aicc-tab="ws-t-control"]')?.click(); await new Promise((r) => setTimeout(r, 600)); return document.getElementById("ws-t-control")?.getAttribute("aria-selected"); });
  check("pillars strip: the second pillar link opens the Control tab of the workspace", tabbed === "true", String(tabbed));
  await ctx.close();
}
// 29. The aha: the same sample relationship from the shopper's side and the merchant's side, with the evidence layer
{
  const [ctx, p] = await fresh({ viewport: { width: 1280, height: 900 } });
  await p.addInitScript(() => { try { localStorage.setItem("aicc_lang_dismissed", "1"); } catch {} });
  await p.goto(urlFor("en", ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-fbt input[type=checkbox]", { state: "attached", timeout: 8000 });
  await p.waitForTimeout(500);
  const boxes = await p.$$(".aicc-fbt input[type=checkbox]");
  await boxes[2].check({ force: true }); // the second recommendation (hand grinder)
  await p.click('.aicc-fbt button[data-view="merchant"]');
  await p.waitForTimeout(400);
  const m = await p.evaluate(() => ({
    heading: document.querySelector(".aicc-fbt__evidence")?.textContent.replace(/\s+/g, " ").trim(),
    colWhy: document.querySelector('.aicc-fbt__rowhead [role="columnheader"]:nth-child(2)')?.textContent.trim(),
    ticked: [...document.querySelectorAll('.aicc-fbt-row[data-ticked="true"]')].map((r) => r.dataset.id + ":" + r.querySelector(".aicc-fbt-row__ticked")?.textContent.trim()),
    whys: [...document.querySelectorAll(".aicc-fbt-row__why")].map((e) => e.textContent.trim()),
  }));
  check(`merchant view: the evidence layer is labelled an illustration and lists the order (bought together, then relevant catalog products when history is thin, newest, then your rules); the product the shopper ticked is marked here too (${m.ticked.join(",")})`,
    /How the list is built \(illustration\)/.test(m.heading) && /bought together in your orders first\. When history is thin, it fills the remaining spots with relevant in-stock products from your catalog.*Your rules apply last/.test(m.heading) && /a pinned product shows only a price/.test(m.heading) && /^Basis \(illustration\)$/.test(m.colWhy) && m.ticked.join() === "grinder:Ticked in the shopper view" && m.whys.some((w) => /^Bought together \d+ times$/.test(w)), JSON.stringify(m));
  check(`merchant view: the sample list shows ALL kinds of evidence the real ranking uses, including a real "newest in stock" fallback row (${m.whys.join(" | ")})`, m.whys.filter((w) => /^Bought together \d+ times$/.test(w)).length === 2 && m.whys.some((w) => /filled in from your catalog/.test(w)) && m.whys.some((w) => /newest in-stock/.test(w)), JSON.stringify(m.whys));
  const tiles = await p.evaluate(() => [...document.querySelectorAll(".aicc-fbt-tile strong")].map((e) => e.textContent.trim()));
  check(`merchant view: the sample dashboard numbers are the dashboard replica's numbers (${tiles.join(" / ")}), so the two samples never contradict each other`, tiles.join() === "3,860,241,97", tiles.join());
  await p.selectOption('select[data-rule="mug"]', "deprioritize");
  await p.waitForTimeout(200);
  const depri = await p.$eval('.aicc-fbt-row[data-id="mug"] .aicc-fbt-row__byrule', (e) => e.textContent.trim());
  check(`merchant view: the deprioritize chip names the rule, not a move ("${depri}", it can stay in place)`, depri === "Deprioritized by you", depri);
  await p.selectOption('select[data-rule="mug"]', "none");
  const ask = await p.evaluate(() => ({ q: document.querySelector(".aicc-fbt__aq")?.textContent.trim(), label: document.querySelector(".aicc-fbt__aa span")?.textContent.trim(), reco: document.querySelector(".aicc-fbt__why [data-bubble]")?.textContent.trim() }));
  check(`merchant view: the Ask Reco line uses a real starter question and a "Sample answer" label (${ask.q})`, ask.q === "What is my biggest opportunity?" && ask.label === "Sample answer", JSON.stringify(ask));
  await p.selectOption('select[data-rule="filters"]', "pin");
  await p.waitForTimeout(300);
  const pinned = await p.$eval('.aicc-fbt-row[data-id="filters"] .aicc-fbt-row__why', (e) => e.textContent.trim());
  check(`merchant view: a rule is evidence too ("${pinned}")`, /Bought together \d+ times\s*Pinned by you$/.test(pinned.replace(/\s+/g, " ")) || /Pinned by you/.test(pinned), pinned);
  const counts = await p.evaluate(() => [...document.querySelectorAll(".aicc-fbt-row__why")].map((e) => (e.textContent.match(/Bought together (\d+) times/) || [])[1]).filter(Boolean).map(Number));
  check(`demo sample counts look like a small merchant's (${counts.join(", ")}) and avoid the Russian "few" plural forms`, counts.length >= 2 && counts.every((n) => n >= 3 && n <= 12 && ![2, 3, 4, 22, 23, 24].includes(n % 100)), counts.join());
  await ctx.close();
}
// 30. Ask Reco mock: a guided assistant, not a chat box
{
  const [ctx, p] = await fresh({ viewport: { width: 1280, height: 900 } });
  await p.goto(urlFor("en", "product"));
  const a = await p.evaluate(() => ({ inputs: document.querySelectorAll(".aicc-ask input, .aicc-ask textarea").length, label: document.querySelector(".aicc-ask__try")?.textContent.trim(), chips: [...document.querySelectorAll(".aicc-ask__chip")].map((c) => c.textContent.trim()) }));
  check(`Ask Reco mock: no text input, "Choose a question for Reco", exactly the real starter questions of a set-up store (${a.chips.join(" / ")})`, a.inputs === 0 && a.label === "Choose a question for Reco" && a.chips.join("|") === "What should I focus on today?|What is my biggest opportunity?|Give me one quick win.|What can you help me with?", JSON.stringify(a));
  const ans = await p.evaluate(async () => {
    const out = [];
    for (const c of document.querySelectorAll(".aicc-ask__chip")) { c.click(); await new Promise((r) => setTimeout(r, 50)); const pair = document.querySelector(".aicc-ask__pair:not([hidden])"); out.push({ q: c.textContent.trim(), shown: pair?.querySelector(".aicc-ask__q")?.textContent.trim(), who: pair?.querySelector(".aicc-ask__who")?.textContent.trim(), a: pair?.querySelector(".aicc-ask__a p")?.textContent.length > 40, pressed: c.getAttribute("aria-pressed") }); }
    return { out, foot: document.querySelector(".aicc-ask__foot")?.textContent || "" };
  });
  check(`Ask Reco mock: each question swaps in its answer, every answer is labelled "Sample answer", and the footnote says the real panel also has a text box`, ans.out.every((o) => o.q === o.shown && o.who === "Sample answer" && o.a && o.pressed === "true") && /type a short question/.test(ans.foot), JSON.stringify(ans));
  await ctx.close();
}
// 31. Header contract (shared with the Control Plane): same labels, same order, same targets in all four languages, desktop bar and mobile panel.
//     brand/content/header-nav.json (paths) + brand/i18n/strings.json header block (labels). The Control Plane test holds ITS header to the same two files.
{
  const NAV = JSON.parse(fs.readFileSync(new URL("../brand/content/header-nav.json", import.meta.url), "utf8"));
  const STR = JSON.parse(fs.readFileSync(new URL("../brand/i18n/strings.json", import.meta.url), "utf8"));
  const pref = (l) => (l === "en" ? "" : `/${l}`);
  const [ctx, p] = await fresh({ viewport: { width: 1280, height: 900 } });
  for (const l of ["en", "he", "es", "ru"]) {
    const H = STR[l].header;
    await p.goto(urlFor(l, ""));
    const dom = await p.evaluate(() => {
      const t = (e) => e.textContent.replace(/\s+/g, " ").trim();
      const path = (e) => new URL(e.href).pathname;
      return {
        nav: [...document.querySelectorAll(".aicc-site-header__nav .aicc-site-header__links a")].map((a) => [t(a), path(a)]),
        panel: [...document.querySelectorAll(".aicc-site-header__panel nav a")].map((a) => [t(a), path(a)]),
        actions: [...document.querySelectorAll(".aicc-site-header__actions > a.aicc-btn")].map((a) => [t(a), path(a)]),
        panelActions: [...document.querySelectorAll(".aicc-site-header__panel-inner > a.aicc-btn")].map((a) => [t(a), path(a)]),
      };
    });
    const wantNav = NAV.nav.map((n) => [(n.id === "account" ? H.nav.account : H.nav[n.id]).replace(/\s+/g, " ").trim(), pref(l) + n.path]);
    const wantAct = NAV.actions.map((a) => [H[a.id].replace(/\s+/g, " ").trim(), pref(l) + a.path]);
    // The nav links of the site are relative to the base path (PREFIX); the account links are absolute on the commerce host (no base path).
    const strip = (rows) => rows.map(([a, b]) => [a, b.startsWith(PREFIX + "/") && PREFIX ? b.slice(PREFIX.length) : b]);
    check(`header contract (${l}): nav = ${wantNav.map((r) => r[0]).join(" | ")} with the contract targets, in order`, JSON.stringify(strip(dom.nav)) === JSON.stringify(wantNav), JSON.stringify([strip(dom.nav), wantNav]));
    check(`header contract (${l}): the mobile panel nav has the same links as the bar`, JSON.stringify(dom.panel) === JSON.stringify(dom.nav), JSON.stringify([dom.panel, dom.nav]));
    const dpa = await p.$$eval("footer a[href*='data-processing-addendum']", (as) => as.map((a) => [a.textContent.trim(), new URL(a.href).pathname, new URL(a.href).origin]));
    check(`footer (${l}): one Data Processing Addendum link, labelled "${DICTS[l].common.pageNames.dpa}", to ${pref(l)}/data-processing-addendum/ (WordPress-owned, same host as the sitemap entry)`, dpa.length === 1 && dpa[0][0] === DICTS[l].common.pageNames.dpa && dpa[0][1] === `${pref(l)}/data-processing-addendum/` && dpa[0][2] === "https://www.copilt.org", JSON.stringify(dpa));
    const norm = (x) => x.replace(/\s+/g, " ").trim();
    const ftr = await p.evaluate(() => [...document.querySelectorAll("footer nav[aria-labelledby]")].map((n) => ({ h: n.querySelector("h2").textContent, links: [...n.querySelectorAll("li a")].map((a) => [a.textContent, new URL(a.href).pathname]) })));
    const ftrWant = NAV.footer.columns.map((c) => ({ h: norm(STR[l].footer[c.heading]), links: c.links.map((x) => [norm(STR[l].footer.links[x.id]), pref(l) + x.path]) }));
    const ftrGot = ftr.map((c) => ({ h: norm(c.h), links: c.links.map(([t, pth]) => [norm(t), PREFIX && pth.startsWith(PREFIX + "/") ? pth.slice(PREFIX.length) : pth]) }));
    check(`footer contract (${l}): two columns "${ftrWant.map((c) => c.h).join('" and "')}" with the contract labels, order and targets`, JSON.stringify(ftrGot) === JSON.stringify(ftrWant), JSON.stringify([ftrGot, ftrWant]));
    check(`header contract (${l}): Sign in and Get started go to ${pref(l)}/my-account/ (language prefix kept), in the bar and in the panel`, JSON.stringify(dom.actions) === JSON.stringify(wantAct) && JSON.stringify(dom.panelActions) === JSON.stringify(wantAct), JSON.stringify([dom.actions, dom.panelActions, wantAct]));
  }
  // Every account link on every page of every language carries the page language; plan buttons add ?plan=.
  for (const l of ["en", "he", "es", "ru"]) {
    const bad = [];
    let n = 0, plans = [];
    for (const r of ROUTES_ALL) {
      await p.goto(urlFor(l, r));
      const links = await p.$$eval("a[href*='my-account']", (as) => as.map((a) => { const u = new URL(a.href); return [u.pathname, u.search, a.closest("article.aicc-plan") ? a.closest("article.aicc-plan").getAttribute("aria-labelledby") : "", a.closest("form") ? "finder" : ""]; }));
      for (const [path, search, plan, finder] of links) {
        n++;
        if (path !== `${pref(l)}/my-account/`) bad.push(`${r || "home"}: ${path}${search}`);
        if (plan || finder) { plans.push(search); if (!/^\?plan=(solo|studio|agency)$/.test(search)) bad.push(`${r || "home"}: plan button ${path}${search}`); } else if (search) bad.push(`${r || "home"}: unexpected query ${path}${search}`);
      }
    }
    check(`account links (${l}): all ${n} links go to ${pref(l)}/my-account/ (plan buttons with ?plan=solo|studio|agency: ${plans.length})`, n >= 20 && bad.length === 0 && plans.length >= 3, bad.slice(0, 5).join("; "));
  }
  await ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\ninteraction tests: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
