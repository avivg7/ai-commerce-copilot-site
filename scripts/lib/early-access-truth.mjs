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
  // P32: "Sin renovación automática" is the owner-required denial on the plan cards; the positive wording stays banned by the EA extra rule for Spanish below
  "es: auto-renew",
  // P34: "Solo renovación manual" is the owner's "Manual renewal only": exempt ONLY as the exact whole value of a `manual:` line (eaExtraRulesProbe); every other "renovación" stays banned unless denied with "sin"
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
  [/prueba|gratis (para siempre|de por vida)|para siempre|de por vida|suscripci[oó]n|renueva|(?<!sin )renovaci[oó]n|(?<!sin )renov\w*[^".;]{0,60}autom[aá]tic|autom[aá]tic\w*[^".;]{0,60}renov|descuento|ahorr|oferta limitada|(?<![a-zñáéíóú])limitad|[uú]ltima oportunidad|garantiz|garant[ií]a|resultados|aument|ventas|ingresos|valorad|estrellas|miles|cientos|quedan|plazas|cupos|\d\s?%|por ciento|cobraremos|le cobrar|\$/i, "es: no trial, forever/lifetime, subscription, renewal, discount, urgency, scarcity, result, rating or price wording"],
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
  en: { h24: "24 hours", closedEvery: "every store already in it", original: "original end date", soft: "where we can", renew: "Renew plan", every: "every launch-offer store", noCharge: "never starts a charge", before: "on this page before the end date", single: "single store's access", changeBefore: "before the launch offer ends", changeFree: "at no charge", sameEnd: "The end date stays the same", paidPurchases: "eligible paid purchases", noteEvery: "every launch-offer store", extEvery: "every store", extPay: "no payment is taken", extAuto: "automatically", extZone: "Israel time", decision: "explicit renewal decision", notOpen: "paid purchases are not open yet", approved: "approved stores" },
  he: { h24: "24 שעות", closedEvery: "לכל חנות שכבר נמצאת בה", original: "מועד הסיום המקורי", soft: "במקום שנוכל", renew: "חידוש התוכנית", every: "לכל חנויות הצעת ההשקה בבת אחת", noCharge: "לעולם לא מתחילה חיוב", before: "בעמוד הזה לפני תאריך הסיום", single: "של חנות בודדת", changeBefore: "לפני שהצעת ההשקה מסתיימת", changeFree: "ללא תשלום", sameEnd: "תאריך הסיום נשאר אותו תאריך", paidPurchases: "רכישות בתשלום הזכאיות לכך", noteEvery: "לכל חנות בהצעת ההשקה", extEvery: "לכל החנויות", extPay: "לא נגבה תשלום", extAuto: "אוטומטית", extZone: "שעון ישראל", decision: "החלטת חידוש מפורשת", notOpen: "רכישות בתשלום עדיין אינן פתוחות", approved: "לחנויות מאושרות" },
  es: { h24: "24 horas", closedEvery: "todas las tiendas que ya participan", original: "fecha de fin original", soft: "cuando podemos", renew: "botón para renovar el plan", every: "todas las tiendas de la oferta de lanzamiento a la vez", noCharge: "nunca inicia un cobro", before: "en esta página antes de la fecha de fin", single: "de una sola tienda", changeBefore: "antes de que termine la oferta de lanzamiento", changeFree: "sin ningún coste", sameEnd: "La fecha de fin no cambia", paidPurchases: "compras de pago que cumplan los requisitos", noteEvery: "todas las tiendas de la oferta de lanzamiento", extEvery: "todas las tiendas", extPay: "no se toma ningún pago", extAuto: "automáticamente", extZone: "hora de Israel", decision: "decisión explícita de renovar", notOpen: "las compras de pago aún no están abiertas", approved: "tiendas aprobadas" },
  ru: { h24: "24 часа", closedEvery: "всех магазинов, которые уже в нём", original: "первоначальн", soft: "где можем", renew: "кнопкой продления плана", every: "для всех магазинов предложения в честь запуска", noCharge: "никогда не запускает списание", before: "на этой странице до даты окончания", single: "отдельного магазина", changeBefore: "до окончания предложения в честь запуска", changeFree: "бесплатно", sameEnd: "Дата окончания останется прежней", paidPurchases: "платные покупки, которые под неё подпадают", noteEvery: "всех магазинов предложения в честь запуска", extEvery: "всех магазинов", extPay: "платёж не взимается", extAuto: "автоматически", extZone: "по израильскому времени", decision: "явное решение о продлении", notOpen: "платные покупки пока не открыты", approved: "одобренных магазинов" },
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
  const has = (path, tok) => { const v = path.split(".").reduce((a, k) => a?.[k], ea); return typeof v === "string" && nb(v).toLowerCase().includes(nb(tok).toLowerCase()); };
  // the offer statements: which string must carry which date, the clock, and the promises (P32: no hero fine print exists any more; the facts live in the bar, the cards and the explanation)
  for (const [path, tok] of [
    ["bar.live", need.last], ["bar.announce", need.last], ["hero.badge", need.last],
    ["plan.free", need.last], ["plan.ends", need.end], ["plan.term", need.last],
    ["section.lead", need.last], ["section.lead", need.end], ["section.homeLead", need.last], ["section.homeLead", need.end],
    ["section.steps.use.body", need.last], ["section.steps.decide.body", need.end],
    ["section.endTitle", need.end], ["after.body", need.end],
    // the time zone: the instant is midnight in Israel = 22:00 UTC the day before; a visitor elsewhere must be told which clock
    // P34 (owner wording, review P34-4): the bar and the Hero pill say "Free for approved stores until <last day>" (the approved-stores qualifier is required there); the clock and the
    // exact instant are required where the end is stated (cards, explanation, questions), not in the bar
    ["bar.live", facts.approved], ["bar.announce", facts.approved], ["hero.badge", facts.approved],
    ["plan.term", need.zone], ["plan.ends", need.zone], ["plan.ends", need.utc],
    ["section.lead", need.zone], ["section.lead", need.utc], ["section.homeLead", need.zone], ["after.body", need.zone],
    ["section.steps.decide.body", need.zone], ["section.who.b", need.zone], ["section.faq.end.a", need.zone], ["section.faq.plugin.a", need.zone],
    // the promises: no card, nothing charged automatically, an explicit renewal decision to continue, paid purchases not open (and no promise of a paid plan in 2027)
    ["plan.noCard", need.card], ["section.lead", need.auto], ["after.body", need.auto], ["section.steps.decide.body", need.auto],
    ["pricing.decision", facts.decision], ["section.lead", facts.decision], ["section.homeLead", facts.decision], ["section.steps.decide.body", facts.decision],
    ["section.end.c", facts.decision], ["section.faq.end.a", facts.decision], ["section.faq.continue.a", facts.decision], ["after.body", facts.decision],
    ["pricing.note", facts.notOpen], ["section.steps.decide.body", facts.notOpen], ["section.end.c", facts.notOpen], ["section.faq.end.a", facts.notOpen], ["section.faq.continue.a", facts.notOpen], ["after.body", facts.notOpen],
    ["section.faq.free.a", need.last], ["section.faq.end.q", need.end],
    // the extension reservation is permanent (terms line and questions), the plan change is answered, the guarantee is for paid purchases only
    ["section.reservation", facts.every], ["section.reservation", facts.noCharge], ["section.reservation", facts.before], ["section.reservation", facts.single],
    ["section.faq.extension.a", facts.every], ["section.faq.extension.a", facts.noCharge], ["section.faq.extension.a", facts.before], ["section.faq.extension.a", facts.single],
    ["section.faq.change.a", facts.changeBefore], ["section.faq.change.a", facts.changeFree], ["section.faq.change.a", facts.sameEnd], ["section.faq.change.a", "{contactEmail}"],
    ["section.faq.plugin.a", facts.renew], ["section.faq.guarantee.a", facts.paidPurchases], ["section.faq.guarantee.a", "route:refund-policy"],
    // the extended variant (rendered only by an extended build, checked in every step): the clock, no payment, nothing automatic, every store
    ["extended.bar", facts.extEvery], ["extended.bar", facts.extZone], ["extended.bar", need.last],
    // the clock is named wherever the end is stated: cards, the page heading, the first question, the "use" step and the extension note
    ["plan.free", need.zone], ["section.title", need.zone], ["section.faq.free.a", need.zone], ["section.steps.use.body", need.zone], ["extended.note", need.zone],
    // from the INITIAL end until the extended end (extended OPEN builds): no request is offered, the extension is for stores already in the offer, and the wording still names the clock
    ["extended.barClosed", facts.closedEvery], ["extended.barClosed", need.zone], ["extended.barClosed", need.last], ["extended.barClosed", facts.original],
    ["extended.closedNote", facts.original],
    ["section.homeLeadClosed", need.zone], ["section.homeLeadClosed", need.last], ["section.homeLeadClosed", need.end], ["section.homeLeadClosed", facts.original],
    ["section.steps.requestClosed.body", need.last], ["section.steps.requestClosed.body", need.zone], ["section.steps.requestClosed.body", facts.original],
    ["section.who.dExtended", facts.original],
    // announce builds with an extension: nothing can be requested, so the wording says the end date MOVED (never "for every store"), still names the clock and the charge rule
    ["extended.barAnnounce", need.zone], ["extended.barAnnounce", need.last], ["extended.noteAnnounce", need.zone], ["extended.noteAnnounce", need.auto],
    // the requests cutoff next to the offer and the closed wording of the "who it is for" lines
    ["section.intakeCutoff", facts.h24], ["section.intakeCutoffExt", facts.h24], ["section.intakeCutoffExt", facts.original],
    ["extended.note", facts.noteEvery], ["extended.note", facts.extPay], ["extended.note", facts.extAuto],
    // the request pages: the clock, the processors named next to the form (Cloudflare Turnstile and the e-mail provider placeholder), the legal links, the contract's neutral success text is the only success text
    ["request.lead", need.last], ["request.lead", need.zone], ["request.notice", "Cloudflare Turnstile"], ["request.notice", "{mailProvider}"], ["request.notice", "route:privacy"],
    ["request.consent", "route:terms"], ["request.consent", "route:privacy"], ["section.notice", "route:privacy"], ["request.notice", "route:privacy"],
    // the announce variants (P32 review): coming soon, never read as live; the dates, the clock and the renewal decision are still stated
    ["section.homeLeadAnnounce", need.last], ["section.homeLeadAnnounce", need.end], ["section.homeLeadAnnounce", need.zone], ["section.homeLeadAnnounce", facts.decision],
    ["section.leadAnnounce", need.last], ["section.leadAnnounce", need.end], ["section.leadAnnounce", need.zone], ["section.leadAnnounce", need.utc], ["section.leadAnnounce", need.auto], ["section.leadAnnounce", facts.decision],
    ["section.steps.useAnnounce.body", need.last], ["section.steps.useAnnounce.body", need.zone], ["section.faq.free.aAnnounce", need.last], ["section.faq.free.aAnnounce", need.zone],
    ["section.terms", facts.h24],
    // P34: the support lines under the Hero buttons and under the plan cards name the card (the "approved stores" and exact-instant facts stay on every card, required above)
    ["hero.support.noCard", need.card], ["pricing.support.noCard", need.card],
  ]) if (!has(path, tok)) problems.push(`${locale}: ea.${path} must contain "${tok}"`);
  // one name for the offer, on every surface and in every language (P32): the surfaces below carry it, and the older name "Early Access" appears ONLY in the one sentence that links the offer to the legal pages (section.terms)
  {
    const NAME = { en: /launch[- ]offer/i, he: /הצעת ה?השקה/, es: /oferta de lanzamiento/i, ru: /предложени\S* в[\s\u00a0]честь[\s\u00a0]запуска/i }[locale];
    const OLD = { en: /early access/i, he: /גישה מוקדמת/, es: /acceso anticipado/i, ru: /ранн\S* доступ/i }[locale];
    for (const p of ["bar.live", "bar.announce", "hero.badgeTag", "hero.badgeTagAnnounce", "plan.pill", "pricing.support.noCard", "section.title", "section.faqTitle", "section.link", "section.homeLeadAnnounce", "section.faq.free.q", "plan.term", "plan.regular", "section.faq.guarantee.q", "request.lead", "pricing.note", "pricing.label"]) {
      const v = nb(p.split(".").reduce((a, k) => a?.[k], ea) || "");
      if (!NAME.test(v)) problems.push(`${locale}: ea.${p} must name the offer (${NAME})`);
    }
    for (const [p, v] of walk(ea, "", [])) if (p !== "section.terms" && OLD.test(nb(v))) problems.push(`${locale}: ea.${p} uses the older name "Early Access" (only section.terms may name it, once, to link the offer to the legal pages)`);
    if (!OLD.test(nb(ea.section.terms))) problems.push(`${locale}: ea.section.terms must name the older legal-page name once (${OLD})`);
    if (!NAME.test(nb(ea.offerName || ""))) problems.push(`${locale}: ea.offerName must be the offer's name (${NAME})`);
  }
  // the owner's rules for the cards and the pages: never a "from 2027" promise, no percentage or "save" wording is possible in these files (EA_EXTRA_RULES), and no hero fine print key exists any more
  for (const [p, v] of walk(ea, "", [])) if (/\b(from|in|starting|beginning)\s+(january\s+)?2027\b|\bfrom\s+2027\b/i.test(v)) problems.push(`${locale}: ea.${p} promises something "from 2027" (no paid continuation is promised)`);
  for (const k of ["note", "noteClosed"]) if (ea.hero && k in ea.hero) problems.push(`${locale}: ea.hero.${k} exists: the owner removed every fine print under the hero buttons`);
  // P34: the owner's short support lines replace the fine print; each is one short line (no sentence, no paragraph), the manual and limited lines are the exact approved phrases
  for (const [p, v] of [...walk(ea.hero?.support, "hero.support", []), ...walk(ea.pricing?.support, "pricing.support", [])]) if (nb(v).length > 64 || /[.!;:]/.test(v)) problems.push(`${locale}: ea.${p} must be one short line (at most 64 characters, no sentence punctuation): "${v}"`);
  for (const k of ["noCard", "manual", "limited"]) if (!ea.hero?.support?.[k]) problems.push(`${locale}: ea.hero.support.${k} is missing`);
  for (const k of ["noCard", "manual", "regular"]) if (!ea.pricing?.support?.[k]) problems.push(`${locale}: ea.pricing.support.${k} is missing`);
  for (const p of ["hero.support.manual", "pricing.support.manual"]) if (nb(p.split(".").reduce((a, k) => a?.[k], ea) || "") !== nb(EA_MANUAL_PHRASE[locale])) problems.push(`${locale}: ea.${p} must be exactly "${EA_MANUAL_PHRASE[locale]}"`);
  if (nb(ea.hero?.support?.limited || "") !== nb(EA_LIMITED_PHRASE[locale])) problems.push(`${locale}: ea.hero.support.limited must be exactly "${EA_LIMITED_PHRASE[locale]}" (no number, countdown or urgency)`);
  if (ea.hero?.badgeTagAnnounce === ea.hero?.badgeTag || ea.bar?.announce === ea.bar?.live) problems.push(`${locale}: the announce badge and bar must differ from the open ones (an announce page must not read as live)`);
  if (ea.hero && "badgeAnnounce" in ea.hero) problems.push(`${locale}: ea.hero.badgeAnnounce exists: the P34 pill is badgeTag / badgeTagAnnounce plus badge`);
  // e-mail may be mentioned only as a best effort: the Control Plane has no working e-mail sender, so a promise of e-mail without "where we can" is false
  for (const p of ["section.reservation", "section.faq.extension.a"]) {
    const v = nb(p.split(".").reduce((a, k) => a?.[k], ea) || "");
    if (/e-?mail|דוא״ל|correo|почт/i.test(v) && !v.includes(nb(facts.soft))) problems.push(`${locale}: ea.${p} promises e-mail without "${facts.soft}" (no e-mail sender exists yet)`);
  }
  // typography and register (Production 21 review R1-n3, n4): the clock moment never breaks between the word before "00:00" and the time (a no-break space), and Spanish addresses the merchant as usted throughout
  const NBSP_RULES = { en: [/\bat 00:00/i, "the time 00:00 must follow \"at\" with a no-break space"], he: [/בשעה 00:00/, "00:00 must follow בשעה with a no-break space (a wrap left \"00:00,\" at the start of a line)"], es: [/a las 00:00/i, "00:00 must follow \"a las\" with no-break spaces"] };
  if (NBSP_RULES[locale]) for (const [p, v] of walk(ea, "", [])) if (NBSP_RULES[locale][0].test(v)) problems.push(`${locale}: ea.${p}: ${NBSP_RULES[locale][1]}`);
  if (locale === "es") for (const [p, v] of walk(ea, "", [])) if (/(?<!usted )\bcompra (el|un) plan/i.test(v)) problems.push(`es: ea.${p} uses an informal or ambiguous "compra" (write "usted compra")`);
  for (const p of ["extended.barAnnounce", "extended.noteAnnounce"]) { const v = nb(p.split(".").reduce((a, k) => a?.[k], ea) || ""); if (v.includes(nb(facts.extEvery)) || v.includes(nb(facts.noteEvery))) problems.push(`${locale}: ea.${p} must not say "for every store" (an announce build admits nobody)`); }
  for (const bad of FORBIDDEN_SENTENCES[locale]) for (const [p, v] of walk(ea, "", [])) if (v.includes(bad)) problems.push(`${locale}: ea.${p} must not say "${bad}" (the Plugin no longer shows a money-back message on a free grant)`);
  // no date token may be left unresolved in a resolved dictionary
  for (const [p, v] of walk(ea, "", [])) if (/\{(lastDay|lastDayShort|endDate|firstLastDay)\}/.test(v)) problems.push(`${locale}: ea.${p} still contains an unresolved date token`);
  // every dictionary string must be non-empty
  for (const [p, v] of walk(ea, "", [])) if (!v.trim()) problems.push(`${locale}: ea.${p} is empty`);
  return problems;
}

