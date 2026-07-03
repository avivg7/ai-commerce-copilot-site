import type { ReactNode } from "react";
import { HelpCircle, Check } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { RecoPose } from "@/components/reco/RecoPose";
import { staggerContainer } from "@/lib/motion";

const known = ["Revenue", "Orders", "Traffic"];
const unknown = [
  "Why customers buy",
  "What products should be bundled",
  "Which recommendations actually make money",
];

export function Problem() {
  return (
    <section className="py-24 sm:py-32" aria-labelledby="problem-heading">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <SectionHeading
          eyebrow="The Problem"
          title={<span id="problem-heading">Most WooCommerce stores are flying blind</span>}
          description="They know what happened. They don't know why — or what to do next."
        />

        <div className="mt-16 grid items-center gap-12 lg:grid-cols-[auto_1fr] lg:gap-16">
          <Reveal className="mx-auto lg:mx-0">
            <RecoPose pose="concerned" size={240} />
          </Reveal>

          <div className="grid gap-6 sm:grid-cols-2">
            <Reveal
              variants={staggerContainer(0.08)}
              className="rounded-2xl border border-line bg-white p-6 opacity-80"
            >
              <p className="text-sm font-semibold text-ink-muted">What they know</p>
              <ul className="mt-4 space-y-3">
                {known.map((item) => (
                  <ListItem key={item} icon={<Check className="h-4 w-4 text-secondary-bright" />} label={item} />
                ))}
              </ul>
            </Reveal>

            <Reveal
              variants={staggerContainer(0.08, 0.1)}
              delay={0.1}
              className="rounded-2xl border border-primary-bright/20 bg-gradient-to-br from-primary/5 to-secondary/5 p-6 shadow-[0_20px_50px_-25px_rgb(37_99_235_/_0.4)]"
            >
              <p className="text-sm font-semibold text-primary-bright">What they don&apos;t know</p>
              <ul className="mt-4 space-y-3">
                {unknown.map((item) => (
                  <ListItem key={item} icon={<HelpCircle className="h-4 w-4 text-primary-bright" />} label={item} />
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

function ListItem({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-ink">
      <span className="mt-0.5">{icon}</span>
      {label}
    </li>
  );
}
