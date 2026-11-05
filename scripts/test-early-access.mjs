// npm run test:early-access: the Early Access presentation in a real browser, before / at / after the end date, in several visitor time zones (Production 20).
//   node scripts/test-early-access.mjs --open <dir> --announce <dir> --off <dir>     (three exports built with NEXT_PUBLIC_AICC_EARLY_ACCESS=open|announce|unset)
// It serves each export itself (scripts/serve-out.mjs on free ports), pins the browser clock, and asserts what a visitor SEES: visibility, not just markup.
//  * time matrix: 40 days before, 1 s before, 1 ms before, AT the cutoff, 1 ms after, 1 s after, 15 days after; each in 6 visitor time zones (UTC, Los Angeles, Jerusalem, Kiritimati +14, Auckland, Pago Pago -11):
//    the offer is live iff the clock is before the instant, whatever the zone;
//  * live view: bar, struck regular price with its label, "Free until December 31, 2026", the end date, one primary action per plan, CTA href (open) or "opens soon" (announce);
//  * ended view: no bar, no offer, no struck price, the ordinary price and "Purchases open soon" are back, the "ended" note is shown;
//  * a normal build never shows any of it; layout: no horizontal overflow at 320/390/768/1280 in the live view; the bar link is reachable by keyboard; he is right-to-left.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? path.resolve(args[i + 1]) : undefined; };
const STRIKE = args.includes("--strike"); // the exports were built with NEXT_PUBLIC_AICC_EA_STRIKE=on
const dirs = { open: arg("open"), announce: arg("announce"), off: arg("off") };
if (!dirs.open || !dirs.announce || !dirs.off) { console.error("usage: --open <dir> --announce <dir> --off <dir>"); process.exit(2); }

const C = Date.UTC(2026, 11, 31, 22, 0, 0);
const results = []; let failed = 0;
const check = (cond, msg) => { results.push(!!cond); if (!cond) { failed++; console.error("  FAIL " + msg); } else console.log("  ok   " + msg); };

const servers = [];
async function serve(dir, port) {
  const p = spawn(process.execPath, [path.join(here, "serve-out.mjs"), "--port", String(port), "--dir", dir], { stdio: "ignore" });
  servers.push(p);
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://localhost:${port}/`); if (r.ok) return `http://localhost:${port}`; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`server for ${dir} did not start`);
}
const base = { open: await serve(dirs.open, 3151), announce: await serve(dirs.announce, 3152), off: await serve(dirs.off, 3153) };

const browser = await launch();
const ZONES = ["UTC", "America/Los_Angeles", "Asia/Jerusalem", "Pacific/Kiritimati", "Pacific/Auckland", "Pacific/Pago_Pago"];
const TIMES = [["40 days before", C - 40 * 86400e3, true], ["1 s before", C - 1000, true], ["1 ms before", C - 1, true], ["AT the cutoff", C, false], ["1 ms after", C + 1, false], ["1 s after", C + 1000, false], ["15 days after", C + 15 * 86400e3, false]];

async function view(mode, route, tz, nowMs, width = 1280, locale) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: tz, locale: locale === "he" ? "he-IL" : "en-US", reducedMotion: "reduce" });
  await ctx.clock.setFixedTime(new Date(nowMs));
  const p = await ctx.newPage();
  await p.goto(`${base[mode]}${route}`, { waitUntil: "load" });
  await p.waitForTimeout(150);
  return { ctx, p };
}
const vis = async (p, sel) => (await p.locator(sel).count()) > 0 && (await p.locator(sel).first().isVisible());
const text = async (p, sel) => ((await p.locator(sel).allInnerTexts()).join(" | ")).replace(/\s+/g, " ");

