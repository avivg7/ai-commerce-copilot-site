// Early Access (Production 20) copy rules, shared by `npm run copy:check` and `npm run ea:check`.
//
// Until Production 20 the Site banned "free", "no credit card", struck-through prices and similar claims everywhere, because no free flow existed. The owner has since decided one
// (docs/cutover/early-access.md): free until 31 December 2026, ONE fixed end for everybody, voluntary paid continuation, nothing automatic. Weakening a rule needs the owner decision
// that guards the claim, so the allowance is as narrow as it can be:
//   * it applies ONLY to files under src/i18n/ea/ (the campaign copy) and to nothing else in the repository;
//   * only the rules listed in ALLOWED_WHY below are lifted there (the plain words "free" and "no credit card" in each language);
//   * everything else stays banned in those files too, and a few campaign-specific bans are added (trial, subscription, automatic wording, urgency, discount, percentages);
//   * `eaDisclosureProblems` REQUIRES the disclosures the campaign promises, in every language, so a rewrite cannot drop the end date or the "nothing is charged automatically" line.
export const EA_DIR = "src/i18n/ea/";

/** The `why` strings of the copy:check rules that are lifted for the campaign files (see RULES in scripts/copy-check.mjs). */
export const ALLOWED_WHY = new Set([
  "no credit card",
  "he: free", "he: no credit card",
  "es: free", "es: no credit card",
  "ru: free", "ru: no credit card",
]);

