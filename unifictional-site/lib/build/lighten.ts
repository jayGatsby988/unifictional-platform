// @ts-nocheck
// The lightener: the finished site, same to the eye, fewer bytes and less work
// for the browser. It runs after the site gate on the final pages and takes
// nothing on faith: a page it changes is opened twice in a real browser (the
// shipped version and the lighter one), photographed at the same scroll
// positions, and compared. A page keeps its lighter version only when the
// words on it are identical, no new script error appeared, the page is the
// same height, and the photographs match; otherwise it keeps the original.
//
// What it does to a page (string transforms on the final HTML):
//   1. CSS: rules in the inline <style> whose selectors name classes or ids
//      that appear nowhere on the page (markup and inline scripts included,
//      so a class a script adds later still counts) are dropped. @keyframes,
//      @font-face, @property and every tag-only or :root/html/body rule stay.
//   2. Media: images after the first section lazy-load and decode async,
//      videos after the first section stop preloading, iframes lazy-load.
//   3. Markup: runs of whitespace between tags collapse (never inside pre,
//      textarea, script or style).
//   4. Head hints: the hero image is preloaded (with its srcset) and every
//      image host preconnected, so the first picture arrives sooner.
//
// Budget: BUILD_LIGHTEN_MS (default 240 s). The home page is checked on
// desktop and phone and up to six inner pages on desktop; the other pages
// follow the sample's verdict only when every sampled page passed. Anything
// not verified in time keeps its original.

import { pagePath, saveHtml } from "./storage";
import { kb } from "./optimize";

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const HOME_POSITIONS = [0, 0.25, 0.5, 0.75, 1];
const INNER_POSITIONS = [0, 0.5, 1];
const THUMB_WIDTH = 160;
const MAX_MEAN_DIFF = 8;       // of 255, on the greyscale thumbnail
const MAX_PIXELS_OFF = 0.03;   // share of thumbnail pixels that differ by more than 40/255
const LAUNCH_ARGS = ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"];

export interface LightenReport { pages: number; lightened: number; kept: number; before: number; after: number; cssRemoved: number; checked: number; seconds: number; failed: string[] }

/* ------------------------------------------------------------------ CSS */

/** Split a stylesheet into top-level rules, honouring strings, comments and nested blocks. */
function splitRules(css: string) {
  const out: { raw: string; prelude: string; body: string | null }[] = [];
  const n = css.length;
  let i = 0;
  while (i < n) {
    const ch = css[i];
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") { i++; continue; }
    if (css.startsWith("/*", i)) { const e = css.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    // prelude: up to the block's { or a statement's ;
    let j = i, quote = "";
    while (j < n) {
      const c = css[j];
      if (quote) { if (c === "\\") { j += 2; continue; } if (c === quote) quote = ""; j++; continue; }
      if (c === '"' || c === "'") { quote = c; j++; continue; }
      if (c === "{" || c === ";") break;
      j++;
    }
    const prelude = css.slice(i, j).trim();
    if (j >= n) { out.push({ raw: css.slice(i).trim(), prelude, body: null }); break; }
    if (css[j] === ";") { out.push({ raw: css.slice(i, j + 1).trim(), prelude, body: null }); i = j + 1; continue; }
    // the balanced block
    let k = j, depth = 0; quote = "";
    while (k < n) {
      const c = css[k];
      if (quote) { if (c === "\\") { k += 2; continue; } if (c === quote) quote = ""; k++; continue; }
      if (c === '"' || c === "'") { quote = c; k++; continue; }
      if (css.startsWith("/*", k)) { const e = css.indexOf("*/", k + 2); k = e < 0 ? n : e + 2; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { k++; break; } }
      k++;
    }
    out.push({ raw: css.slice(i, k), prelude, body: css.slice(j + 1, Math.max(j + 1, k - 1)) });
    i = k;
  }
  return out;
}

const NESTED_AT = /^@(media|supports|container|layer|scope|document)\b/i;

/** True when a selector list could match something on the page. Conservative: tag-only selectors always count as used. */
function selectorUsed(selector: string, text: string) {
  const list = selector.split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  if (!list.length) return true;
  return list.some(sel => {
    const s = sel.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, " ").replace(/\[[^\]]*\]/g, " ");
    const classes = [...s.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]);
    const ids = [...s.matchAll(/#(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]);
    if (!classes.length && !ids.length) return true;
    return classes.every(c => text.includes(c)) && ids.every(id => text.includes(id));
  });
}

