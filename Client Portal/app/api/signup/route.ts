import { NextResponse } from "next/server";
import { pushLeadToGhl } from "@/lib/ghl";
import { supabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** Public: "Create account" request. Hands the lead to the CRM; the studio links the company afterwards. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().slice(0, 200);
  const name = String(body.name ?? "").trim().slice(0, 120);
  const company = String(body.company ?? "").trim().slice(0, 160);
  const phone = String(body.phone ?? "").trim().slice(0, 40);
  const website = String(body.website ?? "").trim().slice(0, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  if (!name || !company) return NextResponse.json({ error: "Name and company are required." }, { status: 400 });
  if (supabaseConfigured) {
    const db = await createClient();
    await db.from("signup_requests").insert({ name, email, phone: phone || null, company, website: website || null });
  }
  const id = await pushLeadToGhl({ name, email, phone, company, website, source: "Portal account request", note: `Asked for a client portal account for ${company}${website ? ` (${website})` : ""}.` });
  return NextResponse.json({ ok: true, crm: Boolean(id) });
}
