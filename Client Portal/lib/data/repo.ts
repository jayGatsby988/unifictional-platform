/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import { cookies } from "next/headers";
import { demoMode } from "@/lib/env";
import { claimInvites } from "./invites";
import { createClient } from "@/lib/supabase/server";
import { demoData } from "./demo";
import type { Activity, Client, Estimator, Generation, PortalData, PortalStatus, PricingConfig, Request, Seo, Social, Website } from "./types";

export type Session = {
  email: string;
  isDemo: boolean;
  isAdmin: boolean;
  client: Client | null;
  clients: Pick<Client, "id" | "slug" | "name">[];
  /** Signed in with a studio-issued temporary password and hasn't picked their own yet. */
  mustChangePassword?: boolean;
};

const CLIENT_COOKIE = "portal_client";

function mapClient(row: any): Client {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    industry: row.industry ?? "",
    city: row.city ?? "",
    websiteUrl: row.website_url ?? "",
    launchedAt: row.launched_at ?? null,
    services: row.services ?? [],
    accountManager: { name: row.manager_name ?? "Unifictional", email: row.manager_email ?? "unifictional@gmail.com" },
    billingCustomerId: row.square_customer_id ?? null,
  };
}

/** Who is signed in, and which client they are looking at. */
export async function getSession(): Promise<Session> {
  if (demoMode) {
    return {
      email: "demo@northlinebuilders.com",
      isDemo: true,
      isAdmin: true,
      client: demoData.client,
      clients: [{ id: demoData.client.id, slug: demoData.client.slug, name: demoData.client.name }],
    };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { email: "", isDemo: false, isAdmin: false, client: null, clients: [] };

  const { data: admin } = await supabase.from("portal_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  const isAdmin = Boolean(admin);

  // RLS already restricts this to the caller's clients (or all clients for admins).
  let { data: clientRows } = await supabase.from("clients").select("*").order("name");
  // First sign-in automation: claim any access the studio set up for this email.
  if (!isAdmin && !clientRows?.length && (await claimInvites(user)) > 0) {
    ({ data: clientRows } = await supabase.from("clients").select("*").order("name"));
  }
  const clients = (clientRows ?? []).map(mapClient);

  const wanted = (await cookies()).get(CLIENT_COOKIE)?.value;
  const client = clients.find((c) => c.slug === wanted) ?? clients[0] ?? null;

  return {
    email: user.email ?? "",
    isDemo: false,
    isAdmin,
    client,
    clients: clients.map(({ id, slug, name }) => ({ id, slug, name })),
    mustChangePassword: Boolean(user.user_metadata?.must_change_password) && !isAdmin,
  };
}

const sumBy = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + (f(r) || 0), 0);

export type ConnectionStatus = { site: boolean; ga4: boolean; gsc: boolean; gbp: boolean; meta: boolean };

/** Booleans only (from a security-definer view); the client never sees ids or tokens. */
export async function getConnectionStatus(session: Session): Promise<ConnectionStatus> {
  if (session.isDemo) return { site: true, ga4: true, gsc: true, gbp: false, meta: false };
  if (!session.client) return { site: false, ga4: false, gsc: false, gbp: false, meta: false };
  const supabase = await createClient();
  const { data } = await supabase.from("client_connection_status").select("*").eq("client_id", session.client.id).maybeSingle();
  return { site: Boolean(data?.site), ga4: Boolean(data?.ga4), gsc: Boolean(data?.gsc), gbp: Boolean(data?.gbp), meta: Boolean(data?.meta) };
}

/** Everything the portal renders for one client. */
export async function getPortal(): Promise<PortalData> {
  const session = await getSession();
  if (session.isDemo) return demoData;
  if (!session.client) throw new Error("No client is linked to this account yet.");

  const supabase = await createClient();
  const cid = session.client.id;
  const since = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

  const [snap, traffic, seoDays, keywords, gbp, seoLog, accounts, socialDays, posts, estSettings, estGens, requests, activity, leads, conn, uptime, lastRun] =
    await Promise.all([
      supabase.from("website_snapshots").select("*").eq("client_id", cid).order("captured_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("website_daily").select("*").eq("client_id", cid).gte("date", since(60)).order("date"),
      supabase.from("seo_daily").select("*").eq("client_id", cid).gte("date", since(180)).order("date"),
      supabase.from("seo_keywords").select("*").eq("client_id", cid).order("position"),
      supabase.from("gbp_snapshots").select("*").eq("client_id", cid).order("period_start", { ascending: false }).limit(2),
      supabase.from("work_log").select("*").eq("client_id", cid).eq("area", "seo").order("at", { ascending: false }).limit(8),
      supabase.from("social_accounts").select("*").eq("client_id", cid),
      supabase.from("social_daily").select("*").eq("client_id", cid).gte("date", since(30)).order("date"),
      supabase.from("social_posts").select("*").eq("client_id", cid).order("posted_at", { ascending: false }).limit(12),
      supabase.from("estimator_settings").select("*").eq("client_id", cid).maybeSingle(),
      supabase.from("estimator_generations").select("*").eq("client_id", cid).order("at", { ascending: false }).limit(100),
      supabase.from("requests").select("*").eq("client_id", cid).order("created_at", { ascending: false }),
      supabase.from("activity").select("*").eq("client_id", cid).order("at", { ascending: false }).limit(10),
      supabase.from("leads").select("*").eq("client_id", cid).order("at", { ascending: false }).limit(6),
      supabase.from("client_connection_status").select("*").eq("client_id", cid).maybeSingle(),
      supabase.from("uptime_checks").select("at, ok, ms").eq("client_id", cid).order("at", { ascending: false }).limit(30),
      supabase.from("sync_runs").select("ran_at").eq("client_id", cid).order("ran_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

  const t = traffic.data ?? [];
  const last30 = t.slice(-30);
  const prev30 = t.slice(-60, -30);
  const s = snap.data ?? {};

  const website: Website = {
    status: s.status ?? "live",
    uptimePct: s.uptime_pct ?? 100,
    lastCheckedAt: s.captured_at ?? new Date().toISOString(),
    scores: { performance: s.perf_score ?? 0, seo: s.seo_score ?? 0, accessibility: s.a11y_score ?? 0, bestPractices: s.bp_score ?? 0 },
    vitals: { lcpMs: s.lcp_ms ?? 0, cls: s.cls ?? 0, inpMs: s.inp_ms ?? 0 },
    last30: {
      sessions: sumBy(last30, (r: any) => r.sessions), users: sumBy(last30, (r: any) => r.users), pageviews: sumBy(last30, (r: any) => r.pageviews),
      formSubmissions: sumBy(last30, (r: any) => r.form_submissions), calls: sumBy(last30, (r: any) => r.calls),
    },
    prev30: {
      sessions: sumBy(prev30, (r: any) => r.sessions), users: sumBy(prev30, (r: any) => r.users), pageviews: sumBy(prev30, (r: any) => r.pageviews),
      formSubmissions: sumBy(prev30, (r: any) => r.form_submissions), calls: sumBy(prev30, (r: any) => r.calls),
    },
    sessionsDaily: last30.map((r: any) => ({ date: r.date, value: r.sessions ?? 0 })),
    sources: s.sources ?? [],
    topPages: s.top_pages ?? [],
    recentLeads: (leads.data ?? []).map((l: any) => ({ at: l.at, type: l.type, detail: l.detail })),
    health: s.health ?? null,
    healthAt: s.health_at ?? null,
    responseMs: (uptime.data ?? [])[0]?.ms ?? null,
    checks: ((uptime.data ?? []) as any[]).slice().reverse().map((c) => ({ at: c.at, ok: c.ok, ms: c.ms ?? 0 })),
  };

  const sd = (seoDays.data ?? []).map((r: any) => ({ date: r.date, clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, ctr: r.ctr ?? 0, position: r.position ?? 0 }));
  const cur = sd.slice(-90);
  const prev = sd.slice(-180, -90);
  const agg = (rows: typeof sd) => {
    const clicks = sumBy(rows, (r) => r.clicks);
    const impressions = sumBy(rows, (r) => r.impressions);
    return { clicks, impressions, ctr: impressions ? +((clicks / impressions) * 100).toFixed(2) : 0, position: rows.length ? +(sumBy(rows, (r) => r.position) / rows.length).toFixed(1) : 0 };
  };
  const g = gbp.data?.[0] ?? {};
  const gp = gbp.data?.[1] ?? {};
  const seo: Seo = {
    daily: cur,
    totals90: agg(cur),
    prev90: agg(prev),
    keywords: (keywords.data ?? []).map((k: any) => ({ keyword: k.keyword, position: k.position, prevPosition: k.prev_position, clicks: k.clicks ?? 0, impressions: k.impressions ?? 0, url: k.url ?? "/" })),
    gbp: {
      views: g.views ?? 0, searches: g.searches ?? 0, calls: g.calls ?? 0, directions: g.directions ?? 0, websiteClicks: g.website_clicks ?? 0,
      reviews: g.reviews ?? 0, rating: g.rating ?? 0, newReviews30: g.new_reviews ?? 0,
      prev: { views: gp.views ?? 0, calls: gp.calls ?? 0, directions: gp.directions ?? 0, websiteClicks: gp.website_clicks ?? 0 },
    },
    workLog: (seoLog.data ?? []).map((w: any) => ({ at: w.at, title: w.title, detail: w.detail ?? "" })),
  };

  const social: Social = {
    accounts: (accounts.data ?? []).map((a: any) => ({
      platform: a.platform, handle: a.handle, url: a.url ?? "", followers: a.followers ?? 0, followersDelta30: a.followers_delta_30 ?? 0,
      reach30: a.reach_30 ?? 0, profileVisits30: a.profile_visits_30 ?? 0, posts30: a.posts_30 ?? 0, engagementRatePct: a.engagement_rate ?? 0,
    })),
    reachDaily: (socialDays.data ?? []).map((r: any) => ({ date: r.date, value: r.reach ?? 0 })),
    posts: (posts.data ?? []).map((p: any) => ({
      id: p.id, platform: p.platform, kind: p.kind, caption: p.caption ?? "", at: p.posted_at, status: p.status,
      likes: p.likes ?? 0, comments: p.comments ?? 0, saves: p.saves ?? 0, reach: p.reach ?? 0, tone: "from-neutral-800 to-neutral-600", permalink: p.permalink ?? undefined,
    })),
  };

  const es = estSettings.data ?? {};
  const gens = estGens.data ?? [];
  const inDays = (days: number) => (r: any) => new Date(r.at).getTime() > Date.now() - days * 864e5;
  const cur30 = gens.filter(inDays(30));
  const prev30g = gens.filter((r: any) => inDays(60)(r) && !inDays(30)(r));
  const tally = (rows: any[]) => ({
    sessions: rows.length, generated: rows.length,
    quotesSent: rows.filter((r) => r.contact_email).length,
    leads: rows.filter((r) => r.contact_email || r.contact_phone).length,
  });
  const estimator: Estimator = {
    embedded: es.embedded ?? false,
    embedPath: es.embed_path ?? "/get-a-quote",
    stats30: { ...tally(cur30), sessions: es.sessions_30 ?? cur30.length },
    prev30: { ...tally(prev30g), sessions: es.sessions_prev_30 ?? prev30g.length },
    pricing: (es.config as PricingConfig) ?? { projectTypes: [], options: [], markupPct: 0, rangePct: 8, depositPct: 10, disclaimer: "", updatedAt: es.updated_at ?? new Date().toISOString() },
    generations: gens.map((g: any): Generation => ({
      id: g.id, at: g.at, projectTypeId: g.project_type_id ?? "", projectType: g.project_type ?? "", size: g.size ?? 0, unit: g.unit ?? "sqft",
      options: g.options ?? [], quoteLow: g.quote_low ?? 0, quoteHigh: g.quote_high ?? 0,
      contact: g.contact_email || g.contact_phone ? { name: g.contact_name ?? "", email: g.contact_email ?? "", phone: g.contact_phone ?? "", address: g.contact_address ?? undefined } : null,
      status: g.status ?? "new", sourcePage: g.source_page ?? "", notes: g.notes ?? undefined,
    })),
  };

  const reqs: Request[] = (requests.data ?? []).map((r: any) => ({ id: r.id, type: r.type, title: r.title, body: r.body ?? "", status: r.status, createdAt: r.created_at, reply: r.reply ?? undefined }));
  const acts: Activity[] = (activity.data ?? []).map((a: any) => ({ at: a.at, area: a.area, title: a.title }));

  const c = conn.data ?? {};
  const status: PortalStatus = {
    connected: { site: Boolean(c.site ?? session.client.websiteUrl), ga4: Boolean(c.ga4), gsc: Boolean(c.gsc), gbp: Boolean(c.gbp), meta: Boolean(c.meta) },
    has: {
      traffic: t.length > 0, seo: sd.length > 0, gbp: (gbp.data ?? []).length > 0, social: (accounts.data ?? []).length > 0,
      scores: Number(s.perf_score ?? 0) > 0, health: Boolean(s.health),
    },
    lastSyncAt: lastRun.data?.ran_at ?? null,
  };

  return { status, client: session.client, website, seo, social, estimator, requests: reqs, activity: acts, generatedAt: new Date().toISOString(), isDemo: false };
}
