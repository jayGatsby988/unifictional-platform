import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { createClient } from "@/lib/supabase/server";

/** Studio: include SEO Autopilot in a company's plan (or stop). Body: { slug, comped } */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (session.isDemo) return NextResponse.json({ error: "Demo mode: connect Supabase to save changes (Setup & keys)." }, { status: 403 });
  if (!session.isAdmin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const client = session.clients.find((c) => c.slug === String(b.slug ?? ""));
  if (!client) return NextResponse.json({ error: "Unknown company." }, { status: 404 });
  const comped = Boolean(b.comped);
  const db = await createClient();
  const { error } = await db.from("seo_autopilot").upsert({ client_id: client.id, comped, updated_at: new Date().toISOString() }, { onConflict: "client_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, comped });
}
