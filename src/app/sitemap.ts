import type { MetadataRoute } from "next";
import { LOCALES, LOCALE_META } from "@/i18n/config";
import { ROUTE_IDS, WORDPRESS_SITEMAP_PAGES } from "@/lib/routes";
import { absoluteUrl, SITE_URL } from "@/lib/site";
import { DRAFT_UPDATED_ON as REVIEWED_ON } from "@/lib/site";
import { SS_ON } from "@/lib/selfService";
import { journeyPath } from "@/lib/ssJourney";

export const dynamic = "force-static";

/** Same prefix rule as localePath(): English unprefixed, the other languages under /<locale>/. */
const wpUrl = (locale: (typeof LOCALES)[number], path: string) => `${SITE_URL}${locale === "en" ? "" : `/${locale}`}${path}`;

/**
 * Every page in every language, each with hreflang alternates (including x-default = English), plus the WordPress-only public documents
 * (WORDPRESS_SITEMAP_PAGES: the Data Processing Addendum) that the edge's single sitemap must also list. Their lastmod stays the single
 * legal-draft date, like every other page.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const wordpress = LOCALES.flatMap((locale) =>
    WORDPRESS_SITEMAP_PAGES.map((path) => {
      const languages: Record<string, string> = {};
      for (const l of LOCALES) languages[LOCALE_META[l].htmlLang] = wpUrl(l, path);
      languages["x-default"] = wpUrl("en", path);
      return { url: wpUrl(locale, path), lastModified: REVIEWED_ON, changeFrequency: "monthly" as const, priority: 0.5, alternates: { languages } };
    }),
  );
  const pages = LOCALES.flatMap((locale) =>
    ROUTE_IDS.map((route) => {
      const languages: Record<string, string> = {};
      for (const l of LOCALES) languages[LOCALE_META[l].htmlLang] = absoluteUrl(l, route);
      languages["x-default"] = absoluteUrl("en", route);
      return {
        url: absoluteUrl(locale, route),
        lastModified: REVIEWED_ON,
        changeFrequency: route === "home" ? ("weekly" as const) : ("monthly" as const),
        priority: route === "home" ? 1 : route === "pricing" || route === "product" ? 0.8 : 0.5,
        alternates: { languages },
      };
    }),
  );
  // P41: the journey page exists only in a self-service build (src/lib/requestRoutes.ts): four languages, one hreflang cluster, indexable
  const journey = SS_ON
    ? LOCALES.map((locale) => {
        const languages: Record<string, string> = {};
        for (const l of LOCALES) languages[LOCALE_META[l].htmlLang] = `${SITE_URL}${journeyPath(l)}`;
        languages["x-default"] = `${SITE_URL}${journeyPath("en")}`;
        return { url: `${SITE_URL}${journeyPath(locale)}`, lastModified: REVIEWED_ON, changeFrequency: "monthly" as const, priority: 0.7, alternates: { languages } };
      })
    : [];
  return [...pages, ...journey, ...wordpress];
}
