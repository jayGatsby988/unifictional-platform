import { createClient as createSupabase, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "./server";

/**
 * Service-role client for unattended jobs (the nightly cron). Bypasses RLS,
 * so it must never be imported from a client component.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createSupabase(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const adminConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * Best available writer: the service role when configured, otherwise the
 * caller's own session. Row-level security grants portal admins write access
 * to every client table, so an admin's session is enough for the admin page,
 * OAuth callbacks and "Run sync now". Only the cron truly needs the service role.
 */
export async function createWriterClient(): Promise<SupabaseClient> {
  if (adminConfigured) return createAdminClient();
  return createSessionClient();
}
