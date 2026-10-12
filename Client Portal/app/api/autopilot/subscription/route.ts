/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { getSession } from "@/lib/data/repo";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { refreshSubscription } from "@/lib/autopilot/access";
import { cancelSubscription, squareConfigured } from "@/lib/billing/square";

/** Back from Square's checkout: ask Square whether the subscription is live and unlock the feature. */
export async function POST() {
  if (demoMode) return NextResponse.json({ ok: true, demo: true, access: true, status: "ACTIVE" });
  const session = await getSession();
  if (!session.client) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!adminConfigured) return NextResponse.json({ error: "Needs the service key (Setup & keys)." }, { status: 503 });
  const r = await refreshSubscription(createAdminClient(), { id: session.client.id, square_customer_id: session.client.billingCustomerId }, session.email);
  if (r.access) await createAdminClient().from("activity").insert({ client_id: session.client.id, area: "account", title: `Subscribed to ${r.plan ?? "SEO Autopilot"}` }).then(() => null, () => null);
  return NextResponse.json({ ok: true, ...r });
}

/**
 * "Cancel my plan": ends the Square subscription at the end of the paid period.
 * Access (and posts) continue until then, then stop on their own.
 */
export async function DELETE() {
  if (demoMode) return NextResponse.json({ ok: true, demo: true, status: "CANCELED", endsOn: null });
  const session = await getSession();
  if (!session.client) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!adminConfigured) return NextResponse.json({ error: "Needs the service key (Setup & keys)." }, { status: 503 });
  if (!squareConfigured) return NextResponse.json({ error: "Payments aren't switched on (SQUARE_ACCESS_TOKEN)." }, { status: 503 });
  const admin = createAdminClient();
  const { data: row } = await admin.from("seo_autopilot").select("square_subscription_id, comped").eq("client_id", session.client.id).maybeSingle();
  if ((row as any)?.comped) return NextResponse.json({ error: "Your plan is included by Unifictional; there's nothing to cancel. Ask us if you'd like it switched off." }, { status: 400 });
  const id = (row as any)?.square_subscription_id as string | null | undefined;
  if (!id) return NextResponse.json({ error: "No active subscription found." }, { status: 404 });
  try {
    const r = await cancelSubscription(id);
    await refreshSubscription(admin, { id: session.client.id, square_customer_id: session.client.billingCustomerId }, session.email);
    await admin.from("activity").insert({ client_id: session.client.id, area: "account", title: `Cancelled SEO Autopilot${r.canceledDate ? ` (ends ${r.canceledDate})` : ""}` });
    return NextResponse.json({ ok: true, status: r.status, endsOn: r.canceledDate });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Square error";
    return NextResponse.json({ error: `Square couldn't cancel it: ${message}` }, { status: 502 });
  }
}
