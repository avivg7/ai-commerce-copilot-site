import type { Locale } from "./config";

/**
 * Launch offer date tokens (Production 21): ONE copy of the campaign sentences, four ends (step 0 = the initial published end, 1 and 2 = the published extension steps).
 * The sentences in `ea/{en,he,es,ru}.ts` carry tokens; this table writes the dates as each language writes them. The calendar facts behind every row (the Israel day before and
 * after the end instant) are re-derived from the IANA database, and every row is compared with Intl's own formatting of that day, by `npm run ea:check`.
 *   {lastDay}       the last included day, with the year           (December 31, 2026)
 *   {lastDayShort}  the same day without the year, for the UTC line (December 31)
 *   {until}         the last day, short, WITH the year, for the bar, the Hero pill and the cards (Dec 31, 2026; Hebrew keeps the full month)
 *   {endDate}       the day after the last day (INTERNAL: kept for the calendar checks; customer copy never prints it, because the end instant is stated in UTC only)
 *   {firstLastDay}  the INITIAL last day, whatever the step (only the extension note says it: "first announced to end on ...")
 * P39 (free-trial REGISTRATION cutoff, independent of the extension step: the Control Plane constant AICC_LM_Trial::REGISTRATION_CUTOFF_UNIX = 1798070400 = 2026-12-24T00:00:00Z; a registration is accepted while the server clock is BEFORE it):
 *   {regDate}   the day the registration closes, long                (December 24, 2026; "closes December 24, 2026 at 00:00 UTC")
 *   {regShort}  the same day, short, with the year, for the cards    (Dec 24, 2026)
 *   {regLast}   the LAST day a trial can be started, long (UTC)      (December 23, 2026)
 */
export type EaDates = { lastDay: string; lastDayShort: string; endDate: string; until: string };
export const EA_DATES: Record<Locale, readonly [EaDates, EaDates, EaDates]> = {
  en: [
    { lastDay: "December 31, 2026", lastDayShort: "December 31", endDate: "January 1, 2027", until: "Dec 31, 2026" },
    { lastDay: "January 31, 2027", lastDayShort: "January 31", endDate: "February 1, 2027", until: "Jan 31, 2027" },
    { lastDay: "February 28, 2027", lastDayShort: "February 28", endDate: "March 1, 2027", until: "Feb 28, 2027" },
  ],
  he: [
    { lastDay: "31 בדצמבר 2026", lastDayShort: "31 בדצמבר", endDate: "1 בינואר 2027", until: "31 בדצמבר 2026" },
    { lastDay: "31 בינואר 2027", lastDayShort: "31 בינואר", endDate: "1 בפברואר 2027", until: "31 בינואר 2027" },
    { lastDay: "28 בפברואר 2027", lastDayShort: "28 בפברואר", endDate: "1 במרץ 2027", until: "28 בפברואר 2027" },
  ],
  es: [
    { lastDay: "31 de diciembre de 2026", lastDayShort: "31 de diciembre", endDate: "1 de enero de 2027", until: "31 dic 2026" },
    { lastDay: "31 de enero de 2027", lastDayShort: "31 de enero", endDate: "1 de febrero de 2027", until: "31 ene 2027" },
    { lastDay: "28 de febrero de 2027", lastDayShort: "28 de febrero", endDate: "1 de marzo de 2027", until: "28 feb 2027" },
  ],
  ru: [
    { lastDay: "31 декабря 2026 г.", lastDayShort: "31 декабря", endDate: "1 января 2027 г.", until: "31 дек. 2026 г." },
    { lastDay: "31 января 2027 г.", lastDayShort: "31 января", endDate: "1 февраля 2027 г.", until: "31 янв. 2027 г." },
    { lastDay: "28 февраля 2027 г.", lastDayShort: "28 февраля", endDate: "1 марта 2027 г.", until: "28 февр. 2027 г." },
  ],
};

/** P39: the registration cutoff of the self-service free trial (2026-12-24T00:00:00Z = unix 1798070400). NOT part of the extension steps: the trial END moves with an extension, the registration cutoff does not. */
export const SS_REG_CLOSE_UTC_MS = Date.UTC(2026, 11, 24, 0, 0, 0);
export type SsRegDates = { regDate: string; regShort: string; regLast: string };
export const SS_REG_DATES: Record<Locale, SsRegDates> = {
  en: { regDate: "December 24, 2026", regShort: "Dec 24, 2026", regLast: "December 23, 2026" },
  he: { regDate: "24 בדצמבר 2026", regShort: "24 בדצמבר 2026", regLast: "23 בדצמבר 2026" },
  es: { regDate: "24 de diciembre de 2026", regShort: "24 dic 2026", regLast: "23 de diciembre de 2026" },
  ru: { regDate: "24 декабря 2026 г.", regShort: "24 дек. 2026 г.", regLast: "23 декабря 2026 г." },
};

export type EaStepIndex = 0 | 1 | 2;
export const EA_DATE_TOKENS = ["lastDay", "lastDayShort", "endDate", "firstLastDay", "until", "regDate", "regShort", "regLast"] as const;
/** Tokens that other code resolves later (not dates): they pass through untouched. */
const PASS_THROUGH = new Set(["contactEmail", "mailProvider", "priceSolo", "priceStudio", "priceAgency", "n", "plan"]);

/** A date with its spaces made no-break (used by the Hero badge only, so the badge never breaks in the middle of a date; the long dates stay breakable on the plan cards, where an unbreakable Spanish date overflowed a 1024 px column). */
export const nbDate = (d: string) => d.replace(/ /g, "\u00a0");

/** Resolve the date tokens of one string for `locale` and `step`. An unknown {token} is a bug: it throws, so a typo can never reach a page. */
export function resolveEaTokens(text: string, locale: Locale, step: EaStepIndex): string {
  const row = EA_DATES[locale][step];
  return text.replace(/\{([A-Za-z]+)\}/g, (whole, name: string) => {
    if (name === "firstLastDay") return EA_DATES[locale][0].lastDay;
    if (name === "regDate" || name === "regShort" || name === "regLast") return SS_REG_DATES[locale][name];
    if (name === "lastDay" || name === "lastDayShort" || name === "endDate" || name === "until") return row[name];
    if (PASS_THROUGH.has(name)) return whole;
    throw new Error(`ea: unknown token {${name}} in "${text.slice(0, 60)}"`);
  });
}

/**
 * Resolve every string of a campaign dictionary. `localeOf(path)` names the language the string at `path` is actually written in
 * (an untranslated unit shows English text on a translated page, and must get the English dates).
 */
export function resolveEaDict<T>(dict: T, localeOf: (path: string) => Locale, step: EaStepIndex, prefix = ""): T {
  if (typeof dict === "string") return resolveEaTokens(dict, localeOf(prefix), step) as unknown as T;
  if (Array.isArray(dict)) return dict.map((v, i) => resolveEaDict(v, localeOf, step, `${prefix}[${i}]`)) as unknown as T;
  if (dict && typeof dict === "object") {
    return Object.fromEntries(Object.entries(dict as Record<string, unknown>).map(([k, v]) => [k, resolveEaDict(v, localeOf, step, prefix ? `${prefix}.${k}` : k)])) as T;
  }
  return dict;
}
