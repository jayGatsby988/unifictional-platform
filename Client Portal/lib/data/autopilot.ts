/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import { createClient } from "@/lib/supabase/server";
import type { Session } from "./repo";
import { accessFrom } from "@/lib/autopilot/access";
import { demoAutopilot, demoStudioAutopilot } from "./demo";
import type { Autopilot, AutopilotRun, AutopilotSettings, PostPerformance, SeoPost, StudioAutopilotRow } from "./types";

export const EMPTY_SETTINGS: AutopilotSettings = { enabled: false, cadence: "weekly", mode: "auto", target: "hosted", wpConnected: false, notes: "", nextRunAt: null, lastRunAt: null, plan: [], comped: false, subscription: null, package: null, access: false };

export function mapSettings(r: any): AutopilotSettings {
  return {
    enabled: Boolean(r.enabled), cadence: r.cadence ?? "weekly", mode: r.mode ?? "auto", target: r.target ?? "hosted",
    wpConnected: Boolean(r.wp_connected), notes: r.notes ?? "", nextRunAt: r.next_run_at ?? null, lastRunAt: r.last_run_at ?? null,
    plan: Array.isArray(r.plan) ? r.plan : [],
    comped: Boolean(r.comped),
    package: r.package && typeof r.package.posts === "number" ? { posts: r.package.posts, addons: Array.isArray(r.package.addons) ? r.package.addons : [], amount: Number(r.package.amount) || 0, name: String(r.package.name ?? "") } : null,
    subscription: r.square_subscription_id ? { id: r.square_subscription_id, status: r.subscription_status ?? "", plan: r.subscription_plan ?? "", checkedAt: r.subscription_checked_at ?? "" } : null,
    access: accessFrom(r),
  };
}

export function mapPost(p: any, performance: PostPerformance | null = null): SeoPost {
  return {
    id: p.id, createdAt: p.created_at, title: p.title, slug: p.slug, targetQuery: p.target_query ?? "", rationale: p.rationale ?? "",
    metaDescription: p.meta_description ?? "", excerpt: p.excerpt ?? "", bodyMd: p.body_md ?? "", wordCount: p.word_count ?? 0, status: p.status,
    publishedUrl: p.published_url ?? null, publishedAt: p.published_at ?? null, error: p.error ?? null,
    quality: p.quality && typeof p.quality.score === "number" ? p.quality : null, performance,
  };
}

export function mapRun(r: any): AutopilotRun {
  return { id: r.id, ranAt: r.ran_at, ok: Boolean(r.ok), summary: r.summary ?? "", postId: r.post_id ?? null, fixes: Array.isArray(r.fixes) ? r.fixes : [] };
}

/** Search Console rows whose URL is this post, summed. Null until there are any. */
export function performanceFor(slug: string, keywords: { url: string | null; clicks: number | null; impressions: number | null; position: number | null }[]): PostPerformance | null {
  const mine = keywords.filter((k) => (k.url ?? "").replace(/\/+$/, "").endsWith(`/blog/${slug}`));
  if (!mine.length) return null;
  const clicks = mine.reduce((a, k) => a + (k.clicks ?? 0), 0);
  const impressions = mine.reduce((a, k) => a + (k.impressions ?? 0), 0);
  const withPos = mine.filter((k) => k.position != null);
  const position = withPos.length ? +(withPos.reduce((a, k) => a + Number(k.position), 0) / withPos.length).toFixed(1) : null;
  return { clicks, impressions, position, keywords: mine.length };
}

