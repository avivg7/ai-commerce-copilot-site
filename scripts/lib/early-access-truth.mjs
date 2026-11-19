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
 * P37 SELF-SERVICE FREE TRIAL copy (the `ss:` block of each src/i18n/ea/<locale>.ts, NEXT_PUBLIC_AICC_SELFSERVICE=on). The launch-offer rules above forbid the word "trial" because the launch offer is not one;
 * the self-service sign-up IS a free trial (one store, a fixed end), so exactly that wording is allowed INSIDE the `ss:` block and nowhere else (the copy:check base rules still ban it in every other file and block).
 * Everything else stays banned there too, and the block gets its own bans: no card wording (the only payment sentence is "no payment method is required for the trial"), no renewal / subscription / billing
 * wording, no discount, urgency, scarcity or count claim, no day-length claim ("14-day trial": the end is a fixed date), no price, no "approved / approval / request" (nobody is approved by hand any more).
 */
// "Join" is banned site-wide (it implies a customer base); inside the block it is allowed ONLY as the waitlist action ("Join the waitlist"), see the two rules below
export const SS_ALLOWED_WHY = new Set(["free tier / trial claim", "free trial", "Join (implies a customer base)", "he: join"]);
const swap = (re, from, why) => { const src = re.source.split(from).join(""); if (src === re.source) throw new Error(`SS rule derivation: "${from}" not found in ${why}`); return new RegExp(src, re.flags); };
export const SS_EXTRA_RULES = [
  // English: "free trial" and "Start free trial" are the feature; a free PLAN / tier / forever / lifetime offer is still not
  [/\bfree (plan|tier|version|forever|for ever|for life|for the first|for founding|for early|to try|to start|download)\b|freemium|start free(?! trial\b)|forever free|lifetime|for life/i, "en: the free trial is not a free plan, a free tier or a lifetime offer"],
  EA_EXTRA_RULES[1], EA_EXTRA_RULES[2], EA_EXTRA_RULES[3],
  // P39 (owner decision: "no automatic paid conversion" is now a required claim): the word "conversion" stays banned (result / sales claims) EXCEPT in the exact phrase "No automatic conversion to a paid plan"; the phrase itself
  // must be complete (an "automatic conversion ..." sentence that does not end up at a paid plan is caught too). Everything else of the old rule (guarantee, results, increase, boost, revenue, sales, rated, trusted ...) is unchanged.
  [swap(EA_EXTRA_RULES[4][0], "|conversion", "en result rule"), EA_EXTRA_RULES[4][1]],
  [/(?<!\bno automatic )\bconversions?\b/i, "en: \"conversion\" only inside the exact claim \"No automatic conversion to a paid plan\""],
  [/\bno automatic conversion\b(?! to a paid plan\b)/i, "en: the claim must read exactly \"No automatic conversion to a paid plan\""],
  EA_EXTRA_RULES[5],
  [swap(EA_EXTRA_RULES[6][0], "תקופת ניסיון|ניסיון חינם|", "he"), EA_EXTRA_RULES[6][1].replace("no trial, ", "")],
  [swap(EA_EXTRA_RULES[7][0], "prueba|", "es"), EA_EXTRA_RULES[7][1].replace("no trial, ", "")],
  [swap(EA_EXTRA_RULES[8][0], "пробн|", "ru"), EA_EXTRA_RULES[8][1].replace("no trial, ", "")],
  [/(?<![.\w])join\b(?! the waitlist\b)/i, "en: \"Join\" only as \"Join the waitlist\""],
  [/הצטרפו(?! לרשימת ההמתנה)/, "he: \"join\" only as the waitlist action"],
  // the trial length is a fixed end date, never "N days" (any language)
  [/\b\d+[- ]?days?\b|\d+ (ימים|יום)|\d+[  ]d[ií]as|\d+[  ](дн|день|дней)/i, "no trial length in days (the trial ends on a fixed date, stated as a date)"],
  // no card wording at all: the one payment sentence is "no payment method is required for the trial" (credit card / card / tarjeta / карт / כרטיס)
  [/\bcards?\b|credit|כרטיס|tarjeta|(?<![а-яё])карт/i, "no card wording (say \"no payment method is required for the trial\")"],
  // nobody is approved by hand in the self-service flow, and nothing is requested
  [/approv|\brequests?\b|אישור|מאושר|בקש|aprob|solicitud|одобр|запрос/i, "no approval / request wording (the sign-up is self-service)"],
  // no promise the trial cannot keep
  [/unlimited|no (commitment|obligation|strings)|cancel any ?time|instant(ly)?\b|ללא התחייבות|sin compromiso|без обязательств|мгновенно|inmediat/i, "no unlimited / no-commitment / instant claim"],
];
/**
 * P39 registration cutoff (Control Plane AICC_LM_Trial::REGISTRATION_CUTOFF_UNIX = 1798070400 = 2026-12-24T00:00:00Z; registration is accepted while the server clock is BEFORE it), written out as literals on purpose
 * (NOT read from src/i18n/eaTokens.ts: two independent statements of the same calendar fact; `ea:check` compares them and the IANA/UTC arithmetic). regLast = the last day a trial can be started (UTC).
 */
export const REQUIRED_REG = {
  en: { regDate: "December 24, 2026", regShort: "Dec 24, 2026", regLast: "December 23, 2026" },
  he: { regDate: "24 בדצמבר 2026", regShort: "24 בדצמבר 2026", regLast: "23 בדצמבר 2026" },
  es: { regDate: "24 de diciembre de 2026", regShort: "24 dic 2026", regLast: "23 de diciembre de 2026" },
  ru: { regDate: "24 декабря 2026 г.", regShort: "24 дек. 2026 г.", regLast: "23 декабря 2026 г." },
};
export const SS_REG_UNIX = 1798070400;
/**
 * The ONLY string of the whole pack that may state "00:00" (the registration instant), and the form it must take.
 * P40: the long variant `ss.terms.regValue` is retired (the launch panel shows the same two labelled lines as the cards, once per page), so this list has one entry.
 */
export const SS_REG_PATHS = ["ss.plan.regValue"];
/**
 * The ONLY strings that may name an end or registration DATE (so every date is a labelled line, never a loose "until <date>"): path -> the tokens it carries.
 * P40: the two labelled lines of the launch timeline (plan.regValue, plan.endValue) and the one note that names the last day to start a trial (launch.regNote, {regLast}); the retired long forms
 * (terms.regValue {regDate} {regLast}, terms.endValue {lastDay}) carried the same facts in a second place, which is exactly what the redesign removed (dates once per page).
 */
