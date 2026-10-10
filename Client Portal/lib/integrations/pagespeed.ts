import { getJson } from "./types";

/** PageSpeed Insights (Lighthouse) + a plain HTTP uptime check. */

export type PsiResponse = {
  lighthouseResult?: {
    categories?: Record<string, { score?: number }>;
    audits?: Record<string, { numericValue?: number }>;
  };
  loadingExperience?: { metrics?: Record<string, { percentile?: number }> };
};

export function mapPsi(res: PsiResponse) {
  const c = res.lighthouseResult?.categories ?? {};
  const a = res.lighthouseResult?.audits ?? {};
  const score = (k: string) => Math.round(((c[k]?.score ?? 0) as number) * 100);
  return {
    perf_score: score("performance"), seo_score: score("seo"), a11y_score: score("accessibility"), bp_score: score("best-practices"),
    lcp_ms: Math.round(a["largest-contentful-paint"]?.numericValue ?? 0),
    cls: +((a["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)),
    inp_ms: Math.round(res.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile ?? 0),
  };
}

export async function fetchPageSpeed(url: string) {
  const key = process.env.PSI_API_KEY;
  const qs = new URLSearchParams({ url, strategy: "mobile" });
  for (const c of ["performance", "seo", "accessibility", "best-practices"]) qs.append("category", c);
  if (key) qs.set("key", key);
  const res = await getJson<PsiResponse>(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`);
  return mapPsi(res);
}

export async function checkUptime(url: string): Promise<{ ok: boolean; status: number; ms: number }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", headers: { "User-Agent": "UnifictionalPortalUptime/1.0" }, signal: AbortSignal.timeout(15_000) });
    return { ok: res.status < 400, status: res.status, ms: Date.now() - t0 };
  } catch {
    return { ok: false, status: 0, ms: Date.now() - t0 };
  }
}
