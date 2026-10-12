import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/data/studio";
import { onboardBilling } from "@/lib/billing/onboard";
import { addInvite } from "@/lib/data/invites";
import { emailConfigured, sendEmail, signOffFor } from "@/lib/email/send";
import { dashboardReadyEmail } from "@/lib/email/templates";

/**
 * Create a company (optionally from a lead) and give a login access to it.
 * Body: { name, website?, industry?, city?, email?, from?: { kind: "signup"|"inspection", id },
 *         billing?: { start: boolean, build?: "2000", monthly?: "1500" } }
 * With Square connected, the company is linked to a Square customer automatically;
 * billing.start also emails the build invoice and starts the monthly plan.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (session.isDemo) return NextResponse.json({ error: "Demo mode: connect Supabase to save changes (Setup & keys)." }, { status: 403 });
  if (!session.isAdmin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const name = String(b.name ?? "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  const website = String(b.website ?? "").trim().slice(0, 200);
  const site = website && !/^https?:\/\//.test(website) ? `https://${website}` : website;
  const db = await createClient();

  let slug = slugify(name);
  const { data: taken } = await db.from("clients").select("slug").like("slug", `${slug}%`);
  if (taken?.some((t) => t.slug === slug)) slug = `${slug}-${(taken?.length ?? 1) + 1}`;

  const { data: client, error } = await db.from("clients").insert({
    slug, name, website_url: site || null, industry: String(b.industry ?? "").slice(0, 120) || null, city: String(b.city ?? "").slice(0, 120) || null, services: ["Website"],
  }).select("id, slug").single();
  if (error || !client) return NextResponse.json({ error: error?.message ?? "Could not create the company." }, { status: 500 });
  if (site) await db.from("client_integrations").upsert({ client_id: client.id, site_url: site }, { onConflict: "client_id" });

  let linked = false;
  const email = String(b.email ?? "").trim();
  if (email) {
    const { data } = await db.rpc("admin_link_member", { p_email: email, p_client: client.id, p_role: "owner" });
    linked = Boolean(data);
    if (!linked) await addInvite(db, client.id, email);
  }
  if (b.from?.kind === "signup" && typeof b.from.id === "string") {
    await db.from("signup_requests").update({ client_id: client.id, status: "won", updated_at: new Date().toISOString() }).eq("id", b.from.id);
  }
  if (b.from?.kind === "inspection" && typeof b.from.id === "string") {
    await db.from("audit_reports").update({ status: "won", updated_at: new Date().toISOString() }).eq("id", b.from.id);
  }
  await db.from("activity").insert({ client_id: client.id, area: "account", title: "Company added to the portal" });
  const billing = await onboardBilling(db, { client: { id: client.id, name }, email, start: b.billing?.start ? b.billing : null });
  // They already have a login (e.g. signed up themselves): tell them their dashboard is live.
  let notified = false;
  if (linked && emailConfigured) {
    let person = "";
    if (b.from?.kind === "signup" && typeof b.from.id === "string") {
      const { data: req } = await db.from("signup_requests").select("name").eq("id", b.from.id).maybeSingle();
      person = req?.name ?? "";
    }
    notified = (await sendEmail({ to: email, sender: "updates", ...dashboardReadyEmail({ name: person, company: name, loginUrl: `${new URL(request.url).origin}/login?email=${encodeURIComponent(email)}`, signOff: signOffFor("updates") }) })).sent;
  }
  return NextResponse.json({ ok: true, slug: client.slug, linked, billing, notified });
}