/**
 * P34 "Limited availability" (owner request, behind NEXT_PUBLIC_AICC_EA_LIMITED_NOTE=on and the owner attestation AICC_EA_LIMITED_ATTESTED in launch:check). The scarcity bans above stay in force:
 * the ONE exception is this exact phrase, in its own language, as the whole value of a `limited:` key. A number, a countdown, "only N left", "hurry" or any other word on that line is still caught.
 * It is true only because every request is reviewed, approvals are capped and the offer can close to new requests at any time (section.who.d says so in every language).
 */
export const EA_LIMITED_PHRASE = { en: "Limited availability", he: "זמינות מוגבלת", es: "Disponibilidad limitada", ru: "Ограниченная доступность" };
const EA_LIMITED_LINE = /^\s*limited:\s*"([^"]*)",?\s*$/;
const EA_MANUAL_LINE = /^\s*manual:\s*"([^"]*)",?\s*$/;
/** The line the campaign-only extra rules (EA_EXTRA_RULES) are applied to: the line itself, except that a line that is exactly `limited: "<the approved phrase>",` is blanked out (its key name says "limited" too). */
export function eaExtraRulesProbe(line) {
  const m = String(line).match(EA_LIMITED_LINE);
  if (m && Object.values(EA_LIMITED_PHRASE).includes(m[1])) return "";
  // review P34-1: the Spanish "Solo renovación manual" only as the exact whole value of a `manual:` line
  const n = String(line).match(EA_MANUAL_LINE);
  return n && n[1] === EA_MANUAL_PHRASE.es ? "" : line;
}
/** The owner's "Manual renewal only", as each language writes it (P34): true because nothing renews or is charged by itself and continuing needs an explicit renewal decision. */
export const EA_MANUAL_PHRASE = { en: "Manual renewal only", he: "חידוש ידני בלבד", es: "Solo renovación manual", ru: "Только ручное продление" };

/** The three FAQ lines that must name a banned idea in order to deny or quote it (the guarantee does not apply to Early Access; nothing renews or is charged automatically; the Plugin's own "Renew plan" wording); they are exempt from the extra bans (never from the base rules) and are reviewed by hand. */
export const EA_EXEMPT_LINE = /^\s*(guarantee|auto|plugin):\s*\{/;
