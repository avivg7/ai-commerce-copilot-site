import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = "https://aicommercecopilot.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "AI Commerce Copilot — AI Commerce Intelligence for WooCommerce",
    template: "%s · AI Commerce Copilot",
  },
  description:
    "AI Commerce Copilot analyzes shopper behavior to recommend products customers are likely to buy together, and explains why — with actionable merchant insights for WooCommerce.",
  keywords: [
    "WooCommerce AI",
    "product recommendations",
    "frequently bought together",
    "AI merchant insights",
    "commerce intelligence",
  ],
  openGraph: {
    title: "AI Commerce Copilot — AI Commerce Intelligence for WooCommerce",
    description:
      "Turn every customer into a bigger order. AI-powered recommendations and merchant insights for WooCommerce.",
    url: siteUrl,
    siteName: "AI Commerce Copilot",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Commerce Copilot — AI Commerce Intelligence for WooCommerce",
    description: "Turn every customer into a bigger order.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-bg text-ink">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-lg"
        >
          Skip to content
        </a>
        <Navbar />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
