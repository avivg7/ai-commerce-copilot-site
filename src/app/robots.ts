import type { MetadataRoute } from "next";
import { LOCALES, DEFAULT_LOCALE } from "@/i18n/config";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

/**
 * Behind the edge this file is the single /robots.txt for the whole host, so it must also keep crawlers out of the transactional
 * WordPress paths that the Control Plane's own robots.txt used to disallow (the pages carry noindex as well).
 */
const TRANSACTIONAL = ["/my-account/", "/checkout/", "/cart/"];

export default function robots(): MetadataRoute.Robots {
  const prefixes = ["", ...LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((l) => `/${l}`)];
  return {
    rules: { userAgent: "*", allow: "/", disallow: prefixes.flatMap((p) => TRANSACTIONAL.map((t) => `${p}${t}`)) },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
