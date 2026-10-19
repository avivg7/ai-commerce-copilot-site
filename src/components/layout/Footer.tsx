import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { localePath, type RouteId } from "@/lib/routes";
import { Rich } from "@/lib/rich";
import { Logo } from "@/components/ui/Logo";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { LangMenu } from "@/components/brand/LangMenu";
import { A11yTrigger } from "./A11yControl";
import { COMPANY, wordpressUrl } from "@/lib/site";
import { DPA_PATH } from "@/lib/routes";
import { fbProps } from "@/i18n";

export function Footer({ locale, route, t }: { locale: Locale; route: RouteId; t: Dictionary }) {
  const c = t.common;
  const ctx = { locale, t, vars: { name: COMPANY.legalName || "AICC" } };
  const aicc: [RouteId, string][] = [
    ["product", c.pageNames.product],
    ["pricing", c.pageNames.pricing],
    ["questions", c.pageNames.questions],
  ];
  // Same list and order as the Control Plane footer. The Data Processing Addendum is a WordPress-owned document (no page in this site): a plain link to the canonical host.
  const trust: [RouteId | "dpa", string][] = [
    ["data-and-trust", c.pageNames.dataTrust],
    ["privacy", c.pageNames.privacy],
    ["terms", c.pageNames.terms],
    ["refund-policy", c.pageNames.refund],
    ["dpa", c.pageNames.dpa],
    ["accessibility", c.pageNames.accessibility],
  ];
  return (
    <footer className="aicc-footer aicc-on-dark">
      <div className="aicc-container">
        <div className="aicc-footer__grid">
          <div style={{ display: "grid", gap: "1rem", alignContent: "start" }}>
            <Logo href={localePath(locale, "home")} full={t.meta.siteName} onDark />
            <p style={{ maxInlineSize: "28ch" }} {...fbProps(locale, "common.footer.tagline")}>{c.footer.tagline}</p>
          </div>
          <nav aria-labelledby="footer-product">
            <h2 id="footer-product">{c.footer.productHeading}</h2>
            <ul>
              {aicc.map(([r, label]) => (
                <li key={r}>
                  <LocaleLink locale={locale} route={r} aria-current={r === route ? "page" : undefined}>
                    {label}
                  </LocaleLink>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-labelledby="footer-trust">
            <h2 id="footer-trust">{c.footer.trustHeading}</h2>
            <ul>
              {trust.map(([r, label]) => (
                <li key={r}>
                  {r === "dpa" ? (
                    <a href={wordpressUrl(locale, DPA_PATH)}>{label}</a>
                  ) : (
                    <LocaleLink locale={locale} route={r} aria-current={r === route ? "page" : undefined}>
                      {label}
                    </LocaleLink>
                  )}
                </li>
              ))}
            </ul>
          </nav>
          <div style={{ display: "grid", gap: "1rem", alignContent: "start" }}>
            <h2>{c.footer.languageHeading}</h2>
            <LangMenu locale={locale} route={route} label={c.language.label} currentWord={c.language.current} idSuffix="footer" up />
            <div>
              <A11yTrigger label={c.a11y.title} className="aicc-btn aicc-btn--ghost" />
            </div>
          </div>
        </div>
        <div className="aicc-footer__base">
          <p>
            <Rich text={c.footer.copyright} ctx={ctx} />
          </p>
          <p {...fbProps(locale, "common.footer.note")}>{c.footer.note}</p>
        </div>
      </div>
    </footer>
  );
}

