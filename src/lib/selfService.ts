import type { Locale } from "@/i18n/config";
import { EA_BUILD_MS, EA_END_UTC_MS, eaIsOver } from "./earlyAccess";
import { SITE_URL, localizeAccountUrl, type PlanId } from "./site";

/**
 * P37 SELF-SERVICE FREE TRIAL build switch, ORTHOGONAL to the launch-offer mode (NEXT_PUBLIC_AICC_EARLY_ACCESS=off|announce|open|verify):
 *   NEXT_PUBLIC_AICC_SELFSERVICE   exactly "on" = every plan-card button, closing band, the header "Get started" and the Product "Get started" lead to the Control Plane sign-up
 *                                  `{CP}/start/?plan=<solo|studio|agency>` (language-prefixed: /he/start/ ...). Anything else (including "true", "1", "ON") = OFF (the default): the build is byte-for-byte
 *                                  the P36 export for the same environment (proved by `node scripts/export-hash.mjs`).
 * The Hero keeps "Try Live Demo" (#demo, primary) and "See Pricing" in every mode; a card NEVER links to #demo or to /request-access/ while this is on. "Sign in" stays on the account page (a returning customer signs in, not up).
 * The Control Plane /start/ page renders the truthful state (open | waitlist | cutoff | paused); the static card only reads GET /wp-json/aicc/v1/signup/status at run time (src/lib/ssStatus.ts).
 * DEPLOY ORDER: publish a self-service build only AFTER the Control Plane serves /start/ (the route is a 404 while the Control Plane switch is off); `npm run launch:check` reminds the operator.
 * A build made at or after the end of the launch offer ignores the switch (the trial ends at the same instant), like every campaign mode.
 */
export const SS_REQUESTED = process.env.NEXT_PUBLIC_AICC_SELFSERVICE === "on";
export const SS_ON = SS_REQUESTED && !eaIsOver(EA_BUILD_MS, EA_END_UTC_MS);
/** The switch is set but this build is at or past the end: self-service was NOT published (`launch:check` reports it). */
export const SS_EXPIRED_REQUEST = SS_REQUESTED && !SS_ON;

/**
 * The English sign-up URL: the Control Plane page, same host as the Site by default (the edge routes /start/ to WordPress). NEXT_PUBLIC_AICC_START_URL overrides it for a stage or test host (English base, like
 * NEXT_PUBLIC_AICC_ACCOUNT_URL). The default follows SITE_URL, so a stage build keeps its visitors on the staging host.
 */
const START_URL_EN = process.env.NEXT_PUBLIC_AICC_START_URL || `${SITE_URL}/start/`;
/** The sign-up URL in the page language, with the plan as a plain preselection: https://www.copilt.org/he/start/?plan=studio. Same locale-prefix rule as the account URL (localizeAccountUrl). */
export function startUrl(locale: Locale, plan?: PlanId): string {
  const base = localizeAccountUrl(START_URL_EN, locale);
  if (!plan) return base;
  const hash = base.indexOf("#");
  const head = hash === -1 ? base : base.slice(0, hash);
  const frag = hash === -1 ? "" : base.slice(hash);
  return `${head}${head.includes("?") ? "&" : "?"}plan=${plan}${frag}`;
}
