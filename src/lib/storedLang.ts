import { LANG_KEY, type Locale, isLocale } from "@/i18n/config";

/** The visitor's saved language choice (localStorage, then the cookie), or null. Its own tiny module so the 404 page does not pull in the whole of prefs.ts. */
export function readStoredLang(): Locale | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (isLocale(v ?? undefined)) return v as Locale;
  } catch {}
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${LANG_KEY}=([^;]+)`));
    if (m && isLocale(m[1])) return m[1] as Locale;
  } catch {}
  return null;
}
