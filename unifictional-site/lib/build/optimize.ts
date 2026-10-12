// @ts-nocheck
// The "lighter" pass: same site to the pixel, fewer bytes.
//
//   1. Photos: every one of the company's own photos (and the logo) is fetched
//      once, resized to the widths the layouts use (480 / 960 / 1600) and
//      re-encoded as WebP, stored in Blob next to the build. Stock photos from
//      Unsplash already come from an image CDN with size parameters.
//   2. Markup: every <img> that points at an optimised photo gets srcset,
//      sizes, width/height (no layout shift), decoding="async" and, unless it
//      is the hero, loading="lazy". CSS background-image URLs are swapped too.
//   3. Assets: inline <style> and <script> blocks are minified (clean-css,
//      terser). Rules and logic are unchanged; only whitespace and comments go.
//
// Everything is best-effort: a photo that cannot be fetched or encoded keeps
// its original URL; a script that cannot be minified is left as is.
import { fetchBinary } from "./analyze";
import { buildPath, saveBinary, blobConfigured } from "./storage";

const WIDTHS = [640, 1280, 1920, 2560, 3840];
const QUALITY = 82;
const MAX_BYTES = 20 * 1024 * 1024;
const UA = "Mozilla/5.0 (compatible; UnifictionalBuilder/0.3; +https://unifictional.com)";

export interface OptimizedImage { src: string; srcset: string; width: number; height: number; before: number; after: number }
export interface WeightReport { images: { count: number; before: number; after: number; skipped: number }; html: { before: number; after: number }; seconds: number }

const isStock = (u) => /images\.unsplash\.com/.test(u);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, "0"); };

async function fetchBytes(url, timeout = 15000) {
  // as a browser would, and through the relay when the client's host blocks the build servers
  const got = await fetchBinary(url, { timeout, max: MAX_BYTES });
  if (!got) throw new Error("could not download");
  return got.buf;
}

/** Collect every image URL the spec will render (own photos only). */
export function collectImageUrls(spec) {
  const urls = new Set();
  const add = (u) => { if (u && /^https?:\/\//i.test(u) && !isStock(u) && !/\.svg(\?|$)/i.test(u)) urls.add(u); };
  if (spec.brand?.logo?.url) add(spec.brand.logo.url);
  for (const l of spec.nav?.links || []) add(l.image?.url);
  for (const p of spec.pages || []) for (const s of p.sections || []) {
    add(s.image?.url); (s.images || []).forEach(i => add(i.url)); (s.items || []).forEach(i => add(i.image?.url)); (s.slides || []).forEach(i => add(i.image?.url));
  }
  return [...urls];
}

/** Fetch, resize and re-encode one photo; returns null when it is not worth it. */
async function optimizeOne(url, id, sharp, isLogo = false): Promise<OptimizedImage | null> {
  const buf = await fetchBytes(url);
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) return null;
  const widths = isLogo ? [Math.min(meta.width, 480)] : WIDTHS.filter(w => w <= meta.width);
  if (!widths.length) widths.push(meta.width);
  if (!widths.includes(Math.min(meta.width, 3840)) && !isLogo) widths.push(Math.min(meta.width, 3840));
  const key = hash(url);
  const outs = [];
  for (const w of [...new Set(widths)].sort((a, b) => a - b)) {
    const out = await sharp(buf).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: isLogo ? 90 : QUALITY, effort: 4 }).toBuffer({ resolveWithObject: true });
    const u = await saveBinary(buildPath(id, `img/${key}-${w}.webp`), out.data, "image/webp");
    if (!u) return null;
    outs.push({ w: out.info.width, h: out.info.height, url: u, bytes: out.data.length });
  }
  const largest = outs[outs.length - 1];
  // WebP not actually smaller (already tiny or already optimised): keep the original bytes, but on our own storage,
  // so nothing on the site is served from the client's host (which may be slow, change, or block visitors from some networks)
  if (largest.bytes >= buf.length * 0.9 && outs.length === 1) {
    const fmt = meta.format || "jpeg"; const ext = fmt === "jpeg" ? "jpg" : fmt;
    const u = await saveBinary(buildPath(id, `img/${key}.${ext}`), buf, `image/${fmt === "jpg" ? "jpeg" : fmt}`);
    if (!u) return null;
    return { src: u, srcset: `${u} ${meta.width}w`, width: meta.width, height: meta.height, before: buf.length, after: buf.length };
  }
  // the default src is the 1920 rendition (or the largest below it); bigger screens pick 2560/3840 from srcset
  const def = outs.filter(o => o.w <= 1920).pop() || outs[0];
  return { src: def.url, srcset: outs.map(o => `${o.url} ${o.w}w`).join(", "), width: def.w, height: def.h, before: buf.length, after: def.bytes };
}

/**
 * Optimise every own photo in the spec. Mutates image objects in place
 * (url → WebP, plus srcset/width/height) and returns the map and a report.
 */
