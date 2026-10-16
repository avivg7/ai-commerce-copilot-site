"use client";
import { useState } from "react";
import { FormField, Badge } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { PLANS } from "@/data/plans";
import { planUrl } from "@/lib/site";

export interface PlanFinderStrings {
  label: string;
  hint: string;
  error: string;
  empty: string;
  suggestion: string;
  results: { solo: string; studio: string; agency: string };
  names: { solo: string; studio: string; agency: string };
  choose: string; // already contains the plan name placeholder {plan}
}

/** Tiny helper: how many stores -> which plan. Validates on blur/submit, error tied to the field with aria-describedby. */
export function PlanFinder({ s }: { s: PlanFinderStrings }) {
  const [raw, setRaw] = useState("");
  const [touched, setTouched] = useState(false);
  const n = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  const valid = Number.isInteger(n) && n >= 1 && n <= 10;
  const error = touched && raw.trim() !== "" && !valid ? s.error : touched && raw.trim() === "" ? s.error : undefined;
  const plan = valid ? PLANS.find((p) => n <= p.stores)! : null;

  return (
    <form
      className="aicc-card"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
      }}
      noValidate
    >
      <div style={{ display: "grid", gap: "1rem" }}>
        <FormField id="plan-stores" label={s.label} hint={s.hint} error={error}>
          {(a) => (
            <input
              {...a}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onBlur={() => setTouched(true)}
            />
          )}
        </FormField>
        <div aria-live="polite" style={{ minBlockSize: "3.5rem" }}>
          {plan ? (
            <div style={{ display: "grid", gap: "0.75rem", justifyItems: "start" }}>
              <p>
                <Badge tone="success">{s.suggestion}</Badge>{" "}
                <strong>{s.results[plan.id]}</strong>
              </p>
              <Button href={planUrl(plan.id)} variant="primary">
                {s.choose.replace("{plan}", s.names[plan.id])}
              </Button>
            </div>
          ) : (
            <p className="aicc-muted aicc-small">{error ? "" : s.empty}</p>
          )}
        </div>
      </div>
    </form>
  );
}
