// npm run test:ss-guards (P39): MUTATION tests of the free-trial copy guards (scripts/lib/early-access-truth.mjs, scripts/copy-check.mjs). The owner now REQUIRES these claims in exactly these strings:
//   "no payment method for the trial", "no automatic conversion to a paid plan", the TWO labelled dates (registration closes 00:00 UTC / trial access ends 22:00 UTC), "Free trial: 1 store regardless of plan".
// The guards were written for the old claim set and were widened ADDITIVELY. This test proves, in four languages, that
//   (1) every NEW rule bites (a mutation that breaks it is reported by name), and
//   (2) every OLD protection still bites (discount, urgency, "was $", "save", unlimited, approval / request wording, card wording, subscription / renewal, trial length in days, a price, Join, "conversion" claims,
//       Israel / local time, a stray 00:00, a date outside the labelled lines ...), and
//   (3) the untouched pack passes every guard (so the failures above are caused by the mutations),
//   (4) end to end: a copy of the repo with a mutated pack makes `copy:check` exit 1.
//   node scripts/test-ss-guards.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadTs, ROOT } from "./lib/load.mjs";
import { SS_EXTRA_RULES, ssDisclosureProblems, eaDisclosureProblems, eaExtraRulesProbe } from "./lib/early-access-truth.mjs";

let failed = 0, total = 0;
const check = (c, m) => { total++; if (!c) { failed++; console.error("  FAIL " + m); } else console.log("  ok   " + m); };
const LOCALES = ["en", "he", "es", "ru"];
const { getEaDictionary } = await loadTs("src/i18n/index.ts");
const toks = await loadTs("src/i18n/eaTokens.ts");
const raws = { en: (await loadTs("src/i18n/ea/en.ts")).eaEn, he: (await loadTs("src/i18n/ea/he.ts")).eaHe, es: (await loadTs("src/i18n/ea/es.ts")).eaEs, ru: (await loadTs("src/i18n/ea/ru.ts")).eaRu };
const clone = (o) => JSON.parse(JSON.stringify(o));
const setAt = (o, p, v) => { const k = p.split("."); const last = k.pop(); const t = k.reduce((a, x) => a[x], o); t[last] = typeof v === "function" ? v(t[last]) : v; return o; };
const probs = (l, ea, raw) => [...ssDisclosureProblems(l, ea, 0, raw), ...eaDisclosureProblems(l, ea, 0)];

console.log("== the untouched pack passes every guard (four languages)");
for (const l of LOCALES) {
  const ea = getEaDictionary(l, 0);
  const p = probs(l, ea, raws[l].ss);
  check(p.length === 0, `${l}: the free-trial block passes ssDisclosureProblems and eaDisclosureProblems${p.length ? " -> " + p.join("; ") : ""}`);
}

