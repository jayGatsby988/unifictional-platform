import type { SupabaseClient } from "@supabase/supabase-js";
import { findCustomerByEmail, findPlanSubscription, squareConfigured } from "@/lib/billing/square";

/** The plan a client buys for the feature, by name, on Studio · Plans and in Square's catalog. */
export const PLAN_NAME = "SEO Autopilot";
/** Used only when the studio hasn't set a price on Studio · Plans yet. */
export const DEFAULT_PRICE_CENTS = 100;

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

export type PlanOffer ={ name: string; amount: number; tagline: string; features: string[] };

/** The published plan row for the feature (price and bullets the studio edits), with a safe fallback. */
export async function planOffer(db: SupabaseClient): Promise<PlanOffer> {
  const { data } = await db.from("plans").select("name, tagline, price_cents, features").ilike("name", PLAN_NAME).eq("published", true).maybeSingle();
  return {
    name: PLAN_NAME,
    amount: typeof data?.price_cents === "number" && data.price_cents > 0 ? data.price_cents : DEFAULT_PRICE_CENTS,
    tagline: data?.tagline ?? "A blog post a week, written for the searches homeowners near you type, published and checked for you.",
    features: Array.isArray(data?.features) && data.features.length ? data.features : ["One SEO post every week", "Reviewed by a 10-point SEO checklist", "A 12-topic content plan", "On-page fixes for your site", "Cancel any time"],
  };
}

/**
 * Ask Square whether this company has a live subscription to the plan and
 * remember the answer on seo_autopilot. Needs the service-role client.
 * Finds the Square customer by the stored id, else by the signer's email.
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
  await admin.from("seo_autopilot").upsert(
    { client_id: client.id, square_subscription_id: sub?.id ?? null, subscription_status: sub?.status ?? null, subscription_plan: sub?.variationName ?? null, subscription_checked_at: now, updated_at: now },
    { onConflict: "client_id" },
  );
  return { access: LIVE.has(sub?.status ?? ""), status: sub?.status ?? null, plan: sub?.variationName ?? null };
}
