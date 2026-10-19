import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { localePath, type RouteId } from "./routes";

/**
 * Build-time site origin for canonical URLs, hreflang, sitemap and Open Graph. No trailing slash.
 * The canonical public host is https://www.copilt.org (owner decision 2026-10-19); the apex copilt.org only redirects to it.
 * `npm run seo:check` fails if a build uses any other origin.
 */
export const SITE_URL = (process.env.SITE_URL || "https://www.copilt.org").replace(/\/+$/, "");

/** Prefix for hand-built URLs (raw <a>, <img>, script text). next/link and next/image add it themselves. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}

export function absoluteUrl(locale: Locale, route: RouteId = "home"): string {
  return `${SITE_URL}${localePath(locale, route)}`;
}

/**
 * Absolute URL of a page that exists only on the commerce origin (WordPress), in the page language: `${SITE_URL}[/<locale>]<path>`. Same host as the site
 * (the edge routes the path to WordPress), so it is never an apex hop and never resolved inside this build (link-check treats it as external, seo:check as
 * handed to WordPress). English unprefixed.
 */
export function wordpressUrl(locale: Locale, path: string): string {
  return `${SITE_URL}${locale === DEFAULT_LOCALE ? "" : `/${locale}`}${path}`;
}

/**
 * The English account URL: the single "Get started" / "Sign in" destination (the account area on the commerce site, WordPress).
 * Overridable at build time (NEXT_PUBLIC_AICC_ACCOUNT_URL stays the ENGLISH base). Same canonical host as the site, so the link is
 * never an apex-to-www redirect hop. Do not link to this constant directly: use getStartedUrl(locale) / planUrl(plan, locale).
 */
const ACCOUNT_URL_EN = process.env.NEXT_PUBLIC_AICC_ACCOUNT_URL || "https://www.copilt.org/my-account/";

/**
 * The account area is language-prefixed on the Control Plane (/he/my-account/, handled by AICC_LM_I18n), and the prefix wins over the
 * aicc_lang cookie, so a Hebrew visitor lands on the Hebrew account pages. English stays unprefixed (there is no /en/).
 * The prefix goes after the origin and any base path of the account URL, i.e. directly before its last path segment (the account page):
 *   https://www.copilt.org/my-account/            -> https://www.copilt.org/he/my-account/
 *   https://shop.example.com/wp/my-account/?x=1   -> https://shop.example.com/wp/he/my-account/?x=1
 * An account URL with no path segment gets the prefix as its only segment. Query and hash are kept.
 */
export function localizeAccountUrl(base: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return base;
  const m = /^((?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]*)?([^?#]*)([?#].*)?$/i.exec(base)!;
  const [, origin = "", path = "", tail = ""] = m;
  const segs = path.split("/"); // "/wp/my-account/" -> ["", "wp", "my-account", ""]
  let last = segs.length - 1;
  while (last > 0 && segs[last] === "") last--;
  if (last <= 0) return `${origin}/${locale}/${tail}`; // no path segment: "https://x" or "https://x/"
  segs.splice(last, 0, locale);
  return `${origin}${segs.join("/")}${tail}`;
}

/** The "Get started" / "Sign in" / "Account" destination for a page language. */
export function getStartedUrl(locale: Locale): string {
  return localizeAccountUrl(ACCOUNT_URL_EN, locale);
}

export type PlanId = "solo" | "studio" | "agency";

/** Account URL (in the page language) with the chosen plan as a query hint. */
export function planUrl(plan: PlanId, locale: Locale): string {
  const url = getStartedUrl(locale);
  const hash = url.indexOf("#");
  const head = hash === -1 ? url : url.slice(0, hash);
  const frag = hash === -1 ? "" : url.slice(hash);
  return `${head}${head.includes("?") ? "&" : "?"}plan=${plan}${frag}`;
}

/**
 * Legal review gate. Draft notices on the legal pages stay visible until a person with legal authority has approved the
 * text AND the build sets NEXT_PUBLIC_LEGAL_REVIEW_APPROVED=true. Supplying the company values does NOT hide them.
 * NEXT_PUBLIC_LEGAL_DRAFT_NOTICE=off only hides the pills (for screenshots); `npm run launch:check` still fails without approval.
 */
export const LEGAL_REVIEW_APPROVED = process.env.NEXT_PUBLIC_LEGAL_REVIEW_APPROVED === "true";
export const LEGAL_DRAFT_NOTICE = !LEGAL_REVIEW_APPROVED && process.env.NEXT_PUBLIC_LEGAL_DRAFT_NOTICE !== "off";

/** Owner-supplied values. Unset means the page renders one plain muted line (pending.line). Never invent these. */
export const COMPANY = {
  legalName: process.env.NEXT_PUBLIC_AICC_LEGAL_NAME || "",
  address: process.env.NEXT_PUBLIC_AICC_ADDRESS || "",
  supportEmail: process.env.NEXT_PUBLIC_AICC_SUPPORT_EMAIL || "",
  governingLaw: process.env.NEXT_PUBLIC_AICC_GOVERNING_LAW || "",
  paymentProcessor: process.env.NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR || "",
  hostingRegion: process.env.NEXT_PUBLIC_AICC_HOSTING_REGION || "",
} as const;

export type CompanyKey = keyof typeof COMPANY;

/** When the legal drafts were last updated (shown as "Draft last updated"). */
export const DRAFT_UPDATED_ON = "2026-10-18";
/** When the accessibility statement was last reviewed (a separate review, separate date). */
export const ACCESSIBILITY_REVIEWED_ON = "2026-10-18";
