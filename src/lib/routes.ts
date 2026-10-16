import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from "@/i18n/config";

/** Every public page. The key is the route id used by dictionaries, links and the sitemap. */
export const ROUTES = {
  home: "",
  product: "product",
  pricing: "pricing",
  "data-and-trust": "data-and-trust",
  privacy: "privacy",
  terms: "terms",
  "refund-policy": "refund-policy",
  accessibility: "accessibility",
  questions: "questions",
} as const;

export type RouteId = keyof typeof ROUTES;

/**
 * Pages whose authoritative copy lives in the Control Plane (WordPress) until the domain cutover. Here they are MIRRORS:
 * same facts and wording, guarded by pricing:check (numbers) and a manual diff (legal text). See docs/AUTHORITY.md.
 */
export const MIRROR_ROUTES: readonly RouteId[] = ["pricing", "privacy", "terms", "refund-policy", "accessibility"];
export const ROUTE_IDS = Object.keys(ROUTES) as RouteId[];

export function isRouteId(value: string): value is RouteId {
  return Object.prototype.hasOwnProperty.call(ROUTES, value);
}

/** Path inside the site, WITHOUT basePath. English lives at the root, other locales under /<locale>/. */
export function localePath(locale: Locale, route: RouteId = "home"): string {
  const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
  const slug = ROUTES[route];
  if (!slug) return prefix ? `${prefix}/` : "/";
  return `${prefix}/${slug}/`;
}

/** Turn the optional catch-all segments into { locale, route }; null means "no such page". */
export function parseSlug(slug: string[] | undefined): { locale: Locale; route: RouteId } | null {
  const parts = slug ?? [];
  let locale: Locale = DEFAULT_LOCALE;
  let rest = parts;
  if (parts.length > 0 && isLocale(parts[0])) {
    if (parts[0] === DEFAULT_LOCALE) return null; // English has no /en/ prefix; never create a duplicate URL.
    locale = parts[0];
    rest = parts.slice(1);
  }
  if (rest.length === 0) return { locale, route: "home" };
  if (rest.length > 1) return null;
  const found = ROUTE_IDS.find((id) => ROUTES[id] === rest[0] && id !== "home");
  return found ? { locale, route: found } : null;
}

/** All { slug } params for generateStaticParams. */
export function allStaticParams(): { slug: string[] }[] {
  const out: { slug: string[] }[] = [];
  for (const locale of LOCALES) {
    for (const route of ROUTE_IDS) {
      const lead = locale === DEFAULT_LOCALE ? [] : [locale];
      const tail = ROUTES[route] ? [ROUTES[route]] : [];
      out.push({ slug: [...lead, ...tail] });
    }
  }
  return out;
}
