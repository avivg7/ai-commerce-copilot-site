import type { ReactNode } from "react";
import ReactDOM from "react-dom";
import "../globals.css";
import { geistExt, geistLatin } from "../fonts";
import { LOCALES, LOCALE_META, DEFAULT_LOCALE } from "@/i18n/config";
import { getDictionary } from "@/i18n";
import { allStaticParams, parseSlug } from "@/lib/routes";
import { isRequestRoute, parseRequestSlug, requestStaticParams } from "@/lib/requestRoutes";
import { SkipLink } from "@/components/ui/SkipLink";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { BrandInit } from "@/components/brand/BrandInit";
import { Footer } from "@/components/layout/Footer";
import { A11yDialog } from "@/components/layout/A11yControl";
import { withBase } from "@/lib/site";
import { localePath } from "@/lib/routes";
import { LanguageSuggestion, type SuggestStrings } from "@/components/layout/LanguageSuggestion";
import { EA_HEAD_SCRIPT, EA_MODE, EA_ON } from "@/lib/earlyAccess";
import { SS_ON } from "@/lib/selfService";
import { SS_CSS } from "@/components/ss/Ss";
import { EA_HERO_CSS, EA_P34_CSS, EaBar } from "@/components/ea/Ea";

export const dynamicParams = false;
export function generateStaticParams() {
  return [...allStaticParams(), ...requestStaticParams()];
}

/** Applies saved accessibility preferences before first paint (no flash). Tiny, first-party, no network. */
const PREFS_SCRIPT = `try{var p=JSON.parse(localStorage.getItem("aicc_a11y")||"{}"),d=document.documentElement;if(p.motion==="reduce")d.setAttribute("data-aicc-motion","reduce");if(p.contrast==="high")d.setAttribute("data-aicc-contrast","high");if(p.text==="large")d.setAttribute("data-aicc-text","large")}catch(e){}`;

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const parsed = parseSlug(slug) ?? parseRequestSlug(slug) ?? { locale: DEFAULT_LOCALE, route: "home" as const };
  const { locale, route } = parsed;
  const t = getDictionary(locale);
  const meta = LOCALE_META[locale];
  if (locale === "he") ReactDOM.preload(withBase("/fonts/heebo-hebrew.woff2"), { as: "font", type: "font/woff2", crossOrigin: "anonymous" });

  const suggest = Object.fromEntries(
    LOCALES.map((l) => [l, getDictionary(l).common.langSuggest]),
  ) as SuggestStrings;

  return (
    <html
      lang={meta.htmlLang}
      dir={meta.dir}
      className={`${geistLatin.variable} ${geistExt.variable}`}
      {...(EA_ON ? { "data-ea-mode": EA_MODE } : {})}
      {...(SS_ON ? { "data-ss-mode": "on" } : {})}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />
        {/* Early Access builds only: marks the document when the campaign end date has passed (absolute UTC time, no time zone), so an old page switches to the ended view. */}
        {EA_ON ? (<><script dangerouslySetInnerHTML={{ __html: EA_HEAD_SCRIPT }} /><style dangerouslySetInnerHTML={{ __html: EA_HERO_CSS + EA_P34_CSS + (SS_ON ? SS_CSS : "") }} /></>) : SS_ON ? <style dangerouslySetInnerHTML={{ __html: SS_CSS }} /> : null}
        {/* P37: the SS_CSS above is the CSS of the self-service free-trial parts (self-service builds only, in the same child slot so every other page stays byte-identical) */}
        {locale === "he" ? (
          <>
            {/* Heebo (SIL OFL, public/fonts/OFL-Heebo.txt), Hebrew subset, only declared and preloaded on Hebrew pages. */}
            <style
              dangerouslySetInnerHTML={{
                __html: `@font-face{font-family:"AICC Heebo";src:url(${withBase("/fonts/heebo-hebrew.woff2")}) format("woff2");font-weight:100 900;font-display:swap;unicode-range:U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F}html:lang(he) body{font-family:var(--font-geist-sans),var(--font-geist-ext),"AICC Heebo",var(--aicc-font-sans)}`,
              }}
            />
          </>
        ) : null}
      </head>
      <body>
        <SkipLink label={t.common.skip} />
        <LanguageSuggestion locale={locale} route={isRequestRoute(route) ? "home" : route} strings={suggest} />
        <SiteHeader locale={locale} route={route} t={t} />
        <BrandInit />
        <main id="main" tabIndex={-1}>
          <EaBar locale={locale} t={t} />
          {children}
        </main>
        <Footer locale={locale} route={route} t={t} />
        <A11yDialog strings={t.common.a11y} statementHref={localePath(locale, "accessibility")} />
      </body>
    </html>
  );
}

