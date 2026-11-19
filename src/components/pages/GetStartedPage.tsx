import type { ReactNode } from "react";
import { Check, Sparkles, Store, UserRound } from "lucide-react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { txProps } from "@/i18n";
import { PLANS, type PlanId } from "@/data/plans";
import { SS_INITIAL, journeyUrl, startUrl } from "@/lib/selfService";
import { localePath } from "@/lib/routes";
import { COMMERCE_OPEN, withBase } from "@/lib/site";
import { Container, Section } from "@/components/ui/Primitives";
import { RecoImage } from "@/components/ui/RecoImage";
import { PageHead } from "./shared";

/**
 * P41: the journey page `/get-started/` (+ /he /es /ru): the REAL journey from "Choose a plan" to "your dashboard shows where you are", in nine steps, grounded in what the product actually does (Control Plane sign-up and account,
 * the plugin's secure pairing, the Backend's confirmations). Static, data-free server HTML plus two small client islands (the plan chips and the state-aware action: src/components/ss/SsJourney.tsx). It exists only in a
 * self-service build (src/lib/requestRoutes.ts) and needs NO edge change: the edge sends only the WordPress pages to WordPress; every other path is this static export.
 * Truth rules: it says that registration is not open while it is not (the action is then the working Live Demo and See pricing, never a link to /start/ and never a fake sign-up); it opens the real flow
 * (`/<lang>/start/?plan=<plan>`) by itself when the status route says open or waitlist; it carries `?plan=` through (validated: solo | studio | agency, everything else ignored). Dates are written ONCE on the page, from the
 * single build-time source (the pack tokens, src/i18n/eaTokens.ts), in the trial terms block. he / es / ru are machine drafts.
 */
const A = (locale: Locale, path: string) => { const { lang, dir } = txProps(locale, path); return { lang, dir }; };

