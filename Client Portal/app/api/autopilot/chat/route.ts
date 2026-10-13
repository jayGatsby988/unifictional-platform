/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { getSession } from "@/lib/data/repo";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { accessFrom } from "@/lib/autopilot/access";
import { runStrategist, trimChat, type PlanState, type StrategistContext } from "@/lib/autopilot/strategist";
import type { StrategistMessage } from "@/lib/data/types";

export const maxDuration = 90;

/**
 * The SEO strategist conversation. POST { message } answers and may change
 * the plan (direction notes, priority searches, topics); the turn is saved on
 * seo_autopilot.chat so it carries on next visit.
 */
export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const message = String(b.message ?? "").trim().slice(0, 2000);
  if (!message) return NextResponse.json({ error: "Say something first." }, { status: 400 });
  const at = new Date().toISOString();
  if (demoMode) {
    return NextResponse.json({ ok: true, demo: true, reply: "Demo mode: here I'd read your plan, posts and Search Console numbers and change the plan as you ask. Connect Supabase and add the Anthropic key on Setup & keys to talk to the real strategist.", actions: [], at });
  }
  const session = await getSession();
  if (!session.client) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!adminConfigured) return NextResponse.json({ error: "Needs the service key (Setup & keys)." }, { status: 503 });
  const admin = createAdminClient();
  const cid = session.client.id;
  const [{ data: s }, { data: posts }, { data: kws }, { data: runs }] = await Promise.all([
    admin.from("seo_autopilot").select("*").eq("client_id", cid).maybeSingle(),
    admin.from("seo_posts").select("title, status, target_query, quality, published_at, slug").eq("client_id", cid).neq("status", "skipped").order("created_at", { ascending: false }).limit(15),
    admin.from("seo_keywords").select("keyword, position, clicks, impressions, url").eq("client_id", cid).order("impressions", { ascending: false }).limit(40),
    admin.from("seo_autopilot_runs").select("fixes").eq("client_id", cid).order("ran_at", { ascending: false }).limit(1),
  ]);
  if (!session.isAdmin && !accessFrom(s)) return NextResponse.json({ error: "Your SEO Autopilot plan isn't active." }, { status: 402 });

  const kwRows = (kws ?? []) as any[];
  const perfFor = (slug: string) => {
    const mine = kwRows.filter((k) => (k.url ?? "").replace(/\/+$/, "").endsWith(`/blog/${slug}`));
    if (!mine.length) return { clicks: null, impressions: null, position: null };
    const pos = mine.filter((k) => k.position != null);
    return { clicks: mine.reduce((a, k) => a + (k.clicks ?? 0), 0), impressions: mine.reduce((a, k) => a + (k.impressions ?? 0), 0), position: pos.length ? +(pos.reduce((a, k) => a + Number(k.position), 0) / pos.length).toFixed(1) : null };
  };
  const context: StrategistContext = {
    company: { name: session.client.name, industry: session.client.industry ?? "", city: session.client.city ?? "", websiteUrl: session.client.websiteUrl ?? "" },
    profile: (s as any)?.site_profile ?? null,
    settings: { notes: (s as any)?.notes ?? "", focusKeywords: Array.isArray((s as any)?.focus_keywords) ? (s as any).focus_keywords : [], cadence: (s as any)?.cadence ?? "weekly", mode: (s as any)?.mode ?? "auto", target: (s as any)?.target ?? "blog", nextRunAt: (s as any)?.next_run_at ?? null, plan: Array.isArray((s as any)?.plan) ? (s as any).plan : [] },
    posts: ((posts ?? []) as any[]).map((p) => ({ title: p.title, status: p.status, targetQuery: p.target_query ?? "", score: p.quality?.score ?? null, publishedAt: p.published_at ?? null, ...perfFor(p.slug) })),
    keywords: kwRows.map((k) => ({ keyword: k.keyword, position: k.position == null ? null : Number(k.position), clicks: k.clicks ?? 0, impressions: k.impressions ?? 0, url: k.url ?? "" })),
    fixes: (((runs ?? []) as any[])[0]?.fixes ?? []).map((f: any) => ({ title: f.title ?? "", done: Boolean(f.done) })),
  };
  const history: StrategistMessage[] = Array.isArray((s as any)?.chat) ? (s as any).chat : [];
  const state: PlanState = { notes: context.settings.notes, focusKeywords: context.settings.focusKeywords, plan: context.settings.plan };
  const save = async (st: PlanState) => {
    await admin.from("seo_autopilot").upsert({ client_id: cid, notes: st.notes || null, focus_keywords: st.focusKeywords, plan: st.plan, updated_at: new Date().toISOString() }, { onConflict: "client_id" });
  };
  try {
    const r = await runStrategist({ context, history, message, state, save });
    const chat = trimChat([...history, { role: "user", content: message, at }, { role: "assistant", content: r.reply, at: new Date().toISOString(), actions: r.actions }]);
    await admin.from("seo_autopilot").upsert({ client_id: cid, chat, updated_at: new Date().toISOString() }, { onConflict: "client_id" });
    if (r.actions.length) await admin.from("activity").insert({ client_id: cid, area: "seo", title: `SEO strategist: ${r.actions[0]}` });
    return NextResponse.json({ ok: true, reply: r.reply, actions: r.actions, at });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The strategist is unavailable.";
    console.error("[strategist]", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
