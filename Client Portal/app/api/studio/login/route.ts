import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { tempPassword } from "@/lib/temp-password";
import { onboardBilling } from "@/lib/billing/onboard";

/**
 * Studio-only: create (or reset) a client's login with a temporary password and
 * give it access to a company. No email is sent, so this works without SMTP.
 * The password is returned once for the studio to text to the client; it is
 * never stored by the portal. Body: { slug, email, name? }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session.isAdmin || session.isDemo) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  if (!adminConfigured) {
    return NextResponse.json({ needsKey: true, error: "Add SUPABASE_SERVICE_ROLE_KEY in Vercel to turn this on." }, { status: 503 });
  }

  const b = await request.json().catch(() => ({}));
  const client = session.clients.find((c) => c.slug === b.slug);
  const email = String(b.email ?? "").trim().toLowerCase();
  const name = String(b.name ?? "").trim().slice(0, 120);
  if (!client) return NextResponse.json({ error: "Pick a company first." }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });

  const admin = createAdminClient();
  const password = tempPassword();
  const meta = { must_change_password: true, ...(name ? { full_name: name } : {}) };

  let userId: string | null = null;
  let reset = false;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
  if (created.data.user) {
    userId = created.data.user.id;
  } else {
    // Already has an account: find it and issue a fresh temporary password.
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
      if (data.users.length < 200) break;
    }
    if (!userId) return NextResponse.json({ error: created.error?.message ?? "Could not create the login." }, { status: 500 });
    const { data: isStudio } = await admin.from("portal_admins").select("user_id").eq("user_id", userId).maybeSingle();
    if (isStudio) return NextResponse.json({ error: "That email is a studio admin. Its password can't be reset from here." }, { status: 400 });
    const upd = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true, user_metadata: meta });
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
    reset = true;
  }

  // Link through the admin's own session, same as "Give access".
  const db = await createClient();
  const { data: linked, error: linkErr } = await db.rpc("admin_link_member", { p_email: email, p_client: client.id, p_role: "owner" });
  if (linkErr || !linked) return NextResponse.json({ error: linkErr?.message ?? "Login created but linking failed. Try “Give access”." }, { status: 500 });

  // Automation: make sure the company is linked to Square (no invoices sent here).
  const { data: row } = await db.from("clients").select("id, name, square_customer_id").eq("id", client.id).maybeSingle();
  if (row) await onboardBilling(db, { client: row, email });

  const loginUrl = `${new URL(request.url).origin}/login`;
  return NextResponse.json({ ok: true, email, password, reset, loginUrl, company: client.name });
}
