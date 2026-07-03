import { ArrowRight, Calendar } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { GradientGlow } from "@/components/ui/GradientGlow";
import { RecoPose } from "@/components/reco/RecoPose";

export function FinalCTA() {
  return (
    <section id="get-started" className="relative overflow-hidden bg-navy py-28 text-white sm:py-36">
      <GradientGlow tone="primary" className="left-1/4 top-0 h-96 w-96" />
      <GradientGlow tone="secondary" className="bottom-0 right-1/4 h-96 w-96" />

      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 text-center lg:px-8">
        <Reveal>
          <RecoPose pose="celebrate" size={220} priority />
        </Reveal>

        <Reveal delay={0.1}>
          <h2 className="mt-4 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Ready to Let AI Grow Your Store?
          </h2>
        </Reveal>

        <Reveal delay={0.18}>
          <p className="mt-5 max-w-xl text-balance text-lg leading-relaxed text-white/70">
            Join modern WooCommerce merchants using AI Commerce Copilot to turn everyday
            browsing into bigger orders — with Reco guiding the way.
          </p>
        </Reveal>

        <Reveal delay={0.26} className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Button href="#start-free" size="lg" icon={<ArrowRight className="h-4 w-4" />}>
            Get Started
          </Button>
          <Button href="#book-demo" size="lg" variant="ghost" icon={<Calendar className="h-4 w-4" />}>
            Book a Demo
          </Button>
        </Reveal>
      </div>
    </section>
  );
}
