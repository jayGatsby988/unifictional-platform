// @ts-nocheck
// The browser inspection: a real headless Chromium opens the rendered site
// (served from Blob through /preview/<id>), scrolls through every page the
// way a visitor would, and reports what a person would see: script errors,
// broken images, horizontal overflow, text clipped off screen, sections that
// render blank, a missing h1 or logo. It also takes the screenshots the
// judge looks at (top of each page, every home-page section, the phone view).
//
// Runs on Trigger.dev (Playwright is installed there by the build extension).
// Anywhere Playwright is not available the inspection throws, and the build
// fails closed: a site nobody looked at is never sent.
import { buildPath, saveBinary } from "./storage";

export interface SectionShot { index: number; type: string; url: string; blank: boolean }
export interface PageInspection {
  slug: string; viewport: "desktop" | "phone"; url: string; loadError?: string;
  longFramePct?: number; frames?: number; weightMB?: number; brokenLinks?: string[];
  consoleErrors: string[]; brokenImages: string[]; overflowPx: number; overflowBy: string[];
  clippedText: string[]; blankSections: { index: number; type: string }[]; hasH1: boolean;
  logoExpected: boolean; logoInNav: boolean; tinyText: number; sections: number;
  shots: { name: string; url: string; data?: string }[];
}
export interface InspectionReport { round: number; pages: PageInspection[]; seconds: number; shots: number }

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function loadPlaywright() {
  try { return await import("playwright"); } catch { throw new Error("browser inspection is not available on this host (Playwright is not installed); the build cannot be checked, so it is not sent"); }
}

/** JPEG the judge can read, capped at 1400px wide; returns {buf, b64}. */
async function toJpeg(png: Buffer, maxWidth = 1400) {
  const sharp = (await import("sharp")).default;
  const buf = await sharp(png).resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  return buf;
}
/** A section is blank when its pixels barely vary (one flat colour) although it has content to show. */
async function isBlank(png: Buffer) {
  try {
    const sharp = (await import("sharp")).default;
    const st = await sharp(png).greyscale().stats();
    return (st.channels?.[0]?.stdev ?? 99) < 3;
  } catch { return false; }
}

