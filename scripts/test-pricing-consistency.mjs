// npm run test:pricing-consistency (P39, rewritten for the P40 premium section): parses EVERY built page of a self-service export in four languages (rendered text of the LIVE view, in Chromium with JavaScript OFF) and asserts the exact numbers, dates and clocks:
//   * prices 99 / 199 / 499 USD, paid capacity 1 / up to 3 / up to 10, "Launch trial: 1 store", FREE, the planned-price label, the positioning line and the status region on every plan card (Home and Pricing);
//   * the TWO dates as two labelled timeline steps in ONE launch panel per page (Home and Pricing), each said exactly ONCE on the page, written here as INDEPENDENT literals per language (not read from the dictionaries): registration closes
//     December 24, 2026 at 00:00 UTC (the last day to start is December 23), trial access ends December 31, 2026 at 22:00 UTC; NO date or clock in a card, the header, the band, the finder or any other page; no other deadline;
//   * the panel's three facts (one store incl. staging, no payment method, no automatic conversion) are the exact strings, in the panel only;
//   * no stale phrase of the old policy (approved stores only, requests close 24 hours before, "Request Free Access", Israel / local time zone, "was $", "save N", %, "no credit card", ...) on any marketing page; legal pages keep their geography and are
//     asserted UNCHANGED against the base (S0) export; no /request-access/ link; JSON-LD carries no Offer / price; the sitemap lists no sign-up page; no struck price in the default build;
//   * the meta description of Pricing and the structured data say the same numbers as the page.
//   node scripts/test-pricing-consistency.mjs --dir <self-service export> [--base <S0 export built from the same commit family>] [--link <initial=link export>] [--port <n>]
import fs from "node:fs";
import path from "node:path";
import { launch } from "./lib/browser.mjs";
import { startMock } from "./lib/intake-mock.mjs";
import { loadTs } from "./lib/load.mjs";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? path.resolve(args[i + 1]) : undefined; };
const DIR = arg("dir"), BASE = arg("base"), LINK = arg("link");
const PORT = (() => { const i = args.indexOf("--port"); return i >= 0 ? Number(args[i + 1]) : 0; })();
if (!DIR) { console.error("usage: --dir <self-service export> [--base <S0 export>] [--link <link-initial export>] [--port <n>]"); process.exit(2); }
let failed = 0, total = 0;
const check = (c, m) => { total++; if (!c) { failed++; console.error("  FAIL " + m); } else console.log("  ok   " + m); };
const LOCALES = ["en", "he", "es", "ru"];
const pre = (l) => (l === "en" ? "" : `/${l}`);
const { PLANS } = await loadTs("src/data/plans.ts");

