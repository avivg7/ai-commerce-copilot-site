import { TrendingUp, Target, Package, BarChart3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { GlassCard } from "@/components/ui/GlassCard";
import { GradientGlow } from "@/components/ui/GradientGlow";
import { RecoPose } from "@/components/reco/RecoPose";
import { insights } from "@/data/insights";

const icons: LucideIcon[] = [TrendingUp, Target, Package, BarChart3];

export function Insights() {
  return (
    <section
      id="insights"
      className="relative overflow-hidden bg-gradient-to-b from-navy via-navy-soft to-navy py-24 text-white sm:py-32"
    >
      <GradientGlow tone="accent" className="left-1/2 top-0 h-[30rem] w-[30rem] -translate-x-1/2" />

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <SectionHeading
          eyebrow="Merchant Insights"
          title="Reco reads the signals so you don't have to"
          description="AI-generated, plain-English recommendations — the moment they matter."
          tone="dark"
        />

        <div className="mt-12 flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 -z-10 animate-pulse-glow rounded-full bg-accent/30 blur-2xl" />
            <RecoPose pose="thinking" size={190} />
          </div>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {insights.map((insight, i) => {
            const Icon = icons[i];
            return (
              <Reveal key={insight.title} delay={i * 0.15}>
                <GlassCard tone="dark" className="h-full p-6">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-accent-soft">
                      <Icon className="h-3.5 w-3.5" /> {insight.tag}
                    </span>
                    <span className="text-xs font-semibold text-secondary">{insight.metric}</span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-white">{insight.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">{insight.detail}</p>
                </GlassCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
