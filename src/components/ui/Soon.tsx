import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { txProps } from "@/i18n";
import { Rich } from "@/lib/rich";
import { Button } from "@/components/ui/Button";
import { localePath } from "@/lib/routes";
import { COMMERCE_OPEN } from "@/lib/site";

/**
 * "Purchases open soon": the honest state of every purchase button, band and suggestion while commercial checkout is closed (NEXT_PUBLIC_AICC_COMMERCE_OPEN is not "true", the default).
 * A statement, not a link: nothing here leads into a checkout or an account registration that cannot complete. PricingCard and PlanFinder render the statement inline (`.aicc-btn--soon`);
 * this file holds the contact line and the closing-band actions. The Control Plane renders the same words (its pricing page and sign-in page).
 */

/** "Questions in the meantime? Write to support@copilt.org." */
export function SoonContact({ locale, t, inverse = false }: { locale: Locale; t: Dictionary; inverse?: boolean }) {
  const { lang, dir } = txProps(locale, "common.soon.contact");
  return (
    <p className={inverse ? "aicc-small aicc-soon-contact--inverse" : "aicc-muted aicc-small"} data-commerce="closed" lang={lang} dir={dir}>
      <Rich text={t.common.soon.contact} ctx={{ locale, t }} />
    </p>
  );
}

/** The two things a closing band shows instead of "Get started": a way to see the plans, and the contact. Renders nothing when checkout is open. */
export function SoonBandActions({ locale, t, to = "pricing" }: { locale: Locale; t: Dictionary; to?: "pricing" | "questions" }) {
  if (COMMERCE_OPEN) return null;
  const label = to === "pricing" ? t.common.seePricing : t.common.seeAllQuestions;
  const path = to === "pricing" ? "common.seePricing" : "common.seeAllQuestions";
  const { lang, dir } = txProps(locale, path);
  return (
    <div className="aicc-stack" style={{ justifyItems: "start" }}>
      <div className="aicc-hero-actions">
        <Button href={localePath(locale, to)} variant="primary" size="lg" lang={lang} dir={dir}>{label}</Button>
      </div>
      <SoonContact locale={locale} t={t} inverse />
    </div>
  );
}
