import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { adminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ensureLogin } from "@/lib/accounts/create";
import { onboardBilling } from "@/lib/billing/onboard";
import { emailConfigured, sendEmail, signOffFor } from "@/lib/email/send";
import { welcomeEmail } from "@/lib/email/templates";

/**
 * Studio-only: create (or reset) a client's login with a temporary password, give it access
 * to a company, link Square, and (by default) email them the login. The password is also
 * returned once so the studio can text it. Body: { slug, email, name?, emailThem? = true }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session.isAdmin || session.isDemo) return NextResponse.json({ error: "Admins only." }, { status: 403 });
  if (!adminConfigured) return NextResponse.json({ needsKey: true, error: "Add SUPABASE_SERVICE_ROLE_KEY in Vercel to turn this on." }, { status: 503 });

  const b = await request.json().catch(() => ({}));
  const client = session.clients.find((c) => c.slug === b.slug);
  const email = String(b.email ?? "").trim().toLowerCase();
  const name = String(b.name ?? "").trim().slice(0, 120);
  if (!client) return NextResponse.json({ error: "Pick a company first." }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });

  const login = await ensureLogin({ email, name, resetIfExists: true });
  if (login.kind !== "created") return NextResponse.json({ error: login.kind === "error" ? login.error : "Couldn't create the login." }, { status: 500 });

  const db = await createClient();
  const { data: linked, error: linkErr } = await db.rpc("admin_link_member", { p_email: email, p_client: client.id, p_role: "owner" });
  if (linkErr || !linked) return NextResponse.json({ error: linkErr?.message ?? "Login created but linking failed. Try “Give access”." }, { status: 500 });

  const { data: row } = await db.from("clients").select("id, name, square_customer_id").eq("id", client.id).maybeSingle();
  if (row) await onboardBilling(db, { client: row, email });

  const loginUrl = `${new URL(request.url).origin}/login`;
  let emailed = false;
  if (b.emailThem !== false && emailConfigured) {
    emailed = (await sendEmail({ to: email, sender: "onboarding", ...welcomeEmail({ name, email, tempPassword: login.password, loginUrl: `${loginUrl}?email=${encodeURIComponent(email)}`, company: client.name, signOff: signOffFor("onboarding") }) })).sent;
  }
  return NextResponse.json({ ok: true, email, password: login.password, reset: false, loginUrl, company: client.name, emailed });
}
