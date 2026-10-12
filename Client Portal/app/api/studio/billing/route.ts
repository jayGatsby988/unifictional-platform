import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { createClient } from "@/lib/supabase/server";
import { autopayForCustomer, findOrCreateCustomer, sendInvoice, squareConfigured, startMonthlyPlan } from "@/lib/billing/square";
import { toCents } from "@/lib/billing/types";

/**
 * Studio-only billing actions for one company (Square).
 *  { action: "link",    slug, email }                         link (or create) the Square customer
 *  { action: "unlink",  slug }                                forget the link (Square data untouched)
 *  { action: "invoice", slug, description, amount, days }     create, publish and email a one-off invoice
 *  { action: "plan",    slug, name, amount }                  start a monthly plan (Square emails each invoice)
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (session.isDemo) return NextResponse.json({ error: "Demo mode: connect Supabase to save changes (Setup & keys)." }, { status: 403 });
  if (!session.isAdmin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  if (!squareConfigured) return NextResponse.json({ error: "Add SQUARE_ACCESS_TOKEN in Vercel first." }, { status: 503 });

  const b = await request.json().catch(() => ({}));
  const db = await createClient();
  const { data: client } = await db.from("clients").select("id, slug, name, square_customer_id").eq("slug", String(b.slug ?? "")).maybeSingle();
  if (!client) return NextResponse.json({ error: "Company not found." }, { status: 404 });
  const days = Math.min(60, Math.max(1, Math.round(Number(b.days ?? 7)) || 7));
  const nowMs = Date.now();

  try {
    if (b.action === "link") {
      const email = String(b.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Enter the billing email." }, { status: 400 });
      const customer = await findOrCreateCustomer({ email, name: client.name, clientId: client.id });
      const { error } = await db.from("clients").update({ square_customer_id: customer.id }).eq("id", client.id);
      if (error) return NextResponse.json({ error: error.message.includes("duplicate") ? "That Square customer is already linked to another company." : error.message }, { status: 400 });
      return NextResponse.json({ ok: true, customerId: customer.id, existed: customer.existed });
    }

    if (b.action === "unlink") {
      await db.from("clients").update({ square_customer_id: null }).eq("id", client.id);
      return NextResponse.json({ ok: true });
    }

    if (!client.square_customer_id) return NextResponse.json({ error: "Link this company to Square first." }, { status: 400 });

    if (b.action === "invoice") {
      const amount = toCents(String(b.amount ?? ""));
      const description = String(b.description ?? "").trim().slice(0, 200);
      if (!amount || !description) return NextResponse.json({ error: "Add what it's for and an amount." }, { status: 400 });
      const inv = await sendInvoice({ customerId: client.square_customer_id, description, amount, daysUntilDue: days, nowMs });
      await db.from("activity").insert({ client_id: client.id, area: "account", title: `Invoice sent: ${description}` });
      return NextResponse.json({ ok: true, invoice: inv });
    }

    if (b.action === "autopay") {
      const r = await autopayForCustomer(client.square_customer_id);
      if (r.switched) await db.from("activity").insert({ client_id: client.id, area: "account", title: "Monthly plan switched to automatic payments" });
      return NextResponse.json({ ok: true, ...r, message: r.switched ? `Autopay is on: ${r.switched} plan${r.switched > 1 ? "s" : ""} will charge their saved card automatically.` : !r.hasCard ? "No card on file yet. When they pay an invoice and tick \"save my card\", this turns on automatically overnight." : "Autopay is already on." });
    }

    if (b.action === "plan") {
      const amount = toCents(String(b.amount ?? ""));
      const name = String(b.name ?? "").trim().slice(0, 120);
      if (!amount || !name) return NextResponse.json({ error: "Add a plan name and monthly amount." }, { status: 400 });
      const sub = await startMonthlyPlan({ customerId: client.square_customer_id, name, amount, nowMs });
      return NextResponse.json({ ok: true, subscription: sub });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    console.error("[studio billing]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Square error." }, { status: 502 });
  }
}
