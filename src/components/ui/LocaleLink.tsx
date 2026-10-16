import Link from "next/link";
import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { localePath, type RouteId } from "@/lib/routes";

/** The only way to link to another page of this site: always keeps the visitor in their language. */
export function LocaleLink({
  locale,
  route,
  hash,
  className,
  children,
  "aria-current": ariaCurrent,
}: {
  locale: Locale;
  route: RouteId;
  hash?: string;
  className?: string;
  children: ReactNode;
  "aria-current"?: "page";
}) {
  return (
    <Link href={`${localePath(locale, route)}${hash ? `#${hash}` : ""}`} className={className} aria-current={ariaCurrent}>
      {children}
    </Link>
  );
}
