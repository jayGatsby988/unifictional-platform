/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AutopilotCadence } from "../data/types";
import { buildBrief } from "./brief";
import { generatePost } from "./generate";
import { assembleBody, slugFor, uniqueSlug, wordCount } from "./markdown";
import { publish, type Target } from "./publish";
import { cadenceLabel, isDue, nextRunAt, retryAt } from "./schedule";
import { fetchSiteContext } from "./site";

export type RunOutcome = { ok: boolean; message: string; postId?: string; published?: number };

/** One enabled company: its client row, its seo_autopilot settings and its client_integrations row (may be null). */
export type Ctx = { client: any; settings: any; cfg: any };

const siteOf = (c: Ctx): string => c.cfg?.site_url || c.client.website_url || "";

/** Where this company's posts go. Falls back to "manual" (the post waits in the portal) with the reason. */
export function resolveTarget(settings: { target: string }, cfg: any, siteUrl: string, env: { githubToken?: string } = { githubToken: process.env.GITHUB_TOKEN }): Target {
  if (settings.target === "wordpress") {
    if (cfg?.wp_url && cfg?.wp_user && cfg?.wp_app_password) return { kind: "wordpress", url: cfg.wp_url, user: cfg.wp_user, appPassword: cfg.wp_app_password };
    return { kind: "manual", reason: "WordPress login missing. The client re-enters it on their SEO Autopilot page." };
  }
  if (settings.target === "hosted") {
    if (cfg?.site_repo && env.githubToken) return { kind: "github", repo: cfg.site_repo, dir: cfg.site_blog_dir || "content/blog", siteUrl, token: env.githubToken };
    return { kind: "manual", reason: env.githubToken ? "No GitHub repo on this company's Data connections yet." : "GITHUB_TOKEN is not set (Setup & keys)." };
  }
  return { kind: "manual", reason: "The client pastes posts onto their site themselves." };
}

async function loadContexts(db: SupabaseClient, slug?: string): Promise<Ctx[]> {
  const { data, error } = await db.from("seo_autopilot").select("*, clients(id, slug, name, industry, city, website_url, services)").eq("enabled", true);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as any[]).filter((r) => r.clients && (!slug || r.clients.slug === slug));
  const ids = rows.map((r) => r.client_id);
  const cfgs = ids.length ? (await db.from("client_integrations").select("*").in("client_id", ids)).data ?? [] : [];
  const byId = new Map((cfgs as any[]).map((c) => [c.client_id, c]));
  return rows.map((r) => ({ client: r.clients, settings: r, cfg: byId.get(r.client_id) ?? null }));
}

/**
 * The daily job. For every company with autopilot on: publish anything the
 * client approved since last time, then write the next post if one is due.
 * `limit` caps how many posts are written per invocation so a cron stays
 * inside its time budget; the rest are picked up tomorrow.
 */
