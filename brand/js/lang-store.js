// Persisting an explicit language choice (no UI): a first-party cookie (1 year, Secure on https) AND localStorage.
export const LANG_KEY = "aicc_lang";

export function storeLang(locale) {
  try { localStorage.setItem(LANG_KEY, locale); } catch {}
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LANG_KEY}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {}
}
