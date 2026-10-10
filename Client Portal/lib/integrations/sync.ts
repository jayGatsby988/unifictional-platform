import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchGa4 } from "./ga4";
import { fetchSearchConsole } from "./search-console";
import { checkUptime, fetchPageSpeed } from "./pagespeed";
import { fetchGbp } from "./gbp";
import { fetchFacebookPage, fetchInstagram } from "./meta";
import { SOURCES, dateStr, type ClientIntegration, type Source, type SyncResult } from "./types";
import { googleToken, metaPageToken, metaUserToken } from "./studio";
import { runAudit } from "@/lib/audit";

type ClientRow = { id: string; name: string; slug: string; website_url: string | null };

/**
 * Pulls every configured source for one client and writes the tables the
 * portal reads. Each source is isolated: one failing API never blocks the rest,
 * and every run is recorded in sync_runs so the admin page can show it.
 */
export async function syncClient(db: SupabaseClient, client: ClientRow, cfg: ClientIntegration, only?: Source[]): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const want = (s: Source) => !only || only.includes(s);
  const siteUrl = cfg.site_url || client.website_url;

  const run = async (source: Source, enabled: boolean, fn: () => Promise<number>) => {
    if (!want(source)) return;
    if (!enabled) { results.push({ source, ok: true, message: "not configured", rows: 0 }); return; }
    try {
      const rows = await fn();
      results.push({ source, ok: true, message: "ok", rows });
    } catch (e) {
      results.push({ source, ok: false, message: e instanceof Error ? e.message.slice(0, 500) : String(e), rows: 0 });
    }
  };

  await run("ga4", Boolean(cfg.ga4_property_id), async () => {
    const g = await fetchGa4(cfg.ga4_property_id!, await googleToken(db, "analytics", client.id));
    if (g.daily.length) {
      const { error } = await db.from("website_daily").upsert(g.daily.map((d) => ({ client_id: client.id, ...d })), { onConflict: "client_id,date" });
      if (error) throw new Error(error.message);
    }
    const { data: latest } = await db.from("website_snapshots").select("id").eq("client_id", client.id).order("captured_at", { ascending: false }).limit(1).maybeSingle();
    if (latest) await db.from("website_snapshots").update({ sources: g.sources, top_pages: g.topPages }).eq("id", latest.id);
    else await db.from("website_snapshots").insert({ client_id: client.id, sources: g.sources, top_pages: g.topPages });
    return g.daily.length;
  });

  await run("search_console", Boolean(cfg.gsc_site_url), async () => {
    const s = await fetchSearchConsole(cfg.gsc_site_url!, await googleToken(db, "searchConsole", client.id));
    if (s.daily.length) {
      const { error } = await db.from("seo_daily").upsert(s.daily.map((d) => ({ client_id: client.id, ...d })), { onConflict: "client_id,date" });
      if (error) throw new Error(error.message);
    }
    const { data: existing } = await db.from("seo_keywords").select("keyword, position").eq("client_id", client.id);
    const prev = new Map((existing ?? []).map((k: { keyword: string; position: number }) => [k.keyword, k.position]));
    if (s.keywords.length) {
      const rows = s.keywords.map((k) => ({ client_id: client.id, ...k, prev_position: prev.get(k.keyword) ?? null, checked_at: new Date().toISOString() }));
      const { error } = await db.from("seo_keywords").upsert(rows, { onConflict: "client_id,keyword" });
      if (error) throw new Error(error.message);
      for (const k of s.keywords.filter((k) => k.position <= 10 && (prev.get(k.keyword) ?? 99) > 10)) {
        await db.from("activity").insert({ client_id: client.id, area: "seo", title: `'${k.keyword}' entered the top 10` });
      }
    }
    return s.daily.length + s.keywords.length;
  });

  await run("uptime", Boolean(siteUrl), async () => {
    const u = await checkUptime(siteUrl!);
    await db.from("uptime_checks").insert({ client_id: client.id, ok: u.ok, status: u.status, ms: u.ms });
    const { data: checks } = await db.from("uptime_checks").select("ok").eq("client_id", client.id).gte("at", new Date(Date.now() - 30 * 864e5).toISOString());
    const okPct = checks?.length ? +((checks.filter((c: { ok: boolean }) => c.ok).length / checks.length) * 100).toFixed(2) : 100;
    const { data: latest } = await db.from("website_snapshots").select("id").eq("client_id", client.id).order("captured_at", { ascending: false }).limit(1).maybeSingle();
    const patch = { uptime_pct: okPct, status: u.ok ? "live" : "maintenance", captured_at: new Date().toISOString() };
    if (latest) await db.from("website_snapshots").update(patch).eq("id", latest.id);
    else await db.from("website_snapshots").insert({ client_id: client.id, ...patch });
    return 1;
  });

  await run("health", Boolean(siteUrl), async () => {
    const report = await runAudit(siteUrl!);
    const patch: Record<string, unknown> = { health: report, health_at: new Date().toISOString() };
    if (report.scores) Object.assign(patch, {
      perf_score: report.scores.performance, seo_score: report.scores.seo, a11y_score: report.scores.accessibility, bp_score: report.scores.bestPractices,
      lcp_ms: report.vitals?.lcpMs ?? null, cls: report.vitals?.cls ?? null, inp_ms: report.vitals?.inpMs ?? null,
    });
    const { data: latest } = await db.from("website_snapshots").select("id, health").eq("client_id", client.id).order("captured_at", { ascending: false }).limit(1).maybeSingle();
    const prevGrade = (latest?.health as { summary?: { grade?: string } } | null)?.summary?.grade;
    if (latest) await db.from("website_snapshots").update(patch).eq("id", latest.id);
    else await db.from("website_snapshots").insert({ client_id: client.id, ...patch });
    if (prevGrade && prevGrade !== report.summary.grade) {
      await db.from("activity").insert({ client_id: client.id, area: "website", title: `Website health grade changed from ${prevGrade} to ${report.summary.grade}` });
    }
    return report.checks.length;
  });

  await run("pagespeed", Boolean(siteUrl && process.env.PSI_API_KEY), async () => {
    const p = await fetchPageSpeed(siteUrl!);
    const { data: latest } = await db.from("website_snapshots").select("id").eq("client_id", client.id).order("captured_at", { ascending: false }).limit(1).maybeSingle();
    if (latest) await db.from("website_snapshots").update(p).eq("id", latest.id);
    else await db.from("website_snapshots").insert({ client_id: client.id, ...p });
    return 1;
  });

  await run("gbp", Boolean(cfg.gbp_location_id), async () => {
    const token = await googleToken(db, "business", client.id);
    const cur = await fetchGbp(cfg.gbp_location_id!, cfg.gbp_account_id, token, 0);
    const prev30 = await fetchGbp(cfg.gbp_location_id!, cfg.gbp_account_id, token, 30);
    const { error } = await db.from("gbp_snapshots").upsert([{ client_id: client.id, ...cur }, { client_id: client.id, ...prev30 }], { onConflict: "client_id,period_start" });
    if (error) throw new Error(error.message);
    return 2;
  });

  await run("meta", Boolean(cfg.ig_user_id || cfg.fb_page_id), async () => {
    let rows = 0;
    const synced_at = new Date().toISOString();
    // Page token stored at assignment time; otherwise derive it from the studio's user token.
    let pageToken = cfg.meta_page_token;
    if (!pageToken) {
      const user = await metaUserToken(db, client.id);
      if (!user || !cfg.fb_page_id) throw new Error("Connect a Meta account on /admin (studio or this company) and pick a Page");
      pageToken = await metaPageToken(user, cfg.fb_page_id);
      await db.from("client_integrations").update({ meta_page_token: pageToken }).eq("client_id", client.id);
    }
    if (cfg.ig_user_id) {
      const ig = await fetchInstagram(cfg.ig_user_id, pageToken);
      const { data: prevAcc } = await db.from("social_accounts").select("followers, synced_at").eq("client_id", client.id).eq("platform", "instagram").maybeSingle();
      const { data: old } = await db.from("social_daily").select("followers").eq("client_id", client.id).eq("platform", "instagram").eq("date", dateStr(30)).maybeSingle();
      const delta = old?.followers ? ig.account.followers - old.followers : prevAcc?.followers ? ig.account.followers - prevAcc.followers : 0;
      await db.from("social_accounts").upsert({ client_id: client.id, ...ig.account, followers_delta_30: delta, synced_at }, { onConflict: "client_id,platform" });
      if (ig.reachDaily.length) {
        await db.from("social_daily").upsert(ig.reachDaily.map((r) => ({ client_id: client.id, platform: "instagram", date: r.date, reach: r.reach })), { onConflict: "client_id,platform,date" });
      }
      await db.from("social_daily").upsert({ client_id: client.id, platform: "instagram", date: dateStr(0), followers: ig.account.followers }, { onConflict: "client_id,platform,date" });
      if (ig.posts.length) {
        const { error } = await db.from("social_posts").upsert(ig.posts.map((p) => ({ client_id: client.id, ...p })), { onConflict: "client_id,external_id" });
        if (error) throw new Error(error.message);
      }
      rows += 1 + ig.reachDaily.length + ig.posts.length;
    }
    if (cfg.fb_page_id) {
      const fb = await fetchFacebookPage(cfg.fb_page_id, pageToken);
      const { data: prevAcc } = await db.from("social_accounts").select("followers").eq("client_id", client.id).eq("platform", "facebook").maybeSingle();
      await db.from("social_accounts").upsert({ client_id: client.id, ...fb, followers_delta_30: prevAcc?.followers ? fb.followers - prevAcc.followers : 0, synced_at }, { onConflict: "client_id,platform" });
      rows += 1;
    }
    return rows;
  });

  if (results.length) {
    await db.from("sync_runs").insert(results.map((r) => ({ client_id: client.id, source: r.source, ok: r.ok, message: r.message, rows: r.rows })));
  }
  return results;
}

