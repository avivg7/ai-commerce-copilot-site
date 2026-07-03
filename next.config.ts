import type { NextConfig } from "next";

// Must match the GitHub repo name — GitHub Pages serves project sites from
// https://<user>.github.io/<repo>/, not the domain root.
const basePath = "/ai-commerce-copilot-site";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  images: {
    // next/image's optimization API needs a server; GitHub Pages is static-only.
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
