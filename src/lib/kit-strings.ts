// Server-only: imports the dictionaries, so it must never be imported from a "use client" module (it would ship every locale to the browser).
import type { Locale } from "@/i18n/config";
import { isFallback, type Dictionary } from "@/i18n";

/** JSON handed to a kit module through data-strings. A unit that is not translated yet is English and says so (_fallback), so the kit marks lang="en" dir="ltr". */
export function kitStrings<K extends "demo" | "rules" | "dash" | "ask" | "flows" | "loop" | "faqSearch">(locale: Locale, t: Dictionary, key: K): Dictionary[K] & { _fallback?: boolean } {
  return isFallback(locale, key) ? { ...t[key], _fallback: true } : t[key];
}
