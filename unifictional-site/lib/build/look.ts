// @ts-nocheck
// Look before deciding. The strategist gets to see the company the way a
// designer would: screenshots of their current site (home and the two most
// telling inner pages) and a contact sheet of their best real photos. Those
// images go into the hook call so the hook, the flagship and the photo the
// video is made from are chosen by looking, not by reading alt text.
// Stored under builds/<id>/look/. Never throws: a site that will not
// screenshot simply gives the strategist fewer pictures.
import { buildPath, saveBinary } from "./storage";
import { fetchBinary } from "./analyze";

export interface LookShot { label: string; url: string; data: string }

async function jpeg(png: Buffer, width = 1200, quality = 70) {
  const sharp = (await import("sharp")).default;
  return sharp(png).resize({ width, withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
}

/** Screenshots of their current site: home (top and mid) plus up to two inner pages. */
export async function lookAtSite(job, stamp = () => {}): Promise<LookShot[]> {
  const out: LookShot[] = [];
  const url = job.lead?.website; if (!url) return out;
  let pw; try { pw = await import("playwright"); } catch { return out; }
  const browser = await pw.chromium.launch({ args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const pages = [url, ...((job.analysis?.pagesRead || job.analysis?.pages?.map(p => p.url) || []).filter(u => /about|work|project|gallery|service|portfolio/i.test(u)).slice(0, 2))];
    for (let i = 0; i < pages.length; i++) {
      try {
        await page.goto(pages[i], { waitUntil: "networkidle", timeout: 45_000 }).catch(() => page.goto(pages[i], { waitUntil: "load", timeout: 30_000 }));
        await page.waitForTimeout(1200);
        const shots = i === 0 ? [["their site: home, top", 0], ["their site: home, scrolled", 900]] : [[`their site: ${new URL(pages[i]).pathname}`, 0]];
        for (const [label, y] of shots) {
          if (y) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(600); }
          const jpg = await jpeg(await page.screenshot({ type: "png" }));
          const stored = await saveBinary(buildPath(job.id, `look/site-${i}-${y ? "mid" : "top"}.jpg`), jpg, "image/jpeg");
          out.push({ label, url: stored || "", data: jpg.toString("base64") });
        }
      } catch (e) { stamp(`could not screenshot ${pages[i]}: ${e?.message || e}`); }
    }
    await context.close();
  } finally { await browser.close().catch(() => {}); }
  stamp(`looked at their site: ${out.length} screenshot${out.length === 1 ? "" : "s"}`);
  return out;
}

/** The company's best real photos, each as a small JPEG the strategist can see (up to `max`). */
export async function photoSheet(job, max = 10, stamp = () => {}): Promise<LookShot[]> {
  const photos = (job.dossier?.photos || []).filter(p => p && /^https?:\/\//.test(p.url));
  const pick = [...photos.filter(p => p.use === "hero"), ...photos.filter(p => p.use === "project"), ...photos.filter(p => p.use !== "hero" && p.use !== "project")].slice(0, max);
  const out: LookShot[] = [];
  for (const p of pick) {
    try {
      const got = await fetchBinary(p.url, { timeout: 12_000 });
      if (!got) continue;
      const buf = got.buf;
      if (buf.length < 2000 || buf.length > 25 * 1024 * 1024) continue;
      const jpg = await jpeg(buf, 900, 62);
      out.push({ label: `photo ${out.length + 1}: ${p.url}${p.alt ? " · " + p.alt : ""}`, url: p.url, data: jpg.toString("base64") });
    } catch {}
  }
  stamp(`photo sheet: ${out.length} of their photos ready for the strategist`);
  return out;
}

/** Content blocks for a vision call: label then image, for each shot. */
export function imageBlocks(shots: LookShot[]) {
  return shots.flatMap(s => [{ type: "text", text: `[${s.label}]` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: s.data } }]);
}
