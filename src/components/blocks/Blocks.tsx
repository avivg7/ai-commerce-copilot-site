import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Lb, Rich, type RichCtx } from "@/lib/rich";
import type { Locale } from "@/i18n/config";
import { txProps } from "@/i18n";

/** Three (or more) points side by side, divided by hairlines under one gradient rule. */
export function Strip({ items, ctx }: { items: { title: string; body: string }[]; ctx: RichCtx }) {
  return (
    <ul className="aicc-strip" style={{ ["--n" as string]: items.length }}>
      {items.map((it, i) => (
        <li key={it.title}>
          <span className="aicc-strip__n" aria-hidden="true">0{i + 1}</span>
          <h3>{it.title}</h3>
          <p><Rich text={it.body} ctx={ctx} /></p>
        </li>
      ))}
    </ul>
  );
}

/** A sequence on a rail: numbered nodes, the last one highlighted. Text sits under each node. */
export function Track({ items, headingLevel = 3, locale = "en" }: { items: { title: string; body: string }[]; headingLevel?: 3 | 4; locale?: Locale }) {
  const H = `h${headingLevel}` as "h3" | "h4";
  return (
    <ol className="aicc-track" style={{ ["--track-n" as string]: items.length }}>
      {items.map((it) => (
        <li key={it.title}>
          <H>{it.title}</H>
          <p><Lb text={it.body} locale={locale} /></p>
        </li>
      ))}
    </ol>
  );
}

/** Two titled lists side by side: what it can / can't do, what is needed / not received. */
export function Pair({
  yes, no,
}: {
  yes: { title: string; items: string[] };
  no: { title: string; items: string[] };
}) {
  return (
    <div className="aicc-pair">
      <div className="aicc-pair__col" data-tone="yes">
        <h3>{yes.title}</h3>
        <ul className="aicc-pair__list">{yes.items.map((x) => <li key={x}><Check size={18} aria-hidden="true" /><span>{x}</span></li>)}</ul>
      </div>
      <div className="aicc-pair__col" data-tone="no">
        <h3>{no.title}</h3>
        <ul className="aicc-pair__list">{no.items.map((x) => <li key={x}><X size={18} aria-hidden="true" /><span>{x}</span></li>)}</ul>
      </div>
    </div>
  );
}

/** A plain ruled list (limitations). */
export function Ruled({ items, icon }: { items: string[]; icon: ReactNode }) {
  return (
    <ul className="aicc-ruled">
      {items.map((x) => <li key={x}>{icon}<span>{x}</span></li>)}
    </ul>
  );
}

/** Store capacity as dots. */
export function SlotRows({ rows }: { rows: { name: string; n: number; label: string }[] }) {
  return (
    <ul className="aicc-slotrows">
      {rows.map((r) => (
        <li key={r.name}>
          <strong><bdi>{r.name}</bdi></strong>
          <span className="aicc-dots" aria-hidden="true">{Array.from({ length: r.n }, (_, i) => <i key={i} />)}</span>
          <span>{r.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Marks one string with its own language and direction: English fallback text as lang="en" dir="ltr", translated text as the page language (so it also resets an enclosing fallback block). */
export function Fb({ locale, k, children }: { locale: Locale; k: string; children: ReactNode }) {
  const a = txProps(locale, k);
  return a.lang ? <span {...a}>{children}</span> : <>{children}</>;
}

/**
 * Accessible tabbed workspace (kit module brand/js/tabs.js adds the behavior; markup contract in brand/README.md).
 * Without JavaScript every panel is visible under its own heading and the tab list stays hidden.
 */
export function Tabs({ id, label, tabs }: { id: string; label: string; tabs: { key: string; label: string; title: string; children: ReactNode }[] }) {
  return (
    <div className="aicc-tabs" data-aicc-tabs data-selected={`${id}-t-${tabs[0].key}`}>
      <div className="aicc-tabs__list" role="tablist" aria-label={label} hidden>
        {tabs.map((t, i) => (
          <button key={t.key} type="button" className="aicc-tabs__tab" role="tab" id={`${id}-t-${t.key}`} aria-controls={`${id}-p-${t.key}`} aria-selected={i === 0} tabIndex={i === 0 ? 0 : -1}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="aicc-tabs__stack">
      {tabs.map((t) => (
        <section key={t.key} className="aicc-tabs__panel" id={`${id}-p-${t.key}`} role="tabpanel" aria-labelledby={`${id}-t-${t.key}`} tabIndex={0}>
          <h3 className="aicc-tabs__ph">{t.title}</h3>
          {t.children}
        </section>
      ))}
      </div>
    </div>
  );
}
