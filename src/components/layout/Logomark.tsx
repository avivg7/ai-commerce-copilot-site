import { cn } from "@/lib/cn";

/** Lightweight inline brand mark echoing Reco's face — used at nav/footer scale where the full illustration is too heavy. */
export function Logomark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8", className)} aria-hidden="true">
      <defs>
        <linearGradient id="logomark-gradient" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563eb" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="10" fill="url(#logomark-gradient)" />
      <rect x="8" y="10" width="16" height="12" rx="5" fill="white" fillOpacity="0.95" />
      <circle cx="13" cy="16" r="1.6" fill="#0b1220" />
      <circle cx="19" cy="16" r="1.6" fill="#0b1220" />
      <path d="M13 19c1 1 5 1 6 0" stroke="#0b1220" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <rect x="14" y="6" width="4" height="3" rx="1.5" fill="white" fillOpacity="0.7" />
    </svg>
  );
}
