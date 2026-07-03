import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ButtonProps {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  className?: string;
  icon?: ReactNode;
  onClick?: () => void;
}

export function Button({ href, children, variant = "primary", size = "md", className, icon, onClick }: ButtonProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "group inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        size === "lg" ? "px-8 py-4 text-base" : "px-6 py-3 text-sm",
        variant === "primary" &&
          "bg-gradient-to-r from-primary-bright to-secondary text-white shadow-[0_8px_30px_-8px_rgb(37_99_235_/_0.55)] hover:shadow-[0_12px_36px_-6px_rgb(37_99_235_/_0.65)] hover:-translate-y-0.5",
        variant === "secondary" &&
          "glass text-ink hover:-translate-y-0.5 hover:bg-white/80",
        variant === "ghost" &&
          "text-white/90 ring-1 ring-white/25 hover:bg-white/10 hover:-translate-y-0.5",
        className,
      )}
    >
      {children}
      {icon && <span className="transition-transform duration-300 group-hover:translate-x-0.5">{icon}</span>}
    </Link>
  );
}
