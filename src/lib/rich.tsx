import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { LOCALE_META, type Locale } from "@/i18n/config";
import { txProps, type Dictionary } from "@/i18n";
import { currencySuffix, formatPrice, planById } from "@/data/plans";
import { COMPANY, type CompanyKey } from "@/lib/site";
import { localePath, isRouteId } from "@/lib/routes";
import { formatDate, formatYear } from "@/lib/format";
import { ACCESSIBILITY_REVIEWED_ON } from "@/lib/site";

/**
 * Renders the dictionary mini-markup (see src/i18n/en.ts header): **bold**, [label](route:x), [label](https://...),
 * and {tokens}. In right-to-left locales, Latin runs (AICC, Studio, $199) are wrapped in <bdi> so they never scramble.
 */
export interface RichCtx {
  locale: Locale;
  t: Dictionary;
  vars?: Record<string, string>;
}

type Resolved = { text: string; pending?: "line" | "detail"; href?: string };

function resolveToken(name: string, ctx: RichCtx): Resolved | null {
  const { locale } = ctx;
  if (ctx.vars && name in ctx.vars) return { text: ctx.vars[name] };
  const priceMatch = /^price(Solo|Studio|Agency)$/.exec(name);
  if (priceMatch) return { text: formatPrice(planById(priceMatch[1].toLowerCase() as "solo").price, locale) + currencySuffix(locale) };
  const storesMatch = /^stores(Solo|Studio|Agency)$/.exec(name);
  if (storesMatch) return { text: String(planById(storesMatch[1].toLowerCase() as "solo").stores) };
  if (name === "year") return { text: formatYear(locale) };
  if (name === "date") return { text: formatDate(ACCESSIBILITY_REVIEWED_ON, locale) };
  if (name === "companyDetails") {
    // Both name and address, or neither: half a company identity is worse than the plain pending line.
    if (COMPANY.legalName && COMPANY.address) return { text: `${COMPANY.legalName}, ${COMPANY.address}` };
    return { text: "", pending: "line" };
  }
  if (name in COMPANY) {
    const key = name as CompanyKey;
    const value = COMPANY[key];
    if (value) return { text: value, href: key === "supportEmail" ? `mailto:${value}` : undefined };
    return { text: "", pending: key === "supportEmail" || key === "legalName" || key === "address" ? "line" : "detail" };
  }
  return null;
}

const LATIN_RUN = /(\$?[A-Za-z][A-Za-z0-9_.&’'-]*(?: [A-Za-z][A-Za-z0-9_.&’'-]*)*|\$\d[\d,.]*)/g;

function isolate(text: string, rtl: boolean, keyBase: string): ReactNode {
  if (!rtl) return text;
  const parts = text.split(LATIN_RUN);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? <bdi key={`${keyBase}-${i}`} lang="en">{part}</bdi> : part,
  );
}

const TOKEN_RE = /(\*\*[^*]+\*\*|\[[^\]]+\]\((?:route:[a-z-]+|https?:\/\/[^)]+)\)|\{[A-Za-z0-9]+\})/g;

export function Rich({ text, ctx }: { text: string; ctx: RichCtx }): ReactNode {
  const rtl = LOCALE_META[ctx.locale].dir === "rtl";
  const pieces = text.split(TOKEN_RE);
  return (
    <>
      {pieces.map((piece, i) => {
        if (!piece) return null;
        const key = `r${i}`;
        if (piece.startsWith("**") && piece.endsWith("**")) {
          return <strong key={key}>{isolate(piece.slice(2, -2), rtl, key)}</strong>;
        }
        const link = /^\[([^\]]+)\]\((route:[a-z-]+|https?:\/\/[^)]+)\)$/.exec(piece);
        if (link) {
          const [, label, target] = link;
          if (target.startsWith("route:")) {
            const id = target.slice(6);
            if (isRouteId(id)) {
              return (
                <Link key={key} href={localePath(ctx.locale, id)} className="aicc-link">
                  {isolate(label, rtl, key)}
                </Link>
              );
            }
          }
          return (
            <a key={key} href={target} className="aicc-link" rel="noopener noreferrer">
              {isolate(label, rtl, key)}
            </a>
          );
        }
        const tok = /^\{([A-Za-z0-9]+)\}$/.exec(piece);
        if (tok) {
          const r = resolveToken(tok[1], ctx);
          if (!r) return piece;
          if (r.pending) {
            return (
              <span key={key} className="aicc-pending" data-pending="true" {...(({ lang, dir }) => ({ lang, dir }))(txProps(ctx.locale, `pending.${r.pending}`))}>
                {ctx.t.pending[r.pending]}
              </span>
            );
          }
          if (r.href) {
            return (
              <a key={key} href={r.href} className="aicc-link">
                <bdi>{r.text}</bdi>
              </a>
            );
          }
          return <bdi key={key}>{r.text}</bdi>;
        }
        return <Fragment key={key}>{isolate(piece, rtl, key)}</Fragment>;
      })}
    </>
  );
}

/** Plain-string version for <title>, meta descriptions, aria-labels and JSON-LD. */
export function formatPlain(text: string, ctx: RichCtx): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\((?:route:[a-z-]+|https?:\/\/[^)]+)\)/g, "$1")
    .replace(/\{([A-Za-z0-9]+)\}/g, (m, name: string) => {
      const r = resolveToken(name, ctx);
      if (!r) return m;
      return r.pending ? ctx.t.pending[r.pending] : r.text;
    });
}

