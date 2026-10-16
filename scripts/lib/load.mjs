// Loads TypeScript source modules from the site (dictionaries, data files) without a build step.
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const jiti = createJiti(import.meta.url, { alias: { "@": path.join(ROOT, "src") }, moduleCache: false });

export async function loadTs(rel) {
  return jiti.import(path.join(ROOT, rel));
}

export async function loadDictionaries() {
  const out = {};
  for (const l of ["en", "he", "es", "ru"]) {
    const mod = await loadTs(`src/i18n/${l}.ts`);
    out[l] = mod[l];
  }
  return out;
}
