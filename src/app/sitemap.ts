import type { MetadataRoute } from "next";
import { LOCALES, LOCALE_META } from "@/i18n/config";
import { ROUTE_IDS } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site";
import { REVIEWED_ON } from "@/lib/site";

export const dynamic = "force-static";

/** Every page in every language, each with hreflang alternates (including x-default = English). */
export default function sitemap(): MetadataRoute.Sitemap {
  return LOCALES.flatMap((locale) =>
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
}