export const SS_DATE_PATHS = { "plan.regValue": ["regShort"], "plan.endValue": ["until"], "launch.regNote": ["regLast"], "pricing.strikeNote": ["until"] }; // P41: the strike disclosure (strike variant only) carries the offer end ADJACENT to the claim (memo variant B)
/** The ONLY strings that may make the "no automatic conversion to a paid plan" claim (P40: the launch panel fact replaces the card check and the terms line; the hero support line is unchanged). */
export const SS_NOAUTO_PATHS = ["launch.fact.noAuto", "hero.support.noAuto"];
export const SS_PAID_STORES = [1, 3, 10]; // the Backend allowance table: AICC_LM_Early_Access::PLAN_SEATS (trial: 1)
/** Inclusive line range (0-based indexes of `text.split("\n")`) of the top-level `  ss: {` block of a campaign file, as a Set; empty when the file has none. */
export function ssBlockLines(text) {
  // P41: the self-service presentation is two top-level blocks of a campaign pack: `ss:` (the pricing controls, the strings the Control Plane mirrors) and `journey:` (the /get-started/ page, Site only); both may say "free trial"
  const lines = String(text).split("\n"), out = new Set();
  for (const head of [/^  ss: \{\s*$/, /^  journey: \{\s*$/]) {
    const a = lines.findIndex((l) => head.test(l));
    if (a < 0) continue;
    for (let i = a; i < lines.length; i++) { out.add(i); if (i > a && /^  \},?\s*$/.test(lines[i])) break; }
  }
  return out;
}
/** The words each language uses for the facts the trial copy must carry: "payment method", "trial", the automatic-conversion denial, "paid plan", "explicit decision". */
const SS_WORDS = {
  // P40: the "decision" wording is "Continuing is your decision" (the P39 long form said "explicit decision"): the claim that matters is that the customer, not the system, decides; the word is checked per language
  en: { pay: "payment method", trial: /trial/i, store: /store/i, auto: /automatic/i, paid: /paid plan/i, decision: /your decision/i, staging: /staging/i },
  he: { pay: "אמצעי תשלום", trial: /ניסיו[ןנ]/, store: /חנו/, auto: /אוטומטי/, paid: /בתשלום/, decision: /החלטה שלכם/, staging: /אתר בדיקות/ },
  es: { pay: "método de pago", trial: /prueba/i, store: /tienda/i, auto: /automátic/i, paid: /plan de pago/i, decision: /decisión suya/i, staging: /sitio de pruebas/i },
  ru: { pay: "способ оплаты", trial: /пробн|бесплатн\S* период/i, store: /магазин/i, auto: /автоматическ/i, paid: /платн/i, decision: /решаете вы/i, staging: /тестовая копия/i },
};
const escRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Problems of the self-service block of one locale's (resolved) campaign dictionary: present and complete, one store for the trial, the paid allowance exactly 1 / 3 / 10 (never more: those are the numbers
 * the Backend enforces), "no payment method is required for the trial" where payment is mentioned and nowhere an unqualified "no card" claim, the end stated in UTC, five distinct state labels.
 * P39 additions (owner-required claims, each allowed in exactly its strings): "no automatic conversion to a paid plan" (SS_NOAUTO_PATHS only, and nowhere else in the block), the TWO labelled dates (registration closes {regShort} at
 * 00:00 UTC / trial access ends {until} at 22:00 UTC, with the long variants in the terms), no loose date anywhere else (SS_DATE_PATHS), "00:00" only in the registration strings (SS_REG_PATHS), the trial state "opens soon" without a date or promise.
 * `ea` is the RESOLVED dictionary (date tokens replaced), so the date checks compare the literal dates of REQUIRED_DATES / REQUIRED_REG; `raw` (optional) is the unresolved ss block of the pack, which proves the token wiring.
 */
