import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { txProps } from "@/i18n";
import { Rich, type RichCtx } from "@/lib/rich";
import { EA_MAIL_PROVIDER, EA_MAIL_PROVIDER_PLACEHOLDER, EA_VERIFY, EA_END_UTC_MS } from "@/lib/earlyAccess";
import { Container, Section } from "@/components/ui/Primitives";
import { PageHead } from "@/components/pages/shared";
import { RequestForm } from "./RequestForm";
import { RequestConfirm } from "./RequestConfirm";

/**
 * The two pages of the request flow (/request-access/ and /request-access/confirm/). They exist only in an OPEN launch-offer build (src/lib/routes.ts) and are never indexed.
 * Their few styles are inline (not in aicc.css) so that a build without these pages is byte-identical to the build before they existed.
 */
const REQUEST_CSS = `
.aicc-req{display:grid;gap:var(--aicc-space-5);max-inline-size:40rem}
.aicc-req .aicc-field__control{max-inline-size:100%}
.aicc-req__checks{display:grid;gap:var(--aicc-space-2)}
.aicc-req__check{display:flex;gap:.75rem;align-items:flex-start;min-block-size:44px;padding-block:.6rem;cursor:pointer}
.aicc-req__check input{inline-size:1.5rem;block-size:1.5rem;flex:none;margin:0;accent-color:var(--aicc-primary-strong)}
.aicc-req__check input:focus-visible{outline:2px solid var(--aicc-focus);outline-offset:2px}
.aicc-req__hp{position:absolute;inset-inline-start:-10000px;inline-size:1px;block-size:1px;overflow:hidden}
.aicc-req__notice{padding:var(--aicc-space-4);border:1px solid var(--aicc-border);border-radius:var(--aicc-radius-md);background:var(--aicc-surface-sunken);font-size:var(--aicc-text-sm);color:var(--aicc-text)}
.aicc-req__summary{display:flex;gap:.6rem;align-items:flex-start;padding:var(--aicc-space-4);border:1.5px solid var(--aicc-danger);border-radius:var(--aicc-radius-md);background:var(--aicc-danger-bg);color:var(--aicc-danger)}
.aicc-req__summary ul{margin:.25rem 0 0;padding-inline-start:1.25rem}
.aicc-req__summary a{color:inherit;text-decoration:underline;display:inline-block;min-block-size:24px}
.aicc-req__live{min-block-size:1.5rem;font-weight:600}
.aicc-req__botlabel{font-weight:650;font-size:var(--aicc-text-sm);margin:0 0 .5rem}
.aicc-req__state{max-inline-size:40rem;display:grid;gap:var(--aicc-space-4)}
.aicc-req__state:focus{outline:2px solid var(--aicc-focus);outline-offset:2px}
.aicc-req select.aicc-field__control{padding-inline:var(--aicc-space-3)}
.aicc-req__verify{background:var(--aicc-warning-bg);color:var(--aicc-warning);border-block-end:1px solid var(--aicc-warning);padding:.75rem 0;font-weight:650;text-align:center}
`;

/** VERIFY builds only: the unlisted verification page says so at the top of the page (no dashes, four languages). */
function VerifyBanner({ text }: { text: string }) {
  if (!EA_VERIFY) return null;
  return <div className="aicc-req__verify" role="status" data-req-verify><Container>{text}</Container></div>;
}

function Styles() { return <style dangerouslySetInnerHTML={{ __html: REQUEST_CSS }} />; }

export function RequestAccessPage({ locale, t }: { locale: Locale; t: Dictionary }) {
  const r = t.ea.request;
  const tx = txProps(locale, "ea.request");
  const provider = EA_MAIL_PROVIDER || EA_MAIL_PROVIDER_PLACEHOLDER[locale];
  const ctx: RichCtx = { locale, t };
  const noticeCtx: RichCtx = { locale, t, vars: { mailProvider: provider } };
  const names = t.pricing.plans;
  return (
    <>
      <Styles />
      <div {...tx}>
        <VerifyBanner text={r.verifyBanner} />
        <PageHead locale={locale} t={t} pageName={r.pageTitle} title={r.title} lead={<Rich text={r.lead} ctx={ctx} />} />
        <Section tone="surface" labelledBy="req-title">
          <Container narrow>
            <h2 id="req-title" className="aicc-sr-only">{r.formLabel}</h2>
            <RequestForm
              locale={locale}
              endMs={EA_END_UTC_MS}
              ended={{ title: t.ea.after.title, body: t.ea.after.body }}
              consent={<Rich text={r.consent} ctx={ctx} />}
              notice={<Rich text={r.notice} ctx={noticeCtx} />}
              s={{
                checking: r.checking, closedTitle: r.closedTitle, closedBody: r.closedBody, formLabel: r.formLabel,
                email: r.email, emailHint: r.emailHint, store: r.store, storeHint: r.storeHint, plan: r.plan, operator: r.operator, submit: r.submit, sending: r.sending,
                success: r.success, successHint: r.successHint,
                errorGeneric: r.errorGeneric, errorBusy: r.errorBusy, errorBot: r.errorBot, errorTooBig: r.errorTooBig, errorNetwork: r.errorNetwork, retry: r.retry,
                fieldRequired: r.fieldRequired, emailInvalid: r.emailInvalid, storeInvalid: r.storeInvalid, checkRequired: r.checkRequired, summary: r.summary,
                botLabel: r.botLabel, botFailed: r.botFailed, noticeLabel: r.noticeLabel,
                plans: { solo: names.solo.name, studio: names.studio.name, agency: names.agency.name },
              }}
            />
            <noscript><p className="aicc-muted" style={{ marginBlockStart: "1rem" }}>{r.closedBody}</p></noscript>
          </Container>
        </Section>
      </div>
    </>
  );
}

export function RequestConfirmPage({ locale, t }: { locale: Locale; t: Dictionary }) {
  const r = t.ea.request;
  const c = r.confirm;
  const tx = txProps(locale, "ea.request");
  return (
    <>
      <Styles />
      <div {...tx}>
        <VerifyBanner text={r.verifyBanner} />
        <PageHead locale={locale} t={t} pageName={c.pageTitle} title={c.title} />
        <Section tone="surface" labelledBy="req-confirm-title">
          <Container narrow>
            <h2 id="req-confirm-title" className="aicc-sr-only">{c.title}</h2>
            <RequestConfirm s={{ lead: c.lead, button: c.button, working: c.working, outcome: c.outcome, error: c.error, unavailable: c.unavailable, noLink: c.noLink }} />
            <noscript><p className="aicc-muted" style={{ marginBlockStart: "1rem" }}>{c.noLink}</p></noscript>
          </Container>
        </Section>
      </div>
    </>
  );
}
