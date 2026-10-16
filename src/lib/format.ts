import type { Locale } from "@/i18n/config";

/** Dates use Intl in the reader's locale, Gregorian calendar, Western digits, month spelled out. */
export function formatDate(iso: string, locale: Locale): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const out = new Intl.DateTimeFormat(`${locale}-u-nu-latn-ca-gregory`, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(d);
  // Russian prints "2026 г."; followed by a sentence period that becomes "г..", so spell it out.
  return locale === "ru" ? out.replace(/\sг\.$/, " года") : out;
}

export function formatYear(locale: Locale, now = new Date()): string {
  return new Intl.NumberFormat(`${locale}-u-nu-latn`, { useGrouping: false }).format(now.getFullYear());
}

/** "Add {count} products" style templating for plain strings. */
export function fillTemplate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{([A-Za-z0-9]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
