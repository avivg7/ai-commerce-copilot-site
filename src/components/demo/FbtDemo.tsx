"use client";
import { useEffect, useRef, useState } from "react";
import { Coffee, Filter, Cog, Flame, CupSoda, Layers, Package, Info, Check, ShoppingCart } from "lucide-react";
import type { Dictionary } from "@/i18n";
import { formatPrice } from "@/data/plans";
import { useMotionAllowed } from "@/lib/useMotion";
import { RecoImage } from "@/components/ui/RecoImage";

type Demo = Dictionary["demo"];
type ProductKey = keyof Demo["products"];
interface Item {
  id: ProductKey;
  price: number;
  strength: 0 | 1 | 2 | 3;
  Icon: typeof Coffee;
}

/* Invented sample goods and prices. No conversion, revenue or order-count figures anywhere in this demo. */
const ANCHOR: Item = { id: "kit", price: 38, strength: 0, Icon: Coffee };
const WITH: Item[] = [
  { id: "filters", price: 14, strength: 3, Icon: Filter },
  { id: "grinder", price: 46, strength: 2, Icon: Cog },
  { id: "kettle", price: 52, strength: 1, Icon: Flame },
];
const WITHOUT: Item[] = [
  { id: "mug", price: 16, strength: 0, Icon: CupSoda },
  { id: "towel", price: 18, strength: 0, Icon: Layers },
  { id: "scale", price: 24, strength: 0, Icon: Package },
];

/** Count up/down to a target only when motion is allowed; otherwise the value is simply the target. */
function useAnimatedNumber(target: number, enabled: boolean) {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (!enabled) {
      current.current = target;
      return;
    }
    const from = current.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 320);
      const eased = 1 - Math.pow(1 - p, 3);
      current.current = from + (target - from) * eased;
      setShown(current.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);
  return enabled ? shown : target;
}