for (const mode of args.includes("--only-open") ? ["open"] : ["open", "announce"]) {
  console.log(`\n== mode ${mode}: time matrix x visitor time zones (pricing page)`);
  for (const [label, t, live] of TIMES) {
    const states = [];
    for (const tz of ZONES) {
      const { ctx, p } = await view(mode, "/pricing/", tz, t);
      const over = await p.evaluate(() => document.documentElement.hasAttribute("data-ea-over"));
      const bar = await vis(p, ".aicc-eabar");
      const free = await vis(p, ".aicc-plan__free");
      const struck = await vis(p, ".aicc-plan__regular");
      const ordinary = await vis(p, ".aicc-plan__price");
      const soon = (await p.locator(".aicc-plan [data-commerce=closed]").evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).map((e) => e.textContent).join(" "))).includes("Purchases open soon");
      const ended = await vis(p, ".aicc-eaafter");
      const section = await vis(p, "#early-access"), heroLine = await vis(p, ".aicc-ealead"), band = await vis(p, "#pricing-final ~ div [data-ea-live]") || (await p.locator("[data-ea-live] .aicc-hero-actions a.aicc-btn, .aicc-section--inverse [data-ea-live] a.aicc-btn").evaluateAll((els) => els.some((e) => e.getClientRects().length > 0)));
      const features = await vis(p, ".aicc-plan__list[data-ea-after]"), eaFeatures = await vis(p, ".aicc-plan__list[data-ea-live]");
      const hdr = mode === "open" ? (await vis(p, ".aicc-site-header a[href*='offer=early-access']")) : false;
      const ok = live ? (!over && bar && free && struck && !ordinary && !ended && !soon && section && heroLine && band && !features && eaFeatures && (mode !== "open" || hdr)) : (over && !bar && !free && !struck && ordinary && ended && soon && !section && !heroLine && !band && features && !eaFeatures && !hdr);
      states.push(ok ? "." : `x(${tz}: over=${over} bar=${bar} free=${free} struck=${struck} ordinary=${ordinary} ended=${ended} soon=${soon} section=${section} heroLine=${heroLine} band=${band} features=${features} eaFeatures=${eaFeatures} header=${hdr})`);
      await ctx.close();
    }
    check(states.every((s) => s === "."), `${label} (${new Date(t).toISOString()}): ${live ? "LIVE" : "ENDED"} view in all ${ZONES.length} visitor zones${states.every((s) => s === ".") ? "" : " -> " + states.filter((s) => s !== ".").join("; ")}`);
  }

  console.log(`== mode ${mode}: the live view`);
  {
    const { ctx, p } = await view(mode, "/pricing/", "Asia/Jerusalem", C - 86400e3);
    const t = await text(p, ".aicc-plan");
    check((t.match(/Free until December 31, 2026/g) || []).length === 3, "all three plan cards say 'Free until December 31, 2026'");
    check(/\$99/.test(await text(p, ".aicc-plan__regular")) && /\$199/.test(await text(p, ".aicc-plan__regular")) && /\$499/.test(await text(p, ".aicc-plan__regular")), "the plan prices shown next to the free offer are $99, $199 and $499 (the real list prices)");
    if (STRIKE) {
      check((await p.locator(".aicc-plan__regular s").count()) === 3, "strike-through ON: exactly three struck-through prices (one per plan)");
      check(/Regular price, not charged during Early Access:/.test(await text(p, ".aicc-plan__regular-label")), "strike-through ON: the label is 'Regular price, not charged during Early Access:'");
    } else {
      check((await p.locator(".aicc-plan__regular s, .aicc-plan s, .aicc-plan del").count()) === 0, "strike-through OFF (the default): no struck-through price anywhere on the cards");
      check((await text(p, ".aicc-plan__regular-label")).split("|").every((x) => /Planned price when purchases open:/.test(x)) && (await p.locator(".aicc-plan__regular-label").count()) === 3, "strike-through OFF: each price is labelled 'Planned price when purchases open:'");
    }
    check((t.match(/Access ends at 00:00 on January 1, 2027, Israel time \(22:00 UTC on December 31\)/g) || []).length === 3, "every card states the end as an instant: 00:00 January 1, 2027, Israel time (22:00 UTC on December 31)");
    check((t.match(/No credit card required/g) || []).length === 3 && (t.match(/Early Access term: until December 31, 2026, Israel time/g) || []).length === 3, "every card says no credit card is required and states the term with its time zone");
    check(!(await vis(p, ".aicc-plan__list[data-ea-after]")), "the paid-plan bullets (365-day term, 14-day guarantee) are NOT shown next to the free offer");
    check(/paid plan starts only if you choose to buy one/.test(t), "every card says a paid plan starts only if the merchant chooses to buy");
    check(!/(subscription|automatically (charged|renew)|trial|discount|% off|limited time|hurry|countdown)/i.test(await text(p, "#early-access, .aicc-plan, .aicc-eabar, .aicc-ealead")), "no trial / subscription / automatic-charge / discount / urgency wording in the campaign blocks");
    const sect = ((await p.locator("#early-access").textContent()) || "").replace(/\s+/g, " ");
    check(/No automatic conversion and no automatic charge|no automatic conversion/.test(sect) && /no card on file/.test(sect), "the explanation says: no automatic conversion, no automatic charge, no card on file");
    check(/does not apply to Early Access/.test((await p.locator("#early-access").textContent()) || "") && /Does the money-back guarantee apply to Early Access\?/.test((await p.locator("#early-access").textContent()) || "") && /What will I see in the plugin when Early Access ends\?/.test((await p.locator("#early-access").textContent()) || ""), "the questions answer the guarantee and the plugin's end-of-period message");
    check(/Israel time \(22:00 UTC on December 31, 2026\)/.test(sect), "the explanation states the instant in Israel time and UTC");
    const hrefs = await p.locator(".aicc-plan a.aicc-btn").evaluateAll((a) => a.map((x) => x.getAttribute("href")));
    if (mode === "open") check(hrefs.length === 3 && hrefs.every((h) => /offer=early-access/.test(h) && /plan=(solo|studio|agency)/.test(h)), `open: each plan button leads to Early Access with its plan (${hrefs.join(" ")})`);
    else { check(hrefs.length === 0, "announce: no plan button leads anywhere (nothing to sign up for yet)"); check((await text(p, ".aicc-plan [data-ea-soon]")).split("|").length === 3, "announce: each card says 'Early Access opens soon'"); }
    // one primary action per card while live
    check((await p.locator(".aicc-plan [data-ea-live] a.aicc-btn, .aicc-plan [data-ea-live] p.aicc-btn").count()) === 3, "exactly one action per plan card");
    await ctx.close();
  }

  console.log(`== mode ${mode}: the Home hero in the live view`);
  {
    const { ctx, p } = await view(mode, "/", "Asia/Jerusalem", C - 86400e3);
    check(/Recommendations learned from your own orders\./.test(await text(p, "h1")), "hero headline");
    check(/shows in your dashboard what it recommends/.test(await text(p, ".aicc-hero-lead")), "hero lead makes only the approved dashboard claim");
    const visActions = (await p.locator(".aicc-hero .aicc-hero-actions .aicc-btn").evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).map((e) => e.textContent.trim()))).join(" | ");
    check(mode === "open" ? visActions === "Request free Early Access | See it in action" : visActions === "How Early Access works | See it in action", `hero actions while live (${visActions})`);
    check(/No credit card required\. Access ends at 00:00 on January 1, 2027, Israel time, and nothing is charged automatically\./.test(await text(p, ".aicc-eanote")), "hero fine print: no card, the end instant with its time zone, nothing charged automatically");
    if (mode === "open") check(/Request Early Access/.test(await p.locator(".aicc-site-header a[data-ea-live]").first().textContent()), "open: the header button says the same thing as the hero button");
    check(await vis(p, ".aicc-eabar"), "the announcement bar is visible");
    // the bar sits under the header and above the hero (no overlap)
    const g = await p.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { header: r(".aicc-site-header").bottom, barTop: r(".aicc-eabar").top, barBottom: r(".aicc-eabar").bottom, h1: r("h1").top }; });
    check(g.barTop >= g.header - 0.5 && g.h1 > g.barBottom, `the bar sits below the header (${Math.round(g.header)}px) and above the headline (bar ${Math.round(g.barTop)}-${Math.round(g.barBottom)}px, h1 at ${Math.round(g.h1)}px)`);
    // keyboard: the bar link is reachable and shows a focus ring
    await p.keyboard.press("Tab"); let reached = false;
    for (let i = 0; i < 20 && !reached; i++) { reached = await p.evaluate(() => document.activeElement?.classList.contains("aicc-eabar__link")); if (!reached) await p.keyboard.press("Tab"); }
    check(reached, "the bar link is reachable with the Tab key");
    await ctx.close();
  }

  console.log(`== mode ${mode}: no horizontal overflow (live view)`);
  for (const w of [320, 390, 768, 1280]) for (const route of ["/", "/pricing/"]) {
    const { ctx, p } = await view(mode, route, "UTC", C - 86400e3, w);
    const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check(o.sw <= o.iw, `${route} at ${w}px: no horizontal scroll (${o.sw} <= ${o.iw})`);
    await ctx.close();
  }
}

