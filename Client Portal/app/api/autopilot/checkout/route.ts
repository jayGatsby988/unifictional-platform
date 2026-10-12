import { NextResponse } from "next/server";
import { demoMode } from "@/lib/env";
import { getSession } from "@/lib/data/repo";
import { getPlans } from "@/lib/data/plans";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { createPlanCheckout, findOrCreateCustomer, squareConfigured } from "@/lib/billing/square";
import { money } from "@/lib/billing/types";
import { PLAN_NAME, catalogFrom, choose, isPostsChoice, normalizeAddons, type PostsChoice } from "@/lib/billing/packages";

/**
 * "Start for $X/month": a Square-hosted checkout for the package the client built
 * (posts a month + add-ons). The price is recomputed here from the studio's plan
 * rows, never trusted from the browser. The client pays the first month on
 * Square's page, Square creates the subscription with the card on file, and
 * sends them back to /autopilot?checkout=return, where it's confirmed.
 * Body: { posts: 1|2|4|8, addons: ("website"|"social"|"gbp")[] }
 */
export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  if (demoMode) return NextResponse.json({ ok: true, demo: true, url: null });
  const session = await getSession();
  if (!session.client || !session.email) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!squareConfigured) return NextResponse.json({ error: "Payments aren't switched on yet (SQUARE_ACCESS_TOKEN)." }, { status: 503 });
  if (!adminConfigured) return NextResponse.json({ error: "Needs the service key (Setup & keys)." }, { status: 503 });
  const catalog = catalogFrom(await getPlans());
  if (!catalog) return NextResponse.json({ error: "Plans aren't set up yet. Ask the studio." }, { status: 503 });
  const posts = isPostsChoice(Number(b.posts)) ? (Number(b.posts) as PostsChoice) : 4;
  const chosen = choose(catalog, posts, normalizeAddons(catalog, b.addons));

  const admin = createAdminClient();
  try {
    let customerId = session.client.billingCustomerId;
    if (!customerId) {
      const c = await findOrCreateCustomer({ email: session.email.toLowerCase(), name: session.client.name, clientId: session.client.id });
      customerId = c.id;
      await admin.from("clients").update({ square_customer_id: customerId }).eq("id", session.client.id);
    }
    const origin = new URL(request.url).origin;
    const { url } = await createPlanCheckout({ customerId, email: session.email, planName: PLAN_NAME, variationName: chosen.name, amount: chosen.amount, redirectUrl: `${origin}/autopilot?checkout=return` });
    const now = new Date().toISOString();
    await admin.from("seo_autopilot").upsert({ client_id: session.client.id, package: chosen, updated_at: now }, { onConflict: "client_id" });
    await admin.from("activity").insert({ client_id: session.client.id, area: "account", title: `Started checkout for ${chosen.name} (${money(chosen.amount)}/mo)` });
    return NextResponse.json({ ok: true, url, package: chosen });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Square error";
    console.error("[autopilot checkout]", message);
    return NextResponse.json({ error: `Square couldn't start the checkout: ${message}` }, { status: 502 });
  }
}
