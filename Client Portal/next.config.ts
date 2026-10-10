import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The portal is auth-gated and per-client, so every page is runtime-dynamic.
  // Cache Components would force a Suspense boundary around every cookie read
  // for no benefit here; keep the classic rendering model.
  cacheComponents: false,
  turbopack: {
    // This app lives inside a larger repo that has its own package-lock and a
    // Tailwind 3 postcss.config.js. Pin the root so Turbopack never walks up.
    root: path.resolve(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
