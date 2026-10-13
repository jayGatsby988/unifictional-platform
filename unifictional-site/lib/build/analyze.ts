// @ts-nocheck
// Reads a company's public website: crawls up to `maxPages` of its own pages
// and extracts everything the research and design agents can use. No model.
//
//   analysis = {
//     url, domain, title, siteName, description, ogImage,
//     logo: {url, kind:"img"|"svg", svg?, onDark?: "invert"|"pill"|"none"}, icon,
//     nav, links, phone, email, address, hours, licence, social:{instagram,…},
//     colors:[hex], fonts:[family], images:[{url, alt, page}],
//     text (home page), pages:[{url, title, text, headings}], wordCount, schema, existingSeo
//   }

const strip = (s = "") => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->|<svg[\s\S]*?<\/svg>/gi, " ");
const decode = (s = "") => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
const text = (s = "") => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const all = (re, s, i = 1) => { const out = []; let m; while ((m = re.exec(s))) out.push(m[i]); return out; };
const meta = (html, name) => (html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i")) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i")) || [])[1];
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/;
const UA = "Mozilla/5.0 (compatible; UnifictionalBuilder/0.3; +https://unifictional.com)";

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const BROWSER_HEADERS = { "user-agent": BROWSER_UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9", "upgrade-insecure-requests": "1", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "none" };
/** A page that came back as a bot challenge or an empty shell: almost no visible words, or a known challenge marker. */
export function looksBlocked(html) {
  const h = String(html || "");
  if (/cf-challenge|challenge-platform|_cf_chl|Just a moment|Checking your browser|Attention Required|Access denied|Enable JavaScript and cookies|captcha|Please verify you are a human|Pardon Our Interruption|Request unsuccessful\. Incapsula|awswaf|Bot detection/i.test(h)) return true;
  const body = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return body.split(" ").filter(Boolean).length < 40;
}
async function fetchOnce(url, headers, ctrl) {
  const r = await fetch(url.href, { signal: ctrl.signal, redirect: "follow", headers });
  if (!r.ok) throw new Error(`The site answered ${r.status}`);
  if (!/html/i.test(r.headers.get("content-type") || "")) throw new Error("Not an HTML page");
  const html = (await r.text()).slice(0, 2_000_000);
  return Object.assign(new String(html), { finalUrl: r.url || url.href });
}
/** One real browser per crawl, opened only when a site blocks plain fetches, reused for every page and request (its cookies carry the challenge clearance). */
let session = null;
async function getSession() {
  if (session) return session;
  let pw; try { pw = await import("playwright"); } catch { return null; }
  try {
    const browser = await pw.chromium.launch({ args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
    const context = await browser.newContext({ userAgent: BROWSER_UA, viewport: { width: 1440, height: 900 }, locale: "en-US" });
    session = { browser, context };
    return session;
  } catch { return null; }
}
export async function closeSession() {
  const s = session; session = null;
  if (!s) return;
  try { await s.context.close(); } catch {}
  try { await s.browser.close(); } catch {}
}
/** Render a page in the shared browser. Never throws: null when the browser is unavailable or the page will not load. */
async function renderPage(href, timeout = 40000) {
  const s = await getSession(); if (!s) return null;
  let page;
  try {
    page = await s.context.newPage();
    await page.goto(href, { waitUntil: "domcontentloaded", timeout });
    // give a challenge page time to resolve and lazy images time to get their src
    for (let i = 0; i < 12; i++) { const t = await page.evaluate(() => document.body?.innerText || "").catch(() => ""); if (t.split(/\s+/).filter(Boolean).length > 60 && !/Just a moment|Checking your browser|verify you are human|sgcaptcha/i.test(t + page.url())) break; await page.waitForTimeout(1500); }
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight && y < 12000; y += 900) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 100)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(500);
    const html = await page.content();
    const finalUrl = page.url();
    return Object.assign(new String(html.slice(0, 2_000_000)), { finalUrl, rendered: true });
  } catch { return null; } finally { try { await page?.close(); } catch {} }
}
/** A plain GET through the shared browser session (cookies included). Empty string when there is no session or it fails. */
async function sessionText(href, timeout = 10000, max = 300_000, accept = "text/css,*/*;q=0.1") {
  const s = session; if (!s) return "";
  try { const r = await s.context.request.get(href, { timeout, headers: { accept } }); if (!r.ok()) return ""; return (await r.text()).slice(0, max); } catch { return ""; }
}
let preferRender = false; // once a site needed the browser, its other pages are rendered too
export async function fetchPage(href, timeout = 12000) {
  const url = new URL(href);
  if (!/^https?:$/.test(url.protocol) || PRIVATE.test(url.hostname)) throw new Error("Only public http(s) sites can be read");
  if (preferRender) { const r = await renderPage(url.href); if (r && !looksBlocked(r)) return r; }
  if (preferRelay) { const r = await relayFetch(url.href); if (r && !looksBlocked(r)) return r; }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let first = null, lastErr = null;
  try {
    try { first = await fetchOnce(url, { "user-agent": UA, accept: "text/html,application/xhtml+xml" }, ctrl); if (!looksBlocked(first)) return first; } catch (e) { lastErr = e; }
    // the site hides from our crawler: ask as a browser would
    try { const b = await fetchOnce(url, BROWSER_HEADERS, ctrl); if (!looksBlocked(b)) return b; first = first || b; } catch (e) { lastErr = lastErr || e; }
  } finally { clearTimeout(t); }
  // still a challenge or an empty shell: render it in a real browser
  const rendered = await renderPage(url.href);
  if (rendered && !looksBlocked(rendered)) { preferRender = true; return rendered; }
  // last try: the same page fetched from the agency site's own servers (a different IP pool)
  const relayed = await relayFetch(url.href);
  if (relayed && !looksBlocked(relayed)) { preferRelay = true; return relayed; }
  if (first) return Object.assign(first, { blocked: true });
  throw lastErr || new Error("The site could not be read");
}
let preferRelay = false;
/** Download bytes (a photo, a logo) as a browser would; when the host answers with a challenge page or an error, the same URL is fetched through the relay. Returns null when both fail. */
export async function fetchBinary(href, { timeout = 15000, accept = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", max = 25 * 1024 * 1024 } = {}): Promise<{ buf: Buffer; type: string } | null> {
  const isImage = (type) => /^image\//i.test(type || "");
  if (!preferRelay) {
    try {
      const r = await fetch(href, { signal: AbortSignal.timeout(timeout), redirect: "follow", headers: { ...BROWSER_HEADERS, accept } });
      const type = r.headers.get("content-type") || "";
      if (r.ok && !/text\/html/i.test(type)) { const buf = Buffer.from(await r.arrayBuffer()); if (buf.length && buf.length <= max) return { buf, type: type || (isImage(type) ? type : "application/octet-stream") }; }
    } catch {}
  }
  const origin = process.env.RELAY_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || "https://unifictional.com";
  const secret = process.env.BOOKING_SECRET; if (!secret) return null;
  try {
    const r = await fetch(`${origin.replace(/\/$/, "")}/api/build/fetch?url=${encodeURIComponent(href)}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(timeout + 15000) });
    if (!r.ok) return null;
    const up = Number(r.headers.get("x-upstream-status") || 200); const type = r.headers.get("x-upstream-type") || r.headers.get("content-type") || "";
    if (up >= 400 || /text\/html/i.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer()); if (!buf.length || buf.length > max) return null;
    preferRelay = true;
    return { buf, type };
  } catch { return null; }
}
async function relayFetch(href, timeout = 25000) {
  const origin = process.env.RELAY_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || "https://unifictional.com";
  const secret = process.env.BOOKING_SECRET; if (!secret) return null;
  try {
    const r = await fetch(`${origin.replace(/\/$/, "")}/api/build/fetch?url=${encodeURIComponent(href)}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) return null;
    const html = await r.text();
    const finalUrl = r.headers.get("x-final-url") || href;
    return Object.assign(new String(html.slice(0, 2_000_000)), { finalUrl, relayed: true });
  } catch { return null; }
}
async function fetchText(href, timeout = 8000, max = 300_000) {
  if (preferRender) { const viaSession = await sessionText(href, timeout, max); if (viaSession) return viaSession; }
  if (preferRelay) { const viaRelay = await relayFetch(href, timeout + 10000); if (viaRelay) return String(viaRelay).slice(0, max); }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(href, { signal: ctrl.signal, redirect: "follow", headers: { ...BROWSER_HEADERS, accept: "text/css,*/*;q=0.1" } });
    if (!r.ok) return "";
    return (await r.text()).slice(0, max);
  } catch { return ""; } finally { clearTimeout(t); }
}
export const pageText = (html) => text((strip(String(html)).match(/<main[\s\S]*<\/main>/i) || strip(String(html)).match(/<body[\s\S]*<\/body>/i) || [strip(String(html))])[0]);

/* ----------------------------------------------------------------- images */
const BAD_IMG = /\.svg(\?|$)|^data:|logo|icon|favicon|sprite|pixel|badge|1x1|avatar|placeholder|tracking|\.gif(\?|$)|google(usercontent)?\.com\/maps|gravatar|emoji|arrow|spinner|loader|blank\./i;
function absUrl(s, base) { try { return new URL(s, base).href; } catch { return null; } }
// Next.js /_next/image?url=… and similar proxies: unwrap the original.
function unwrap(u) {
  try {
    const x = new URL(u);
    if (/\/_next\/image/.test(x.pathname) && x.searchParams.get("url")) { const inner = x.searchParams.get("url"); return /^https?:/.test(inner) ? inner : new URL(inner, x.origin).href; }
    if (/wixstatic\.com/.test(x.hostname)) return u.replace(/\/v1\/fill\/[^/]+\//, "/v1/fill/w_1600,h_1200,al_c,q_85/");
  } catch {}
  return u;
}
function bestSrcset(ss) {
  // pick the widest candidate
  let best = null, bw = 0;
  for (const part of ss.split(",")) {
    const [u, d] = part.trim().split(/\s+/);
    const w = d && /w$/.test(d) ? parseInt(d) : d && /x$/.test(d) ? parseFloat(d) * 1000 : 0;
    if (u && w >= bw) { best = u; bw = w; }
  }
  return best;
}
export function extractImages(html, base, page = "") {
  const out = new Map();
  const add = (raw, alt = "") => {
    if (!raw) return;
    let u = absUrl(unwrap(raw.trim()), base); if (!u) return;
    u = unwrap(u);
    if (BAD_IMG.test(u)) return;
    if (!/\.(jpe?g|png|webp|avif)(\?|$)/i.test(u) && !/\/image|\/img|photo|upload|cdn|static|wp-content|squarespace|wixstatic|cloudinary|imgix|shopify/i.test(u)) return;
    if (/[?&]w=(\d+)/.test(u) && parseInt(u.match(/[?&]w=(\d+)/)[1]) < 300) return;
    if (/\b(icon|logo|line drawing|illustration|clipart|badge|arrow|checkmark|avatar|outline of|representing|symbol|pictogram|graphic of|vector)\b/i.test(alt)) return;
    const key = u.split("?")[0];
    if (!out.has(key)) out.set(key, { url: u, alt: text(alt).slice(0, 140), page });
    else if (alt && !out.get(key).alt) out.get(key).alt = text(alt).slice(0, 140);
  };
  for (const tag of all(/(<img\b[^>]*>)/gi, html)) {
    const alt = (tag.match(/\balt=["']([^"']*)["']/i) || [])[1] || "";
    const srcset = (tag.match(/\b(?:srcset|data-srcset)=["']([^"']+)["']/i) || [])[1];
    const src = (tag.match(/\b(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["']/i) || [])[1];
    const w = parseInt((tag.match(/\bwidth=["']?(\d+)/i) || [])[1] || "0");
    if (w && w < 120) continue;
    if (srcset) add(bestSrcset(srcset), alt);
    if (src) add(src, alt);
  }
  for (const ss of all(/<source\b[^>]*srcset=["']([^"']+)["']/gi, html)) add(bestSrcset(ss));
  for (const bg of all(/background(?:-image)?\s*:\s*url\((['"]?)([^'")]+)\1\)/gi, html, 2)) add(bg);
  // gallery and lightbox links to full-size photos, and lazy-loader data attributes (data-bg, data-image-src, nectar/elementor/wp galleries)
  for (const href of all(/<a\b[^>]*href=["']([^"']+\.(?:jpe?g|png|webp|avif)(?:\?[^"']*)?)["']/gi, html)) add(href, "");
  for (const v of all(/\sdata-[a-z-]*(?:src|image|bg|img|url|thumb)[a-z-]*=["']([^"']+\.(?:jpe?g|png|webp|avif)(?:\?[^"']*)?)["']/gi, html)) add(v, "");
  const og = meta(html, "og:image"); if (og) add(og, "");
  return [...out.values()];
}

/**
 * WordPress sites publish their media library at /wp-json/wp/v2/media: every
 * uploaded photo with its alt text and size, including the ones lazy-loading
 * galleries never put in the HTML. Returns [] for anything that is not WordPress.
 */
export async function wordpressMedia(siteUrl, html = "") {
  if (!/wp-content\/|wp-json\/|wp-includes\//i.test(html)) return [];
  let origin; try { origin = new URL(siteUrl).origin; } catch { return []; }
  const out = [];
  for (let page = 1; page <= 2; page++) {
    try {
      const feed = `${origin}/wp-json/wp/v2/media?per_page=100&media_type=image&page=${page}`;
      let items = null;
      if (preferRender) { const t = await sessionText(feed, 10000, 3_000_000, "application/json"); if (t) { try { items = JSON.parse(t); } catch {} } }
      if (!items && preferRelay) { const t = await relayFetch(feed, 25000); if (t) { try { items = JSON.parse(String(t)); } catch {} } }
      if (!items) { const res = await fetch(feed, { headers: { ...BROWSER_HEADERS, accept: "application/json" }, signal: AbortSignal.timeout(8000) }); if (!res.ok) break; items = await res.json(); }
      if (!Array.isArray(items) || !items.length) break;
      for (const m of items) {
        const url = m?.source_url || ""; const w = m?.media_details?.width || 0, h = m?.media_details?.height || 0;
        const name = `${m?.alt_text || ""} ${m?.title?.rendered || ""} ${m?.slug || ""}`;
        if (!url || w < 700 || h < 400 || BAD_IMG.test(url) || /\b(logo|favicon|icon|badge|award|certif|screenshot|banner-text|placeholder)\b/i.test(name)) continue;
        out.push({ url, alt: text(m?.alt_text || m?.title?.rendered || "").slice(0, 140), page: "media library", width: w, height: h });
      }
      if (items.length < 100) break;
    } catch { break; }
  }
  return out;
}

/* ------------------------------------------------------------------ logo */
function extractLogo(html, base) {
  const header = (html.match(/<header[\s\S]*?<\/header>/i) || html.match(/<nav[\s\S]*?<\/nav>/i) || [""])[0] || html.slice(0, 60000);
  const pick = (scope) => {
    const tags = all(/(<img\b[^>]*>)/gi, scope);
    for (const tag of tags) {
      const src = (tag.match(/\b(?:src|data-src)=["']([^"']+)["']/i) || [])[1] || "";
      const srcset = (tag.match(/\bsrcset=["']([^"']+)["']/i) || [])[1];
      const sig = tag + " " + src;
      if (/logo|brand|wordmark/i.test(sig) && !/partner|client|badge|award|payment|sponsor/i.test(sig)) return unwrap(absUrl(srcset ? bestSrcset(srcset) : src, base));
    }
    const homeLink = (scope.match(/<a[^>]+href=["'](?:\/|https?:\/\/[^"']+\/?)["'][^>]*>([\s\S]*?)<\/a>/i) || [])[1] || "";
    const img = (homeLink.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i) || [])[1];
    if (img) return unwrap(absUrl(img, base));
    return null;
  };
  const url = pick(header) || pick(html);
  if (url && !/\.svg(\?|$)/i.test(url)) return { url, kind: "img" };
  if (url) return { url, kind: "img", isSvgFile: true };
  // inline SVG in the header's home link
  const homeLink = (header.match(/<a[^>]+href=["']\/?["'][^>]*>([\s\S]*?)<\/a>/i) || [])[1] || "";
  const svg = (homeLink.match(/<svg[\s\S]*?<\/svg>/i) || header.match(/<svg[^>]*(?:logo|brand)[\s\S]*?<\/svg>/i) || [])[0];
  if (svg && svg.length < 30000 && !/<script/i.test(svg)) return { kind: "svg", svg: svg.replace(/\s(width|height)=["'][^"']*["']/gi, ""), url: "" };
  const touch = (html.match(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["']/i) || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*apple-touch-icon[^"']*["']/i) || [])[1];
  if (touch) return { url: absUrl(touch, base), kind: "img", fromIcon: true };
  return null;
}
function extractIcon(html, base) {
  const m = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i) || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i);
  return m ? absUrl(m[1], base) : absUrl("/favicon.ico", base);
}

// Decide how the logo should sit on a dark page: fetch it and measure with
// sharp (mean luminance + colourfulness of the opaque pixels).
export async function logoOnDark(logo) {
  if (!logo?.url) return "none";
  try {
    const got = await fetchBinary(logo.url, { timeout: 8000, max: 3_000_000 });
    if (!got) return "pill";
    const buf = got.buf;
    const sharp = (await import("sharp")).default;
    const img = sharp(buf).ensureAlpha();
    const { data, info } = await img.resize(64, 64, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
    let n = 0, lum = 0, sat = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const a = data[i + 3] / 255; if (a < 0.5) continue;
      const rr = data[i], g = data[i + 1], b = data[i + 2];
      lum += (0.2126 * rr + 0.7152 * g + 0.0722 * b) / 255; sat += (Math.max(rr, g, b) - Math.min(rr, g, b)) / 255; n++;
    }
    if (!n) return "none";
    lum /= n; sat /= n;
    if (lum > 0.55) return "none";          // light logo reads on dark
    if (sat < 0.12) return "invert";         // dark monochrome logo: invert it
    return "pill";                            // dark colourful logo: white pill behind it
  } catch { return "pill"; }
}

/* ----------------------------------------------------------- brand cues */
const GENERIC_FONTS = /^(inherit|initial|sans-serif|serif|monospace|system-ui|-apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica( neue)?|arial|ui-sans-serif|ui-serif|var\(.*|times( new roman)?|georgia|courier.*|cursive|fantasy|math)$/i;
function fontsFrom(html, css) {
  const fam = {};
  for (const f of all(/fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/gi, html)) for (const p of decodeURIComponent(f).split("&family=")) { const n = p.replace(/\+/g, " ").split(":")[0].trim(); if (n) fam[n] = (fam[n] || 0) + 5; }
  for (const f of all(/@font-face\s*{[^}]*font-family\s*:\s*(['"]?)([^;'"}]+)\1/gi, css, 2)) { const n = f.trim(); if (n) fam[n] = (fam[n] || 0) + 3; }
  for (const f of all(/font-family\s*:\s*([^;}]+)/gi, css + html)) { const n = f.split(",")[0].replace(/['"]/g, "").replace(/\s*!important/i, "").trim(); if (n && !GENERIC_FONTS.test(n) && !/^var\(/.test(n)) fam[n] = (fam[n] || 0) + 1; }
  const BAD_FONT = /icon|awesome|glyph|material|symbols|unset|inherit|!important|^-|^\d/i;
  return Object.entries(fam).sort((a, b) => b[1] - a[1]).map(([n]) => n.replace(/\s*!important/i, "").trim()).filter(n => n && !GENERIC_FONTS.test(n) && !BAD_FONT.test(n)).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
}
/** The page's own background colour (body/html/:root rules, or theme-color), as a hex; white when nothing says otherwise. */
function bodyBgFrom(html, css) {
  const src = css + " " + html;
  const toHex = (v) => { v = String(v || "").trim().toLowerCase(); let m = v.match(/^#([0-9a-f]{6})\b/); if (m) return "#" + m[1]; m = v.match(/^#([0-9a-f]{3})\b/); if (m) return "#" + m[1].split("").map(x => x + x).join(""); m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/); if (m) return "#" + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, "0")).join(""); if (v === "white") return "#ffffff"; if (v === "black") return "#000000"; return ""; };
  for (const sel of ["body", "html", ":root"]) {
    const re = new RegExp(`(?:^|[}\\s,])${sel.replace(":", "\\:")}\\s*\\{[^}]*?background(?:-color)?\\s*:\\s*([^;}]+)`, "gi");
    let m; while ((m = re.exec(src))) { const h = toHex(m[1].split(/\s|!/)[0]); if (h) return h; }
  }
  return "#ffffff";
}
function colorsFrom(html, css) {
  const counts = {};
  const src = css + " " + html;
  const bump = (hex, w = 1) => { counts[hex] = (counts[hex] || 0) + w; };
  for (const c of all(/#([0-9a-f]{6})\b/gi, src)) bump("#" + c.toLowerCase());
  for (const c of all(/#([0-9a-f]{3})\b(?![0-9a-f])/gi, src)) bump("#" + c.toLowerCase().split("").map(x => x + x).join(""), 0.5);
  for (const m of src.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi)) bump("#" + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, "0")).join(""), 0.5);
  const themeColor = meta(html, "theme-color"); if (themeColor && /^#[0-9a-f]{6}$/i.test(themeColor)) bump(themeColor.toLowerCase(), 20);
  const scored = Object.entries(counts).map(([hex, n]) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const max = Math.max(r, g, b), min = Math.min(r, g, b); const sat = max ? (max - min) / max : 0; const lum = (r + g + b) / 765;
    const grey = sat < 0.12 || lum > 0.93 || lum < 0.08;
    return { hex, n, sat, lum, grey, score: grey ? 0 : n * (0.4 + sat) };
  }).filter(c => !c.grey && c.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, 6).map(c => c.hex);
}
const SOCIAL = { instagram: /instagram\.com\/[^/"'?]+/i, facebook: /facebook\.com\/[^/"'?]+/i, yelp: /yelp\.com\/biz\/[^/"'?]+/i, houzz: /houzz\.com\/[^"']+/i, google: /(?:g\.page\/|google\.com\/maps\/place\/|maps\.app\.goo\.gl\/|business\.google\.com)[^"']+/i, linkedin: /linkedin\.com\/(?:company|in)\/[^/"'?]+/i, youtube: /youtube\.com\/(?:@|channel\/|c\/|user\/)[^/"'?]+/i, tiktok: /tiktok\.com\/@[^/"'?]+/i, nextdoor: /nextdoor\.com\/[^"']+/i, bbb: /bbb\.org\/[^"']+/i, angi: /(?:angi|angieslist|homeadvisor)\.com\/[^"']+/i };
function socialFrom(html) {
  const out = {};
  for (const href of all(/href=["']([^"']+)["']/gi, html)) for (const [k, re] of Object.entries(SOCIAL)) if (!out[k] && re.test(href) && !/share|sharer|intent/i.test(href)) out[k] = href.split('"')[0];
  return out;
}
const STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";
function addressFrom(bodyText, schema) {
  for (const s of schema) { const a = s?.address || s?.["@graph"]?.find?.(g => g.address)?.address; if (a?.streetAddress) return [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).join(", "); }
  const m = bodyText.match(new RegExp(`\\b\\d{2,6}\\s+[A-Z0-9][\\w.'-]*(?:\\s+[A-Z0-9][\\w.'-]*){0,4}\\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Way|Ln|Lane|Ct|Court|Pl|Place|Hwy|Highway|Pkwy|Parkway|Ter|Trail|Cir|Circle)\\.?(?:,?\\s+(?:Suite|Ste|Unit|#)\\s*[\\w-]+)?,?\\s+[A-Z][a-zA-Z.]+(?:\\s[A-Z][a-zA-Z.]+)?,?\\s+(?:${STATES})\\s+\\d{5}`));
  return m ? m[0] : "";
}
function hoursFrom(bodyText, schema) {
  for (const s of schema) { const h = s?.openingHours || s?.openingHoursSpecification; if (h) return typeof h === "string" ? h : Array.isArray(h) && typeof h[0] === "string" ? h.join("; ") : ""; }
  const m = bodyText.match(/\b(?:Mon|Monday)[^.]{0,40}?(?:Fri|Friday|Sat|Saturday|Sun|Sunday)[^.]{0,30}?\d{1,2}(?::\d{2})?\s?(?:am|pm|AM|PM)[^.]{0,20}?\d{1,2}(?::\d{2})?\s?(?:am|pm|AM|PM)/);
  return m ? m[0].trim() : "";
}
function licenceFrom(bodyText) {
  const m = bodyText.match(/\b(?:(?:WA|CA|OR|TX|FL|State)\s+)?(?:Lic(?:ense|ence)?|Contractor(?:'s)?\s+Lic(?:ense)?|CCB|ROC|CSLB|HIC|Reg(?:istration)?)\.?\s*(?:#|No\.?|Number)?\s*:?\s*([A-Z0-9*-]{5,20})/i);
  return m && /\d/.test(m[1]) ? m[0].trim().slice(0, 60) : "";
}

/* ----------------------------------------------------------- analysis */
export function analyzeHtml(html, url, css = "") {
  html = String(html);
  const u = new URL(url);
  const clean = strip(html);
  const title = text((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const description = decode(meta(html, "description") || meta(html, "og:description") || "");
  const siteName = decode(meta(html, "og:site_name") || "");
  const ogImage = meta(html, "og:image") || "";
  const h1 = all(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, clean).map(text).filter(Boolean);
  const h2 = all(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, clean).map(text).filter(Boolean);
  const h3 = all(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, clean).map(text).filter(Boolean);
  const navHtml = (clean.match(/<nav[\s\S]*?<\/nav>/i) || clean.match(/<header[\s\S]*?<\/header>/i) || [""])[0];
  const nav = [...new Set(all(/<a[^>]*>([\s\S]*?)<\/a>/gi, navHtml).map(text).filter(t => t && t.length < 30))].slice(0, 14);
  const bodyText = pageText(html).slice(0, 12000);
  const phone = (bodyText.match(/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/) || [])[0] || (html.match(/href=["']tel:([^"']+)/i) || [])[1] || "";
  const email = (html.match(/href=["']mailto:([^"'?]+)/i) || [])[1] || (bodyText.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0] || "";
  const schemaBlocks = all(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, html).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  const stateCity = bodyText.match(new RegExp(`\\b([A-Z][a-zA-Z.]+(?:\\s[A-Z][a-zA-Z.]+){0,2}),\\s?(${STATES})\\b`));
  const seen = new Set(); const links = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = absUrl(m[1], url); if (!href) continue;
    let hu; try { hu = new URL(href); } catch { continue; }
    if (hu.hostname.replace(/^www\./, "") !== u.hostname.replace(/^www\./, "")) continue;
    if (/\.(pdf|jpg|jpeg|png|webp|zip|mp4|xml|txt)$/i.test(hu.pathname) || hu.pathname === u.pathname || seen.has(hu.pathname)) continue;
    seen.add(hu.pathname); links.push({ href: hu.origin + hu.pathname, text: text(m[2]).slice(0, 50) || hu.pathname });
    if (links.length >= 80) break;
  }
  const logo = extractLogo(html, url);
  return {
    url, domain: u.hostname.replace(/^www\./, ""), title, siteName, description, ogImage: ogImage ? absUrl(ogImage, url) : "",
    logo, icon: extractIcon(html, url),
    headings: [...h1, ...h2, ...h3].slice(0, 40), h1, nav, links, text: bodyText, phone, email,
    address: addressFrom(bodyText, schemaBlocks), hours: hoursFrom(bodyText, schemaBlocks), licence: licenceFrom(bodyText),
    social: socialFrom(html), colors: colorsFrom(html, css), fonts: fontsFrom(html, css), bodyBg: bodyBgFrom(html, css),
    images: extractImages(html, url, "home"),
    city: stateCity ? `${stateCity[1]}, ${stateCity[2]}` : "", schema: schemaBlocks.slice(0, 3),
    wordCount: bodyText.split(/\s+/).length, hasViewport: /<meta[^>]+viewport/i.test(html), hasSchema: schemaBlocks.length > 0,
    existingSeo: { titleLength: title.length, descriptionLength: description.length, h1Count: h1.length, imgCount: all(/<img/gi, html, 0).length, altMissing: all(/<img(?![^>]*alt=["'][^"']+["'])[^>]*>/gi, html, 0).length },
    pages: [],
  };
}

const WANT = /about|service|what-we|work|project|portfolio|gallery|photo|review|testimonial|process|how|team|crew|pricing|cost|faq|contact|area|location|serv(e|ing)|city|kitchen|bath|roof|deck|remodel|custom|design|build|blog|guide|financ|warranty|guarantee/i;
const SKIP = /privacy|terms|login|cart|checkout|account|feed|wp-json|tag\/|category\/|page\/\d|\?s=|sitemap|\.xml$/i;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = null; } } }));
  return out;
}

/**
 * Crawl the site: the home page, its stylesheets (for colours and fonts),
 * then up to `maxPages` internal pages chosen by their link text and path.
 * Returns the home analysis with `pages`, merged `images`, and brand facts
 * filled from any page that had them.
 */
export async function crawlSite(startUrl, opts = {}) {
  try { return await crawlInner(startUrl, opts); } finally { await closeSession(); }
}
async function crawlInner(startUrl, { maxPages = 20, timeout = 10000, forceRender = process.env.CRAWL_FORCE_RENDER === "1" } = {}) {
  preferRender = Boolean(forceRender); preferRelay = false;
  const home = await fetchPage(startUrl);
  if (home.blocked) { const err = new Error("their website blocks automated readers (a bot challenge for datacenter visitors); nothing on it could be read"); err.blocked = true; throw err; }
  const url = home.finalUrl || startUrl;
  // stylesheets: up to 3, for colours and fonts
  const sheets = all(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi, String(home)).concat(all(/<link[^>]+href=["']([^"']+\.css[^"']*)["']/gi, String(home))).map(h => absUrl(h, url)).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);
  const inlineCss = all(/<style[^>]*>([\s\S]*?)<\/style>/gi, String(home)).join("\n");
  const cssFiles = await mapLimit(sheets, 3, (h) => fetchText(h, 6000, 250_000));
  const css = inlineCss + "\n" + cssFiles.filter(Boolean).join("\n");
  const a = analyzeHtml(home, url, css);

  // choose inner pages: nav links first, then keyword-matching links
  const navSet = new Set(a.nav.map(n => n.toLowerCase()));
  const scored = a.links.filter(l => !SKIP.test(l.href)).map(l => ({ ...l, score: (navSet.has(l.text.toLowerCase()) ? 3 : 0) + (WANT.test(l.text) ? 2 : 0) + (WANT.test(l.href) ? 1 : 0) - l.href.split("/").length * 0.05 })).sort((x, y) => y.score - x.score);
  const picks = scored.slice(0, maxPages);
  const t0 = Date.now();
  const budget = preferRender ? 170_000 : 75_000;
  const pages = await mapLimit(picks, preferRender ? 2 : 5, async (l) => {
    if (Date.now() - t0 > budget) return null;
    const h = await fetchPage(l.href, timeout);
    const html = String(h);
    const t = pageText(html);
    if (t.split(/\s+/).length < 40) return null;
    const title = text((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || l.text);
    const headings = all(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi, strip(html)).map(text).filter(Boolean).slice(0, 12);
    const schema = all(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, html).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    const body = t.slice(0, 12000);
    return { url: l.href, title, headings, text: t.slice(0, 6000), words: t.split(/\s+/).length, images: extractImages(html, l.href, l.text.slice(0, 30)),
      phone: (body.match(/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/) || [])[0] || "", email: (html.match(/href=["']mailto:([^"'?]+)/i) || [])[1] || "",
      address: addressFrom(body, schema), hours: hoursFrom(body, schema), licence: licenceFrom(body), social: socialFrom(html) };
  });
  a.pages = pages.filter(Boolean);
  // merge facts and photos found on inner pages
  const imgs = new Map(a.images.map(i => [i.url.split("?")[0], i]));
  for (const p of a.pages) {
    if (!a.phone && p.phone) a.phone = p.phone;
    if (!a.email && p.email) a.email = p.email;
    if (!a.address && p.address) a.address = p.address;
    if (!a.hours && p.hours) a.hours = p.hours;
    if (!a.licence && p.licence) a.licence = p.licence;
    for (const [k, v] of Object.entries(p.social || {})) if (!a.social[k]) a.social[k] = v;
    for (const im of p.images || []) { const k = im.url.split("?")[0]; if (!imgs.has(k)) imgs.set(k, im); else if (im.alt && !imgs.get(k).alt) imgs.get(k).alt = im.alt; }
  }
  // the WordPress media library, when there is one: photos the HTML never showed (lazy galleries, sliders)
  try { for (const im of await wordpressMedia(url, String(home))) { const k = im.url.split("?")[0]; if (!imgs.has(k)) imgs.set(k, im); else if (im.alt && !imgs.get(k).alt) imgs.get(k).alt = im.alt; } } catch {}
  a.images = [...imgs.values()].slice(0, 120);
  a.totalWords = a.wordCount + a.pages.reduce((s, p) => s + p.words, 0);
  a.rendered = Boolean(home.rendered || preferRender);
  a.relayed = Boolean(home.relayed || preferRelay);
  if (a.logo?.url) a.logo.onDark = await logoOnDark(a.logo);
  return a;
}
