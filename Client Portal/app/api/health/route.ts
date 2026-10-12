import { NextResponse } from "next/server";
import { getSession } from "@/lib/data/repo";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { locationId, squareConfigured, squareSandbox } from "@/lib/billing/square";
import { emailConfigured } from "@/lib/email/send";

export const dynamic = "force-dynamic";

/**
 * Ops check: are the server keys present and accepted? Never returns key values.
 * Auth: Bearer CRON_SECRET (for scripts) or a signed-in studio admin.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const viaSecret = Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
  if (!viaSecret) {
    const session = await getSession().catch(() => null);
    if (!session?.isAdmin || session.isDemo) return NextResponse.json({ error: "Unauthorized", secretConfigured: Boolean(secret) }, { status: 401 });
  }

  const out: Record<string, string> = {};

  if (!adminConfigured) out.supabaseServiceKey = "missing";
  else {
    const { error } = await createAdminClient().from("clients").select("id", { head: true, count: "exact" });
    out.supabaseServiceKey = error ? `rejected: ${error.message}` : "ok";
  }

  if (!squareConfigured) out.square = "missing";
  else {
    try {
      await locationId();
      out.square = squareSandbox ? "ok (sandbox)" : "ok";
    } catch (e) {
      out.square = `rejected: ${e instanceof Error ? e.message : "error"}`;
    }
  }

  out.email = emailConfigured ? "configured" : "missing";
  // ?detail=logins (secret only): which login is linked to which company. Emails only, no secrets.
  if (viaSecret && new URL(request.url).searchParams.get("detail") === "logins" && adminConfigured) {
    const admin = createAdminClient();
    const [{ data: users }, { data: members }, { data: admins }, { data: clients }] = await Promise.all([
      admin.auth.admin.listUsers({ perPage: 200 }),
      admin.from("client_members").select("user_id, client_id"),
      admin.from("portal_admins").select("user_id"),
      admin.from("clients").select("id, slug"),
    ]);
    const slug = new Map((clients ?? []).map((c) => [c.id, c.slug]));
    return NextResponse.json({
      ...out,
      logins: (users?.users ?? []).map((u) => ({
        email: u.email, lastSignIn: u.last_sign_in_at ?? null,
        admin: (admins ?? []).some((a) => a.user_id === u.id),
        companies: (members ?? []).filter((m) => m.user_id === u.id).map((m) => slug.get(m.client_id)),
      })),
    });
  }
  out.email = emailConfigured ? "configured" : "missing";
  return NextResponse.json(out);
}
