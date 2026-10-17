// Loads TypeScript source modules from the site (dictionaries, data files) without a build step.
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const jiti = createJiti(import.meta.url, { alias: { "@": path.join(ROOT, "src") }, moduleCache: false });

export async function loadTs(rel) {
  return jiti.import(path.join(ROOT, rel));
}

/** The dictionaries as the site renders them: English, plus each locale's translated units merged over English (see src/i18n/merge.ts). */
export async function loadDictionaries() {
  const { getDictionary } = await loadTs("src/i18n/index.ts");
  const out = {};
  for (const l of ["en", "he", "es", "ru"]) out[l] = getDictionary(l);
  return out;
}

/** The raw per-locale source objects (en = full, others = partial) and the fallback unit lists. */
export async function loadPartials() {
  const out = {};
  for (const l of ["en", "he", "es", "ru"]) out[l] = (await loadTs(`src/i18n/${l}.ts`))[l];
  return out;
}
export async function loadFallbacks() {
  const { fallbackUnits } = await loadTs("src/i18n/index.ts");
  return Object.fromEntries(["en", "he", "es", "ru"].map((l) => [l, fallbackUnits(l)]));
}
