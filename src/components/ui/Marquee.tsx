"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface MarqueeProps {
  items: ReactNode[];
  className?: string;
}

/** Seamless infinite marquee: content is duplicated once and the wrapper animates -50%. */
export function Marquee({ items, className }: MarqueeProps) {
  return (
    <div className={cn("group relative overflow-hidden fade-edges-x", className)}>
      <div className="flex w-max animate-marquee items-center gap-16 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {[...items, ...items].map((item, i) => (
          <div key={i} className="shrink-0">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
