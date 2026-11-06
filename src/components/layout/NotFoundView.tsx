"use client";
import { useEffect, useSyncExternalStore } from "react";
import { LOCALE_META, DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { localePath } from "@/lib/routes";
import { withBase, BASE_PATH } from "@/lib/basePath";
import { readStoredLang } from "@/lib/storedLang";
import { Logo } from "@/components/ui/Logo";
import { RecoImage } from "@/components/ui/RecoImage";

export type NotFoundStrings = Record<Locale, { heading: string; body: string; home: string; questions: string; siteName: string; title: string }>;

/**
 * Branded 404. A static host cannot know the visitor's language, so the page picks it from the URL prefix
 * (/he/..., /es/..., /ru/...) or, failing that, the saved choice; the server-rendered fallback is English.
 */
function currentLocale(): Locale {
  const path = window.location.pathname.replace(BASE_PATH, "");
  const first = path.split("/").filter(Boolean)[0];
  if (isLocale(first)) return first;
  return readStoredLang() ?? DEFAULT_LOCALE;
}
const subscribe = () => () => {};

export function NotFoundView({ strings }: { strings: NotFoundStrings }) {
  const locale = useSyncExternalStore(subscribe, currentLocale, () => DEFAULT_LOCALE);
  const s = strings[locale];
  const meta = LOCALE_META[locale];
  useEffect(() => {
    document.documentElement.lang = meta.htmlLang;
    document.documentElement.dir = meta.dir;
    // Next renders the English <title> from static metadata (the host cannot know the language); replace it after hydration.
    const set = () => { document.title = s.title; };
    set();
    const t = window.setTimeout(set, 150);
    return () => window.clearTimeout(t);
  }, [meta, s.title]);
  return (
    <>
      <header className="aicc-header">
        <div className="aicc-container aicc-header__bar">
          <Logo href={withBase(localePath(locale, "home"))} full={s.siteName} />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="aicc-notfound">
        <div className="aicc-notfound__inner">
          <RecoImage pose="thinking" displayWidth={140} priority />
          <h1 className="aicc-display" style={{ fontSize: "var(--aicc-text-3xl)" }}>{s.heading}</h1>
          <p className="aicc-lead" style={{ marginInline: "auto" }}>{s.body}</p>
          <div className="aicc-hero-actions">
            <a className="aicc-btn aicc-btn--primary aicc-btn--lg" href={withBase(localePath(locale, "home"))}>{s.home}</a>
            <a className="aicc-btn aicc-btn--lg" href={withBase(localePath(locale, "questions"))}>{s.questions}</a>
          </div>
        </div>
      </main>
    </>
  );
}