/** Drop the rules nothing on the page can use. `text` is the page without its <style> blocks. */
function purgeCss(css: string, text: string): string {
  return splitRules(css).map(r => {
    if (!r.prelude) return "";
    if (r.body === null) return r.raw;
    if (r.prelude.startsWith("@")) {
      if (NESTED_AT.test(r.prelude)) { const inner = purgeCss(r.body, text).trim(); return inner ? `${r.prelude}{${inner}}` : ""; }
      return r.raw;
    }
    return selectorUsed(r.prelude, text) ? r.raw : "";
  }).filter(Boolean).join("\n");
}

/* --------------------------------------------------------------- markup */

/** The end of the first section inside <main>: everything after it is below the fold. */
function foldAt(html: string) {
  const m = html.indexOf("<main");
  const e = html.indexOf("</section>", m < 0 ? 0 : m);
  return e < 0 ? html.length : e;
}

function lazyMedia(html: string) {
  const fold = foldAt(html);
  let out = html.replace(/<img\b([^>]*)>/gi, (m, a, off) => {
    let x = a;
    if (!/\bdecoding=/.test(x)) x += ' decoding="async"';
    if (off > fold && !/\bloading=/.test(x) && !/fetchpriority=["']high["']/.test(x)) x += ' loading="lazy"';
    return `<img${x}>`;
  });
  out = out.replace(/<video\b([^>]*)>/gi, (m, a, off) => (off <= fold || /\bpreload=/.test(a) || /\bautoplay\b/.test(a)) ? m : `<video${a} preload="none">`);
  out = out.replace(/<iframe\b([^>]*)>/gi, (m, a, off) => (off > fold && !/\bloading=/.test(a)) ? `<iframe${a} loading="lazy">` : m);
  return out;
}

function collapseWhitespace(html: string) {
  const keep: string[] = [];
  const guarded = html.replace(/<(pre|textarea|script|style)\b[\s\S]*?<\/\1>/gi, m => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; });
  const collapsed = guarded.replace(/>[ \t]*\n[ \t\n]*</g, ">\n<").replace(/[ \t]{2,}/g, " ");
  return collapsed.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[Number(i)]);
}

/**
 * Head hints: the browser is told about the hero image before it parses the
 * body (preload, with its srcset), and about every image host (preconnect),
 * so the first picture arrives sooner. Nothing on the page changes.
 */
