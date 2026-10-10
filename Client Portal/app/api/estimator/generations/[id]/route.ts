import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/data/repo";

const STATUSES = new Set(["new", "contacted", "quoted", "won", "lost"]);

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const patch: { status?: string; notes?: string } = {};
  if (STATUSES.has(body.status)) patch.status = body.status;
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 2000);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  if (demoMode) return NextResponse.json({ ok: true, demo: true });

  const session = await getSession();
  if (!session.client) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const supabase = await createClient();
  const { error } = await supabase.from("estimator_generations").update(patch).eq("id", id).eq("client_id", session.client.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
