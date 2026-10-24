import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { LOCALE_META, type Locale } from "@/i18n/config";
import { txProps, type Dictionary } from "@/i18n";
import { currencySuffix, formatPrice, planById } from "@/data/plans";
import { COMPANY, PRE_COMMERCIAL_CONTACT, type CompanyKey } from "@/lib/site";
import { localePath, isRouteId } from "@/lib/routes";
import { formatDate, formatYear } from "@/lib/format";
import { ACCESSIBILITY_REVIEWED_ON } from "@/lib/site";
import { splitLabels } from "../../brand/js/motion.js";

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

function resolveToken(name: string, ctx: RichCtx, currencyNote = true): Resolved | null {
  const { locale } = ctx;
  if (ctx.vars && name in ctx.vars) return { text: ctx.vars[name] };
  const priceMatch = /^price(Solo|Studio|Agency)$/.exec(name);
  if (priceMatch) return { text: formatPrice(planById(priceMatch[1].toLowerCase() as "solo").price, locale) + (currencyNote ? currencySuffix(locale) : "") };
  const storesMatch = /^stores(Solo|Studio|Agency)$/.exec(name);
  if (storesMatch) return { text: String(planById(storesMatch[1].toLowerCase() as "solo").stores) };
  if (name === "year") return { text: formatYear(locale) };
  if (name === "date") return { text: formatDate(ACCESSIBILITY_REVIEWED_ON, locale) };
  if (name === "contactEmail") return { text: PRE_COMMERCIAL_CONTACT, href: `mailto:${PRE_COMMERCIAL_CONTACT}` };
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

// A Latin run (AICC, Plans, WCAG 2.2, copilt.org, HTTPS) is isolated so it never scrambles RTL text. Rules: a dot belongs to the run only between alphanumerics
// (versions 2.2, domains copilt.org); a sentence-final period, comma or colon stays OUTSIDE the isolate, otherwise the period lands on the wrong side in Hebrew
// ("AA." reading ". AA"); a number right after a Latin word joins it (WCAG 2.2, PHP 7.4) so "2.2 WCAG" cannot happen.
const LATIN_RUN = /(\$?[A-Za-z][A-Za-z0-9_&’'-]*(?:\.[A-Za-z0-9_&’'-]+)*(?: [A-Za-z0-9][A-Za-z0-9_&’'-]*(?:\.[A-Za-z0-9_&’'-]+)*)*|\$\d[\d,]*(?:\.\d+)?)/g;

function isolate(text: string, rtl: boolean, keyBase: string, locale: Locale = "en"): ReactNode {
  // Real plugin-admin labels (Recommendation Preview, Pin, Bought together {n} times ...) stay English in the admin of every language but Hebrew:
  // on a translated page each occurrence says lang="en" at the leaf (WCAG 3.1.2), the words around it do not. (Hebrew uses the plugin's Hebrew labels.)
  if (locale !== "en" && locale !== "he") {
    const parts = splitLabels(text);
    if (parts.some((p: { label: boolean }) => p.label)) {
      return parts.map((p: { text: string; label: boolean }, i: number) => (p.label ? <span key={`${keyBase}-l${i}`} lang="en" dir="ltr" className="aicc-admin-label">{p.text}</span> : p.text));
    }
  }
  if (!rtl) return text;
  const parts = text.split(LATIN_RUN);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? <bdi key={`${keyBase}-${i}`} lang="en">{part}</bdi> : part,
  );
}

/** Plain dictionary string with no mini-markup, rendered so that real plugin-admin labels get their lang="en" leaf (es, ru). Use for headings, table cells and paragraphs that name labels. */
export function Lb({ text, locale }: { text: string; locale: Locale }): ReactNode {
  return <>{isolate(text, false, "lb", locale)}</>;
}

const TOKEN_RE = /(\*\*[^*]+\*\*|\[[^\]]+\]\((?:route:[a-z-]+|https?:\/\/[^)]+)\)|\{[A-Za-z0-9]+\})/g;

export function Rich({ text, ctx }: { text: string; ctx: RichCtx }): ReactNode {
  const rtl = LOCALE_META[ctx.locale].dir === "rtl";
  const pieces = text.split(TOKEN_RE);
  // Several prices in one sentence say "(USD)" once, after the last one (ru: "Solo $99, Studio $199, Agency $499 (USD)").
  const lastPrice = pieces.reduce((acc, p, i) => (/^\{price(Solo|Studio|Agency)\}$/.test(p) ? i : acc), -1);
  return (
    <>
      {pieces.map((piece, i) => {
        if (!piece) return null;
        const key = `r${i}`;
        if (piece.startsWith("**") && piece.endsWith("**")) {
          return <strong key={key}>{isolate(piece.slice(2, -2), rtl, key, ctx.locale)}</strong>;
        }
        const link = /^\[([^\]]+)\]\((route:[a-z-]+|https?:\/\/[^)]+)\)$/.exec(piece);
        if (link) {
          const [, label, target] = link;
          if (target.startsWith("route:")) {
            const id = target.slice(6);
            if (isRouteId(id)) {
              return (
                <Link key={key} href={localePath(ctx.locale, id)} className="aicc-link">
                  {isolate(label, rtl, key, ctx.locale)}
                </Link>
              );
            }
          }
          return (
            <a key={key} href={target} className="aicc-link" rel="noopener noreferrer">
              {isolate(label, rtl, key, ctx.locale)}
            </a>
          );
        }
        const tok = /^\{([A-Za-z0-9]+)\}$/.exec(piece);
        if (tok) {
          const r = resolveToken(tok[1], ctx, i === lastPrice);
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
        return <Fragment key={key}>{isolate(piece, rtl, key, ctx.locale)}</Fragment>;
      })}
    </>
  );
}

/** Plain-string version for <title>, meta descriptions, aria-labels and JSON-LD. */
export function formatPlain(text: string, ctx: RichCtx): string {
  const flat = text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\((?:route:[a-z-]+|https?:\/\/[^)]+)\)/g, "$1");
  const lastPriceAt = Math.max(-1, ...[...flat.matchAll(/\{price(?:Solo|Studio|Agency)\}/g)].map((x) => x.index ?? -1));
  return flat.replace(/\{([A-Za-z0-9]+)\}/g, (m, name: string, offset: number) => {
    const r = resolveToken(name, ctx, offset === lastPriceAt);
    if (!r) return m;
    return r.pending ? ctx.t.pending[r.pending] : r.text;
  });
}
