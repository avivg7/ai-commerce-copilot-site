import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LOCALES, LOCALE_META, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n";
import { allStaticParams, parseSlug, type RouteId } from "@/lib/routes";
import { SITE_URL, absoluteUrl } from "@/lib/site";
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
  return allStaticParams();
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
  const parsed = parseSlug((await params).slug);
  if (!parsed) return {};
  const { locale, route } = parsed;
  const t = getDictionary(locale);
  const m = t.meta.pages[META_KEY[route]];
  const ctx = { locale, t };
  const title = formatPlain(m.title, ctx);
  const description = formatPlain(m.description, ctx);
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
  const parsed = parseSlug((await params).slug);
  if (!parsed) notFound();
  const { locale, route } = parsed;
  const t = getDictionary(locale as Locale);
  switch (route) {
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

