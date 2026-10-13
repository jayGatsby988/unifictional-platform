import { mapPsi, type PsiResponse } from "@/lib/integrations/pagespeed";
import { getJson } from "@/lib/integrations/types";
import { safeFetch } from "@/lib/safe-fetch";
import { buildSeoReport, checkRankings, fetchRobots, fetchSitemapCount, queriesFor, type SeoReport } from "@/lib/seo-check";

/**
 * Free website + SEO inspection. Two sources: PageSpeed Insights (Lighthouse,
 * mobile) for scores, vitals and the standard SEO/accessibility audits, and a
 * direct fetch of the homepage for the things a contractor site must have
 * (phone number, estimate CTA, schema, analytics tag, social proof).
 */

export type Check = { id: string; label: string; status: "pass" | "warn" | "fail" | "info"; detail: string; group: "speed" | "seo" | "trust" | "leads" };

export type AuditReport = {
  url: string;
  finalUrl: string;
  fetchedAt: string;
  scores: { performance: number; seo: number; accessibility: number; bestPractices: number } | null;
  vitals: { lcpMs: number; cls: number; inpMs: number } | null;
  checks: Check[];
  summary: { passed: number; warned: number; failed: number; grade: "A" | "B" | "C" | "D" | "F"; headline: string; fixFirst: string[] };
  meta: { title: string | null; description: string | null; h1: string | null; wordCount: number };
  seo: SeoReport | null;
};

type PsiAudits = Record<string, { score?: number | null; displayValue?: string; title?: string }>;

const LH_CHECKS: { id: string; label: string; group: Check["group"]; pass: string; fail: string }[] = [
  { id: "is-on-https", label: "Secure (HTTPS)", group: "trust", pass: "Served over HTTPS.", fail: "Not served over HTTPS. Browsers flag this and Google ranks it lower." },
  { id: "viewport", label: "Mobile-ready viewport", group: "seo", pass: "Mobile viewport is set.", fail: "No mobile viewport tag: the site will render tiny on phones, where most homeowners look." },
  { id: "document-title", label: "Page title", group: "seo", pass: "The homepage has a title.", fail: "Missing page title. This is the headline Google shows in results." },
  { id: "meta-description", label: "Meta description", group: "seo", pass: "A meta description is present.", fail: "No meta description. Google will invent one, usually badly." },
  { id: "is-crawlable", label: "Indexable by Google", group: "seo", pass: "Google is allowed to index the page.", fail: "The page blocks indexing. It cannot rank at all." },
  { id: "image-alt", label: "Image alt text", group: "seo", pass: "Images have alt text.", fail: "Project photos are missing alt text, so Google cannot read them." },
  { id: "link-text", label: "Descriptive links", group: "seo", pass: "Links use descriptive text.", fail: "Links like 'click here' tell Google nothing about the page." },
  { id: "font-size", label: "Readable text on mobile", group: "seo", pass: "Text is legible on phones.", fail: "Text is too small to read on phones." },
  { id: "tap-targets", label: "Tappable buttons", group: "leads", pass: "Buttons and links are easy to tap.", fail: "Buttons are too small or too close together on mobile." },
  { id: "largest-contentful-paint", label: "Loads fast (LCP)", group: "speed", pass: "The main content appears quickly.", fail: "The main content takes too long to appear. Visitors leave before they see your work." },
  { id: "cumulative-layout-shift", label: "Stable layout (CLS)", group: "speed", pass: "Nothing jumps around while loading.", fail: "The layout shifts while loading, which causes mis-taps." },
  { id: "total-blocking-time", label: "Responsive to taps (TBT)", group: "speed", pass: "The page responds quickly to taps.", fail: "Scripts block the page from responding to taps." },
  { id: "errors-in-console", label: "No browser errors", group: "trust", pass: "No errors in the browser console.", fail: "The page throws browser errors; something is broken." },
];

export function statusFromScore(score: number | null | undefined): Check["status"] {
  if (score === null || score === undefined) return "info";
  if (score >= 0.9) return "pass";
  if (score >= 0.5) return "warn";
  return "fail";
}

export function normalizeUrl(input: string): string | null {
  let v = input.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!u.hostname.includes(".")) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** On-page checks from the raw HTML. Pure, so it is unit-testable. */
