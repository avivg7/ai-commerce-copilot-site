export const LOCALES = ["en", "he", "es", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_META: Record<
  Locale,
  { dir: "ltr" | "rtl"; htmlLang: string; ogLocale: string; endonym: string; short: string }
> = {
  en: { dir: "ltr", htmlLang: "en", ogLocale: "en_US", endonym: "English", short: "EN" },
  he: { dir: "rtl", htmlLang: "he", ogLocale: "he_IL", endonym: "עברית", short: "עב" },
  es: { dir: "ltr", htmlLang: "es", ogLocale: "es_ES", endonym: "Español", short: "ES" },
  ru: { dir: "ltr", htmlLang: "ru", ogLocale: "ru_RU", endonym: "Русский", short: "RU" },
};

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/** Cookie and localStorage key for the visitor's explicit language choice. */
export const LANG_KEY = "aicc_lang";
