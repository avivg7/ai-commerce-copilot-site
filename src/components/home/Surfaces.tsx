import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { fbProps } from "@/i18n";
import { Container, Section, SectionHeading } from "@/components/ui/Primitives";
import { Tabs } from "@/components/blocks/Blocks";

/**
 * Visual proof that recommendations appear on BOTH product pages and the cart page (and nowhere else): the same sample store in two states,
 * a product page and a cart, as an accessible two-tab view (kit module brand/js/tabs.js; without JavaScript both states are visible under their own headings).
 *
 * The store around the widget is a simplified, invented sample. The WIDGET is rebuilt from the real shopper widget (Plugin: includes/class-aicc-widget.php
 * for the markup and strings, assets/css/widget.css for the anatomy): a title and subtitle, a horizontal rail of product cards (image on top, a checkbox over its
 * top corner, a two-line name, a price), a "Bundle total" with an "Add N products to cart" button, and the quiet "Powered by AI Commerce Copilot" signature.
 * Product page: the viewed product is the first card, ticked and locked (its checkbox is disabled); recommended products start unticked until the shopper ticks them.
 * Cart: no source card, and products already in the cart are left out. Everything is illustration (invented products and prices, labelled as such); nothing
 * here shows a surface the plugin does not have (no checkout, post-purchase or one-click placement).
 */
