import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { getSession } from "@/lib/data/repo";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { writeNow } from "@/lib/autopilot/run";

export const maxDuration = 300;

/**
 * "Write a post now." Runs the full pipeline for the signed-in client straight
 * away instead of waiting for the daily run. Clients get one extra post a day;
 * the studio can run it as often as it likes.
 */
export async function POST() {
  if (demoMode) return NextResponse.json({ ok: true, demo: true, message: "Demo mode: this is where a real post would be written (about a minute)." });
  const session = await getSession();
  if (!session.client) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!adminConfigured) return NextResponse.json({ error: "Writing on demand needs the service key (Setup & keys)." }, { status: 503 });
  const admin = createAdminClient();
  const { data: s } = await admin.from("seo_autopilot").select("enabled, last_run_at").eq("client_id", session.client.id).maybeSingle();
  if (!s?.enabled) return NextResponse.json({ error: "Turn on SEO Autopilot first." }, { status: 400 });
  if (!session.isAdmin && s.last_run_at && Date.now() - new Date(s.last_run_at).getTime() < 20 * 3600e3) {
    return NextResponse.json({ error: "One extra post a day. The next scheduled one is already on its way." }, { status: 429 });
  }
  const r = await writeNow(admin, session.client.slug);
  return NextResponse.json({ ok: r.ok, message: r.message, postId: r.postId ?? null }, { status: r.ok ? 200 : 500 });
}
