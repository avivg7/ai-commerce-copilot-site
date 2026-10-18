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
