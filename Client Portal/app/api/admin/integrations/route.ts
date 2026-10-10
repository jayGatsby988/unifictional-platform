import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { createWriterClient } from "@/lib/supabase/admin";
import { demoMode } from "@/lib/env";
import { metaPageToken, metaUserToken } from "@/lib/integrations/studio";

const FIELDS = ["site_url", "ga4_property_id", "gsc_site_url", "gbp_location_id", "gbp_account_id", "ig_user_id", "fb_page_id", "ghl_contact_id"] as const;

/** Admin saves the ids that tell the sync where each client's data lives. */
export async function PUT(request: Request) {
  const session = await getSession();
  if (!session.isAdmin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const patch: Record<string, string | null> = {};
  for (const f of FIELDS) if (f in body) patch[f] = body[f] ? String(body[f]).trim().slice(0, 300) : null;
  if (demoMode) return NextResponse.json({ ok: true, demo: true });
  const db = await createWriterClient();
  const { data: client } = await db.from("clients").select("id").eq("slug", String(body.slug ?? "")).maybeSingle();
  if (!client) return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  // Assigning a Page: store its long-lived Page token now so the sync never needs the user token.
  if ("fb_page_id" in patch) {
    patch.meta_page_token = null;
    if (patch.fb_page_id) {
      const user = await metaUserToken(db, client.id);
      if (user) {
        try { patch.meta_page_token = await metaPageToken(user, patch.fb_page_id); }
        catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
      }
    }
  }
  const { error } = await db.from("client_integrations").upsert({ client_id: client.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: "client_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
