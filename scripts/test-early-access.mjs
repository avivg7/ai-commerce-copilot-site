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
  .filter((v) => !args.includes("--only-open") || v.mode === "open")
  .filter((v) => arg0("only-variants") === undefined || arg0("only-variants").split(",").includes(v.key)); // mutation runs: only the variants a mutant can affect (the global sections always run)
const D1 = 86400e3;
// The phases of a build while it is live: only an extended OPEN build has two (new requests are open until the INITIAL end, then closed until the extended end: the Control Plane grants only before the initial end).
for (const v of VARIANTS) v.phases = v.step > 0 && v.mode === "open" ? [{ name: "requests open", t: C - D1, closed: false }, { name: "requests closed", t: ENDS[v.step] - D1, closed: true }] : [{ name: "live", t: ENDS[v.step] - D1, closed: false }];
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
    ...(step > 0 ? [["1 ms before the INITIAL cutoff", C - 1, true], ["AT the initial cutoff", C, true], ["1 s after the INITIAL cutoff", C + 1000, true]] : [])];
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
// visible elements only: the page carries both the request wording and the requests-closed wording of an extended build, and the head script shows one
const text = async (p, sel) => ((await p.locator(sel).evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).map((e) => e.innerText))).join(" | ")).replace(/\s+/g, " ");
const countIn = (hay, needle) => hay.split(needle).length - 1;
const lit = (l, step) => ({ last: { en: ["December 31, 2026", "January 31, 2027", "February 28, 2027"], he: ["31 בדצמבר 2026", "31 בינואר 2027", "28 בפברואר 2027"], es: ["31 de diciembre de 2026", "31 de enero de 2027", "28 de febrero de 2027"], ru: ["31 декабря 2026", "31 января 2027", "28 февраля 2027"] }[l][step], end: { en: ["January 1, 2027", "February 1, 2027", "March 1, 2027"], he: ["1 בינואר 2027", "1 בפברואר 2027", "1 במרץ 2027"], es: ["1 de enero de 2027", "1 de febrero de 2027", "1 de marzo de 2027"], ru: ["1 января 2027", "1 февраля 2027", "1 марта 2027"] }[l][step] });
const dateCount = (tx, l, step) => { const t = norm(tx); let n = 0; for (const k of ["last", "end"]) n += (t.match(new RegExp(`(?<![0-9])${lit(l, step)[k].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g")) || []).length; return n; };

for (const { key: mode0, mode, step, phases } of VARIANTS) {
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
      // an extended OPEN build closes new requests at the INITIAL end: from then on no request link is visible anywhere on the page, and <html data-ea-closed> is set
      const closedPhase = mode === "open" && step > 0 && t >= C && t < E;
      const reqLinks = await p.locator("a[href*='offer=early-access']").evaluateAll((a) => a.filter((x) => x.getClientRects().length > 0).length);
      const closedAttr = await p.evaluate(() => document.documentElement.hasAttribute("data-ea-closed"));
      const closedOk = (step === 0 || mode !== "open") ? !closedAttr : closedAttr === (t >= C);
      const reqOk = mode !== "open" ? reqLinks === 0 : live ? (closedPhase ? reqLinks === 0 : reqLinks >= 4) : reqLinks === 0;
      const ok = closedOk && reqOk && (live ? (!over && bar && free && struck && !ordinary && !ended && !soon && section && heroLine && band && !features && eaFeatures && (mode !== "open" || closedPhase || hdr)) : (over && !bar && !free && !struck && ordinary && ended && soon && !section && !heroLine && !band && features && !eaFeatures && !hdr));
      states.push(ok ? "." : `x(${tz}: closedAttr=${closedAttr} reqLinks=${reqLinks} over=${over} bar=${bar} free=${free} struck=${struck} ordinary=${ordinary} ended=${ended} soon=${soon} section=${section} heroLine=${heroLine} band=${band} features=${features} eaFeatures=${eaFeatures} header=${hdr})`);
      await ctx.close();
    }
    check(states.every((s) => s === "."), `${tag}: ${label} (${new Date(t).toISOString()}): ${live ? "LIVE" : "ENDED"} view in all ${ZONES.length} visitor zones${states.every((s) => s === ".") ? "" : " -> " + states.filter((s) => s !== ".").join("; ")}`);
  }

  console.log(`== ${tag}: the live view`);
  {
    const { ctx, p } = await view(mode0, "/pricing/", "Asia/Jerusalem", C - D1);
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
      check(norm(await text(p, ".aicc-eabar")).includes(norm(ea.extended.bar)), `the bar says: ${ea.extended.bar} (also in announce builds: the moved date is never silent)`);
      check(norm(sectFull).includes(norm(ea.section.who.dExtended)) && !norm(sectFull).includes(norm(ea.section.who.d)), "who-it-is-for says what the Control Plane does: nothing is granted in the final 24 hours before the ORIGINAL end date, and new requests are closed from that date");
    } else check((await p.locator("[data-ea-extended-note]").count()) === 0, "a step-0 build has no extension note");
    const hrefs = await p.locator(".aicc-plan a.aicc-btn").evaluateAll((a) => a.map((x) => x.getAttribute("href")));
    if (mode === "open") check(hrefs.length === 3 && hrefs.every((h) => /offer=early-access/.test(h) && /plan=(solo|studio|agency)/.test(h)), `open: each plan button leads to Early Access with its plan (${hrefs.join(" ")})`);
    else { check(hrefs.length === 0, "announce: no plan button leads anywhere (nothing to sign up for yet)"); check((await text(p, ".aicc-plan [data-ea-soon]")).split("|").length === 3, "announce: each card says 'Early Access opens soon'"); }
    // one primary action per card while live
    check((await p.locator(".aicc-plan [data-ea-live] a.aicc-btn, .aicc-plan [data-ea-live] p.aicc-btn").evaluateAll((a) => a.filter((x) => x.getClientRects().length > 0).length)) === 3, "exactly one (visible) action per plan card");
    await ctx.close();
  }

  console.log(`== ${tag}: the Home hero in the live view`);
  {
    const { ctx, p } = await view(mode0, "/", "Asia/Jerusalem", C - D1);
    check(norm(await text(p, "h1")) === "More relevant recommendations. More opportunities to sell.", "hero headline (Production 21)");
    check(/shows in your dashboard what it recommends/.test(await text(p, ".aicc-hero-lead")) && !/\b(boost|increase|lift|grow|revenue|conversion|buyers?)\b|%/i.test(await text(p, "h1, .aicc-hero-lead")), "hero lead makes only the approved dashboard claim and no result word (boost, increase, lift, grow, revenue, conversion, buyers, percent)");
    const visActions = (await p.locator(".aicc-hero .aicc-hero-actions .aicc-btn").evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).map((e) => e.textContent.trim()))).join(" | ");
    check(mode === "open" ? visActions === "Request free Early Access | See it in action" : visActions === "How Early Access works | See it in action", `hero actions while live (${visActions})`);
    check(norm(await text(p, ".aicc-eanote")) === norm(ea.hero.note) && /No credit card required\. Access ends at 00:00 on .*, Israel time, and nothing is charged automatically\./.test(await text(p, ".aicc-eanote")), `hero fine print: no card, the end instant with its time zone, nothing charged automatically (${norm(ea.hero.note)})`);
    if (mode === "open") check(/Request Early Access/.test(await p.locator(".aicc-site-header a[data-ea-live]").first().textContent()), "open: the header button says the same thing as the hero button");
    check(await vis(p, ".aicc-eabar"), "the announcement bar is visible");
    if (step > 0) check(norm(await text(p, "[data-ea-extended-note]")) === norm(ea.extended.note), "Home carries the extension note too (the moved date is never silent beyond Pricing)");
    // the bar sits under the header and above the hero (no overlap)
    const g = await p.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { header: r(".aicc-site-header").bottom, barTop: r(".aicc-eabar").top, barBottom: r(".aicc-eabar").bottom, h1: r("h1").top }; });
    check(g.barTop >= g.header - 0.5 && g.h1 > g.barBottom, `the bar sits below the header (${Math.round(g.header)}px) and above the headline (bar ${Math.round(g.barTop)}-${Math.round(g.barBottom)}px, h1 at ${Math.round(g.h1)}px)`);
    // keyboard: the bar link is reachable and shows a focus ring
    await p.keyboard.press("Tab"); let reached = false;
    for (let i = 0; i < 20 && !reached; i++) { reached = await p.evaluate(() => document.activeElement?.classList.contains("aicc-eabar__link")); if (!reached) await p.keyboard.press("Tab"); }
    check(reached, "the bar link is reachable with the Tab key");
    await ctx.close();
  }

  // ── an extended OPEN build: from the INITIAL end until the extended end no request is offered (the Control Plane grants only before the initial end) ──
  if (step > 0 && mode === "open") {
    console.log(`== ${tag}: from the initial end until the extended end the page offers no request`);
    const TC = ENDS[step] - D1;
    const visCount = (p, sel) => p.locator(sel).evaluateAll((a) => a.filter((x) => x.getClientRects().length > 0).length);
    { const { ctx, p } = await view(mode0, "/pricing/", "Asia/Jerusalem", TC);
      check(await p.evaluate(() => document.documentElement.hasAttribute("data-ea-closed") && !document.documentElement.hasAttribute("data-ea-over")), "requests closed: <html data-ea-closed> is set and the page is still live (not ended)");
      check((await visCount(p, "a[href*='offer=early-access']")) === 0, "requests closed: no visible link anywhere on Pricing leads to the request flow (header, plan cards, closing band)");
      const hdr = await p.locator(".aicc-site-header a.aicc-btn--primary").evaluateAll((a) => a.filter((x) => x.getClientRects().length > 0).map((x) => [x.textContent.trim(), x.getAttribute("href")]));
      check(hdr.length === 1 && hdr[0][0] === ea.bar.link && /\/pricing\/#early-access$/.test(hdr[0][1]), `requests closed: exactly one primary header button, "${ea.bar.link}", leading to the explanation (${JSON.stringify(hdr)})`);
      const cards = await p.locator(".aicc-plan").evaluateAll((a) => a.map((c) => ({ closed: [...c.querySelectorAll("p.aicc-btn")].filter((x) => x.getClientRects().length > 0).map((x) => x.textContent.trim()), links: [...c.querySelectorAll("a.aicc-btn")].filter((x) => x.getClientRects().length > 0).length })));
      check(cards.length === 3 && cards.every((c) => c.links === 0 && c.closed.length === 1 && c.closed[0] === ea.plan.ctaClosed), `requests closed: every plan card shows "${ea.plan.ctaClosed}" and no action (${JSON.stringify(cards[0])})`);
      const tx = norm(await p.evaluate(() => document.body.innerText));
      check(tx.includes(norm(ea.extended.barClosed)) && tx.includes(norm(ea.extended.closedNote)) && tx.includes(norm(ea.section.homeLeadClosed)) && tx.includes(norm(ea.section.steps.requestClosed.title)) && tx.includes(norm(ea.section.steps.requestClosed.body)) && tx.includes(norm(ea.section.who.dExtended)), "requests closed: the bar, the second note, the offer line, the request step and who-it-is-for all say the extension is for stores already in Early Access and that requests closed at the original end date");
      check(!tx.includes(norm(ea.section.steps.request.title)) && !tx.includes(norm(ea.hero.ctaOpen)) && !tx.includes(norm(ea.header.cta)) && !tx.includes(norm(ea.section.homeLead)) && !tx.includes(norm(ea.extended.bar)), "requests closed: no request sentence is on the page (no 'Request access', no 'Request free Early Access', no 'Request Early Access', no 'for approved stores' offer line)");
      const band = await p.locator("#pricing-final").evaluate((e) => { const sec = e.closest("section"); return [...sec.querySelectorAll("[data-ea-live] a.aicc-btn")].filter((x) => x.getClientRects().length > 0).map((x) => x.textContent.trim()); });
      check(band.length === 1 && band[0] === ea.hero.ctaAnnounce, `requests closed: the closing band offers only "${ea.hero.ctaAnnounce}" (${JSON.stringify(band)})`);
      await ctx.close(); }
    { const { ctx, p } = await view(mode0, "/", "Asia/Jerusalem", TC);
      const acts = await p.locator(".aicc-hero .aicc-hero-actions .aicc-btn").evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).map((e) => [e.textContent.trim(), e.classList.contains("aicc-btn--primary"), e.getAttribute("href")]));
      check(acts.length === 2 && acts[0][0] === ea.hero.ctaAnnounce && acts[0][1] && /\/pricing\/#early-access$/.test(acts[0][2]) && acts[1][0] === "See it in action" && !acts[1][1], `requests closed: the hero has one primary action "${ea.hero.ctaAnnounce}" and "See it in action" (${JSON.stringify(acts.map((a) => a[0]))})`);
      check(norm(await text(p, ".aicc-eanote")) === norm(ea.hero.noteClosed), `requests closed: the fine print says ${norm(ea.hero.noteClosed)}`);
      check((await visCount(p, "a[href*='offer=early-access']")) === 0, "requests closed: no visible link on Home leads to the request flow");
      await ctx.close(); }
    { const { ctx, p } = await view(mode0, "/", "Asia/Jerusalem", C - D1);
      const acts = await p.locator(".aicc-hero .aicc-hero-actions .aicc-btn").evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).map((e) => e.textContent.trim()));
      check(acts.join(" | ") === `${ea.hero.ctaOpen} | See it in action`, `requests open (before the initial end): the hero offers the request as before (${acts.join(" | ")})`);
      await ctx.close(); }
  }
  // ── the extension note never sits under the mascot (R4-F1: the wrapped figure overhung the note by 32 px on phones in every extended build) ──
  if (step > 0) {
    console.log(`== ${tag}: the extension note is clear of the mascot (320-640 px and desktop, four languages)`);
    for (const loc of ["en", "he", "es", "ru"]) for (const ph of phases) for (const w of QUICK ? [320, 390, 640, 1280] : [320, 360, 390, 430, 480, 560, 640, 768, 1024, 1280]) {
      const prefix = loc === "en" ? "" : `/${loc}`;
      const { ctx, p } = await view(mode0, `${prefix}/pricing/`, "UTC", ph.t, w, loc);
      const g = await p.evaluate(() => {
        const vis = (e) => e.getClientRects().length > 0;
        const fig = document.querySelector("#early-access .aicc-reco-figure").getBoundingClientRect();
        const notes = [...document.querySelectorAll("#early-access .aicc-eaextended")].filter(vis).map((e) => e.getBoundingClientRect());
        const inter = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const img = document.querySelector("#early-access .aicc-reco-figure img")?.getBoundingClientRect();
        return { n: notes.length, hit: notes.filter((r) => inter(fig, r) || (img && inter(img, r))).length, gap: notes.length ? Math.round(notes[0].top - Math.max(fig.bottom, 0)) : null };
      });
      check(g.n >= 1 && g.hit === 0, `${tag} ${loc}${phases.length > 1 ? ` [${ph.name}]` : ""} @${w}: the extension note(s) (${g.n}) do not intersect the mascot box`);
      await ctx.close();
    }
  }

  console.log(`== ${tag}: above the fold (Production 21): the whole headline, the primary action and the fine print without scrolling`);
  for (const ph of phases) for (const [w, h] of [[1280, 720], [390, 844]]) {
    const { ctx, p } = await view(mode0, "/", "Asia/Jerusalem", ph.t, w, "en", h);
    const m = await p.evaluate(() => {
      const vq = (q) => [...document.querySelectorAll(q)].find((e) => e.getClientRects().length > 0);
      const r = (s) => { const e = vq(s); const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, right: b.right, left: b.left }; };
      const prim = [...document.querySelectorAll(".aicc-hero .aicc-hero-actions .aicc-btn--primary")].find((e) => e.getClientRects().length > 0).getBoundingClientRect();
      const h1 = document.querySelector("h1");
      // a word wider than the headline's own box is broken in the middle (or clipped)
      const probe = document.createElement("span"); probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap"; const cs = getComputedStyle(h1); probe.style.font = cs.font; probe.style.letterSpacing = cs.letterSpacing; document.body.appendChild(probe);
      let longest = 0; for (const word of h1.textContent.trim().split(/\s+/)) { probe.textContent = word; longest = Math.max(longest, probe.getBoundingClientRect().width); } probe.remove();
      const hdr = document.querySelector(".aicc-site-header").getBoundingClientRect();
      return { h1: r("h1"), prim: { top: prim.top, bottom: prim.bottom }, note: r(".aicc-eanote"), vh: innerHeight, vw: innerWidth, longest, h1w: h1.clientWidth, h1scroll: h1.scrollWidth, hdr: hdr.height, noteLines: Math.round(vq(".aicc-eanote").getBoundingClientRect().height / parseFloat(getComputedStyle(vq(".aicc-eanote")).lineHeight || "20")) };
    });
    check(m.h1.bottom <= m.vh && m.prim.bottom <= m.vh && m.note.bottom <= m.vh, `${tag}${phases.length > 1 ? ` [${ph.name}]` : ""} @${w}x${h}: the full headline (bottom ${Math.round(m.h1.bottom)}), the primary action (bottom ${Math.round(m.prim.bottom)}) and the fine print (bottom ${Math.round(m.note.bottom)}) are all above the fold (${m.vh}px)`);
    check(m.longest <= m.h1w + 0.5 && m.h1scroll <= m.h1w + 1 && m.h1.left >= 0 && m.h1.right <= m.vw, `${tag} @${w}x${h}: nothing in the headline is clipped or broken mid-word (longest word ${Math.round(m.longest)}px in ${m.h1w}px)`);
    check(m.hdr >= 70 && m.hdr <= 80, `${tag}${phases.length > 1 ? ` [${ph.name}]` : ""} @${w}x${h}: the header keeps its token height (${Math.round(m.hdr)}px, token 76)`);
    await ctx.close();
  }
  // the headline word fits the column at every desktop width (it broke in the middle of "recommendations." at 1024 px before Production 21), in every language
  for (const loc of ["en", "he", "es", "ru"]) for (const [w, h] of QUICK ? [[1024, 1000]] : [[1024, 768], [1024, 1000], [1100, 800], [1100, 1000], [1180, 820], [1280, 720], [1440, 900]]) {
    const prefix = loc === "en" ? "" : `/${loc}`;
    const { ctx, p } = await view(mode0, `${prefix}/`, "UTC", C - D1, w, loc, h);
    const m = await p.evaluate(() => { const h1 = document.querySelector("h1"); const probe = document.createElement("span"); probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap"; const cs = getComputedStyle(h1); probe.style.font = cs.font; probe.style.letterSpacing = cs.letterSpacing; document.body.appendChild(probe); let longest = 0; for (const word of h1.textContent.trim().split(/\s+/)) { probe.textContent = word; longest = Math.max(longest, probe.getBoundingClientRect().width); } probe.remove(); return { longest, w: h1.clientWidth }; });
    check(m.longest <= m.w + 0.5, `${tag} ${loc} @${w}: the longest headline word fits its column (${Math.round(m.longest)}px in ${m.w}px)`);
    await ctx.close();
  }

  console.log(`== ${tag}: no horizontal overflow (live view)`);
  for (const ph of phases) for (const w of QUICK ? [390] : [320, 390, 768, 1280]) for (const route of ["/", "/pricing/"]) {
    const { ctx, p } = await view(mode0, route, "UTC", ph.t, w);
    const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check(o.sw <= o.iw, `${tag}${phases.length > 1 ? ` [${ph.name}]` : ""} ${route} at ${w}px: no horizontal scroll (${o.sw} <= ${o.iw})`);
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

console.log("\n== the hero headline: no word breaks mid-word (phone widths, four languages), the second sentence starts its own line, the ordinary hero keeps its fold");
{
  const probeJs = () => {
    const h1 = document.querySelector("h1");
    const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
    const broken = []; let lastLead = null; let accentTop = null; let accentEdge = null; const accent = h1.querySelector(".aicc-text-gradient");
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (const m of n.data.matchAll(/\S+/g)) {
        const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        const rects = [...r.getClientRects()]; if (new Set(rects.map((x) => Math.round(x.top))).size > 1) broken.push(m[0]);
      }
      const nr = document.createRange(); nr.selectNodeContents(n); const rr = [...nr.getClientRects()];
      if (accent && accent.contains(n)) { if (accentTop === null && rr.length) { accentTop = rr[0].top; accentEdge = rr[0]; } } else if (rr.length) lastLead = rr[rr.length - 1];
    }
    const hy = getComputedStyle(h1).hyphens;
    // rect boxes are taller than the line height, so compare line TOPS and require the accent to start at the line start edge
    const hb = h1.getBoundingClientRect(), rtl = getComputedStyle(h1).direction === "rtl";
    const atStart = accentEdge && (rtl ? Math.abs(hb.right - accentEdge.right) < 4 : Math.abs(accentEdge.left - hb.left) < 4);
    return { broken, ownLine: !accent || (accentTop !== null && lastLead !== null && accentTop > lastLead.top + 5 && !!atStart), hy, accentDisplay: accent ? getComputedStyle(accent).display : null };
  };
  for (const key of ["off", "open"]) for (const loc of ["en", "he", "es", "ru"]) for (const w of QUICK ? [320, 390, 480, 1280] : [320, 360, 390, 430, 480, 640, 768, 1024, 1280]) {
    const prefix = loc === "en" ? "" : `/${loc}`;
    const { ctx, p } = await view(key, `${prefix}/`, "UTC", C - D1, w, loc);
    const m = await p.evaluate(probeJs);
    check(m.broken.length === 0 && m.hy !== "auto", `${key} ${loc} @${w}: no hero headline word is broken across lines (hyphens: ${m.hy})${m.broken.length ? " -> " + m.broken.join(", ") : ""}`);
    check(m.ownLine && m.accentDisplay === "block", `${key} ${loc} @${w}: the second sentence of the headline starts its own line (accent display ${m.accentDisplay})`);
    await ctx.close();
  }
  // the ordinary (campaign OFF) hero keeps its fold on laptop heights as it did in Production 20: the primary action is above the fold at 1280x720 and 1536x730
  for (const loc of ["en", "he"]) for (const [w, h] of [[1280, 720], [1536, 730], [1366, 768], [1440, 900]]) {
    const prefix = loc === "en" ? "" : `/${loc}`;
    const { ctx, p } = await view("off", `${prefix}/`, "UTC", C - D1, w, loc, h);
    const m = await p.evaluate(() => { const prim = [...document.querySelectorAll(".aicc-hero .aicc-hero-actions .aicc-btn--primary")].find((e) => e.getClientRects().length > 0).getBoundingClientRect(); return { bottom: prim.bottom, vh: innerHeight }; });
    check(m.bottom <= m.vh, `normal build ${loc} @${w}x${h}: the primary hero action is above the fold (bottom ${Math.round(m.bottom)} of ${m.vh})`);
    await ctx.close();
  }
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
  for (const { key, mode, step, phases } of VARIANTS) for (const [loc, [zone, auto]] of Object.entries(TOK)) {
    const prefix = loc === "en" ? "" : `/${loc}`, E = ENDS[step];
    for (const ph of phases) for (const w of QUICK ? [320, 768, 1280] : [320, 360, 390, 480, 640, 768, 1024, 1280]) {
      const { ctx, p } = await view(key, `${prefix}/pricing/`, "UTC", ph.t, w, loc);
      const bar = await p.evaluate(() => { const b = document.querySelector(".aicc-eabar"); return { clipped: b.scrollHeight > b.clientHeight + 1, text: b.innerText }; });
      const e = EAD(loc, step);
      const want = norm(step > 0 ? (ph.closed ? e.extended.barClosed : e.extended.bar) : mode === "open" ? e.bar.live : e.bar.announce);
      check(!bar.clipped && bar.text.includes(zone) && norm(bar.text).includes(want), `${key} ${loc}${phases.length > 1 ? ` [${ph.name}]` : ""} at ${w}px: the bar is not clipped, says the time zone (${zone}) and the sentence of step ${step}`);
      await ctx.close();
    }
    for (const ph of phases) { const { ctx, p } = await view(key, `${prefix}/`, "UTC", ph.t, 1280, loc); const note = (await text(p, ".aicc-eanote")); check(norm(note) === norm(ph.closed ? EAD(loc, step).hero.noteClosed : EAD(loc, step).hero.note) && note.includes(zone) && note.toLowerCase().includes(auto.toLowerCase()), `${key} ${loc}${phases.length > 1 ? ` [${ph.name}]` : ""}: the hero fine print states the zone and that nothing is charged automatically (step ${step})`); await ctx.close(); }
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
  for (const { key, mode, step, phases } of VARIANTS) for (const loc of ["en", "he", "es", "ru"]) for (const route of ROUTES) for (const w of [1280, 390]) {
    const prefix = loc === "en" ? "" : `/${loc}`, E = ENDS[step], ead = EAD(loc, step);
    const tg = `${key} ${loc}${route} @${w}`;
    { const { ctx, p } = await view(key, `${prefix}${route}`, "Asia/Jerusalem", E + 1000, w, loc);
      if (w === 390) { await p.click("[data-aicc-menu-btn]").catch(() => {}); await p.waitForTimeout(100); }
      const l = await leaks(p, "[data-ea-live]"), a = await leaks(p, "[data-ea-after]");
      const needsAfter = route === "/pricing/" || route === "/";
      check(l === 0 && (!needsAfter || a > 0), `${tg}: ENDED view shows no live campaign element (${l} live visible) and the ended counterparts are present (${a})${w === 390 ? " (mobile menu open)" : ""}`);
      // Text-based probe (does not depend on the markers): none of the campaign's own sentences may be rendered after the end, whatever element carries them.
      const inner = norm(await p.evaluate(() => document.body.innerText));
      const live = [ead.hero.ctaOpen, ead.header.cta, ead.hero.ctaAnnounce, ead.section.homeLead, ead.plan.free, ead.plan.ctaAnnounce, ead.hero.note, ead.bar.live, ead.bar.announce, ead.extended.bar, ead.extended.note, ead.section.reservation, ead.section.faq.change.q, ead.extended.barClosed, ead.extended.closedNote, ead.hero.noteClosed, ead.plan.ctaClosed, ead.section.homeLeadClosed, ead.section.steps.requestClosed.title, ead.section.who.dExtended].map(norm);
      const seen = live.filter((t) => inner.includes(t));
      check(seen.length === 0, `${tg}: no campaign sentence is rendered after the end${seen.length ? " -> " + seen[0].slice(0, 60) : ""}`);
      // after the end of THIS build no date of the campaign is on the page (the ended note names the end of the build; the initial last day is nowhere, even in an extended build)
      if (step > 0) check(dateCount(inner, loc, 0) === 0, `${tg}: the ENDED view of an extended build names no date of the initial end (${dateCount(inner, loc, 0)} found)`);
      await ctx.close(); }
    for (const ph of phases) { const { ctx, p } = await view(key, `${prefix}${route}`, "Asia/Jerusalem", ph.t, w, loc);
      const tgp = phases.length > 1 ? `${tg} [${ph.name}]` : tg;
      if (w === 390) { await p.click("[data-aicc-menu-btn]").catch(() => {}); await p.waitForTimeout(100); }
      const a = await leaks(p, "[data-ea-after]"), h = await leaks(p, "[data-ea-hide-live]");
      check(a === 0 && h === 0, `${tgp}: LIVE view shows no ended-only element (${a}) and no ordinary price (${h})${w === 390 ? " (mobile menu open)" : ""}`);
      const innerLive = norm(await p.evaluate(() => document.body.innerText));
      const ended = [ead.after.title, D[loc].common.soon.band].map(norm).filter((t) => (route === "/" || route === "/pricing/") && innerLive.includes(t));
      check(ended.length === 0, `${tgp}: LIVE view renders neither the ended note nor the ordinary closing band${ended.length ? " -> " + ended[0].slice(0, 50) : ""}`);
      const prim = await p.locator(".aicc-site-header a.aicc-btn--primary").evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).length);
      check(prim === 1, `${tgp}: exactly one primary header button is visible (${prim})${w === 390 ? " (mobile menu open)" : ""}`);
      // Request wording per phase (an extended OPEN build; the Control Plane grants only before the INITIAL end): the request sentences are on the page while requests are open and nowhere afterwards,
      // the requests-closed sentences only afterwards. Text-based (innerText), not marker-based, in four languages.
      if (step > 0 && mode === "open") {
        const intake = [ead.hero.ctaOpen, ead.header.cta, ead.plan.ctaOpen, ead.section.homeLead, ead.hero.note, ead.section.steps.request.title, ead.section.who.d].map(norm);
        const closedS = [ead.extended.barClosed, ead.extended.closedNote, ead.hero.noteClosed, ead.section.homeLeadClosed].map(norm); // the short titles are checked by marker below: he "בקשות חדשות סגורות" is also inside a legitimate longer sentence
        const wrongWording = (ph.closed ? intake : closedS).filter((t) => innerLive.includes(t));
        check(wrongWording.length === 0, `${tgp}: ${ph.closed ? "no request wording" : "no requests-closed wording"} is rendered${wrongWording.length ? " -> " + wrongWording[0].slice(0, 60) : ""}`);
        check(innerLive.includes(norm(ph.closed ? ead.extended.barClosed : ead.extended.bar)), `${tgp}: the bar says the ${ph.closed ? "requests-closed" : "extended"} sentence`);
        const must = route === "/" ? (ph.closed ? [ead.hero.noteClosed, ead.section.homeLeadClosed, ead.plan.ctaClosed] : [ead.hero.note, ead.section.homeLead, ead.hero.ctaOpen]) : route === "/pricing/" ? (ph.closed ? [ead.extended.closedNote, ead.section.homeLeadClosed, ead.plan.ctaClosed, ead.section.steps.requestClosed.title] : [ead.section.homeLead, ead.plan.ctaOpen, ead.section.steps.request.title]) : [];
        const absent = must.map(norm).filter((t) => !innerLive.includes(t));
        check(absent.length === 0, `${tgp}: the ${ph.closed ? "requests-closed" : "request"} sentences of this page are rendered${absent.length ? " -> missing " + absent[0].slice(0, 60) : ""}`);
        const wrongMarked = await p.evaluate((closed) => [...document.querySelectorAll(closed ? "[data-ea-intake]" : "[data-ea-closed-only]")].filter((e) => e.getClientRects().length > 0).length, ph.closed);
        check(wrongMarked === 0, `${tgp}: no ${ph.closed ? "request (data-ea-intake)" : "requests-closed (data-ea-closed-only)"} block is visible (${wrongMarked})`);
        const reqLinks = await p.locator("a[href*='offer=early-access']").evaluateAll((a) => a.filter((x) => x.getClientRects().length > 0).length);
        check(ph.closed ? reqLinks === 0 : reqLinks >= 1 || w === 390 && route !== "/" && route !== "/pricing/", `${tgp}: ${ph.closed ? "no visible link leads to the request flow" : "the request flow is linked"} (${reqLinks})`);
      }
      // The initial-end leak probe (Production 21), text-based: in an extended build, after the INITIAL cutoff but before the step's end, no sentence or date of the initial end is rendered
      // anywhere, on any page, in any language (the one allowed mention is the extension note on the pricing page: "first announced to end on ..."), and the campaign sentences ARE the step's.
      if (step > 0) {
        const first = EAD(loc, 0);
        const stale = [first.bar.live, first.bar.announce, first.hero.note, first.plan.free, first.plan.term, first.plan.ends, first.section.homeLead, first.section.title, first.section.lead, first.after.body, first.section.endTitle].map(norm).filter((t) => innerLive.includes(t));
        check(stale.length === 0, `${tgp}: no initial-end sentence is rendered in the extended build${stale.length ? " -> " + stale[0].slice(0, 70) : ""}`);
        const allowed = route === "/pricing/" || route === "/" ? 1 : 0;
        check(dateCount(innerLive, loc, 0) === allowed, `${tgp}: dates of the initial end appear ${dateCount(innerLive, loc, 0)} time(s) (allowed ${allowed}: only the extension note names the initial last day)`);
        if (route === "/pricing/" || route === "/") check(dateCount(innerLive, loc, step) >= 1, `${tgp}: the page names this step's dates`);
      }
      await ctx.close(); }
  }
  console.log("== destinations and names (live view)");
  for (const { key, mode, step } of VARIANTS) {
    const { ctx, p } = await view(key, "/", "UTC", C - D1, 1280);
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
    const { ctx: c2, p: p2 } = await view(key, "/pricing/", "UTC", C - D1, 1280);
    const names = await p2.locator(".aicc-plan a.aicc-btn").evaluateAll((a) => a.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
    check(new Set(names).size === 3, `${key}: the three plan buttons have different accessible names (${names.join(" | ")})`);
    await c2.close();
  }
}

console.log("\n== the header keeps its token height and the bar never sits under it (every language, desktop and phone widths)");
for (const { key, step, phases } of VARIANTS.filter((v) => v.mode === "open")) for (const ph of phases) for (const loc of ["en", "he", "es", "ru"]) for (const w of QUICK ? [390, 1050] : [390, 1000, 1024, 1050, 1080, 1100, 1200, 1280]) {
  if (step > 0 && ![390, 1024, 1050, 1280].includes(w)) continue; // the tight band is the same code for every step; sample it
  const prefix = loc === "en" ? "" : `/${loc}`;
  const { ctx, p } = await view(key, `${prefix}/pricing/`, "UTC", ph.t, w, loc);
  const g = await p.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); return { header: r(".aicc-site-header").height, headerBottom: r(".aicc-site-header").bottom, barTop: r(".aicc-eabar").top, crumbs: r(".aicc-crumbs").top, barBottom: r(".aicc-eabar").bottom }; });
  check(Math.abs(g.header - 76) <= 1 && g.barTop >= g.headerBottom - 0.5, `${key} ${ph.name} ${loc} @${w}: the header is ${Math.round(g.header)}px (token 76) and the bar starts below it (bar ${Math.round(g.barTop)}, header bottom ${Math.round(g.headerBottom)})`);
  check(g.crumbs - g.barBottom <= 80, `${key} ${loc} @${w}: no empty gap under the bar on an inner page (${Math.round(g.crumbs - g.barBottom)}px to the breadcrumb)`);
  await ctx.close();
}
console.log("\n== Hebrew (right-to-left), live view");
for (const { key, step, phases } of VARIANTS.filter((v) => v.mode === "open")) for (const ph of phases) {
  const { ctx, p } = await view(key, "/he/pricing/", "Asia/Jerusalem", ph.t, 390, "he");
  const m = await p.evaluate(() => ({ dir: document.documentElement.dir, over: document.documentElement.scrollWidth <= window.innerWidth, bar: !!document.querySelector(".aicc-eabar"), free: [...document.querySelectorAll(".aicc-plan__free")].map((e) => e.textContent) }));
  check(m.dir === "rtl" && m.over && m.bar && m.free.length === 3, `${key} ${ph.name} he: rtl, no overflow, bar and three offers present (${m.free[0] || "?"})`);
  await ctx.close();
}

await browser.close();
servers.forEach((s) => s.kill());
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed) { console.error(`FAIL test:early-access (${failed})`); process.exit(1); }
console.log("PASS test:early-access");
