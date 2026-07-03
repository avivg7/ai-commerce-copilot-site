import { Marquee } from "@/components/ui/Marquee";
import { storeLogos } from "@/data/storeLogos";
import { Reveal } from "@/components/ui/Reveal";
import { fadeIn } from "@/lib/motion";

export function TrustedBy() {
  return (
    <section className="py-16" aria-label="Trusted by modern WooCommerce stores">
      <div className="mx-auto max-w-5xl px-6 lg:px-8">
        <Reveal variants={fadeIn}>
          <p className="text-center text-sm font-medium uppercase tracking-wide text-ink-muted">
            Trusted by modern WooCommerce stores
          </p>
        </Reveal>
      </div>
      <div className="mt-8">
        <Marquee
          items={storeLogos.map((name) => (
            <span
              key={name}
              className="select-none text-xl font-semibold tracking-tight text-ink-muted/50 grayscale transition-colors hover:text-ink-muted"
            >
              {name}
            </span>
          ))}
        />
      </div>
    </section>
  );
}