// INDEPENDENT literals (the facts of the product, per language). Spaces are plain after normalisation; Hebrew bidi isolates are stripped.
const T = {
  en: { perShort: "/ year", afterOffer: "Starts after the launch offer", how: "See how it works", line: "Free trial registration isn't open yet.", reg: "Dec 24, 2026 at 00:00 UTC", end: "Dec 31, 2026 at 22:00 UTC", regLabel: "Registration closes", endLabel: "Trial access ends", regNote: "The last day to start a trial is December 23, 2026 (UTC).", endNote: "For every trial, whichever day you started.", free: "FREE", trial: "Launch trial: 1 store", paid: ["Paid plan: 1 store", "Paid plan: up to 3 stores", "Paid plan: up to 10 stores"], priceLabel: "Planned regular price", per: "per year", store: "The trial covers 1 store, whichever plan you choose. A staging site counts as a store.", pay: "No payment method is required, so nothing is charged.", noAuto: "No automatic conversion to a paid plan. Continuing is your decision.", foot: "Paid plans are not open for purchase yet. Their planned regular prices apply once they open.", soon: "Free trial opens soon", soonNote: "Registration is not open yet. This page shows a start button as soon as it opens.", price: (p) => `$${p}` },
  he: { perShort: "/ שנה", afterOffer: "מתחיל אחרי הצעת ההשקה", how: "ראו איך זה עובד", line: "ההרשמה לניסיון החינם עדיין לא נפתחה.", reg: "24 בדצמבר 2026 בשעה 00:00 UTC", end: "31 בדצמבר 2026 בשעה 22:00 UTC", regLabel: "ההרשמה נסגרת", endLabel: "הגישה לניסיון מסתיימת", regNote: "היום האחרון להתחיל ניסיון הוא 23 בדצמבר 2026 (UTC).", endNote: "לכל ניסיון, בלי קשר ליום שבו התחלתם.", free: "חינם", trial: "ניסיון השקה: חנות אחת", paid: ["תוכנית בתשלום: חנות אחת", "תוכנית בתשלום: עד 3 חנויות", "תוכנית בתשלום: עד 10 חנויות"], priceLabel: "מחיר רגיל מתוכנן", per: "לשנה", store: "הניסיון כולל חנות אחת, בכל תוכנית שתבחרו. אתר בדיקות נחשב לחנות.", pay: "לא נדרש אמצעי תשלום, ולכן לא נגבה דבר.", noAuto: "אין מעבר אוטומטי לתוכנית בתשלום. ההמשך הוא החלטה שלכם.", foot: "רכישות בתשלום עדיין אינן פתוחות. המחירים הרגילים המתוכננים יחולו כשייפתחו.", soon: "ניסיון החינם ייפתח בקרוב", soonNote: "ההרשמה עדיין לא נפתחה. כפתור התחלה יופיע כאן ברגע שתיפתח.", price: (p) => `$${p}` },
  es: { perShort: "/ año", afterOffer: "Empieza después de la oferta de lanzamiento", how: "Ver cómo funciona", line: "El registro de la prueba gratuita aún no está abierto.", reg: "24 dic 2026 a las 00:00 UTC", end: "31 dic 2026 a las 22:00 UTC", regLabel: "El registro se cierra", endLabel: "El acceso de prueba termina", regNote: "El último día para empezar una prueba es el 23 de diciembre de 2026 (UTC).", endNote: "Para cada prueba, sea cual sea el día en que la empezó.", free: "GRATIS", trial: "Prueba de lanzamiento: 1 tienda", paid: ["Plan de pago: 1 tienda", "Plan de pago: hasta 3 tiendas", "Plan de pago: hasta 10 tiendas"], priceLabel: "Precio regular previsto", per: "al año", store: "La prueba cubre 1 tienda, sea cual sea el plan que elija. Un sitio de pruebas cuenta como una tienda.", pay: "No hace falta método de pago, así que no se cobra nada.", noAuto: "No pasa automáticamente a un plan de pago. Seguir es decisión suya.", foot: "Las compras de pago aún no están abiertas. Los precios regulares previstos se aplicarán cuando se abran.", soon: "La prueba gratuita abrirá pronto", soonNote: "El registro aún no está abierto. Aquí aparecerá un botón para empezar en cuanto se abra.", price: (p) => `US$${p}` },
  ru: { perShort: "/ год (USD)", afterOffer: "Начинается после предложения в честь запуска", how: "Как это работает", line: "Регистрация на бесплатный пробный период ещё не открыта.", reg: "24 дек. 2026 г. в 00:00 UTC", end: "31 дек. 2026 г. в 22:00 UTC", regLabel: "Регистрация закрывается", endLabel: "Пробный доступ заканчивается", regNote: "Последний день, когда можно начать пробный период, это 23 декабря 2026 г. (UTC).", endNote: "Для любого пробного периода, в какой бы день вы его ни начали.", free: "БЕСПЛАТНО", trial: "Пробный период запуска: 1 магазин", paid: ["Платный план: 1 магазин", "Платный план: до 3 магазинов", "Платный план: до 10 магазинов"], priceLabel: "Планируемая обычная цена", per: "в год (USD)", store: "Пробный период охватывает 1 магазин, какой бы план вы ни выбрали. Тестовая копия считается магазином.", pay: "Способ оплаты не нужен, поэтому ничего не списывается.", noAuto: "Автоматического перехода на платный план нет. Продолжить или нет, решаете вы.", foot: "Платные планы пока нельзя купить. Планируемые обычные цены начнут действовать, когда покупка станет доступна.", soon: "Бесплатный период скоро откроется", soonNote: "Регистрация пока не открыта. Кнопка запуска появится здесь, как только она откроется.", price: (p) => `$${p}` },
};
const norm = (s) => String(s).replace(/[⁦⁩]/g, "").replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();
// every spelling of a calendar date of 2026/2027 in the four languages, for the census of dates in the rendered text
const MONTHS = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|ene|enero|feb|febrero|marzo|abr|abril|mayo|jun|junio|jul|julio|ago|agosto|sep|septiembre|oct|octubre|nov|noviembre|dic|diciembre|янв\\w*|февр?\\w*|март\\w*|апр\\w*|ма[яй]|июн\\w*|июл\\w*|авг\\w*|сент?\\w*|окт\\w*|нояб?\\w*|дек\\w*";
const DATE_RE = new RegExp(`(?:\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:,)?\\s+(?:2026|2027)|\\d{1,2}\\s+(?:de\\s+)?(?:${MONTHS})\\.?\\s+(?:de\\s+)?(?:2026|2027)|\\b(?:${MONTHS})\\.?\\s+(?:2026|2027))`, "giu");
const STALE = [
  [/approved stores?|stores? (?:are|is) approved|approval required/i, "approved stores only / approval required"], [/requests? close|close to new requests|24 hours before (?:it|the)/i, "requests close 24 hours before (the old Dec 30 cutoff)"],
  [/request(?:ing)? (?:free )?access|Request Free Access/i, "request access wording"], [/free access requests/i, "free access requests coming soon"], [/no credit card|credit card/i, "credit card wording"],
  [/\bIsrael\b|Israeli|Jerusalem|ישראל|Израил|hora de Israel/i, "Israel / local time zone"], [/\bwas \$|\bsave\s+\d|\bsave up|\d\s?% ?(?:off|discount|cheaper|less)|\bdiscount\b|strike-?through/i, "was $ / save N / N% off / discount"],
  [/\bJanuary 1, 2027|1 בינואר 2027|1 de enero de 2027|1 января 2027|Jan(?:uary)? 10|10 בינואר|10 de enero|10 января/i, "a January date (the Jan 10 extension is INACTIVE and January 1 is not a deadline)"],
  [/Dec(?:ember)? 30\b|30 בדצמבר|30 de diciembre|30 декабря/i, "the old December 30 cutoff"],
  [/אישור בקשה|לחנויות מאושרות|tiendas aprobadas|одобренн|кредитн|כרטיס אשראי|tarjeta de crédito/i, "approved / credit card wording (he, es, ru)"],
  [/Early Access|early access|acceso anticipado|גישה מוקדמת|ранний доступ/i, "the retired name 'Early Access'"],
];
const MARKETING = ["", "product/", "pricing/", "questions/"];
const LEGAL = ["privacy/", "terms/", "refund-policy/", "accessibility/", "data-and-trust/"]; // legal-adjacent pages: draft notices carry their own dates; unchanged against S0 (stale-phrase scan below still covers data-and-trust)

