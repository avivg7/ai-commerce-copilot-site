// npm run copy:check: banned phrases in any locale source (dictionaries, data, components, app). Comments are ignored.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib/load.mjs";
import { truthProblems, selfTestProblems, TRUTH_RULES } from "./lib/launch-truth.mjs";
import { ALLOWED_WHY, EA_EXTRA_RULES, EA_EXEMPT_LINE, isCampaignFile } from "./lib/early-access-truth.mjs";

// "Watch demo" is allowed since the owner visual pass: the modal is an honest labelled placeholder until a real video is configured,
// and `npm run launch:check` blocks a production launch while the placeholder is active.
// Production 21 outcome-promise bans (review R1/R7): promises the digit-and-percent rule cannot see, in four languages. Honest DENIALS stay allowed through a narrow allowance:
// a negation right before "guarantee" ("We do not guarantee results.", "We cannot guarantee sales.", "No guaranteed results") is not flagged; "Orders are guaranteed to complete" is not a sales promise.
// (JavaScript's \w does not match Hebrew or Cyrillic: those rules spell the letters out.)
const OUTCOME_RULES = [
  [/(turn|convert|transform)\w*\s+(more\s+)?(your\s+)?(browsers?|visitors?|shoppers?|lookers?)\s+(in)?to\s+(buyers?|customers?)|\b(browsers?|visitors?|shoppers?)\s+(become|turn\s+into|convert\s+(in)?to)\s+(buyers?|customers?)|browsers?\s+into\s+buyers?/i, "visitors-into-buyers promise"],
  [/(?<!\b(?:not|no|never|cannot|can['’]t|don['’]t|doesn['’]t|won['’]t)\s)guarantee[sd]?\s+(more\s+)?(sales|revenue|orders|results|growth)\b|\b(sales|revenue|results|growth)\s*,?\s+(are\s+|is\s+)?guarantee[sd]?\b(?!\s+to\b)/i, "guaranteed-sales promise (a denial such as \"We do not guarantee results\" is allowed)"],
  [/more orders from the same traffic|pays? for itself|\b\d+\s?x\b[^.]{0,25}\b(sales|revenue|orders|conversion)/i, "more-from-the-same-traffic / payback promise"],
  [/(?<!n['’]t an )(?<!not an )upsell engine/i, "upsell engine (only the Product page's denial \"isn't an upsell engine\" is allowed)"],
  // P23: the owner-approved headline ("Grow Your Store's Sales with AI.") is an outcome statement WITHOUT a figure. This keeps the next obvious edit out: a sales / revenue figure ("Grow Your Store's Sales by 30% with AI").
  [/\b(sales|revenue|orders|conversions?|aov)\b[^.;]{0,24}\b(by|up|of)\s+(up to\s+)?\d+(\.\d+)?\s?(%|percent|per\s?cent)/i, "sales / revenue figure (\"sales by 30%\")"],
  [/,\s*guarantee[sd]?\s*[.!]/i, "trailing \"..., guaranteed.\" promise (P23: the approved headline carries no guarantee)"],
  [/\d+(\.\d+)?\s?(%|percent|per\s?cent)\s*(more|higher|increase\w*|growth|lift|uplift|revenue|sales|orders|conversion|aov|ctr|roi|off)\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(-\w+)?\s+(percent|per\s?cent)\s+(more|higher|increase\w*|growth|lift|uplift|revenue|sales|orders|conversion|off)\b/i, "percentage result claim (digits or words)"],
  // Hebrew
  [/הופכ[תים]* (את )?ה?(גולשים|מבקרים)|(גולשים|מבקרים) (שלכם )?(הופכים|הופכות) לקונים/, "he: visitors-into-buyers promise"],
  [/(?<!לא )(?<!איננו )(?<!אנו לא )(נבטיח|מבטיחים|מבטיח|מובטח\w*)\s*(לכם\s*)?(יותר\s+)?(מכירות|הכנסות|תוצאות|רווחים)|(?<!אין )(?<!לא )(מכירות|הכנסות|תוצאות)\s+(נוספות\s+)?(מובטחות|מובטחים)/, "he: guaranteed-sales promise"],
  [/(עשרה|עשרים|שלושים|ארבעים|חמישים|שישים|שבעים|שמונים|תשעים) אחוז|\d+\s?%\s*(יותר|עוד)?\s*(מכירות|הכנסות|הזמנות|המרות)|\d+\s?אחוז\s*(יותר\s+)?(מכירות|הכנסות|הזמנות)|\d+\s?אחוז\s+יותר/, "he: percentage result claim"],
  // Spanish
  [/convi?e?rt\w*\s+(a\s+)?(los\s+|sus\s+)?(visitantes|navegantes)\s+en\s+(compradores|clientes)|(visitantes|navegantes)\s+(se\s+)?(convierten|vuelven)\s+(en\s+)?(compradores|clientes)/i, "es: visitors-into-buyers promise"],
  [/(?<!\bno )(?<!\bnunca )garantiz\w*\s+(m[aá]s\s+)?(ventas|ingresos|resultados|pedidos)|(?<!\bsin )(?<!\bno )(ventas|ingresos|resultados)\s+garantizad\w*/i, "es: guaranteed-sales promise"],
  [/(diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien)\s+por\s+ciento|\d+\s?%\s*(m[aá]s\s+)?(de\s+)?(ventas|ingresos|pedidos|conversi\w+)|\d+\s+por\s+ciento\s+(m[aá]s\s+)?(de\s+)?(ventas|ingresos|pedidos)/i, "es: percentage result claim"],
  // Russian
  [/превращ[а-яё]+\s+(ваших\s+)?(посетителей|визитёров)\s+в\s+(покупателей|клиентов)|(посетители|визитёры)\s+(становятся|превращаются\s+в)\s+(покупателями|покупателей|клиентами)/i, "ru: visitors-into-buyers promise"],
  [/(продаж[а-яё]*|выручк[а-яё]*|рост[а-яё]*)\s+гарантирован[а-яё]*|(?<!не )(?<!не можем )(?<!нельзя )гарантир[а-яё]+\s+(рост\s+)?(продаж|выручк[а-яё]*|заказов|результат[а-яё]*|дохода)|гарантированн[а-яё]+\s+(рост\s+)?(продаж|выручки|дохода)/i, "ru: guaranteed-sales promise"],
  [/(десять|двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто)\s+процентов|\d+\s?%\s*(больше|рост[а-яё]*)?\s*(продаж|выручк[а-яё]*|заказов)|(продаж[а-яё]*|выручк[а-яё]*|заказов)\s+на\s+\d+\s?(%|процент)|\d+\s+процент[а-яё]*\s+(больше\s+)?(продаж|выручк[а-яё]*)/i, "ru: percentage result claim"],
];
const RULES = [
  // English
  [/start free/i, "free tier / trial claim"], [/no credit card/i, "no credit card"], 
  [/\btrend/i, "Trend (not a shipped feature)"], [/market pulse/i, "Market Pulse"], [/\bmomentum\b/i, "Momentum"],
  [/ai-written/i, "AI-written"], [/ai-generated/i, "AI-generated"], [/most popular/i, "Most Popular"], [/trusted by/i, "Trusted by"],
  [/(?<![.\w])join\b(?!\()/i, "Join (implies a customer base)"], [/subscription/i, "subscription"], [/auto-?renew/i, "auto-renew"],
  [/cancel anytime/i, "cancel anytime"], [/30[- ]day (money|refund|guarantee|trial)|30-day/i, "30-day refund/trial claim (the guarantee is 14 days; \"last 30 days\" for the dashboard period is fine)"], [/store health/i, "Store Health"],
  [/\+\s?\d+(\.\d+)?\s?%/, "+N% result claim"],
  [/\d+(\.\d+)?\s?%\s*(more|higher|increase|growth|lift|uplift|revenue|sales|aov|conversion|ctr|roi)/i, "percent result claim"],
  [/(increase|boost|grow|lift|double)\w*\s+(your\s+)?(revenue|sales|aov|conversion)/i, "revenue-result promise"],
  [/real results/i, "real results"], [/99\.9/, "uptime claim"], [/\b0 ?kb\b/i, "0 kB claim"],
  [/gdpr[- ]compliant/i, "GDPR compliant"], [/no personal data/i, "no personal data"], [/free trial/i, "free trial"],
  [/limited time|countdown|hurry|act now/i, "urgency"], [/#1\b|best[- ]selling|number one/i, "superlative"],
  [/crossed[- ]out|strike-?through price/i, "strike-through price"], [/works with any theme|any theme/i, "any theme claim"],
  [/\bdeleted after\b|deleted when you/i, "deletion promise"], [/is (fully )?(wcag )?compliant/i, "conformance claim"],
  ...OUTCOME_RULES, // Production 21: outcome promises (see OUTCOME_RULES above)
  // Hebrew
  [/חינם|בחינם/, "he: free"], [/ללא כרטיס אשראי/, "he: no credit card"], [/מגמות|מגמה|טרנד/, "he: trends"], [/(?<!הזד)מנוי/, "he: subscription"],
  [/מתחדש\w* אוטומטית/, "he: auto-renew"], [/ביטול בכל עת|בטל בכל עת/, "he: cancel anytime"], [/30 יום/, "he: 30-day"],
  [/הפופולרי ביותר|הנפוץ ביותר/, "he: most popular"], [/תוצאות אמיתיות/, "he: real results"], [/הצטרפו/, "he: join"], [/סומכים עלינו|מהימן על ידי/, "he: trusted by"],
  [/תואם ל?-?GDPR|עומד ב-?GDPR/, "he: GDPR compliant"],
  // Spanish
  [/\bgratis\b|prueba gratuita|gratuito/i, "es: free"], [/sin tarjeta de cr[eé]dito/i, "es: no credit card"], [/tendencia/i, "es: trends"],
  [/suscripci[oó]n/i, "es: subscription"], [/renovaci[oó]n autom[aá]tica/i, "es: auto-renew"], [/cancela cuando quieras/i, "es: cancel anytime"],
  [/30[ \u00a0]d[ií]as de (prueba|garant[ií]a|reembolso|devoluci[oó]n)|garant[ií]a de 30[ \u00a0]d[ií]as|(prueba|reembolso|devoluci[oó]n)[^.]{0,24}30[ \u00a0]d[ií]as|30[- ]d[ií]as? de dinero/i, "es: 30-day refund/trial claim (the guarantee is 14 days; \"últimos 30 días\" for the dashboard period is fine)"], [/m[aá]s popular/i, "es: most popular"], [/resultados reales/i, "es: real results"], [/[uú]nete\b|[uú]nase/i, "es: join"],
  [/conf[ií]an en nosotros/i, "es: trusted by"],
  // The Studio badge is a neutral label ("Built for multiple stores"), never "recommended for N stores": two Solo plans cost less than one Studio
  [/recommended for \d/i, "en: Studio badge must not recommend a store count"], [/מומלצ[תה]? ל־?\d/, "he: Studio badge must not recommend a store count"], [/recomendad[oa] para \d/i, "es: Studio badge must not recommend a store count"], [/рекомендуется для[\s\u00a0]*\d/i, "ru: Studio badge must not recommend a store count"],
  // Past-order import is optional and needs the merchant's choice: never "imports your orders automatically / when you connect" (en: content:check; he, es, ru: here)
  [/מייבא (את )?(ההזמנות|היסטוריית)[^.]{0,40}(אוטומטית|בעת החיבור|כשמתחברים)|(אוטומטית|בעת החיבור|כשמתחברים)[^.]{0,30}מייבא|ייבוא[^.]{0,20}(מתחיל|רץ|מתבצע) אוטומטית|(הזמנות|היסטוריה)[^.]{0,30}מיובאות (אוטומטית|בעת החיבור|כשמתחברים)/, "he: past-order import must be optional, never automatic or on connect"],
  [/importa (automáticamente|al conectar)|importa (los |sus )?(pedidos|historial)[^.]{0,40}(automáticamente|al conectar|cuando conecta)|importación (comienza|empieza|se inicia|se ejecuta) automáticamente|pedidos[^.]{0,30}se importan (automáticamente|al conectar|cuando conecta)/i, "es: past-order import must be optional, never automatic or on connect"],
  [/импортирует[^.]{0,40}(автоматически|при подключении)|(автоматически|при подключении)[^.]{0,40}импортирует|импорт (начинается|запускается|выполняется) автоматически|заказы[^.]{0,30}импортируются (автоматически|при подключении)/i, "ru: past-order import must be optional, never automatic or on connect"],
  // Russian
  [/бесплатн/i, "ru: free"], [/без банковской карты|без кредитной карты/i, "ru: no credit card"], [/тренд/i, "ru: trends"], [/подписк/i, "ru: subscription"],
  [/автопродлен|автоматическое продление|автоматически продлева/i, "ru: auto-renew"], [/отмен\w* в любой момент/i, "ru: cancel anytime"],
  [/30[ \u00a0]дней (на возврат|гарантии|пробн)|30[- ]дневн|(гарантия|возврат|пробн)[^.]{0,24}30[ \u00a0]дней/i, "ru: 30-day refund/trial claim (the guarantee is 14 days; \"последние 30 дней\" for the dashboard period is fine)"], [/самый популярный|самый востребованный/i, "ru: most popular"], [/реальные результаты/i, "ru: real results"],
  [/присоединяйтесь/i, "ru: join"], [/нам доверяют/i, "ru: trusted by"],
];

const SKIP_DIR = new Set(["node_modules", ".next", "out"]);
const exts = new Set([".ts", ".tsx", ".mjs", ".md"]);
function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (exts.has(path.extname(e.name))) yield p;
  }
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, a) => a);
}