console.log("\n== the ended view elsewhere");
{
  const { ctx, p } = await view("open", "/", "UTC", C + 5 * 86400e3);
  check(!(await vis(p, ".aicc-eanote")) && !(await vis(p, ".aicc-eabar")) && !(await vis(p, ".aicc-ealead")), "Home after the end: no campaign text visible");
  check(/Plans and prices are final\. Purchases and new accounts open soon\./.test(await text(p, "#final-title ~ div [data-ea-after], [data-ea-after] .aicc-lead")), "Home after the end: the ordinary closing band (purchases open soon) is back");
  const endedActions = (await p.locator(".aicc-hero .aicc-hero-actions .aicc-btn").evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).map((e) => e.textContent.trim()))).join(" | ");
  check(endedActions === "See it in action | View plans", `Home after the end: the hero offers the demo and the plans, not Early Access (${endedActions})`);
  await ctx.close();
}

console.log("\n== a normal build never shows the campaign");
for (const [route, tz, t] of [["/", "UTC", C - 86400e3], ["/pricing/", "Asia/Jerusalem", C - 86400e3], ["/pricing/", "UTC", C + 86400e3]]) {
  const { ctx, p } = await view("off", route, tz, t);
  const html = await p.content();
  check(!/Early Access|data-ea-|aicc-eabar/.test(html), `off build ${route} (${new Date(t).toISOString().slice(0, 10)}): no trace of the campaign in the rendered page`);
  check(!(await vis(p, ".aicc-plan__regular")), `off build ${route}: no struck-through price`);
  await ctx.close();
}

