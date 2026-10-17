import type { Locale } from "@/i18n/config";
import { LOCALE_META } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { isFallback } from "@/i18n";
import { kitAsset } from "@/lib/brand";
import { kitStrings } from "@/lib/kit-strings";
import { renderDashPreviewHTML, renderInsightsHTML } from "../../../brand/js/dash-preview.js";
import { renderRecoAskHTML } from "../../../brand/js/reco-ask.js";
import { renderFlowHTML } from "../../../brand/js/flow.js";
import { renderLoopHTML } from "../../../brand/js/loop.js";

/** Interactive rules illustration (kit module brand/js/rules-demo.js, mounted by initBrand when it nears the viewport). */
export function RulesDemo({ locale, t }: { locale: Locale; t: Dictionary }) {
  const fb = isFallback(locale, "rules");
  return (
    <div
      className="aicc-rules aicc-rules--placeholder"
      data-aicc-rules
      data-locale={locale}
      data-dir={fb ? "ltr" : LOCALE_META[locale].dir}
      data-strings={JSON.stringify(kitStrings(locale, t, "rules"))}
      aria-busy="true"
    >
      <p className="aicc-rules__label">{t.rules.label}</p>
    </div>
  );
}

/** Dashboard replica with the real labels; sample data, server-rendered from the kit markup. */
export function DashPreview({ locale, t, variant = "compact", widget = false, callouts = true }: { locale: Locale; t: Dictionary; variant?: "compact" | "full"; widget?: boolean; callouts?: boolean }) {
  const html = renderDashPreviewHTML(kitStrings(locale, t, "dash"), { locale, dir: LOCALE_META[locale].dir, variant, widget, callouts });
  return <div data-aicc-dash data-aicc-ssr dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Ask Reco panel mockup (sample questions); the two question buttons are wired by initBrand. */
export function RecoAskPanel({ locale, t }: { locale: Locale; t: Dictionary }) {
  const html = renderRecoAskHTML(kitStrings(locale, t, "ask"), { assetsBase: kitAsset("").replace(/\/$/, ""), locale, dir: LOCALE_META[locale].dir });
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Safety flow diagram: kit markup (.aicc-flow) rendered from the shared words (flows.*) or from custom steps. */
export function Flow({ locale, t, kind, flow, unit }: { locale: Locale; t: Dictionary; kind: "order" | "down" | "inactive" | "measure" | "history"; flow?: { title: string; steps: string[]; note?: string }; unit?: string }) {
  const data = flow ?? (t.flows as unknown as Record<string, { title: string; steps: string[]; note?: string }>)[kind];
  const fallback = isFallback(locale, flow ? (unit ?? "flows") : "flows"); // custom steps say which dictionary unit they come from
  return <div dangerouslySetInnerHTML={{ __html: renderFlowHTML(data, kind, { fallback, locale, dir: LOCALE_META[locale].dir }) }} />;
}

/** The four kinds of Merchant Insights as sample cards (kit renderer; "Find opportunities" tab). */
export function InsightsPreview({ locale, t }: { locale: Locale; t: Dictionary }) {
  return <div dangerouslySetInnerHTML={{ __html: renderInsightsHTML(kitStrings(locale, t, "dash"), { locale, dir: LOCALE_META[locale].dir }) }} />;
}

/** The merchandising loop as one strip (kit markup .aicc-loop). `links` are the in-page targets of the seven steps. */
export function Loop({ locale, t, links }: { locale: Locale; t: Dictionary; links: (string | { href: string; tab?: string })[] }) {
  return <div dangerouslySetInnerHTML={{ __html: renderLoopHTML(kitStrings(locale, t, "loop"), { links, locale, dir: LOCALE_META[locale].dir }) }} />;
}
