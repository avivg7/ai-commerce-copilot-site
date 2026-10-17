"use client";
import { useSyncExternalStore } from "react";
import { Languages } from "lucide-react";
import { LOCALE_META, isLocale, type Locale } from "@/i18n/config";
import { localePath, type RouteId } from "@/lib/routes";
import { withBase } from "@/lib/site";
import { dismissLang, langSubscribe, langSuggestionSnapshot, storeLang } from "@/lib/prefs";

export type SuggestStrings = Record<Locale, { label: string; text: string; accept: string; dismiss: string }>;

/**
 * A small, dismissible suggestion (never a redirect, so crawlers and static hosting are unaffected).
 * Shown when the visitor previously chose another language, or, with no saved choice, when their browser prefers one.
 * Text is written in the suggested language. It sits first in the tab order (right after the skip link) and is position:fixed
 * so it cannot shift the layout; while it is shown `html` gets scroll-padding-bottom (see aicc.css) so a focused control
 * is never hidden behind it. On very short viewports it becomes an in-flow bar at the top instead.
 */
export function LanguageSuggestion({ locale, route, strings }: { locale: Locale; route: RouteId; strings: SuggestStrings }) {
  const target = useSyncExternalStore(
    langSubscribe,
    () => langSuggestionSnapshot(locale),
    () => "",
  );
  if (!isLocale(target)) return null;
  const s = strings[target];
  const m = LOCALE_META[target];
  return (
    <aside className="aicc-suggest" lang={m.htmlLang} dir={m.dir} aria-label={s.label}>
      <p style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
        <Languages size={20} aria-hidden="true" style={{ flex: "none" }} />
        <span>{s.text}</span>
      </p>
      <div className="aicc-suggest__actions">
        <a
          className="aicc-btn aicc-btn--primary"
          href={withBase(localePath(target, route))}
          hrefLang={m.htmlLang}
          onClick={() => storeLang(target)}
        >
          {s.accept}
        </a>
        <button type="button" className="aicc-btn aicc-btn--ghost" onClick={() => { dismissLang(target); /* focus must not fall to <body>: land on the skip link, the first tab stop of the page */ requestAnimationFrame(() => document.querySelector<HTMLElement>(".aicc-skip")?.focus()); }}>
          {s.dismiss}
        </button>
      </div>
    </aside>
  );
}
