export type ClientIntegration = {
  client_id: string;
  site_url: string | null;
  ga4_property_id: string | null;
  gsc_site_url: string | null;
  gbp_location_id: string | null;
  gbp_account_id: string | null;
  google_refresh_token: string | null;
  google_account_label: string | null;
  meta_user_token: string | null;
  meta_account_label: string | null;
  meta_expires_at: string | null;
  ig_user_id: string | null;
  fb_page_id: string | null;
  meta_page_token: string | null;
  ghl_contact_id: string | null;
};

export type Source = "ga4" | "search_console" | "pagespeed" | "uptime" | "health" | "gbp" | "meta" | "autopay";
export const SOURCES: Source[] = ["ga4", "search_console", "pagespeed", "uptime", "health", "gbp", "meta", "autopay"];

export type SyncResult = { source: Source; ok: boolean; message: string; rows: number };

/** YYYY-MM-DD for `daysAgo` days before today (UTC). */
export function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url.split("?")[0]}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}
