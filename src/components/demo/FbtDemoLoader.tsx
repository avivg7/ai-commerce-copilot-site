"use client";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { Info } from "lucide-react";
import type { Dictionary } from "@/i18n";

type Demo = Dictionary["demo"];

/**
 * Lazy boundary for the interactive demo. The demo's code is a separate chunk that is only requested when the
 * placeholder is about to scroll into view, so it costs nothing on first load. The placeholder reserves the demo's
 * height (no layout shift) and already carries the "Illustrative demo: not store data" label.
 */
export function FbtDemoLoader({ s, rtl }: { s: Demo; rtl: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [Demo, setDemo] = useState<ComponentType<{ s: Demo; rtl: boolean }> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let done = false;
    const load = () => {
      if (done) return;
      done = true;
      import("./FbtDemo").then((m) => setDemo(() => m.default));
    };
    if (typeof IntersectionObserver === "undefined") {
      const t = window.setTimeout(load, 0);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          load();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (Demo) return <Demo s={s} rtl={rtl} />;
  return (
    <div ref={ref} className="aicc-demo aicc-demo--placeholder" aria-busy="true">
      <div className="aicc-demo__widget">
        <div className="aicc-demo__top">
          <p className="aicc-demo__label">
            <Info size={18} aria-hidden="true" />
            <span>{s.label}</span>
          </p>
        </div>
        <div className="aicc-demo__head">
          <h3>{s.widget.title}</h3>
          <p>{s.widget.subtitle}</p>
        </div>
      </div>
    </div>
  );
}
