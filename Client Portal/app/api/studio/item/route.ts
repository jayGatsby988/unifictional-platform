import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { createClient } from "@/lib/supabase/server";

const TABLE = { inspection: "audit_reports", signup: "signup_requests", support: "requests" } as const;
const LEAD = new Set(["new", "contacted", "qualified", "won", "lost"]);
const SUPPORT = new Set(["open", "in_progress", "done"]);

/** Update status / notes / reply on any inbox item. Admins only (RLS enforces it too). */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session.isAdmin || session.isDemo) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const kind = body.kind as keyof typeof TABLE;
  if (!TABLE[kind] || typeof body.id !== "string") return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const patch: Record<string, string> = { updated_at: new Date().toISOString() };
  if (typeof body.status === "string") {
    if (!(kind === "support" ? SUPPORT : LEAD).has(body.status)) return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    patch.status = body.status;
  }
  if (typeof body.notes === "string" && kind !== "support") patch.notes = body.notes.slice(0, 5000);
  if (typeof body.reply === "string" && kind === "support") patch.reply = body.reply.slice(0, 5000);
  const db = await createClient();
  const { error } = await db.from(TABLE[kind]).update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
