import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from "@/i18n/config";
import { EA_REQUEST_PAGES } from "./earlyAccess";
import { SS_ON } from "./selfService";
import { JOURNEY_SLUG, journeyPath } from "./ssJourney";
import { localePath, type RouteId } from "./routes";

/**
 * The launch-offer request pages (P32). They are NOT in ROUTES on purpose: ROUTES is every ordinary page (sitemap, hreflang, OG images, link and SEO audits iterate it), these two exist ONLY
 * in an `open` or `verify` campaign build (EA_REQUEST_PAGES) and are never indexed. In every other build they are not generated, not linked and parse to "no such page".
 * This module is imported by server code only (the page, the layout, the header, the footer and the language menu): src/lib/routes.ts, which client components import, is deliberately
 * left untouched, so a build without these pages stays byte-identical to the build before they existed.
 * The confirm page has a second path segment, so its slug is two segments.
 */
export const REQUEST_ROUTES = {
  "request-access": ["request-access"],
  "request-access-confirm": ["request-access", "confirm"],
} as const;
export type RequestRouteId = keyof typeof REQUEST_ROUTES;
/**
 * P41: the self-service journey page (`/get-started/`). Like the request pages it is NOT in ROUTES: it exists ONLY in a self-service build (SS_ON), is generated nowhere else, and parses to "no such page" in every
 * other build, so an OFF build stays byte-identical to the build before the page existed. Unlike the request pages it IS indexable (static, data-free, four languages, hreflang cluster, sitemap entry).
 */
export const SS_ROUTES = { "get-started": [JOURNEY_SLUG] } as const;
export type SsRouteId = keyof typeof SS_ROUTES;
export const SS_ROUTE_IDS = Object.keys(SS_ROUTES) as SsRouteId[];
export type PageId = RouteId | RequestRouteId | SsRouteId;
export const REQUEST_ROUTE_IDS = Object.keys(REQUEST_ROUTES) as RequestRouteId[];

export function isRequestRoute(route: PageId): route is RequestRouteId {
  return Object.prototype.hasOwnProperty.call(REQUEST_ROUTES, route);
}
export function isSsRoute(route: PageId): route is SsRouteId {
  return Object.prototype.hasOwnProperty.call(SS_ROUTES, route);
}

/** Path of any page inside the site, WITHOUT basePath (English at the root, other locales under /<locale>/). */
export function pagePath(locale: Locale, route: PageId = "home"): string {
  if (isSsRoute(route)) return journeyPath(locale);
  if (!isRequestRoute(route)) return localePath(locale, route);
  const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
  return `${prefix}/${REQUEST_ROUTES[route].join("/")}/`;
}

/** The request page a catch-all slug names, or null (always null unless this is an OPEN or VERIFY build). */
export function parseRequestSlug(slug: string[] | undefined): { locale: Locale; route: RequestRouteId } | null {
  if (!EA_REQUEST_PAGES) return null;
  const parts = slug ?? [];
  let locale: Locale = DEFAULT_LOCALE;
  let rest = parts;
  if (parts.length > 0 && isLocale(parts[0])) {
    if (parts[0] === DEFAULT_LOCALE) return null;
    locale = parts[0];
    rest = parts.slice(1);
  }
  const route = REQUEST_ROUTE_IDS.find((id) => REQUEST_ROUTES[id].length === rest.length && REQUEST_ROUTES[id].every((seg, i) => seg === rest[i]));
  return route ? { locale, route } : null;
}

/** The { slug } params of the request pages for generateStaticParams (empty unless this is an OPEN build). */
export function requestStaticParams(): { slug: string[] }[] {
  if (!EA_REQUEST_PAGES) return [];
  return LOCALES.flatMap((locale) => REQUEST_ROUTE_IDS.map((id) => ({ slug: [...(locale === DEFAULT_LOCALE ? [] : [locale]), ...REQUEST_ROUTES[id]] })));
}

/** The self-service page a catch-all slug names, or null (always null unless this is a self-service build). */
export function parseSsSlug(slug: string[] | undefined): { locale: Locale; route: SsRouteId } | null {
  if (!SS_ON) return null;
  const parts = slug ?? [];
  let locale: Locale = DEFAULT_LOCALE;
  let rest = parts;
  if (parts.length > 0 && isLocale(parts[0])) {
    if (parts[0] === DEFAULT_LOCALE) return null;
    locale = parts[0];
    rest = parts.slice(1);
  }
  const route = SS_ROUTE_IDS.find((id) => SS_ROUTES[id].length === rest.length && SS_ROUTES[id].every((seg, i) => seg === rest[i]));
  return route ? { locale, route } : null;
}

/** The { slug } params of the self-service pages for generateStaticParams (empty unless this is a self-service build). */
export function ssStaticParams(): { slug: string[] }[] {
  if (!SS_ON) return [];
  return LOCALES.flatMap((locale) => SS_ROUTE_IDS.map((id) => ({ slug: [...(locale === DEFAULT_LOCALE ? [] : [locale]), ...SS_ROUTES[id]] })));
}