export const JOURNEY_CSS = [
  ".aicc-jr{display:grid;grid-template-columns:minmax(0,1fr);gap:2.5rem;align-items:start}",
  ".aicc-jr :where(h2,h3,p,ul,ol,dl,dd){margin:0;padding:0}",
  ".aicc-jr :where(ul,ol){list-style:none}",
  ".aicc-jr :where(div,p,span,li,a,h2,h3){min-inline-size:0}",
  ".aicc-jr{overflow-wrap:break-word}",
  "@media (min-width:62rem){.aicc-jr{grid-template-columns:minmax(0,1.45fr) minmax(0,1fr);column-gap:4rem}.aicc-jr__aside{grid-column:2;grid-row:1}.aicc-jr__steps{grid-column:1;grid-row:1}}",
  // the aside (status panel + terms, about 50rem tall) sticks ONLY when the viewport is tall enough to show all of it below the header, so no line of it (the trial end date) is cut off while scrolling (WCAG 1.4.10 / 2.4.11)
  "@media (min-width:62rem) and (min-height:68rem){.aicc-jr__aside{position:sticky;inset-block-start:calc(var(--aicc-header-h) + 1.5rem)}}",
  // the status panel (dark, like the closing bands): the honest state, the next useful step
  ".aicc-jr__aside{display:grid;gap:1.25rem}",
  ".aicc-jr__act{position:relative;overflow:hidden;padding:min(1.5rem,5vw);border-radius:var(--aicc-radius-xl);background:var(--aicc-surface-inverse);color:var(--aicc-text-inverse);box-shadow:var(--aicc-shadow-lg)}",
  ".aicc-jr__act-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0.75rem;align-items:start}",
  ".aicc-jr__act-title{font-size:var(--aicc-text-sm);font-weight:650;line-height:1.3;color:var(--aicc-text-inverse-muted)}",
  ".aicc-jr__reco{display:block;inline-size:4.75rem;block-size:auto;margin-block:-0.5rem -0.25rem}",
  ".aicc-jr__act-body{display:grid;gap:0.875rem;margin-block-start:0.5rem}",
  ".aicc-jr__state{display:flex;align-items:flex-start;gap:0.75rem;font-size:var(--aicc-text-lg);font-weight:700;line-height:1.3;letter-spacing:-0.01em;text-wrap:balance}",
  ".aicc-jr__state-icon{display:inline-flex;flex:none;align-items:center;justify-content:center;inline-size:2.25rem;block-size:2.25rem;border-radius:50%;background:rgb(255 255 255 / 0.1);color:var(--aicc-focus-on-dark)}",
  ".aicc-jr__act-text{font-size:var(--aicc-text-sm);line-height:1.55;color:var(--aicc-text-inverse-muted);text-wrap:pretty}",
  ".aicc-jr__actions{display:grid;gap:0.75rem;margin-block-start:0.25rem}",
  ".aicc-jr__actions .aicc-btn{white-space:normal;text-align:center;border-radius:min(var(--aicc-radius-pill),1.75rem)}",
  // the free trial at a glance (dates ONCE on the page)
  ".aicc-jr__terms{padding:min(1.5rem,5vw);border:1px solid var(--aicc-border);border-radius:var(--aicc-radius-xl);background:var(--aicc-surface);box-shadow:var(--aicc-shadow-sm)}",
  ".aicc-jr__terms-title{font-size:var(--aicc-text-lg);font-weight:700;line-height:1.25;letter-spacing:-0.01em;color:var(--aicc-text)}",
  ".aicc-jr__facts{display:grid;gap:0.875rem;margin-block-start:1rem}",
  ".aicc-jr__fact{display:flex;align-items:flex-start;gap:0.75rem;font-size:var(--aicc-text-sm);line-height:1.45;color:var(--aicc-text)}",
  ".aicc-jr__fact-icon{display:inline-flex;flex:none;align-items:center;justify-content:center;inline-size:2rem;block-size:2rem;border-radius:50%;background:var(--aicc-success-bg);color:var(--aicc-success)}",
  ".aicc-jr__fact-icon .aicc-cap--trial{grid-template-columns:1rem;inline-size:1rem}",
  ".aicc-jr__fact>span:last-child{padding-block-start:0.28rem}",
  ".aicc-jr__terms-note{margin-block-start:1rem;font-size:var(--aicc-text-sm);line-height:1.5;color:var(--aicc-text-muted);text-wrap:pretty}",
  ".aicc-jr__dates{display:grid;gap:0.875rem;margin-block-start:1.25rem;padding-block-start:1.25rem;border-block-start:1px solid var(--aicc-border)}",
  ".aicc-jr__date dt{font-size:var(--aicc-text-sm);font-weight:600;line-height:1.35;color:var(--aicc-text-muted)}",
  ".aicc-jr__date dd{font-size:1.125rem;font-weight:700;line-height:1.3;font-variant-numeric:tabular-nums;color:var(--aicc-text);text-wrap:balance}",
  "html[data-ss-closed] .aicc-jr__terms{display:none}",
  // the nine steps: a real sequence (numbered, joined by a rail), in three phases
  ".aicc-jr__steps>section+section{margin-block-start:2.5rem}",
  ".aicc-jr__phase>span:last-child{min-inline-size:0;overflow-wrap:anywhere}",
  ".aicc-jr__phase{display:flex;align-items:center;gap:0.75rem;margin-block-end:1.25rem;font-size:var(--aicc-text-xl);font-weight:700;line-height:1.2;letter-spacing:-0.01em;color:var(--aicc-text)}",
  ".aicc-jr__phase-icon{display:inline-flex;flex:none;align-items:center;justify-content:center;inline-size:2.5rem;block-size:2.5rem;border-radius:0.875rem;background:var(--aicc-info-bg);color:var(--jr-ink)}",
  "[data-jr-phase=account]{--jr-ink:var(--aicc-primary-strong)}[data-jr-phase=store]{--jr-ink:var(--aicc-navy-900)}[data-jr-phase=recs]{--jr-ink:var(--aicc-success)}",
  "[data-jr-phase=recs] .aicc-jr__phase-icon{background:var(--aicc-success-bg)}[data-jr-phase=store] .aicc-jr__phase-icon{background:var(--aicc-surface-sunken)}",
  ".aicc-jr{--jr-node:min(2.5rem,10.5vw);--jr-gap:min(1rem,4vw)}",
  "@media (max-width:22.5rem){.aicc-jr{--jr-node:min(2rem,9vw);--jr-gap:min(0.625rem,3vw)}.aicc-jr__step-title{font-size:1.125rem}}",
  ".aicc-jr__list{display:grid}",
  ".aicc-jr__step{position:relative;counter-increment:jr;padding-inline-start:calc(var(--jr-node) + var(--jr-gap));padding-block-end:1.75rem}",
  ".aicc-jr__step:last-child{padding-block-end:0}",
  ".aicc-jr__step::before{content:counter(jr);position:absolute;inset-block-start:0;inset-inline-start:0;display:grid;place-items:center;inline-size:var(--jr-node);block-size:var(--jr-node);border:2px solid var(--jr-ink);border-radius:50%;background:var(--aicc-surface);color:var(--jr-ink);font-size:min(1rem,calc(var(--jr-node) * 0.42));font-weight:700;font-variant-numeric:tabular-nums;line-height:1}",
  ".aicc-jr__step::after{content:\"\";position:absolute;inset-inline-start:calc(var(--jr-node) / 2 - 1px);inset-block:calc(var(--jr-node) + 0.25rem) 0.25rem;border-inline-start:2px solid var(--aicc-border-strong)}",
  ".aicc-jr__step:last-child::after{display:none}",
  ".aicc-jr__step-title{hyphens:manual;overflow-wrap:anywhere;padding-block-start:0.4rem;font-size:var(--aicc-text-lg);font-weight:650;line-height:1.25;letter-spacing:-0.005em;color:var(--aicc-text)}",
  ".aicc-jr__step-body{margin-block-start:0.375rem;max-inline-size:38rem;font-size:var(--aicc-text-base);line-height:1.6;color:var(--aicc-text-muted);text-wrap:pretty}",
  ".aicc-jr__path{display:inline-block;padding:0.0625rem 0.5rem;border:1px solid var(--aicc-border-strong);border-radius:0.5rem;background:var(--aicc-surface-sunken);font-weight:650;color:var(--aicc-text);white-space:normal;max-inline-size:100%;overflow-wrap:anywhere}",
  // plan preference chips (step 1)
  ".aicc-jr__plan{margin-block-start:0.875rem}",
  ".aicc-jr__chips{display:flex;flex-wrap:wrap;gap:0.5rem}",
  ".aicc-jr__chips li{min-inline-size:0;max-inline-size:100%}",
  ".aicc-jr__chip{display:inline-flex;align-items:center;gap:0.5rem;max-inline-size:100%;overflow-wrap:anywhere;min-block-size:2.75rem;padding:0.5rem min(1.125rem,3.5vw);border:1.5px solid var(--aicc-border-strong);border-radius:var(--aicc-radius-pill);background:var(--aicc-surface);font-size:var(--aicc-text-sm);font-weight:650;color:var(--aicc-text);text-decoration:none;transition:border-color var(--aicc-dur) var(--aicc-ease),background-color var(--aicc-dur) var(--aicc-ease)}",
  ".aicc-jr__chip:hover{border-color:var(--aicc-primary-strong);background:var(--aicc-info-bg)}",
  ".aicc-jr__chip:focus-visible{outline:2px solid var(--aicc-focus);outline-offset:2px}",
  ".aicc-jr__chip[aria-current=true]{border-color:var(--aicc-primary-strong);background:var(--aicc-primary-strong);color:#fff}",
  ".aicc-jr__chip[aria-current=true]::before{content:\"\";inline-size:0.375rem;block-size:0.625rem;margin-inline-end:0.125rem;border-inline-end:2.5px solid currentColor;border-block-end:2.5px solid currentColor;transform:rotate(45deg) translateY(-1px)}",
  ".aicc-jr__hint{margin-block-start:0.625rem;font-size:var(--aicc-text-sm);line-height:1.5;color:var(--aicc-text-muted)}",
  ":root[data-aicc-contrast=high] .aicc-jr__terms,:root[data-aicc-contrast=high] .aicc-jr__chip{border-color:var(--aicc-text)}",
  "@media (forced-colors:active){.aicc-jr__act,.aicc-jr__terms{border:1px solid CanvasText}.aicc-jr__chip{border:1px solid ButtonText}.aicc-jr__chip[aria-current=true]{border:3px solid Highlight}.aicc-jr__step::before{border-color:CanvasText}.aicc-jr__step::after{border-color:CanvasText}}",
].join("");

