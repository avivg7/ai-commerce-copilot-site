import Link from "next/link";
import { cn } from "@/lib/cn";
import { withBase } from "@/lib/site";

/** Real AICC logomark (public/brand/aicc-logomark.svg) + wordmark. The visible text is the accessible name. */
export function Logo({
  href,
  full,
  className,
  onDark,
}: {
  href: string;
  full: string;
  className?: string;
  onDark?: boolean;
}) {
  return (
    <Link href={href} className={cn("aicc-logo", onDark && "aicc-on-dark", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={withBase("/brand/aicc-logomark.svg")} alt="" width={32} height={32} />
      <span className="aicc-logo__short">AICC</span>
      <span className="aicc-logo__full">{full}</span>
    </Link>
  );
}
