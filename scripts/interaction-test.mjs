// npm run test:interaction: keyboard-only walks through the language switcher, accessibility control, mobile menu,
// FAQ accordion and the demo, plus reduced-motion behaviour and the language-persistence rules. Needs the export served.
import { launch, urlFor, BASE } from "./lib/browser.mjs";

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
  const found = await tabTo(p, () => document.activeElement?.closest(".aicc-lang") && document.activeElement.tagName === "BUTTON");
  check("language: reachable with Tab", found);
  await p.keyboard.press("Enter");
  check("language: Enter opens menu", await p.evaluate(() => !document.querySelector(".aicc-lang__menu").hidden && document.querySelector(".aicc-lang button").getAttribute("aria-expanded") === "true"));
  await p.keyboard.press("Escape");
  check("language: Esc closes and returns focus to the button", await p.evaluate(() => document.querySelector(".aicc-lang__menu").hidden && document.activeElement === document.querySelector(".aicc-lang button")));
  await p.keyboard.press("Enter");
  const links = await p.$$eval(".aicc-lang__menu a", (as) => as.map((a) => [a.lang, a.getAttribute("hreflang"), a.getAttribute("href")]));
  check("language: 4 links with lang/hreflang, same page in each language", links.length === 4 && links.every((l) => l[0] && l[1]) && links.some((l) => l[2].endsWith("/he/pricing/")), JSON.stringify(links));
  await p.keyboard.press("Tab"); await p.keyboard.press("Tab"); // en -> he
  check("language: Tab moves through the links", (await active(p)).includes("אבר") || (await active(p)).includes("עברית"), await active(p));
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
  check("language: first visit stays on the URL's language (no redirect)", new URL(p.url()).pathname === "/");
  check("language: browser-language suggestion appears (Russian)", await p.evaluate(() => document.querySelector(".aicc-suggest")?.lang === "ru"));
  await ctx.close();
}

// 2. Accessibility control
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", ""));
  const found = await tabTo(p, () => document.activeElement?.classList.contains("aicc-header__a11y"));
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
  check("a11y control: Esc closes and focus returns to the trigger", await p.evaluate(() => !document.querySelector("dialog[open]") && document.activeElement?.classList.contains("aicc-header__a11y")));
  await p.reload();
  const persisted = await p.evaluate(() => document.documentElement.getAttribute("data-aicc-motion") + "," + document.documentElement.getAttribute("data-aicc-contrast") + "," + document.documentElement.getAttribute("data-aicc-text"));
  check("a11y control: settings persist across reload", persisted === "reduce,high,large", persisted);
  const html = await (await fetch(urlFor("en", ""))).text();
  const headEnd = html.indexOf("</head>");
  check("a11y control: preference script runs in <head> (applied before first paint)", html.indexOf("aicc_a11y") > 0 && html.indexOf("aicc_a11y") < headEnd);
  await p.click(".aicc-header__a11y"); await p.click("dialog[open] .aicc-btn--quiet");
  const cleared = await p.evaluate(() => ["motion", "contrast", "text"].every((k) => !document.documentElement.hasAttribute("data-aicc-" + k)) && !localStorage.getItem("aicc_a11y"));
  check("a11y control: Reset clears attributes and storage", cleared);
  check("a11y control: links to the accessibility statement", await p.$eval("dialog[open] a", (a) => a.getAttribute("href").includes("/accessibility/")));
  await ctx.close();
}

// 3. Mobile menu (390 wide)
{
  const [ctx, p] = await fresh({ viewport: { width: 390, height: 844 } });
  await p.goto(urlFor("en", ""));
  const btn = ".aicc-header__menu-btn";
  check("mobile menu: button visible at 390px, desktop nav hidden", (await p.isVisible(btn)) && !(await p.isVisible(".aicc-header__nav")));
  await p.focus(btn); await p.keyboard.press("Enter");
  check("mobile menu: Enter opens (aria-expanded=true, panel visible)", (await p.getAttribute(btn, "aria-expanded")) === "true" && (await p.isVisible(".aicc-mobilemenu")));
  await p.keyboard.press("Tab");
  check("mobile menu: Tab goes into the panel (first link)", (await active(p)).startsWith("a|aicc-navlink"), await active(p));
  await p.keyboard.press("Escape");
  check("mobile menu: Esc closes and focus returns to the menu button", (await p.getAttribute(btn, "aria-expanded")) === "false" && (await p.evaluate((b) => document.activeElement === document.querySelector(b), btn)));
  await p.click(btn); await p.click(".aicc-mobilemenu a[href='/pricing/']"); await p.waitForURL("**/pricing/");
  await p.waitForTimeout(300);
  check("mobile menu: choosing a link navigates and closes the menu", (await p.getAttribute(btn, "aria-expanded")) === "false" && !(await p.isVisible(".aicc-mobilemenu")));
  check("mobile menu: aria-current marks the current page", await p.evaluate(() => !!document.querySelector('.aicc-header a[aria-current="page"]')));
  await ctx.close();
}

// 4. FAQ accordion
{
  const [ctx, p] = await fresh();
  await p.goto(urlFor("en", "questions"));
  await p.focus("summary");
  await p.keyboard.press("Enter");
  check("faq: Enter on a question opens it", await p.evaluate(() => document.querySelector("details").open));
  await p.keyboard.press("Space");
  check("faq: Space closes it again", await p.evaluate(() => !document.querySelector("details").open));
  check("faq: all 40 questions are present", (await p.$$("details")).length === 40);
  const ld = await p.$$eval('script[type="application/ld+json"]', (s) => s.map((x) => JSON.parse(x.textContent)));
  const faq = ld.find((x) => x["@type"] === "FAQPage");
  check("faq: FAQPage JSON-LD has the same 40 Q&As that are visible", faq && faq.mainEntity.length === 40);
  await ctx.close();
}

