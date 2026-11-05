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
export function eaDisclosureProblems(locale, ea) {
  const need = REQUIRED[locale];
  const problems = [];
  const has = (path, tok) => { const v = path.split(".").reduce((a, k) => a?.[k], ea); return typeof v === "string" && v.includes(tok); };
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
  ]) if (!has(path, tok)) problems.push(`${locale}: ea.${path} must contain "${tok}"`);
  // every dictionary string must be non-empty
  for (const [p, v] of walk(ea, "", [])) if (!v.trim()) problems.push(`${locale}: ea.${p} is empty`);
  return problems;
}

/** The two FAQ lines that must name a banned idea in order to deny it (the guarantee does not apply; nothing renews or is charged automatically); it is exempt from the extra bans and is reviewed by hand. */
export const EA_EXEMPT_LINE = /^\s*(guarantee|auto):\s*\{/;