// the words each language uses (to inject a claim in the right language)
const W = {
  en: { auto: "automatically", date: "Dec 31, 2026", dateLong: "December 31, 2026", card: "credit card", approve: "Approved stores only", urgent: "only 5 spots left", save: "Save 20% today", was: "was $99", unlimited: "unlimited stores", sub: "subscription", days: "14-day trial", join: "Join us", conv: "increase conversion", more: "up to 25 stores", geo: "Israel time" },
  he: { auto: "אוטומטי", date: "31 בדצמבר 2026", dateLong: "31 בדצמבר 2026", card: "כרטיס אשראי", approve: "לחנויות מאושרות בלבד", urgent: "נשארו רק 5 מקומות", save: "הנחה של 20%", was: "היה $99", unlimited: "חנויות ללא הגבלה", sub: "מנוי", days: "ניסיון של 14 ימים", join: "הצטרפו אלינו", conv: "הגדילו מכירות", more: "עד 25 חנויות", geo: "שעון ישראל" },
  es: { auto: "automático", date: "31 dic 2026", dateLong: "31 de diciembre de 2026", card: "tarjeta de crédito", approve: "solo tiendas aprobadas", urgent: "quedan solo 5 plazas", save: "ahorre un 20%", was: "antes $99", unlimited: "tiendas ilimitadas", sub: "suscripción", days: "prueba de 14 días", join: "únase", conv: "aumente las ventas", more: "hasta 25 tiendas", geo: "hora de Israel" },
  ru: { auto: "автоматическ", date: "31 дек. 2026 г.", dateLong: "31 декабря 2026 г.", card: "банковская карта", approve: "только одобренные магазины", urgent: "осталось 5 мест", save: "скидка 20%", was: "раньше $99", unlimited: "безлимитные магазины", sub: "подписка", days: "пробный период 14 дней", join: "присоединяйтесь", conv: "увеличьте продажи", more: "до 25 магазинов", geo: "по израильскому времени" },
};
// NEW rules: [name, mutate(ea, l), expected problem text]
const NEW = [
  ["the automatic-conversion denial disappears from the card (empty)", (ea) => setAt(ea, "ss.plan.noAuto", ""), /ea\.ss\.plan\.noAuto is missing or empty/],
  ["the card line stops naming a paid plan / automatic", (ea) => setAt(ea, "ss.plan.noAuto", (v) => v.split(/\s/)[0]), /ea\.ss\.plan\.noAuto must state that nothing converts/],
  ["the hero line loses the denial", (ea) => setAt(ea, "ss.hero.support.noAuto", "OK"), /ea\.ss\.hero\.support\.noAuto must state that nothing converts/],
  ["the terms lose the denial", (ea) => setAt(ea, "ss.terms.noAuto", (v) => v.replace(/automátic\w*|автоматическ\w*|אוטומטית?|automatically/i, "")), /ea\.ss\.terms\.noAuto must state that nothing converts/],
  ["the terms lose the explicit decision", (ea) => setAt(ea, "ss.terms.noAuto", (v) => v.split(/[.]/)[0] + "."), /explicit decision/],
  ["an automatic claim is made in another string (the band lead)", (ea, l) => setAt(ea, "ss.band.lead", (v) => `${v} ${W[l].auto}`), /makes an "automatic" claim/],
  ["the registration line loses 00:00", (ea) => setAt(ea, "ss.plan.regValue", (v) => v.replace("00:00", "12:00")), /ea\.ss\.plan\.regValue must state the registration close/],
  ["the registration line states the 22:00 end", (ea) => setAt(ea, "ss.plan.regValue", (v) => v.replace("00:00", "22:00")), /must state the registration close|states a 00:00/],
  ["the registration date is wrong (Dec 25)", (ea) => setAt(ea, "ss.plan.regValue", (v) => v.replace(/24/, "25")), /must state the registration close/],
  ["the end line states 00:00", (ea) => setAt(ea, "ss.plan.endValue", (v) => v.replace("22:00", "00:00")), /must state the trial end|states a 00:00/],
  ["the end line shows another day", (ea) => setAt(ea, "ss.plan.endValue", (v) => v.replace(/31/, "30")), /must state the trial end/],
  ["the terms drop the last day to start a trial", (ea) => setAt(ea, "ss.terms.regValue", (v) => v.replace(/23/, "22")), /last day to start a trial/],
  ["the terms drop the trial end", (ea) => setAt(ea, "ss.terms.endValue", (v) => v.replace("22:00 UTC", "")), /must state the trial end/],
  ["the two labels are the same", (ea) => setAt(ea, "ss.plan.endLabel", (ea0) => ea0) && setAt(ea, "ss.plan.regLabel", ea.ss.plan.endLabel), /must differ/],
  ["a LOOSE end date is put in the bar (a date outside the labelled lines)", (ea, l) => setAt(ea, "ss.bar.text", (v) => `${v} ${W[l].date}`), /states a date|dates live only/],
  ["a LOOSE long date is put in the hero badge", (ea, l) => setAt(ea, "ss.hero.badge", (v) => `${v} ${W[l].dateLong}`), /states a date|dates live only/],
  ["a clock time is put in the band lead", (ea) => setAt(ea, "ss.band.lead", (v) => `${v} 22:00 UTC`), /clock time/],
  ["00:00 is put outside the registration strings (the old midnight rule still bites)", (ea) => setAt(ea, "ss.terms.state", (v) => `${v} 00:00`), /states a 00:00 end|clock time/],
  ["00:00 is put in a launch-offer string", (ea) => setAt(ea, "plan.ends", (v) => `${v} 00:00`), /states a 00:00 end/],
  ["the retired notOpen label returns", (ea) => setAt(ea, "ss.cta.notOpen", "Free trial registration is not open"), /cta\.notOpen exists/],
  ["the 'opens soon' state turns into an invitation", (ea, l) => setAt(ea, "ss.cta.soon", { en: "Start free trial soon", he: "התחילו ניסיון חינם בקרוב", es: "Empezar prueba gratuita pronto", ru: "Начать бесплатный пробный период скоро" }[l]), /status statement|all differ/],
  ["two state labels are equal", (ea) => setAt(ea, "ss.cta.paused", ea.ss.cta.closed), /five self-service state labels must all differ/],
  ["the trial is not one store (the card line loses '1')", (ea, l) => setAt(ea, "ss.plan.trial", { en: "Free trial", he: "ניסיון חינם", es: "Prueba gratuita", ru: "Бесплатный пробный период" }[l]), /trial covers one store/],
  ["the terms say more than 10 paid stores", (ea, l) => setAt(ea, "ss.terms.paid", (v) => `${v} ${W[l].more}`), /number\(s\) 25|paid allowance/],
  ["the payment rule loses 'payment method'", (ea) => setAt(ea, "ss.plan.noPayment", "x"), /payment method/],
  ["a clock appears in the Hero support line", (ea) => setAt(ea, "ss.hero.support.oneStore", (v) => `${v} 22:00`), /clock time|short line/],
  ["a hero support line becomes a sentence", (ea) => setAt(ea, "ss.hero.support.noAuto", (v) => `${v}.`), /one short line/],
  ["the pricing meta description loses a price token", (ea) => setAt(ea, "ss.meta.pricingDescription", (v) => v.replace("{priceStudio}", "")), /priceStudio/],
  ["an Israel / local time reference is added", (ea, l) => setAt(ea, "ss.terms.state", (v) => `${v} ${W[l].geo}`), /names a country or local time zone/],
  ["a date token is left unresolved", (ea) => setAt(ea, "ss.plan.regValue", "{regShort} at 00:00 UTC"), /unresolved date token/],
];
console.log("== NEW rules: every mutation is reported by name (four languages)");
for (const [name, mut, re] of NEW) for (const l of LOCALES) {
  const ea = clone(getEaDictionary(l, 0));
  try { mut(ea, l); } catch (e) { check(false, `${l}: mutation "${name}" could not be applied (${e.message})`); continue; }
  const p = probs(l, ea, raws[l].ss);
  check(p.some((x) => re.test(x)), `${l}: "${name}" -> reported (${(p.find((x) => re.test(x)) || p[0] || "NOT REPORTED").slice(0, 110)})`);
}
console.log("== NEW rule: the unresolved pack must carry the date tokens");
for (const l of LOCALES) {
  const raw = clone(raws[l].ss);
  for (const [path_, tok] of [["plan.regValue", "regShort"], ["plan.endValue", "until"], ["terms.regValue", "regDate"], ["terms.endValue", "lastDay"]]) {
    const r2 = clone(raw); setAt(r2, path_, (v) => v.replace(`{${tok}}`, "Dec 24"));
    const p = ssDisclosureProblems(l, getEaDictionary(l, 0), 0, r2);
    check(p.some((x) => x.includes(`must carry the token {${tok}}`)), `${l}: ${path_} without {${tok}} is reported`);
  }
}
console.log("== NEW rule: the registration cutoff literals equal the Control Plane constant 1798070400 (2026-12-24T00:00:00Z)");
check(toks.SS_REG_CLOSE_UTC_MS === 1798070400 * 1000 && new Date(toks.SS_REG_CLOSE_UTC_MS).toISOString() === "2026-12-24T00:00:00.000Z", "SS_REG_CLOSE_UTC_MS is exactly 2026-12-24T00:00:00Z");
for (const l of LOCALES) {
  const bad = clone(toks.SS_REG_DATES[l]); bad.regLast = bad.regDate; // pretend the table named December 24 as the last day
  check(bad.regLast === bad.regDate && getEaDictionary(l, 0).ss.terms.regValue.includes(toks.SS_REG_DATES[l].regLast), `${l}: the terms line names the LAST day to start a trial (${toks.SS_REG_DATES[l].regLast}), not the cutoff day`);
}

