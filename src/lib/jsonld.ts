import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { PLANS, CURRENCY } from "@/data/plans";
import { SITE_URL, absoluteUrl } from "@/lib/site";
import type { RouteId } from "@/lib/routes";
import { formatPlain, type RichCtx } from "@/lib/rich";
import { FAQ_SELECTION, faqById, type FaqPageKey } from "@/data/faq";
import { LEGAL_REVIEW_APPROVED } from "@/lib/site";

/** Truthful structured data only: no aggregateRating, no reviews, no invented address, phone or sameAs. */
export function organizationLd(t: Dictionary) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "AICC",
    alternateName: t.meta.siteName,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/brand-kit/icon-512.png`,
  };
}

export function softwareLd(locale: Locale, t: Dictionary) {
  const ctx: RichCtx = { locale, t };
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: t.meta.siteName,
    alternateName: "AICC",
    applicationCategory: "BusinessApplication",
    operatingSystem: "WordPress / WooCommerce",
    description: formatPlain(t.meta.pages.home.description, ctx),
    url: absoluteUrl(locale, "home"),
    inLanguage: locale,
    publisher: { "@id": `${SITE_URL}/#organization` },
    offers: PLANS.map((p) => ({
      "@type": "Offer",
      name: t.pricing.plans[p.id].name,
      price: String(p.price),
      priceCurrency: CURRENCY,
      url: absoluteUrl(locale, "pricing"),
      description: `${t.common.plan.sameFeatures}. ${p.stores === 1 ? t.common.plan.oneStore : t.common.plan.upToStores.replace("{n}", String(p.stores))}.`,
    })),
  };
}

export function breadcrumbLd(locale: Locale, route: RouteId, t: Dictionary, pageName: string) {
  if (route === "home") return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: t.meta.siteName, item: absoluteUrl(locale, "home") },
      { "@type": "ListItem", position: 2, name: pageName, item: absoluteUrl(locale, route) },
    ],
  };
}

/** Only for pages that visibly render these exact Q&As. Answers are plain text (markup removed). */
export function faqLd(locale: Locale, t: Dictionary, page: FaqPageKey) {
  const ctx: RichCtx = { locale, t };
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    // Q&As that touch rights, retention, refunds or privacy stay out of structured data until a person with legal authority approves them.
    mainEntity: (FAQ_SELECTION[page] as readonly string[]).filter((id) => LEGAL_REVIEW_APPROVED || !faqById(id).legalReview).map((id) => {
      const it = t.faq.items[id as keyof typeof t.faq.items];
      return {
        "@type": "Question",
        name: formatPlain(it.q, ctx),
        acceptedAnswer: { "@type": "Answer", text: formatPlain(it.a, ctx) },
      };
    }),
  };
}

export function ldScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