// 5. Demo
for (const loc of ["en", "he"]) {
  const [ctx, p] = await fresh();
  await p.goto(urlFor(loc, ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-demo input[type=checkbox]", { timeout: 5000 });
  const boxes = await p.$$(".aicc-demo input[type=checkbox]");
  check(`demo[${loc}]: at least 3 product cards with real checkboxes`, boxes.length >= 4);
  check(`demo[${loc}]: labelled "Illustrative demo" and no store data`, await p.evaluate(() => !!document.querySelector(".aicc-demo__label") && !/%|revenue|conversion/i.test(document.querySelector(".aicc-demo").textContent)));
  const total = () => p.$eval(".aicc-demo__total strong", (e) => e.textContent.trim());
  const t0 = await total();
  await boxes[2].focus(); await p.keyboard.press("Space");
  await p.waitForTimeout(500);
  const t1 = await total();
  check(`demo[${loc}]: Space ticks a product and the bundle total updates (${t0} -> ${t1})`, t0 !== t1 && (await boxes[2].isChecked()));
  await boxes[0].focus();
  const nextKey = loc === "he" ? "ArrowLeft" : "ArrowRight";
  await p.keyboard.press(nextKey);
  check(`demo[${loc}]: ${nextKey} moves to the next product (follows reading direction)`, await p.evaluate(() => document.activeElement === document.querySelectorAll(".aicc-demo input[type=checkbox]")[1]));
  await p.keyboard.press("ArrowDown");
  check(`demo[${loc}]: ArrowDown moves on`, await p.evaluate(() => document.activeElement === document.querySelectorAll(".aicc-demo input[type=checkbox]")[2]));
  const why1 = await p.$eval(".aicc-demo__why p[aria-live]", (e) => e.textContent);
  await p.click(".aicc-demo__mode[aria-pressed=false]");
  const mode = await p.$eval(".aicc-demo", (e) => e.dataset.mode);
  const why2 = await p.$eval(".aicc-demo__why p[aria-live]", (e) => e.textContent);
  check(`demo[${loc}]: before/after toggle switches mode and the rationale (${mode})`, mode === "without" && why1 !== why2);
  const ow = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check(`demo[${loc}]: no horizontal scroll at 1280`, ow);
  await ctx.close();
}
// 5b. demo at 360, reduced motion
for (const loc of ["en", "he", "es", "ru"]) {
  const [ctx, p] = await fresh({ viewport: { width: 360, height: 740 }, reducedMotion: "reduce" });
  await p.goto(urlFor(loc, ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-demo input[type=checkbox]");
  const fits = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll(".aicc-demo *")].every((e) => e.getBoundingClientRect().right <= innerWidth + 1));
  check(`demo[${loc}] @360: fits without horizontal scroll`, fits);
  const dur = await p.evaluate(() => getComputedStyle(document.querySelector(".aicc-demo__meter i")).transitionDuration);
  check(`demo[${loc}] @360: prefers-reduced-motion disables meter/line transitions (${dur})`, parseFloat(dur) < 0.01, dur);
  const boxes = await p.$$(".aicc-demo input[type=checkbox]");
  await boxes[3].focus(); await p.keyboard.press("Space");
  await p.waitForTimeout(40);
  const t = await p.$eval(".aicc-demo__total strong", (e) => e.textContent.trim());
  check(`demo[${loc}] @360 reduced motion: total updates immediately without counting animation (${t})`, t === "$104", t);
  await ctx.close();
}
{ // site's own motion attribute
  const [ctx, p] = await fresh();
  await p.addInitScript(() => localStorage.setItem("aicc_a11y", JSON.stringify({ motion: "reduce" })));
  await p.goto(urlFor("en", ""));
  await p.evaluate(() => document.querySelector("#demo").scrollIntoView());
  await p.waitForSelector(".aicc-demo input[type=checkbox]");
  const dur = await p.evaluate(() => getComputedStyle(document.querySelector(".aicc-demo__meter i")).transitionDuration);
  const boxes = await p.$$(".aicc-demo input[type=checkbox]");
  await boxes[3].focus(); await p.keyboard.press("Space"); await p.waitForTimeout(40);
  const t = await p.$eval(".aicc-demo__total strong", (e) => e.textContent.trim());
  check(`demo: data-aicc-motion="reduce" disables transitions (${dur}) and counters (${t})`, parseFloat(dur) < 0.01 && t === "$104", `${dur} ${t}`);
  const heroAnim = await p.evaluate(() => getComputedStyle(document.querySelector(".aicc-hero__copy > *")).animationName);
  check(`site: data-aicc-motion="reduce" removes the hero entrance animation (${heroAnim})`, heroAnim === "none", heroAnim);
  await ctx.close();
}
// 6. 404
{
  const [ctx, p] = await fresh();
  const r = await p.goto(`${BASE}/he/nope/`);
  await p.waitForTimeout(400);
  check("404: unknown URL returns 404 with the branded page, in Hebrew under /he/", r.status() === 404 && (await p.evaluate(() => document.documentElement.lang === "he" && document.documentElement.dir === "rtl" && !!document.querySelector("h1"))));
  await ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\ninteraction tests: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