// Self-test of the narrowed 30-day rules: the refund / trial claim is banned, the dashboard period is not (in every spelling, plain or no-break space).
{
  const bad = ["30 días de garantía", "garantía de 30 días", "prueba de 30\u00a0días", "30 дней на возврат", "гарантия 30 дней", "30-дневная гарантия"];
  const ok = ["los últimos 30 días", "en los últimos 30\u00a0días", "за последние 30 дней", "Last 30 days"];
  const rule = (t) => RULES.some(([re]) => re.test(t));
  const missed = bad.filter((t) => !rule(t)), wrong = ok.filter((t) => rule(t));
  if (missed.length || wrong.length) { console.error(`FAIL: self-test of the 30-day rules: missed [${missed}] flagged [${wrong}]`); process.exit(1); }
}
// Self-test of the Hebrew "subscription" rule (Production 21): the word מנוי is banned, but it is also inside הזדמנויות ("opportunities"), which the hero headline uses.
{
  const rule = (t) => RULES.some(([re]) => re.test(t));
  const bad = ["מנוי חודשי", "המנוי שלכם מתחדש", "מנויים"], ok = ["יותר הזדמנויות למכור.", "הזדמנויות"];
  const missed = bad.filter((t) => !rule(t)), wrong = ok.filter((t) => rule(t));
  if (missed.length || wrong.length) { console.error(`FAIL: self-test of the Hebrew subscription rule: missed [${missed}] flagged [${wrong}]`); process.exit(1); }
}
// Self-test of the outcome-promise bans (Production 21): every phrase the digit-and-percent rule let through is caught, in four languages, and honest denials still pass.
{
  const rule = (t) => RULES.some(([re]) => re.test(t));
  const bad = [
    "Guaranteed more sales.", "Turn more browsers into buyers.", "Turn your visitors into customers.", "Visitors become buyers.", "Thirty percent more sales.", "30 percent more sales.", "30% more sales.", "More orders from the same traffic.", "The upsell engine for WooCommerce.", "AICC is an upsell engine.", "twenty-five percent more", "Sales are guaranteed.", "More sales, guaranteed.", "Pays for itself in a month.", "A 3x boost in sales.",
    "הופכים גולשים לקונים", "הופכת גולשים לקונים", "מכירות מובטחות", "נבטיח יותר מכירות", "שלושים אחוז יותר", "30% יותר מכירות", "עד 30 אחוז יותר מכירות",
    "Convierte visitantes en compradores", "Convierta a sus visitantes en compradores", "Ventas garantizadas", "Garantizamos más ventas", "treinta por ciento más", "30% más ventas.", "30 por ciento más ventas",
    "Превращайте посетителей в покупателей", "Гарантированный рост продаж", "Гарантируем рост выручки", "тридцать процентов больше", "30% больше продаж.", "Больше продаж на 30 процентов", "Рост продаж на 30%"];
  const ok = ["No guaranteed results", "We do not guarantee results.", "We cannot guarantee sales.", "AICC does not guarantee more orders.", "Orders are guaranteed to complete even if AICC is down.", "Nothing here is a guarantee of sales.", "Order totals are one hundred percent accurate.", "It isn't an upsell engine.", "It is not an upsell engine.", "Closed 30 days ago", "Placing an order never waits on AICC.", "Share of store purchases: 24%",
    "איננו מבטיחים תוצאות", "לא מבטיחים מכירות", "אין תוצאות מובטחות", "Sin resultados garantizados", "Hace todo el texto un 19% más grande", "No garantizamos resultados.", "Мы не гарантируем результат.", "Мы не можем гарантировать продажи."];
  const missed = bad.filter((t) => !rule(t)), wrong = ok.filter((t) => rule(t));
  if (missed.length || wrong.length) { console.error(`FAIL: self-test of the outcome-promise bans: missed [${missed}] flagged [${wrong}]`); process.exit(1); }
}
// Self-test of the P23 owner decision (final): the approved hero headline, subtitle and no-guarantee line, in four languages, pass EVERY rule above with NO exemption (the general
// ban is unchanged), while the nearby variants (a figure, a guarantee, the plain "grow your sales" promise) are still caught.
{
  const rule = (t) => RULES.some(([re]) => re.test(t)) || truthProblems(t).length > 0;
  const approved = [
    "Grow Your Store's Sales with AI.", "Turn product recommendations into more sales, automatically.", "AICC helps create more sales opportunities. It does not guarantee any increase in sales or revenue; results depend on your store.",
    "להגדיל את המכירות בחנות שלכם בעזרת AI.", "הפכו המלצות על מוצרים למכירות נוספות, באופן אוטומטי.", "AICC עוזר ליצור יותר הזדמנויות מכירה. הוא אינו מבטיח כל עלייה במכירות או בהכנסות; התוצאות תלויות בחנות שלכם.",
    "Aumente las ventas de su tienda con IA.", "Convierta las recomendaciones de productos en más ventas, de forma automática.", "AICC ayuda a crear más oportunidades de venta. No garantiza ningún aumento de las ventas ni de los ingresos; los resultados dependen de su tienda.",
    "Увеличивайте продажи вашего магазина с\u00a0помощью\u00a0ИИ.", "Превращайте товарные рекомендации в\u00a0дополнительные продажи, автоматически.", "AICC помогает создавать больше возможностей для\u00a0продаж. Он не\u00a0гарантирует никакого роста продаж или выручки; результаты зависят от\u00a0вашего магазина.",
  ];
  const variants = [
    "Grow your sales with AI.", "Grow Your Sales by 30%.", "Grow Your Store's Sales by 30% with AI.", "Grow Your Store's Sales by up to 40 percent.", "Grow Your Store's Sales with AI, guaranteed.", "Guaranteed sales growth with AI.", "AICC guarantees more sales.", "Boost your revenue with AI.", "Turn more visitors into buyers, automatically.", "Thirty percent more sales, automatically.",
    "Увеличивайте продажи на 30%.", "Рост продаж гарантирован.", "Aumente las ventas un 30% más de ventas.", "Ventas garantizadas con IA.", "מכירות מובטחות בעזרת AI.", "30% יותר מכירות בעזרת AI.",
  ];
  const wrong = approved.filter(rule), missed = variants.filter((t) => !rule(t));
  if (wrong.length || missed.length) { console.error(`FAIL: self-test of the P23 approved hero strings: wrongly flagged [${wrong}] variants not caught [${missed}]`); process.exit(1); }
}
// Self-test of the optional-import rules (he, es, ru) and the Studio badge rule: automatic / on-connect import and "recommended for 2 stores" are caught; the opt-in phrasing passes.
{
  const bad = [
    "AICC מייבא את ההזמנות הקודמות שלכם אוטומטית.", "ההזמנות מיובאות בעת החיבור.", "הייבוא מתחיל אוטומטית.",
    "AICC importa automáticamente los pedidos anteriores.", "AICC importa los pedidos anteriores al conectar.", "La importación empieza automáticamente.",
    "AICC автоматически импортирует прошлые заказы.", "AICC импортирует заказы при подключении.", "Импорт начинается автоматически.",
    "מומלצת ל־2 עד 3 חנויות", "Recomendado para 2 o 3 tiendas", "Рекомендуется для\u00a02–3\u00a0магазинов", "Recommended for 2 to 3 stores",
  ];
  const ok = [
    "ייבוא הזמנות קודמות הוא אופציונלי ומתחיל רק כשאתם בוחרים בכך.", "אם תבחרו לייבא, יישלחו הזמנות מ־24 החודשים האחרונים.", "AICC לא מייבא את ההזמנות הקודמות שלכם עד שתבחרו.",
    "Importar los pedidos anteriores es opcional y solo empieza cuando usted lo decide.", "AICC no importa nada sin preguntar.",
    "Импорт прошлых заказов необязателен и начинается, только когда вы его выберете.", "Он ничего не импортирует, не спросив вас.",
    "מיועדת לכמה חנויות", "Pensado para varias tiendas", "Для нескольких магазинов",
  ];
  const rule = (t) => RULES.some(([re]) => re.test(t));
  const missed = bad.filter((t) => !rule(t)), wrong = ok.filter((t) => rule(t));
  if (missed.length || wrong.length) { console.error(`FAIL: self-test of the import / badge rules: missed [${missed}] flagged [${wrong}]`); process.exit(1); }
}
// Self-test of the Early Access allowance: the campaign words pass ONLY inside src/i18n/ea/, the trial / subscription / discount / urgency wording is banned there too.
{
  const rules = (t, campaign) => RULES.some(([re, why]) => re.test(t) && !(campaign && ALLOWED_WHY.has(why))) || (campaign && EA_EXTRA_RULES.some(([re]) => re.test(t)));
  const okInCampaign = ["We review each request and not every request will be approved.", "Acceso anticipado: términos de esta oferta, sin tarjeta de crédito.", "Это просто условия предложения; вместе мы объясним шаги.", "אנחנו בודקים כל בקשה", "No credit card required.", "Free until December 31, 2026", "ללא כרטיס אשראי. חינם עד 31 בדצמבר 2026", "Gratis hasta el 31 de diciembre de 2026. Sin tarjeta de crédito.", "Бесплатно до 31 декабря 2026 г. Без банковской карты."];
  const badInCampaign = ["Save $99 today", "Your free period renews at $99 a year", "20 percent off", "Free for founding members", "Free for the first 100 stores", "You will be billed $99 on January 1, 2027", "We will ask for your card at the end", "Half price for early adopters", "Merchants earn more with AICC", "Rated 4.9 stars", "Offer ends in 52 days", "Only a few stores will be approved", "Lock in lifetime access", "Plan gratis para siempre", "Aumente sus ventas", "Resultados garantizados", "¡Última oportunidad!", "Solo quedan 5 plazas", "תוכנית חינם לתמיד", "הזדמנות אחרונה", "מובטח שתרוויחו יותר", "הגדילו את המכירות שלכם", "Бесплатный тариф навсегда", "Последний шанс", "Рост продаж гарантирован", "Осталось всего 5 мест", "Start a free trial", "A free plan for one store", "Your subscription renews automatically", "Save 20% with this discount", "Hurry, limited time", "Only 5 spots left", "Increase your revenue", "תקופת ניסיון חינם", "Prueba gratuita de 30 días", "Бесплатная пробная версия"];
  const notCampaign = ["src/i18n/en.ts", "src/i18n/earlyaccess.ts", "src/i18n/ea/../en.ts", "src/i18n/eax/he.ts", "docs/cutover/early-access.md", "src/components/ea/Ea.tsx", "src/i18n/ea"];
  const wronglyCampaign = notCampaign.filter((f) => isCampaignFile(f));
  if (!isCampaignFile("src/i18n/ea/he.ts") || !isCampaignFile("src/i18n/ea/en.ts") || wronglyCampaign.length) { console.error(`FAIL: self-test of the campaign-file test: wrongly treated as campaign files [${wronglyCampaign}]`); process.exit(1); }
  const onlyHere = okInCampaign.filter((t) => /^(No credit card required\.|Free until|ללא כרטיס|Gratis hasta|Бесплатно до)/.test(t));
  const missed = badInCampaign.filter((t) => !rules(t, true)), wrong = okInCampaign.filter((t) => rules(t, true)), leaked = onlyHere.filter((t) => t !== "Free until December 31, 2026" && !rules(t, false)); // English "free until ..." was never banned on its own: only "start free", "free trial", "free plan/tier ..."
  if (missed.length || wrong.length || leaked.length) { console.error(`FAIL: self-test of the Early Access allowance: not caught in campaign files [${missed}] wrongly flagged [${wrong}] allowed outside the campaign files [${leaked}]`); process.exit(1); }
}
// Launch-truth rules (scripts/lib/launch-truth.mjs, shared with content:check): self-tested here on every run, applied to every source line below.
{
  const bad = selfTestProblems();
  if (bad) { console.error(`FAIL: self-test of the launch-truth rules: ${bad}`); process.exit(1); }
}
const hits = [];
let scanned = 0;
for (const f of [...files(path.join(ROOT, "src")), ...files(path.join(ROOT, "docs")), path.join(ROOT, "README.md")]) {
  scanned++;
  const text = stripComments(fs.readFileSync(f, "utf8"));
  text.split("\n").forEach((line, i) => {
    // The Early Access campaign copy (src/i18n/ea/) is the ONLY place the plain words "free" / "no credit card" are allowed (owner decision, Production 20); it gets extra bans instead.
    const campaign = isCampaignFile(path.relative(ROOT, f));
    for (const [re, why] of RULES) if (re.test(line) && !(campaign && ALLOWED_WHY.has(why))) hits.push(`${path.relative(ROOT, f)}:${i + 1}  [${why}]  ${line.trim().slice(0, 110)}`);
    if (campaign && !EA_EXEMPT_LINE.test(line)) for (const [re, why] of EA_EXTRA_RULES) if (re.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}  [${why}]  ${line.trim().slice(0, 110)}`);
    for (const p of truthProblems(line, { publicCopy: /^src\//.test(path.relative(ROOT, f)) })) hits.push(`${path.relative(ROOT, f)}:${i + 1}  [${p.why}]  ${line.trim().slice(0, 110)}`);
  });
}
// Typography rule (owner, global): no em dash (U+2014) and no en dash (U+2013) in customer-facing text. scripts/dash-audit.mjs reads string literals, JSX text, JSON and public text only (comments never count);
// its self-test proves the check fails on injected dashes. `node scripts/dash-audit.mjs --check --out <export dir>` runs the same rule on a built export.
const dash = [["--self-test"], ["--check"]].map((a) => spawnSync(process.execPath, [path.join(ROOT, "scripts", "dash-audit.mjs"), ...a], { encoding: "utf8" }));
dash.forEach((r) => { process.stdout.write(r.stdout || ""); process.stderr.write(r.stderr || ""); });
if (dash.some((r) => r.status !== 0)) { console.error("FAIL: typography (em / en dash in customer-facing text): see scripts/dash-audit.mjs"); process.exit(1); }
console.log(`copy:check  scanned ${scanned} source files, ${RULES.length}+${TRUTH_RULES.length} rules`);
if (hits.length) {
  console.error(`FAIL: ${hits.length} banned phrase(s)`);
  hits.slice(0, 80).forEach((h) => console.error("  " + h));
  process.exit(1);
}
console.log("PASS: no banned phrases in any locale source.");
