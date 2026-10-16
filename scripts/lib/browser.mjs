import { chromium } from "playwright-core";
import fs from "node:fs";

const CANDIDATES = [
  process.env.AICC_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export async function launch() {
  try {
    return await chromium.launch();
  } catch {
    const exe = CANDIDATES.find((p) => fs.existsSync(p));
    if (!exe) throw new Error("No Chromium found. Set AICC_CHROME to a Chrome/Chromium binary.");
    return chromium.launch({ executablePath: exe });
  }
}

export const BASE = process.env.AICC_BASE_URL || "http://localhost:3011";
export const LOCALES = ["en", "he", "es", "ru"];
export const ROUTES = ["", "product", "pricing", "data-and-trust", "privacy", "terms", "refund-policy", "accessibility", "questions"];
export const urlFor = (locale, route) => `${BASE}${locale === "en" ? "" : `/${locale}`}/${route ? `${route}/` : ""}`;
