import type { Session } from "./repo";
import { createClient } from "@/lib/supabase/server";

export type AdminClient = {
  slug: string; name: string;
  fields: { site_url: string; ga4_property_id: string; gsc_site_url: string; gbp_location_id: string; gbp_account_id: string; ig_user_id: string; fb_page_id: string; ghl_contact_id: string };
  updatedAt: string | null;
  google: { connected: boolean; label: string | null };
  meta: { connected: boolean; label: string | null; expiring: boolean };
};
export type SyncRun = { id: string; client: string; source: string; ok: boolean; message: string; rows: number; ranAt: string };
export type StudioAccount = { provider: "google" | "meta"; connected: boolean; label: string | null; connectedAt: string | null; expiresAt: string | null; expiring: boolean };

const ENV_KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "META_APP_ID", "META_APP_SECRET", "PSI_API_KEY", "GOOGLE_CSE_KEY", "GOOGLE_CSE_CX", "GHL_TOKEN", "GHL_LOCATION_ID"];

const empty = { site_url: "", ga4_property_id: "", gsc_site_url: "", gbp_location_id: "", gbp_account_id: "", ig_user_id: "", fb_page_id: "", ghl_contact_id: "" };

export async function getAdminData(session: Session): Promise<{ env: { key: string; set: boolean }[]; studio: StudioAccount[]; runs: SyncRun[]; clients: AdminClient[] }> {
  const env = ENV_KEYS.map((key) => ({ key, set: Boolean(process.env[key]) }));
  if (session.isDemo) {
    const t = new Date(Date.now() - 3 * 3600e3).toISOString();
    return {
      env,
      studio: [
        { provider: "google", connected: true, label: "unifictional@gmail.com", connectedAt: t, expiresAt: null, expiring: false },
        { provider: "meta", connected: false, label: null, connectedAt: null, expiresAt: null, expiring: false },
      ],
      runs: [
        { id: "d1", client: "Northline Builders", source: "ga4", ok: true, message: "ok", rows: 60, ranAt: t },
        { id: "d2", client: "Northline Builders", source: "search_console", ok: true, message: "ok", rows: 205, ranAt: t },
        { id: "d3", client: "Northline Builders", source: "meta", ok: false, message: "Connect the studio Meta account on /admin and pick a Page", rows: 0, ranAt: t },
      ],
      clients: [
        {
          slug: "northline-builders", name: "Northline Builders",
          fields: { ...empty, site_url: "https://northlinebuilders.com", ga4_property_id: "412345678", gsc_site_url: "sc-domain:northlinebuilders.com", gbp_location_id: "1234567890", gbp_account_id: "1098765" },
          updatedAt: new Date().toISOString(),
          google: { connected: true, label: "office@northlinebuilders.com" }, meta: { connected: false, label: null, expiring: false },
        },
        {
          slug: "cascade-poolworks", name: "Cascade Poolworks",
          fields: { ...empty, site_url: "https://cascadepoolworks.com" }, updatedAt: null,
          google: { connected: false, label: null }, meta: { connected: false, label: null, expiring: false },
        },
      ],
    };
  }
  const supabase = await createClient();
  const [{ data: integ }, { data: runs }, { data: conns }] = await Promise.all([
    supabase.from("client_integrations").select("*"),
    supabase.from("sync_runs").select("*").order("ran_at", { ascending: false }).limit(30),
    supabase.from("studio_connections").select("provider, account_label, connected_at, expires_at, refresh_token, access_token"),
  ]);
  const byId = new Map((integ ?? []).map((i) => [i.client_id, i]));
  const nameById = new Map(session.clients.map((c) => [c.id, c.name]));
  const studio: StudioAccount[] = (["google", "meta"] as const).map((provider) => {
    const c = (conns ?? []).find((x) => x.provider === provider);
    const expiresAt = c?.expires_at ?? null;
    return { provider, connected: Boolean(c && (c.refresh_token || c.access_token)), label: c?.account_label ?? null, connectedAt: c?.connected_at ?? null, expiresAt, expiring: Boolean(expiresAt && new Date(expiresAt).getTime() - Date.now() < 10 * 864e5) };
  });
  return {
    env, studio,
    runs: (runs ?? []).map((r) => ({ id: r.id, client: nameById.get(r.client_id) ?? r.client_id, source: r.source, ok: r.ok, message: r.message ?? "", rows: r.rows ?? 0, ranAt: r.ran_at })),
    clients: session.clients.map((c) => {
      const i = byId.get(c.id) ?? {};
      return {
        slug: c.slug, name: c.name,
        fields: { site_url: i.site_url ?? "", ga4_property_id: i.ga4_property_id ?? "", gsc_site_url: i.gsc_site_url ?? "", gbp_location_id: i.gbp_location_id ?? "", gbp_account_id: i.gbp_account_id ?? "", ig_user_id: i.ig_user_id ?? "", fb_page_id: i.fb_page_id ?? "", ghl_contact_id: i.ghl_contact_id ?? "" },
        updatedAt: i.updated_at ?? null,
        google: { connected: Boolean(i.google_refresh_token), label: i.google_account_label ?? null },
        meta: { connected: Boolean(i.meta_user_token), label: i.meta_account_label ?? null, expiring: Boolean(i.meta_expires_at && new Date(i.meta_expires_at).getTime() - Date.now() < 10 * 864e5) },
      };
    }),
  };
}
