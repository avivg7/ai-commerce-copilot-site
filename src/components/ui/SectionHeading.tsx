import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Reveal } from "./Reveal";

interface SectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  tone?: "light" | "dark";
  className?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  tone = "light",
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && (
        <Reveal>
          <span
            className={cn(
              "mb-4 inline-flex items-center rounded-full px-3.5 py-1 text-xs font-semibold tracking-wide uppercase",
              tone === "light"
                ? "bg-primary/8 text-primary-bright"
                : "bg-white/10 text-accent-soft",
            )}
          >
            {eyebrow}
          </span>
        </Reveal>
      )}
      <Reveal delay={0.08}>
        <h2
          className={cn(
            "text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl",
            tone === "light" ? "text-ink" : "text-white",
          )}
        >
          {title}
        </h2>
      </Reveal>
      {description && (
        <Reveal delay={0.16}>
          <p
            className={cn(
              "mt-5 text-balance text-lg leading-relaxed",
              tone === "light" ? "text-ink-muted" : "text-white/70",
            )}
          >
            {description}
          </p>
        </Reveal>
      )}
    </div>
  );
}