const PHASES = [
  { id: "account", icon: UserRound, steps: [1, 2, 3] },
  { id: "store", icon: Store, steps: [4, 5, 6] },
  { id: "recs", icon: Sparkles, steps: [7, 8, 9] },
] as const;

/** Step body text with its `{path}` token replaced by the WordPress menu path, left-to-right isolated (it is a literal UI path: it must read the same inside Hebrew text). */
function withPath(text: string, path: string): ReactNode {
  const parts = text.split("{path}");
  if (parts.length === 1) return text;
  // a word joiner keeps the punctuation that follows the chip ON the chip's last line (no orphan ", ..." line at 320 px)
  return <>{parts[0]}<bdi dir="ltr" className="aicc-jr__path">{path}</bdi>{/^[,.;:]/.test(parts[1]) ? "\u2060" : ""}{parts[1]}</>;
}

export async function GetStartedPage({ locale, t }: { locale: Locale; t: Dictionary }) {
  const e = t.ea;
  const j = e.journey;
  const ss = e.ss;
  const { SsJourneyPlan, SsJourneyAction } = await import("@/components/ss/SsJourney");
  const names = { solo: t.pricing.plans.solo.name, studio: t.pricing.plans.studio.name, agency: t.pricing.plans.agency.name };
  const chipHrefs = { solo: journeyUrl(locale, "solo"), studio: journeyUrl(locale, "studio"), agency: journeyUrl(locale, "agency") };
  const startHrefs = { none: startUrl(locale), solo: startUrl(locale, "solo"), studio: startUrl(locale, "studio"), agency: startUrl(locale, "agency") };
  const demoHref = withBase(`${localePath(locale)}#demo`);
  const pricingHref = withBase(localePath(locale, "pricing"));
  const fact = (icon: ReactNode, text: string) => (<li className="aicc-jr__fact" key={text}><span className="aicc-jr__fact-icon" aria-hidden="true">{icon}</span><span>{text}</span></li>);
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: JOURNEY_CSS }} />
      <PageHead locale={locale} t={t} pageName={t.common.getStarted} title={<span {...A(locale, "ea.journey")}>{j.title}</span>} lead={<span {...A(locale, "ea.journey")}>{j.lead}</span>} />
      <Section tone="surface">
        <Container>
          <div className="aicc-jr" {...A(locale, "ea.journey")}>
            <aside className="aicc-jr__aside" aria-label={j.asideLabel}>
              <section className="aicc-jr__act aicc-on-dark" aria-labelledby="jr-act-title" data-jr-panel>
                <div className="aicc-jr__act-top">
                  <h2 className="aicc-jr__act-title" id="jr-act-title">{j.act.title}</h2>
                  <RecoImage pose="thinking" className="aicc-jr__reco" displayWidth={76} />
                </div>
                <SsJourneyAction
                  strings={{ soon: ss.state.line.soon, paused: ss.state.line.paused, open: ss.state.line.open, waitlist: ss.state.line.waitlist, closed: ss.state.closedPaidNote, waitBody: j.act.waitBody, openBody: j.act.openBody, closedBody: j.act.closedBody, start: ss.cta.start, joinWaitlist: ss.cta.waitlist, demo: ss.state.demo, pricing: j.act.pricing }}
                  initial={SS_INITIAL}
                  startHrefs={startHrefs}
                  demoHref={demoHref}
                  pricingHref={pricingHref}
                  {...A(locale, "ea.journey")}
                />
              </section>
              <section className="aicc-jr__terms" aria-labelledby="jr-terms-title" data-jr-terms>
                <h2 className="aicc-jr__terms-title" id="jr-terms-title">{j.terms.title}</h2>
                <ul className="aicc-jr__facts" role="list" aria-label={ss.terms.label}>
                  {fact(<span className="aicc-cap aicc-cap--trial"><span className="aicc-cap__slot aicc-cap__slot--on" /></span>, ss.launch.fact.store)}
                  {fact(<Check size={18} focusable="false" />, ss.launch.fact.payment)}
                  {fact(<Check size={18} focusable="false" />, ss.launch.fact.noAuto)}
                </ul>
                <dl className="aicc-jr__dates" aria-label={ss.plan.datesLabel} data-ss-dates>
                  <div className="aicc-jr__date" data-ss-date="registration"><dt>{ss.plan.regLabel}</dt><dd>{ss.plan.regValue}</dd></div>
                  <div className="aicc-jr__date" data-ss-date="end"><dt>{ss.plan.endLabel}</dt><dd>{ss.plan.endValue}</dd></div>
                </dl>
                <p className="aicc-jr__terms-note" data-jr-end>{j.terms.end}</p>
                <p className="aicc-jr__terms-note" data-jr-paid>{COMMERCE_OPEN ? ss.launch.foot.paidOpen : ss.launch.foot.paid}</p>
              </section>
            </aside>
            <div className="aicc-jr__steps" data-jr-steps>
              {PHASES.map((ph) => {
                const Icon = ph.icon;
                const id = `jr-phase-${ph.id}`;
                return (
                  <section key={ph.id} aria-labelledby={id} data-jr-phase={ph.id}>
                    <h2 className="aicc-jr__phase" id={id}><span className="aicc-jr__phase-icon" aria-hidden="true"><Icon size={20} focusable="false" /></span><span>{j.phase[ph.id]}</span></h2>
                    <ol className="aicc-jr__list" role="list" start={ph.steps[0]} style={{ counterReset: `jr ${ph.steps[0] - 1}` }}>
                      {ph.steps.map((n) => {
                        const k = `s${n}` as keyof typeof j.steps;
                        return (
                          <li key={n} className="aicc-jr__step" data-jr-step={n}>
                            <h3 className="aicc-jr__step-title">{j.steps[k].t}</h3>
                            <p className="aicc-jr__step-body">{withPath(j.steps[k].b, j.path)}</p>
                            {n === 1 ? <SsJourneyPlan plans={PLANS.map((p) => ({ id: p.id as PlanId, name: names[p.id] }))} label={j.plan.label} hint={j.plan.hint} hrefs={chipHrefs} /> : null}
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                );
              })}
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