export async function runAutopilot(db: SupabaseClient, opts: { clientSlug?: string; force?: boolean; limit?: number } = {}): Promise<Record<string, RunOutcome>> {
  const out: Record<string, RunOutcome> = {};
  const ctxs = await loadContexts(db, opts.clientSlug);
  const now = new Date();
  let budget = opts.limit ?? 6;
  for (const c of ctxs) {
    const slug = c.client.slug as string;
    try {
      const published = await publishApproved(db, c);
      const due = opts.force || isDue(c.settings.next_run_at, now);
      if (!due) { out[slug] = { ok: true, message: `next post ${new Date(c.settings.next_run_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, published }; continue; }
      if (budget-- <= 0) { out[slug] = { ok: true, message: "deferred to tomorrow (batch full)", published }; continue; }
      out[slug] = { ...(await runForClient(db, c)), published };
    } catch (e) {
      out[slug] = { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
  return out;
}

async function runForClient(db: SupabaseClient, c: Ctx): Promise<RunOutcome> {
  const cid = c.client.id as string;
  const siteUrl = siteOf(c);
  const [site, kw, prior, snap] = await Promise.all([
    siteUrl ? fetchSiteContext(siteUrl) : Promise.resolve(null),
    db.from("seo_keywords").select("keyword, position, url").eq("client_id", cid).order("position").limit(40),
    db.from("seo_posts").select("title, target_query, slug").eq("client_id", cid).neq("status", "skipped").order("created_at", { ascending: false }).limit(100),
    db.from("website_snapshots").select("health").eq("client_id", cid).order("captured_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const checks = ((snap.data?.health as any)?.checks ?? []) as { status: string; label: string; detail: string }[];
  const brief = buildBrief({
    client: { name: c.client.name, industry: c.client.industry ?? "", city: c.client.city ?? "", websiteUrl: siteUrl, services: c.client.services ?? [] },
    notes: c.settings.notes ?? "",
    site,
    keywords: ((kw.data ?? []) as any[]).map((k) => ({ keyword: k.keyword, position: Number(k.position), url: k.url ?? "" })),
    existingPosts: ((prior.data ?? []) as any[]).map((p) => ({ title: p.title, targetQuery: p.target_query })),
    healthIssues: checks.filter((x) => x.status === "fail" || x.status === "warn").map((x) => `${x.label}: ${x.detail}`),
    cadence: cadenceLabel(c.settings.cadence as AutopilotCadence),
  });

  const stamp = () => new Date().toISOString();
  let gen: Awaited<ReturnType<typeof generatePost>>;
  try {
    gen = await generatePost(brief);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("seo_autopilot_runs").insert({ client_id: cid, ok: false, summary: `Couldn't write a post: ${message}` });
    await db.from("seo_autopilot").update({ next_run_at: retryAt(), last_run_at: stamp(), updated_at: stamp() }).eq("client_id", cid);
    return { ok: false, message };
  }

  const bodyMd = assembleBody(gen.bodyMarkdown, gen.faq);
  const slug = uniqueSlug(slugFor(gen.slug || gen.title), ((prior.data ?? []) as any[]).map((p) => p.slug));
  const approve = c.settings.mode === "approve";
  const { data: post, error } = await db.from("seo_posts").insert({
    client_id: cid, title: gen.title, slug, target_query: gen.targetQuery, meta_description: gen.metaDescription, excerpt: gen.excerpt,
    body_md: bodyMd, word_count: wordCount(bodyMd), status: approve ? "awaiting_approval" : "approved",
  }).select("*").single();
  if (error || !post) throw new Error(error?.message ?? "Could not save the post.");

  const fixes = gen.optimizations.slice(0, 5);
  await db.from("seo_autopilot_runs").insert({ client_id: cid, ok: true, post_id: post.id, fixes, summary: `Wrote "${gen.title}" for "${gen.targetQuery}"${fixes.length ? ` · ${fixes.length} fixes suggested` : ""}` });
  await db.from("seo_autopilot").update({ next_run_at: nextRunAt(c.settings.cadence), last_run_at: stamp(), updated_at: stamp() }).eq("client_id", cid);
  await db.from("work_log").insert({ client_id: cid, area: "seo", title: `Blog post written: ${gen.title}`, detail: `Targets "${gen.targetQuery}".${fixes.length ? ` ${fixes.length} on-page fixes suggested.` : ""}` });

  if (approve) {
    await db.from("activity").insert({ client_id: cid, area: "seo", title: `New blog post ready for your OK: ${gen.title}` });
    return { ok: true, message: `wrote "${gen.title}" (awaiting approval)`, postId: post.id };
  }
  const r = await publishPost(db, c, post);
  return { ok: r.ok, message: r.ok ? `published "${gen.title}"` : `wrote "${gen.title}" but publishing failed: ${r.message}`, postId: post.id };
}

/** Push one saved post to the client's site and record what happened. */
export async function publishPost(db: SupabaseClient, c: Ctx, post: any): Promise<RunOutcome> {
  const target = resolveTarget(c.settings, c.cfg, siteOf(c));
  const now = new Date().toISOString();
  if (target.kind === "manual") {
    await db.from("seo_posts").update({ status: "ready", error: target.reason, updated_at: now }).eq("id", post.id);
    await db.from("activity").insert({ client_id: c.client.id, area: "seo", title: `Blog post ready to put on your site: ${post.title}` });
    return { ok: true, message: `ready in the portal (${target.reason})`, postId: post.id };
  }
  try {
    const { url } = await publish(target, { title: post.title, slug: post.slug, metaDescription: post.meta_description ?? "", excerpt: post.excerpt ?? "", targetQuery: post.target_query ?? "", bodyMd: post.body_md }, now.slice(0, 10));
    await db.from("seo_posts").update({ status: "published", published_url: url, published_at: now, error: null, updated_at: now }).eq("id", post.id);
    await db.from("activity").insert({ client_id: c.client.id, area: "seo", title: `Published on your site: ${post.title}` });
    return { ok: true, message: url, postId: post.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("seo_posts").update({ status: "failed", error: message, updated_at: now }).eq("id", post.id);
    return { ok: false, message, postId: post.id };
  }
}

/** Posts the client approved in the portal, and ones that failed last time, go out first. Returns how many went live. */
async function publishApproved(db: SupabaseClient, c: Ctx): Promise<number> {
  const { data } = await db.from("seo_posts").select("*").eq("client_id", c.client.id).in("status", ["approved", "failed"]).order("created_at");
  let n = 0;
  for (const post of (data ?? []) as any[]) {
    const r = await publishPost(db, c, post);
    if (r.ok && r.message.startsWith("http")) n++;
  }
  return n;
}
