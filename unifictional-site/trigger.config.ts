import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg } from "@trigger.dev/build/extensions/core";
import { playwright } from "@trigger.dev/build/extensions/playwright";

// Trigger.dev runs the AI build pipeline as durable background tasks
// (see trigger/build-site.ts). The project ref comes from the Trigger.dev
// dashboard (Project settings); set TRIGGER_PROJECT_REF locally and in CI,
// and TRIGGER_SECRET_KEY on Vercel so the site can trigger runs.
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF || "proj_pending",
  dirs: ["./trigger"],
  runtime: "node-24",
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30000, factor: 2, randomize: true },
  },
  build: {
    // native binaries stay out of the bundle; ffmpeg 7 is installed for the hero-video frame extraction
    external: ["sharp"],
    // Chromium (Playwright) is the quality gate's browser: every finished site is opened, scrolled and photographed before it is sent
    extensions: [ffmpeg({ version: "7" }), playwright({ browsers: ["chromium"], headless: true })],
  },
});
