import {
  Sparkles,
  Link2,
  Lightbulb,
  PieChart,
  Activity,
  TrendingUp,
  RefreshCw,
  HeartPulse,
  Languages,
  ShoppingCart,
  Eye,
  LayoutDashboard,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";
import { basePath } from "@/lib/basePath";
import { features, type FeatureIcon } from "@/data/features";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BentoCard } from "@/components/ui/BentoCard";
import { Reveal } from "@/components/ui/Reveal";
import { scaleIn } from "@/lib/motion";

const iconMap: Record<FeatureIcon, LucideIcon> = {
  sparkles: Sparkles,
  link: Link2,
  lightbulb: Lightbulb,
  "pie-chart": PieChart,
  activity: Activity,
  "trending-up": TrendingUp,
  "refresh-cw": RefreshCw,
  "heart-pulse": HeartPulse,
  languages: Languages,
  "shopping-cart": ShoppingCart,
  eye: Eye,
  "layout-dashboard": LayoutDashboard,
};

export function Features() {
  return (
    <section id="features" className="py-24 sm:py-32" aria-labelledby="features-heading">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <SectionHeading
          eyebrow="Features"
          title={<span id="features-heading">Everything a modern merchant needs</span>}
          description="Recommendations, analytics, and AI insights working together — not twelve disconnected tools."
        />

        <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => {
            const Icon = iconMap[feature.icon];
            const isPeekCard = i === 3;
            return (
              <Reveal key={feature.title} variants={scaleIn} delay={(i % 3) * 0.08} className={feature.featured ? "sm:col-span-2" : undefined}>
                <BentoCard
                  icon={<Icon className="h-5 w-5" strokeWidth={2} />}
                  title={feature.title}
                  description={feature.description}
                  featured={feature.featured}
                  corner={
                    isPeekCard ? (
                      <Image
                        src={`${basePath}/images/reco/reco-thinking.png`}
                        alt=""
                        aria-hidden="true"
                        width={1592}
                        height={2280}
                        className="pointer-events-none absolute -bottom-6 -right-6 h-24 w-auto opacity-0 transition-all duration-500 ease-out group-hover:-translate-y-1 group-hover:opacity-100"
                      />
                    ) : undefined
                  }
                />
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
