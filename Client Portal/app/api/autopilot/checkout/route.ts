import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { getSession } from "@/lib/data/repo";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { createPlanCheckout, findOrCreateCustomer, squareConfigured } from "@/lib/billing/square";
import { planOffer } from "@/lib/autopilot/access";

/**
 * "Start SEO Autopilot": a Square-hosted checkout for the plan. The client pays
 * the first month on Square's page (card never touches the portal), Square
 * creates the subscription with the card on file, and sends them back to
 * /autopilot?checkout=return, where the subscription is confirmed.
 */
export async function POST(request: Request) {
  if (demoMode) return NextResponse.json({ ok: true, demo: true, url: null });
  const session = await getSession();
  if (!session.client || !session.email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!squareConfigured) return NextResponse.json({ error: "Payments aren't switched on yet (SQUARE_ACCESS_TOKEN)." }, { status: 503 });
  if (!adminConfigured) return NextResponse.json({ error: "Needs the service key (Setup & keys)." }, { status: 503 });
  const admin = createAdminClient();
  const offer = await planOffer(admin);
  try {
    let customerId = session.client.billingCustomerId;
    if (!customerId) {
      const c = await findOrCreateCustomer({ email: session.email.toLowerCase(), name: session.client.name, clientId: session.client.id });
      customerId = c.id;
      await admin.from("clients").update({ square_customer_id: customerId }).eq("id", session.client.id);
    }
    const origin = new URL(request.url).origin;
    const { url } = await createPlanCheckout({ customerId, email: session.email, planName: offer.name, amount: offer.amount, redirectUrl: `${origin}/autopilot?checkout=return` });
    await admin.from("activity").insert({ client_id: session.client.id, area: "account", title: `Started checkout for ${offer.name}` });
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Square error";
    console.error("[autopilot checkout]", message);
    return NextResponse.json({ error: `Square couldn't start the checkout: ${message}` }, { status: 502 });
  }
}
