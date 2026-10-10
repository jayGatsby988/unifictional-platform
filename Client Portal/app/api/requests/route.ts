import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/data/repo";

const TYPES = new Set(["website", "seo", "social", "estimator", "billing", "other"]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const type = TYPES.has(body.type) ? body.type : "other";
  const title = String(body.title ?? "").trim().slice(0, 160);
  const detail = String(body.body ?? "").trim().slice(0, 4000);
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  if (demoMode) return NextResponse.json({ ok: true, demo: true });

  const session = await getSession();
  if (!session.client) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const supabase = await createClient();
  const { error } = await supabase.from("requests").insert({ client_id: session.client.id, type, title, body: detail, status: "open", requester_email: session.email || null });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
