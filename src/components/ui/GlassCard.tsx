import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: "light" | "dark";
}

export function GlassCard({ tone = "light", className, ...props }: GlassCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl shadow-[0_8px_40px_-12px_rgb(15_23_42_/_0.15)]",
        tone === "light" ? "glass" : "glass-dark",
        className,
      )}
      {...props}
    />
  );
}