export async function optimizeImages(spec, id, { budgetMs = 150_000, concurrency = 3 } = {}) {
  const report = { count: 0, before: 0, after: 0, skipped: 0 };
  const map = new Map<string, OptimizedImage>();
  if (!blobConfigured()) return { map, report };
  let sharp;
  try { sharp = (await import("sharp")).default; } catch { return { map, report }; }
  // bounded memory: no libvips operation cache, two decode threads, and only a few
  // photos in flight at once (65 photos x 5 widths with six workers overflowed a 0.5 GB machine)
  try { sharp.cache(false); sharp.concurrency(2); } catch {}
  const urls = collectImageUrls(spec);
  const t0 = Date.now();
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (i < urls.length) {
      const url = urls[i++];
      if (Date.now() - t0 > budgetMs) { report.skipped++; continue; }
      try {
        const o = await optimizeOne(url, id, sharp, url === spec.brand?.logo?.url);
        if (o) { map.set(url, o); report.count++; report.before += o.before; report.after += o.after; } else report.skipped++;
      } catch { report.skipped++; }
    }
  }));
  // apply to the spec: every image object that points at an optimised url
  const apply = (img) => { if (!img || !img.url) return; const o = map.get(img.url); if (!o) return; img.original = img.url; img.url = o.src; img.srcset = o.srcset; img.width = o.width; img.height = o.height; };
  if (spec.brand?.logo?.url && map.has(spec.brand.logo.url)) { const o = map.get(spec.brand.logo.url); spec.brand.logo.original = spec.brand.logo.url; spec.brand.logo.url = o.src; }
  for (const l of spec.nav?.links || []) apply(l.image);
  for (const p of spec.pages || []) for (const s of p.sections || []) { apply(s.image); (s.images || []).forEach(apply); (s.items || []).forEach(it => apply(it.image)); (s.slides || []).forEach(it => apply(it.image)); }
  return { map, report };
}

/* ---------------------------------------------------------------- markup */
const SIZES = "(max-width: 767px) 100vw, (max-width: 1400px) 70vw, 2560px";

/** Add srcset/sizes/width/height/lazy to every <img> that uses an optimised photo. */
export function enhanceImages(html, map: Map<string, OptimizedImage>) {
  const bySrc = new Map([...map.values()].map(o => [o.src, o]));
  // images inside the opening section (the hero) stay eager; everything after it lazy-loads
  const firstSectionEnd = (() => { const m = html.indexOf("<main"); const e = html.indexOf("</section>", m < 0 ? 0 : m); return e < 0 ? html.length : e; })();
  return html.replace(/<img\b([^>]*)>/gi, (tag, attrs, offset) => {
    const src = (attrs.match(/\bsrc=["']([^"']+)["']/i) || [])[1];
    const o = src && bySrc.get(src);
    let a = attrs;
    if (o) {
      if (!/\bsrcset=/.test(a)) a += ` srcset="${o.srcset}"`;
      if (!/\bsizes=/.test(a)) a += ` sizes="${SIZES}"`;
      if (!/\bwidth=/.test(a)) a += ` width="${o.width}" height="${o.height}"`;
    }
    if (!/\bdecoding=/.test(a)) a += ` decoding="async"`;
    const aboveFold = offset <= firstSectionEnd || /fetchpriority=["']high["']/.test(a);
    if (!/\bloading=/.test(a) && !aboveFold) a += ` loading="lazy"`;
    return `<img${a}>`;
  });
}

/* ---------------------------------------------------------------- assets */
let cleanCss = null, terser = null;
export async function minifyAssets(html) {
  try { if (!cleanCss) { const CleanCSS = (await import("clean-css")).default; cleanCss = new CleanCSS({ level: 1, returnPromise: false }); } } catch { cleanCss = null; }
  try { if (!terser) terser = await import("terser"); } catch { terser = null; }
  let out = html;
  if (cleanCss) out = out.replace(/<style>([\s\S]*?)<\/style>/g, (m, css) => { try { const r = cleanCss.minify(css); return r.errors?.length ? m : `<style>${r.styles}</style>`; } catch { return m; } });
  if (terser) {
    const jobs = [];
    out.replace(/<script(\s+type="module")?>([\s\S]*?)<\/script>/g, (m, mod, js) => { if (!/^\s*\{/.test(js)) jobs.push({ m, mod: Boolean(mod), js }); return m; });
    for (const j of jobs) {
      try {
        const r = await terser.minify(j.js, { module: j.mod, ecma: 2017, compress: { passes: 1, drop_debugger: true }, mangle: j.mod ? { toplevel: false } : true, format: { comments: false } });
        // function replacer: a string replacement would expand "$&", "$1"… inside the minified code (terser names variables "$"), which cut a hero script mid-line
        if (r.code) { const tag = `<script${j.mod ? ' type="module"' : ""}>${r.code}</script>`; out = out.replace(j.m, () => tag); }
      } catch { /* keep the original script */ }
    }
  }
  return out;
}

export const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
export const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
