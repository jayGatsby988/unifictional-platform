/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AutopilotCadence, PlanItem } from "../data/types";
import { loadSiteProfile } from "./profile";
import { buildBrief, type BriefInput } from "./brief";
import { generatePlan, generatePost, revisePost, type GeneratedPost } from "./generate";
import { assembleBody, slugFor, uniqueSlug, wordCount } from "./markdown";
import { nextPlanned, setStatus, toPlanItems } from "./plan";
import { publish, type Target } from "./publish";
import { autoReview, failedChecks, scorePost } from "./quality";
import { fetchSuggestions, seedQueries } from "./research";
import { cadenceLabel, isDue, nextRunAt, retryAt } from "./schedule";
import { fetchSiteContext } from "./site";
import { accessFrom, refreshSubscription } from "./access";
import { isSiteAccess, pasteNote, studioPastes, type SiteSetup } from "./site-access";
import { emailConfigured, sendEmail, STUDIO_EMAIL } from "@/lib/email/send";
import { postNeedsOkEmail, studioPastePostEmail } from "@/lib/email/templates";
import { clientRecipients } from "@/lib/email/recipients";
import { signOffFor } from "@/lib/email/send";
import { hostedBlogUrl, portalOrigin } from "@/lib/data/hosted-blog";

export type RunOutcome = { ok: boolean; message: string; postId?: string; published?: number };

/** One enabled company: its client row, its seo_autopilot settings and its client_integrations row (may be null). */
export type Ctx = { client: any; settings: any; cfg: any };

/** Below this score the writer gets one revision pass at the failed checks. */
const QUALITY_BAR = 85;

const siteOf = (c: Ctx): string => c.cfg?.site_url || c.client.website_url || "";
const stamp = () => new Date().toISOString();

/** Where this company's posts go. Falls back to "manual" (the post waits in the portal) with the reason. */
export function resolveTarget(settings: { target: string }, cfg: any, siteUrl: string, env: { githubToken?: string } = { githubToken: process.env.GITHUB_TOKEN }, clientSlug = ""): Target {
  // The blog we host: nothing to connect, live the moment the post is saved.
  if (settings.target === "blog") return clientSlug ? { kind: "blog", base: hostedBlogUrl(clientSlug) } : { kind: "manual", reason: "Hosted blog needs the company slug." };
  if (settings.target === "wordpress") {
    if (cfg?.wp_url && cfg?.wp_user && cfg?.wp_app_password) return { kind: "wordpress", url: cfg.wp_url, user: cfg.wp_user, appPassword: cfg.wp_app_password };
    return { kind: "manual", reason: "WordPress login missing. The client re-enters it on their SEO Autopilot page." };
  }
  if (settings.target === "hosted") {
    if (cfg?.site_repo && env.githubToken) return { kind: "github", repo: cfg.site_repo, dir: cfg.site_blog_dir || "content/blog", siteUrl, token: env.githubToken };
    if (cfg?.site_revalidate_url) return { kind: "feed", revalidateUrl: cfg.site_revalidate_url, siteUrl };
    if (cfg?.site_repo) return { kind: "manual", reason: "GITHUB_TOKEN is not set (Setup & keys)." };
    return { kind: "manual", reason: "No GitHub repo or revalidate URL on this company's Data connections yet." };
  }
  return { kind: "manual", reason: "The client pastes posts onto their site themselves." };
}

