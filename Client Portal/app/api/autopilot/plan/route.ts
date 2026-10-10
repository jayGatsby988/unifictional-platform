import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { getSession } from "@/lib/data/repo";
import { createClient } from "@/lib/supabase/server";
import { moveToFront, setStatus } from "@/lib/autopilot/plan";
import type { PlanItem } from "@/lib/data/types";

/** The client shapes the content plan: skip a planned topic, or pull one forward to be written next. Body: { id, action: "skip" | "next" } */
export async function PATCH(request: Request) {
  const b = await request.json().catch(() => ({}));
  const id = String(b.id ?? "");
  const action = b.action === "skip" ? "skip" : b.action === "next" ? "next" : null;
  if (!id || !action) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (demoMode) return NextResponse.json({ ok: true, demo: true });
  const session = await getSession();
  if (!session.client) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const db = await createClient();
  const { data } = await db.from("seo_autopilot").select("plan").eq("client_id", session.client.id).maybeSingle();
  const plan = (Array.isArray(data?.plan) ? data.plan : []) as PlanItem[];
  if (!plan.some((p) => p.id === id)) return NextResponse.json({ error: "That topic is no longer in the plan." }, { status: 404 });
  const next = action === "skip" ? setStatus(plan, id, "skipped") : moveToFront(plan, id);
  const { error } = await db.from("seo_autopilot").update({ plan: next, updated_at: new Date().toISOString() }).eq("client_id", session.client.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