/** What the client sees on /autopilot. */
export async function getAutopilot(session: Session): Promise<Autopilot> {
  if (session.isDemo) return demoAutopilot;
  if (!session.client) return { settings: EMPTY_SETTINGS, posts: [], runs: [] };
  const db = await createClient();
  const cid = session.client.id;
  const [s, p, r, k] = await Promise.all([
    db.from("seo_autopilot").select("*").eq("client_id", cid).maybeSingle(),
    db.from("seo_posts").select("*").eq("client_id", cid).order("created_at", { ascending: false }).limit(60),
    db.from("seo_autopilot_runs").select("*").eq("client_id", cid).order("ran_at", { ascending: false }).limit(12),
    db.from("seo_keywords").select("url, clicks, impressions, position").eq("client_id", cid).like("url", "%/blog/%"),
  ]);
  const keywords = (k.data ?? []) as any[];
  return {
    settings: s.data ? mapSettings(s.data) : EMPTY_SETTINGS,
    posts: ((p.data ?? []) as any[]).map((row) => mapPost(row, performanceFor(row.slug, keywords))),
    runs: ((r.data ?? []) as any[]).map(mapRun),
  };
}

/** Can posts go out on their own for this company, given its target and what the studio has set up? */
export function publishingStatus(s: Pick<AutopilotSettings, "target" | "wpConnected">, cfg: { site_repo?: string | null; site_revalidate_url?: string | null } | null, githubToken: boolean): StudioAutopilotRow["publishing"] {
  if (s.target === "wordpress") return s.wpConnected ? { ready: true, note: "WordPress" } : { ready: false, note: "WordPress login missing" };
  if (s.target === "hosted") {
    if (cfg?.site_repo) return githubToken ? { ready: true, note: `GitHub · ${cfg.site_repo}` } : { ready: false, note: "GITHUB_TOKEN not set" };
    if (cfg?.site_revalidate_url) return { ready: true, note: "Site pulls posts from the portal" };
    return { ready: false, note: "Add the repo or revalidate URL on Data connections" };
  }
  return { ready: false, note: "Client pastes posts themselves" };
}

/** Every company's autopilot at a glance, for Studio · SEO Autopilot. */
export async function getStudioAutopilot(session: Session): Promise<StudioAutopilotRow[]> {
  if (session.isDemo) return demoStudioAutopilot;
  const db = await createClient();
  const [clients, settings, integ, posts, runs] = await Promise.all([
    db.from("clients").select("id, slug, name, website_url").order("name"),
    db.from("seo_autopilot").select("*"),
    db.from("client_integrations").select("client_id, site_url, site_repo, site_revalidate_url"),
    db.from("seo_posts").select("client_id, status"),
    db.from("seo_autopilot_runs").select("client_id, ran_at, ok, summary, fixes").order("ran_at", { ascending: false }).limit(300),
  ]);
  const githubToken = Boolean(process.env.GITHUB_TOKEN);
  return ((clients.data ?? []) as any[]).map((c) => {
    const s = ((settings.data ?? []) as any[]).find((x) => x.client_id === c.id);
    const cfg = ((integ.data ?? []) as any[]).find((x) => x.client_id === c.id) ?? null;
    const mine = ((posts.data ?? []) as any[]).filter((p) => p.client_id === c.id);
    const myRuns = ((runs.data ?? []) as any[]).filter((r) => r.client_id === c.id);
    const fixes = myRuns.flatMap((r) => (Array.isArray(r.fixes) ? r.fixes : []));
    const st = s ? mapSettings(s) : EMPTY_SETTINGS;
    return {
      slug: c.slug, name: c.name, website: cfg?.site_url ?? c.website_url ?? "",
      settings: st, publishing: publishingStatus(st, cfg, githubToken),
      awaiting: mine.filter((p) => p.status === "awaiting_approval").length,
      published: mine.filter((p) => p.status === "published").length,
      upcoming: st.plan.filter((p) => p.status === "planned").length,
      fixesDone: fixes.filter((f) => f.done).length,
      fixesTotal: fixes.length,
      lastRun: myRuns[0] ? { at: myRuns[0].ran_at, ok: Boolean(myRuns[0].ok), summary: myRuns[0].summary ?? "" } : null,
    };
  });
}
