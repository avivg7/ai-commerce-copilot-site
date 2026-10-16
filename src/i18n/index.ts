import type { Locale } from "./config";
import { en, type Dictionary } from "./en";
import { he } from "./he";
import { es } from "./es";
import { ru } from "./ru";

export type { Dictionary };

const DICTIONARIES: Record<Locale, Dictionary> = { en, he, es, ru };

/** Server-side dictionary lookup. Client components receive only the strings they need as props. */
export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