export function htmlChecks(html: string, finalUrl: string): { checks: Check[]; meta: AuditReport["meta"] } {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] ?? null;
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);
  const wordCount = text.split(" ").filter(Boolean).length;
  const phone = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/.test(text) || /href=["']tel:/i.test(html);
  const cta = /(get a quote|free estimate|request (a )?quote|request (an )?estimate|book (a )?call|schedule|\bcontact\b|get started|free consultation|estimate|get in touch|let's talk|start (your|a) project)/i.test(text) || /href=["'][^"']*(contact|quote|estimate)/i.test(html);
  const schema = /application\/ld\+json/i.test(html);
  const analytics = /(googletagmanager\.com|google-analytics\.com|gtag\(|G-[A-Z0-9]{6,}|fbq\(|connect\.facebook\.net)/i.test(html);
  const og = /<meta[^>]+property=["']og:(title|image)["']/i.test(html);
  const reviews = /(reviews?|rated|stars|testimonial|google rating|★)/i.test(text);
  const year = new Date().getFullYear();
  const copyright = text.match(/(?:©|copyright)\s*(\d{4})/i)?.[1];
  const stale = copyright ? +copyright < year - 1 : false;
  const localArea = /\b(WA|Washington|Everett|Seattle|Snohomish|King County|Bellevue|Tacoma|Lynnwood|Marysville|Mill Creek|Bothell|Kirkland|Redmond|Lake Stevens)\b/.test(text);

  const checks: Check[] = [
    { id: "h1", label: "Clear headline (H1)", group: "seo", status: h1s.length === 1 ? "pass" : h1s.length === 0 ? "fail" : "warn", detail: h1s.length === 1 ? `“${h1s[0].slice(0, 80)}”` : h1s.length === 0 ? "No H1 headline. Google and visitors can't tell what the page is about." : `${h1s.length} H1 headlines; there should be exactly one.` },
    { id: "words", label: "Enough content to rank", group: "seo", status: wordCount >= 400 ? "pass" : wordCount >= 150 ? "warn" : "fail", detail: `${wordCount.toLocaleString()} words on the homepage. Pages that rank for local contractor searches usually carry 400+.` },
    { id: "local", label: "Mentions your service area", group: "seo", status: localArea ? "pass" : "warn", detail: localArea ? "Service area is named on the page." : "No city or county names found. Local searches need the places you work in, in words." },
    { id: "phone", label: "Phone number visible", group: "leads", status: phone ? "pass" : "fail", detail: phone ? "A phone number is on the page." : "No phone number found. Homeowners call; make it one tap." },
    { id: "cta", label: "Clear call to action", group: "leads", status: cta ? "pass" : "fail", detail: cta ? "There is an estimate / contact call to action." : "No 'get an estimate' or 'contact' call to action found." },
    { id: "reviews", label: "Social proof", group: "trust", status: reviews ? "pass" : "warn", detail: reviews ? "Reviews or testimonials are referenced." : "No reviews or testimonials on the homepage. Trust is what wins the high-ticket job." },
    { id: "schema", label: "Business schema (structured data)", group: "seo", status: schema ? "pass" : "warn", detail: schema ? "Structured data is present." : "No LocalBusiness schema. It helps Google show your hours, area and reviews." },
    { id: "analytics", label: "Analytics installed", group: "leads", status: analytics ? "pass" : "fail", detail: analytics ? "A Google Analytics / Tag Manager or Meta tag is installed." : "No analytics tag found. You can't improve what you can't measure." },
    { id: "og", label: "Looks right when shared", group: "trust", status: og ? "pass" : "warn", detail: og ? "Open Graph tags set the preview when the link is shared." : "No Open Graph tags; shared links show a blank preview." },
    { id: "fresh", label: "Looks current", group: "trust", status: stale ? "warn" : "pass", detail: stale ? `Copyright says ${copyright}. An old year reads as an abandoned business.` : "Nothing on the page reads as out of date." },
  ];
  void finalUrl;
  return { checks, meta: { title, description, h1: h1s[0] ?? null, wordCount } };
}

export function summarize(checks: Check[], scores: AuditReport["scores"]): AuditReport["summary"] {
  const passed = checks.filter((c) => c.status === "pass").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const scored = checks.filter((c) => c.status !== "info").length || 1;
  const checkPct = (passed + warned * 0.5) / scored;
  const pct = scores ? checkPct * 0.6 + ((scores.performance + scores.seo) / 200) * 0.4 : checkPct;
  const grade = pct >= 0.9 ? "A" : pct >= 0.75 ? "B" : pct >= 0.6 ? "C" : pct >= 0.45 ? "D" : "F";
  const priority: Record<string, number> = { rankings: 0, phone: 1, cta: 2, "is-crawlable": 3, analytics: 4, "largest-contentful-paint": 5, viewport: 6, "document-title": 7, h1: 8, "meta-description": 9, words: 10, reviews: 11 };
  const fixFirst = [...checks].filter((c) => c.status === "fail" || c.status === "warn").sort((a, b) => (priority[a.id] ?? 50) - (priority[b.id] ?? 50) + (a.status === "fail" ? -20 : 0) - (b.status === "fail" ? -20 : 0)).slice(0, 3).map((c) => c.label);
  const headline = grade === "A" ? "Strong foundation. The next gains are in content and reviews."
    : grade === "B" ? "Solid site with a few leaks. Fix the top three and leads go up."
    : grade === "C" ? "Average. You're losing jobs to competitors who simply look more trustworthy online."
    : "This site is costing you work. Most of these fixes are quick.";
  return { passed, warned, failed, grade, headline, fixFirst };
}

export async function runAudit(inputUrl: string): Promise<AuditReport> {
  const url = normalizeUrl(inputUrl);
  if (!url) throw new Error("That doesn't look like a website address.");

  const [page, psi] = await Promise.all([
    safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; UnifictionalInspector/1.0)" }, signal: AbortSignal.timeout(20_000) })
      .then(async (r) => ({ ok: r.ok, status: r.status, finalUrl: r.url || url, html: await r.text() }))
      .catch(() => ({ ok: false, status: 0, finalUrl: url, html: "" })),
    (async () => {
      const key = process.env.PSI_API_KEY;
      const qs = new URLSearchParams({ url, strategy: "mobile" });
      for (const c of ["performance", "seo", "accessibility", "best-practices"]) qs.append("category", c);
      if (key) qs.set("key", key);
      return getJson<PsiResponse & { lighthouseResult?: { audits?: PsiAudits } }>(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`).catch(() => null);
    })(),
  ]);

  if (!page.ok && !psi) throw new Error(`We couldn't reach ${url} (status ${page.status || "no response"}). Check the address and try again.`);

  const checks: Check[] = [];
  if (!page.ok) checks.push({ id: "reachable", label: "Site reachable", group: "trust", status: "fail", detail: `The homepage returned status ${page.status || "no response"}.` });

  let scores: AuditReport["scores"] = null, vitals: AuditReport["vitals"] = null;
  if (psi) {
    const m = mapPsi(psi);
    scores = { performance: m.perf_score, seo: m.seo_score, accessibility: m.a11y_score, bestPractices: m.bp_score };
    vitals = { lcpMs: m.lcp_ms, cls: m.cls, inpMs: m.inp_ms };
    const audits = psi.lighthouseResult?.audits ?? {};
    for (const c of LH_CHECKS) {
      const a = audits[c.id];
      if (!a) continue;
      const status = statusFromScore(a.score);
      checks.push({ id: c.id, label: c.label, group: c.group, status, detail: `${status === "pass" ? c.pass : c.fail}${a.displayValue ? ` (${a.displayValue})` : ""}` });
    }
  } else {
    checks.push({ id: "psi", label: "Speed test", group: "speed", status: "info", detail: "Google's speed test was busy; speed scores will be in the full report." });
  }

  const onPage = page.html ? htmlChecks(page.html, page.finalUrl) : { checks: [], meta: { title: null, description: null, h1: null, wordCount: 0 } };
  const seen = new Set(checks.map((c) => c.id));
  for (const c of onPage.checks) if (!seen.has(c.id)) checks.push(c);

  let seo: SeoReport | null = null;
  if (page.html) {
    const origin = new URL(page.finalUrl).origin;
    const domain = new URL(page.finalUrl).hostname;
    const text = page.html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const [rankings, sitemapPages, robots] = await Promise.all([
      checkRankings(domain, queriesFor(onPage.meta.title, text)),
      fetchSitemapCount(origin),
      fetchRobots(origin),
    ]);
    seo = buildSeoReport({ domain, html: page.html, text, title: onPage.meta.title, description: onPage.meta.description, wordCount: onPage.meta.wordCount, rankings, sitemapPages, robots });
    if (seo.rankingsChecked && seo.pageOneCount === 0) {
      checks.push({ id: "rankings", label: "Page one for local searches", group: "seo", status: "fail", detail: `Not on page one for any of the ${seo.rankings.filter((r) => r.checked).length} “${seo.trade}” searches we tested.` });
    } else if (seo.rankingsChecked && seo.pageOneCount < seo.rankings.filter((r) => r.checked).length) {
      checks.push({ id: "rankings", label: "Page one for local searches", group: "seo", status: "warn", detail: `Found for ${seo.pageOneCount} of ${seo.rankings.filter((r) => r.checked).length} local searches.` });
    }
  }

  return { url, finalUrl: page.finalUrl, fetchedAt: new Date().toISOString(), scores, vitals, checks, summary: summarize(checks, scores), meta: onPage.meta, seo };
}