console.log("\n== every language: the zone is stated, the bar is not clipped, the ended view works");
{
  const TOK = { en: ["Israel time", "automatically"], he: ["שעון ישראל", "אוטומטית"], es: ["hora de Israel", "automáticamente"], ru: ["по израильскому времени", "автоматически"] };
  for (const [loc, [zone, auto]] of Object.entries(TOK)) {
    const prefix = loc === "en" ? "" : `/${loc}`;
    for (const w of [320, 360, 390, 480, 640, 768, 1024, 1280]) for (const bm of ["open", "announce"]) {
      const { ctx, p } = await view(bm, `${prefix}/pricing/`, "UTC", C - 86400e3, w, loc);
      const bar = await p.evaluate(() => { const b = document.querySelector(".aicc-eabar"); return { clipped: b.scrollHeight > b.clientHeight + 1, text: b.textContent }; });
      check(!bar.clipped && bar.text.includes(zone), `${loc} ${bm} at ${w}px: the bar is not clipped and says the time zone (${zone})`);
      await ctx.close();
    }
    { const { ctx, p } = await view("open", `${prefix}/`, "UTC", C - 86400e3, 1280, loc); const note = (await text(p, ".aicc-eanote")); check(note.includes(zone) && note.toLowerCase().includes(auto.toLowerCase()), `${loc}: the hero fine print states the zone and that nothing is charged automatically`); await ctx.close(); }
    { const { ctx, p } = await view("open", `${prefix}/pricing/`, "Pacific/Kiritimati", C + 1000, 1280, loc);
      const over = await p.evaluate(() => document.documentElement.hasAttribute("data-ea-over"));
      check(over && !(await vis(p, ".aicc-plan__free")) && !(await vis(p, ".aicc-plan__regular")) && (await vis(p, ".aicc-plan__price")) && !(await vis(p, "#early-access")) && !(await vis(p, ".aicc-eabar")) && (await vis(p, ".aicc-eaafter")), `${loc}: the ended view after the cutoff (offer, struck price, explanation and bar hidden; ordinary price and the ended note shown)`);
      await ctx.close(); }
  }
}


