"use client";
import { useState } from "react";
import { FormField, Badge } from "@/components/ui/Primitives";
import { PLANS } from "@/data/plans";
import { Check } from "lucide-react";
import type { SsInitial, SsLabelKey } from "@/lib/ssStatus";
import { SsCta } from "./SsCta";

/**
 * P37: the "Which plan?" finder of a self-service build. Same behaviour as src/components/home/PlanFinder.tsx (which stays untouched so every other build is byte-identical), but the result action is the
 * self-service button (a link to the sign-up page for the suggested plan, state-aware) instead of the inert "Purchases open soon" chip.
 */
export interface SsPlanFinderStrings {
  label: string;
  hint: string;
  error: string;
  many: string;
  empty: string;
  suggestion: string;
  results: { solo: string; studio: string; agency: string };
  names: { solo: string; studio: string; agency: string };
}

/** The trial facts shown with the suggested plan (the same strings as the plan card: one store, no payment method, no automatic conversion, the two labelled dates). */
export interface SsPlanFinderFacts { trial: string; noPayment: string; noAuto: string; datesLabel: string; regLabel: string; regValue: string; endLabel: string; endValue: string; lang?: string; dir?: "ltr" | "rtl" }

export function SsPlanFinder({ s, hrefs, labels, initial, facts, lang, dir }: { s: SsPlanFinderStrings; hrefs: Record<"solo" | "studio" | "agency", string>; labels: Record<SsLabelKey, string>; initial: SsInitial; facts: SsPlanFinderFacts; lang?: string; dir?: "ltr" | "rtl" }) {
  const [raw, setRaw] = useState("");
  const [touched, setTouched] = useState(false);
  const n = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  const valid = Number.isInteger(n) && n >= 1 && n <= 10;
  const tooMany = /^\d+$/.test(raw.trim()) && n > 10;
  const error = raw.trim() !== "" && !valid ? (tooMany ? s.many : s.error) : touched && raw.trim() === "" ? s.error : undefined;
  const plan = valid ? PLANS.find((p) => n <= p.stores)! : null;
  return (
    <form className="aicc-card" lang={lang} dir={dir} onSubmit={(e) => { e.preventDefault(); setTouched(true); }} noValidate>
      <div style={{ display: "grid", gap: "1rem" }}>
        <FormField id="plan-stores" label={s.label} hint={s.hint} error={error}>
          {(a) => (<input {...a} type="text" inputMode="numeric" autoComplete="off" value={raw} onChange={(e) => setRaw(e.target.value)} />)}
        </FormField>
        <div aria-live="polite" style={{ minBlockSize: "3.5rem" }}>
          {plan ? (
            <div style={{ display: "grid", gap: "0.75rem", justifyItems: "start" }}>
              <p>
                <Badge tone="success">{s.suggestion}</Badge>{" "}
                <strong>{s.results[plan.id]}</strong>
              </p>
              <div lang={facts.lang} dir={facts.dir} data-ss-finder-facts style={{ display: "grid", gap: "0.75rem", justifyItems: "start", inlineSize: "100%" }}>
                <ul className="aicc-plan__checks" style={{ display: "grid", gap: "0.375rem", margin: 0, padding: 0, listStyle: "none" }}>
                  {[facts.trial, facts.noPayment, facts.noAuto].map((x) => (<li key={x} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}><Check size={16} aria-hidden="true" /><span>{x}</span></li>))}
                </ul>
                <div role="group" aria-label={facts.datesLabel} style={{ inlineSize: "100%" }}>
                  <dl className="aicc-ssdates" data-ss-dates>
                    <div data-ss-date="registration"><dt>{facts.regLabel}</dt><dd><bdi>{facts.regValue}</bdi></dd></div>
                    <div data-ss-date="end"><dt>{facts.endLabel}</dt><dd><bdi>{facts.endValue}</bdi></dd></div>
                  </dl>
                </div>
              </div>
              <SsCta href={hrefs[plan.id]} initial={initial} labels={labels} variant="primary" size="md" srName={s.names[plan.id]} />
            </div>
          ) : (
            <p className="aicc-muted aicc-small">{error ? "" : s.empty}</p>
          )}
        </div>
      </div>
    </form>
  );
}