console.log("== OLD protections still bite: the free-trial rule set (SS_EXTRA_RULES) rejects each of these lines");
const BAD_SS = {
  en: ["Save 20% on the free trial", "Free trial, was $99", "Free trial: only 5 spots left", "Free trial with unlimited stores", "Approved stores only", "Request free access", "Free trial, no credit card", "No card needed", "Your free trial subscription", "Free trial that renews", "Start a free trial for 14 days", "Free trial, then $99", "Free trial for founding members", "Hurry: free trial", "Join us today", "Boost your conversion", "Increase sales with the trial", "Guaranteed results", "Free plan forever", "Cancel anytime", "Instant access", "No commitment", "Automatic conversion of your store", "No automatic conversion", "Billed automatically", "Free trial, last chance", "Trusted by thousands"],
  he: ["הנחה של 20% על הניסיון", "ניסיון חינם, היה $99", "נשארו רק 5 מקומות", "לחנויות מאושרות בלבד", "בקשת גישה", "ללא כרטיס אשראי", "מנוי", "ניסיון של 14 ימים", "הזדמנות אחרונה", "הצטרפו אלינו", "מובטח", "תחויבו אוטומטית"],
  es: ["descuento del 20%", "prueba gratuita, antes $99", "quedan solo 5 plazas", "solo tiendas aprobadas", "solicitud de acceso", "sin tarjeta de crédito", "suscripción", "prueba de 14 días", "última oportunidad", "renovación automática", "garantizado"],
  ru: ["скидка 20%", "пробный период, раньше $99", "осталось 5 мест", "только одобренные магазины", "запрос доступа", "без банковской карты", "подписка", "пробный период 14 дней", "последний шанс", "автопродление", "гарантия результата"],
};
for (const l of LOCALES) {
  const missed = BAD_SS[l].filter((t) => !SS_EXTRA_RULES.some(([re]) => re.test(eaExtraRulesProbe(t))));
  check(missed.length === 0, `${l}: all ${BAD_SS[l].length} old-protection probes are rejected inside the ss block${missed.length ? " -> NOT caught: " + missed.join(" | ") : ""}`);
}
console.log("== the allowed claims pass (exactly these, in the ss block)");
const OK_SS = ["No automatic conversion to a paid plan", "No payment method required for the trial", "Trial includes 1 store", "Registration closes", "Trial access ends", "Free trial registration opens soon", "Start free trial", "Join the waitlist", "Paid plan: up to {n} stores",
  "No pasa automáticamente a un plan de pago", "La prueba incluye 1 tienda", "אין מעבר אוטומטי לתוכנית בתשלום", "הניסיון כולל חנות אחת", "הצטרפו לרשימת ההמתנה", "Без автоматического перехода на платный план", "В пробный период входит 1 магазин"];
{
  const wrong = OK_SS.filter((t) => SS_EXTRA_RULES.some(([re]) => re.test(eaExtraRulesProbe(t))));
  check(wrong.length === 0, `the allowed claims are not flagged by SS_EXTRA_RULES${wrong.length ? " -> flagged: " + wrong.join(" | ") : ""}`);
}

