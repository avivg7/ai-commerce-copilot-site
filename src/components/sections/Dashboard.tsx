import { TrendingUp, HeartPulse, RefreshCw, Sparkles, Eye } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { GradientGlow } from "@/components/ui/GradientGlow";
import { GlassCard } from "@/components/ui/GlassCard";

const revenueBars = [38, 52, 46, 64, 58, 74, 88];
const syncRows = [
  { label: "Product catalog", status: "Synced" },
  { label: "Order events", status: "Synced" },
  { label: "Customer behavior", status: "Live" },
];

export function Dashboard() {
  return (
    <section className="relative overflow-hidden bg-navy py-24 text-white sm:py-32">
      <GradientGlow tone="primary" className="left-[10%] top-0 h-96 w-96" />
      <GradientGlow tone="secondary" className="bottom-0 right-[8%] h-96 w-96" />

      <div className="relative mx-auto max-w-7xl px-6 lg:px-8">
        <SectionHeading
          eyebrow="Merchant Dashboard"
          title="One dashboard. Every answer."
          description="Revenue, insights, store health, and operations — all in a single, premium view."
          tone="dark"
        />

        <div className="mt-16 grid gap-5 lg:grid-cols-3">
          <Reveal className="lg:col-span-2 lg:row-span-2">
            <GlassCard tone="dark" className="flex h-full flex-col p-7">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/60">Revenue</p>
                  <p className="mt-1 text-3xl font-semibold">$186,420</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-secondary/15 px-3 py-1 text-xs font-semibold text-secondary">
                  <TrendingUp className="h-3.5 w-3.5" /> +34%
                </span>
              </div>
              <div className="mt-8 flex flex-1 items-end gap-3">
                {revenueBars.map((h, i) => (
                  <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-primary-bright to-accent" style={{ height: `${h}%` }} />
                ))}
              </div>
            </GlassCard>
          </Reveal>

          <Reveal delay={0.1}>
            <GlassCard tone="dark" className="p-7">
              <div className="flex items-center gap-2 text-sm text-white/60">
                <HeartPulse className="h-4 w-4 text-secondary" /> Store Health
              </div>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-4xl font-semibold">94</span>
                <span className="mb-1 text-sm text-white/50">/ 100</span>
              </div>
              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-[94%] rounded-full bg-gradient-to-r from-secondary to-accent" />
              </div>
            </GlassCard>
          </Reveal>

          <Reveal delay={0.18}>
            <GlassCard tone="dark" className="p-7">
              <div className="flex items-center gap-2 text-sm text-white/60">
                <RefreshCw className="h-4 w-4 text-accent" /> Operations
              </div>
              <ul className="mt-4 space-y-3">
                {syncRows.map((row) => (
                  <li key={row.label} className="flex items-center justify-between text-sm">
                    <span className="text-white/80">{row.label}</span>
                    <span className="text-xs font-semibold text-secondary">{row.status}</span>
                  </li>
                ))}
              </ul>
            </GlassCard>
          </Reveal>

          <Reveal delay={0.24}>
            <GlassCard tone="dark" className="p-7">
              <div className="flex items-center gap-2 text-sm text-white/60">
                <Sparkles className="h-4 w-4 text-accent" /> Insights
              </div>
              <p className="mt-4 text-sm leading-relaxed text-white/80">
                &ldquo;Bundle Ceramic Mug with Pour-Over Kit — 61% co-purchase rate.&rdquo;
              </p>
            </GlassCard>
          </Reveal>

          <Reveal delay={0.3} className="lg:col-span-1">
            <GlassCard tone="dark" className="p-7">
              <div className="flex items-center gap-2 text-sm text-white/60">
                <Eye className="h-4 w-4 text-accent" /> Recommendation Preview
              </div>
              <div className="mt-4 flex gap-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="aspect-square flex-1 rounded-lg bg-gradient-to-br from-white/15 to-white/5" />
                ))}
              </div>
            </GlassCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
