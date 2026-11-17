// npm run test:pricing-consistency (P39): parses EVERY built page of a self-service export in four languages (rendered text of the LIVE view, in Chromium) and asserts the exact numbers, dates and clocks:
//   * prices 99 / 199 / 499 USD, paid capacity 1 / up to 3 / up to 10, "Free trial: 1 store", the payment rule and "no automatic conversion" on every plan card (Home and Pricing);
//   * the TWO dates as two labelled lines on every surface that mentions either (card, closing band, plan-finder result, terms block): registration closes December 24, 2026 at 00:00 UTC, trial access ends December 31, 2026 at 22:00 UTC,
//     written here as INDEPENDENT literals per language (not read from the dictionaries); no date or clock anywhere outside those labelled lines; no other deadline;
//   * no stale phrase of the old policy (approved stores only, requests close 24 hours before, "Request Free Access", Israel / local time zone, "was $", "save N", %, "no credit card", ...) on any marketing page; legal pages keep their geography and are
//     asserted UNCHANGED against the base (S0) export; no /request-access/ link; JSON-LD carries no Offer / price; the sitemap lists no sign-up page;
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
  en: { reg: "Dec 24, 2026 at 00:00 UTC", end: "Dec 31, 2026 at 22:00 UTC", regLabel: "Registration closes", endLabel: "Trial access ends", regLong: "December 24, 2026 at 00:00 UTC. The last day to start a trial is December 23, 2026 (UTC).", endLong: "December 31, 2026 at 22:00 UTC, for every trial, whichever day you started.", trial: "Free trial: 1 store", paid: ["Paid plan: 1 store", "Paid plan: up to 3 stores", "Paid plan: up to 10 stores"], noPay: "No payment method required for the trial", noAuto: "No automatic conversion to a paid plan", soon: "Free trial registration opens soon", price: (p) => `$${p}` },
  he: { reg: "24 בדצמבר 2026 בשעה 00:00 UTC", end: "31 בדצמבר 2026 בשעה 22:00 UTC", regLabel: "ההרשמה נסגרת", endLabel: "הגישה לניסיון מסתיימת", regLong: "24 בדצמבר 2026 בשעה 00:00 UTC. היום האחרון להתחיל ניסיון הוא 23 בדצמבר 2026 (UTC).", endLong: "31 בדצמבר 2026 בשעה 22:00 UTC, לכל ניסיון, בלי קשר ליום שבו התחלתם.", trial: "ניסיון חינם: חנות אחת", paid: ["תוכנית בתשלום: חנות אחת", "תוכנית בתשלום: עד 3 חנויות", "תוכנית בתשלום: עד 10 חנויות"], noPay: "לניסיון אין צורך באמצעי תשלום", noAuto: "אין מעבר אוטומטי לתוכנית בתשלום", soon: "ההרשמה לניסיון החינם תיפתח בקרוב", price: (p) => `$${p}` },
  es: { reg: "24 dic 2026 a las 00:00 UTC", end: "31 dic 2026 a las 22:00 UTC", regLabel: "El registro se cierra", endLabel: "El acceso de prueba termina", regLong: "24 de diciembre de 2026 a las 00:00 UTC. El último día para empezar una prueba es el 23 de diciembre de 2026 (UTC).", endLong: "31 de diciembre de 2026 a las 22:00 UTC, para cada prueba, sea cual sea el día en que la empezó.", trial: "Prueba gratuita: 1 tienda", paid: ["Plan de pago: 1 tienda", "Plan de pago: hasta 3 tiendas", "Plan de pago: hasta 10 tiendas"], noPay: "No hace falta método de pago para la prueba", noAuto: "Sin paso automático a un plan de pago", soon: "El registro de la prueba gratuita se abrirá pronto", price: (p) => `US$${p}` },
  ru: { reg: "24 дек. 2026 г. в 00:00 UTC", end: "31 дек. 2026 г. в 22:00 UTC", regLabel: "Регистрация закрывается", endLabel: "Пробный доступ заканчивается", regLong: "24 декабря 2026 г. в 00:00 UTC. Последний день, когда можно начать пробный период, это 23 декабря 2026 г. (UTC).", endLong: "31 декабря 2026 г. в 22:00 UTC, для любого пробного периода, в какой бы день вы его ни начали.", trial: "Бесплатный пробный период: 1 магазин", paid: ["Платный план: 1 магазин", "Платный план: до 3 магазинов", "Платный план: до 10 магазинов"], noPay: "Для пробного периода способ оплаты не нужен", noAuto: "Без автоматического перехода на платный план", soon: "Регистрация на бесплатный пробный период скоро откроется", price: (p) => `$${p}` },
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
  m.set({ signup: "http404" }); // the status request fails: the build's static state stays (what a search engine, a no-JS visitor and the first paint see)
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, reducedMotion: "reduce" });
  await ctx.clock.setFixedTime(new Date(Date.UTC(2026, 10, 20)));
  const page = await ctx.newPage();
  await page.goto(m.url + route, { waitUntil: "load" });
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const vis = (e) => e.getClientRects().length > 0;
    const txt = (e) => e.innerText.replace(/\s+/g, " ").trim();
    const dls = [...document.querySelectorAll("dl[data-ss-dates]")].filter(vis).map((dl) => ({ rows: [...dl.querySelectorAll("[data-ss-date]")].map((r) => [r.getAttribute("data-ss-date"), txt(r.querySelector("dt")), txt(r.querySelector("dd"))]), where: dl.closest("article.aicc-plan") ? "card" : dl.closest("[data-ss-band]") ? "band" : dl.closest("[data-ss-terms]") ? "terms" : dl.closest("form") ? "finder" : "other" }));
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = walker.nextNode())) {
      const p = n.parentElement; if (!p || !vis(p) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName) || p.closest("dl[data-ss-dates]")) continue;
      out.push(n.nodeValue);
    }
    const cards = [...document.querySelectorAll("article.aicc-plan")].filter(vis).map((a) => ({ text: txt(a), price: (a.querySelector(".aicc-plan__regular-line")?.innerText || "").replace(/\s+/g, " ").trim(), status: [...a.querySelectorAll("[data-ss-state]")].map(txt), dates: [...a.querySelectorAll("[data-ss-date]")].map((r) => [txt(r.querySelector("dt")), txt(r.querySelector("dd"))]) }));
    return { dls, rest: out.join(" ").replace(/\s+/g, " "), full: document.body.innerText.replace(/\s+/g, " "), cards, hrefs: [...document.querySelectorAll("a")].map((a) => a.getAttribute("href")), meta: document.querySelector('meta[name="description"]')?.content || "", ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent), main: (() => { const m = document.querySelector("main")?.cloneNode(true); if (!m) return ""; m.querySelectorAll(".aicc-eabar").forEach((e) => e.remove()); return m.innerHTML; })(), title: document.title };
  });
  await ctx.close();
  return r;
}

