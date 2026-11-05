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
  [/\btrial\b|\bfree (plan|tier|version|forever|to try|to start|download)\b|freemium|start free/i, "en: this is not a trial or a free plan"],
  [/\bsubscri(be|ption)\b|auto-?renew|renews? automatically|recurring|automatically (charged|billed|renewed|converted)/i, "en: no subscription or automatic-charge wording (say that nothing is charged automatically)"],
  [/\b(discount|% ?off|save \d|deal|coupon|promo code|sale)\b|\d\s?%/i, "en: no discount or percentage wording (the regular price is shown as a fact, never as a saving)"],
  [/\b(limited time|hurry|last chance|act now|only \d+ (spots|places|left)|countdown|ends soon|don't miss)\b/i, "en: no urgency devices (the end date is stated once, as a date)"],
  [/\b(guarantee[sd]?|results?|increase|boost|revenue|sales|conversion)\b(?!.{0,40}\b(not|never|no)\b)/i, "en: no result or guarantee claim in campaign copy"],
  [/תקופת ניסיון|ניסיון חינם|מנוי|מתחדש\w* אוטומטית|הנחה|\d\s?%/, "he: no trial, subscription, auto-renew, discount or percentage wording"],
  [/prueba|suscripci[oó]n|renovaci[oó]n autom[aá]tica|descuento|oferta limitada|\d\s?%/i, "es: no trial, subscription, auto-renew, discount or percentage wording"],
  [/пробн|подписк|автопродлен|автоматическ\w+ продл|скидк|\d\s?%/i, "ru: no trial, subscription, auto-renew, discount or percentage wording"],
];

/** Dates and facts every locale must state, written as that language writes them. Checked against the strings that carry them. */
export const REQUIRED = {
  en: { last: "December 31, 2026", end: "January 1, 2027", auto: "automatically", card: "credit card", paid: "paid plan" },
  he: { last: "31 בדצמבר 2026", end: "1 בינואר 2027", auto: "אוטומטית", card: "כרטיס אשראי", paid: "בתשלום" },
  es: { last: "31 de diciembre de 2026", end: "1 de enero de 2027", auto: "automáticamente", card: "tarjeta de crédito", paid: "plan de pago" },
  ru: { last: "31 декабря 2026", end: "1 января 2027", auto: "втоматически", card: "карта", paid: "латный план" },
};

/** True only for a file INSIDE the campaign folder. A path that merely starts like it, or climbs out of it with .., is not one. */
export function isCampaignFile(relPath) {
  const norm = String(relPath).replace(/\\/g, "/");
  return norm.startsWith(EA_DIR) && !norm.split("/").includes("..");
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
    // the promises: no card, nothing charged automatically, a paid plan only by the merchant's choice
    ["hero.note", need.auto], ["hero.note", need.card], ["section.lead", need.auto], ["after.body", need.auto], ["plan.ends", need.paid], ["section.lead", need.paid],
    ["section.faq.free.a", need.last], ["section.faq.end.q", need.end],
  ]) if (!has(path, tok)) problems.push(`${locale}: ea.${path} must contain "${tok}"`);
  // every dictionary string must be non-empty
  for (const [p, v] of walk(ea, "", [])) if (!v.trim()) problems.push(`${locale}: ea.${p} is empty`);
  return problems;
}
