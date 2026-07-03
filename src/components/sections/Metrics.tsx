import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { RecoPose } from "@/components/reco/RecoPose";
import { metrics } from "@/data/metrics";

export function Metrics() {
  return (
    <section className="relative overflow-hidden py-24 sm:py-32" aria-labelledby="metrics-heading">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_auto]">
          <SectionHeading
            align="left"
            eyebrow="Real Results"
            title={<span id="metrics-heading">Numbers Reco is proud of</span>}
            description="Every merchant on AI Commerce Copilot sees measurable movement — fast."
            className="mx-0 max-w-xl text-left"
          />
          <Reveal className="mx-auto lg:mx-0">
            <RecoPose pose="celebrate" size={180} />
          </Reveal>
        </div>

        <div className="mt-14 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          {metrics.map((metric, i) => (
            <Reveal key={metric.label} delay={i * 0.08} className="rounded-2xl border border-line bg-white p-5 text-center">
              <p className="text-2xl font-semibold text-gradient sm:text-3xl">
                <AnimatedCounter value={metric.value} prefix={metric.prefix} suffix={metric.suffix} decimals={metric.decimals} />
              </p>
              <p className="mt-2 text-xs leading-snug text-ink-muted">{metric.label}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
