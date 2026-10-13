import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";

/**
 * The "Sign me in" button in the welcome email: one tap and they're in, no password to type.
 *
 * It's exactly as strong as the temporary password printed in the same email, and it dies
 * with it: valid until they pick their own password (SetPassword clears `welcome_nonce`) or
 * 14 days, whichever comes first. Because it isn't single-use, an email virus-scanner that
 * "pre-clicks" links can't burn it before the owner taps it (a real problem with one-time links).
 */
const DAYS = 14;
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const key = () => createHmac("sha256", "unifictional-welcome-link").update(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").digest();
const sign = (payload: string) => b64(createHmac("sha256", key()).update(payload).digest());

export const newWelcomeNonce = () => b64(randomBytes(12));

export function welcomeLink(o: { userId: string; nonce: string; origin: string; next?: string }): string {
  const payload = b64(JSON.stringify({ u: o.userId, n: o.nonce, e: Date.now() + DAYS * 86_400_000 }));
  const next = o.next && o.next.startsWith("/") ? o.next : "/overview";
  return `${o.origin}/auth/welcome?t=${payload}.${sign(payload)}&next=${encodeURIComponent(next)}`;
}

/** The login behind a welcome token, if it's still good. Email comes back either way when known (for the fallback). */
export async function readWelcomeToken(token: string): Promise<{ ok: true; email: string } | { ok: false; email?: string }> {
  if (!adminConfigured || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false };
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return { ok: false };
  const want = Buffer.from(sign(payload)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false };
  let p: { u?: string; n?: string; e?: number };
  try { p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return { ok: false }; }
  if (!p.u || !p.n) return { ok: false };
  const { data } = await createAdminClient().auth.admin.getUserById(p.u);
  const user = data?.user;
  if (!user?.email) return { ok: false };
  const meta = user.user_metadata ?? {};
  const live = typeof p.e === "number" && p.e > Date.now() && meta.welcome_nonce === p.n && meta.must_change_password !== false;
  return live ? { ok: true, email: user.email } : { ok: false, email: user.email };
}
