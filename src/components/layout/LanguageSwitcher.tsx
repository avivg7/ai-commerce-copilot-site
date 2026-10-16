"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Globe, Check } from "lucide-react";
import { LOCALES, LOCALE_META, type Locale } from "@/i18n/config";
import { localePath, type RouteId } from "@/lib/routes";
import { withBase } from "@/lib/site";
import { storeLang } from "@/lib/prefs";

interface Props {
  locale: Locale;
  route: RouteId;
  label: string;
  /** "menu": compact button + popover (header). "list": all languages visible as chips (mobile menu, footer). */
  variant: "menu" | "list";
  currentLabel: string;
}

/**
 * Language links are plain anchors to the same page in another locale (a full navigation, so <html lang/dir> and
 * fonts are right immediately). Clicking records the explicit choice in a cookie AND localStorage; it never redirects
 * by itself. Each link carries lang/hrefLang so assistive tech pronounces the endonym correctly.
 */
export function LanguageSwitcher({ locale, route, label, variant, currentLabel }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const links = LOCALES.map((l) => {
    const m = LOCALE_META[l];
    return { l, m, href: withBase(localePath(l, route)), current: l === locale };
  });

  if (variant === "list") {
    return (
      <nav aria-label={label}>
        <ul className="aicc-lang__list">
          {links.map(({ l, m, href, current }) => (
            <li key={l}>
              <a
                className="aicc-lang__chip"
                href={href}
                lang={m.htmlLang}
                hrefLang={m.htmlLang}
                aria-current={current ? "true" : undefined}
                onClick={() => storeLang(l)}
              >
                {m.endonym}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  const cur = LOCALE_META[locale];
  return (
    <div className="aicc-lang" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="aicc-iconbtn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <Globe size={20} aria-hidden="true" />
        <span>{cur.short}</span>
        <span className="aicc-sr-only">{`, ${label}: ${cur.endonym}`}</span>
      </button>
      <ul id={id} className="aicc-lang__menu" hidden={!open}>
        {links.map(({ l, m, href, current }) => (
          <li key={l}>
            <a
              className="aicc-lang__item"
              href={href}
              lang={m.htmlLang}
              hrefLang={m.htmlLang}
              aria-current={current ? "true" : undefined}
              onClick={() => storeLang(l)}
            >
              <span>{m.endonym}</span>
              {current ? (
                <>
                  <Check size={18} aria-hidden="true" />
                  <span className="aicc-sr-only">({currentLabel})</span>
                </>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