console.log("\n== no stale or leaked campaign element, in any mode, page, language and width");
{
  // The leak probe: elements the campaign marks live must be invisible after the end, elements marked after must be invisible before; counted by what is actually rendered (display:none removes it).
  const leaks = (p, sel) => p.evaluate((q) => [...document.querySelectorAll(q)].filter((e) => e.getClientRects().length > 0).length, sel);
  const ROUTES = ["/", "/pricing/", "/product/", "/questions/"];
  for (const mode of ["open", "announce"]) for (const loc of ["en", "he", "es", "ru"]) for (const route of ROUTES) for (const w of [1280, 390]) {
    const prefix = loc === "en" ? "" : `/${loc}`;
    { const { ctx, p } = await view(mode, `${prefix}${route}`, "Asia/Jerusalem", C + 1000, w, loc);
      if (w === 390) { await p.click("[data-aicc-menu-btn]").catch(() => {}); await p.waitForTimeout(100); }
      const l = await leaks(p, "[data-ea-live]"), h = await leaks(p, "[data-ea-hide-live]"), a = await leaks(p, "[data-ea-after]");
      const needsAfter = route === "/pricing/" || route === "/";
      check(l === 0 && (!needsAfter || a > 0), `${mode} ${loc}${route} @${w}: ENDED view shows no live campaign element (${l} live visible) and the ended counterparts are present (${a})${w === 390 ? " (mobile menu open)" : ""}`);
      await ctx.close(); }
    { const { ctx, p } = await view(mode, `${prefix}${route}`, "Asia/Jerusalem", C - 86400e3, w, loc);
      if (w === 390) { await p.click("[data-aicc-menu-btn]").catch(() => {}); await p.waitForTimeout(100); }
      const a = await leaks(p, "[data-ea-after]"), h = await leaks(p, "[data-ea-hide-live]");
      check(a === 0 && h === 0, `${mode} ${loc}${route} @${w}: LIVE view shows no ended-only element (${a}) and no ordinary price (${h})${w === 390 ? " (mobile menu open)" : ""}`);
      await ctx.close(); }
  }
  console.log("== destinations and names (live view)");
  for (const mode of ["open", "announce"]) {
    const { ctx, p } = await view(mode, "/", "UTC", C - 86400e3, 1280);
    const hrefs = await p.locator("a[href]").evaluateAll((a) => a.filter((x) => x.getClientRects().length > 0).map((x) => x.getAttribute("href")));
    const signup = hrefs.filter((h) => /offer=early-access/.test(h));
    if (mode === "announce") check(signup.length === 0, "announce: no visible link on Home leads to the sign-up (nothing to sign up for yet)");
    else check(signup.length >= 2, `open: the header and the hero lead to the sign-up (${signup.length} links)`);
    const hdr = await p.locator(".aicc-site-header a[data-ea-live]").count();
    check(mode === "open" ? hdr >= 1 : hdr === 0, `${mode}: the Early Access header button ${mode === "open" ? "exists" : "does not exist"}`);
    const ordinary = await p.locator(".aicc-site-header a.aicc-btn--primary").evaluateAll((a) => a.filter((x) => x.getClientRects().length > 0).map((x) => x.textContent.trim()));
    check(mode === "open" ? ordinary.length === 1 && /Request Early Access/.test(ordinary[0]) : ordinary.length === 1 && /Get started/.test(ordinary[0]), `${mode}: exactly one primary header button is visible (${ordinary.join(" | ")})`);
    const bar = await p.evaluate(() => { const b = document.querySelector(".aicc-eabar"); const a = b.querySelector("a"); return { name: b.getAttribute("aria-label"), role: b.getAttribute("role"), href: a.getAttribute("href") }; });
    check(bar.role === "region" && !!bar.name && /\/pricing\/#early-access$/.test(bar.href), `${mode}: the bar is a named region and its link goes to /pricing/#early-access (${bar.href})`);
    const heroHref = await p.locator(".aicc-hero .aicc-hero-actions a.aicc-btn").first().getAttribute("href");
    check(mode === "open" ? /offer=early-access/.test(heroHref) : /\/pricing\/#early-access$/.test(heroHref), `${mode}: the first hero button goes to ${mode === "open" ? "the sign-up" : "the explanation"} (${heroHref})`);
    await ctx.close();
  }
  const { ctx: c2, p: p2 } = await view("open", "/pricing/", "UTC", C - 86400e3, 1280);
  const names = await p2.locator(".aicc-plan a.aicc-btn").evaluateAll((a) => a.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  check(new Set(names).size === 3, `the three plan buttons have different accessible names (${names.join(" | ")})`);
  await c2.close();
}
console.log("\n== Hebrew (right-to-left), live view");
{
  const { ctx, p } = await view("open", "/he/pricing/", "Asia/Jerusalem", C - 86400e3, 390, "he");
  const m = await p.evaluate(() => ({ dir: document.documentElement.dir, over: document.documentElement.scrollWidth <= window.innerWidth, bar: !!document.querySelector(".aicc-eabar"), free: [...document.querySelectorAll(".aicc-plan__free")].map((e) => e.textContent) }));
  check(m.dir === "rtl" && m.over && m.bar && m.free.length === 3, `he: rtl, no overflow, bar and three offers present (${m.free[0] || "?"})`);
  await ctx.close();
}

await browser.close();
servers.forEach((s) => s.kill());
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed) { console.error(`FAIL test:early-access (${failed})`); process.exit(1); }
console.log("PASS test:early-access");