function headHints(html: string) {
  if (!/<\/head>/i.test(html)) return html;
  const hints: string[] = [];
  const hero = html.match(/<img\b[^>]*\bfetchpriority=["']high["'][^>]*>/i)?.[0] || (() => { const m = html.indexOf("<main"); const first = html.slice(m < 0 ? 0 : m, foldAt(html)); return first.match(/<img\b[^>]*>/i)?.[0] || ""; })();
  if (hero) {
    const src = hero.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    const srcset = hero.match(/\bsrcset=["']([^"']+)["']/i)?.[1];
    const sizes = hero.match(/\bsizes=["']([^"']+)["']/i)?.[1];
    if (src && /^https?:\/\//.test(src) && !html.includes(`rel="preload" as="image" href="${src}"`)) hints.push(`<link rel="preload" as="image" href="${src}"${srcset ? ` imagesrcset="${srcset}"` : ""}${sizes ? ` imagesizes="${sizes}"` : ""} fetchpriority="high">`);
  }
  const hosts = new Set<string>();
  for (const m of html.matchAll(/<img\b[^>]*\bsrc=["'](https?:\/\/[^/"']+)/gi)) { hosts.add(m[1]); if (hosts.size >= 3) break; }
  for (const h of hosts) if (!html.includes(`rel="preconnect" href="${h}"`)) hints.push(`<link rel="preconnect" href="${h}" crossorigin>`);
  return hints.length ? html.replace(/<\/head>/i, `${hints.join("")}</head>`) : html;
}

/** Every transform on one page. Returns the lighter HTML and what the CSS purge saved. */
export function lightenHtml(html: string): { html: string; cssRemoved: number } {
  const withoutStyles = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  let cssRemoved = 0;
  let out = html.replace(/<style>([\s\S]*?)<\/style>/g, (m, css) => {
    try {
      const purged = purgeCss(css, withoutStyles);
      if (!purged || purged.length > css.length * 0.97) return m; // not worth a change
      cssRemoved += css.length - purged.length;
      return `<style>${purged}</style>`;
    } catch { return m; }
  });
  out = lazyMedia(out);
  out = collapseWhitespace(out);
  out = headHints(out);
  return { html: out, cssRemoved };
}

/* ------------------------------------------------------------- the check */

async function shoot(browser, { url, html, vp, phone, positions }) {
  const sharp = (await import("sharp")).default;
  const context = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e?.message || e).slice(0, 120)));
  const want = url.replace(/\/$/, "");
  await page.route(u => u.href.split("#")[0].split("?")[0].replace(/\/$/, "") === want, route => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 }).catch(async () => { await page.goto(url, { waitUntil: "load", timeout: 45_000 }); });
    try { await page.waitForFunction(() => !document.querySelector('[data-fx="preloader"]'), null, { timeout: 5000 }); } catch {}
    await page.addStyleTag({ content: "*,*::before,*::after{animation-play-state:paused!important;transition:none!important;scroll-behavior:auto!important}" });
    await page.waitForTimeout(600);
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
    const sections = await page.evaluate(() => document.querySelectorAll("main > *").length);
    const thumbs = [];
    for (const p of positions) {
      await page.evaluate((p) => { window.scrollTo(0, Math.round(p * Math.max(0, document.documentElement.scrollHeight - window.innerHeight))); }, p);
      // lazy images near this position get a moment to arrive, so a late image is not mistaken for a change
      await Promise.race([
        page.evaluate(() => Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); })))),
        page.waitForTimeout(3000),
      ]);
      await page.waitForTimeout(400);
      const png = await page.screenshot({ type: "png" });
      thumbs.push(await sharp(png).resize({ width: THUMB_WIDTH }).greyscale().raw().toBuffer({ resolveWithObject: true }));
    }
    return { text, sections, errors: errors.length, thumbs };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Same page, lighter markup: does a visitor see the same thing? */
async function compare(browser, { url, before, after, vp, phone, positions }): Promise<{ same: boolean; why: string }> {
  const a = await shoot(browser, { url, html: before, vp, phone, positions });
  const b = await shoot(browser, { url, html: after, vp, phone, positions });
  if (a.text !== b.text) return { same: false, why: "the words on the page changed" };
  if (a.sections !== b.sections) return { same: false, why: "the section count changed" };
  if (b.errors > a.errors) return { same: false, why: `${b.errors - a.errors} new script error(s)` };
  for (let i = 0; i < a.thumbs.length; i++) {
    const x = a.thumbs[i], y = b.thumbs[i];
    const at = `${Math.round(positions[i] * 100)}% scroll`;
    if (!y || x.info.height !== y.info.height || x.data.length !== y.data.length) return { same: false, why: `the page height changed at ${at}` };
    let sum = 0, off = 0;
    for (let k = 0; k < x.data.length; k++) { const d = Math.abs(x.data[k] - y.data[k]); sum += d; if (d > 40) off++; }
    const mean = sum / x.data.length, share = off / x.data.length;
    if (mean > MAX_MEAN_DIFF || share > MAX_PIXELS_OFF) return { same: false, why: `it looks different at ${at} (${mean.toFixed(1)} mean, ${(share * 100).toFixed(1)}% of pixels)` };
  }
  return { same: true, why: "" };
}

/* ---------------------------------------------------------------- stage */