const mock = await startMock({ dir: DIR, port: PORT });
const mockLink = LINK ? await startMock({ dir: LINK, port: PORT ? PORT + 1 : 0 }) : null;
const mockBase = BASE ? await startMock({ dir: BASE, port: PORT ? PORT + 2 : 0 }) : null;
const browser = await launch();
async function read(m, route, w = 1440) {
  // JavaScript is OFF on purpose: the page is read exactly as the static HTML says it (what a crawler, a no-JS visitor and the first paint see); React would otherwise re-render the DOM and hide an edited export
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: "reduce", javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(m.url + route, { waitUntil: "load" });
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const vis = (e) => e.getClientRects().length > 0;
    const txt = (e) => e.innerText.replace(/\s+/g, " ").trim();
    const dls = [...document.querySelectorAll("ol[data-ss-dates]")].filter(vis).map((ol) => ({ rows: [...ol.querySelectorAll("[data-ss-date]")].map((r) => [r.getAttribute("data-ss-date"), txt(r.querySelector(".aicc-timeline__label")), txt(r.querySelector(".aicc-timeline__date")), txt(r.querySelector(".aicc-timeline__note"))]), where: ol.closest("[data-ss-terms]") ? "panel" : "other", facts: [...(ol.closest("[data-ss-terms]") || document.createElement("div")).querySelectorAll(".aicc-launch__fact")].map(txt), foot: txt((ol.closest("[data-ss-terms]") || document.createElement("div")).querySelector(".aicc-launch__foot") || document.createElement("p")) }));
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = walker.nextNode())) {
      const p = n.parentElement; if (!p || !vis(p) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName) || p.closest("ol[data-ss-dates]")) continue;
      out.push(n.nodeValue);
    }
    const cards = [...document.querySelectorAll("article.aicc-tier:not(.aicc-tier--standard)")].filter(vis).map((a) => ({ text: txt(a), plan: a.getAttribute("data-plan"), badge: txt(a.querySelector(".aicc-tier__badge") || document.createElement("p")), price: txt(a.querySelector(".aicc-tier__offer-price") || document.createElement("p")), label: txt(a.querySelector(".aicc-tier__offer-label") || document.createElement("p")), pill: txt(a.querySelector(".aicc-tier__offer-pill") || document.createElement("p")), tag: a.querySelector(".aicc-pcta").getAttribute("data-ss-cta"), linkText: [...a.querySelectorAll("a.aicc-btn")].map((x) => txt(x)), cap: txt(a.querySelector(".aicc-tier__cap-text")), free: txt(a.querySelector(".aicc-tier__free-word")), trial: txt(a.querySelector(".aicc-tier__trial")), status: [...a.querySelectorAll("p.aicc-pstatus")].map((e) => [txt(e.querySelector(".aicc-pstatus__label")), txt(e.querySelector(".aicc-pstatus__note"))]), links: [...a.querySelectorAll("a")].map((x) => x.getAttribute("href")), dates: [...a.querySelectorAll("[data-ss-date]")].length, struck: a.querySelectorAll("s, del, [data-ss-price='strike']").length }));
    return { pstate: [...document.querySelectorAll(".aicc-pstate")].filter(vis).map((e) => [txt(e), e.getAttribute("role"), [...e.querySelectorAll("a")].map((x) => x.getAttribute("href"))]), dls, rest: out.join(" ").replace(/\s+/g, " "), full: document.body.innerText.replace(/\s+/g, " "), cards, struck: document.querySelectorAll("main s, main del, main [data-ss-price='strike']").length, panels: document.querySelectorAll("section.aicc-launch").length, hrefs: [...document.querySelectorAll("a")].map((a) => a.getAttribute("href")), meta: document.querySelector('meta[name="description"]')?.content || "", ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent), main: (() => { const m = document.querySelector("main")?.cloneNode(true); if (!m) return ""; m.querySelectorAll(".aicc-eabar").forEach((e) => e.remove()); return m.innerHTML; })(), title: document.title };
  });
  await ctx.close();
  return r;
}

