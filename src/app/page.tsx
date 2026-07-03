import { Hero } from "@/components/sections/Hero";
import { TrustedBy } from "@/components/sections/TrustedBy";
import { Problem } from "@/components/sections/Problem";
import { Solution } from "@/components/sections/Solution";
import { Features } from "@/components/sections/Features";
import { Dashboard } from "@/components/sections/Dashboard";
import { Insights } from "@/components/sections/Insights";
import { FrequentlyBoughtTogether } from "@/components/sections/FrequentlyBoughtTogether";
import { Metrics } from "@/components/sections/Metrics";
import { Comparison } from "@/components/sections/Comparison";
import { FutureVision } from "@/components/sections/FutureVision";
import { FinalCTA } from "@/components/sections/FinalCTA";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "AI Commerce Copilot",
  applicationCategory: "BusinessApplication",
  operatingSystem: "WooCommerce",
  description:
    "AI-powered commerce intelligence platform for WooCommerce that recommends products, explains why they perform well, and surfaces actionable merchant insights.",
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Hero />
      <TrustedBy />
      <Problem />
      <Solution />
      <Features />
      <Dashboard />
      <Insights />
      <FrequentlyBoughtTogether />
      <Metrics />
      <Comparison />
      <FutureVision />
      <FinalCTA />
    </>
  );
}
