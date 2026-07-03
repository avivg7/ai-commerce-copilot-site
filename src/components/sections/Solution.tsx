"use client";

import { motion } from "framer-motion";
import { Plug, BrainCircuit, TrendingUp } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { RecoPose } from "@/components/reco/RecoPose";
import { viewportOnce } from "@/lib/motion";

const steps = [
  {
    icon: Plug,
    title: "Connect Store",
    description: "Install AI Commerce Copilot and connect your WooCommerce store in minutes.",
  },
  {
    icon: BrainCircuit,
    title: "Analyze Behavior",
    description: "Reco observes browsing, search, and purchase patterns across every customer.",
  },
  {
    icon: TrendingUp,
    title: "Grow Revenue",
    description: "AI-powered recommendations and insights turn behavior into bigger orders.",
  },
];

export function Solution() {
  return (
    <section id="how-it-works" className="py-24 sm:py-32" aria-labelledby="solution-heading">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <SectionHeading
          eyebrow="The Solution"
          title={<span id="solution-heading">Reco connects the dots for you</span>}
          description="From first pixel to purchase, AI Commerce Copilot turns raw behavior into revenue."
        />

        <div className="mt-16 flex justify-center">
          <RecoPose pose="thinking" size={180} />
        </div>

        <div className="relative mt-8 grid gap-10 sm:grid-cols-3 sm:gap-6">
          <div className="absolute left-0 right-0 top-9 hidden h-px sm:block" aria-hidden="true">
            <div className="h-full w-full bg-line" />
            <motion.div
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={viewportOnce}
              transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformOrigin: "left" }}
              className="absolute inset-0 h-full w-full bg-gradient-to-r from-primary-bright via-secondary to-accent"
            />
          </div>

          {steps.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.15} className="relative flex flex-col items-center text-center sm:items-start sm:text-left">
              <div className="relative z-10 flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-white text-primary-bright shadow-[0_10px_30px_-10px_rgb(37_99_235_/_0.4)] ring-1 ring-line">
                <step.icon className="h-7 w-7" strokeWidth={1.75} />
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-primary-bright to-secondary text-xs font-bold text-white">
                  {i + 1}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-ink">{step.title}</h3>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-ink-muted">{step.description}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
