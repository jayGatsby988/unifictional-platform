import type { SupabaseClient } from "@supabase/supabase-js";

/** Who at a company hears from us: every member's login email, with their first name. Needs the service-role client. */
export async function clientRecipients(admin: SupabaseClient, clientId: string): Promise<{ email: string; name: string }[]> {
  const { data: members } = await admin.from("client_members").select("user_id").eq("client_id", clientId);
  const out: { email: string; name: string }[] = [];
  for (const m of members ?? []) {
    const { data } = await admin.auth.admin.getUserById(m.user_id as string);
    const u = data?.user;
    if (u?.email) out.push({ email: u.email, name: String(u.user_metadata?.full_name ?? "") });
  }
  return out;
}
