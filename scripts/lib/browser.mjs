import { chromium } from "playwright-core";
import fs from "node:fs";

const CANDIDATES = [
  process.env.AICC_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

// AICC_CHROME_ARGS (space separated Chrome flags) lets a browser test reach a host that public DNS does not point at yet (the DARK production host):
//   AICC_CHROME_ARGS="--host-resolver-rules=MAP\ www.copilt.org\ 157.230.110.211 --ignore-certificate-errors"  (use only against a host you operate)
const EXTRA_ARGS = (process.env.AICC_CHROME_ARGS || "").match(/(?:\\ |[^\s])+/g)?.map((a) => a.replace(/\\ /g, " ")) || [];

export async function launch() {
  try {
    return await chromium.launch({ args: EXTRA_ARGS });
  } catch {
    const exe = CANDIDATES.find((p) => fs.existsSync(p));
    if (!exe) throw new Error("No Chromium found. Set AICC_CHROME to a Chrome/Chromium binary.");
    return chromium.launch({ executablePath: exe, args: EXTRA_ARGS });
  }
}

export const BASE = process.env.AICC_BASE_URL || "http://localhost:3011";
export const LOCALES = ["en", "he", "es", "ru"];
export const ROUTES = ["", "product", "pricing", "data-and-trust", "privacy", "terms", "refund-policy", "accessibility", "questions"];
export const urlFor = (locale, route) => `${BASE}${locale === "en" ? "" : `/${locale}`}/${route ? `${route}/` : ""}`;
