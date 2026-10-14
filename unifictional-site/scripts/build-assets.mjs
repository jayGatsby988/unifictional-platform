// Generates lightweight image variants at build time (runs before `next build`).
// Originals stay the single source of truth; nothing generated needs committing.
//
//  • Portrait hero frames — phones only ever see the middle ~35% of the 16:9
//    footage, so they get a centre crop (same framing, same sharpness) at about
//    a third of the bytes and a third of the decoded memory per frame.
//  • Work-carousel thumbnails — 360px copies instead of full 1280px screenshots.
//  • Process backgrounds — WebP versions of the two JPEGs.
//
// Idempotent: existing outputs are skipped. Fails the build loudly if an output
// can't be produced, so a deploy can never ship pages pointing at missing files.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const PUB = "public";
const jobs = [];

// 1) Portrait hero frames: every 4th frame (the phone scrub set) + the last one,
//    cropped from the 2560-wide hi set so a 3x phone (390 css px → 1170 px) is sharp.
const FRAMES = join(PUB, "frames/unifictional-v4-hi");
const PORTRAIT = join(PUB, "frames/unifictional-v4-portrait");
const CROP_W = 1120; // covers any viewport narrower than 5:8 (all phones, portrait) at 3x
mkdirSync(PORTRAIT, { recursive: true });
for (let i = 0; i <= 240; i += 4) {
  const name = `frame-${String(i).padStart(3, "0")}.webp`;
  const out = join(PORTRAIT, name);
  if (existsSync(out)) continue;
  jobs.push(async () => {
    const img = sharp(join(FRAMES, name));
    const { width, height } = await img.metadata();
    const w = Math.min(CROP_W, width);
    await img
      .extract({ left: Math.round((width - w) / 2), top: 0, width: w, height })
      .webp({ quality: 74, effort: 5 })
      .toFile(out);
  });
}

// 2) Carousel thumbnails.
const SHOW = join(PUB, "showcase");
const THUMBS = join(SHOW, "thumbs");
mkdirSync(THUMBS, { recursive: true });
for (const f of readdirSync(SHOW).filter((f) => f.endsWith(".webp"))) {
  const out = join(THUMBS, f);
  if (existsSync(out)) continue;
  jobs.push(() =>
    sharp(join(SHOW, f)).resize({ width: 360 }).webp({ quality: 72 }).toFile(out)
  );
}

// 3) Process page backgrounds.
for (const n of ["bg-1", "bg-2"]) {
  const out = join(PUB, "process", `${n}.webp`);
  if (existsSync(out)) continue;
  jobs.push(() => sharp(join(PUB, "process", `${n}.jpg`)).webp({ quality: 74 }).toFile(out));
}

const t0 = Date.now();
for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map((j) => j()));
console.log(`build-assets: ${jobs.length} image variants generated in ${Date.now() - t0}ms`);