export async function syncAll(db: SupabaseClient, opts: { clientSlug?: string; sources?: Source[] } = {}) {
  let q = db.from("clients").select("id, name, slug, website_url");
  if (opts.clientSlug) q = q.eq("slug", opts.clientSlug);
  const { data: clients, error } = await q;
  if (error) throw new Error(error.message);
  const { data: cfgs } = await db.from("client_integrations").select("*");
  const byClient = new Map((cfgs ?? []).map((c: ClientIntegration) => [c.client_id, c]));
  const out: Record<string, SyncResult[]> = {};
  for (const c of clients ?? []) {
    const cfg = byClient.get(c.id) ?? { client_id: c.id, site_url: null, ga4_property_id: null, gsc_site_url: null, gbp_location_id: null, gbp_account_id: null, google_refresh_token: null, google_account_label: null, meta_user_token: null, meta_account_label: null, meta_expires_at: null, ig_user_id: null, fb_page_id: null, meta_page_token: null, ghl_contact_id: null };
    out[c.slug] = await syncClient(db, c, cfg, opts.sources?.length ? opts.sources : undefined);
  }
  return out;
}

export function parseSources(v: string | null): Source[] | undefined {
  if (!v) return undefined;
  const list = v.split(",").map((s) => s.trim()).filter((s): s is Source => (SOURCES as string[]).includes(s));
  return list.length ? list : undefined;
}
