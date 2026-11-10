// Hand rewrites for scripts/dash-audit.mjs --fix: used where the default (dash -> ASCII hyphen, keeping the surrounding no-break space: "a - b") would read awkwardly in Russian.
// `from` is the RAW source text of a fragment as it appears in the file (" " is an escape in .ts, a literal no-break space in .json); it is replaced before the default rule runs.
// Everything not listed here simply becomes "word - word", the ordinary Russian typographic fallback when no dash character is allowed.
const ED = "—", NB = " ", ESC = "\\u00a0"; // ESC = the six characters   as they appear in src/i18n/*.ts
const TS = "src/i18n/ru.ts", FAQ = "brand/content/faq.ru.json";
export default [
  // an enumeration: a colon reads better than a hyphen
  { file: TS, from: `из${ESC}двух дат${ESC}${ED} сегодняшней`, to: `из${ESC}двух дат: сегодняшней` },
  { file: FAQ, from: `из${NB}двух дат${NB}${ED} сегодняшней`, to: `из${NB}двух дат: сегодняшней` },
  { file: TS, from: `сопутствующие товары${ESC}${ED} «{a}» и${ESC}«{b}», их покупали`, to: `сопутствующие товары: «{a}» и${ESC}«{b}», их покупали` },
  { file: TS, from: `Наши целевые значения${ESC}${ED} не${ESC}меньше`, to: `Наши целевые значения: не${ESC}меньше` },
  // the dash only joined two clauses: split the sentence
  { file: TS, from: `9${ESC}раз${ESC}${ED} это ваш самый сильный набор`, to: `9${ESC}раз. Это ваш самый сильный набор` },
  // a heading where the dash only held "and": the plain conjunction
  { file: TS, from: `Вопросы${ESC}${ED} и${ESC}прямые ответы.`, to: `Вопросы и${ESC}прямые ответы.` },
  // the dash followed a comma and stood for an omitted verb: the comma is enough
  { file: FAQ, from: `где истории мало,${NB}${ED} подходящие товары`, to: `где истории мало, подходящие товары` },
];