const IN_PAGE = {
  /** scroll through the page with wheel-like steps so every ScrollTrigger runs */
  prime: `(async () => { const L = window.__fx && window.__fx.lenis; const H = () => document.documentElement.scrollHeight; const step = Math.round(window.innerHeight * 0.6); for (let y = 0; y < H() + step; y += step) { if (L) L.scrollTo(y, { immediate: true }); else window.scrollTo(0, y); await new Promise(r => setTimeout(r, 90)); } if (window.ScrollTrigger) ScrollTrigger.update(); if (L) L.scrollTo(0, { immediate: true }); else window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 400)); })()`,
  goto: (y) => `(async () => { const L = window.__fx && window.__fx.lenis; if (L) L.scrollTo(${y}, { immediate: true }); else window.scrollTo(0, ${y}); await new Promise(r => setTimeout(r, 650)); if (window.ScrollTrigger) ScrollTrigger.update(); await new Promise(r => setTimeout(r, 150)); })()`,
  sections: `(() => { const all = [...document.querySelectorAll('section')].filter(s => !s.parentElement.closest('section')); return all.map((s, i) => { const r = s.getBoundingClientRect(); const top = r.top + window.scrollY; const pin = s.closest('.pin-spacer'); const pr = pin ? pin.getBoundingClientRect() : null; return { index: i, type: s.dataset.fx || s.className.split(' ')[0] || s.tagName.toLowerCase(), top: pin ? pr.top + window.scrollY : top, height: pin ? pr.height : r.height, text: (s.innerText || '').trim().length, imgs: s.querySelectorAll('img, video, canvas').length }; }); })()`,
  /** scroll like a visitor for ~3 s while counting frames; long frames (>50 ms) are stutter */
  smooth: `(async () => { const L = window.__fx && window.__fx.lenis; const H = document.documentElement.scrollHeight - window.innerHeight; if (L) L.scrollTo(0, { immediate: true }); else window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 300)); let frames = 0, long = 0, last = performance.now(); const t0 = last; let running = true; const tick = (t) => { frames++; if (t - last > 50) long++; last = t; if (running) requestAnimationFrame(tick); }; requestAnimationFrame(tick); const dur = 3200; while (performance.now() - t0 < dur) { const y = Math.min(H, (performance.now() - t0) / dur * Math.min(H, 6000)); if (L) L.scrollTo(y, { immediate: true }); else window.scrollTo(0, y); await new Promise(r => setTimeout(r, 16)); } running = false; await new Promise(r => setTimeout(r, 50)); const res = performance.getEntriesByType('resource'); const bytes = res.reduce((a, r) => a + (r.transferSize || r.encodedBodySize || 0), 0); return { frames, long, longPct: frames ? Math.round(long / frames * 1000) / 10 : 0, weightMB: Math.round(bytes / 1048576 * 10) / 10 }; })()`,
  links: `(() => [...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href') || '').filter(h => h && !h.startsWith('#') && !/^(mailto:|tel:|javascript:)/.test(h)).map(h => { try { return new URL(h, location.href).href; } catch { return ''; } }).filter(h => h && h.startsWith(location.origin)))])`,
  checks: (logoExpected) => `(() => {
    const W = window.innerWidth;
    // overflow = visible content past the right (or left) edge that nothing clips: fixed overlays and anything inside an
    // overflow-hidden/clip/auto wrapper (marquees, pinned stages) cannot widen the page, so they are skipped
    const clippedOrFixed = (el) => { if (getComputedStyle(el).position === 'fixed') return true; for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.position === 'fixed') return true; const ox = cs.overflowX; if (ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll') return true; } return false; };
    let overflowPx = 0; const offenders = [];
    if (document.documentElement.scrollWidth > W + 2) {
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('script, style, template')) continue;
        const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
        const over = Math.max(r.right - W, -r.left); if (over <= 2) continue;
        if (clippedOrFixed(el)) continue;
        if (over > overflowPx) overflowPx = over;
        if (offenders.length < 5) offenders.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + ' +' + Math.round(over) + 'px');
      }
    }
    const clipped = [];
    for (const el of document.querySelectorAll('h1, h2, .display, .letters')) { if (el.closest('.marquee, [data-fx*="marquee"], [data-fx*="loop"], [data-fx*="strip"], [data-fx*="echo"], [data-fx*="streak"], [data-fx*="curve"], [data-fx*="falling"], [data-fx*="repel"], [data-fx*="wave"]')) continue; const r = el.getBoundingClientRect(); if (r.width < 20) continue; if ((r.left < -4 || r.right > W + 4) && Math.abs(r.top) < 3000) clipped.push((el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60)); }
    const broken = [...document.images].filter(i => i.src && !i.src.startsWith('data:') && i.complete && i.naturalWidth === 0 && i.getBoundingClientRect().width > 8).map(i => i.src.split('/').pop().slice(0, 50)).slice(0, 6);
    const hasH1 = !!document.querySelector('h1');
    const nav = document.querySelector('header, nav, [data-fx*="menu"], .menu, .nav');
    const logoInNav = !!(nav && [...nav.querySelectorAll('img, svg')].some(i => i.getBoundingClientRect().width > 12));
    let tiny = 0; for (const el of document.querySelectorAll('p, li, a, span')) { if (el.children.length) continue; const t = (el.textContent || '').trim(); if (t.length < 12) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs && fs < 12) tiny++; if (tiny > 50) break; }
    return { overflowPx: Math.round(overflowPx), overflowBy: offenders, clippedText: [...new Set(clipped)], brokenImages: broken, hasH1, logoInNav, logoExpected: ${logoExpected ? "true" : "false"}, tinyText: tiny };
  })()`,
};

/**
 * Inspect the rendered site. `pages` are the slugs to open; home gets the
 * full treatment (every section photographed) on desktop and phone, the
 * other pages get their top and a scroll-through. Screenshots go to Blob
 * under builds/<id>/qa/<round>/ and come back with base64 data for the judge.
 */
