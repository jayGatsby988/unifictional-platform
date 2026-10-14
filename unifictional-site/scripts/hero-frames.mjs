// Turns the hero footage (a 4K clip) into the frame sets the ScrubHero scrubs.
//
//   node scripts/hero-frames.mjs <clip.mp4> <set-name>      e.g. unifictional-v4
//
// Writes public/frames/<set>/frame-NNN.webp        1600 wide, every frame (241)
//        public/frames/<set>-hi/frame-NNN.webp     2560 wide, even frames only
//        (the desktop scrub strides by 2, so odd frames would never be drawn)
// The portrait crops are made at build time by build-assets.mjs from the hi set.
//
// The frames come out of the clip with the Swift `frames` extractor from
// website/projects/caldera/tools (macOS has no ffmpeg); sharp then resizes and
// encodes WebP. Frames are cached immutable, so a re-export needs a NEW name.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const [clip, set] = process.argv.slice(2);
if (!clip || !set) { console.error("usage: node scripts/hero-frames.mjs <clip.mp4> <set-name>"); process.exit(1); }
const FRAMES = 241; // the scrub expects frame-000 … frame-240
const extractor = join(import.meta.dirname, "../../caldera/tools/frames");
if (!existsSync(extractor)) { console.error(`frames extractor not found at ${extractor}`); process.exit(1); }

const tmp = mkdtempSync(join(tmpdir(), "hero-"));
console.log("→ extracting 3840-wide JPEG frames");
execFileSync(extractor, [clip, tmp, "1", "src:3840:jpg:0.95"], { stdio: "inherit" });
const srcDir = join(tmp, "src");
const files = readdirSync(srcDir).filter((f) => f.endsWith(".jpg")).sort();
if (files.length < FRAMES) { console.error(`only ${files.length} frames in the clip; need ${FRAMES} (10 s at 24 fps)`); process.exit(1); }
// Spread 241 output frames evenly over the clip (a 10 s clip at 24 fps gives 240-241).
const pick = (i) => files[Math.round((i * (files.length - 1)) / (FRAMES - 1))];

const base = join("public/frames", set);
const hi = join("public/frames", `${set}-hi`);
mkdirSync(base, { recursive: true });
mkdirSync(hi, { recursive: true });
const pad = (i) => String(i).padStart(3, "0");
const jobs = [];
for (let i = 0; i < FRAMES; i++) {
  const src = join(srcDir, pick(i));
  jobs.push(() => sharp(src).resize({ width: 1600 }).webp({ quality: 76, effort: 5 }).toFile(join(base, `frame-${pad(i)}.webp`)));
  if (i % 2 === 0) jobs.push(() => sharp(src).resize({ width: 2560 }).webp({ quality: 74, effort: 5 }).toFile(join(hi, `frame-${pad(i)}.webp`)));
}
const t0 = Date.now();
for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map((j) => j()));
rmSync(tmp, { recursive: true, force: true });
console.log(`done: ${FRAMES} base + ${Math.ceil(FRAMES / 2)} hi frames in ${Math.round((Date.now() - t0) / 1000)} s → ${base}, ${hi}`);
