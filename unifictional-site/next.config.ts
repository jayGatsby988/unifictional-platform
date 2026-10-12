import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/heavy packages the AI build loads at runtime stay out of the bundle
  // (Playwright is only present on Trigger.dev; the build fails closed without it).
  serverExternalPackages: ["playwright", "playwright-core", "sharp", "@anthropic-ai/sdk"],
  // The scrub hero uses a requestAnimationFrame loop with cleaned-up effects,
  // so it's safe under React StrictMode. Above-the-fold entrances use CSS
  // mount animations (not scroll-into-view), so nothing depends on JS timing.
  async headers() {
    return [
      {
        // Hero footage frames never change in place — if the footage is ever
        // re-exported, put it in a new versioned directory instead.
        source: "/frames/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Client screenshots DO get replaced when a client relaunches, so the
        // browser must revalidate rather than sit on a week-old copy. The CDN
        // still serves them instantly and only refetches when the file changes
        // (cheap 304s), so this costs nothing but keeps swaps visible.
        // Belt-and-braces: version the filename too (…-v2.webp).
        source: "/:dir(showcase|process)/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate, s-maxage=604800, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