export function ssDisclosureProblems(locale, ea, step = 0, raw = null) {
  const problems = [], ss = ea?.ss, W = SS_WORDS[locale];
  const nb = (x) => String(x).replace(/[\u00a0\u2066\u2069]/g, (c) => (c === "\u00a0" ? " " : "")); // no-break spaces read as spaces; the bidi isolates of the Hebrew times are invisible
  const at = (p) => p.split(".").reduce((a, k) => a?.[k], ss);
  if (!ss) return [`${locale}: ea.ss (the self-service block) is missing`];
  const KEYS = ["bar.label", "bar.text", "bar.link", "cta.start", "cta.purchase", "cta.closed", "cta.choosePlan", "cta.waitlist", "cta.how",
    "state.closedNote", "state.closedPaidNote", "state.line.soon", "state.line.paused", "state.line.open", "state.line.waitlist", "state.demo",
    "pricing.title", "pricing.lead", "pricing.titleClosed", "pricing.leadClosed", "pricing.fit.solo", "pricing.fit.studio", "pricing.fit.agency", "pricing.badge", "pricing.priceLabel", "pricing.per", "pricing.perShort", "pricing.afterOffer", "pricing.strikeLabel", "pricing.strikeNote", "pricing.strikeSr", "pricing.free", "pricing.trial", "pricing.incl",
    "plan.paidOne", "plan.paidMany", "plan.datesLabel", "plan.regLabel", "plan.regValue", "plan.endLabel", "plan.endValue",
    "launch.tag", "launch.sub", "launch.regNote", "launch.endNote", "launch.fact.store", "launch.fact.payment", "launch.fact.noAuto", "launch.foot.paid", "launch.foot.paidOpen",
    "hero.badge", "hero.supportLabel", "hero.support.noPayment", "hero.support.oneStore", "hero.support.noAuto", "band.lead", "link", "meta.pricingDescription", "terms.label", "terms.state"];
  for (const k of KEYS) if (typeof at(k) !== "string" || !at(k).trim()) problems.push(`${locale}: ea.ss.${k} is missing or empty`);
  // the retired P39 keys must not come back (a second place for the dates or the trial conditions is what the P40 redesign removed)
  for (const k of ["plan.trial", "plan.noPayment", "plan.noAuto", "plan.checksLabel", "terms.regValue", "terms.endValue", "terms.store", "terms.payment", "terms.noAuto", "terms.paid",
    "cta.soon", "cta.paused", "state.soonNote", "state.pausedNote", "state.waitlistNote", "pricing.priceLabelStrike"]) if (typeof at(k) === "string") problems.push(`${locale}: ea.ss.${k} exists: it is retired (P40: the dates and the trial conditions are said once per page, in the launch panel: ss.plan.regValue/endValue, ss.launch.*; P41: the unopened / paused / waitlist facts are said once, in the status line ss.state.line.*, and the control is the link ss.cta.how)`);
  if ("cta" in ss && "notOpen" in ss.cta) problems.push(`${locale}: ea.ss.cta.notOpen exists: the P39 state "off" is now the status line ss.state.line.soon plus the link ss.cta.how; the old label is retired`);
  if (problems.length) return problems;
  const R = REQUIRED_REG[locale], D = REQUIRED_DATES[locale][step];
  // the trial covers ONE store, said on the card and in the terms
  for (const k of ["pricing.trial", "launch.fact.store", "hero.support.oneStore", "hero.badge"]) if (!/(^|[^\d])1([^\d]|$)/.test(at(k)) && !/אחת|una\b|одн/i.test(at(k))) problems.push(`${locale}: ea.ss.${k} must state that the trial covers one store`);
  // paid allowance: {n} comes from plans.ts at render time. P40: the literal "1 / 3 / 10" sentence of the P39 terms (ss.terms.paid) is retired; the paid capacity is now written ONLY through the token (so the numbers cannot drift from
  // src/data/plans.ts, the one source) and `scripts/test-pricing-consistency.mjs` asserts that every rendered card shows exactly 1 / 3 / 10; the number rule below still forbids any other count in the pack.
  if (!at("plan.paidMany").includes("{n}")) problems.push(`${locale}: ea.ss.plan.paidMany must carry the {n} token (the store count of plans.ts)`);
  if (/\d/.test(at("plan.paidOne").replace(/\b1\b/, "")) ) problems.push(`${locale}: ea.ss.plan.paidOne may carry no number but 1`);
  // no number anywhere else except the allowed ones: store allowance 1/3/10, the two clocks (22:00 end, 00:00 registration) and the resolved dates; no capacity above the Backend table
  for (const [p, v] of walk(ss, "", [])) {
    let x = nb(v);
    for (const d of [D.last, D.until, R.regDate, R.regShort, R.regLast]) x = x.split(nb(d)).join("");
    const nums = (x.replace(/22:00/g, "").replace(/00:00/g, "").match(/\d+/g) || []).map(Number);
    const bad = nums.filter((n) => !SS_PAID_STORES.includes(n));
    if (bad.length) problems.push(`${locale}: ea.ss.${p} carries the number(s) ${bad.join(", ")}: the only numbers allowed are the store allowance ${SS_PAID_STORES.join(" / ")}, the two UTC clocks (22:00 end, 00:00 registration) and the resolved dates`);
  }
  // payment: only the qualified sentence, in the places that mention it
  for (const k of ["hero.support.noPayment", "pricing.lead"]) { const v = nb(at(k)).toLowerCase(); if (!v.includes(nb(W.pay).toLowerCase()) || !W.trial.test(v)) problems.push(`${locale}: ea.ss.${k} must say "${W.pay}" together with the trial (the only payment claim allowed is: no payment method is required for the trial)`); }
  // P40: the panel fact says "no payment method is required, so nothing is charged" under the panel title that names the free trial (ss.link): the fact must carry the payment-method sentence, the title the trial. The band lead no longer carries a payment claim (the band has no trial conditions).
  if (!nb(at("launch.fact.payment")).toLowerCase().includes(nb(W.pay).toLowerCase())) problems.push(`${locale}: ea.ss.launch.fact.payment must say "${W.pay}"`);
  if (!W.trial.test(at("link"))) problems.push(`${locale}: ea.ss.link (the launch panel title) must name the trial: the panel facts are read under it`);
  if (!W.trial.test(at("launch.sub")) && !W.trial.test(at("launch.fact.store"))) problems.push(`${locale}: the launch panel must name the trial in its intro or in the store fact`);
  { const b = nb(at("band.lead")); if (W.auto.test(b) || /\b(\d+)\b/.test(b) || b.toLowerCase().includes(nb(W.pay).toLowerCase())) problems.push(`${locale}: ea.ss.band.lead is a plain lead sentence: no trial condition, number or payment claim (those are said once, in the launch panel)`); }
  // P39: "no automatic conversion to a paid plan" is REQUIRED in exactly three strings, names the paid plan, and appears NOWHERE else in the block (no other automatic claim)
  for (const k of SS_NOAUTO_PATHS) { const v = nb(at(k)); if (!W.auto.test(v) || !W.paid.test(v)) problems.push(`${locale}: ea.ss.${k} must state that nothing converts to a paid plan automatically (an "automatic" denial that names the paid plan)`); }
  if (!W.decision.test(nb(at("launch.fact.noAuto")))) problems.push(`${locale}: ea.ss.launch.fact.noAuto must say that continuing after the trial is the customer's decision (${W.decision})`);
  // the staging rule of the Backend (a staging site counts as a store) stays in the store fact, since the cards no longer carry the old "one live store" line
  if (!W.staging.test(nb(at("launch.fact.store")))) problems.push(`${locale}: ea.ss.launch.fact.store must keep the staging rule (a staging site counts as a store)`);
  for (const [p, v] of walk(ss, "", [])) if (W.auto.test(nb(v)) && !SS_NOAUTO_PATHS.includes(p) && !SS_AUTO_OK_PATHS.includes(p) && !/^meta\./.test(p)) problems.push(`${locale}: ea.ss.${p} makes an "automatic" claim: the only strings that may are ${SS_NOAUTO_PATHS.join(", ")}`);
  // P39: THE TWO DATES. Registration closes at 00:00 UTC on {regShort} / {regDate}; trial access ends at 22:00 UTC on {until} / {lastDay}: two labelled lines, nowhere a loose date
  const has = (k, tok) => nb(at(k)).includes(nb(tok));
  if (!has("plan.regValue", R.regShort) || !has("plan.regValue", "00:00 UTC") || has("plan.regValue", "22:00")) problems.push(`${locale}: ea.ss.plan.regValue must state the registration close as "${R.regShort}" and "00:00 UTC" (and not the 22:00 end)`);
  if (!has("plan.endValue", D.until) || !has("plan.endValue", "22:00 UTC") || has("plan.endValue", "00:00")) problems.push(`${locale}: ea.ss.plan.endValue must state the trial end as "${D.until}" and "22:00 UTC" (and not the 00:00 registration instant)`);
  if (!has("launch.regNote", R.regLast) || !/UTC/.test(at("launch.regNote")) || /\b(00|22):00\b/.test(at("launch.regNote"))) problems.push(`${locale}: ea.ss.launch.regNote must name the last day to start a trial ("${R.regLast}") and say UTC (no clock time: the clocks live in plan.regValue / plan.endValue)`);
  if (at("plan.regLabel") === at("plan.endLabel")) problems.push(`${locale}: ea.ss.plan.regLabel and endLabel must differ (two separate labelled lines)`);
  for (const [p, v] of walk(ss, "", [])) {
    const x = nb(v), isDatePath = Object.prototype.hasOwnProperty.call(SS_DATE_PATHS, p);
    const dateWords = [D.last, D.until, R.regDate, R.regShort, R.regLast].filter((d) => x.includes(nb(d)));
    if (dateWords.length && !isDatePath) problems.push(`${locale}: ea.ss.${p} states a date ("${dateWords[0]}"): dates live only in the labelled lines ${Object.keys(SS_DATE_PATHS).join(", ")} (a loose "until <date>" hides the second date)`);
    if (/\b(22|00):00\b/.test(x) && !isDatePath) problems.push(`${locale}: ea.ss.${p} states a clock time: only the four labelled date lines may`);
  }
  // the unresolved pack must carry the tokens (the wiring of the dates to the token table) and only the four date strings may
  if (raw) for (const [p, toks] of Object.entries(SS_DATE_PATHS)) for (const t of toks) if (!String(p.split(".").reduce((a, k) => a?.[k], raw)).includes(`{${t}}`)) problems.push(`${locale}: ea.ss.${p} must carry the token {${t}} (the dates come from src/i18n/eaTokens.ts)`);
  // the end is stated in UTC with the last day (the same instant as the Control Plane trial expiry); the registration instant is the Control Plane constant
  // four distinct labels, the trial wording on every state label, the waitlist label names the waitlist; the "opens soon" state carries no date, no "request" and is a statement, not an invitation
  const labels = ["cta.how", "cta.start", "cta.waitlist", "cta.closed", "cta.purchase", "cta.choosePlan"].map(at);
  if (new Set(labels).size !== labels.length) problems.push(`${locale}: the six self-service control labels must all differ`);
  // P40: the labels "Get started free", "Registration closed" and "Registration paused" no longer repeat the word trial (the control sits directly under FREE and "Launch trial: 1 store" in the card, and under the panel title in the page);
  // the trial is named by the sentences around the control instead: the soon label itself, the card's trial line, the closed note ("No new trials can be started") and the closed-paid note.
  for (const k of ["state.line.soon", "state.line.paused", "state.line.open", "state.line.waitlist", "pricing.trial", "state.closedNote", "state.closedPaidNote", "pricing.leadClosed", "hero.badge"]) if (!W.trial.test(at(k))) problems.push(`${locale}: ea.ss.${k} must name the trial`);
  if (!W.trial.test(at("pricing.title")) && !W.trial.test(at("pricing.lead"))) problems.push(`${locale}: the pricing header (ss.pricing.title / lead) must name the trial`);
  if (/^(start|join|get started|empez|unir|начать|встать|התחילו|הצטרפו)/i.test(nb(at("cta.how")))) problems.push(`${locale}: ea.ss.cta.how is an information link, not a sign-up invitation (it must not start with a verb of sign-up)`);
  if (!/isn't|is not|not open|לא נפתחה|aún no|no está abierto|ещё не|не открыта/i.test(nb(at("state.line.soon")))) problems.push(`${locale}: ea.ss.state.line.soon states that registration is NOT open yet (it must say so in words; it promises no date and does not invite)`);
  // P40: the regular price label says it is the PLANNED regular price (a fact, not a reduction) and the strike variant's label only "regular price"; neither carries a number, a discount word or a percentage (the EA rules ban those words block-wide; this pins the pair)
  if (at("pricing.priceLabel") === at("pricing.strikeLabel")) problems.push(`${locale}: ea.ss.pricing.priceLabel and strikeLabel must differ (the plain label says it is the planned regular price)`);
  for (const k of ["pricing.priceLabel", "pricing.strikeLabel", "pricing.strikeSr", "pricing.afterOffer", "pricing.perShort"]) if (/\d|%/.test(at(k))) problems.push(`${locale}: ea.ss.${k} carries no number or percentage (the amount comes from plans.ts)`);
  // P41 (compliance memo s.4 / s.7): the strike label says PLANNED, REGULAR, ANNUAL and AFTER the launch offer and that it is not a current or past price; the disclosure says nothing has been charged and that nothing is charged automatically; the screen-reader text says planned and not charged
  { const W2 = SS_STRIKE_WORDS[locale]; for (const [k, re] of [["pricing.strikeLabel", W2.label], ["pricing.strikeNote", W2.note], ["pricing.strikeSr", W2.sr], ["pricing.afterOffer", W2.after]]) if (!re.test(nb(at(k)))) problems.push(`${locale}: ea.ss.${k} must carry its memo wording (${re})`); }
  for (const [p, v] of [...walk(ss, "", []), ...walkRoot(ea?.journey, "journey")]) { const w = priceWordProblems(locale, nb(v)); if (w) problems.push(`${locale}: ea.${p.startsWith("journey") ? p : "ss." + p} ${w}`); }
  // the closed header must not keep promising a trial that cannot be started: it names no free offer in its title (the lead says registration has closed)
  if (/free|בחינם|gratis|бесплатн/i.test(at("pricing.titleClosed"))) problems.push(`${locale}: ea.ss.pricing.titleClosed must not advertise a free offer (registration has closed)`);
  // the pricing meta description: the trial in one sentence, payment qualified, the three prices as tokens, paid purchases not open
  { const m = nb(at("meta.pricingDescription")); for (const t of ["{priceSolo}", "{priceStudio}", "{priceAgency}"]) if (!m.includes(t)) problems.push(`${locale}: ea.ss.meta.pricingDescription must carry ${t}`); if (!m.toLowerCase().includes(nb(W.pay).toLowerCase()) || !W.trial.test(m)) problems.push(`${locale}: ea.ss.meta.pricingDescription must say "${W.pay}" together with the trial`); }
  // the Recommended badge is a purpose label, never "most popular"/"best" (no popularity or ranking claim; the EA rules ban the superlatives block-wide)
  if (/popular|best|#1|top|mejor|popular|лучш|популярн|הכי|פופולר/i.test(at("pricing.badge"))) problems.push(`${locale}: ea.ss.pricing.badge is "Recommended", never a popularity or ranking claim`);
  // short support lines (one line each)
  for (const k of ["hero.support.noPayment", "hero.support.oneStore", "hero.support.noAuto"]) if (nb(at(k)).length > 64 || /[.!;:]/.test(at(k))) problems.push(`${locale}: ea.ss.${k} must be one short line (at most 64 characters, no sentence punctuation)`);
  return problems;
}

/**
 * The dates each step must state in each language, written out as literals on purpose (NOT read from src/i18n/eaTokens.ts): the token table and these literals are two independent
 * statements of the same calendar facts, and `ea:check` fails when they disagree or when either disagrees with the IANA database. Index 0 = the initial end, 1 and 2 = the extension steps.
 * last = the last included day (Israel), end = the day access ends at 00:00 Israel time, utc = the UTC line of the plan cards ("22:00 UTC on <last day>").
 */
export const REQUIRED_DATES = {
  en: [
    { last: "December 31, 2026", end: "January 1, 2027", utc: "22:00 UTC on December 31", until: "Dec 31, 2026" },
    { last: "January 31, 2027", end: "February 1, 2027", utc: "22:00 UTC on January 31", until: "Jan 31, 2027" },
    { last: "February 28, 2027", end: "March 1, 2027", utc: "22:00 UTC on February 28", until: "Feb 28, 2027" },
  ],
  he: [
    { last: "31 בדצמבר 2026", end: "1 בינואר 2027", utc: "22:00 UTC ב־31 בדצמבר", until: "31 בדצמבר 2026" },
    { last: "31 בינואר 2027", end: "1 בפברואר 2027", utc: "22:00 UTC ב־31 בינואר", until: "31 בינואר 2027" },
    { last: "28 בפברואר 2027", end: "1 במרץ 2027", utc: "22:00 UTC ב־28 בפברואר", until: "28 בפברואר 2027" },
  ],
  es: [
    { last: "31 de diciembre de 2026", end: "1 de enero de 2027", utc: "22:00 UTC del 31 de diciembre", until: "31 dic 2026" },
    { last: "31 de enero de 2027", end: "1 de febrero de 2027", utc: "22:00 UTC del 31 de enero", until: "31 ene 2027" },
    { last: "28 de febrero de 2027", end: "1 de marzo de 2027", utc: "22:00 UTC del 28 de febrero", until: "28 feb 2027" },
  ],
  ru: [
    { last: "31 декабря 2026", end: "1 января 2027", utc: "22:00 UTC 31 декабря", until: "31 дек. 2026" },
    { last: "31 января 2027", end: "1 февраля 2027", utc: "22:00 UTC 31 января", until: "31 янв. 2027" },
    { last: "28 февраля 2027", end: "1 марта 2027", utc: "22:00 UTC 28 февраля", until: "28 февр. 2027" },
  ],
};

/**
 * Facts every locale must state in EVERY step (Production 21): the permanent extension reservation (terms line and questions; it promises the notice ON THE PAGE before the end date, and e-mail only "where we can": the Control Plane has no working e-mail sender yet, so no required token may demand e-mail), the plan-change answer, the guarantee answer (paid purchases only)
 * and, in an extended build, the extended bar and note. Written as that language writes them; a rewrite that drops one fails `ea:check`.
 */
export const REQUIRED_FACTS = {
  en: { h24: "24 hours", closedEvery: "every store already in it", original: "original end date", soft: "where we can", renew: "Renew plan", every: "every launch-offer store", noCharge: "never starts a charge", before: "on this page before the end date", single: "single store's access", changeBefore: "before the launch offer ends", changeFree: "at no charge", sameEnd: "The end date stays the same", paidPurchases: "eligible paid purchases", noteEvery: "every launch-offer store", extEvery: "every store", extPay: "no payment is taken", extAuto: "automatically", extZone: "UTC", decision: "explicit renewal decision", notOpen: "paid purchases are not open yet", approved: "approved stores" },
  he: { h24: "24 שעות", closedEvery: "לכל חנות שכבר נמצאת בה", original: "מועד הסיום המקורי", soft: "במקום שנוכל", renew: "חידוש התוכנית", every: "לכל חנויות הצעת ההשקה בבת אחת", noCharge: "לעולם לא מתחילה חיוב", before: "בעמוד הזה לפני תאריך הסיום", single: "של חנות בודדת", changeBefore: "לפני שהצעת ההשקה מסתיימת", changeFree: "ללא תשלום", sameEnd: "תאריך הסיום נשאר אותו תאריך", paidPurchases: "רכישות בתשלום הזכאיות לכך", noteEvery: "לכל חנות בהצעת ההשקה", extEvery: "לכל החנויות", extPay: "לא נגבה תשלום", extAuto: "אוטומטית", extZone: "UTC", decision: "החלטת חידוש מפורשת", notOpen: "רכישות בתשלום עדיין אינן פתוחות", approved: "לחנויות מאושרות" },
  es: { h24: "24 horas", closedEvery: "todas las tiendas que ya participan", original: "fecha de fin original", soft: "cuando podemos", renew: "botón para renovar el plan", every: "todas las tiendas de la oferta de lanzamiento a la vez", noCharge: "nunca inicia un cobro", before: "en esta página antes de la fecha de fin", single: "de una sola tienda", changeBefore: "antes de que termine la oferta de lanzamiento", changeFree: "sin ningún coste", sameEnd: "La fecha de fin no cambia", paidPurchases: "compras de pago que cumplan los requisitos", noteEvery: "todas las tiendas de la oferta de lanzamiento", extEvery: "todas las tiendas", extPay: "no se toma ningún pago", extAuto: "automáticamente", extZone: "UTC", decision: "decisión explícita de renovar", notOpen: "las compras de pago aún no están abiertas", approved: "tiendas aprobadas" },
  ru: { h24: "24 часа", closedEvery: "всех магазинов, которые уже в нём", original: "первоначальн", soft: "где можем", renew: "кнопкой продления плана", every: "для всех магазинов предложения в честь запуска", noCharge: "никогда не запускает списание", before: "на этой странице до даты окончания", single: "отдельного магазина", changeBefore: "до окончания предложения в честь запуска", changeFree: "бесплатно", sameEnd: "Дата окончания останется прежней", paidPurchases: "платные покупки, которые под неё подпадают", noteEvery: "всех магазинов предложения в честь запуска", extEvery: "всех магазинов", extPay: "платёж не взимается", extAuto: "автоматически", extZone: "UTC", decision: "явное решение о продлении", notOpen: "платные покупки пока не открыты", approved: "одобренных магазинов" },
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
  en: { last: "December 31, 2026", end: "January 1, 2027", auto: "automatic", card: "credit card", paid: "paid plan", zone: "Israel time", utc: "22:00 UTC" },
  he: { last: "31 בדצמבר 2026", end: "1 בינואר 2027", auto: "אוטומטי", card: "כרטיס אשראי", paid: "בתשלום", zone: "שעון ישראל", utc: "22:00 UTC" },
  es: { last: "31 de diciembre de 2026", end: "1 de enero de 2027", auto: "automátic", card: "tarjeta de crédito", paid: "plan de pago", zone: "hora de Israel", utc: "22:00 UTC" },
  ru: { last: "31 декабря 2026", end: "1 января 2027", auto: "втоматическ", card: "карта", paid: "латный план", zone: "по израильскому времени", utc: "22:00 UTC" },
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
  // P36 (owner rule: UTC deadlines): the clock is UTC, the instant is "22:00 UTC"; no local time zone and no end-date line ("January 1") is required or allowed in customer copy
  const need = { ...REQUIRED[locale], ...REQUIRED_DATES[locale][step], zone: "UTC", utc: "22:00 UTC" };
  const facts = REQUIRED_FACTS[locale];
  const problems = [];
  const nb = (x) => x.replace(/\u00a0/g, " "); // Russian packs use no-break spaces; the required phrases are written with plain ones
  const has = (path, tok) => { const v = path.split(".").reduce((a, k) => a?.[k], ea); return typeof v === "string" && nb(v).toLowerCase().includes(nb(tok).toLowerCase()); };
  // the offer statements: which string must carry which date, the clock, and the promises (P32: no hero fine print exists any more; the facts live in the bar, the cards and the explanation)
  for (const [path, tok] of [
    ["bar.live", need.until], ["bar.announce", need.until], ["hero.badge", need.until],
    ["plan.free", need.last], ["plan.term", need.last],
    ["section.lead", need.last], ["section.homeLead", need.last],     ["section.steps.use.body", need.last],         // the time zone: the instant is midnight in Israel = 22:00 UTC the day before; a visitor elsewhere must be told which clock
    // P34 (owner wording, review P34-4): the bar and the Hero pill say "Free for approved stores until <last day>" (the approved-stores qualifier is required there); the clock and the
    // exact instant are required where the end is stated (cards, explanation, questions), not in the bar
    ["bar.live", facts.approved], ["bar.announce", facts.approved],
    ["plan.ends", need.zone], ["plan.ends", need.utc],
    ["section.lead", need.zone], ["section.lead", need.utc], ["section.homeLead", need.zone], ["after.body", need.zone],
    ["section.steps.decide.body", need.zone], ["section.who.b", need.zone], ["section.faq.end.a", need.zone], ["section.faq.plugin.a", need.zone],
    // the promises: no card, nothing charged automatically, an explicit renewal decision to continue, paid purchases not open (and no promise of a paid plan in 2027)
    ["plan.noCard", need.card], ["section.lead", need.auto], ["after.body", need.auto], ["section.steps.decide.body", need.auto],
    ["pricing.decision", facts.decision], ["section.lead", facts.decision], ["section.homeLead", facts.decision], ["section.steps.decide.body", facts.decision],
    ["section.end.c", facts.decision], ["section.faq.end.a", facts.decision], ["section.faq.continue.a", facts.decision], ["after.body", facts.decision],
    ["pricing.note", facts.notOpen], ["section.steps.decide.body", facts.notOpen], ["section.end.c", facts.notOpen], ["section.faq.end.a", facts.notOpen], ["section.faq.continue.a", facts.notOpen], ["after.body", facts.notOpen],
    ["section.faq.free.a", need.last],     // the extension reservation is permanent (terms line and questions), the plan change is answered, the guarantee is for paid purchases only
    ["section.reservation", facts.every], ["section.reservation", facts.noCharge], ["section.reservation", facts.before], ["section.reservation", facts.single],
    ["section.faq.extension.a", facts.every], ["section.faq.extension.a", facts.noCharge], ["section.faq.extension.a", facts.before], ["section.faq.extension.a", facts.single],
    ["section.faq.change.a", facts.changeBefore], ["section.faq.change.a", facts.changeFree], ["section.faq.change.a", facts.sameEnd], ["section.faq.change.a", "{contactEmail}"],
    ["section.faq.plugin.a", facts.renew], ["section.faq.guarantee.a", facts.paidPurchases], ["section.faq.guarantee.a", "route:refund-policy"],
    // the extended variant (rendered only by an extended build, checked in every step): the clock, no payment, nothing automatic, every store
    ["extended.bar", facts.extEvery], ["extended.bar", facts.extZone], ["extended.bar", need.last],
    // the clock is named wherever the end is stated: cards, the page heading, the first question, the "use" step and the extension note
        // from the INITIAL end until the extended end (extended OPEN builds): no request is offered, the extension is for stores already in the offer, and the wording still names the clock
    ["extended.barClosed", facts.closedEvery], ["extended.barClosed", need.last], ["extended.barClosed", facts.original],
    ["extended.closedNote", facts.original],
    ["section.homeLeadClosed", need.zone], ["section.homeLeadClosed", need.last], ["section.homeLeadClosed", facts.original],
    ["section.steps.requestClosed.body", need.last], ["section.steps.requestClosed.body", facts.original],
    ["section.who.dExtended", facts.original],
    // announce builds with an extension: nothing can be requested, so the wording says the end date MOVED (never "for every store"), still names the clock and the charge rule
    ["extended.barAnnounce", need.last], ["extended.noteAnnounce", need.auto],
    // the requests cutoff next to the offer and the closed wording of the "who it is for" lines
    ["section.intakeCutoff", facts.h24], ["section.intakeCutoffExt", facts.h24], ["section.intakeCutoffExt", facts.original],
    ["extended.note", facts.noteEvery], ["extended.note", facts.extPay], ["extended.note", facts.extAuto],
    // the request pages: the clock, the processors named next to the form (Cloudflare Turnstile and the e-mail provider placeholder), the legal links, the contract's neutral success text is the only success text
    ["request.lead", need.last], ["request.notice", "Cloudflare Turnstile"], ["request.notice", "{mailProvider}"], ["request.notice", "route:privacy"],
    ["request.consent", "route:terms"], ["request.consent", "route:privacy"], ["section.notice", "route:privacy"], ["request.notice", "route:privacy"],
    // the announce variants (P32 review): coming soon, never read as live; the dates, the clock and the renewal decision are still stated
    ["section.homeLeadAnnounce", need.last], ["section.homeLeadAnnounce", need.zone], ["section.homeLeadAnnounce", facts.decision],
    ["section.leadAnnounce", need.last], ["section.leadAnnounce", need.zone], ["section.leadAnnounce", need.utc], ["section.leadAnnounce", need.auto], ["section.leadAnnounce", facts.decision],
    ["section.steps.useAnnounce.body", need.last], ["section.faq.free.aAnnounce", need.last],     ["section.terms", facts.h24],
    // P34: the support lines under the Hero buttons and under the plan cards name the card (the "approved stores" and exact-instant facts stay on every card, required above)
    ["hero.support.noCard", need.card], ["pricing.support.noCard", need.card],
  ]) if (!has(path, tok)) problems.push(`${locale}: ea.${path} must contain "${tok}"`);
  // one name for the offer, on every surface and in every language (P32): the surfaces below carry it, and the older name "Early Access" appears NOWHERE in the pack (P35 review M2: the live Terms and Privacy pages do not use it, so no sentence may claim that they do)
  {
    const NAME = { en: /launch[- ]offer/i, he: /הצעת ה?השקה/, es: /oferta de lanzamiento/i, ru: /предложени\S* в[\s\u00a0]честь[\s\u00a0]запуска/i }[locale];
    const OLD = { en: /early access/i, he: /גישה מוקדמת/, es: /acceso anticipado/i, ru: /ранн\S* доступ/i }[locale];
    for (const p of ["bar.live", "bar.announce", "hero.badgeTag", "hero.badgeTagAnnounce", "plan.pill", "pricing.support.noCard", "section.title", "section.faqTitle", "section.link", "section.homeLeadAnnounce", "section.faq.free.q", "plan.term", "plan.regular", "section.faq.guarantee.q", "request.lead", "pricing.note", "pricing.label"]) {
      const v = nb(p.split(".").reduce((a, k) => a?.[k], ea) || "");
      if (!NAME.test(v)) problems.push(`${locale}: ea.${p} must name the offer (${NAME})`);
    }
    for (const [p, v] of walk(ea, "", [])) if (OLD.test(nb(v))) problems.push(`${locale}: ea.${p} uses the older name "Early Access" (no sentence may claim that the Terms or Privacy pages call the offer that: they do not, until the legal publication)`);
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
  // P36 (owner copy): the bar and the Hero pill are the same short offer text in announce and open; an announce page still must not read as live: the bar LINK and the Hero status line say that requests are not open yet and differ from the open wording
  if (!ea.bar?.linkAnnounce || ea.bar.linkAnnounce === ea.bar.link || !ea.hero?.ctaAnnounce || ea.hero.ctaAnnounce === ea.hero.ctaOpen || !ea.plan?.ctaAnnounce || ea.plan.ctaAnnounce === ea.plan.ctaOpen) problems.push(`${locale}: the announce bar link and the announce status lines must differ from the open ones (an announce page must not read as live)`);
  // P36: the Hero pill no longer carries "for approved stores": the approval requirement is the Hero support line right under the buttons, and the bar above says it in full
  for (const k of ["noAuto", "approval"]) if (!ea.hero?.support?.[k]) problems.push(`${locale}: ea.hero.support.${k} is missing`);
  if (ea.hero && "badgeAnnounce" in ea.hero) problems.push(`${locale}: ea.hero.badgeAnnounce exists: the P34 pill is badgeTag / badgeTagAnnounce plus badge`);
  // e-mail may be mentioned only as a best effort: the Control Plane has no working e-mail sender, so a promise of e-mail without "where we can" is false
  for (const p of ["section.reservation", "section.faq.extension.a"]) {
    const v = nb(p.split(".").reduce((a, k) => a?.[k], ea) || "");
    if (/e-?mail|דוא״ל|correo|почт/i.test(v) && !v.includes(nb(facts.soft))) problems.push(`${locale}: ea.${p} promises e-mail without "${facts.soft}" (no e-mail sender exists yet)`);
  }
  // typography and register (Production 21 review R1-n3, n4): the clock moment never breaks between the word before "00:00" and the time (a no-break space), and Spanish addresses the merchant as usted throughout
  const NBSP_RULES = { en: [/\bat (?:22|00):00/i, "the time 22:00 / 00:00 must follow \"at\" with a no-break space"], he: [/בשעה (?:22|00):00/, "22:00 / 00:00 must follow בשעה with a no-break space (a wrap left \"00:00,\" at the start of a line)"], es: [/a las (?:22|00):00/i, "22:00 / 00:00 must follow \"a las\" with no-break spaces"] };
  if (NBSP_RULES[locale]) for (const [p, v] of walk(ea, "", [])) if (NBSP_RULES[locale][0].test(v)) problems.push(`${locale}: ea.${p}: ${NBSP_RULES[locale][1]}`);
  if (locale === "es") for (const [p, v] of walk(ea, "", [])) if (/(?<!usted )\bcompra (el|un) plan/i.test(v)) problems.push(`es: ea.${p} uses an informal or ambiguous "compra" (write "usted compra")`);
  for (const p of ["extended.barAnnounce", "extended.noteAnnounce"]) { const v = nb(p.split(".").reduce((a, k) => a?.[k], ea) || ""); if (v.includes(nb(facts.extEvery)) || v.includes(nb(facts.noteEvery))) problems.push(`${locale}: ea.${p} must not say "for every store" (an announce build admits nobody)`); }
  for (const bad of FORBIDDEN_SENTENCES[locale]) for (const [p, v] of walk(ea, "", [])) if (v.includes(bad)) problems.push(`${locale}: ea.${p} must not say "${bad}" (the Plugin no longer shows a money-back message on a free grant)`);
  // no date token may be left unresolved in a resolved dictionary
  for (const [p, v] of walk(ea, "", [])) if (/\{(lastDay|lastDayShort|endDate|firstLastDay|until|regDate|regShort|regLast)\}/.test(v)) problems.push(`${locale}: ea.${p} still contains an unresolved date token`);
  // P36 (owner rule: global-first branding, UTC-based deadlines): no customer string names a country or a local time zone, none states the end as midnight, and none prints the day after the last day (the expiry is 22:00 UTC on the last day)
  {
    const GEO = /israel|israeli|jerusalem|ישראל|израил|asia\/jerusalem/i;
    const MIDNIGHT = /\b00:00\b/;
    const NEXTDAY = { en: /(?<!\d)january 1,? 2027/i, he: /(?<!\d)1 בינואר 2027/, es: /(?<!\d)1 de enero de 2027/i, ru: /(?<!\d)1 января 2027/i }[locale];
    for (const [p, v] of walk(ea, "", [])) {
      if (GEO.test(v)) problems.push(`${locale}: ea.${p} names a country or local time zone (the deadline is stated in UTC only)`);
      // P39: the ONLY exception is the registration cutoff (Control Plane REGISTRATION_CUTOFF_UNIX, 2026-12-24T00:00:00Z) in exactly the two registration strings, in the form "<registration date> ... 00:00 UTC"
      if (MIDNIGHT.test(v) && !(SS_REG_PATHS.includes(p) && new RegExp(`(${escRe(nb(REQUIRED_REG[locale].regShort))}|${escRe(nb(REQUIRED_REG[locale].regDate))})[^\\d]{0,14}00:00 UTC`).test(nb(v)))) problems.push(`${locale}: ea.${p} states a 00:00 end (the end instant is 22:00 UTC; "00:00" is allowed only as the registration cutoff in ${SS_REG_PATHS.join(" and ")})`);
      if (NEXTDAY && NEXTDAY.test(nb(v))) problems.push(`${locale}: ea.${p} prints the day after the last day without the UTC instant`);
    }
  }
  // every dictionary string must be non-empty
  for (const [p, v] of walk(ea, "", [])) if (!v.trim()) problems.push(`${locale}: ea.${p} is empty`);
  // P37: the self-service free trial block
  problems.push(...ssDisclosureProblems(locale, ea, step));
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

/** Strings that may make an "automatic" statement besides SS_NOAUTO_PATHS: the strike disclosure ("nothing is charged automatically", memo s.4 variant A). */
export const SS_AUTO_OK_PATHS = ["pricing.strikeNote"];
/** The memo's wording of the planned-price copy (compliance memo s.4), per language: what each string must carry. */
export const SS_STRIKE_WORDS = {
  en: { label: /planned regular annual price after the launch offer, not a current or past price/i, note: /nothing has been charged at this price yet.*trial access ends.*no payment method needed.*nothing is charged automatically/i, sr: /planned price after the launch offer, not currently charged/i, after: /planned to start after the launch offer/i },
  he: { label: /מחיר שנתי מתוכנן לאחר הצעת ההשקה, לא מחיר נוכחי או קודם/, note: /עדיין לא חויב אף אחד.*הגישה לניסיון מסתיימת.*אין צורך באמצעי תשלום.*לא מחויב אוטומטית/, sr: /מתוכנן לאחר הצעת ההשקה, לא מחויב כרגע/, after: /מתוכנן להתחיל אחרי הצעת ההשקה/ },
  es: { label: /precio anual previsto después de la oferta de lanzamiento, no un precio actual ni pasado/i, note: /todavía no se ha cobrado nada.*el acceso de prueba termina.*no hace falta método de pago.*no se cobra nada automáticamente/i, sr: /previsto después de la oferta de lanzamiento, no se cobra actualmente/i, after: /previsto para empezar después de la oferta de lanzamiento/i },
  ru: { label: /планируемая годовая цена после предложения в честь запуска, не текущая и не прежняя цена/i, note: /пока ничего не списывалось.*пробный доступ заканчивается.*способ оплаты не нужен.*автоматически ничего не списывается/i, sr: /планируемая цена после предложения в честь запуска, сейчас не взимается/i, after: /планируется начать после предложения в честь запуска/i },
};
/**
 * The forbidden price words of the compliance memo (s.4 "Avoid"), in all four languages: was / previously / original / save / worth / normally / "regular price" ALONE (a "regular price" must be the PLANNED regular price) and the Hebrew "מחיר מקורי" /
 * "מחיר רגיל" alone. Returns a problem text or "". The rule is applied to every string of the planned-price copy and of the journey page, so a later edit cannot reintroduce a "was" reading.
 */
export function priceWordProblems(locale, text) {
  const t = String(text), bad = [];
  const rules = {
    en: [[/\b(was|previously|originally|formerly|worth|normally|usually|savings?|saves?|saving|discount(ed)?|reduced)\b/i, "price-advantage word"], [/\boriginal price\b/i, "original price"], [/(?<!planned )\bregular (annual )?prices?\b/i, "regular price without \"planned\""]],
    he: [[/מחיר מקורי|מחיר קודם|היה |במקום |חיסכון|שווה |בדרך כלל/, "price-advantage word"], [/רגיל|מקורי/, "regular / original wording (use the planned annual price after the launch offer)"]],
    es: [[/\b(antes|anteriormente|originalmente|ahorr[aeo]\w*|vale|normalmente|habitualmente|descuento|rebaj\w+)\b/i, "price-advantage word"], [/precio original/i, "original price"], [/\bregular(es)?\b|ordinari[oa]s?|habitual(es)?/i, "regular / ordinary wording (use the planned annual price after the launch offer)"]],
    ru: [[/(?<![а-яё])(было|раньше|ранее|эконом[а-яё]*|стоит|обычно|скидк[а-яё]*)(?![а-яё])/i, "price-advantage word"], [/(?<![а-яё])(первоначальн|исходн)[а-яё]+ цен[а-яё]+/i, "original price"], [/(?<![а-яё])(обычн|привычн|стандартн)[а-яё]*/i, "regular / usual wording (use the planned annual price after the launch offer)"]],
  }[locale] || [];
  for (const [re, why] of rules) { const m = t.match(re); if (m) bad.push(`${why} "${m[0]}"`); }
  return bad.length ? `uses forbidden price wording: ${bad.join("; ")}` : "";
}
function* walkRoot(o, prefix) { if (typeof o === "string") { yield [prefix, o]; return; } if (o && typeof o === "object") for (const k of Object.keys(o)) yield* walkRoot(o[k], prefix ? `${prefix}.${k}` : k); }
