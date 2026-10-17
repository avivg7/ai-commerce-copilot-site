// npm run test:interaction: keyboard-only walks through the language switcher, accessibility control, mobile menu,
// FAQ accordion and the demo, plus reduced-motion behaviour and the language-persistence rules. Needs the export served.
import fs from "node:fs";
import { launch, urlFor, BASE } from "./lib/browser.mjs";

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
  const found = await tabTo(p, () => document.activeElement?.classList.contains("aicc-site-header__desktop-only"));
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
  check("a11y control: Esc closes and focus returns to the trigger", await p.evaluate(() => !document.querySelector("dialog[open]") && document.activeElement?.classList.contains("aicc-site-header__desktop-only")));
  await p.reload();
  const persisted = await p.evaluate(() => document.documentElement.getAttribute("data-aicc-motion") + "," + document.documentElement.getAttribute("data-aicc-contrast") + "," + document.documentElement.getAttribute("data-aicc-text"));
  check("a11y control: settings persist across reload", persisted === "reduce,high,large", persisted);
  const html = await (await fetch(urlFor("en", ""))).text();
  const headEnd = html.indexOf("</head>");
  check("a11y control: preference script runs in <head> (applied before first paint)", html.indexOf("aicc_a11y") > 0 && html.indexOf("aicc_a11y") < headEnd);
  await p.click(".aicc-site-header__desktop-only.aicc-iconbtn"); await p.click("dialog[open] .aicc-btn--quiet");
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
  check("questions: order is Most asked before buying, then search, then Browse questions by topic", order.indexOf("Most asked before buying") === 0 && order.indexOf("Browse questions by topic") > order.indexOf("Find an answer"), order.join(" | "));
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
  check(`fallback[${loc}]: kit demo, rules, dashboard preview, Ask Reco and flow diagrams are marked lang=en (${JSON.stringify(kit)})`, kit.demo === "en/ltr" && kit.rules === "en/ltr" && kit.dash === "en" && kit.ask === "en" && kit.flow === "en", JSON.stringify(kit));
  await ctx.close();
}

