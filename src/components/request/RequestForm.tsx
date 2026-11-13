"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { FormField } from "@/components/ui/Primitives";
import { fetchStatus, postCreate, TURNSTILE_SRC } from "./api";

type PlanId = "solo" | "studio" | "agency";
type TurnstileApi = {
  render: (el: HTMLElement, o: { sitekey: string; action?: string; callback: (t: string) => void; "error-callback": () => void; "expired-callback": () => void; language?: string }) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

export interface RequestFormStrings {
  checking: string; closedTitle: string; closedBody: string; formLabel: string;
  email: string; emailHint: string; store: string; storeHint: string; plan: string; operator: string; submit: string; sending: string;
  success: string; successHint: string;
  errorGeneric: string; errorBusy: string; errorBot: string; errorTooBig: string; errorNetwork: string; retry: string;
  fieldRequired: string; emailInvalid: string; storeInvalid: string; checkRequired: string; summary: string; botLabel: string; botFailed: string; noticeLabel: string;
  plans: Record<PlanId, string>;
}

/** The Control Plane checks the widget action and hostname server-side: the widget is rendered with this action (data-action="request_access"). */
const TURNSTILE_ACTION = "request_access";
/** The form token is valid from 3 s after it was issued (minimum fill time) until 2 h; the page keeps clear of both edges. */
const MIN_FILL_MS = 3200, MAX_TOKEN_AGE_MS = 110 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** The Turnstile script has this long to fire `load`; a script element that never answers is replaced on the visitor's request. */
const TS_LOAD_TIMEOUT_MS = 12000;

type View = "checking" | "closed" | "ended" | "form" | "done";
type Errors = Partial<Record<"email" | "store" | "operator" | "consent", string>>;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
/** An https address with a real host (a dot, no credentials, no spaces). The server validates again and silently; this only helps the visitor. */
function storeOk(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" && u.hostname.includes(".") && !u.username && !u.password && !/\s/.test(v.trim());
  } catch { return false; }
}

/**
 * The request form. It is INERT unless GET /status says open with a site key and a form token (a closed or unreachable API shows one neutral sentence and no form), loads the
 * Cloudflare Turnstile script only after that answer, posts exactly the contract body, and shows only fixed generic texts. No storage, no analytics.
 */
