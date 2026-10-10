import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { createClient } from "@/lib/supabase/server";
import { toCents } from "@/lib/billing/types";

/** Studio-only: { action: "save", plan } upserts a plan; { action: "delete", id } removes one. */
export async function POST(request: Request) {
  const session = await getSession();
  if (session.isDemo) return NextResponse.json({ error: "Demo mode: connect Supabase to save changes (Setup & keys)." }, { status: 403 });
  if (!session.isAdmin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const db = await createClient();

  if (b.action === "delete") {
    const { error } = await db.from("plans").delete().eq("id", String(b.id ?? ""));
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }

  const p = b.plan ?? {};
  const name = String(p.name ?? "").trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: "Give the plan a name." }, { status: 400 });
  const priceText = String(p.price ?? "").trim();
  const price = priceText ? toCents(priceText) : null;
  if (priceText && price === null) return NextResponse.json({ error: "Price should be a dollar amount, or leave it blank for Custom." }, { status: 400 });
  const row = {
    name,
    tagline: String(p.tagline ?? "").trim().slice(0, 200) || null,
    price_cents: price,
    features: String(p.features ?? "").split("\n").map((f: string) => f.trim()).filter(Boolean).slice(0, 20),
    highlight: Boolean(p.highlight),
    published: Boolean(p.published),
    sort: Number.isFinite(Number(p.sort)) ? Math.round(Number(p.sort)) : 0,
    updated_at: new Date().toISOString(),
  };
  const q = p.id ? db.from("plans").update(row).eq("id", String(p.id)).select("id").single() : db.from("plans").insert(row).select("id").single();
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (row.highlight) await db.from("plans").update({ highlight: false }).neq("id", data.id);
  return NextResponse.json({ ok: true, id: data.id });
}