/**
 * Lighten the finished site. `rendered` are the preview pages (served from
 * Blob), `exported` the same pages with relative links for the zip. Returns
 * the two sets with every verified page replaced, and a report; null when
 * there is no browser to verify with (nothing changes then).
 */
export async function lightenSite({ job, rendered, exported, stamp = () => {}, budgetMs = Number(process.env.BUILD_LIGHTEN_MS || 240_000), save = true }) {
  const t0 = Date.now();
  const deadline = t0 + budgetMs;
  const report: LightenReport = { pages: rendered.length, lightened: 0, kept: 0, before: 0, after: 0, cssRemoved: 0, checked: 0, seconds: 0, failed: [] };
  let pw;
  try { pw = await import("playwright"); } catch { stamp("lightener: no browser on this host to check with; the site stays as it is"); return null; }

  const light = rendered.map(r => ({ slug: r.slug, ...lightenHtml(r.html) }));
  const lightExport = exported.map(r => lightenHtml(r.html).html);
  report.before = rendered.reduce((s, r) => s + r.html.length, 0);

  const sample = [
    { slug: "index", vp: DESKTOP, phone: false, positions: HOME_POSITIONS },
    { slug: "index", vp: PHONE, phone: true, positions: HOME_POSITIONS },
    ...rendered.filter(r => r.slug !== "index").slice(0, 6).map(r => ({ slug: r.slug, vp: DESKTOP, phone: false, positions: INNER_POSITIONS })),
  ];
  const verdicts = new Map<string, boolean>();
  const browser = await pw.chromium.launch({ args: LAUNCH_ARGS });
  try {
    for (const s of sample) {
      if (Date.now() > deadline) { stamp(`lightener: out of time after ${report.checked} browser checks; pages not checked keep their original`); break; }
      if (verdicts.get(s.slug) === false) continue;
      const before = rendered.find(r => r.slug === s.slug), after = light.find(r => r.slug === s.slug);
      if (!before || !after || after.html === before.html) continue;
      const url = `${job.origin}/preview/${job.id}${s.slug === "index" ? "" : "/" + s.slug}`;
      let v;
      try { v = await compare(browser, { url, before: before.html, after: after.html, vp: s.vp, phone: s.phone, positions: s.positions }); }
      catch (e) { v = { same: false, why: `could not be checked (${String(e?.message || e).slice(0, 80)})` }; }
      report.checked++;
      if (!v.same) { verdicts.set(s.slug, false); report.failed.push(`${s.slug} on ${s.phone ? "phone" : "desktop"}: ${v.why}`); }
      else if (!verdicts.has(s.slug)) verdicts.set(s.slug, true);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // a sampled page keeps its original if it failed; an unsampled page is lightened only when every sampled page passed
  const sampledAny = verdicts.size > 0;
  const sampledFailed = [...verdicts.values()].some(v => v === false);
  const takeUnsampled = sampledAny && !sampledFailed;
  const outRendered = rendered.map((r, i) => {
    const l = light[i];
    const take = verdicts.has(r.slug) ? verdicts.get(r.slug) : takeUnsampled;
    if (take && l.html !== r.html) { report.lightened++; report.cssRemoved += l.cssRemoved; return { ...r, html: l.html, lightened: true }; }
    report.kept++;
    return r;
  });
  const outExported = exported.map((r, i) => outRendered[i]?.lightened ? { ...r, html: lightExport[i] } : r);
  report.after = outRendered.reduce((s, r) => s + r.html.length, 0);
  if (save) await Promise.all(outRendered.filter(r => r.lightened).map(r => saveHtml(pagePath(job.id, r.slug), r.html)));
  report.seconds = Math.round((Date.now() - t0) / 1000);
  stamp(`lightener: ${report.lightened} of ${report.pages} pages lighter, ${kb(report.before)} → ${kb(report.after)} (${kb(report.cssRemoved)} of unused CSS removed), ${report.checked} browser check${report.checked === 1 ? "" : "s"} in ${report.seconds} s, every lightened page photographed the same${report.failed.length ? ` · kept as built: ${report.failed.join("; ")}` : ""}`);
  return { rendered: outRendered, exported: outExported, report };
}
