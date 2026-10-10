import { NextResponse } from "next/server";
import { findOrCreateCustomer, sendInvoice, squareConfigured } from "@/lib/billing/square";
import { toCents } from "@/lib/billing/types";

/**
 * Ops-only: email a small test invoice through Square to prove billing end to end.
 * Auth: Bearer CRON_SECRET only (server-to-server). Touches Square, not the portal database.
 * Body: { email, amount? = "1" }
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!squareConfigured) return NextResponse.json({ error: "Square isn't configured." }, { status: 503 });
  const b = await request.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  const amount = toCents(String(b.amount ?? "1"));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !amount || amount > 500) return NextResponse.json({ error: "Give an email and an amount up to $5." }, { status: 400 });
  try {
    const customer = await findOrCreateCustomer({ email, name: String(b.name ?? "Unifictional"), clientId: "ops-test" });
    const inv = await sendInvoice({ customerId: customer.id, description: "Test invoice: client portal billing check", amount, daysUntilDue: 3, nowMs: Date.now() });
    return NextResponse.json({ ok: true, customerExisted: customer.existed, invoice: inv });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Square error" }, { status: 502 });
  }
}
