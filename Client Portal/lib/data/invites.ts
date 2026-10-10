import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Remember that `email` should get access to `clientId` once they have a login. */
export async function addInvite(db: SupabaseClient, clientId: string, email: string, role = "owner") {
  const { error } = await db.from("client_invites").upsert({ client_id: clientId, email: email.trim().toLowerCase(), role }, { onConflict: "client_id,email" });
  return !error;
}

/**
 * First sign-in automation: attach this login to every company the studio gave
 * its email access to. Runs with the service role; returns how many were linked.
 */
export async function claimInvites(user: { id: string; email?: string | null }): Promise<number> {
  if (!adminConfigured || !user.email) return 0;
  const admin = createAdminClient();
  const email = user.email.trim().toLowerCase();
  const { data: invites } = await admin.from("client_invites").select("client_id, role").eq("email", email);
  if (!invites?.length) return 0;
  const rows = invites.map((i) => ({ client_id: i.client_id, user_id: user.id, role: i.role ?? "owner" }));
  const { error } = await admin.from("client_members").upsert(rows, { onConflict: "client_id,user_id", ignoreDuplicates: true });
  if (error) { console.error("[invites] link failed", error.message); return 0; }
  await admin.from("client_invites").delete().eq("email", email);
  await admin.from("activity").insert(invites.map((i) => ({ client_id: i.client_id, area: "account", title: "Client signed in for the first time" })));
  return rows.length;
}
