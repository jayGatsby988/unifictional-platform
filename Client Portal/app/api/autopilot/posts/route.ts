/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { getSession } from "@/lib/data/repo";
import { createClient } from "@/lib/supabase/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { publishPost } from "@/lib/autopilot/run";
import { splitFaq, wordCount } from "@/lib/autopilot/markdown";
import { scorePost } from "@/lib/autopilot/quality";

/**
 * The client approves, skips, edits a post, or marks a pasted one live.
 * Body: { id, action: "approve" | "skip" }, { id, action: "edit", title, metaDescription, bodyMd }
 * or { id, action: "live", url }.
 * Approving publishes straight away when the service-role key is set (publishing
 * needs the stored credentials, which the client's own session can't read);
 * otherwise the next daily run sends it. Edits are re-scored against the SEO checklist.
 */
export async function PATCH(request: Request) {
  const b = await request.json().catch(() => ({}));
  const id = String(b.id ?? "");
  const action = ["approve", "skip", "edit", "live"].includes(b.action) ? (b.action as "approve" | "skip" | "edit" | "live") : null;
  if (!id || !action) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  if (demoMode) return NextResponse.json({ ok: true, demo: true, status: action === "approve" || action === "live" ? "published" : action === "skip" ? "skipped" : "awaiting_approval" });

  const session = await getSession();
  if (!session.client) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const cid = session.client.id;
  const db = await createClient();

  // "It's live": someone (the client, or the studio on their page) pasted a ready post onto the site.
  if (action === "live") {
    const url = String(b.url ?? "").trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return NextResponse.json({ error: "Paste the post's address on your site, starting with https://." }, { status: 400 });
    const now = new Date().toISOString();
    const { data: post, error } = await db.from("seo_posts").update({ status: "published", published_url: url, published_at: now, error: null, updated_at: now }).eq("id", id).eq("client_id", cid).in("status", ["ready", "failed", "approved"]).select("title").maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!post) return NextResponse.json({ error: "That post isn't yours, or it's already live." }, { status: 404 });
    if (adminConfigured) {
      const admin = createAdminClient();
      await admin.from("activity").insert({ client_id: cid, area: "seo", title: `Live on your site: ${post.title}` });
      await admin.from("requests").update({ status: "done" }).eq("client_id", cid).eq("status", "open").ilike("title", `Paste on %: ${post.title}`);
    }
    return NextResponse.json({ ok: true, status: "published", url });
  }

  if (action === "edit") {
    const title = String(b.title ?? "").trim().slice(0, 200);
    const metaDescription = String(b.metaDescription ?? "").trim().slice(0, 400);
    const bodyMd = String(b.bodyMd ?? "").trim().slice(0, 60_000);
    if (!title || !bodyMd) return NextResponse.json({ error: "A title and the post text are required." }, { status: 400 });
    const { data: current } = await db.from("seo_posts").select("status, target_query").eq("id", id).eq("client_id", cid).maybeSingle();
    if (!current) return NextResponse.json({ error: "That post isn't yours or no longer exists." }, { status: 404 });
    if (current.status === "published") return NextResponse.json({ error: "This post is already live. Skip it and write a new one, or ask the studio to change it." }, { status: 400 });
    const quality = scorePost({ title, metaDescription, bodyMd, targetQuery: current.target_query ?? "", area: session.client.city ?? "", faqCount: splitFaq(bodyMd).faq.length });
    const { error } = await db.from("seo_posts").update({ title, meta_description: metaDescription, body_md: bodyMd, word_count: wordCount(bodyMd), quality, updated_at: new Date().toISOString() }).eq("id", id).eq("client_id", cid);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, quality });
  }

  const status = action === "approve" ? "approved" : "skipped";
  const { data: post, error } = await db.from("seo_posts").update({ status, error: null, updated_at: new Date().toISOString() }).eq("id", id).eq("client_id", cid).select("*").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!post) return NextResponse.json({ error: "That post isn't yours or no longer exists." }, { status: 404 });
  if (action === "skip") return NextResponse.json({ ok: true, status: "skipped" });

  if (!adminConfigured) return NextResponse.json({ ok: true, status: "approved", queued: true });
  const admin = createAdminClient();
  const [{ data: client }, { data: settings }, { data: cfg }] = await Promise.all([
    admin.from("clients").select("id, slug, name, website_url").eq("id", cid).single(),
    admin.from("seo_autopilot").select("*").eq("client_id", cid).maybeSingle(),
    admin.from("client_integrations").select("*").eq("client_id", cid).maybeSingle(),
  ]);
  if (!client || !settings) return NextResponse.json({ ok: true, status: "approved", queued: true });
  const r = await publishPost(admin, { client, settings, cfg }, post as any);
  const { data: after } = await admin.from("seo_posts").select("status, published_url, error").eq("id", id).maybeSingle();
  return NextResponse.json({ ok: r.ok, status: after?.status ?? "approved", url: after?.published_url ?? null, error: r.ok ? null : r.message });
}