export default function FbtDemo({ s, rtl }: { s: Demo; rtl: boolean }) {
  const [mode, setMode] = useState<"with" | "without">("with");
  const [checked, setChecked] = useState<Record<string, boolean>>({ kit: true, filters: true });
  const [added, setAdded] = useState(false);
  const motion = useMotionAllowed();
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  const cands = mode === "with" ? WITH : WITHOUT;
  const items = [ANCHOR, ...cands];
  const picked = items.filter((i) => checked[i.id]);
  const count = picked.length;
  const total = picked.reduce((n, i) => n + i.price, 0);
  const shownTotal = useAnimatedNumber(total, motion);

  const strongest = mode === "with" ? cands.filter((c) => checked[c.id]).sort((a, b) => b.strength - a.strength)[0] : undefined;
  const whyText =
    mode === "without"
      ? s.why.without
      : strongest
        ? s.why[strongest.id as "filters" | "grinder" | "kettle"]
        : s.why.none;
  const recoText =
    mode === "without"
      ? s.reco.without
      : strongest
        ? s.reco[(["", "light", "medium", "strong"] as const)[strongest.strength] as "light" | "medium" | "strong"]
        : s.reco.intro;

  const toggle = (id: string) => {
    setAdded(false);
    setChecked((c) => ({ ...c, [id]: !c[id] }));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = boxes.current.findIndex((b) => b === document.activeElement);
    if (idx < 0) return;
    let step = 0;
    if (e.key === "ArrowDown") step = 1;
    else if (e.key === "ArrowUp") step = -1;
    else if (e.key === "ArrowRight") step = rtl ? -1 : 1;
    else if (e.key === "ArrowLeft") step = rtl ? 1 : -1;
    if (!step) return;
    e.preventDefault();
    const next = (idx + step + items.length) % items.length;
    boxes.current[next]?.focus();
  };

  const strengthLabel = (i: Item) => (i.strength === 3 ? s.strength.strong : i.strength === 2 ? s.strength.medium : i.strength === 1 ? s.strength.light : s.strength.none);
  const buttonText = added ? s.widget.added : count === 1 ? s.widget.addOne : s.widget.addMany.replace("{count}", String(count));

  return (
    <div className="aicc-demo" data-mode={mode} data-aicc-demo="fbt">
      <div className="aicc-demo__widget">
        <div className="aicc-demo__top">
          <p className="aicc-demo__label">
            <Info size={18} aria-hidden="true" />
            <span>{s.label}</span>
          </p>
          <div role="group" aria-label={s.mode.legend} className="aicc-demo__modes">
            {(["without", "with"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className="aicc-demo__mode"
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                  setAdded(false);
                }}
              >
                {m === "with" ? s.mode.with : s.mode.without}
              </button>
            ))}
          </div>
        </div>

        <div className="aicc-demo__head">
          <h3>{s.widget.title}</h3>
          <p>{mode === "with" ? s.widget.subtitle : s.mode.withoutCaption}</p>
          {mode === "with" ? <p className="aicc-sr-only">{s.mode.withCaption}</p> : null}
        </div>

        <fieldset className="aicc-demo__fieldset" onKeyDown={onKeyDown}>
          <legend className="aicc-sr-only">{s.groupLabel}</legend>
          <div className="aicc-demo__anchor">
            <ProductCard
              item={ANCHOR}
              s={s}
              checked={!!checked[ANCHOR.id]}
              onToggle={() => toggle(ANCHOR.id)}
              inputRef={(el) => (boxes.current[0] = el)}
              meta={<span className="aicc-demo__tag">{s.anchorTag}</span>}
            />
          </div>
          <ul className="aicc-demo__cands">
            {cands.map((c, i) => (
              <li key={`${mode}-${c.id}`} data-strength={c.strength} className="aicc-demo__cand">
                <ProductCard
                  item={c}
                  s={s}
                  checked={!!checked[c.id]}
                  onToggle={() => toggle(c.id)}
                  inputRef={(el) => (boxes.current[i + 1] = el)}
                  meta={
                    <span className="aicc-demo__strength">
                      <span className="aicc-demo__meter" aria-hidden="true">
                        <i /><i /><i />
                      </span>
                      <span>{strengthLabel(c)}</span>
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </fieldset>
        <p className="aicc-demo__hint">{s.keyboardHint}</p>

        <div className="aicc-demo__foot">
          <p className="aicc-demo__total">
            <span>{s.widget.bundleTotal}</span>
            <strong>
              <bdi>{formatPrice(Math.round(shownTotal))}</bdi>
            </strong>
          </p>
          <button
            type="button"
            className="aicc-btn aicc-btn--primary"
            aria-disabled={count === 0}
            onClick={() => {
              if (count > 0) setAdded(true);
            }}
          >
            {added ? <Check size={18} aria-hidden="true" /> : <ShoppingCart size={18} aria-hidden="true" />}
            {count === 0 ? s.widget.addOne : buttonText}
          </button>
        </div>
        <p className="aicc-demo__status" role="status">
          {count === 0 ? s.widget.selectAtLeastOne : added ? s.widget.noteAdd : ""}
        </p>
      </div>

      <aside className="aicc-demo__why" aria-labelledby="demo-why">
        <div className="aicc-demo__reco">
          <RecoImage pose="thinking" sizes="112px" displayWidth={96} />
          <p className="aicc-demo__bubble" aria-live="polite" aria-atomic="true">
            {recoText}
          </p>
        </div>
        <h3 id="demo-why">{s.why.heading}</h3>
        <p aria-live="polite" aria-atomic="true">
          {whyText}
        </p>
      </aside>
    </div>
  );
}

function ProductCard({
  item,
  s,
  checked,
  onToggle,
  inputRef,
  meta,
}: {
  item: Item;
  s: Demo;
  checked: boolean;
  onToggle: () => void;
  inputRef: (el: HTMLInputElement | null) => void;
  meta: React.ReactNode;
}) {
  const { Icon } = item;
  return (
    <label className="aicc-demo-card" data-checked={checked}>
      <input type="checkbox" checked={checked} onChange={onToggle} ref={inputRef} />
      <span className="aicc-demo-card__thumb" aria-hidden="true">
        <Icon size={26} />
      </span>
      <span className="aicc-demo-card__body">
        <span className="aicc-demo-card__name">{s.products[item.id]}</span>
        <span className="aicc-demo-card__price">
          <bdi>{formatPrice(item.price)}</bdi>
        </span>
        {meta}
      </span>
    </label>
  );
}