export async function inspectSite(opts: { id: string; origin: string; slugs: string[]; logoExpected: boolean; round: number; stamp?: (s: string) => void; maxInner?: number; homeOnly?: boolean; checkLinks?: boolean }): Promise<InspectionReport> {
  const { id, origin, slugs, logoExpected, round, stamp = () => {} } = opts;
  const checked = new Map<string, number>(); // link url → status, shared across pages
  const t0 = Date.now();
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const report: InspectionReport = { round, pages: [], seconds: 0, shots: 0 };
  const inner = opts.homeOnly ? [] : slugs.filter(s => s !== "index").slice(0, opts.maxInner ?? 6);
  const plan: { slug: string; viewport: "desktop" | "phone"; full: boolean }[] = [
    { slug: "index", viewport: "desktop", full: true },
    ...inner.map(slug => ({ slug, viewport: "desktop" as const, full: false })),
    { slug: "index", viewport: "phone", full: true },
    ...inner.slice(0, 2).map(slug => ({ slug, viewport: "phone" as const, full: false })),
  ];
  const save = async (name: string, png: Buffer) => {
    const jpg = await toJpeg(png);
    const url = await saveBinary(buildPath(id, `qa/${round}/${name}.jpg`), jpg, "image/jpeg");
    report.shots++;
    return { name, url: url || "", data: jpg.toString("base64") };
  };
  try {
    for (const item of plan) {
      const vp = item.viewport === "phone" ? PHONE : DESKTOP;
      const context = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: item.viewport === "phone", hasTouch: item.viewport === "phone", userAgent: item.viewport === "phone" ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 UnifictionalQA" : undefined });
      const page = await context.newPage();
      const url = `${origin}/preview/${id}${item.slug === "index" ? "" : "/" + item.slug}`;
      const pi: PageInspection = { slug: item.slug, viewport: item.viewport, url, consoleErrors: [], brokenImages: [], overflowPx: 0, overflowBy: [], clippedText: [], blankSections: [], hasH1: false, logoExpected, logoInNav: false, tinyText: 0, sections: 0, shots: [] };
      page.on("console", m => { if (m.type() === "error") { const t = m.text(); if (!/favicon|net::ERR_|Failed to load resource|third-party cookie|preload/i.test(t)) pi.consoleErrors.push(t.slice(0, 200)); } });
      page.on("pageerror", e => pi.consoleErrors.push(String(e?.message || e).slice(0, 200)));
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 75_000 }).catch(async () => { await page.goto(url, { waitUntil: "load", timeout: 60_000 }); });
        await page.waitForTimeout(1200);
        // a preloader pill plays on first load; the visitor sees the page after it, so the inspection does too
        try { await page.waitForFunction(() => !document.querySelector('[data-fx="preloader"]'), null, { timeout: 5000 }); } catch {}
        await page.waitForTimeout(400);
        const tag = `${item.slug === "index" ? "home" : item.slug.replace(/\//g, "-")}-${item.viewport}`;
        pi.shots.push(await save(`${tag}-top`, await page.screenshot({ type: "png" })));
        // top-of-page checks before any scrolling (the hero as a visitor first sees it)
        const first = await page.evaluate(IN_PAGE.checks(logoExpected));
        Object.assign(pi, { overflowPx: first.overflowPx, overflowBy: first.overflowBy, clippedText: first.clippedText, hasH1: first.hasH1, logoInNav: first.logoInNav, tinyText: first.tinyText });
        // scroll through everything, then inspect each section where it sits
        await page.evaluate(IN_PAGE.prime);
        const sections = await page.evaluate(IN_PAGE.sections);
        pi.sections = sections.length;
        const vh = vp.height;
        const toShoot = item.full ? sections : sections.slice(0, 3);
        for (const s of toShoot) {
          if (s.height < 40 || (s.text < 20 && s.imgs === 0)) continue;
          const tall = s.height > vh * 1.4;
          // scrub reveals finish once a section's bottom passes ~40% of the viewport, so a normal section is photographed
          // with its bottom at 55% (never scrolled more than 10% above its top); tall pinned sections are sampled three times
          const ys = tall ? [s.top + 40, s.top + s.height * 0.45, s.top + Math.max(0, s.height - vh)] : [Math.max(s.top - vh * 0.1, s.top + s.height - vh * 0.55)];
          let blankAll = true, chosen = null;
          for (const y of ys) {
            await page.evaluate(IN_PAGE.goto(Math.max(0, Math.round(y))));
            const png = await page.screenshot({ type: "png" });
            const blank = await isBlank(png);
            if (!blank) blankAll = false;
            if (!chosen || !blank) chosen = png;
            if (!blank && !tall) break;
          }
          if (blankAll) pi.blankSections.push({ index: s.index, type: s.type });
          if (item.full || blankAll) pi.shots.push(await save(`${tag}-s${String(s.index + 1).padStart(2, "0")}-${s.type.replace(/[^a-z0-9-]/gi, "")}`, chosen));
        }
        // smoothness and weight, measured the way a visitor would feel them (desktop only; phones get the static layouts)
        if (item.viewport === "desktop") {
          try { const sm = await page.evaluate(IN_PAGE.smooth); pi.longFramePct = sm.longPct; pi.frames = sm.frames; pi.weightMB = sm.weightMB; } catch {}
        }
        // every internal link resolves (checked once per url across the whole inspection)
        if (opts.checkLinks !== false && item.viewport === "desktop") {
          try {
            const links = await page.evaluate(IN_PAGE.links);
            const broken = [];
            for (const l of links.slice(0, 60)) {
              if (!checked.has(l)) { try { const r = await fetch(l, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15_000) }); checked.set(l, r.status); } catch { checked.set(l, 0); } }
              if ((checked.get(l) || 0) >= 400 || checked.get(l) === 0) broken.push(l.replace(origin, "").slice(0, 80));
            }
            pi.brokenLinks = broken;
          } catch {}
        }
        // final checks after the scroll-through (lazy images, late errors)
        const last = await page.evaluate(IN_PAGE.checks(logoExpected));
        pi.brokenImages = [...new Set([...first.brokenImages, ...last.brokenImages])];
        pi.overflowPx = Math.max(pi.overflowPx, last.overflowPx);
        if (last.overflowBy.length) pi.overflowBy = [...new Set([...pi.overflowBy, ...last.overflowBy])];
        pi.logoInNav = pi.logoInNav || last.logoInNav;
        stamp(`inspected ${item.slug} (${item.viewport}): ${pi.sections} sections, ${pi.blankSections.length} blank, ${pi.consoleErrors.length} errors, ${pi.brokenImages.length} broken images, overflow ${pi.overflowPx}px, ${pi.clippedText.length} clipped${typeof pi.longFramePct === "number" ? `, ${pi.longFramePct}% long frames, ${pi.weightMB} MB` : ""}${pi.brokenLinks?.length ? `, ${pi.brokenLinks.length} broken links` : ""}`);
      } catch (e) {
        pi.loadError = String(e?.message || e).slice(0, 200);
        stamp(`inspection of ${item.slug} (${item.viewport}) failed: ${pi.loadError}`);
      } finally {
        report.pages.push(pi);
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  report.seconds = Math.round((Date.now() - t0) / 1000);
  return report;
}

/** The screenshots the judge sees: every home section (desktop), the home phone view, and the top of each inner page. */
export function judgeShots(report: InspectionReport, max = 24) {
  const out: { label: string; data: string }[] = [];
  const push = (label, s) => { if (s?.data && out.length < max) out.push({ label, data: s.data }); };
  for (const p of report.pages) if (p.slug === "index" && p.viewport === "desktop") p.shots.forEach(s => push(`home desktop · ${s.name.replace(/^home-desktop-/, "")}`, s));
  for (const p of report.pages) if (p.slug === "index" && p.viewport === "phone") p.shots.slice(0, 4).forEach(s => push(`home phone · ${s.name.replace(/^home-phone-/, "")}`, s));
  for (const p of report.pages) if (p.slug !== "index" && p.viewport === "desktop") push(`${p.slug} desktop · top`, p.shots[0]);
  for (const p of report.pages) if (p.slug !== "index" && p.viewport === "phone") push(`${p.slug} phone · top`, p.shots[0]);
  return out;
}

/** Strip the base64 before the report is stored or logged. */
export function leanReport(report: InspectionReport) {
  return { ...report, pages: report.pages.map(p => ({ ...p, shots: p.shots.map(s => ({ name: s.name, url: s.url })) })) };
}
