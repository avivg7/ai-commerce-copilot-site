import type { Locale } from "@/i18n/config";
import { localePath, type RouteId } from "./routes";

/** Build-time site origin for canonical URLs, hreflang, sitemap and Open Graph. No trailing slash. */
export const SITE_URL = (process.env.SITE_URL || "https://copilt.org").replace(/\/+$/, "");

/** Prefix for hand-built URLs (raw <a>, <img>, script text). next/link and next/image add it themselves. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}

export function absoluteUrl(locale: Locale, route: RouteId = "home"): string {
  return `${SITE_URL}${localePath(locale, route)}`;
}

/** The single "get started" destination: the account area on the commerce site. Overridable at build time. */
export const GET_STARTED_URL =
  process.env.NEXT_PUBLIC_AICC_ACCOUNT_URL || "https://copilt.org/my-account/";

export type PlanId = "solo" | "studio" | "agency";

/** Account URL with the chosen plan as a query hint. */
export function planUrl(plan: PlanId): string {
  const sep = GET_STARTED_URL.includes("?") ? "&" : "?";
  return `${GET_STARTED_URL}${sep}plan=${plan}`;
}

/** Visible "Draft - pending legal review" notices. On unless NEXT_PUBLIC_LEGAL_DRAFT_NOTICE is exactly "off". */
export const LEGAL_DRAFT_NOTICE = process.env.NEXT_PUBLIC_LEGAL_DRAFT_NOTICE !== "off";

/** Owner-supplied values. Unset means the page renders an obvious "[... -- pending]" token. Never invent these. */
export const COMPANY = {
  legalName: process.env.NEXT_PUBLIC_AICC_LEGAL_NAME || "",
  address: process.env.NEXT_PUBLIC_AICC_ADDRESS || "",
  supportEmail: process.env.NEXT_PUBLIC_AICC_SUPPORT_EMAIL || "",
  governingLaw: process.env.NEXT_PUBLIC_AICC_GOVERNING_LAW || "",
  paymentProcessor: process.env.NEXT_PUBLIC_AICC_PAYMENT_PROCESSOR || "",
  hostingRegion: process.env.NEXT_PUBLIC_AICC_HOSTING_REGION || "",
} as const;

export type CompanyKey = keyof typeof COMPANY;

/** Date the accessibility statement and legal drafts were last reviewed (ISO). */
export const REVIEWED_ON = "2026-10-16";
