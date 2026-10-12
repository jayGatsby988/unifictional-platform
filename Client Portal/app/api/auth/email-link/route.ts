import { NextResponse } from "next/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { signInLink } from "@/lib/accounts/create";
import { sendEmail, signOffFor } from "@/lib/email/send";
import { signInLinkEmail } from "@/lib/email/templates";

const recent = new Map<string, number>();

/**
 * "Email me a sign-in link" (forgot password). Always answers the same way so it can't be
 * used to discover who has an account. Marks the login to pick a new password after.
 */
export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  const generic = NextResponse.json({ ok: true, message: "If that email has an account, a sign-in link is on its way. It can take a minute; check spam too." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Enter the email you signed up with." }, { status: 400 });
  if (!adminConfigured) return generic;
  const now = Date.now();
  if ((recent.get(email) ?? 0) > now - 60_000) return generic; // one per minute per email
  recent.set(email, now);

  // Only existing logins get a link (never create an account from this form).
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = data?.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) return generic;
  const link = await signInLink(email, new URL(request.url).origin);
  if (!link) return generic;
  await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, must_change_password: true } });
  const mail = signInLinkEmail({ name: String(user?.user_metadata?.full_name ?? ""), link, signOff: signOffFor("onboarding") });
  await sendEmail({ to: email, sender: "onboarding", ...mail });
  return generic;
}
