import type { Locale } from "@/i18n/config";

/**
 * Plural category for a count, from Intl.PluralRules (ru: 1 -> one, 2-4 -> few, 5-20 -> many, 21 -> one ...).
 * The demo's button has dictionary keys addOne / addFew / addMany; counts there never exceed 4, but the helper is general.
 */
export function pluralCategory(locale: Locale, n: number): Intl.LDMLPluralRule {
  return new Intl.PluralRules(locale).select(n);
}

export interface CountForms {
  addOne: string;
  addFew: string;
  addMany: string;
}

/** Pick the right "Add N products to cart" string for a count (exact 1 uses addOne; Russian few uses addFew). */
export function addToCartText(locale: Locale, f: CountForms, count: number): string {
  if (count === 1) return f.addOne;
  const cat = pluralCategory(locale, count);
  const tpl = locale === "ru" && cat === "few" ? f.addFew : f.addMany;
  return tpl.replace("{count}", String(count));
}
