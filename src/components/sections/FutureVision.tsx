import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { GradientGlow } from "@/components/ui/GradientGlow";
import { RecoPose } from "@/components/reco/RecoPose";
import { roadmapItems } from "@/data/roadmap";

export function FutureVision() {
  return (
    <section className="relative overflow-hidden py-24 sm:py-32" aria-labelledby="roadmap-heading">
      <GradientGlow tone="accent" className="right-[6%] top-10 h-72 w-72 opacity-60" />

      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <SectionHeading
          eyebrow="Roadmap"
          title={<span id="roadmap-heading">Where AI Commerce Copilot is headed</span>}
          description="A platform vision, not a promise — here&rsquo;s what Reco is building toward next."
        />

        <div className="mt-14 grid items-center gap-12 lg:grid-cols-[1fr_auto]">
          <div className="grid gap-4 sm:grid-cols-2">
            {roadmapItems.map((item, i) => (
              <Reveal
                key={item.title}
                delay={i * 0.06}
                className={i === roadmapItems.length - 1 && roadmapItems.length % 2 === 1 ? "sm:col-span-2" : undefined}
              >
                <div className="relative rounded-2xl border border-dashed border-primary-bright/30 bg-gradient-to-br from-primary/[0.04] to-accent/[0.04] p-5">
                  <span className="absolute right-4 top-4 rounded-full bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-bright ring-1 ring-primary-bright/20">
                    Coming Soon
                  </span>
                  <h3 className="pr-20 text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-ink-muted">{item.description}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.2} className="relative mx-auto lg:mx-0">
            <div className="absolute inset-0 -z-10 animate-pulse-glow rounded-full bg-accent/25 blur-2xl" />
            <RecoPose pose="thinking" size={200} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
