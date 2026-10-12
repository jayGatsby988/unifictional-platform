import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { createClient } from "@/lib/supabase/server";
import { addInvite } from "@/lib/data/invites";
import { emailConfigured, sendEmail, signOffFor } from "@/lib/email/send";
import { dashboardReadyEmail } from "@/lib/email/templates";

/** Give an existing login access to a company. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session.isAdmin || session.isDemo) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const b = await request.json().catch(() => ({}));
  const client = session.clients.find((c) => c.slug === b.slug);
  const email = String(b.email ?? "").trim();
  if (!client || !email) return NextResponse.json({ error: "Pick a company and enter an email." }, { status: 400 });
  const db = await createClient();
  const { data: before } = await db.rpc("admin_client_logins");
  const already = ((before ?? []) as { client_id: string; email: string }[]).some((l) => l.client_id === client.id && l.email.toLowerCase() === email.toLowerCase());
  const { data, error } = await db.rpc("admin_link_member", { p_email: email, p_client: client.id, p_role: "owner" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    // No login yet: remember it; they're connected automatically the first time they sign in.
    if (!(await addInvite(db, client.id, email))) return NextResponse.json({ error: "Couldn't save the access." }, { status: 500 });
    return NextResponse.json({ ok: true, pending: true, message: `Saved. ${email} is connected automatically the first time they sign in.` });
  }
  if (!already && emailConfigured) {
    await sendEmail({ to: email, sender: "updates", ...dashboardReadyEmail({ name: "", company: client.name, loginUrl: `${new URL(request.url).origin}/login?email=${encodeURIComponent(email)}`, signOff: signOffFor("updates") }) });
    return NextResponse.json({ ok: true, message: `Access granted. We emailed ${email} that their dashboard is ready.` });
  }
  return NextResponse.json({ ok: true, message: "Access granted." });
}
