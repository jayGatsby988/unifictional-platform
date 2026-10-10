import type { SupabaseClient } from "@supabase/supabase-js";
import { SCOPES, bearer, refreshAccessToken, serviceAccountToken } from "./google-auth";
import { getJson } from "./types";

/**
 * Credentials. The portal admin (Unifictional) connects its own Google and Meta
 * accounts once as the default, and can also connect a company's own accounts
 * separately; the company's connection wins when it exists. Everything per
 * client is then just an id picked from what the account can already see.
 */

export type StudioConnection = { provider: "google" | "meta"; refresh_token: string | null; access_token: string | null; account_label: string | null; scopes: string | null; expires_at: string | null; connected_at: string };

export async function getStudioConnection(db: SupabaseClient, provider: "google" | "meta"): Promise<StudioConnection | null> {
  const { data } = await db.from("studio_connections").select("*").eq("provider", provider).maybeSingle();
  return (data as StudioConnection | null) ?? null;
}

/**
 * Access token for Google APIs: the studio's connected account first, then the
 * optional service account (which only covers Analytics + Search Console).
 */
export async function googleToken(db: SupabaseClient, need: "analytics" | "searchConsole" | "business", clientId?: string): Promise<string> {
  if (clientId) {
    const { data } = await db.from("client_integrations").select("google_refresh_token").eq("client_id", clientId).maybeSingle();
    if (data?.google_refresh_token) return refreshAccessToken(data.google_refresh_token);
  }
  const conn = await getStudioConnection(db, "google");
  if (conn?.refresh_token) return refreshAccessToken(conn.refresh_token);
  if (need === "business") throw new Error("Business Profile needs the studio Google account connected on /admin");
  return serviceAccountToken([SCOPES.analytics, SCOPES.searchConsole]);
}

export async function metaUserToken(db: SupabaseClient, clientId?: string): Promise<string | null> {
  if (clientId) {
    const { data } = await db.from("client_integrations").select("meta_user_token").eq("client_id", clientId).maybeSingle();
    if (data?.meta_user_token) return data.meta_user_token;
  }
  const conn = await getStudioConnection(db, "meta");
  return conn?.access_token ?? null;
}

// ---- what the studio account can see (fills the admin dropdowns) ----------

export type GoogleOptions = {
  ga4: { id: string; label: string }[];
  gsc: { id: string; label: string }[];
  gbp: { id: string; label: string; accountId: string }[];
  errors: string[];
};
export type MetaOptions = { pages: { id: string; label: string; igUserId: string | null; igUsername: string | null }[]; errors: string[] };

type AccountSummaries = { accountSummaries?: { displayName?: string; propertySummaries?: { property: string; displayName?: string }[] }[]; nextPageToken?: string };
type Sites = { siteEntry?: { siteUrl: string; permissionLevel?: string }[] };
type Accounts = { accounts?: { name: string; accountName?: string }[] };
type Locations = { locations?: { name: string; title?: string; storefrontAddress?: { locality?: string; administrativeArea?: string } }[] };

export async function listGoogleOptions(token: string): Promise<GoogleOptions> {
  const out: GoogleOptions = { ga4: [], gsc: [], gbp: [], errors: [] };
  const h = { headers: bearer(token) };
  await Promise.all([
    (async () => {
      try {
        let pageToken = "";
        do {
          const r = await getJson<AccountSummaries>(`https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`, h);
          for (const a of r.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) out.ga4.push({ id: p.property.replace("properties/", ""), label: `${p.displayName ?? p.property} · ${a.displayName ?? ""}`.trim() });
          pageToken = r.nextPageToken ?? "";
        } while (pageToken);
      } catch (e) { out.errors.push(`Analytics: ${(e as Error).message.slice(0, 160)}`); }
    })(),
    (async () => {
      try {
        const r = await getJson<Sites>("https://www.googleapis.com/webmasters/v3/sites", h);
        out.gsc = (r.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => ({ id: s.siteUrl, label: s.siteUrl }));
      } catch (e) { out.errors.push(`Search Console: ${(e as Error).message.slice(0, 160)}`); }
    })(),
    (async () => {
      try {
        const acc = await getJson<Accounts>("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", h);
        for (const a of acc.accounts ?? []) {
          const accountId = a.name.split("/")[1];
          const locs = await getJson<Locations>(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,storefrontAddress&pageSize=100`, h);
          for (const l of locs.locations ?? []) {
            const where = [l.storefrontAddress?.locality, l.storefrontAddress?.administrativeArea].filter(Boolean).join(", ");
            out.gbp.push({ id: l.name.split("/")[1], accountId, label: `${l.title ?? l.name}${where ? ` · ${where}` : ""}` });
          }
        }
      } catch (e) { out.errors.push(`Business Profile: ${(e as Error).message.slice(0, 160)}`); }
    })(),
  ]);
  out.ga4.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

type Pages = { data?: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[]; paging?: { next?: string } };

export async function listMetaPages(userToken: string): Promise<MetaOptions> {
  const out: MetaOptions = { pages: [], errors: [] };
  try {
    let url: string | undefined = `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${userToken}`;
    while (url) {
      const r: Pages = await getJson<Pages>(url);
      for (const p of r.data ?? []) out.pages.push({ id: p.id, label: p.name, igUserId: p.instagram_business_account?.id ?? null, igUsername: p.instagram_business_account?.username ?? null });
      url = r.paging?.next;
    }
  } catch (e) { out.errors.push(`Meta: ${(e as Error).message.slice(0, 160)}`); }
  out.pages.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/** Long-lived Page token for one page, derived from the studio's user token. */
export async function metaPageToken(userToken: string, pageId: string): Promise<string> {
  const r = await getJson<{ access_token?: string }>(`https://graph.facebook.com/v21.0/${pageId}?fields=access_token&access_token=${userToken}`);
  if (!r.access_token) throw new Error("The studio Meta account is not an admin of that Page");
  return r.access_token;
}
