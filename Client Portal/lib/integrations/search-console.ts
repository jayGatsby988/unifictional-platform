import { bearer } from "./google-auth";
import { dateStr, getJson } from "./types";

/** Search Console Search Analytics. The SA email must be a user on the property. */

type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
export type GscResponse = { rows?: GscRow[] };

export function mapGscDaily(res: GscResponse) {
  return (res.rows ?? []).map((r) => ({
    date: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: +(r.ctr * 100).toFixed(2), position: +r.position.toFixed(1),
  }));
}

export function mapGscQueries(res: GscResponse, siteUrl: string) {
  const origin = siteUrl.startsWith("sc-domain:") ? null : siteUrl.replace(/\/$/, "");
  return (res.rows ?? []).map((r) => ({
    keyword: r.keys[0],
    url: origin && r.keys[1]?.startsWith(origin) ? r.keys[1].slice(origin.length) || "/" : (r.keys[1] ?? "/").replace(/^https?:\/\/[^/]+/, "") || "/",
    position: +r.position.toFixed(1), clicks: r.clicks, impressions: r.impressions,
  }));
}

export async function fetchSearchConsole(siteUrl: string, token: string) {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  // Search Console data lags ~2 days.
  const [daily, queries] = await Promise.all([
    getJson<GscResponse>(endpoint, { method: "POST", headers: bearer(token), body: JSON.stringify({ startDate: dateStr(182), endDate: dateStr(2), dimensions: ["date"], rowLimit: 200 }) }),
    getJson<GscResponse>(endpoint, { method: "POST", headers: bearer(token), body: JSON.stringify({ startDate: dateStr(30), endDate: dateStr(2), dimensions: ["query", "page"], rowLimit: 25, orderBy: [{ fieldName: "clicks", sortOrder: "DESCENDING" }] }) }),
  ]);
  return { daily: mapGscDaily(daily), keywords: mapGscQueries(queries, siteUrl) };
}