console.log("== end to end: copy:check on a COPY of the repo with a mutated pack exits 1 (and 0 on the untouched copy)");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p39-guards-"));
  try {
    for (const d of ["src", "scripts", "docs", "brand"]) spawnSync("cp", ["-R", path.join(ROOT, d), path.join(tmp, d)]);
    for (const f of ["package.json", "README.md", "tsconfig.json"]) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
    fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(tmp, "node_modules"));
    const en = path.join(tmp, "src/i18n/ea/en.ts"), orig = fs.readFileSync(en, "utf8");
    const run = () => spawnSync(process.execPath, ["scripts/copy-check.mjs"], { cwd: tmp, encoding: "utf8" });
    const base = run();
    check(base.status === 0, `the untouched copy passes copy:check (exit ${base.status})`);
    for (const [name, from, to] of [
      ["a discount in the card line", 'trial: "Trial includes 1 store"', 'trial: "Trial includes 1 store, save 20%"'],
      ["'conversion' outside the allowed phrase", 'noAuto: "No automatic conversion to a paid plan"', 'noAuto: "No automatic conversion rate"'],
      ["the allowed phrase is cut short", 'noAuto: "No automatic conversion to a paid plan", checksLabel', 'noAuto: "No automatic conversion", checksLabel'],
      ["a credit card claim", 'noPayment: "No payment method required for the trial"', 'noPayment: "No credit card required for the trial"'],
      ["approval wording", 'cta: { soon: "Free trial registration opens soon"', 'cta: { soon: "Free trial for approved stores"'],
      ["a trial length in days", 'trial: "Trial includes 1 store"', 'trial: "14-day trial includes 1 store"'],
      ["an urgency device", 'closed: "Free trial registration closed"', 'closed: "Free trial registration closed, only 3 spots left"'],
    ]) {
      if (!orig.includes(from)) { check(false, `end to end "${name}": fixture string not found`); continue; }
      fs.writeFileSync(en, orig.replace(from, to));
      const r = run();
      check(r.status === 1 && /FAIL: \d+ banned phrase/.test(r.stderr + r.stdout), `copy:check FAILS on "${name}" (exit ${r.status})`);
    }
    fs.writeFileSync(en, orig);
    // the "free trial" wording stays banned OUTSIDE the ss block (the old protection)
    fs.writeFileSync(en, orig.replace('offerName: "Launch offer",', 'offerName: "Launch offer",\n  x: "Start a free trial",'));
    const r2 = run();
    check(r2.status === 1, `"free trial" outside the ss block is still banned (copy:check exit ${r2.status})`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
console.log(`\n${total - failed}/${total} checks passed`);
if (failed) { console.error(`FAIL test:ss-guards (${failed})`); process.exit(1); }
console.log("PASS test:ss-guards");
