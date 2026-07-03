import { cn } from "@/lib/cn";

interface GradientGlowProps {
  className?: string;
  tone?: "primary" | "secondary" | "accent";
}

/** Reusable blurred gradient blob for ambient background glow. Purely decorative. */
export function GradientGlow({ className, tone = "primary" }: GradientGlowProps) {
  const tones = {
    primary: "from-primary-bright/40 via-accent/20 to-transparent",
    secondary: "from-secondary/35 via-accent/20 to-transparent",
    accent: "from-accent/40 via-secondary/15 to-transparent",
  } as const;

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute rounded-full bg-gradient-to-br blur-3xl",
        tones[tone],
        className,
      )}
    />
  );
}
