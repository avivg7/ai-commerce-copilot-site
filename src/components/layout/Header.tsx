"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X, ArrowRight } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { localePath, type RouteId } from "@/lib/routes";
import { GET_STARTED_URL } from "@/lib/site";
import { Logo } from "@/components/ui/Logo";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { A11yTrigger } from "./A11yControl";

export interface HeaderStrings {
  navLabel: string;
  nav: { route: RouteId; label: string }[];
  menu: string;
  getStarted: string;
  logoFull: string;
  languageLabel: string;
  languageCurrent: string;
  a11yLabel: string;
}

/**
 * Sticky header on a solid light surface (the logo text is always readable, also over dark sections).
 * Mobile menu is a disclosure: aria-expanded/aria-controls, Esc closes and returns focus to the button,
 * choosing a link or pressing outside closes it. The language switcher is always one tap away.
 */
export function Header({ locale, route, s }: { locale: Locale; route: RouteId; s: HeaderStrings }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A modal dialog (accessibility settings) handles its own Esc; do not close the menu behind it.
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const mq = window.matchMedia("(min-width: 64rem)");
    const onMq = () => mq.matches && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    mq.addEventListener("change", onMq);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      mq.removeEventListener("change", onMq);
    };
  }, [open]);

  const links = s.nav.map((n) => (
    <Link
      key={n.route}
      href={localePath(locale, n.route)}
      className="aicc-navlink"
      aria-current={n.route === route ? "page" : undefined}
      onClick={() => setOpen(false)}
    >
      {n.label}
    </Link>
  ));

  return (
    <header className="aicc-header" ref={headerRef}>
      <div className="aicc-container aicc-header__bar">
        <Logo href={localePath(locale, "home")} full={s.logoFull} />
        <nav className="aicc-header__nav" aria-label={s.navLabel}>
          <ul className="aicc-header__links">
            {links.map((l, i) => (
              <li key={s.nav[i].route}>{l}</li>
            ))}
          </ul>
        </nav>
        <span className="aicc-header__spacer" />
        <div className="aicc-header__tools">
          <LanguageSwitcher
            locale={locale}
            route={route}
            label={s.languageLabel}
            currentLabel={s.languageCurrent}
            variant="menu"
          />
          <A11yTrigger label={s.a11yLabel} className="aicc-iconbtn aicc-header__a11y" />
          <Link href={GET_STARTED_URL} className="aicc-btn aicc-btn--primary aicc-header__cta">
            {s.getStarted}
          </Link>
          <button
            ref={btnRef}
            type="button"
            className="aicc-iconbtn aicc-header__menu-btn"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            <span>{s.menu}</span>
          </button>
        </div>
      </div>
      <div id={panelId} className="aicc-mobilemenu" hidden={!open}>
        <div className="aicc-container aicc-mobilemenu__inner">
          <nav aria-label={s.navLabel}>
            <ul>
              {links.map((l, i) => (
                <li key={s.nav[i].route}>{l}</li>
              ))}
            </ul>
          </nav>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            <A11yTrigger label={s.a11yLabel} className="aicc-btn aicc-btn--secondary" />
          </div>
          <Link href={GET_STARTED_URL} className="aicc-btn aicc-btn--primary aicc-btn--lg aicc-btn--block">
            {s.getStarted}
            <ArrowRight size={18} className="aicc-flip" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
