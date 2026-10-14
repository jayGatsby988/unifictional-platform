// POST /api/analyze  { url }
// Fetches a public website and extracts the facts the research agent and the
// engine need: name, description, headings, nav, internal links, contact
// details, colours, images. No model call; works with or without an API key.
import { body, json } from "./_lib/http.js";

const strip = (s = "") => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->|<svg[\s\S]*?<\/svg>/gi, " ");
const decode = (s = "") => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
const text = (s = "") => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const all = (re, s, i = 1) => { const out = []; let m; while ((m = re.exec(s))) out.push(m[i]); return out; };
const meta = (html, name) => (html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i")) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i")) || [])[1];
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/;
const UA = "Mozilla/5.0 (compatible; UnifictionalStudio/0.2; +https://unifictional.com)";

export async function fetchPage(href, timeout = 12000) {
  const url = new URL(href);
  if (!/^https?:$/.test(url.protocol) || PRIVATE.test(url.hostname)) throw new Error("Only public http(s) sites can be read");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url.href, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
    if (!r.ok) throw new Error(`The site answered ${r.status}`);
    if (!/html/i.test(r.headers.get("content-type") || "")) throw new Error("Not an HTML page");
    const html = (await r.text()).slice(0, 1_500_000);
    return Object.assign(new String(html), { finalUrl: r.url || url.href });
  } finally { clearTimeout(t); }
}
export const pageText = (html) => text((strip(String(html)).match(/<main[\s\S]*<\/main>/i) || strip(String(html)).match(/<body[\s\S]*<\/body>/i) || [strip(String(html))])[0]);

export function analyzeHtml(html, url) {
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
  const nav = [...new Set(all(/<a[^>]*>([\s\S]*?)<\/a>/gi, navHtml).map(text).filter(t => t && t.length < 30))].slice(0, 12);
  const bodyText = pageText(html).slice(0, 8000);
  const phone = (bodyText.match(/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/) || [])[0] || (html.match(/href=["']tel:([^"']+)/i) || [])[1] || "";
  const email = (html.match(/href=["']mailto:([^"'?]+)/i) || [])[1] || (bodyText.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0] || "";
  const colors = {};
  for (const c of all(/#([0-9a-f]{6})\b/gi, html)) { const k = c.toLowerCase(); if (/^(fff|000|ffffff|000000)/.test(k)) continue; colors[k] = (colors[k] || 0) + 1; }
  const topColors = Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => "#" + c);
  const abs = (s) => { try { return new URL(s, url).href; } catch { return null; } };
  const images = [...new Set(all(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi, html).map(abs).filter(Boolean).filter(s => !/\.svg(\?|$)|data:|logo|icon|favicon|sprite|pixel|badge|1x1|avatar|placeholder/i.test(s)))].slice(0, 16);
  const fonts = [...new Set(all(/fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/gi, html).map(f => decodeURIComponent(f).replace(/\+/g, " ").split(":")[0]))].slice(0, 3);
  const logo = (html.match(/<img[^>]+(?:class|alt|src)=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/i) || html.match(/<img[^>]+src=["']([^"']+)["'][^>]*(?:class|alt)=["'][^"']*logo[^"']*["']/i) || [])[1] || "";
  const schemaBlocks = all(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, html).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  const stateCity = bodyText.match(/\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+){0,2}),\s?(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/);
  // internal links (same host), deduped, with their anchor text
  const seen = new Set(); const links = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = abs(m[1]); if (!href) continue;
    let hu; try { hu = new URL(href); } catch { continue; }
    if (hu.hostname.replace(/^www\./, "") !== u.hostname.replace(/^www\./, "")) continue;
    if (/\.(pdf|jpg|jpeg|png|webp|zip|mp4)$/i.test(hu.pathname) || hu.pathname === u.pathname || seen.has(hu.pathname)) continue;
    seen.add(hu.pathname); links.push({ href: hu.origin + hu.pathname, text: text(m[2]).slice(0, 40) || hu.pathname });
    if (links.length >= 40) break;
  }
  return {
    url, domain: u.hostname.replace(/^www\./, ""), title, siteName, description, ogImage: ogImage ? abs(ogImage) : "",
    headings: [...h1, ...h2, ...h3].slice(0, 30), h1, nav, links, text: bodyText, phone, email, colors: topColors, fonts, images, logo: logo ? abs(logo) : "",
    city: stateCity ? `${stateCity[1]}, ${stateCity[2]}` : "", schema: schemaBlocks.slice(0, 2),
    wordCount: bodyText.split(/\s+/).length, hasViewport: /<meta[^>]+viewport/i.test(html), hasSchema: schemaBlocks.length > 0,
    existingSeo: { titleLength: title.length, descriptionLength: description.length, h1Count: h1.length, imgCount: images.length, altMissing: all(/<img(?![^>]*alt=["'][^"']+["'])[^>]*>/gi, html, 0).length },
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  const { url: raw } = await body(req);
  if (!raw) return json(res, 400, { error: "url is required" });
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw); } catch { return json(res, 400, { error: "That does not look like a URL" }); }
  try {
    const html = await fetchPage(url.href);
    return json(res, 200, { ok: true, analysis: analyzeHtml(html, html.finalUrl || url.href) });
  } catch (e) {
    const m = e.name === "AbortError" ? "The site took too long to respond (12 s)." : /fetch failed|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(e.message || "") ? "Could not reach that site. Check the address; it must be a public website." : "Could not read that site: " + (e.message || e);
    return json(res, 502, { error: m });
  }
}
