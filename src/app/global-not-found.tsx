import type { Metadata } from "next";
import "./globals.css";
import { geistExt, geistLatin } from "./fonts";
import { LOCALES } from "@/i18n/config";
import { getDictionary } from "@/i18n";
import { NotFoundView, type NotFoundStrings } from "@/components/layout/NotFoundView";

export const metadata: Metadata = {
  title: { absolute: getDictionary("en").meta.pages.notFound.title },
  description: getDictionary("en").meta.pages.notFound.description,
  robots: { index: false, follow: true },
};

export default function GlobalNotFound() {
  const strings = Object.fromEntries(
    LOCALES.map((l) => {
      const t = getDictionary(l);
      return [l, { ...t.notFound, siteName: t.meta.siteName, title: t.meta.pages.notFound.title }];
    }),
  ) as NotFoundStrings;
  return (
    <html lang="en" dir="ltr" className={`${geistLatin.variable} ${geistExt.variable}`} suppressHydrationWarning>
      <body>
        <NotFoundView strings={strings} />
      </body>
    </html>
  );
}
