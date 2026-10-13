import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { tempPassword } from "@/lib/temp-password";
import { newWelcomeNonce } from "@/lib/accounts/welcome-link";

export type LoginResult =
  | { kind: "created"; userId: string; password: string; welcomeNonce: string }
  | { kind: "exists"; userId: string }
  | { kind: "error"; error: string };

async function findUserId(email: string): Promise<string | null> {
  const admin = createAdminClient();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Create a login with a temporary password (no Supabase email). If the email already
 * has a login, leave its password alone unless `resetIfExists` (studio action).
 */
export async function ensureLogin(input: { email: string; name?: string; extra?: Record<string, string>; resetIfExists?: boolean }): Promise<LoginResult> {
  if (!adminConfigured) return { kind: "error", error: "SUPABASE_SERVICE_ROLE_KEY isn't set." };
  const admin = createAdminClient();
  const email = input.email.trim().toLowerCase();
  const password = tempPassword();
  const welcomeNonce = newWelcomeNonce(); // backs the one-tap "Sign me in" button in the welcome email
  const meta = { must_change_password: true, welcome_nonce: welcomeNonce, ...(input.name ? { full_name: input.name } : {}), ...(input.extra ?? {}) };
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
  if (created.data.user) return { kind: "created", userId: created.data.user.id, password, welcomeNonce };
  const userId = await findUserId(email);
  if (!userId) return { kind: "error", error: created.error?.message ?? "Couldn't create the login." };
  if (!input.resetIfExists) return { kind: "exists", userId };
  const { data: isStudio } = await admin.from("portal_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (isStudio) return { kind: "error", error: "That email is a studio admin. Its password can't be reset from here." };
  const upd = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true, user_metadata: meta });
  if (upd.error) return { kind: "error", error: upd.error.message };
  return { kind: "created", userId, password, welcomeNonce };
}

/** One-time sign-in link that lands on our own /auth/confirm (works with our cookies, no Supabase email). */
export async function signInLink(email: string, origin: string, next = "/overview"): Promise<string | null> {
  if (!adminConfigured) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: email.trim().toLowerCase() });
  if (error || !data.properties?.hashed_token) return null;
  return `${origin}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink&next=${encodeURIComponent(next)}`;
}
