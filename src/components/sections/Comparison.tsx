import { X, Check } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { comparisonRows } from "@/data/comparison";

export function Comparison() {
  return (
    <section className="py-24 sm:py-32" aria-labelledby="comparison-heading">
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <SectionHeading
          eyebrow="Why AI Commerce Copilot"
          title={<span id="comparison-heading">Not just another recommendation plugin</span>}
        />

        <Reveal className="mt-14 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_20px_60px_-30px_rgb(15_23_42_/_0.2)]">
          <div className="grid grid-cols-2 divide-x divide-line">
            <div className="bg-slate-50 px-6 py-5 text-center">
              <p className="text-sm font-semibold text-ink-muted">Typical Plugin</p>
            </div>
            <div className="bg-gradient-to-br from-primary/8 to-secondary/8 px-6 py-5 text-center">
              <p className="text-sm font-semibold text-primary-bright">AI Commerce Copilot</p>
            </div>
          </div>

          {comparisonRows.map((row, i) => (
            <div key={i} className="grid grid-cols-2 divide-x divide-line border-t border-line">
              <div className="flex items-center gap-3 px-6 py-5 text-sm text-ink-muted">
                <X className="h-4 w-4 shrink-0 text-slate-400" />
                {row.typical}
              </div>
              <div className="flex items-center gap-3 bg-secondary/[0.03] px-6 py-5 text-sm font-medium text-ink">
                <Check className="h-4 w-4 shrink-0 text-secondary-bright" />
                {row.copilot}
              </div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