const PRICES = { kit: 38, filters: 14, grinder: 46, mug: 16, towel: 18, scale: 24 } as const;
type Key = keyof typeof PRICES;
type Card = { k: Key; on: boolean; source?: boolean };

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Flat product illustrations that stand in for product photos (the real widget shows the store's own product images on a light tile). */
function Art({ k }: { k: Key }) {
  const body = "#e2e8f0", line = "#94a3b8", blue = "#2563eb", teal = "#05865f", dark = "#475569";
  const shapes = {
    kit: (
      <>
        <rect x="34" y="12" width="52" height="7" rx="3.5" fill={line} />
        <path d="M40 19h40l-8 26H48z" fill="#cbd5e1" />
        <path d="M44 49h32l6 8v35a10 10 0 0 1-10 10H48a10 10 0 0 1-10-10V57z" fill={body} stroke={line} strokeWidth="2" />
        <path d="M39 72h42v20a10 10 0 0 1-10 10H49a10 10 0 0 1-10-10z" fill={blue} opacity=".85" />
        <path d="M82 66c10 0 14 6 14 13s-4 13-14 13" fill="none" stroke={line} strokeWidth="4" strokeLinecap="round" />
      </>
    ),
    filters: (
      <>
        <rect x="24" y="30" width="72" height="62" rx="6" fill={body} stroke={line} strokeWidth="2" />
        <rect x="24" y="52" width="72" height="20" fill={blue} opacity=".85" />
        <path d="M36 42h48M36 82h30" stroke={line} strokeWidth="3" strokeLinecap="round" />
        <path d="M44 62h32" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </>
    ),
    grinder: (
      <>
        <path d="M60 22V12h22" fill="none" stroke={dark} strokeWidth="4" strokeLinecap="round" />
        <circle cx="84" cy="12" r="5.5" fill={blue} />
        <rect x="38" y="22" width="44" height="10" rx="4" fill={line} />
        <rect x="42" y="32" width="36" height="46" rx="6" fill="#cbd5e1" />
        <path d="M40 78h40v14a8 8 0 0 1-8 8H48a8 8 0 0 1-8-8z" fill={body} stroke={line} strokeWidth="2" />
      </>
    ),
    mug: (
      <>
        <path d="M28 38h52v36a20 20 0 0 1-20 20h-12a20 20 0 0 1-20-20z" fill={body} stroke={line} strokeWidth="2" />
        <path d="M80 48h6a12 12 0 0 1 0 24h-8" fill="none" stroke={line} strokeWidth="5" strokeLinecap="round" />
        <rect x="31" y="52" width="46" height="8" fill={blue} opacity=".85" />
      </>
    ),
    scale: (
      <>
        <rect x="40" y="14" width="40" height="12" rx="4" fill={dark} />
        <path d="M38 26h44l-5 70a8 8 0 0 1-8 7H51a8 8 0 0 1-8-7z" fill={body} stroke={line} strokeWidth="2" />
        <rect x="41" y="48" width="38" height="14" fill={teal} opacity=".85" />
      </>
    ),
    towel: (
      <>
        <rect x="22" y="40" width="76" height="46" rx="4" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="2" />
        <path d="M22 56h76M22 70h76" stroke={teal} strokeWidth="3" />
        <path d="M30 40V30h60v10" fill={body} />
      </>
    ),
  } as const;
  return <svg viewBox="0 0 120 120" className="aicc-wmock__art" focusable="false" aria-hidden="true">{shapes[k]}</svg>;
}

function Widget({ t, cards }: { t: Dictionary; cards: Card[] }) {
  const w = t.demo.widget, p = t.demo.products, s = t.home.surfaces;
  const picked = cards.filter((c) => c.on);
  const total = picked.reduce((sum, c) => sum + PRICES[c.k], 0);
  return (
    <div className="aicc-wmock" aria-hidden="true">
      <div className="aicc-wmock__title">{w.title}</div>
      <div className="aicc-wmock__subtitle">{w.subtitle}</div>
      <div className="aicc-wmock__rail">
        {cards.map((c) => (
          <div key={c.k} className="aicc-wmock__card" data-selected={c.on ? "true" : undefined} data-source={c.source ? "true" : undefined}>
            <span className="aicc-wmock__check" data-on={c.on ? "true" : undefined} data-locked={c.source ? "true" : undefined} />
            <div className="aicc-wmock__thumb"><Art k={c.k} /></div>
            <div className="aicc-wmock__info">
              <span className="aicc-wmock__name"><bdi>{p[c.k]}</bdi></span>
              <span className="aicc-wmock__price"><bdi>{usd(PRICES[c.k])}</bdi></span>
            </div>
          </div>
        ))}
      </div>
      <div className="aicc-wmock__actions">
        <div className="aicc-wmock__total">
          <span className="aicc-wmock__total-label">{w.bundleTotal}</span>
          <strong className="aicc-wmock__total-amount"><bdi>{usd(total)}</bdi></strong>
        </div>
        <span className="aicc-wmock__add">{(picked.length === 1 ? w.addOne : w.addMany).replace("{count}", String(picked.length))}</span>
      </div>
      <div className="aicc-wmock__brand">
        <svg viewBox="0 0 32 32" width="16" height="16" aria-hidden="true" focusable="false">
          <rect x="14" y="4.5" width="4" height="3" rx="1.5" fill="currentColor" />
          <rect x="6.5" y="9" width="19" height="15" rx="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="12.5" cy="15" r="1.7" fill="currentColor" />
          <circle cx="19.5" cy="15" r="1.7" fill="currentColor" />
          <path d="M12.5 18.8 Q16 21.4 19.5 18.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </svg>
        <span>{s.mockPoweredBy} <b>AI Commerce Copilot</b></span>
      </div>
    </div>
  );
}

function ProductPageMock({ t }: { t: Dictionary }) {
  const s = t.home.surfaces;
  return (
    <figure className="aicc-mock" role="img" aria-label={s.page.mock}>
      <div className="aicc-mock__chrome" aria-hidden="true"><i /><i /><i /></div>
      <div className="aicc-mock__page" aria-hidden="true">
        <div className="aicc-mock__product">
          <div className="aicc-mock__photo"><Art k="kit" /></div>
          <div className="aicc-mock__details">
            <strong className="aicc-mock__title"><bdi>{t.demo.products.kit}</bdi></strong>
            <span className="aicc-mock__price">{usd(PRICES.kit)}</span>
            <span className="aicc-mock__bar" /><span className="aicc-mock__bar aicc-mock__bar--short" />
            <span className="aicc-mock__btn aicc-mock__btn--solid">{s.mockAdd}</span>
          </div>
        </div>
        <Widget
          t={t}
          cards={[{ k: "kit", on: true, source: true }, { k: "filters", on: true }, { k: "grinder", on: true }, { k: "mug", on: false }]}
        />
      </div>
    </figure>
  );
}

const CART_LINES: Array<{ k: Key; qty: number }> = [{ k: "kit", qty: 1 }, { k: "scale", qty: 2 }];

/** The store around the widget on the cart page: cart lines (thumbnail, name, unit price, quantity, line subtotal), a separate order-summary card, and only then
 *  the AICC widget, placed after the cart as the plugin does (woocommerce_after_cart). "Proceed to checkout" is part of the fake store, drawn in the store's own
 *  neutral style: it is not an AICC control and AICC does not operate checkout. */
function CartMock({ t }: { t: Dictionary }) {
  const s = t.home.surfaces, p = t.demo.products, c = s.cartCols;
  const subtotal = CART_LINES.reduce((sum, l) => sum + PRICES[l.k] * l.qty, 0);
  return (
    <figure className="aicc-mock aicc-mock--cart" role="img" aria-label={s.cart.mock}>
      <div className="aicc-mock__chrome" aria-hidden="true"><i /><i /><i /></div>
      <div className="aicc-mock__page" aria-hidden="true">
        <strong className="aicc-mock__carttitle">{s.mockCartTitle}</strong>
        <div className="aicc-cartmock">
         <div className="aicc-cartmock__grid">
          <div className="aicc-cartmock__items">
            <div className="aicc-cartmock__head">
              <span /><span>{c.product}</span><span>{c.price}</span><span>{c.quantity}</span><span>{c.subtotal}</span>
            </div>
            {CART_LINES.map((l) => (
              <div key={l.k} className="aicc-cartmock__line">
                <div className="aicc-cartmock__thumb"><Art k={l.k} /></div>
                <span className="aicc-cartmock__name"><bdi>{p[l.k]}</bdi></span>
                <span className="aicc-cartmock__meta">
                  <span className="aicc-cartmock__unit">{usd(PRICES[l.k])}</span>
                  <span className="aicc-cartmock__qty"><i>&minus;</i><b>{l.qty}</b><i>+</i></span>
                </span>
                <span className="aicc-cartmock__sub">{usd(PRICES[l.k] * l.qty)}</span>
              </div>
            ))}
          </div>
          <div className="aicc-cartmock__summary">
            <div className="aicc-cartmock__summary-title">{s.mockTotals}</div>
            <div className="aicc-cartmock__row"><span>{s.mockSubtotal}</span><span>{usd(subtotal)}</span></div>
            <div className="aicc-cartmock__row"><span>{s.mockShipping}</span><span className="aicc-cartmock__note">{s.mockShippingNote}</span></div>
            <div className="aicc-cartmock__row aicc-cartmock__row--total"><span>{s.mockTotal}</span><span>{usd(subtotal)}</span></div>
            <span className="aicc-cartmock__checkout">{s.mockCheckout}</span>
          </div>
         </div>
        </div>
        <Widget
          t={t}
          cards={[{ k: "filters", on: true }, { k: "grinder", on: true }, { k: "mug", on: false }, { k: "towel", on: false }]}
        />
      </div>
    </figure>
  );
}

export function Surfaces({ locale, t }: { locale: Locale; t: Dictionary }) {
  const s = t.home.surfaces;
  return (
    <Section id="surfaces" tone="surface" labelledBy="surfaces-title" className="aicc-surfaces" fb={fbProps(locale, "home.surfaces")}>
      <Container>
        <SectionHeading id="surfaces-title" title={s.title} lead={s.lead} />
        <Tabs
          id="surf"
          label={s.tabsLabel}
          tabs={[
            { key: "page", label: s.page.tab, title: s.page.title, children: (<><p className="aicc-surfaces__headline">{s.page.headline}</p><p className="aicc-surfaces__body">{s.page.body}</p><ProductPageMock t={t} /></>) },
            { key: "cart", label: s.cart.tab, title: s.cart.title, children: (<><p className="aicc-surfaces__headline">{s.cart.headline}</p><p className="aicc-surfaces__body">{s.cart.body}</p><CartMock t={t} /></>) },
          ]}
        />
        <p className="aicc-muted aicc-small aicc-surfaces__note">{s.scope} {s.caption}</p>
      </Container>
    </Section>
  );
}