async function loadContexts(db: SupabaseClient, slug?: string): Promise<Ctx[]> {
  const { data, error } = await db.from("seo_autopilot").select("*, clients(id, slug, name, industry, city, website_url, services, square_customer_id)").eq("enabled", true);
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
      // Paid feature: comped by the studio, or a live Square subscription (re-checked daily).
      if (!accessFrom(c.settings)) {
        const stale = !c.settings.subscription_checked_at || Date.now() - new Date(c.settings.subscription_checked_at).getTime() > 20 * 3600e3;
        const r = stale ? await refreshSubscription(db, c.client).catch(() => ({ access: false })) : { access: false };
        if (!r.access) { out[slug] = { ok: true, message: "no active subscription (not written)" }; continue; }
      }
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

/** "Write a post now": one company, right away, regardless of schedule. */
export async function writeNow(db: SupabaseClient, slug: string): Promise<RunOutcome> {
  const [c] = await loadContexts(db, slug);
  if (!c) return { ok: false, message: "Autopilot is off for this company." };
  return runForClient(db, c);
}

/**
 * Research → plan → write → quality gate → save → publish, for one company.
 * Every step that can fail without losing the post (autocomplete, the plan,
 * the revision pass) is best-effort; only the writer itself is required.
 */
export async function runForClient(db: SupabaseClient, c: Ctx): Promise<RunOutcome> {
  const cid = c.client.id as string;
  const siteUrl = siteOf(c);
  const [site, kw, prior, snap] = await Promise.all([
    siteUrl ? fetchSiteContext(siteUrl) : Promise.resolve(null),
    db.from("seo_keywords").select("keyword, position, url").eq("client_id", cid).order("position").limit(40),
    db.from("seo_posts").select("title, target_query, slug").eq("client_id", cid).neq("status", "skipped").order("created_at", { ascending: false }).limit(100),
    db.from("website_snapshots").select("health").eq("client_id", cid).order("captured_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const checks = ((snap.data?.health as any)?.checks ?? []) as { status: string; label: string; detail: string }[];
  const existingPosts = ((prior.data ?? []) as any[]).map((p) => ({ title: p.title as string, targetQuery: p.target_query as string | null }));
  // What the business is, read from the site: a contractor trade, or (via Claude) anything else.
  const profile = await loadSiteProfile(db, c, site, siteUrl);
  const area: string = c.client.city || profile.city || "";
  const trade: string = c.client.industry || profile.industry;
  const priority: string[] = Array.isArray(c.settings.focus_keywords) ? c.settings.focus_keywords.filter((k: unknown) => typeof k === "string") : [];
  const suggestions = await fetchSuggestions([...priority, ...seedQueries(trade, area, c.client.services ?? []), ...profile.searchSeeds]);

  const base: BriefInput = {
    client: { name: c.client.name, industry: trade, city: area, websiteUrl: siteUrl, services: c.client.services ?? [] },
    profile,
    notes: c.settings.notes ?? "",
    priorityQueries: priority,
    site,
    keywords: ((kw.data ?? []) as any[]).map((k) => ({ keyword: k.keyword, position: Number(k.position), url: k.url ?? "" })),
    existingPosts,
    healthIssues: checks.filter((x) => x.status === "fail" || x.status === "warn").map((x) => `${x.label}: ${x.detail}`),
    cadence: cadenceLabel(c.settings.cadence as AutopilotCadence),
    suggestions,
  };

  // The content plan: draft twelve topics when the queue runs dry, then write the next one.
  let plan: PlanItem[] = Array.isArray(c.settings.plan) ? c.settings.plan : [];
  let planned = nextPlanned(plan, existingPosts);
  if (!planned) {
    try {
      plan = toPlanItems(await generatePlan(buildBrief(base)), plan);
      planned = nextPlanned(plan, existingPosts);
      await db.from("seo_autopilot").update({ plan, updated_at: stamp() }).eq("client_id", cid);
    } catch { /* a post without a plan is still a post */ }
  }
  const brief = buildBrief({ ...base, planned: planned ? { title: planned.title, targetQuery: planned.targetQuery, angle: planned.angle } : null });

  let gen: GeneratedPost;
  try {
    gen = await generatePost(brief);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("seo_autopilot_runs").insert({ client_id: cid, ok: false, summary: `Couldn't write a post: ${message}` });
    await db.from("seo_autopilot").update({ next_run_at: retryAt(), last_run_at: stamp(), updated_at: stamp() }).eq("client_id", cid);
    return { ok: false, message };
  }

  // Quality gate: score the draft, give the writer one pass at what it missed, keep the better one.
  const paths = site?.paths ?? [];
  const grade = (g: GeneratedPost) => scorePost({ title: g.title, metaDescription: g.metaDescription, bodyMd: assembleBody(g.bodyMarkdown, g.faq), targetQuery: g.targetQuery, area, faqCount: g.faq.length }, paths);
  let quality = grade(gen);
  if (quality.score < QUALITY_BAR) {
    try {
      const fixed = await revisePost(brief, gen, failedChecks(quality));
      const again = grade(fixed);
      if (again.score >= quality.score) { gen = fixed; quality = again; }
    } catch { /* keep the first draft */ }
  }

  const bodyMd = assembleBody(gen.bodyMarkdown, gen.faq);
  const slug = uniqueSlug(slugFor(gen.slug || gen.title), ((prior.data ?? []) as any[]).map((p) => p.slug));
  // Automatic mode: the checklist is the reviewer. A post that passes goes live; one that doesn't waits for a person.
  const review = autoReview(c.settings.mode === "approve" ? "approve" : "auto", quality.score);
  const approve = !review.publish;
  const { data: post, error } = await db.from("seo_posts").insert({
    client_id: cid, title: gen.title, slug, target_query: gen.targetQuery, rationale: gen.rationale, meta_description: gen.metaDescription, excerpt: gen.excerpt,
    body_md: bodyMd, word_count: wordCount(bodyMd), quality, status: approve ? "awaiting_approval" : "approved",
  }).select("*").single();
  if (error || !post) throw new Error(error?.message ?? "Could not save the post.");

  const fixes = gen.optimizations.slice(0, 5).map((f) => ({ ...f, done: false }));
  await db.from("seo_autopilot_runs").insert({ client_id: cid, ok: true, post_id: post.id, fixes, summary: `Wrote "${gen.title}" for "${gen.targetQuery}" · SEO check ${quality.score}/100${review.held ? " · held for review" : ""}${fixes.length ? ` · ${fixes.length} fixes suggested` : ""}` });
  if (planned) plan = setStatus(plan, planned.id, "written");
  await db.from("seo_autopilot").update({ next_run_at: nextRunAt(c.settings.cadence), last_run_at: stamp(), plan, updated_at: stamp() }).eq("client_id", cid);
  await db.from("work_log").insert({ client_id: cid, area: "seo", title: `Blog post written: ${gen.title}`, detail: `Targets "${gen.targetQuery}" · SEO check ${quality.score}/100.${fixes.length ? ` ${fixes.length} on-page fixes suggested.` : ""}` });

  if (approve) {
    await db.from("activity").insert({ client_id: cid, area: "seo", title: review.held ? `Held for your review (SEO check ${quality.score}/100): ${gen.title}` : `New blog post ready for your OK: ${gen.title}` });
    // Most owners won't log in to notice, so tell them. Best-effort: a failed email never fails the run.
    if (emailConfigured) {
      const people = await clientRecipients(db, cid).catch(() => []);
      for (const who of people) {
        const reviewUrl = `${portalOrigin()}/login?email=${encodeURIComponent(who.email)}&next=${encodeURIComponent("/autopilot")}`;
        const mail = postNeedsOkEmail({ name: who.name, title: gen.title, excerpt: gen.excerpt, held: review.held, reviewUrl, signOff: signOffFor("updates") });
        await sendEmail({ to: who.email, sender: "updates", replyTo: STUDIO_EMAIL, ...mail }).catch(() => null);
      }
    }
    return { ok: true, message: `wrote "${gen.title}" (${review.held ? `held for review, SEO check ${quality.score}/100` : "awaiting approval"})`, postId: post.id };
  }
  const r = await publishPost(db, c, post);
  const message = !r.ok ? `wrote "${gen.title}" but publishing failed: ${r.message}` : r.message.startsWith("http") ? `published "${gen.title}"` : `wrote "${gen.title}" (${r.message})`;
  return { ok: r.ok, message, postId: post.id };
}

/** Push one saved post to the client's site and record what happened. */
export async function publishPost(db: SupabaseClient, c: Ctx, post: any): Promise<RunOutcome> {
  const target = resolveTarget(c.settings, c.cfg, siteOf(c), undefined, c.client.slug as string);
  const now = stamp();
  if (target.kind === "manual") {
    // A "somewhere else" site: the studio pastes it (invited, or login on file) or the client does.
    const site: SiteSetup = { platform: c.settings.site_platform ?? "", access: isSiteAccess(c.settings.site_access) ? c.settings.site_access : null, loginOnFile: Boolean(c.settings.site_login_on_file), inviteSentAt: c.settings.site_invite_sent_at ?? null };
    const other = c.settings.target === "manual";
    const byStudio = other && studioPastes(site);
    const note = other ? pasteNote(site) : target.reason;
    await db.from("seo_posts").update({ status: "ready", error: note, updated_at: now }).eq("id", post.id);
    await db.from("activity").insert({ client_id: c.client.id, area: "seo", title: byStudio ? `Blog post written; Unifictional is putting it on your site: ${post.title}` : `Blog post ready to put on your site: ${post.title}` });
    if (byStudio) await notifyStudioToPaste(db, c, post, site).catch((e) => console.error("[autopilot] paste notice", e));
    return { ok: true, message: byStudio ? `ready for the studio to paste on ${site.platform || "their site"}` : `ready in the portal (${note})`, postId: post.id };
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

/** A post is waiting for the studio to paste onto a GoDaddy/Wix/… site: an Inbox request plus an email. */
async function notifyStudioToPaste(db: SupabaseClient, c: Ctx, post: any, site: SiteSetup): Promise<void> {
  const platform = site.platform || "their site";
  const access = site.access === "login" ? "login on file (Studio · SEO Autopilot)" : "we're invited as a collaborator";
  const portalUrl = `${portalOrigin()}/api/client/open?slug=${encodeURIComponent(c.client.slug)}&next=${encodeURIComponent("/autopilot")}`;
  await db.from("requests").insert({
    client_id: c.client.id, type: "seo", status: "open", requester_email: null,
    title: `Paste on ${platform}: ${post.title}`,
    body: `Written for ${c.client.name} and waiting on their SEO Autopilot page. Access: ${access}. Open their page, copy the post as HTML, paste it on ${platform}, then tap "It's live" on the post with the URL.`,
  });
  if (emailConfigured) await sendEmail({ to: STUDIO_EMAIL, ...studioPastePostEmail({ company: c.client.name, platform, title: post.title, access, portalUrl }) });
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
