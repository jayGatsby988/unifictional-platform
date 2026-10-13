/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientRecipients } from "@/lib/email/recipients";
import { emailConfigured, sendEmail, signOffFor, STUDIO_EMAIL } from "@/lib/email/send";
import { monthlyReportEmail, type MonthlyLine } from "@/lib/email/templates";
import { portalOrigin } from "@/lib/data/hosted-blog";

/**
 * The monthly "here's what happened" email. Many owners never sign in, so for them this
 * email IS the portal: a few numbers against last month, what we did, and anything waiting
 * on them. Only numbers we actually have are shown; a company with nothing to say is skipped.
 */
const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const sum = (rows: any[], k: string) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);

export async function buildMonthly(admin: SupabaseClient, client: { id: string; name: string }) {
  const cid = client.id;
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const [web, seo, gbp, posts, waiting, work] = await Promise.all([
    admin.from("website_daily").select("date, sessions, form_submissions, calls").eq("client_id", cid).gte("date", day(60)),
    admin.from("seo_daily").select("date, clicks").eq("client_id", cid).gte("date", day(60)),
    admin.from("gbp_snapshots").select("calls, directions, new_reviews").eq("client_id", cid).order("period_start", { ascending: false }).limit(2),
    admin.from("seo_posts").select("title, published_url").eq("client_id", cid).eq("status", "published").gte("published_at", since30),
    admin.from("seo_posts").select("id", { count: "exact", head: true }).eq("client_id", cid).eq("status", "awaiting_approval"),
    admin.from("work_log").select("title").eq("client_id", cid).gte("at", since30).order("at", { ascending: false }).limit(6),
  ]);
  const split = (rows: any[]) => { const cut = day(30); return [rows.filter((r) => r.date > cut), rows.filter((r) => r.date <= cut)] as const; };
  const lines: MonthlyLine[] = [];
  const w = web.data ?? [];
  if (w.length) {
    const [now, prev] = split(w);
    const callsTracked = sum(w, "calls") > 0;
    const leads = (rows: any[]) => sum(rows, "form_submissions") + (callsTracked ? sum(rows, "calls") : 0);
    lines.push({ label: "Leads from your website", now: leads(now), prev: leads(prev) });
    lines.push({ label: "Visits to your website", now: sum(now, "sessions"), prev: sum(prev, "sessions") });
  }
  const s = seo.data ?? [];
  if (s.length) { const [now, prev] = split(s); lines.push({ label: "Clicks from Google search", now: sum(now, "clicks"), prev: sum(prev, "clicks") }); }
  const [g, gp] = gbp.data ?? [];
  if (g && (g.calls || g.directions)) {
    lines.push({ label: "Calls from your Google listing", now: g.calls ?? 0, prev: gp?.calls ?? null });
    if (g.new_reviews) lines.push({ label: "New Google reviews", now: g.new_reviews, prev: null });
  }
  const published = (posts.data ?? []).map((p: any) => ({ title: p.title as string, url: (p.published_url as string) || null }));
  const did = (work.data ?? []).map((x: any) => x.title as string).filter((t) => !published.some((p) => t.includes(p.title)));
  return { lines, published, did, waiting: waiting.count ?? 0 };
}

export async function sendMonthlyReports(admin: SupabaseClient, opts: { clientSlug?: string; dryRun?: boolean; force?: boolean } = {}) {
  let q = admin.from("clients").select("id, name, slug");
  if (opts.clientSlug) q = q.eq("slug", opts.clientSlug);
  const { data: clients } = await q;
  const month = new Date().toLocaleDateString("en-US", { month: "long", timeZone: "America/Los_Angeles" });
  const results: Record<string, string> = {};
  for (const c of clients ?? []) {
    try {
      // Once a month: skip a company that already got one in the last 20 days (cron retries, manual runs).
      if (!opts.force && !opts.dryRun) {
        const { count } = await admin.from("activity").select("id", { count: "exact", head: true }).eq("client_id", c.id).eq("title", "Monthly report emailed").gte("at", new Date(Date.now() - 20 * 864e5).toISOString());
        if (count) { results[c.slug] = "already sent"; continue; }
      }
      const r = await buildMonthly(admin, c);
      if (!r.lines.length && !r.published.length && !r.did.length && !r.waiting) { results[c.slug] = "nothing to report"; continue; }
      const people = await clientRecipients(admin, c.id);
      if (!people.length) { results[c.slug] = "no logins"; continue; }
      if (opts.dryRun || !emailConfigured) { results[c.slug] = `would email ${people.length}: ${r.lines.length} numbers, ${r.published.length} posts, ${r.did.length} tasks`; continue; }
      for (const who of people) {
        const portalUrl = `${portalOrigin()}/login?email=${encodeURIComponent(who.email)}`;
        await sendEmail({ to: who.email, sender: "updates", replyTo: STUDIO_EMAIL, ...monthlyReportEmail({ name: who.name, company: c.name, month, ...r, portalUrl, signOff: signOffFor("updates") }) });
      }
      await admin.from("activity").insert({ client_id: c.id, area: "account", title: "Monthly report emailed" });
      results[c.slug] = `emailed ${people.length}`;
    } catch (e) {
      results[c.slug] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return results;
}
