// npm run copy:check: banned phrases in any locale source (dictionaries, data, components, app). Comments are ignored.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/load.mjs";

const RULES = [
  // English
  [/start free/i, "free tier / trial claim"], [/no credit card/i, "no credit card"], [/watch demo/i, "Watch Demo (no asset exists)"],
  [/\btrend/i, "Trend (not a shipped feature)"], [/market pulse/i, "Market Pulse"], [/\bmomentum\b/i, "Momentum"],
  [/ai-written/i, "AI-written"], [/ai-generated/i, "AI-generated"], [/most popular/i, "Most Popular"], [/trusted by/i, "Trusted by"],
  [/(?<![.\w])join\b(?!\()/i, "Join (implies a customer base)"], [/subscription/i, "subscription"], [/auto-?renew/i, "auto-renew"],
  [/cancel anytime/i, "cancel anytime"], [/30[- ]day/i, "30-day"], [/store health/i, "Store Health"],
  [/\+\s?\d+(\.\d+)?\s?%/, "+N% result claim"],
  [/\d+(\.\d+)?\s?%\s*(more|higher|increase|growth|lift|uplift|revenue|sales|aov|conversion|ctr|roi)/i, "percent result claim"],
  [/(increase|boost|grow|lift|double)\w*\s+(your\s+)?(revenue|sales|aov|conversion)/i, "revenue-result promise"],
  [/real results/i, "real results"], [/99\.9/, "uptime claim"], [/\b0 ?kb\b/i, "0 kB claim"],
  [/gdpr[- ]compliant/i, "GDPR compliant"], [/no personal data/i, "no personal data"], [/free trial/i, "free trial"],
  [/limited time|countdown|hurry|act now/i, "urgency"], [/#1\b|best[- ]selling|number one/i, "superlative"],
  [/crossed[- ]out|strike-?through price/i, "strike-through price"], [/works with any theme|any theme/i, "any theme claim"],
  [/\bdeleted after\b|deleted when you/i, "deletion promise"], [/is (fully )?(wcag )?compliant/i, "conformance claim"],
  // Hebrew
  [/חינם|בחינם/, "he: free"], [/ללא כרטיס אשראי/, "he: no credit card"], [/מגמות|מגמה|טרנד/, "he: trends"], [/מנוי/, "he: subscription"],
  [/מתחדש\w* אוטומטית/, "he: auto-renew"], [/ביטול בכל עת|בטל בכל עת/, "he: cancel anytime"], [/30 יום/, "he: 30-day"],
  [/הפופולרי ביותר|הנפוץ ביותר/, "he: most popular"], [/תוצאות אמיתיות/, "he: real results"], [/הצטרפו/, "he: join"], [/סומכים עלינו|מהימן על ידי/, "he: trusted by"],
  [/צפו בדמו|צפה בהדגמה|צפו בהדגמה/, "he: watch demo"], [/תואם ל?-?GDPR|עומד ב-?GDPR/, "he: GDPR compliant"],
  // Spanish
  [/\bgratis\b|prueba gratuita|gratuito/i, "es: free"], [/sin tarjeta de cr[eé]dito/i, "es: no credit card"], [/tendencia/i, "es: trends"],
  [/suscripci[oó]n/i, "es: subscription"], [/renovaci[oó]n autom[aá]tica/i, "es: auto-renew"], [/cancela cuando quieras/i, "es: cancel anytime"],
  [/30 d[ií]as/i, "es: 30-day"], [/m[aá]s popular/i, "es: most popular"], [/resultados reales/i, "es: real results"], [/[uú]nete\b|[uú]nase/i, "es: join"],
  [/conf[ií]an en nosotros/i, "es: trusted by"], [/ver demo\b/i, "es: watch demo"],
  // Russian
  [/бесплатн/i, "ru: free"], [/без банковской карты|без кредитной карты/i, "ru: no credit card"], [/тренд/i, "ru: trends"], [/подписк/i, "ru: subscription"],
  [/автопродлен|автоматическое продление|автоматически продлева/i, "ru: auto-renew"], [/отмен\w* в любой момент/i, "ru: cancel anytime"],
  [/30 дней/i, "ru: 30-day"], [/самый популярный|самый востребованный/i, "ru: most popular"], [/реальные результаты/i, "ru: real results"],
  [/присоединяйтесь/i, "ru: join"], [/нам доверяют/i, "ru: trusted by"], [/смотреть демо|посмотреть демо/i, "ru: watch demo"],
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

const hits = [];
let scanned = 0;
for (const f of files(path.join(ROOT, "src"))) {
  scanned++;
  const text = stripComments(fs.readFileSync(f, "utf8"));
  text.split("\n").forEach((line, i) => {
    for (const [re, why] of RULES) if (re.test(line)) hits.push(`${path.relative(ROOT, f)}:${i + 1}  [${why}]  ${line.trim().slice(0, 110)}`);
  });
}
console.log(`copy:check  scanned ${scanned} source files, ${RULES.length} rules`);
if (hits.length) {
  console.error(`FAIL: ${hits.length} banned phrase(s)`);
  hits.slice(0, 80).forEach((h) => console.error("  " + h));
  process.exit(1);
}
console.log("PASS: no banned phrases in any locale source.");
