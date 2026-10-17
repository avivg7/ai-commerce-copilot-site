import type { Locale } from "./config";
import { en, type Dictionary } from "./en";
import { he } from "./he";
import { es } from "./es";
import { ru } from "./ru";
import { mergeOverEnglish, unitOf, type DeepPartial } from "./merge";

export type { Dictionary };

const PARTIALS: Record<Locale, DeepPartial<Dictionary> | undefined> = { en: undefined, he, es, ru };
const MERGED = Object.fromEntries(
  (Object.keys(PARTIALS) as Locale[]).map((l) => [l, l === "en" ? { dict: en, fallback: new Set<string>(), units: [] as string[] } : mergeOverEnglish(en, PARTIALS[l])]),
) as Record<Locale, { dict: Dictionary; fallback: Set<string>; units: string[] }>;

/** Server-side dictionary lookup (English fills every string a locale has not translated yet). */
export function getDictionary(locale: Locale): Dictionary {
  return MERGED[locale].dict;
}

/** True when the string at `path` (or its whole unit) is showing English text on a non-English page. */
export function isFallback(locale: Locale, path: string): boolean {
  return MERGED[locale].fallback.has(unitOf(path));
}

/** Attributes for an element whose content is English text on a page of another language: correct lang and direction. */
export function fbProps(locale: Locale, path: string): { lang?: string; dir?: "ltr"; "data-needs-translation"?: string } {
  return isFallback(locale, path) ? { lang: "en", dir: "ltr", "data-needs-translation": path } : {};
}

/** All fallback units of a locale (used by tests and the build summary). */
export function fallbackUnits(locale: Locale): string[] {
  return [...MERGED[locale].fallback].sort();
}
