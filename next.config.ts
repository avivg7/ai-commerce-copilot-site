import type { NextConfig } from "next";

/**
 * Static export. basePath rules:
 *  - AICC_BASE_PATH set (even to an empty string) wins. Use "" to build for a domain root (www.copilt.org).
 *  - otherwise production builds use the GitHub Pages project path, dev builds use none.
 * SITE_URL (canonical / sitemap / hreflang origin) is independent of basePath; see docs/AUTHORITY.md.
 */
const basePath =
  process.env.AICC_BASE_PATH ??
  (process.env.NODE_ENV === "production" ? "/ai-commerce-copilot-site" : "");

const nextConfig: NextConfig = {
  output: "export",
  // `npm run test:approved` builds with fake company values into its own directory (AICC_DIST_DIR) so the default out/ is never overwritten with them.
  distDir: process.env.AICC_DIST_DIR || undefined,
  trailingSlash: true,
  basePath: basePath || undefined,
  images: {
    // next/image's optimisation API needs a server; this is a static export.
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  experimental: {
    // Unmatched URLs get a branded 404.html even though the root layout lives in a dynamic segment.
    globalNotFound: true,
  },
};

export default nextConfig;
