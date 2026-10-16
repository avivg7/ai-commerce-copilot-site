import { Geist } from "next/font/google";

/**
 * Geist, self-hosted by next/font at build time (files are emitted under /_next/static/media; the browser never
 * contacts Google). `display: swap` plus next/font's metric-matched fallback keeps layout shift ~0.
 * Only the Latin subset is preloaded; Latin-extended (Spanish) and Cyrillic (Russian) load on demand through
 * unicode-range, so Hebrew and English pages do not download them. Hebrew has no Geist glyphs and falls back to the
 * system Hebrew-capable stack in --aicc-font-sans until a self-hosted OFL Hebrew face (Heebo) is bundled.
 */
export const geistLatin = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

export const geistExt = Geist({
  subsets: ["latin-ext", "cyrillic"],
  variable: "--font-geist-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});