console.log("== plan cards (Home and Pricing, four languages): price, paid capacity, trial, payment rule, no automatic conversion, the two labelled dates, the plain status");
for (const l of LOCALES) {
  const t = T[l];
  for (const route of ["", "pricing/"]) {
    const r = await read(mock, `${pre(l)}/${route}`);
    check(r.cards.length === 3, `${l} /${route}: three plan cards`);
    r.cards.forEach((c, i) => {
      const pl = PLANS[i];
      check(norm(c.price).includes(t.price(pl.price)) && c.text.includes(t.paid[i]) && c.text.includes(t.trial) && c.text.includes(t.noPay) && c.text.includes(t.noAuto) && c.status.length === 1 && norm(c.status[0]) === t.soon, `${l} /${route} ${pl.id}: ${t.price(pl.price)} a year, "${t.paid[i]}", "${t.trial}", "${t.noPay}", "${t.noAuto}", status "${t.soon}"`);
      check(c.dates.length === 2 && norm(c.dates[0][0]) === t.regLabel && norm(c.dates[0][1]) === t.reg && norm(c.dates[1][0]) === t.endLabel && norm(c.dates[1][1]) === t.end, `${l} /${route} ${pl.id}: two labelled lines "${t.regLabel}: ${t.reg}" and "${t.endLabel}: ${t.end}"`);
    });
    const prices = [...new Set([...r.full.matchAll(/(?:US)?\$\s?(\d{2,4})/g)].map((m) => Number(m[1])).filter((n) => ![99, 199, 499].includes(n)))];
    check(prices.length === 0 || route === "", `${l} /${route}: no price other than $99 / $199 / $499 on the page${prices.length ? " (" + prices + ")" : ""}`);
  }
}
console.log("== every surface that mentions a date shows BOTH labelled lines; no date or clock outside them; no other deadline (Home, Product, Pricing, Questions)");
let censusPages = 0;
for (const l of LOCALES) {
  const t = T[l];
  for (const route of MARKETING) {
    const r = await read(mock, `${pre(l)}/${route}`);
    censusPages++;
    const loose = [...r.rest.matchAll(DATE_RE)].map((m) => m[0]).filter(Boolean);
    const clocks = [...r.rest.matchAll(/\b\d{1,2}:\d{2}\b/g)].map((m) => m[0]);
    check(loose.length === 0 && clocks.length === 0, `${l} /${route}: no date of 2026 / 2027 and no clock time outside the labelled date lines${loose.length + clocks.length ? " -> " + [...loose, ...clocks].slice(0, 3).join(" | ") : ""}`);
    const badRows = r.dls.filter((d) => d.rows.length !== 2 || norm(d.rows[0][1]) !== t.regLabel || norm(d.rows[1][1]) !== t.endLabel || !(norm(d.rows[0][2]) === t.reg || norm(d.rows[0][2]) === t.regLong) || !(norm(d.rows[1][2]) === t.end || norm(d.rows[1][2]) === t.endLong));
    check(badRows.length === 0, `${l} /${route}: all ${r.dls.length} date blocks (${[...new Set(r.dls.map((d) => d.where))].join(", ") || "none"}) are exactly the two labelled lines with the exact UTC instants`);
    const wantBlocks = route === "" ? { card: 3, terms: 1, band: 1 } : route === "pricing/" ? { card: 3, terms: 1, band: 1 } : route === "product/" ? { band: 2 } : {};
    for (const [k, n] of Object.entries(wantBlocks)) check(r.dls.filter((d) => d.where === k).length >= n, `${l} /${route}: at least ${n} ${k} date block(s) (${r.dls.filter((d) => d.where === k).length})`);
    if (route === "pricing/") check(r.dls.filter((d) => d.where === "terms").every((d) => norm(d.rows[0][2]) === t.regLong && norm(d.rows[1][2]) === t.endLong), `${l} /pricing/: the terms block carries the long forms ("...The last day to start a trial is ...", "..., for every trial, whichever day you started.")`);
    // a page with a date block says nothing else about a deadline; a page without one mentions none (the census above covers it)
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
  check(/Approved stores only/.test(b.full) && !/Free trial: 1 store/.test(b.full), "the base export is the S0 (P36 launch offer) page: 'Approved stores only', no free-trial line");
}
if (mockLink) {
  console.log("== the link-initial build (rebuilt at activation): same numbers, same dates, links instead of the status text");
  for (const l of LOCALES) {
    const r = await read(mockLink, `${pre(l)}/pricing/`);
    check(r.cards.length === 3 && r.cards.every((c) => c.status.length === 0 && c.dates.length === 2 && norm(c.dates[0][1]) === T[l].reg && norm(c.dates[1][1]) === T[l].end), `${l} link build /pricing/: three cards with the two exact date lines and no static status text`);
  }
}
await browser.close();
await mock.close(); if (mockLink) await mockLink.close(); if (mockBase) await mockBase.close();
console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:pricing-consistency (${failed})`); process.exit(1); }
console.log("PASS test:pricing-consistency");
