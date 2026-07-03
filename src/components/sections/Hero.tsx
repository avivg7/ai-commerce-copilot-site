"use client";

import { motion } from "framer-motion";
import { ArrowRight, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { RecoHeroVideo } from "@/components/reco/RecoHeroVideo";
import { fadeUp, staggerContainer } from "@/lib/motion";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pb-20 pt-36 sm:pt-44">
      <div className="mx-auto grid max-w-7xl items-center gap-16 px-6 lg:grid-cols-2 lg:gap-12 lg:px-8">
        <motion.div initial="hidden" animate="show" variants={staggerContainer(0.12, 0.1)}>
          <motion.span
            variants={fadeUp}
            className="inline-flex items-center gap-2 rounded-full bg-primary/8 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary-bright"
          >
            AI Commerce Intelligence for WooCommerce
          </motion.span>

          <motion.h1
            variants={fadeUp}
            className="mt-6 text-balance text-4xl font-semibold tracking-tight text-ink sm:text-5xl md:text-6xl"
          >
            Turn Every Customer Into a{" "}
            <span className="text-gradient">Bigger Order.</span>
          </motion.h1>

          <motion.p variants={fadeUp} className="mt-6 max-w-xl text-balance text-lg leading-relaxed text-ink-muted">
            AI Commerce Copilot analyzes real shopper behavior to recommend products your
            customers are likely to buy together — and explains exactly why they work, with
            merchant insights you can act on today.
          </motion.p>

          <motion.div variants={fadeUp} className="mt-10 flex flex-wrap items-center gap-4">
            <Button href="#get-started" size="lg" icon={<ArrowRight className="h-4 w-4" />}>
              Start Free
            </Button>
            <Button href="#demo" size="lg" variant="secondary" icon={<Play className="h-4 w-4" />}>
              Watch Demo
            </Button>
          </motion.div>

          <motion.p variants={fadeUp} className="mt-8 text-sm text-ink-muted">
            No credit card required · Meet Reco, your AI merchandising copilot
          </motion.p>
        </motion.div>

        <RecoHeroVideo />
      </div>
    </section>
  );
}