// 5. Demo
for (const loc of ["en", "he"]) {
  const [ctx, p] = await fresh();
  await p.goto(urlFor(loc, ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-fbt input[type=checkbox]", { timeout: 5000 });
  const boxes = await p.$$(".aicc-fbt input[type=checkbox]");
  check(`demo[${loc}]: at least 3 product cards with real checkboxes`, boxes.length >= 4);
  check(`demo[${loc}]: opens on "Without AICC" with the nudge line`, (await p.$eval(".aicc-fbt", (e) => e.dataset.mode)) === "without" && !!(await p.$(".aicc-fbt__nudge")));
  check(`demo[${loc}]: exactly one status region inside the demo (summary), no aria-live on the rationale`, (await p.$$eval(".aicc-fbt [role=status]", (e) => e.length)) === 1 && !(await p.$(".aicc-fbt__why p:not(.aicc-fbt__bubble)[aria-live]")));
  check(`demo[${loc}]: labelled "Illustrative demo" and no store data`, await p.evaluate(() => !!document.querySelector(".aicc-fbt__label") && !/%|revenue|conversion/i.test(document.querySelector(".aicc-fbt").textContent)));
  const total = () => p.$eval(".aicc-fbt__total strong", (e) => e.textContent.trim());
  const t0 = await total();
  await boxes[2].focus(); await p.keyboard.press("Space");
  await p.waitForTimeout(500);
  const t1 = await total();
  check(`demo[${loc}]: Space ticks a product and the bundle total updates (${t0} -> ${t1})`, t0 !== t1 && (await boxes[2].isChecked()));
  await boxes[0].focus();
  // The Hebrew demo is an English fallback (lang=en dir=ltr), so arrows follow ITS direction, not the page's.
  const dirNow = await p.$eval(".aicc-fbt", (e) => getComputedStyle(e).direction);
  const nextKey = dirNow === "rtl" ? "ArrowLeft" : "ArrowRight";
  await p.keyboard.press(nextKey);
  check(`demo[${loc}]: ${nextKey} moves to the next product (follows the demo's own reading direction: ${dirNow})`, await p.evaluate(() => document.activeElement === document.querySelectorAll(".aicc-fbt input[type=checkbox]")[1]));
  await p.keyboard.press("ArrowDown");
  check(`demo[${loc}]: ArrowDown moves on`, await p.evaluate(() => document.activeElement === document.querySelectorAll(".aicc-fbt input[type=checkbox]")[2]));
  const why1 = await p.$eval(".aicc-fbt__why p:not(.aicc-fbt__bubble)", (e) => e.textContent);
  await p.click(".aicc-fbt__mode[aria-pressed=false]");
  const mode = await p.$eval(".aicc-fbt", (e) => e.dataset.mode);
  const why2 = await p.$eval(".aicc-fbt__why p:not(.aicc-fbt__bubble)", (e) => e.textContent);
  check(`demo[${loc}]: starts on Without AICC, the toggle switches to With AICC and the rationale changes (${mode})`, mode === "with" && why1 !== why2);
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
  const fits = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll(".aicc-fbt *")].every((e) => e.getBoundingClientRect().right <= innerWidth + 1));
  check(`demo[${loc}] @360: fits without horizontal scroll`, fits);
  const boxes = await p.$$(".aicc-fbt input[type=checkbox]");
  await boxes[3].focus(); await p.keyboard.press("Space");
  await p.waitForTimeout(40);
  const t = await p.$eval(".aicc-fbt__total strong", (e) => e.textContent.trim());
  check(`demo[${loc}] @360 reduced motion: total updates immediately without counting animation (${t})`, t === "$62", t);
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
  check(`demo: data-aicc-motion="reduce" disables counters (${t})`, t === "$62", t);
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
  check("home has no draft pills and no pending lines; hero says the new headline", await p.evaluate(() => !document.querySelector("[data-legal-draft]") && !document.querySelector("[data-pending]") && /buy together\./.test(document.querySelector("h1").textContent) && !/actually/.test(document.querySelector("h1").textContent)));
  await p.goto(urlFor("en", "pricing"));
  check("pricing: no draft pill on marketing content; one muted pending line pattern absent here", await p.evaluate(() => !document.querySelector("[data-legal-draft]")));
  const tops = await p.$$eval(".aicc-plan__amount", (e) => e.map((x) => Math.round(x.getBoundingClientRect().top)));
  check(`pricing: the three prices align (badge row reserved): ${tops.join(",")}`, tops.length === 3 && new Set(tops).size === 1);
  const btn = await p.$$eval(".aicc-plan .aicc-btn", (e) => e.map((x) => x.classList.contains("aicc-btn--primary")));
  check("pricing: only Studio's button uses the action gradient", btn.join() === "false,true,false");
  await p.goto(urlFor("en", "privacy"));
  check("privacy: draft notices and exactly the muted pending lines are visible on the legal page", await p.evaluate(() => document.querySelectorAll("[data-legal-draft]").length > 3 && document.querySelectorAll("[data-pending]").length > 0 && !/\[.*pending.*\]/.test(document.querySelector("main").textContent)));
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
  const m = await p.evaluate(() => ({ pressed: document.querySelector('button[data-view="merchant"]').getAttribute("aria-pressed"), shopperHidden: document.querySelector('[data-panel="shopper"]').hidden, merchantShown: !document.querySelector('[data-panel="merchant"]').hidden, modes: document.querySelector("[data-modes]").hidden, sample: /Sample data: not from a real store/.test(document.querySelector(".aicc-fbt").textContent), rows: [...document.querySelectorAll(".aicc-fbt-row[data-id]")].map((r) => r.dataset.id + ":" + r.querySelector(".aicc-fbt-row__why").textContent.trim()) }));
  check("view toggle: Enter switches to the merchant view (aria-pressed, panels, Without/With hidden)", m.pressed === "true" && m.shopperHidden && m.merchantShown && m.modes, JSON.stringify(m));
  check("merchant view: counts say \"Bought together N times\" and the fallback says \"Same category — no purchase history yet\" (no tiers)", m.rows.some((r) => /^filters:Bought together 48 times/.test(r)) && m.rows.some((r) => /^mug:Same category — no purchase history yet/.test(r)) && !m.rows.some((r) => /strong|medium|light/i.test(r)), m.rows.join(" | "));
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
  await p.selectOption('select[data-rule="kettle"]', "exclude");
  const ex = await p.evaluate(() => ({ shown: [...document.querySelectorAll(".aicc-fbt-row[data-id]:not([data-hidden])")].map((r) => r.dataset.id), hidden: [...document.querySelectorAll(".aicc-fbt-row[data-hidden]")].map((r) => r.dataset.id), live: document.querySelector("[data-announce]").textContent }));
  check("merchant view: Exclude removes the product from the list; the change is announced in the one status region", !ex.shown.includes("kettle") && ex.hidden.includes("kettle") && /kettle/i.test(ex.live), JSON.stringify(ex));
  await p.click('button[data-view="shopper"]'); await p.click('button[data-mode="with"]');
  const shopperNames = await p.$$eval(".aicc-fbt-card__name", (e) => e.map((x) => x.textContent.trim()));
  check("shopper view reflects the rules (grinder first, kettle gone)", /grinder/i.test(shopperNames[1]) && !shopperNames.some((n) => /kettle/i.test(n)), shopperNames.join(" | "));
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
  const boxes = await p.$$(".aicc-fbt input[type=checkbox]");
  await boxes[0].focus(); await p.keyboard.press("ArrowLeft");
  check(`demo (translated RTL simulation): not marked as fallback (lang=${st.lang}, ${st.dir}) and ArrowLeft moves to the next product`, st.lang === null && st.dir === "rtl" && (await p.evaluate(() => document.activeElement === document.querySelectorAll(".aicc-fbt input[type=checkbox]")[1])));
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
  const d = await p.evaluate(() => { const txt = document.querySelector(".aicc-dash")?.textContent || ""; return { has: !!document.querySelector(".aicc-dash"), labels: ["Recommendation Views", "Recommendation Clicks", "Recommendation Click Rate", "Bundle Add-To-Carts", "Associated Orders", "Associated Revenue", "Merchant Insights", "Recommendation Preview"].filter((l) => !txt.includes(l)), sample: /Sample data: not from a real store/.test(txt), bought: /Bought together 48 times/.test(txt), fallback: /Same category — no purchase history yet/.test(txt), banned: /AI Assisted|widget views/i.test(txt) }; });
  check(`dashboard preview[${tag}]: real labels present (missing: ${d.labels.join(", ") || "none"}), labelled SAMPLE, preview row uses counts and the fallback wording`, d.has && !d.labels.length && d.sample && d.bought && d.fallback && !d.banned, JSON.stringify(d));
  if (!route) await p.click("#ws-t-ask");
  await p.evaluate(() => document.querySelector(".aicc-ask").scrollIntoView());
  const a0 = await p.$$eval(".aicc-ask [data-pair]", (e) => e.map((x) => !x.hidden));
  await p.click('.aicc-ask button[data-qa="perf"]');
  const a1 = await p.evaluate(() => ({ pairs: [...document.querySelectorAll(".aicc-ask [data-pair]")].map((x) => !x.hidden), pressed: [...document.querySelectorAll(".aicc-ask button[data-qa]")].map((b) => b.getAttribute("aria-pressed")), sample: /Sample/.test(document.querySelector(".aicc-ask").textContent), claim: /changes? your settings|generative/i.test(document.querySelector(".aicc-ask__foot").textContent) }));
  check(`Ask Reco panel[${tag}]: sample question buttons switch the answer (aria-pressed), labelled as a sample, footnote states the boundaries`, a0.join() === "true,false" && a1.pairs.join() === "false,true" && a1.pressed.join() === "false,true" && a1.sample, JSON.stringify([a0, a1]));
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
  const chips = await p.$$eval(".aicc-pagehead .aicc-chips a[href^='#']", (a) => a.map((x) => x.getAttribute("href")));
  check(`product: in-page navigation anchors all resolve (${chips.length})`, chips.length >= 12 && (await p.evaluate((h) => h.every((x) => !!document.getElementById(x.slice(1))), chips)), chips.join());
  check("product: #how-decided exists (linked from Home)", await p.evaluate(() => !!document.getElementById("how-decided")));
  await ctx.close();
}
// 12. Home workspace: ARIA tabs (Understand / Control / Find opportunities / Ask Reco)
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", ""));
  await p.waitForSelector("[data-aicc-tabs][data-enhanced]");
  const t0 = await p.evaluate(() => ({ list: document.querySelector("[role=tablist]").getAttribute("aria-label"), labels: [...document.querySelectorAll("[role=tab]")].map((t) => t.textContent.trim()), sel: [...document.querySelectorAll("[role=tab]")].map((t) => t.getAttribute("aria-selected")), ti: [...document.querySelectorAll("[role=tab]")].map((t) => t.tabIndex), panels: [...document.querySelectorAll("[role=tabpanel]")].map((x) => !x.hidden), linked: [...document.querySelectorAll("[role=tab]")].every((t) => document.getElementById(t.getAttribute("aria-controls"))?.getAttribute("aria-labelledby") === t.id) }));
  check(`tabs: tablist with four tabs (${t0.labels.join(" | ")}), first selected, roving tabindex, one visible panel, tab/panel linked`, t0.labels.join() === "Understand,Control,Find opportunities,Ask Reco" && t0.sel.join() === "true,false,false,false" && t0.ti.join() === "0,-1,-1,-1" && t0.panels.join() === "true,false,false,false" && t0.linked && !!t0.list, JSON.stringify(t0));
  await p.focus("#ws-t-understand");
  await p.keyboard.press("ArrowRight");
  check("tabs: ArrowRight selects and focuses the next tab", await p.evaluate(() => document.activeElement.id === "ws-t-control" && document.activeElement.getAttribute("aria-selected") === "true" && !document.getElementById("ws-p-control").hidden && document.getElementById("ws-p-understand").hidden));
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
  await p.waitForSelector("[data-aicc-tabs][data-enhanced]");
  await p.focus("#ws-t-understand"); await p.keyboard.press("ArrowLeft");
  check("tabs[he]: in a right-to-left page ArrowLeft selects the NEXT tab", await p.evaluate(() => document.activeElement.id === "ws-t-control"));
  await ctx.close();
  const [c2, p2] = await fresh({ javaScriptEnabled: false });
  await p2.goto(urlFor("en", ""));
  const nj = await p2.evaluate(() => ({ list: document.querySelector("[role=tablist]").hidden, panels: [...document.querySelectorAll("[role=tabpanel]")].map((x) => getComputedStyle(x).display !== "none"), heads: [...document.querySelectorAll(".aicc-tabs__ph")].every((h) => getComputedStyle(h).position !== "absolute") }));
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
    const f = await p.evaluate(() => ({ values: [...document.querySelectorAll(".aicc-hero__facts--values li")].map((x) => x.textContent.trim()), conf: document.querySelector(".aicc-hero__confidence")?.textContent.replace(/\s+/g, " ").trim(), ctaTop: document.querySelector(".aicc-hero-actions .aicc-btn--primary").getBoundingClientRect().top, valTop: document.querySelector(".aicc-hero__facts--values").getBoundingClientRect().top, confSize: parseFloat(getComputedStyle(document.querySelector(".aicc-hero__confidence")).fontSize), valSize: parseFloat(getComputedStyle(document.querySelector(".aicc-hero__facts--values li")).fontSize) }));
    check(`hero facts: three value facts first, then the smaller muted purchase-confidence line (${f.conf})`, f.values.join("|") === "Learned from your own orders|You control what gets recommended|Your checkout stays independent of AICC" && /Plans from \$99 a year/.test(f.conf) && /14-day money-back guarantee on your first purchase/.test(f.conf) && /No automatic renewal/.test(f.conf) && f.confSize < f.valSize && f.valTop > f.ctaTop, JSON.stringify(f));
  }
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
  const r1 = await p.evaluate(() => ({ shown: [...document.querySelectorAll("#faq-browse details[id^='q']")].filter((d) => !d.closest("[hidden]")).length, topHidden: document.getElementById("faq-top").hidden, live: document.querySelector("[data-aicc-faq-search] [role=status]").textContent, url: location.search }));
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
  // he: the search UI is the English fallback and is marked; with translated strings it would be RTL
  const [c3, p3] = await fresh();
  await p3.goto(urlFor("he", "questions"));
  await p3.waitForSelector("[data-aicc-faq-search] input");
  check("faq search[he]: the English fallback UI is marked lang=en dir=ltr on a Hebrew page", await p3.evaluate(() => document.querySelector("[data-aicc-faq-search]").getAttribute("lang") === "en" && document.querySelector("[data-aicc-faq-search]").getAttribute("dir") === "ltr" && document.documentElement.lang === "he"));
  await c3.close();
  await ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\ninteraction tests: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
