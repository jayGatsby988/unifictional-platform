/**
 * What the client's site says today: title, description, homepage text and the
 * pages that exist (nav links + sitemap), so posts link to real pages and the
 * writer doesn't repeat what a service page already covers.
 */

export type SiteContext = { title: string | null; description: string | null; text: string; paths: string[] };

const UA = "Mozilla/5.0 (compatible; UnifictionalAutopilot/1.0)";
const ASSET = /\.(png|jpe?g|webp|svg|gif|pdf|css|js|xml|ico|mp4|woff2?)$/i;

export function extractSiteContext(html: string, baseUrl: string): SiteContext {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]?.trim()
    ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1]?.trim()
    ?? null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "’").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
  const origin = new URL(baseUrl).origin;
  const paths = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#?]+)[^"']*["']/gi)) {
    let p = m[1];
    if (/^https?:\/\//i.test(p)) {
      try { const u = new URL(p); if (u.origin !== origin) continue; p = u.pathname; } catch { continue; }
    }
    if (!p.startsWith("/") || ASSET.test(p)) continue;
    p = p.replace(/\/+$/, "");
    if (p) paths.add(p);
    if (paths.size >= 40) break;
  }
  return { title, description, text: text.slice(0, 4000), paths: [...paths] };
}

export function extractSitemapPaths(xml: string, origin: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    try {
      const u = new URL(m[1]);
      if (u.origin === origin) { const p = u.pathname.replace(/\/+$/, ""); if (p) out.push(p); }
    } catch { /* skip */ }
    if (out.length >= 60) break;
  }
  return out;
}

export async function fetchSiteContext(url: string): Promise<SiteContext | null> {
  const home = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const res = await fetch(home, { redirect: "follow", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return null;
  const finalUrl = res.url || home;
  const ctx = extractSiteContext(await res.text(), finalUrl);
  const origin = new URL(finalUrl).origin;
  const sitemap = await fetch(`${origin}/sitemap.xml`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8_000) }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  if (sitemap) ctx.paths = [...new Set([...ctx.paths, ...extractSitemapPaths(sitemap, origin)])].slice(0, 60);
  return ctx;
}
