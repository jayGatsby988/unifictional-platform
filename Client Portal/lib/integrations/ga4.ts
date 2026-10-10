import { bearer } from "./google-auth";
import { dateStr, getJson } from "./types";

/** GA4 Data API (runReport). The SA email must be a Viewer on the property. */

type Ga4Row = { dimensionValues: { value: string }[]; metricValues: { value: string }[] };
export type Ga4Report = { rows?: Ga4Row[] };

const LEAD_EVENTS = ["generate_lead", "form_submit", "submit_form", "contact", "estimate_request", "quote_generated"];

export function ga4Date(v: string) {
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

export function mapDaily(report: Ga4Report) {
  return (report.rows ?? []).map((r) => ({
    date: ga4Date(r.dimensionValues[0].value),
    sessions: +r.metricValues[0].value,
    users: +r.metricValues[1].value,
    pageviews: +r.metricValues[2].value,
  }));
}

export function mapLeadEvents(report: Ga4Report) {
  const byDate = new Map<string, number>();
  for (const r of report.rows ?? []) {
    const d = ga4Date(r.dimensionValues[0].value);
    byDate.set(d, (byDate.get(d) ?? 0) + +r.metricValues[0].value);
  }
  return byDate;
}

export function mapSources(report: Ga4Report) {
  const rows = (report.rows ?? []).map((r) => ({ name: r.dimensionValues[0].value, sessions: +r.metricValues[0].value }));
  const total = rows.reduce((a, r) => a + r.sessions, 0) || 1;
  return rows.sort((a, b) => b.sessions - a.sessions).slice(0, 6).map((r) => ({ name: r.name, sharePct: Math.round((r.sessions / total) * 100) }));
}

export function mapTopPages(report: Ga4Report) {
  return (report.rows ?? []).map((r) => ({ path: r.dimensionValues[0].value, views: +r.metricValues[0].value, conversions: +r.metricValues[1].value }));
}

async function runReport(propertyId: string, token: string, body: Record<string, unknown>) {
  return getJson<Ga4Report>(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: "POST", headers: bearer(token), body: JSON.stringify(body),
  });
}

export async function fetchGa4(propertyId: string, token: string) {
  const range60 = [{ startDate: dateStr(60), endDate: dateStr(1) }];
  const range30 = [{ startDate: dateStr(30), endDate: dateStr(1) }];

  const [daily, leads, sources, pages] = await Promise.all([
    runReport(propertyId, token, { dateRanges: range60, dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }], limit: 100 }),
    runReport(propertyId, token, {
      dateRanges: range60, dimensions: [{ name: "date" }], metrics: [{ name: "eventCount" }],
      dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: LEAD_EVENTS } } }, limit: 100,
    }),
    runReport(propertyId, token, { dateRanges: range30, dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], limit: 10 }),
    runReport(propertyId, token, { dateRanges: range30, dimensions: [{ name: "pagePath" }], metrics: [{ name: "screenPageViews" }, { name: "keyEvents" }], orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 8 }),
  ]);

  const leadMap = mapLeadEvents(leads);
  return {
    daily: mapDaily(daily).map((d) => ({ ...d, form_submissions: leadMap.get(d.date) ?? 0 })),
    sources: mapSources(sources),
    topPages: mapTopPages(pages),
  };
}
