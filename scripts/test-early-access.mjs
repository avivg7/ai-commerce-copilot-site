// npm run test:early-access: the Early Access presentation in a real browser, before / at / after the end date, in several visitor time zones (Production 20).
//   node scripts/test-early-access.mjs --open <dir> --announce <dir> --off <dir> [--open1 <dir> --announce1 <dir> --open2 <dir> --announce2 <dir>] [--port-base 3351]
//     (exports built with NEXT_PUBLIC_AICC_EARLY_ACCESS=open|announce|unset; the four optional ones also with NEXT_PUBLIC_AICC_EA_EXTENSION_STEP=1|2 and ..._REF: Production 21, "extended" builds)
// It serves each export itself (scripts/serve-out.mjs on free ports), pins the browser clock, and asserts what a visitor SEES: visibility, not just markup.
//  * time matrix: 40 days before, 1 s before, 1 ms before, AT the end, 1 ms after, 1 s after, 15 days after (the end of the build's step: the initial cutoff, or step 1 / step 2); each in 6 visitor time zones
//    (UTC, Los Angeles, Jerusalem, Kiritimati +14, Auckland, Pago Pago -11): the offer is live iff the clock is before the instant, whatever the zone; an extended page stays live at the INITIAL cutoff;
//  * live view: bar, struck regular price with its label, "Free until December 31, 2026", the end date, one primary action per plan, CTA href (open) or "opens soon" (announce);
//  * ended view: no bar, no offer, no struck price, the ordinary price and "Purchases open soon" are back, the "ended" note is shown;
//  * a normal build never shows any of it; layout: no horizontal overflow at 320/390/768/1280 in the live view; the bar link is reachable by keyboard; he is right-to-left.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import { loadDictionaries, loadTs } from "./lib/load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? path.resolve(args[i + 1]) : undefined; };
const QUICK = args.includes("--quick"); // mutation testing only: fewer zones, widths and routes (every check still runs; the full matrix is the default)
const STRIKE = args.includes("--strike"); // the exports were built with NEXT_PUBLIC_AICC_EA_STRIKE=on
const dirs = { open: arg("open"), announce: arg("announce"), off: arg("off"), open1: arg("open1"), announce1: arg("announce1"), open2: arg("open2"), announce2: arg("announce2") };
if (!dirs.open || !dirs.announce || !dirs.off) { console.error("usage: --open <dir> --announce <dir> --off <dir> [--open1 <dir> --announce1 <dir> --open2 <dir> --announce2 <dir>]"); process.exit(2); }
const EXT = !!(dirs.open1 || dirs.announce1 || dirs.open2 || dirs.announce2);
if (EXT && !(dirs.open1 && dirs.announce1 && dirs.open2 && dirs.announce2)) { console.error("the extended variants come as a set: --open1 --announce1 --open2 --announce2"); process.exit(2); }
const PORT0 = Number(arg0("port-base") || 3351);
function arg0(n) { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; }

const C = Date.UTC(2026, 11, 31, 22, 0, 0);
const ENDS = [C, Date.UTC(2027, 0, 31, 22, 0, 0), Date.UTC(2027, 1, 28, 22, 0, 0)];
// The builds under test: key, mode, extension step. The default matrices run for every one of them.
const VARIANTS = [{ key: "open", mode: "open", step: 0 }, { key: "announce", mode: "announce", step: 0 }, ...(EXT ? [{ key: "open1", mode: "open", step: 1 }, { key: "announce1", mode: "announce", step: 1 }, { key: "open2", mode: "open", step: 2 }, { key: "announce2", mode: "announce", step: 2 }] : [])]
  .filter((v) => !args.includes("--only-open") || v.mode === "open");
const D = await loadDictionaries();
const { getEaDictionary } = await loadTs("src/i18n/index.ts");
const EAD = (loc, step) => getEaDictionary(loc, step);
const norm = (t) => String(t).replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
const results = []; let failed = 0;
const check = (cond, msg) => { results.push(!!cond); if (!cond) { failed++; console.error("  FAIL " + msg); } else console.log("  ok   " + msg); };

const servers = [];
async function serve(dir, port) {
  const p = spawn(process.execPath, [path.join(here, "serve-out.mjs"), "--port", String(port), "--dir", dir], { stdio: "ignore" });
  servers.push(p);
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://localhost:${port}/`); if (r.ok) return `http://localhost:${port}`; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`server for ${dir} did not start`);
}
const base = {};
{ let i = 0; for (const [k, d] of Object.entries(dirs)) if (d) base[k] = await serve(d, PORT0 + i++); }