console.log("== plan cards (Home and Pricing, four languages): price, paid capacity, FREE, the trial line, the planned-price label, the status region; no date, no condition, no struck price");
for (const l of LOCALES) {
  const t = T[l];
  for (const route of ["", "pricing/"]) {
    const r = await read(mock, `${pre(l)}/${route}`);
    check(r.cards.length === 3 && JSON.stringify(r.cards.map((c) => c.plan)) === JSON.stringify(["solo", "studio", "agency"]), `${l} /${route}: three plan cards in the order Solo, Studio, Agency`);
    r.cards.forEach((c, i) => {
      const pl = PLANS[i];
      check(norm(c.price) === norm(`${t.price(pl.price)} ${t.perShort}`) && norm(c.label) === norm(t.priceLabel) && norm(c.pill) === norm(t.afterOffer) && norm(c.cap) === t.paid[i] && norm(c.free) === t.free && norm(c.trial) === t.trial, `${l} /${route} ${pl.id}: "${t.price(pl.price)} ${t.perShort}" under "${t.priceLabel}" with the pill "${t.afterOffer}", "${t.paid[i]}", "${t.free}", "${t.trial}"`);
      check(c.status.length === 0 && c.tag === "info" && c.links.length === 1 && c.links[0] === `${pre(l)}/get-started/?plan=${pl.id}` && c.linkText.length === 1 && norm(c.linkText[0]).startsWith(norm(t.how)) && !norm(c.text).includes(norm(t.line)), `${l} /${route} ${pl.id}: the static control is a REAL link "${t.how}" to ${pre(l)}/get-started/?plan=${pl.id} (no inert pill, no explanation paragraph under the card)`);
      check(c.dates === 0 && !/\b\d{1,2}:\d{2}\b/.test(c.text) && !new RegExp(DATE_RE.source, "iu").test(c.text) && ![t.store, t.pay, t.noAuto, t.reg, t.end].some((x) => norm(c.text).includes(norm(x))), `${l} /${route} ${pl.id}: the card carries no date, no clock and none of the three trial facts (they are said once, in the panel)`);
      check(c.struck === 0 && !/was \$|save/i.test(c.text), `${l} /${route} ${pl.id}: the regular price is not struck through and no "was" / "save" wording`);
      check(pl.featured ? norm(c.badge) !== "" : c.badge === "", `${l} /${route} ${pl.id}: ${pl.featured ? "carries the Recommended badge" : "carries no badge"}`);
    });
    check(r.pstate.length === 1 && norm(r.pstate[0][0]).startsWith(norm(t.line)) && r.pstate[0][1] === "status" && r.pstate[0][2].length === 1 && r.pstate[0][2][0] === `${pre(l)}/#demo`.replace(/^\/#/, "/#"), `${l} /${route}: ONE compact status line "${t.line}" (role=status) with the working Live Demo link ${pre(l)}/#demo; the fact is not repeated under any card`);
    const prices = [...new Set([...r.full.matchAll(/(?:US)?\$\s?(\d{2,4})/g)].map((m) => Number(m[1])).filter((n) => ![99, 199, 499].includes(n)))];
    check(prices.length === 0 || route === "", `${l} /${route}: no price other than $99 / $199 / $499 on the page${prices.length ? " (" + prices + ")" : ""}`);
  }
}
console.log("== the ONE launch panel per page (Home and Pricing): both labelled dates exactly once, the three facts, the footnote; no panel and no date anywhere else (Product, Questions)");
let censusPages = 0;
for (const l of LOCALES) {
  const t = T[l];
  for (const route of MARKETING) {
    const r = await read(mock, `${pre(l)}/${route}`);
    censusPages++;
    const loose = [...r.rest.matchAll(DATE_RE)].map((m) => m[0]).filter(Boolean);
    const clocks = [...r.rest.matchAll(/\b\d{1,2}:\d{2}\b/g)].map((m) => m[0]);
    check(loose.length === 0 && clocks.length === 0, `${l} /${route}: no date of 2026 / 2027 and no clock time outside the launch panel's timeline${loose.length + clocks.length ? " -> " + [...loose, ...clocks].slice(0, 3).join(" | ") : ""}`);
    const wantPanel = route === "" || route === "pricing/" ? 1 : 0;
    check(r.dls.length === wantPanel && r.panels === wantPanel && r.dls.every((d) => d.where === "panel"), `${l} /${route}: ${wantPanel ? "exactly ONE launch panel" : "no launch panel"} (${r.panels} panel, ${r.dls.length} timeline)`);
    for (const d of r.dls) {
      check(d.rows.length === 2 && d.rows[0][0] === "registration" && norm(d.rows[0][1]) === t.regLabel && norm(d.rows[0][2]) === t.reg && norm(d.rows[0][3]) === t.regNote && d.rows[1][0] === "end" && norm(d.rows[1][1]) === t.endLabel && norm(d.rows[1][2]) === t.end && norm(d.rows[1][3]) === t.endNote, `${l} /${route}: the timeline is "${t.regLabel}: ${t.reg}" (${t.regNote}) then "${t.endLabel}: ${t.end}" (${t.endNote}), exactly`);
      check(JSON.stringify(d.facts.map(norm)) === JSON.stringify([t.store, t.pay, t.noAuto].map(norm)) && norm(d.foot).includes(t.foot), `${l} /${route}: the panel's three facts (one store incl. staging, no payment method, no automatic conversion) and its footnote are the exact strings`);
    }
    // each date text exactly once on the page (the cards, the header, the band and the finder carry none)
    const once = (x) => (norm(r.full).split(norm(x)).length - 1);
    check(wantPanel ? once(t.reg) === 1 && once(t.end) === 1 && once(t.regNote) === 1 : once(t.reg) === 0 && once(t.end) === 0 && once(t.regNote) === 0, `${l} /${route}: "${t.reg}", "${t.end}" and the last-day note appear ${wantPanel ? "exactly once" : "nowhere"} on the page (${once(t.reg)}/${once(t.end)}/${once(t.regNote)})`);
    check(r.struck === 0, `${l} /${route}: no struck-through element in the main content (the gated variant is off)`);
    check(!r.hrefs.some((h) => /request-access/.test(h || "")), `${l} /${route}: no link to /request-access/`);
  }
}
console.log(`  (${censusPages} marketing pages parsed)`);
console.log("== stale phrases of the old policy: none on any marketing page, four languages (legal pages are checked for being unchanged below)");
for (const l of LOCALES) for (const route of [...MARKETING, "data-and-trust/"]) {
  const r = await read(mock, `${pre(l)}/${route}`);
  const hits = STALE.filter(([re]) => re.test(r.full)).map(([, why]) => why);
  check(hits.length === 0, `${l} /${route}: no stale phrase${hits.length ? " -> " + hits.join("; ") : ""}`);
}
console.log("== meta description, structured data and sitemap");
for (const l of LOCALES) {
  const r = await read(mock, `${pre(l)}/pricing/`);
  const nums = (r.meta.match(/(?:US)?\$\d+/g) || []).map((x) => x.replace("US", ""));
  check(["$99", "$199", "$499"].every((p) => nums.includes(p)) && !/\b(was|save)\b|%/i.test(r.meta) && !/24 hours|approved|request/i.test(r.meta) && !r.meta.includes("00:00") && !r.meta.includes("22:00"), `${l} Pricing meta description names $99 / $199 / $499 (${nums.join(", ")}), a trial, no stale or date wording: "${r.meta.slice(0, 90)}..."`);
  check(r.ld.every((j) => !/"@type":\s*"(Offer|AggregateOffer)"|"price"|priceCurrency/.test(j)), `${l} Pricing: structured data has no Offer / price`);
  const h = await read(mock, `${pre(l)}/`);
  check(h.ld.every((j) => !/"@type":\s*"(Offer|AggregateOffer)"|"price"|priceCurrency|trial|Dec(ember)? \d/i.test(j)), `${l} Home: structured data has no Offer / price / trial / date`);
}
{
  const sm = fs.readFileSync(path.join(DIR, "sitemap.xml"), "utf8");
  check(!/\/start\/|request-access|my-account/.test(sm) && (sm.match(/<loc>/g) || []).length >= 36, `sitemap.xml lists no sign-up / request / account page (${(sm.match(/<loc>/g) || []).length} URLs)`);
}
if (BASE) {
  console.log("== legal pages are unchanged against the base (S0) export (the main content, four languages)");
  for (const l of LOCALES) for (const route of LEGAL) {
    const a = await read(mockBase, `${pre(l)}/${route}`), b = await read(mock, `${pre(l)}/${route}`);
    check(a.main.length > 500 && a.main === b.main, `${l} /${route}: the page content equals the S0 export byte for byte (${a.main.length} chars)`);
  }
  console.log("== the S0 pricing page is what is live today (sanity: the base fixture carries the P36 offer, not the new copy)");
  const b = await read(mockBase, "/pricing/");
  check(/Approved stores only/.test(b.full) && !/Launch trial: 1 store|Trial includes 1 store/.test(b.full), "the base export is the S0 (P36 launch offer) page: 'Approved stores only', no free-trial line");
}
if (mockLink) {
  console.log("== the link-initial build (rebuilt at activation): same numbers, same dates, links instead of the status text");
  for (const l of LOCALES) {
    const r = await read(mockLink, `${pre(l)}/pricing/`);
    check(r.cards.length === 3 && r.cards.every((c, i) => c.status.length === 0 && c.dates === 0 && c.links.length === 1 && /\/start\/\?plan=(solo|studio|agency)$/.test(c.links[0])) && r.dls.length === 1 && norm(r.dls[0].rows[0][2]) === T[l].reg && norm(r.dls[0].rows[1][2]) === T[l].end, `${l} link build /pricing/: three cards with one sign-up link each, no static status, no date in a card, the panel's two exact date lines`);
  }
}
await browser.close();
await mock.close(); if (mockLink) await mockLink.close(); if (mockBase) await mockBase.close();
console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:pricing-consistency (${failed})`); process.exit(1); }
console.log("PASS test:pricing-consistency");
