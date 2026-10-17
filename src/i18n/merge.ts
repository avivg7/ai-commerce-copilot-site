/**
 * The explicit translation-fallback mechanism (Stage 1 of the content pass).
 *
 * `en.ts` is the contract. `he.ts`, `es.ts` and `ru.ts` are PARTIAL dictionaries: they hold only the strings whose English
 * meaning is unchanged since they were translated. At load time every missing string falls back to the English text, and the
 * page marks that text lang="en" dir="ltr" so it is never presented as if it were the page language.
 *
 * Fallback is decided per UNIT, all-or-nothing, so a block never mixes two languages:
 *   - a page section (`home.hero`, `product.safe`, `pricing.slots` ...)         -> first two path segments
 *   - one legal/trust section (`legal.dataTrust.s.reads`) and its head          -> `legal.<doc>.s.<sec>` / `legal.<doc>.head`
 *   - one meta page (`meta.pages.home`)                                         -> first three segments
 *   - each kit string set (`demo`, `rules`, `dash`, `ask`, `flows`, `loop`, `faqSearch`)               -> the set itself
 *   - every `common.*` / `pending.*` / `notFound.*` string                      -> the string itself (small, used one at a time)
 * If any string of a unit is missing from a locale, the whole unit is taken from English and recorded in the fallback set.
 * Stage 2 translates a unit and the fallback disappears; `npm run i18n:check -- --strict` fails while any fallback remains.
 */
export type DeepPartial<T> = T extends string[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export function flatten(obj: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof obj === "string") { out[prefix] = obj; return out; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out)); out[`${prefix}#len`] = String(obj.length); return out; }
  if (obj && typeof obj === "object") for (const k of Object.keys(obj)) flatten((obj as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const WHOLE_LEAF_ROOTS = new Set(["common", "pending", "notFound"]);
/** Kit string sets: delivered to the vanilla modules as one JSON object, so they fall back as one object. */
const WHOLE_UNIT_ROOTS = new Set(["demo", "rules", "dash", "ask", "flows", "loop", "faqSearch"]);

/** Fallback unit of a leaf path (array indexes and #len belong to their parent). */
export function unitOf(path: string): string {
  const seg = path.replace(/#len$/, "").replace(/\[\d+\]/g, "").split(".");
  const root = seg[0];
  if (WHOLE_LEAF_ROOTS.has(root)) return seg.join(".");
  if (WHOLE_UNIT_ROOTS.has(root)) return root;
  if (root === "legal") return seg[2] === "s" && seg.length >= 4 ? seg.slice(0, 4).join(".") : seg[2] === "short" ? `${seg[0]}.${seg[1]}.short` : `${seg[0]}.${seg[1]}.head`;
  if (root === "meta") return seg.length >= 3 && seg[1] === "pages" ? seg.slice(0, 3).join(".") : seg.join(".");
  return seg.slice(0, 2).join(".");
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let cur: Record<string, unknown> = target;
  parts.forEach((p, i) => {
    if (i === parts.length - 1) { cur[p] = value; return; }
    cur = (cur[p] ??= /^\d+$/.test(parts[i + 1]) ? [] : {}) as Record<string, unknown>;
  });
}

export interface MergedDictionary<T> { dict: T; fallback: Set<string>; units: string[] }

/** Merge a partial dictionary over English. Missing or incomplete units fall back whole. */
export function mergeOverEnglish<T>(en: T, partial: DeepPartial<T> | undefined): MergedDictionary<T> {
  const enFlat = flatten(en);
  const loFlat = partial ? flatten(partial) : {};
  const units = new Map<string, string[]>();
  for (const k of Object.keys(enFlat)) {
    const u = unitOf(k);
    (units.get(u) ?? units.set(u, []).get(u)!).push(k);
  }
  const fallback = new Set<string>();
  const out: Record<string, unknown> = {};
  for (const [u, keys] of units) {
    const complete = keys.every((k) => k in loFlat && (k.endsWith("#len") ? loFlat[k] === enFlat[k] : true));
    if (!complete) fallback.add(u);
    for (const k of keys) {
      if (k.endsWith("#len")) continue;
      setPath(out, k, complete ? loFlat[k] : enFlat[k]);
    }
  }
  return { dict: out as T, fallback, units: [...units.keys()] };
}