/** Added only for the campaign files: this is a promotional access period, never a trial, a subscription, a discount or an urgency device. */
export const EA_EXTRA_RULES = [
  // English
  [/\btrial\b|\bfree (plan|tier|version|forever|for ever|for life|for the first|for founding|for early|to try|to start|download)\b|freemium|start free|forever free|lifetime|for life/i, "en: this is not a trial, a free plan or a lifetime offer"],
  [/\bsubscri(be|ption)\b|auto-?renew|renews?\b|recurring|automatically (charged|billed|renewed|converted)|\b(billed|bill(ed)? you|charged? you|we will charge|we'll charge|ask for your card|your card)\b|\bthen \$/i, "en: no subscription, renewal, billing or card-at-the-end wording (say that nothing is charged automatically)"],
  [/\b(discount|off\b|save\b|saving|savings|deal|coupon|promo|sale|half price|% ?off|percent|per ?cent|cheaper|bargain)|\d\s?%/i, "en: no discount, saving or percentage wording (the regular price is shown as a fact, never as a saving)"],
  [/\b(limited|hurry|last chance|act now|only (a few|\d+)|spots?|places|seats|left|countdown|ends? (soon|in)|don't miss|first \d+|founding|early adopters?|while (it )?lasts)\b/i, "en: no urgency, scarcity or founding-member devices (the end date is stated as a date)"],
  [/\b(guarantee[sd]?|results?|increase|boost|grow|revenue|earn|sales|conversion|rated|stars?|reviews|trusted|thousands|hundreds)\b(?!.{0,60}\b(not|never|no|nothing|concerns|refers)\b)/i, "en: no result, rating, social-proof or guarantee claim in campaign copy"],
  [/\$\s?\d|\bUSD\b/, "en: no price in campaign copy (prices come from src/data/plans.ts)"],
  // Hebrew
  [/תקופת ניסיון|ניסיון חינם|חינם (לתמיד|לנצח|לכל החיים)|לתמיד|לנצח|(?<!הזד)מנוי|מתחדש|הנחה|חסוך|חיסכון|מבצע|מוגבל|הזדמנות אחרונה|האחרונה|מובטח|ערבות|הגדל|הגדילו|תרוויח|תרוויחו|מכירות|הכנסות|דירוג|כוכבים|ממליצים|מאות|אלפי|נשארו|מקומות|\d\s?%|אחוז|תחייב|תחויב|נחייב|\$/, "he: no trial, forever/lifetime, subscription, renewal, discount, urgency, scarcity, result, rating or price wording"],
  // Spanish
  [/prueba|gratis (para siempre|de por vida)|para siempre|de por vida|suscripci[oó]n|renueva|renovaci[oó]n|descuento|ahorr|oferta limitada|(?<![a-zñáéíóú])limitad|[uú]ltima oportunidad|garantiz|garant[ií]a|resultados|aument|ventas|ingresos|valorad|estrellas|miles|cientos|quedan|plazas|cupos|\d\s?%|por ciento|cobraremos|le cobrar|\$/i, "es: no trial, forever/lifetime, subscription, renewal, discount, urgency, scarcity, result, rating or price wording"],
  // Russian
  [/пробн|бесплатн\w+ (навсегда|пожизненно|тариф|план)|навсегда|пожизненн|подписк|продлева|автопродлен|скидк|выгод|экономи|(?<![а-яё])акци[яи]|ограничен|последний шанс|гарант|результат|(?<![а-яё])рост(?![а-яё])|увелич|продаж|(?<![а-яё])доход|рейтинг|звёзд|звезд|тысяч|сотни|осталось|(?<![а-яё])мест(?![а-яё])|\d\s?%|процент|спишем|\$/i, "ru: no trial, forever/lifetime, subscription, renewal, discount, urgency, scarcity, result, rating or price wording"],
];

/**
 * The dates each step must state in each language, written out as literals on purpose (NOT read from src/i18n/eaTokens.ts): the token table and these literals are two independent
 * statements of the same calendar facts, and `ea:check` fails when they disagree or when either disagrees with the IANA database. Index 0 = the initial end, 1 and 2 = the extension steps.
 * last = the last included day (Israel), end = the day access ends at 00:00 Israel time, utc = the UTC line of the plan cards ("22:00 UTC on <last day>").
 */
export const REQUIRED_DATES = {
  en: [
    { last: "December 31, 2026", end: "January 1, 2027", utc: "22:00 UTC on December 31" },
    { last: "January 31, 2027", end: "February 1, 2027", utc: "22:00 UTC on January 31" },
    { last: "February 28, 2027", end: "March 1, 2027", utc: "22:00 UTC on February 28" },
  ],
  he: [
    { last: "31 בדצמבר 2026", end: "1 בינואר 2027", utc: "22:00 UTC ב־31 בדצמבר" },
    { last: "31 בינואר 2027", end: "1 בפברואר 2027", utc: "22:00 UTC ב־31 בינואר" },
    { last: "28 בפברואר 2027", end: "1 במרץ 2027", utc: "22:00 UTC ב־28 בפברואר" },
  ],
  es: [
    { last: "31 de diciembre de 2026", end: "1 de enero de 2027", utc: "22:00 UTC del 31 de diciembre" },
    { last: "31 de enero de 2027", end: "1 de febrero de 2027", utc: "22:00 UTC del 31 de enero" },
    { last: "28 de febrero de 2027", end: "1 de marzo de 2027", utc: "22:00 UTC del 28 de febrero" },
  ],
  ru: [
    { last: "31 декабря 2026", end: "1 января 2027", utc: "22:00 UTC 31 декабря" },
    { last: "31 января 2027", end: "1 февраля 2027", utc: "22:00 UTC 31 января" },
    { last: "28 февраля 2027", end: "1 марта 2027", utc: "22:00 UTC 28 февраля" },
  ],
};

/**
 * Facts every locale must state in EVERY step (Production 21): the permanent extension reservation (terms line and questions; it promises the notice ON THE PAGE before the end date, and e-mail only "where we can": the Control Plane has no working e-mail sender yet, so no required token may demand e-mail), the plan-change answer, the guarantee answer (paid purchases only)
 * and, in an extended build, the extended bar and note. Written as that language writes them; a rewrite that drops one fails `ea:check`.
 */
export const REQUIRED_FACTS = {
  en: { soft: "where we can", renew: "Renew plan", every: "every Early Access store", noCharge: "never starts a charge", before: "on this page before the end date", single: "single store's access", changeBefore: "before Early Access ends", changeFree: "at no charge", sameEnd: "The end date stays the same", paidPurchases: "eligible paid purchases", noteEvery: "every Early Access store", extEvery: "every store", extPay: "no payment is taken", extAuto: "automatically", extZone: "Israel time" },
  he: { soft: "במקום שנוכל", renew: "חידוש התוכנית", every: "לכל חנויות הגישה המוקדמת בבת אחת", noCharge: "לעולם לא מתחילה חיוב", before: "בעמוד הזה לפני תאריך הסיום", single: "של חנות בודדת", changeBefore: "לפני שהגישה המוקדמת מסתיימת", changeFree: "ללא תשלום", sameEnd: "תאריך הסיום נשאר אותו תאריך", paidPurchases: "רכישות בתשלום הזכאיות לכך", noteEvery: "לכל חנות בגישה מוקדמת", extEvery: "לכל החנויות", extPay: "לא נגבה תשלום", extAuto: "אוטומטית", extZone: "שעון ישראל" },
  es: { soft: "cuando podemos", renew: "Renew plan", every: "todas las tiendas del Acceso anticipado a la vez", noCharge: "nunca inicia un cobro", before: "en esta página antes de la fecha de fin", single: "de una sola tienda", changeBefore: "antes de que termine el Acceso anticipado", changeFree: "sin ningún coste", sameEnd: "La fecha de fin no cambia", paidPurchases: "compras de pago que cumplan los requisitos", noteEvery: "todas las tiendas del Acceso anticipado", extEvery: "todas las tiendas", extPay: "no se toma ningún pago", extAuto: "automáticamente", extZone: "hora de Israel" },
  ru: { soft: "где можем", renew: "Renew plan", every: "для всех магазинов раннего доступа", noCharge: "никогда не запускает списание", before: "на этой странице до даты окончания", single: "отдельного магазина", changeBefore: "до окончания раннего доступа", changeFree: "бесплатно", sameEnd: "Дата окончания останется прежней", paidPurchases: "платные покупки, которые под неё подпадают", noteEvery: "всех магазинов раннего доступа", extEvery: "всех магазинов", extPay: "платёж не взимается", extAuto: "автоматически", extZone: "по израильскому времени" },
};

/** What the P20 guarantee and plugin answers said and the Plugin no longer says on a free grant: it must not come back (the Plugin is corrected in `feat/p21-guarantee-fix`). */
export const FORBIDDEN_SENTENCES = {
  en: ["may show a 14-day", "money-back message"],
  he: ["ייתכן שהתוסף יציג", "הודעה על החזר כספי"],
  es: ["puede mostrar en sus primeros días", "mensaje de devolución"],
  ru: ["плагин может показывать", "сообщение о возврате"],
};

/** Dates and facts every locale must state, written as that language writes them. Checked against the strings that carry them. */
export const REQUIRED = {
  en: { last: "December 31, 2026", end: "January 1, 2027", auto: "automatically", card: "credit card", paid: "paid plan", zone: "Israel time", utc: "22:00 UTC" },
  he: { last: "31 בדצמבר 2026", end: "1 בינואר 2027", auto: "אוטומטית", card: "כרטיס אשראי", paid: "בתשלום", zone: "שעון ישראל", utc: "22:00 UTC" },
  es: { last: "31 de diciembre de 2026", end: "1 de enero de 2027", auto: "automáticamente", card: "tarjeta de crédito", paid: "plan de pago", zone: "hora de Israel", utc: "22:00 UTC" },
  ru: { last: "31 декабря 2026", end: "1 января 2027", auto: "втоматически", card: "карта", paid: "латный план", zone: "по израильскому времени", utc: "22:00 UTC" },
};

/** The only campaign files: the four language packs. A path that merely starts like the folder, climbs out of it with .., or names another file in it is NOT one. */
export const CAMPAIGN_FILES = new Set(["en", "he", "es", "ru"].map((l) => `${EA_DIR}${l}.ts`));
export function isCampaignFile(relPath) {
  return CAMPAIGN_FILES.has(String(relPath).replace(/\\/g, "/"));
}

const walk = (o, path, out) => {
  if (typeof o === "string") out.push([path, o]);
  else if (o && typeof o === "object") for (const k of Object.keys(o)) walk(o[k], path ? `${path}.${k}` : k, out);
  return out;
};

/**
 * Problems of one locale's campaign dictionary `ea` (the merged one the site renders):
 * the free-until date and the end date appear where the offer is stated, "nothing is charged automatically", "no credit card" and the voluntary paid continuation are stated.
 */
export function eaDisclosureProblems(locale, ea, step = 0) {
  const need = { ...REQUIRED[locale], ...REQUIRED_DATES[locale][step] };
  const facts = REQUIRED_FACTS[locale];
  const problems = [];
  const nb = (x) => x.replace(/\u00a0/g, " "); // Russian packs use no-break spaces; the required phrases are written with plain ones
  const has = (path, tok) => { const v = path.split(".").reduce((a, k) => a?.[k], ea); return typeof v === "string" && nb(v).includes(nb(tok)); };
  // the offer statements: which string must carry which date
  for (const [path, tok] of [
    ["bar.live", need.last], ["bar.announce", need.last],
    ["hero.note", need.end], ["plan.free", need.last], ["plan.ends", need.end],
    ["section.lead", need.last], ["section.lead", need.end], ["section.homeLead", need.last], ["section.homeLead", need.end],
    ["section.steps.use.body", need.last], ["section.steps.decide.body", need.end],
    ["section.endTitle", need.end], ["after.body", need.end],
    // the time zone: the instant is midnight in Israel = 22:00 UTC the day before; a visitor elsewhere must be told which clock
    ["bar.live", need.zone], ["bar.announce", need.zone], ["hero.note", need.zone], ["plan.term", need.zone], ["plan.ends", need.zone], ["plan.ends", need.utc],
    ["section.lead", need.zone], ["section.lead", need.utc], ["section.homeLead", need.zone], ["after.body", need.zone],
    ["section.steps.decide.body", need.zone], ["section.who.b", need.zone], ["section.faq.end.a", need.zone], ["section.faq.plugin.a", need.zone],
    // the promises: no card, nothing charged automatically, a paid plan only by the merchant's choice
    ["hero.note", need.auto], ["hero.note", need.card], ["section.lead", need.auto], ["after.body", need.auto], ["plan.ends", need.paid], ["section.lead", need.paid],
    ["section.faq.free.a", need.last], ["section.faq.end.q", need.end],
    // the UTC line of the plan card names the UTC day of the step ("22:00 UTC on January 31")
    ["plan.ends", need.utc],
    // Production 21: the extension reservation is permanent (terms line and questions), the plan change is answered, the guarantee is for paid purchases only
    ["section.reservation", facts.every], ["section.reservation", facts.noCharge], ["section.reservation", facts.before], ["section.reservation", facts.single],
    ["section.faq.extension.a", facts.every], ["section.faq.extension.a", facts.noCharge], ["section.faq.extension.a", facts.before], ["section.faq.extension.a", facts.single],
    ["section.faq.change.a", facts.changeBefore], ["section.faq.change.a", facts.changeFree], ["section.faq.change.a", facts.sameEnd], ["section.faq.change.a", "{contactEmail}"],
    ["section.faq.plugin.a", facts.renew], ["section.faq.guarantee.a", facts.paidPurchases], ["section.faq.guarantee.a", "route:refund-policy"],
    // the extended variant (rendered only by an extended build, checked in every step): the clock, no payment, nothing automatic, every store
    ["extended.bar", facts.extEvery], ["extended.bar", facts.extZone], ["extended.bar", need.last],
    ["extended.note", facts.noteEvery], ["extended.note", facts.extPay], ["extended.note", facts.extAuto],
  ]) if (!has(path, tok)) problems.push(`${locale}: ea.${path} must contain "${tok}"`);
  // e-mail may be mentioned only as a best effort: the Control Plane has no working e-mail sender, so a promise of e-mail without "where we can" is false
  for (const p of ["section.reservation", "section.faq.extension.a"]) {
    const v = nb(p.split(".").reduce((a, k) => a?.[k], ea) || "");
    if (/e-?mail|דוא״ל|correo|почт/i.test(v) && !v.includes(nb(facts.soft))) problems.push(`${locale}: ea.${p} promises e-mail without "${facts.soft}" (no e-mail sender exists yet)`);
  }
  for (const bad of FORBIDDEN_SENTENCES[locale]) for (const [p, v] of walk(ea, "", [])) if (v.includes(bad)) problems.push(`${locale}: ea.${p} must not say "${bad}" (the Plugin no longer shows a money-back message on a free grant)`);
  // no date token may be left unresolved in a resolved dictionary
  for (const [p, v] of walk(ea, "", [])) if (/\{(lastDay|lastDayShort|endDate|firstLastDay)\}/.test(v)) problems.push(`${locale}: ea.${p} still contains an unresolved date token`);
  // every dictionary string must be non-empty
  for (const [p, v] of walk(ea, "", [])) if (!v.trim()) problems.push(`${locale}: ea.${p} is empty`);
  return problems;
}

/** The three FAQ lines that must name a banned idea in order to deny or quote it (the guarantee does not apply to Early Access; nothing renews or is charged automatically; the Plugin's own "Renew plan" wording); they are exempt from the extra bans (never from the base rules) and are reviewed by hand. */
export const EA_EXEMPT_LINE = /^\s*(guarantee|auto|plugin):\s*\{/;
