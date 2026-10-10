/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { getSession } from "@/lib/data/repo";
import { createClient } from "@/lib/supabase/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { publishPost } from "@/lib/autopilot/run";

/**
 * The client approves or skips a post. Approving publishes straight away when
 * the service-role key is set (publishing needs the stored credentials, which
 * the client's own session can't read); otherwise the next daily run sends it.
 * Body: { id, action: "approve" | "skip" }
 */
export async function PATCH(request: Request) {
  const b = await request.json().catch(() => ({}));
  const id = String(b.id ?? "");
  const action = b.action === "approve" ? "approve" : b.action === "skip" ? "skip" : null;
  if (!id || !action) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  if (demoMode) return NextResponse.json({ ok: true, demo: true, status: action === "approve" ? "published" : "skipped" });

  const session = await getSession();
  if (!session.client) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const cid = session.client.id;
  const db = await createClient();
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