const browser = await launch();
const ZONES = QUICK ? ["UTC", "Pacific/Kiritimati"] : ["UTC", "America/Los_Angeles", "Asia/Jerusalem", "Pacific/Kiritimati", "Pacific/Auckland", "Pacific/Pago_Pago"];
/** The seven moments of the matrix around the END of a step, and, for an extended build, the INITIAL cutoff (still live). */
const timesFor = (step) => {
  const E = ENDS[step];
  return [["40 days before", E - 40 * 86400e3, true], ["1 s before", E - 1000, true], ["1 ms before", E - 1, true], ["AT the end", E, false], ["1 ms after", E + 1, false], ["1 s after", E + 1000, false], ["15 days after", E + 15 * 86400e3, false],
    ...(step > 0 ? [["1 s after the INITIAL cutoff", C + 1000, true], ["AT the initial cutoff", C, true]] : [])];
};

async function view(mode, route, tz, nowMs, width = 1280, locale, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, timezoneId: tz, locale: locale === "he" ? "he-IL" : "en-US", reducedMotion: "reduce" });
  await ctx.clock.setFixedTime(new Date(nowMs));
  const p = await ctx.newPage();
  await p.goto(`${base[mode]}${route}`, { waitUntil: "load" });
  await p.waitForTimeout(150);
  return { ctx, p };
}
const vis = async (p, sel) => (await p.locator(sel).count()) > 0 && (await p.locator(sel).first().isVisible());
const text = async (p, sel) => ((await p.locator(sel).allInnerTexts()).join(" | ")).replace(/\s+/g, " ");
const countIn = (hay, needle) => hay.split(needle).length - 1;
const lit = (l, step) => ({ last: { en: ["December 31, 2026", "January 31, 2027", "February 28, 2027"], he: ["31 בדצמבר 2026", "31 בינואר 2027", "28 בפברואר 2027"], es: ["31 de diciembre de 2026", "31 de enero de 2027", "28 de febrero de 2027"], ru: ["31 декабря 2026", "31 января 2027", "28 февраля 2027"] }[l][step], end: { en: ["January 1, 2027", "February 1, 2027", "March 1, 2027"], he: ["1 בינואר 2027", "1 בפברואר 2027", "1 במרץ 2027"], es: ["1 de enero de 2027", "1 de febrero de 2027", "1 de marzo de 2027"], ru: ["1 января 2027", "1 февраля 2027", "1 марта 2027"] }[l][step] });
const dateCount = (tx, l, step) => { const t = norm(tx); let n = 0; for (const k of ["last", "end"]) n += (t.match(new RegExp(`(?<![0-9])${lit(l, step)[k].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g")) || []).length; return n; };

for (const { key: mode0, mode, step } of VARIANTS) {
  const E = ENDS[step], ea = EAD("en", step), tag = step ? `${mode} (extension step ${step})` : mode;
  console.log(`\n== ${tag}: time matrix x visitor time zones (pricing page)`);
  for (const [label, t, live] of timesFor(step)) {
    const states = [];
    for (const tz of ZONES) {
      const { ctx, p } = await view(mode0, "/pricing/", tz, t);
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
    check(states.every((s) => s === "."), `${tag}: ${label} (${new Date(t).toISOString()}): ${live ? "LIVE" : "ENDED"} view in all ${ZONES.length} visitor zones${states.every((s) => s === ".") ? "" : " -> " + states.filter((s) => s !== ".").join("; ")}`);
  }

  console.log(`== ${tag}: the live view`);
  {
    const { ctx, p } = await view(mode0, "/pricing/", "Asia/Jerusalem", E - 86400e3);
    const t = await text(p, ".aicc-plan");
    check((t.match(new RegExp(norm(ea.plan.free).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length === 3, `all three plan cards say '${ea.plan.free}'`);
    check(/\$99/.test(await text(p, ".aicc-plan__regular")) && /\$199/.test(await text(p, ".aicc-plan__regular")) && /\$499/.test(await text(p, ".aicc-plan__regular")), "the plan prices shown next to the free offer are $99, $199 and $499 (the real list prices)");
    if (STRIKE) {
      check((await p.locator(".aicc-plan__regular s").count()) === 3, "strike-through ON: exactly three struck-through prices (one per plan)");
      check(/Regular price, not charged during Early Access:/.test(await text(p, ".aicc-plan__regular-label")), "strike-through ON: the label is 'Regular price, not charged during Early Access:'");
    } else {
      check((await p.locator(".aicc-plan__regular s, .aicc-plan s, .aicc-plan del").count()) === 0, "strike-through OFF (the default): no struck-through price anywhere on the cards");
      check((await text(p, ".aicc-plan__regular-label")).split("|").every((x) => /Planned price when purchases open:/.test(x)) && (await p.locator(".aicc-plan__regular-label").count()) === 3, "strike-through OFF: each price is labelled 'Planned price when purchases open:'");
    }
    check(countIn(t, norm(ea.plan.ends.split(" A paid plan")[0])) === 3, `every card states the end as an instant: ${norm(ea.plan.ends.split(" A paid plan")[0])}`);
    check((t.match(/No credit card required/g) || []).length === 3 && countIn(t, norm(ea.plan.term)) === 3, "every card says no credit card is required and states the term with its time zone");
    check(!(await vis(p, ".aicc-plan__list[data-ea-after]")), "the paid-plan bullets (365-day term, 14-day guarantee) are NOT shown next to the free offer");
    check(/paid plan starts only if you choose to buy one/.test(t), "every card says a paid plan starts only if the merchant chooses to buy");
    check(!/(subscription|automatically (charged|renew)|trial|discount|% off|limited time|hurry|countdown)/i.test(await text(p, "#early-access, .aicc-plan, .aicc-eabar, .aicc-ealead")), "no trial / subscription / automatic-charge / discount / urgency wording in the campaign blocks");
    const sectFull = ((await p.locator("#early-access").textContent()) || "").replace(/\s+/g, " ");
    const sect = sectFull;
    check(/No automatic conversion and no automatic charge|no automatic conversion/.test(sect) && /no card on file/.test(sect), "the explanation says: no automatic conversion, no automatic charge, no card on file");
    // guarantee (Production 21): paid purchases only; the Plugin's money-back message is NOT mentioned; the plugin question keeps the "Renew plan" wording and the missing warning
    check(/Does the money-back guarantee apply to Early Access\?/.test(sectFull) && /applies to eligible paid purchases/.test(sectFull) && /nothing to refund/.test(sectFull) && !/may show a 14-day|money-back message/i.test(sectFull), "the guarantee answer: it applies to eligible paid purchases, nothing to refund in Early Access, and the Plugin's money-back message is no longer mentioned");
    check(/What will I see in the plugin when Early Access ends\?/.test(sectFull) && /"Renew plan"/.test(sectFull) && /does not warn you beforehand/.test(sectFull), "the plugin answer keeps the \"Renew plan\" wording and says the plugin gives no warning");
    check(norm(sectFull).includes(norm(ea.section.lead.split(" If ")[0])) && sect.includes(`Israel time (22:00 UTC on ${lit("en", step).last})`), "the explanation states the instant in Israel time and UTC (the dates of this step)");
    // the extension reservation is permanent: in the terms line and as a question, in every build; the plan-change question is answered (Production 21)
    check(countIn(sectFull, norm(ea.section.reservation)) === 2 && /Could Early Access be extended\?/.test(sectFull), "the extension reservation is in the terms line AND in the questions (twice), in every build");
    check(/Can I change my plan\?/.test(sectFull) && /Yes, before Early Access ends\. Write to support@copilt\.org from your account's e-mail address and we change the plan of your Early Access store at no charge\. The end date stays the same\./.test(sectFull) && /a smaller plan needs fewer connected stores/.test(sectFull), "the plan-change question is answered (before the end, from the account's e-mail, no charge, same end date, limits follow the plan)");
    check(/ask us to change it \(see the questions below\)/.test(sectFull) && /you buy the plan your store holds at that time/.test(sectFull) && !/same plan you used/.test(sectFull), "who-it-is-for and the end blocks agree with the plan change (the plan the store holds at the end; no contradiction of the explicit purchase)");
    if (step > 0) {
      const note = norm(await p.locator("[data-ea-extended-note]").first().textContent());
      check(note === norm(ea.extended.note) && /first announced to end on December 31, 2026/.test(note) && /no payment is taken and nothing converts or is charged automatically/.test(note), "the extension note is in the explanation: first announced end, extended for every store, nothing else changed");
      check(norm(await text(p, ".aicc-eabar")).includes(norm(mode === "open" ? ea.extended.bar : ea.bar.announce)), `the bar says: ${mode === "open" ? ea.extended.bar : ea.bar.announce}`);
    } else check((await p.locator("[data-ea-extended-note]").count()) === 0, "a step-0 build has no extension note");
    const hrefs = await p.locator(".aicc-plan a.aicc-btn").evaluateAll((a) => a.map((x) => x.getAttribute("href")));
    if (mode === "open") check(hrefs.length === 3 && hrefs.every((h) => /offer=early-access/.test(h) && /plan=(solo|studio|agency)/.test(h)), `open: each plan button leads to Early Access with its plan (${hrefs.join(" ")})`);
    else { check(hrefs.length === 0, "announce: no plan button leads anywhere (nothing to sign up for yet)"); check((await text(p, ".aicc-plan [data-ea-soon]")).split("|").length === 3, "announce: each card says 'Early Access opens soon'"); }
    // one primary action per card while live
    check((await p.locator(".aicc-plan [data-ea-live] a.aicc-btn, .aicc-plan [data-ea-live] p.aicc-btn").count()) === 3, "exactly one action per plan card");
    await ctx.close();
  }

  console.log(`== ${tag}: the Home hero in the live view`);
  {
    const { ctx, p } = await view(mode0, "/", "Asia/Jerusalem", E - 86400e3);
    check(norm(await text(p, "h1")) === "More relevant recommendations. More opportunities to sell.", "hero headline (Production 21)");
    check(/shows in your dashboard what it recommends/.test(await text(p, ".aicc-hero-lead")) && !/\b(boost|increase|lift|grow|revenue|conversion|buyers?)\b|%/i.test(await text(p, "h1, .aicc-hero-lead")), "hero lead makes only the approved dashboard claim and no result word (boost, increase, lift, grow, revenue, conversion, buyers, percent)");
    const visActions = (await p.locator(".aicc-hero .aicc-hero-actions .aicc-btn").evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).map((e) => e.textContent.trim()))).join(" | ");
    check(mode === "open" ? visActions === "Request free Early Access | See it in action" : visActions === "How Early Access works | See it in action", `hero actions while live (${visActions})`);
    check(norm(await text(p, ".aicc-eanote")) === norm(ea.hero.note) && /No credit card required\. Access ends at 00:00 on .*, Israel time, and nothing is charged automatically\./.test(await text(p, ".aicc-eanote")), `hero fine print: no card, the end instant with its time zone, nothing charged automatically (${norm(ea.hero.note)})`);
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

  console.log(`== ${tag}: above the fold (Production 21): the whole headline, the primary action and the fine print without scrolling`);
  for (const [w, h] of [[1280, 720], [390, 844]]) {
    const { ctx, p } = await view(mode0, "/", "Asia/Jerusalem", E - 86400e3, w, "en", h);
    const m = await p.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, right: b.right, left: b.left }; };
      const prim = [...document.querySelectorAll(".aicc-hero .aicc-hero-actions .aicc-btn--primary")].find((e) => e.getClientRects().length > 0).getBoundingClientRect();
      const h1 = document.querySelector("h1");
      // a word wider than the headline's own box is broken in the middle (or clipped)
      const probe = document.createElement("span"); probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap"; const cs = getComputedStyle(h1); probe.style.font = cs.font; probe.style.letterSpacing = cs.letterSpacing; document.body.appendChild(probe);
      let longest = 0; for (const word of h1.textContent.trim().split(/\s+/)) { probe.textContent = word; longest = Math.max(longest, probe.getBoundingClientRect().width); } probe.remove();
      const hdr = document.querySelector(".aicc-site-header").getBoundingClientRect();
      return { h1: r("h1"), prim: { top: prim.top, bottom: prim.bottom }, note: r(".aicc-eanote"), vh: innerHeight, vw: innerWidth, longest, h1w: h1.clientWidth, h1scroll: h1.scrollWidth, hdr: hdr.height, noteLines: Math.round(document.querySelector(".aicc-eanote").getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector(".aicc-eanote")).lineHeight || "20")) };
    });
    check(m.h1.bottom <= m.vh && m.prim.bottom <= m.vh && m.note.bottom <= m.vh, `${tag} @${w}x${h}: the full headline (bottom ${Math.round(m.h1.bottom)}), the primary action (bottom ${Math.round(m.prim.bottom)}) and the fine print (bottom ${Math.round(m.note.bottom)}) are all above the fold (${m.vh}px)`);
    check(m.longest <= m.h1w + 0.5 && m.h1scroll <= m.h1w + 1 && m.h1.left >= 0 && m.h1.right <= m.vw, `${tag} @${w}x${h}: nothing in the headline is clipped or broken mid-word (longest word ${Math.round(m.longest)}px in ${m.h1w}px)`);
    check(m.hdr >= 70 && m.hdr <= 80, `${tag} @${w}x${h}: the header keeps its token height (${Math.round(m.hdr)}px, token 76)`);
    await ctx.close();
  }
  // the headline word fits the column at every desktop width (it broke in the middle of "recommendations." at 1024 px before Production 21), in every language
  for (const loc of ["en", "he", "es", "ru"]) for (const [w, h] of QUICK ? [[1024, 1000]] : [[1024, 768], [1024, 1000], [1100, 800], [1100, 1000], [1180, 820], [1280, 720], [1440, 900]]) {
    const prefix = loc === "en" ? "" : `/${loc}`;
    const { ctx, p } = await view(mode0, `${prefix}/`, "UTC", E - 86400e3, w, loc, h);
    const m = await p.evaluate(() => { const h1 = document.querySelector("h1"); const probe = document.createElement("span"); probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap"; const cs = getComputedStyle(h1); probe.style.font = cs.font; probe.style.letterSpacing = cs.letterSpacing; document.body.appendChild(probe); let longest = 0; for (const word of h1.textContent.trim().split(/\s+/)) { probe.textContent = word; longest = Math.max(longest, probe.getBoundingClientRect().width); } probe.remove(); return { longest, w: h1.clientWidth }; });
    check(m.longest <= m.w + 0.5, `${tag} ${loc} @${w}: the longest headline word fits its column (${Math.round(m.longest)}px in ${m.w}px)`);
    await ctx.close();
  }

  console.log(`== ${tag}: no horizontal overflow (live view)`);
  for (const w of QUICK ? [390] : [320, 390, 768, 1280]) for (const route of ["/", "/pricing/"]) {
    const { ctx, p } = await view(mode0, route, "UTC", E - 86400e3, w);
    const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check(o.sw <= o.iw, `${tag} ${route} at ${w}px: no horizontal scroll (${o.sw} <= ${o.iw})`);
    await ctx.close();
  }
}

console.log("\n== the headline word fits its column in the NORMAL build too (every language, desktop widths)");
for (const loc of ["en", "he", "es", "ru"]) for (const [w, h] of QUICK ? [[1024, 768]] : [[1024, 768], [1100, 800], [1180, 820], [1280, 720], [1440, 900]]) {
  const prefix = loc === "en" ? "" : `/${loc}`;
  const { ctx, p } = await view("off", `${prefix}/`, "UTC", C - 86400e3, w, loc, h);
  const m = await p.evaluate(() => { const h1 = document.querySelector("h1"); const probe = document.createElement("span"); probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap"; const cs = getComputedStyle(h1); probe.style.font = cs.font; probe.style.letterSpacing = cs.letterSpacing; document.body.appendChild(probe); let longest = 0; for (const word of h1.textContent.trim().split(/\s+/)) { probe.textContent = word; longest = Math.max(longest, probe.getBoundingClientRect().width); } probe.remove(); return { longest, w: h1.clientWidth }; });
  check(m.longest <= m.w + 0.5, `normal build ${loc} @${w}: the longest headline word fits its column (${Math.round(m.longest)}px in ${m.w}px)`);
  await ctx.close();
}

console.log("\n== the ended view elsewhere");
for (const { key, step } of VARIANTS.filter((v) => v.mode === "open")) {
  const { ctx, p } = await view(key, "/", "UTC", ENDS[step] + 5 * 86400e3);
  check(!(await vis(p, ".aicc-eanote")) && !(await vis(p, ".aicc-eabar")) && !(await vis(p, ".aicc-ealead")), `${key}: Home after the end: no campaign text visible`);
  check(/Plans and prices are final\. Purchases and new accounts open soon\./.test(await text(p, "#final-title ~ div [data-ea-after], [data-ea-after] .aicc-lead")), `${key}: Home after the end: the ordinary closing band (purchases open soon) is back`);
  const endedActions = (await p.locator(".aicc-hero .aicc-hero-actions .aicc-btn").evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).map((e) => e.textContent.trim()))).join(" | ");
  check(endedActions === "See it in action | View plans", `${key}: Home after the end: the hero offers the demo and the plans, not Early Access (${endedActions})`);
  await ctx.close();
  { const { ctx: c3, p: p3 } = await view(key, "/pricing/", "UTC", ENDS[step] + 5 * 86400e3);
    const ended = norm(await text(p3, ".aicc-eaafter"));
    check(ended.includes(`Early Access ended on ${lit("en", step).end}, at 00:00 Israel time`), `${key}: the ended note names this build's end (${lit("en", step).end})`);
    await c3.close(); }
}

console.log("\n== a normal build never shows the campaign");
for (const [route, tz, t] of [["/", "UTC", C - 86400e3], ["/pricing/", "Asia/Jerusalem", C - 86400e3], ["/pricing/", "UTC", C + 86400e3], ["/pricing/", "UTC", ENDS[1] - 86400e3]]) {
  const { ctx, p } = await view("off", route, tz, t);
  const html = await p.content();
  check(!/Early Access|data-ea-|aicc-eabar/.test(html), `off build ${route} (${new Date(t).toISOString().slice(0, 10)}): no trace of the campaign in the rendered page`);
  check(!(await vis(p, ".aicc-plan__regular")), `off build ${route}: no struck-through price`);
  await ctx.close();
}

console.log("\n== every language: the zone is stated, the bar is not clipped, the ended view works");
{
  const TOK = { en: ["Israel time", "automatically"], he: ["שעון ישראל", "אוטומטית"], es: ["hora de Israel", "automáticamente"], ru: ["по израильскому времени", "автоматически"] };
  for (const { key, mode, step } of VARIANTS) for (const [loc, [zone, auto]] of Object.entries(TOK)) {
    const prefix = loc === "en" ? "" : `/${loc}`, E = ENDS[step];
    for (const w of QUICK ? [320, 768, 1280] : [320, 360, 390, 480, 640, 768, 1024, 1280]) {
      const { ctx, p } = await view(key, `${prefix}/pricing/`, "UTC", E - 86400e3, w, loc);
      const bar = await p.evaluate(() => { const b = document.querySelector(".aicc-eabar"); return { clipped: b.scrollHeight > b.clientHeight + 1, text: b.textContent }; });
      const want = norm(mode === "open" && step > 0 ? EAD(loc, step).extended.bar : mode === "open" ? EAD(loc, step).bar.live : EAD(loc, step).bar.announce);
      check(!bar.clipped && bar.text.includes(zone) && norm(bar.text).includes(want), `${key} ${loc} at ${w}px: the bar is not clipped, says the time zone (${zone}) and the sentence of step ${step}`);
      await ctx.close();
    }
    { const { ctx, p } = await view(key, `${prefix}/`, "UTC", E - 86400e3, 1280, loc); const note = (await text(p, ".aicc-eanote")); check(norm(note) === norm(EAD(loc, step).hero.note) && note.includes(zone) && note.toLowerCase().includes(auto.toLowerCase()), `${key} ${loc}: the hero fine print states the zone and that nothing is charged automatically (step ${step})`); await ctx.close(); }
    { const { ctx, p } = await view(key, `${prefix}/pricing/`, "Pacific/Kiritimati", E + 1000, 1280, loc);
      const over = await p.evaluate(() => document.documentElement.hasAttribute("data-ea-over"));
      check(over && !(await vis(p, ".aicc-plan__free")) && !(await vis(p, ".aicc-plan__regular")) && (await vis(p, ".aicc-plan__price")) && !(await vis(p, "#early-access")) && !(await vis(p, ".aicc-eabar")) && (await vis(p, ".aicc-eaafter")), `${key} ${loc}: the ended view after the end (offer, struck price, explanation and bar hidden; ordinary price and the ended note shown)`);
      await ctx.close(); }
  }
}

console.log("\n== no stale or leaked campaign element, in any mode, page, language and width");
{
  // The leak probe: elements the campaign marks live must be invisible after the end, elements marked after must be invisible before; counted by what is actually rendered (display:none removes it).
  const leaks = (p, sel) => p.evaluate((q) => [...document.querySelectorAll(q)].filter((e) => e.getClientRects().length > 0).length, sel);
  const ROUTES = QUICK ? ["/", "/pricing/"] : ["/", "/pricing/", "/product/", "/questions/"];
  for (const { key, step } of VARIANTS) for (const loc of ["en", "he", "es", "ru"]) for (const route of ROUTES) for (const w of [1280, 390]) {
    const prefix = loc === "en" ? "" : `/${loc}`, E = ENDS[step], ead = EAD(loc, step);
    const tg = `${key} ${loc}${route} @${w}`;
    { const { ctx, p } = await view(key, `${prefix}${route}`, "Asia/Jerusalem", E + 1000, w, loc);
      if (w === 390) { await p.click("[data-aicc-menu-btn]").catch(() => {}); await p.waitForTimeout(100); }
      const l = await leaks(p, "[data-ea-live]"), a = await leaks(p, "[data-ea-after]");
      const needsAfter = route === "/pricing/" || route === "/";
      check(l === 0 && (!needsAfter || a > 0), `${tg}: ENDED view shows no live campaign element (${l} live visible) and the ended counterparts are present (${a})${w === 390 ? " (mobile menu open)" : ""}`);
      // Text-based probe (does not depend on the markers): none of the campaign's own sentences may be rendered after the end, whatever element carries them.
      const inner = norm(await p.evaluate(() => document.body.innerText));
      const live = [ead.hero.ctaOpen, ead.header.cta, ead.hero.ctaAnnounce, ead.section.homeLead, ead.plan.free, ead.plan.ctaAnnounce, ead.hero.note, ead.bar.live, ead.bar.announce, ead.extended.bar, ead.extended.note, ead.section.reservation, ead.section.faq.change.q].map(norm);
      const seen = live.filter((t) => inner.includes(t));
      check(seen.length === 0, `${tg}: no campaign sentence is rendered after the end${seen.length ? " -> " + seen[0].slice(0, 60) : ""}`);
      // after the end of THIS build no date of the campaign is on the page (the ended note names the end of the build; the initial last day is nowhere, even in an extended build)
      if (step > 0) check(dateCount(inner, loc, 0) === 0, `${tg}: the ENDED view of an extended build names no date of the initial end (${dateCount(inner, loc, 0)} found)`);
      await ctx.close(); }
    { const { ctx, p } = await view(key, `${prefix}${route}`, "Asia/Jerusalem", E - 86400e3, w, loc);
      if (w === 390) { await p.click("[data-aicc-menu-btn]").catch(() => {}); await p.waitForTimeout(100); }
      const a = await leaks(p, "[data-ea-after]"), h = await leaks(p, "[data-ea-hide-live]");
      check(a === 0 && h === 0, `${tg}: LIVE view shows no ended-only element (${a}) and no ordinary price (${h})${w === 390 ? " (mobile menu open)" : ""}`);
      const innerLive = norm(await p.evaluate(() => document.body.innerText));
      const ended = [ead.after.title, D[loc].common.soon.band].map(norm).filter((t) => (route === "/" || route === "/pricing/") && innerLive.includes(t));
      check(ended.length === 0, `${tg}: LIVE view renders neither the ended note nor the ordinary closing band${ended.length ? " -> " + ended[0].slice(0, 50) : ""}`);
      const prim = await p.locator(".aicc-site-header a.aicc-btn--primary").evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).length);
      check(prim === 1, `${tg}: exactly one primary header button is visible (${prim})${w === 390 ? " (mobile menu open)" : ""}`);
      // The initial-end leak probe (Production 21), text-based: in an extended build, after the INITIAL cutoff but before the step's end, no sentence or date of the initial end is rendered
      // anywhere, on any page, in any language (the one allowed mention is the extension note on the pricing page: "first announced to end on ..."), and the campaign sentences ARE the step's.
      if (step > 0) {
        const first = EAD(loc, 0);
        const stale = [first.bar.live, first.bar.announce, first.hero.note, first.plan.free, first.plan.term, first.plan.ends, first.section.homeLead, first.section.title, first.section.lead, first.after.body, first.section.endTitle].map(norm).filter((t) => innerLive.includes(t));
        check(stale.length === 0, `${tg}: no initial-end sentence is rendered in the extended build${stale.length ? " -> " + stale[0].slice(0, 70) : ""}`);
        const allowed = route === "/pricing/" ? 1 : 0;
        check(dateCount(innerLive, loc, 0) === allowed, `${tg}: dates of the initial end appear ${dateCount(innerLive, loc, 0)} time(s) (allowed ${allowed}: only the extension note names the initial last day)`);
        if (route === "/pricing/" || route === "/") check(dateCount(innerLive, loc, step) >= 1, `${tg}: the page names this step's dates`);
      }
      await ctx.close(); }
  }
  console.log("== destinations and names (live view)");
  for (const { key, mode, step } of VARIANTS) {
    const { ctx, p } = await view(key, "/", "UTC", ENDS[step] - 86400e3, 1280);
    const hrefs = await p.locator("a[href]").evaluateAll((a) => a.filter((x) => x.getClientRects().length > 0).map((x) => x.getAttribute("href")));
    const signup = hrefs.filter((h) => /offer=early-access/.test(h));
    if (mode === "announce") check(signup.length === 0, `${key}: no visible link on Home leads to the sign-up (nothing to sign up for yet)`);
    else check(signup.length >= 2, `${key}: the header and the hero lead to the sign-up (${signup.length} links)`);
    const hdr = await p.locator(".aicc-site-header a[data-ea-live]").count();
    check(mode === "open" ? hdr >= 1 : hdr === 0, `${key}: the Early Access header button ${mode === "open" ? "exists" : "does not exist"}`);
    const ordinary = await p.locator(".aicc-site-header a.aicc-btn--primary").evaluateAll((a) => a.filter((x) => x.getClientRects().length > 0).map((x) => x.textContent.trim()));
    check(mode === "open" ? ordinary.length === 1 && /Request Early Access/.test(ordinary[0]) : ordinary.length === 1 && /Get started/.test(ordinary[0]), `${key}: exactly one primary header button is visible (${ordinary.join(" | ")})`);
    const bar = await p.evaluate(() => { const b = document.querySelector(".aicc-eabar"); const a = b.querySelector("a"); return { name: b.getAttribute("aria-label"), role: b.getAttribute("role"), href: a.getAttribute("href") }; });
    check(bar.role === "region" && !!bar.name && /\/pricing\/#early-access$/.test(bar.href), `${key}: the bar is a named region and its link goes to /pricing/#early-access (${bar.href})`);
    const heroHref = await p.locator(".aicc-hero .aicc-hero-actions a.aicc-btn").first().getAttribute("href");
    check(mode === "open" ? /offer=early-access/.test(heroHref) : /\/pricing\/#early-access$/.test(heroHref), `${key}: the first hero button goes to ${mode === "open" ? "the sign-up" : "the explanation"} (${heroHref})`);
    // one primary action per state: open = "Request free Early Access", announce = "How Early Access works"
    const prim = await p.locator(".aicc-hero .aicc-hero-actions a.aicc-btn--primary").evaluateAll((a) => a.filter((x) => x.getClientRects().length > 0).map((x) => x.textContent.trim()));
    check(prim.length === 1 && prim[0] === (mode === "open" ? "Request free Early Access" : "How Early Access works"), `${key}: exactly one primary hero action (${prim.join(" | ")})`);
    await ctx.close();
  }
  { const { ctx: c0, p: p0 } = await view("off", "/", "UTC", C - 86400e3, 1280);
    const prim0 = await p0.locator(".aicc-hero .aicc-hero-actions .aicc-btn--primary").evaluateAll((a) => a.filter((x) => x.getClientRects().length > 0).map((x) => x.textContent.trim()));
    check(prim0.length === 1 && prim0[0] === "See it in action", `the normal build's one primary hero action is "See it in action" (${prim0.join(" | ")})`);
    await c0.close(); }
  for (const { key, step } of VARIANTS.filter((v) => v.mode === "open")) {
    const { ctx: c2, p: p2 } = await view(key, "/pricing/", "UTC", ENDS[step] - 86400e3, 1280);
    const names = await p2.locator(".aicc-plan a.aicc-btn").evaluateAll((a) => a.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
    check(new Set(names).size === 3, `${key}: the three plan buttons have different accessible names (${names.join(" | ")})`);
    await c2.close();
  }
}

console.log("\n== the header keeps its token height and the bar never sits under it (every language, desktop and phone widths)");
for (const { key, step } of VARIANTS.filter((v) => v.mode === "open")) for (const loc of ["en", "he", "es", "ru"]) for (const w of QUICK ? [390, 1050] : [390, 1000, 1024, 1050, 1080, 1100, 1200, 1280]) {
  if (step > 0 && ![390, 1024, 1050, 1280].includes(w)) continue; // the tight band is the same code for every step; sample it
  const prefix = loc === "en" ? "" : `/${loc}`;
  const { ctx, p } = await view(key, `${prefix}/pricing/`, "UTC", ENDS[step] - 86400e3, w, loc);
  const g = await p.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); return { header: r(".aicc-site-header").height, headerBottom: r(".aicc-site-header").bottom, barTop: r(".aicc-eabar").top, crumbs: r(".aicc-crumbs").top, barBottom: r(".aicc-eabar").bottom }; });
  check(Math.abs(g.header - 76) <= 1 && g.barTop >= g.headerBottom - 0.5, `${key} ${loc} @${w}: the header is ${Math.round(g.header)}px (token 76) and the bar starts below it (bar ${Math.round(g.barTop)}, header bottom ${Math.round(g.headerBottom)})`);
  check(g.crumbs - g.barBottom <= 80, `${key} ${loc} @${w}: no empty gap under the bar on an inner page (${Math.round(g.crumbs - g.barBottom)}px to the breadcrumb)`);
  await ctx.close();
}
console.log("\n== Hebrew (right-to-left), live view");
for (const { key, step } of VARIANTS.filter((v) => v.mode === "open")) {
  const { ctx, p } = await view(key, "/he/pricing/", "Asia/Jerusalem", ENDS[step] - 86400e3, 390, "he");
  const m = await p.evaluate(() => ({ dir: document.documentElement.dir, over: document.documentElement.scrollWidth <= window.innerWidth, bar: !!document.querySelector(".aicc-eabar"), free: [...document.querySelectorAll(".aicc-plan__free")].map((e) => e.textContent) }));
  check(m.dir === "rtl" && m.over && m.bar && m.free.length === 3, `${key} he: rtl, no overflow, bar and three offers present (${m.free[0] || "?"})`);
  await ctx.close();
}

await browser.close();
servers.forEach((s) => s.kill());
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed) { console.error(`FAIL test:early-access (${failed})`); process.exit(1); }
console.log("PASS test:early-access");
