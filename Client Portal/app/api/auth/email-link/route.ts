import { NextResponse } from "next/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { findUserId, signInLink } from "@/lib/accounts/create";
import { sendEmail, signOffFor } from "@/lib/email/send";
import { signInLinkEmail } from "@/lib/email/templates";
import { clientIp, hashKey, rateLimited } from "@/lib/rate-limit";

/**
 * "Email me a sign-in link" (forgot password). Always answers the same way so it can't be
 * used to discover who has an account. Nothing about the account changes here: the
 * "pick a new password" prompt is only switched on when the link is actually used
 * (/auth/confirm?reset=1), so typing someone's email can't disturb their login.
 */
export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  const generic = NextResponse.json({ ok: true, message: "If that email has an account, a sign-in link is on its way. It can take a minute; check spam too." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Enter the email you signed up with." }, { status: 400 });
  if (!adminConfigured) return generic;
  const ip = clientIp(request);
  if (await rateLimited(hashKey("link-email", email), 3, 3_600_000)) return generic; // a few per hour per inbox
  if (ip && await rateLimited(hashKey("link-ip", ip), 10, 3_600_000)) return generic;

  // Only existing logins get a link (never create an account from this form).
  const userId = await findUserId(email).catch(() => null);
  if (!userId) return generic;
  const link = await signInLink(email, new URL(request.url).origin, "/overview", { askNewPassword: true });
  if (!link) return generic;
  const { data } = await createAdminClient().auth.admin.getUserById(userId);
  const mail = signInLinkEmail({ name: String(data?.user?.user_metadata?.full_name ?? ""), link, signOff: signOffFor("onboarding") });
  await sendEmail({ to: email, sender: "onboarding", ...mail });
  return generic;
}