export function RequestForm({ s, locale, consent, notice, endMs, ended }: { s: RequestFormStrings; locale: "en" | "he" | "es" | "ru"; consent: ReactNode; notice: ReactNode; endMs: number; ended: { title: string; body: string } }) {
  const [view, setView] = useState<View>("checking");
  const [email, setEmail] = useState("");
  const [store, setStore] = useState("");
  const [plan, setPlan] = useState<PlanId>("studio");
  const [operator, setOperator] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [botError, setBotError] = useState("");
  const siteKey = useRef("");
  const [formToken, setFormToken] = useState("");
  const tokenAt = useRef(0);
  const [cooldown, setCooldown] = useState(0); // epoch ms until which the server asked us to wait (Retry-After)
  const tsToken = useRef("");
  const tsId = useRef("");
  const tsBox = useRef<HTMLDivElement>(null);
  const hp = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const closedRef = useRef<HTMLDivElement>(null);
  const [tsReady, setTsReady] = useState(false);
  const [tsAttempt, setTsAttempt] = useState(0);
  const [tsFailed, setTsFailed] = useState(false);
  const submitting = useRef(false); // a second submit while one is in flight is ignored even before React re-renders
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. on load: ask the API whether requests are open (nothing else happens before the answer; no third-party script yet)
  useEffect(() => {
    const ac = new AbortController();
    // a page of this build loaded at or after the end instant of the offer is closed without asking anyone (display only: the Control Plane closes the intake on its own clock)
    Promise.resolve(Date.now() >= endMs ? ("ended" as const) : fetchStatus(ac.signal)).then((r) => {
      if (ac.signal.aborted) return;
      if (r === "ended") { setView("ended"); return; }
      const q = new URLSearchParams(window.location.search).get("plan"); // the plan hint of the button that led here (a preselection only)
      if (q === "solo" || q === "studio" || q === "agency") setPlan(q);
      if (r.open) { siteKey.current = r.siteKey; tokenAt.current = Date.now(); setFormToken(r.formToken); setView("form"); } else setView("closed");
    });
    return () => ac.abort();
  }, [endMs]);

  // 2. only after "open": load the Turnstile script (this page only) and render the widget. A script that errors or never fires `load` (blocked, stalled) leaves a neutral message and a retry button.
  useEffect(() => {
    if (view !== "form" || tsReady) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !window.turnstile || !tsBox.current || tsId.current) return;
      tsId.current = window.turnstile.render(tsBox.current, {
        sitekey: siteKey.current,
        action: TURNSTILE_ACTION,
        language: locale,
        callback: (t) => { tsToken.current = t; setBotError(""); setTsFailed(false); },
        "error-callback": () => { tsToken.current = ""; setBotError(s.botFailed); },
        "expired-callback": () => { tsToken.current = ""; },
      });
      setTsReady(true);
    };
    if (window.turnstile) { render(); return () => { cancelled = true; }; }
    let el = document.querySelector<HTMLScriptElement>("script[data-aicc-turnstile]");
    if (!el) {
      el = document.createElement("script");
      // a retry asks for a distinct URL: a browser would otherwise attach the new element to the stalled request of the old one
      el.src = tsAttempt ? `${TURNSTILE_SRC}?retry=${tsAttempt}` : TURNSTILE_SRC;
      el.async = true;
      el.defer = true;
      el.setAttribute("data-aicc-turnstile", "");
      document.head.appendChild(el);
    }
    const fail = () => { if (!cancelled) { setBotError(s.botFailed); setTsFailed(true); } };
    const timer = setTimeout(() => { if (!window.turnstile) fail(); }, TS_LOAD_TIMEOUT_MS);
    const onLoad = () => render();
    el.addEventListener("load", onLoad);
    el.addEventListener("error", fail);
    return () => { cancelled = true; clearTimeout(timer); el?.removeEventListener("load", onLoad); el?.removeEventListener("error", fail); };
  }, [view, tsReady, locale, s.botFailed, tsAttempt]);

  // the cooldown timer never outlives the form
  useEffect(() => () => { if (cooldownTimer.current) clearTimeout(cooldownTimer.current); }, []);

  function retryTurnstile() {
    document.querySelectorAll("script[data-aicc-turnstile]").forEach((x) => x.remove());
    tsId.current = ""; tsToken.current = "";
    setBotError(""); setTsFailed(false); setTsReady(false); setTsAttempt((n) => n + 1);
  }

  useEffect(() => { if (view === "done") doneRef.current?.focus(); if (view === "closed") closedRef.current?.focus({ preventScroll: true }); }, [view]);

  const refresh = useCallback(async (): Promise<string> => {
    // a failed attempt never leaves the visitor with a spent token: ask /status again (a new form token, still bound to the 3 s minimum fill time) and reset the widget
    tsToken.current = "";
    if (window.turnstile && tsId.current) { try { window.turnstile.reset(tsId.current); } catch { /* widget gone */ } }
    const r = await fetchStatus();
    if (r.open) { tokenAt.current = Date.now(); setFormToken(r.formToken); return r.formToken; }
    setView("closed");
    return "";
  }, []);

  function validate(): Errors {
    const e: Errors = {};
    if (!email.trim()) e.email = s.fieldRequired; else if (!EMAIL_RE.test(email.trim()) || email.trim().length > 254) e.email = s.emailInvalid;
    if (!store.trim()) e.store = s.fieldRequired; else if (!storeOk(store) || store.trim().length > 255) e.store = s.storeInvalid;
    if (!operator) e.operator = s.checkRequired;
    if (!agreed) e.consent = s.checkRequired;
    return e;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (busy || submitting.current) return;
    setMessage("");
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => {
        const first = (["email", "store", "operator", "consent"] as const).find((k) => e[k]);
        (first ? document.getElementById(`req-${first}`) : summaryRef.current)?.focus();
      });
      return;
    }
    if (!tsToken.current) { setBotError(s.errorBot); setMessage(s.errorBot); return; }
    if (Date.now() < cooldown) return;
    submitting.current = true;
    setBusy(true);
    // the form token is only accepted from 3 s after it was issued and for 2 h: wait out the minimum fill time (a quick autofill) and replace a token that is about to expire
    if (Date.now() - tokenAt.current > MAX_TOKEN_AGE_MS) {
      await refresh(); // a new form token, and the widget is reset: the visitor solves it again
      submitting.current = false; setBusy(false); setBotError(s.errorBot); setMessage(s.errorBot);
      return;
    }
    const age = Date.now() - tokenAt.current;
    if (age < MIN_FILL_MS) await sleep(MIN_FILL_MS - age);
    const { outcome: out, retryAfter } = await postCreate({
      email: email.trim(), store_url: store.trim(), plan, operator_confirmed: true, terms_accepted: true, lang: locale,
      turnstile_token: tsToken.current, form_token: formToken, website: hp.current?.value ?? "",
    });
    submitting.current = false;
    setBusy(false);
    if (out === "received") {
      // nothing is kept: the fields are cleared and the single neutral sentence replaces the form
      setEmail(""); setStore(""); setOperator(false); setAgreed(false); tsToken.current = "";
      if (window.turnstile && tsId.current) { try { window.turnstile.remove(tsId.current); } catch { /* ignore */ } tsId.current = ""; }
      setView("done");
      return;
    }
    if (out === "closed") { setView("closed"); return; }
    if (out === "busy" && retryAfter > 0) { // honour Retry-After: the button stays disabled until the server's time has passed (no timer is shown)
      const until = Date.now() + retryAfter * 1000;
      setCooldown(until);
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
      cooldownTimer.current = setTimeout(() => setCooldown(0), retryAfter * 1000);
    }
    setMessage(out === "busy" ? s.errorBusy : out === "bot" ? s.errorBot : out === "network" ? s.errorNetwork : out === "toobig" ? s.errorTooBig : s.errorGeneric);
    if (out !== "network" && out !== "toobig") await refresh();
  }

  if (view === "checking") return <p role="status" aria-live="polite" className="aicc-muted" data-req-state="checking">{s.checking}</p>;
  if (view === "closed") {
    return (
      <div data-req-state="closed" className="aicc-card aicc-req__state" role="status" aria-live="polite" tabIndex={-1} ref={closedRef}>
        <h2 className="aicc-h3">{s.closedTitle}</h2>
        <p>{s.closedBody}</p>
      </div>
    );
  }
  if (view === "ended") {
    return (
      <div data-req-state="ended" className="aicc-card aicc-req__state" role="status" aria-live="polite" tabIndex={-1}>
        <h2 className="aicc-h3">{ended.title}</h2>
        <p>{ended.body}</p>
      </div>
    );
  }
  if (view === "done") {
    return (
      <div data-req-state="done" className="aicc-card aicc-req__state" role="status" aria-live="polite" tabIndex={-1} ref={doneRef}>
        <p data-req-success>{s.success}</p>
        <p className="aicc-muted">{s.successHint}</p>
      </div>
    );
  }
  const errList = (["email", "store", "operator", "consent"] as const).filter((k) => errors[k]);
  return (
    <form className="aicc-req" noValidate onSubmit={onSubmit} aria-label={s.formLabel} data-req-state="form" aria-busy={busy}>
      {errList.length ? (
        <div className="aicc-req__summary" role="alert" tabIndex={-1} ref={summaryRef}>
          <TriangleAlert size={18} aria-hidden="true" style={{ flex: "none", marginBlockStart: 2 }} />
          <div>
            <p><strong>{s.summary}</strong></p>
            <ul>{errList.map((k) => <li key={k}><a href={`#req-${k}`} onClick={(ev) => { ev.preventDefault(); document.getElementById(`req-${k}`)?.focus(); }}>{errors[k]}</a></li>)}</ul>
          </div>
        </div>
      ) : null}
      <FormField id="req-email" label={s.email} hint={s.emailHint} error={errors.email}>
        {(a) => <input {...a} name="email" type="email" inputMode="email" autoComplete="email" dir="ltr" required aria-required="true" maxLength={254} value={email} onChange={(ev) => setEmail(ev.target.value)} style={{ maxInlineSize: "100%" }} />}
      </FormField>
      <FormField id="req-store" label={s.store} hint={s.storeHint} error={errors.store}>
        {(a) => <input {...a} name="store_url" type="text" inputMode="url" autoComplete="url" dir="ltr" placeholder="https://" required aria-required="true" maxLength={255} value={store} onChange={(ev) => setStore(ev.target.value)} style={{ maxInlineSize: "100%" }} />}
      </FormField>
      <FormField id="req-plan" label={s.plan}>
        {(a) => (
          <select {...a} name="plan" value={plan} onChange={(ev) => setPlan(ev.target.value as PlanId)} style={{ maxInlineSize: "100%" }}>
            {(["solo", "studio", "agency"] as const).map((p) => <option key={p} value={p}>{s.plans[p]}</option>)}
          </select>
        )}
      </FormField>
      <div className="aicc-req__checks">
        <div>
          <label className="aicc-req__check">
            <input id="req-operator" name="operator_confirmed" type="checkbox" checked={operator} onChange={(ev) => setOperator(ev.target.checked)} aria-required="true" aria-invalid={!!errors.operator} aria-describedby={errors.operator ? "req-operator-error" : undefined} />
            <span>{s.operator}</span>
          </label>
          {errors.operator ? <p id="req-operator-error" className="aicc-field__error">{errors.operator}</p> : null}
        </div>
        <div>
          <label className="aicc-req__check">
            <input id="req-consent" name="terms_accepted" type="checkbox" checked={agreed} onChange={(ev) => setAgreed(ev.target.checked)} aria-required="true" aria-invalid={!!errors.consent} aria-describedby={errors.consent ? "req-consent-error" : undefined} />
            <span>{consent}</span>
          </label>
          {errors.consent ? <p id="req-consent-error" className="aicc-field__error">{errors.consent}</p> : null}
        </div>
      </div>
      {/* honeypot: a human never sees or reaches it; the contract requires the empty string and the JSON key `website`. The DOM name is neutral on purpose (autofill and bots key on "website"). */}
      <div className="aicc-req__hp" aria-hidden="true">
        <input ref={hp} id="aicc_hp" name="aicc_hp" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      {/* the privacy notice comes BEFORE the Turnstile widget: the visitor reads who processes what before the widget runs */}
      <aside className="aicc-req__notice" aria-label={s.noticeLabel} data-req-notice><p>{notice}</p></aside>
      <div className="aicc-req__bot">
        <p className="aicc-req__botlabel" id="req-bot-label">{s.botLabel}</p>
        <div ref={tsBox} role="group" aria-labelledby="req-bot-label" data-req-turnstile />
        {botError ? <p className="aicc-field__error" role="alert">{botError}</p> : null}
        {tsFailed ? <p><button type="button" className="aicc-btn aicc-btn--outline" onClick={retryTurnstile} data-req-retry>{s.retry}</button></p> : null}
      </div>
      <div role="status" aria-live="polite" className="aicc-req__live" data-req-message>{message}</div>
      <div><button type="submit" className="aicc-btn aicc-btn--primary aicc-btn--lg" disabled={busy || cooldown > 0}>{busy ? s.sending : s.submit}</button></div>
    </form>
  );
}
