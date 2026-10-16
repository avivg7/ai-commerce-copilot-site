"use client";
/**
 * Browser-side preferences (client only): accessibility settings and the visitor's explicit language choice.
 * Everything is wrapped in try/catch: storage can be blocked, and the site must work without it.
 * Both stores expose subscribe/getSnapshot for useSyncExternalStore (no setState-in-effect, no hydration mismatch).
 */
import { LANG_KEY, LOCALES, type Locale, isLocale } from "@/i18n/config";

export const A11Y_KEY = "aicc_a11y";
export type A11yPrefs = { motion: boolean; contrast: boolean; text: boolean };

const ATTRS: Record<keyof A11yPrefs, [string, string]> = {
  motion: ["data-aicc-motion", "reduce"],
  contrast: ["data-aicc-contrast", "high"],
  text: ["data-aicc-text", "large"],
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/* ── accessibility ── */
export const a11ySubscribe = subscribe;
/** "m|c|t" flags as a primitive string so the snapshot is referentially stable. */
export function a11ySnapshot(): string {
  const d = document.documentElement;
  const f = (k: keyof A11yPrefs) => (d.getAttribute(ATTRS[k][0]) === ATTRS[k][1] ? "1" : "0");
  return `${f("motion")}${f("contrast")}${f("text")}`;
}
export const a11yServerSnapshot = () => "000";

export function parseA11y(s: string): A11yPrefs {
  return { motion: s[0] === "1", contrast: s[1] === "1", text: s[2] === "1" };
}

export function setA11y(key: keyof A11yPrefs, on: boolean) {
  const d = document.documentElement;
  const [attr, val] = ATTRS[key];
  if (on) d.setAttribute(attr, val);
  else d.removeAttribute(attr);
  persistA11y();
  emit();
}

export function resetA11y() {
  const d = document.documentElement;
  (Object.keys(ATTRS) as (keyof A11yPrefs)[]).forEach((k) => d.removeAttribute(ATTRS[k][0]));
  try {
    localStorage.removeItem(A11Y_KEY);
  } catch {}
  emit();
}

function persistA11y() {
  const p = parseA11y(a11ySnapshot());
  try {
    localStorage.setItem(
      A11Y_KEY,
      JSON.stringify({ motion: p.motion ? "reduce" : "", contrast: p.contrast ? "high" : "", text: p.text ? "large" : "" }),
    );
  } catch {}
}

/* ── language ── */
export const langSubscribe = subscribe;

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

/** Remember an explicit choice in BOTH a cookie (1 year, site-wide, first-party) and localStorage. */
export function storeLang(locale: Locale) {
  try {
    localStorage.setItem(LANG_KEY, locale);
  } catch {}
  try {
    const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LANG_KEY}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {}
  emit();
}

const DISMISS_KEY = "aicc_lang_dismissed";
export function dismissedLang(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) ?? "";
  } catch {
    return "";
  }
}
export function dismissLang(target: Locale) {
  try {
    localStorage.setItem(DISMISS_KEY, target);
  } catch {}
  emit();
}

export function browserLang(): Locale | null {
  const list = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
  for (const raw of list) {
    const base = (raw || "").toLowerCase().split("-")[0];
    const norm = base === "iw" ? "he" : base;
    if ((LOCALES as readonly string[]).includes(norm)) return norm as Locale;
  }
  return null;
}

/** Which language to suggest on this page, if any. Never redirects; only suggests. */
export function langSuggestionSnapshot(current: Locale): string {
  const stored = readStoredLang();
  if (stored) return stored !== current && dismissedLang() !== stored ? stored : "";
  const nav = browserLang();
  if (nav && nav !== current && dismissedLang() !== nav) return nav;
  return "";
}
