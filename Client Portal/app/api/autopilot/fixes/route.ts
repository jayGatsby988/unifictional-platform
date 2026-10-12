/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { getSession } from "@/lib/data/repo";
import { createClient } from "@/lib/supabase/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";

/** Tick a suggested fix done (or undo it). Body: { runId, index, done }. Done fixes also land in the Search page's work log. */
export async function PATCH(request: Request) {
  const b = await request.json().catch(() => ({}));
  const runId = String(b.runId ?? "");
  const index = Number(b.index);
  const done = Boolean(b.done);
  if (!runId || !Number.isInteger(index) || index < 0) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (demoMode) return NextResponse.json({ ok: true, demo: true });
  const session = await getSession();
  if (!session.client) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const db = await createClient();
  const { data: run } = await db.from("seo_autopilot_runs").select("id, client_id, fixes").eq("id", runId).eq("client_id", session.client.id).maybeSingle();
  const fixes = (Array.isArray(run?.fixes) ? run.fixes : []) as any[];
  if (!run || !fixes[index]) return NextResponse.json({ error: "That fix isn't on your list." }, { status: 404 });
  fixes[index] = { ...fixes[index], done };
  const { error } = await db.from("seo_autopilot_runs").update({ fixes }).eq("id", runId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (done && adminConfigured) {
    await createAdminClient().from("work_log").insert({ client_id: session.client.id, area: "seo", title: `Fixed: ${fixes[index].title}`, detail: `${fixes[index].where} · ${fixes[index].how}`.slice(0, 500) });
  }
  return NextResponse.json({ ok: true, done });
}
