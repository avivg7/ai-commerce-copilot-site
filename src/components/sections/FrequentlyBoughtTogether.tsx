"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Magnet, Plus } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { GlassCard } from "@/components/ui/GlassCard";
import { viewportOnce } from "@/lib/motion";

const products = [
  { name: "Ceramic Pour-Over Kit", price: "$38" },
  { name: "Reusable Filter", price: "$14" },
  { name: "Bamboo Grinder", price: "$46" },
];

const badges = ["Horizontal Cards", "Multi-language", "RTL Support", "Cart Recommendations"];

export function FrequentlyBoughtTogether() {
  const [added, setAdded] = useState(false);

  return (
    <section className="py-24 sm:py-32" aria-labelledby="fbt-heading">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <SectionHeading
          eyebrow="Frequently Bought Together"
          title={<span id="fbt-heading">Reco pulls the right products together</span>}
          description="A native widget that lives right on the product page — where the decision happens."
        />

        <div className="mt-16 grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-16">
          <Reveal>
            <GlassCard className="p-8">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Magnet className="h-4 w-4 text-primary-bright" />
                Frequently bought together
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                {products.map((product, i) => (
                  <motion.div
                    key={product.name}
                    initial={{ opacity: 0, x: -16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={viewportOnce}
                    transition={{ delay: i * 0.12, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-center gap-3"
                  >
                    <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 shadow-sm">
                      <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary-bright/20 to-secondary/20" />
                      <div>
                        <p className="text-sm font-medium text-ink">{product.name}</p>
                        <p className="text-xs text-ink-muted">{product.price}</p>
                      </div>
                    </div>
                    {i < products.length - 1 && <Plus className="h-4 w-4 shrink-0 text-ink-muted" />}
                  </motion.div>
                ))}
              </div>

              <div className="mt-7 flex items-center justify-between border-t border-line pt-6">
                <div>
                  <p className="text-xs text-ink-muted">Bundle total</p>
                  <p className="text-lg font-semibold text-ink">$98</p>
                </div>
                <button
                  onClick={() => {
                    setAdded(true);
                    setTimeout(() => setAdded(false), 2200);
                  }}
                  className="relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-primary-bright to-secondary px-6 py-3 text-sm font-medium text-white shadow-md transition-transform hover:-translate-y-0.5 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  {added ? (
                    <motion.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-2">
                      <Check className="h-4 w-4" /> Added to cart
                    </motion.span>
                  ) : (
                    "Add bundle to cart"
                  )}
                </button>
              </div>
            </GlassCard>

            <div className="mt-6 flex flex-wrap gap-2">
              {badges.map((badge) => (
                <span key={badge} className="rounded-full bg-primary/8 px-3 py-1.5 text-xs font-medium text-primary-bright">
                  {badge}
                </span>
              ))}
            </div>
          </Reveal>

          <Reveal delay={0.15} className="mx-auto lg:mx-0">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-primary-bright to-secondary text-white shadow-[0_20px_50px_-15px_rgb(37_99_235_/_0.5)] animate-float-slow">
              <Magnet className="h-9 w-9" strokeWidth={1.75} />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
