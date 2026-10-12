import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { getSession } from "@/lib/data/repo";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { refreshSubscription } from "@/lib/autopilot/access";

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
