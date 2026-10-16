import type { ReactNode } from "react";
import "../globals.css";
import { geistExt, geistLatin } from "../fonts";
import { LOCALES, LOCALE_META, DEFAULT_LOCALE } from "@/i18n/config";
import { getDictionary } from "@/i18n";
import { allStaticParams, parseSlug } from "@/lib/routes";
import { SkipLink } from "@/components/ui/SkipLink";
import { Header, type HeaderStrings } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { LanguageSuggestion, type SuggestStrings } from "@/components/layout/LanguageSuggestion";

export const dynamicParams = false;
export function generateStaticParams() {
  return allStaticParams();
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
  const parsed = parseSlug(slug) ?? { locale: DEFAULT_LOCALE, route: "home" as const };
  const { locale, route } = parsed;
  const t = getDictionary(locale);
  const meta = LOCALE_META[locale];

  const headerStrings: HeaderStrings = {
    navLabel: t.common.nav.label,
    nav: [
      { route: "product", label: t.common.nav.product },
      { route: "pricing", label: t.common.nav.pricing },
      { route: "data-and-trust", label: t.common.nav.dataTrust },
      { route: "questions", label: t.common.nav.questions },
    ],
    menu: t.common.nav.menu,
    getStarted: t.common.getStarted,
    logoFull: t.meta.siteName,
    languageLabel: t.common.language.label,
    languageCurrent: t.common.language.current,
    a11y: t.common.a11y,
  };
  const suggest = Object.fromEntries(
    LOCALES.map((l) => [l, getDictionary(l).common.langSuggest]),
  ) as SuggestStrings;

  return (
    <html
      lang={meta.htmlLang}
      dir={meta.dir}
      className={`${geistLatin.variable} ${geistExt.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />
      </head>
      <body>
        <SkipLink label={t.common.skip} />
        <Header locale={locale} route={route} s={headerStrings} />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <Footer locale={locale} route={route} t={t} />
        <LanguageSuggestion locale={locale} route={route} strings={suggest} />
      </body>
    </html>
  );
}

