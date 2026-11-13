import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LOCALES, LOCALE_META, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n";
import { allStaticParams, parseSlug, type RouteId } from "@/lib/routes";
import { isRequestRoute, parseRequestSlug, requestStaticParams } from "@/lib/requestRoutes";
import { SITE_URL, absoluteUrl } from "@/lib/site";
import { EA_ON } from "@/lib/earlyAccess";
import { kitAsset } from "@/lib/brand";
import { formatPlain } from "@/lib/rich";
import { HomePage } from "@/components/pages/HomePage";
import { ProductPage } from "@/components/pages/ProductPage";
import { PricingPage } from "@/components/pages/PricingPage";
import { QuestionsPage } from "@/components/pages/QuestionsPage";
import { LegalPage } from "@/components/pages/LegalPage";

type Params = { slug?: string[] };

export const dynamicParams = false;
export function generateStaticParams() {
  return [...allStaticParams(), ...requestStaticParams()];
}

const META_KEY: Record<RouteId, "home" | "product" | "pricing" | "dataTrust" | "privacy" | "terms" | "refund" | "accessibility" | "questions"> = {
  home: "home",
  product: "product",
  pricing: "pricing",
  "data-and-trust": "dataTrust",
  privacy: "privacy",
  terms: "terms",
  "refund-policy": "refund",
  accessibility: "accessibility",
  questions: "questions",
};

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const slugParts = (await params).slug;
  const parsed = parseSlug(slugParts) ?? parseRequestSlug(slugParts);
  if (!parsed) return {};
  const { locale, route } = parsed;
  const t = getDictionary(locale);
  if (isRequestRoute(route)) {
    // the launch-offer request pages (OPEN builds only): a plain title, never indexed or followed, no Open Graph card, and the confirm link must not leak anywhere (no referrer)
    const rt = route === "request-access" ? t.ea.request.pageTitle : t.ea.request.confirm.pageTitle;
    return {
      title: { absolute: `${rt} | ${t.meta.siteName}` },
      metadataBase: new URL(SITE_URL),
      icons: {
        icon: [
          { url: kitAsset("favicon.svg"), type: "image/svg+xml" },
          { url: kitAsset("icon-192.png"), sizes: "192x192", type: "image/png" },
        ],
        apple: [{ url: kitAsset("icon-180.png"), sizes: "180x180" }],
      },
      referrer: "no-referrer",
      robots: "noindex,nofollow",
    };
  }
  const m = t.meta.pages[META_KEY[route]];
  const ctx = { locale, t };
  const title = formatPlain(m.title, ctx);
  // a launch-offer build leaves the 14-day guarantee out of the Pricing description (no payment is taken, the cards say nothing about it); the text names no offer and no date, so it never goes stale
  const description = formatPlain(EA_ON && route === "pricing" ? t.ea.meta.pricingDescription : m.description, ctx);
  const url = absoluteUrl(locale, route);
  const ogImage = `${SITE_URL}/og/${locale}-${route === "home" ? "home" : route}.jpg`;
  const languages: Record<string, string> = {};
  for (const l of LOCALES) languages[LOCALE_META[l].htmlLang] = absoluteUrl(l, route);
  languages["x-default"] = absoluteUrl("en", route);

  return {
    title: { absolute: title },
    description,
    metadataBase: new URL(SITE_URL),
    alternates: { canonical: url, languages },
    icons: {
      icon: [
        { url: kitAsset("favicon.svg"), type: "image/svg+xml" },
        { url: kitAsset("icon-192.png"), sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: kitAsset("icon-180.png"), sizes: "180x180" }],
    },
    openGraph: {
      type: "website",
      siteName: t.meta.siteName,
      title,
      description,
      url,
      locale: LOCALE_META[locale].ogLocale,
      alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => LOCALE_META[l].ogLocale),
      images: [{ url: ogImage, width: 1200, height: 630, alt: t.meta.ogImageAlt }],
    },
    twitter: { card: "summary_large_image", title, description, images: [ogImage] },
    robots: { index: true, follow: true },
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const slugParts = (await params).slug;
  const parsed = parseSlug(slugParts) ?? parseRequestSlug(slugParts);
  if (!parsed) notFound();
  const { locale, route } = parsed;
  const t = getDictionary(locale as Locale);
  switch (route) {
    // The request pages: the import sits behind a compile-time constant (next.config.ts) so that every build but an OPEN one folds it away and carries none of their code.
    case "request-access": {
      if (process.env.NEXT_PUBLIC_AICC_EA_REQUEST_PAGES === "1") {
        const { RequestAccessPage } = await import("@/components/request/RequestPages");
        return <RequestAccessPage locale={locale} t={t} />;
      }
      notFound();
    }
    case "request-access-confirm": {
      if (process.env.NEXT_PUBLIC_AICC_EA_REQUEST_PAGES === "1") {
        const { RequestConfirmPage } = await import("@/components/request/RequestPages");
        return <RequestConfirmPage locale={locale} t={t} />;
      }
      notFound();
    }
    case "home":
      return <HomePage locale={locale} t={t} />;
    case "product":
      return <ProductPage locale={locale} t={t} />;
    case "pricing":
      return <PricingPage locale={locale} t={t} />;
    case "questions":
      return <QuestionsPage locale={locale} t={t} />;
    case "privacy":
      return <LegalPage locale={locale} t={t} doc="privacy" />;
    case "terms":
      return <LegalPage locale={locale} t={t} doc="terms" />;
    case "refund-policy":
      return <LegalPage locale={locale} t={t} doc="refund" />;
    case "data-and-trust":
      return <LegalPage locale={locale} t={t} doc="dataTrust" />;
    case "accessibility":
      return <LegalPage locale={locale} t={t} doc="accessibility" />;
    default:
      notFound();
  }
}

