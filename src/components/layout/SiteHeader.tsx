import Link from "next/link";
import { Menu, X } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { localePath, type RouteId } from "@/lib/routes";
import { isRequestRoute, type PageId } from "@/lib/requestRoutes";
import { getStartedUrl } from "@/lib/site";
import { LangMenu } from "@/components/brand/LangMenu";
import { A11yTrigger } from "./A11yControl";
import { kitAsset } from "@/lib/brand";
import { EA_OPEN } from "@/lib/earlyAccess";
import { SS_ON, startUrl } from "@/lib/selfService";
import { EaHeaderCta } from "@/components/ea/Ea";

/**
 * The legacy copilt.org header: fixed, transparent at the top, a blurred bar after 12px of scroll (or while the mobile menu is open).
 * Styles: brand/aicc-brand.css (.aicc-site-header*). Behaviour: brand/js/header-scroll.js and lang-menu.js, wired by BrandInit.
 */
export function SiteHeader({ locale, route, t }: { locale: Locale; route: PageId; t: Dictionary }) {
  const c = t.common;
  const account = getStartedUrl(locale);
  // P37: with self-service on, "Get started" leads to the sign-up page; "Sign in" and the Account link stay on the account page (a returning customer signs in, not up)
  const getStarted = SS_ON ? startUrl(locale) : account;
  const nav: { route: RouteId | "account"; label: string }[] = [
    { route: "product", label: c.nav.product },
    { route: "pricing", label: c.nav.pricing },
    { route: "questions", label: c.nav.questions },
    { route: "account", label: c.nav.account },
  ];
  const link = (n: { route: RouteId | "account"; label: string }) =>
    n.route === "account" ? (
      <a key="account" className="aicc-navlink" href={account}>{n.label}</a>
    ) : (
      <Link key={n.route} className="aicc-navlink" href={localePath(locale, n.route)} aria-current={n.route === route ? "page" : undefined}>{n.label}</Link>
    );
  return (
    <header className="aicc-site-header" data-aicc-header data-scrolled="false">
      <div className="aicc-site-header__bar">
        <Link href={localePath(locale, "home")} className="aicc-site-header__logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={kitAsset("aicc-logomark.svg")} alt="" width={32} height={32} />
          <span className="aicc-site-header__logo-short">AICC</span>
          <span className="aicc-site-header__logo-full">{t.meta.siteName}</span>
        </Link>
        <nav className="aicc-site-header__nav" aria-label={c.nav.label}>
          <ul className="aicc-site-header__links">
            {nav.map((n) => <li key={n.route}>{link(n)}</li>)}
          </ul>
        </nav>
        <div className="aicc-site-header__actions">
          <LangMenu locale={locale} route={route} label={c.language.label} currentWord={c.language.current} idSuffix="header" />
          <A11yTrigger label={c.a11y.title} iconOnly className="aicc-iconbtn aicc-a11y-trigger" />
          <a href={account} className="aicc-btn aicc-btn--quiet aicc-site-header__desktop-only">{t.brand.signIn}</a>
          <EaHeaderCta locale={locale} t={t} hidden={isRequestRoute(route)} className="aicc-btn aicc-btn--primary aicc-site-header__desktop-only" />
          <a href={getStarted} className="aicc-btn aicc-btn--primary aicc-site-header__desktop-only" {...(EA_OPEN && !SS_ON ? { "data-ea-after": "" } : {})}>
            {c.getStarted}
          </a>
          <button type="button" className="aicc-iconbtn aicc-site-header__menu-btn" data-aicc-menu-btn aria-expanded="false" aria-controls="aicc-menu-panel" aria-label={c.nav.menu}>
            <Menu size={22} aria-hidden="true" className="aicc-menu-icon-open" />
            <X size={22} aria-hidden="true" className="aicc-menu-icon-close" />
          </button>
        </div>
      </div>
      <div id="aicc-menu-panel" className="aicc-site-header__panel" data-aicc-menu-panel hidden>
        <div className="aicc-site-header__panel-inner">
          <nav aria-label={c.nav.label}>
            <ul>{nav.map((n) => <li key={n.route}>{link(n)}</li>)}</ul>
          </nav>
          <LangMenu locale={locale} route={route} label={c.language.label} currentWord={c.language.current} idSuffix="mobile" block />
          <div><A11yTrigger label={c.a11y.title} className="aicc-btn aicc-btn--quiet aicc-btn--sm" /></div>
          <a href={account} className="aicc-btn aicc-btn--quiet aicc-btn--block">{t.brand.signIn}</a>
          <EaHeaderCta locale={locale} t={t} hidden={isRequestRoute(route)} className="aicc-btn aicc-btn--primary aicc-btn--lg aicc-btn--block" />
          <a href={getStarted} className="aicc-btn aicc-btn--primary aicc-btn--lg aicc-btn--block" {...(EA_OPEN && !SS_ON ? { "data-ea-after": "" } : {})}>{c.getStarted}</a>
        </div>
      </div>
    </header>
  );
}
