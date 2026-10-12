/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import type { SupabaseClient } from "@supabase/supabase-js";
import { findCustomerByEmail, findPlanSubscription, squareConfigured } from "@/lib/billing/square";
import { PLAN_NAME, cadenceFor, isPostsChoice } from "@/lib/billing/packages";

export { PLAN_NAME };

const LIVE = new Set(["ACTIVE", "PENDING"]);

/** May this company use the feature? The studio comps it, or Square says the subscription is live. */
export function accessFrom(row: { comped?: boolean | null; subscription_status?: string | null } | null | undefined): boolean {
  if (!row) return false;
  return Boolean(row.comped) || LIVE.has(String(row.subscription_status ?? "").toUpperCase());
}

/** Ask Square again? At most once a minute, unless we're just back from its checkout. */
export function subscriptionStale(checkedAt: string | null | undefined, justReturned = false): boolean {
  if (justReturned) return true;
  const checked = checkedAt ? new Date(checkedAt).getTime() : 0;
  return Date.now() - checked > 60_000;
}

/**
 * Ask Square whether this company has a live subscription to the plan and
 * remember the answer on seo_autopilot. Needs the service-role client.
 * Finds the Square customer by the stored id, else by the signer's email.
 * When the subscription is live, the posting cadence follows what they bought.
 */
export async function refreshSubscription(admin: SupabaseClient, client: { id: string; square_customer_id?: string | null }, email?: string | null): Promise<{ access: boolean; status: string | null; plan: string | null }> {
  const now = new Date().toISOString();
  if (!squareConfigured) return { access: false, status: null, plan: null };
  let customerId = client.square_customer_id ?? null;
  if (!customerId && email) {
    customerId = await findCustomerByEmail(email.trim().toLowerCase());
    if (customerId) await admin.from("clients").update({ square_customer_id: customerId }).eq("id", client.id);
  }
  const sub = customerId ? await findPlanSubscription(customerId, PLAN_NAME) : null;
  const access = LIVE.has(sub?.status ?? "");
  const { data: row } = await admin.from("seo_autopilot").select("package").eq("client_id", client.id).maybeSingle();
  const posts = (row as any)?.package?.posts;
  await admin.from("seo_autopilot").upsert(
    {
      client_id: client.id, square_subscription_id: sub?.id ?? null, subscription_status: sub?.status ?? null, subscription_plan: sub?.variationName ?? null, subscription_checked_at: now, updated_at: now,
      ...(access && isPostsChoice(posts) ? { cadence: cadenceFor(posts) } : {}),
    },
    { onConflict: "client_id" },
  );
  return { access, status: sub?.status ?? null, plan: sub?.variationName ?? null };
}
