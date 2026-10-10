import { bearer } from "./google-auth";
import { getJson } from "./types";

/**
 * Google Business Profile: Performance API for views/calls/directions/clicks and
 * the v4 reviews endpoint for rating and count. Uses the studio's connected
 * Google account (a manager on each client's listing) and needs Google's
 * one-time approval of the Cloud project for Business Profile APIs.
 */

type Series = { dailyMetric: string; timeSeries?: { datedValues?: { value?: string }[] } };
export type GbpPerf = { multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: Series[] }[] };
export type GbpReviews = { totalReviewCount?: number; averageRating?: number; reviews?: { createTime: string }[] };

const METRICS = ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "CALL_CLICKS", "BUSINESS_DIRECTION_REQUESTS", "WEBSITE_CLICKS"];

export function mapGbpPerf(res: GbpPerf) {
  const sum: Record<string, number> = {};
  for (const block of res.multiDailyMetricTimeSeries ?? []) {
    for (const s of block.dailyMetricTimeSeries ?? []) {
      sum[s.dailyMetric] = (s.timeSeries?.datedValues ?? []).reduce((a, v) => a + (+(v.value ?? 0)), 0);
    }
  }
  const views = (sum.BUSINESS_IMPRESSIONS_DESKTOP_MAPS ?? 0) + (sum.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH ?? 0) + (sum.BUSINESS_IMPRESSIONS_MOBILE_MAPS ?? 0) + (sum.BUSINESS_IMPRESSIONS_MOBILE_SEARCH ?? 0);
  const searches = (sum.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH ?? 0) + (sum.BUSINESS_IMPRESSIONS_MOBILE_SEARCH ?? 0);
  return { views, searches, calls: sum.CALL_CLICKS ?? 0, directions: sum.BUSINESS_DIRECTION_REQUESTS ?? 0, website_clicks: sum.WEBSITE_CLICKS ?? 0 };
}

function dateParts(d: Date) {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export async function fetchGbp(locationId: string, accountId: string | null, token: string, offsetDays = 0) {
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 1 - offsetDays);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 29);
  const s = dateParts(start), e = dateParts(end);
  const qs = new URLSearchParams();
  for (const m of METRICS) qs.append("dailyMetrics", m);
  qs.set("dailyRange.start_date.year", String(s.year)); qs.set("dailyRange.start_date.month", String(s.month)); qs.set("dailyRange.start_date.day", String(s.day));
  qs.set("dailyRange.end_date.year", String(e.year)); qs.set("dailyRange.end_date.month", String(e.month)); qs.set("dailyRange.end_date.day", String(e.day));
  const perf = await getJson<GbpPerf>(`https://businessprofileperformance.googleapis.com/v1/locations/${locationId}:fetchMultiDailyMetricsTimeSeries?${qs}`, { headers: bearer(token) });

  let reviews = { reviews: 0, rating: 0, new_reviews: 0 };
  if (accountId && offsetDays === 0) {
    const r = await getJson<GbpReviews>(`https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews?pageSize=50`, { headers: bearer(token) });
    const cutoff = Date.now() - 30 * 864e5;
    reviews = { reviews: r.totalReviewCount ?? 0, rating: r.averageRating ?? 0, new_reviews: (r.reviews ?? []).filter((x) => new Date(x.createTime).getTime() > cutoff).length };
  }
  return { period_start: start.toISOString().slice(0, 10), ...mapGbpPerf(perf), ...reviews };
}
