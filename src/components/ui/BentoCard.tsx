import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface BentoCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  featured?: boolean;
  className?: string;
  corner?: ReactNode;
}

export function BentoCard({ icon, title, description, featured, className, corner }: BentoCardProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-line bg-white p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary-bright/30 hover:shadow-[0_20px_50px_-20px_rgb(37_99_235_/_0.35)]",
        featured && "sm:col-span-2 sm:row-span-1",
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br from-primary-bright/15 to-accent/15 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
      />
      <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary-bright to-secondary text-white shadow-md transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
        {icon}
      </div>
      <h3 className="relative mt-5 text-lg font-semibold text-ink">{title}</h3>
      <p className="relative mt-2 text-sm leading-relaxed text-ink-muted">{description}</p>
      {corner}
    </div>
  );
}
