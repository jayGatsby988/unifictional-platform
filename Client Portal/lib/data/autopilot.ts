/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import { createClient } from "@/lib/supabase/server";
import type { Session } from "./repo";
import { demoAutopilot, demoStudioAutopilot } from "./demo";
import type { Autopilot, AutopilotRun, AutopilotSettings, SeoPost, StudioAutopilotRow } from "./types";

export const EMPTY_SETTINGS: AutopilotSettings = { enabled: false, cadence: "weekly", mode: "approve", target: "hosted", wpConnected: false, notes: "", nextRunAt: null, lastRunAt: null };

export function mapSettings(r: any): AutopilotSettings {
  return {
    enabled: Boolean(r.enabled), cadence: r.cadence ?? "weekly", mode: r.mode ?? "approve", target: r.target ?? "hosted",
    wpConnected: Boolean(r.wp_connected), notes: r.notes ?? "", nextRunAt: r.next_run_at ?? null, lastRunAt: r.last_run_at ?? null,
  };
}

export function mapPost(p: any): SeoPost {
  return {
    id: p.id, createdAt: p.created_at, title: p.title, slug: p.slug, targetQuery: p.target_query ?? "", metaDescription: p.meta_description ?? "",
    excerpt: p.excerpt ?? "", bodyMd: p.body_md ?? "", wordCount: p.word_count ?? 0, status: p.status, publishedUrl: p.published_url ?? null,
    publishedAt: p.published_at ?? null, error: p.error ?? null,
  };
}

export function mapRun(r: any): AutopilotRun {
  return { id: r.id, ranAt: r.ran_at, ok: Boolean(r.ok), summary: r.summary ?? "", postId: r.post_id ?? null, fixes: Array.isArray(r.fixes) ? r.fixes : [] };
}

/** What the client sees on /autopilot. */
export async function getAutopilot(session: Session): Promise<Autopilot> {
  if (session.isDemo) return demoAutopilot;
  if (!session.client) return { settings: EMPTY_SETTINGS, posts: [], runs: [] };
  const db = await createClient();
  const cid = session.client.id;
  const [s, p, r] = await Promise.all([
    db.from("seo_autopilot").select("*").eq("client_id", cid).maybeSingle(),
    db.from("seo_posts").select("*").eq("client_id", cid).order("created_at", { ascending: false }).limit(60),
    db.from("seo_autopilot_runs").select("*").eq("client_id", cid).order("ran_at", { ascending: false }).limit(12),
  ]);
  return { settings: s.data ? mapSettings(s.data) : EMPTY_SETTINGS, posts: ((p.data ?? []) as any[]).map(mapPost), runs: ((r.data ?? []) as any[]).map(mapRun) };
}

/** Can posts go out on their own for this company, given its target and what the studio has set up? */
export function publishingStatus(s: Pick<AutopilotSettings, "target" | "wpConnected">, cfg: { site_repo?: string | null } | null, githubToken: boolean): StudioAutopilotRow["publishing"] {
  if (s.target === "wordpress") return s.wpConnected ? { ready: true, note: "WordPress" } : { ready: false, note: "WordPress login missing" };
  if (s.target === "hosted") {
    if (!githubToken) return { ready: false, note: "GITHUB_TOKEN not set" };
    return cfg?.site_repo ? { ready: true, note: `GitHub · ${cfg.site_repo}` } : { ready: false, note: "Add the GitHub repo on Data connections" };
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
    db.from("client_integrations").select("client_id, site_url, site_repo"),
    db.from("seo_posts").select("client_id, status"),
    db.from("seo_autopilot_runs").select("client_id, ran_at, ok, summary").order("ran_at", { ascending: false }).limit(300),
  ]);
  const githubToken = Boolean(process.env.GITHUB_TOKEN);
  return ((clients.data ?? []) as any[]).map((c) => {
    const s = ((settings.data ?? []) as any[]).find((x) => x.client_id === c.id);
    const cfg = ((integ.data ?? []) as any[]).find((x) => x.client_id === c.id) ?? null;
    const mine = ((posts.data ?? []) as any[]).filter((p) => p.client_id === c.id);
    const last = ((runs.data ?? []) as any[]).find((r) => r.client_id === c.id);
    const st = s ? mapSettings(s) : EMPTY_SETTINGS;
    return {
      slug: c.slug, name: c.name, website: cfg?.site_url ?? c.website_url ?? "",
      settings: st, publishing: publishingStatus(st, cfg, githubToken),
      awaiting: mine.filter((p) => p.status === "awaiting_approval").length,
      published: mine.filter((p) => p.status === "published").length,
      lastRun: last ? { at: last.ran_at, ok: Boolean(last.ok), summary: last.summary ?? "" } : null,
    };
  });
}
