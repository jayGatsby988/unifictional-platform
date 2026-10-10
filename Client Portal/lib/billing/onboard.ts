import type { SupabaseClient } from "@supabase/supabase-js";
import { findOrCreateCustomer, sendInvoice, squareConfigured, startMonthlyPlan } from "./square";
import { money, toCents } from "./types";

export type OnboardResult = { linked: boolean; steps: string[]; error: string | null };

/**
 * Onboarding automation: link the company to a Square customer (matched by email,
 * or created), then optionally email the build invoice and start the monthly plan.
 * Never throws: company creation must succeed even if Square is down.
 */
export async function onboardBilling(db: SupabaseClient, input: {
  client: { id: string; name: string; square_customer_id?: string | null };
  email: string;
  start?: { build?: string; monthly?: string; planName?: string; days?: number } | null;
}): Promise<OnboardResult> {
  const steps: string[] = [];
  if (!squareConfigured) return { linked: false, steps, error: null };
  if (!input.email) return { linked: Boolean(input.client.square_customer_id), steps, error: null };
  try {
    let customerId = input.client.square_customer_id ?? null;
    if (!customerId) {
      const c = await findOrCreateCustomer({ email: input.email.toLowerCase(), name: input.client.name, clientId: input.client.id });
      customerId = c.id;
      const { error } = await db.from("clients").update({ square_customer_id: customerId }).eq("id", input.client.id);
      if (error) throw new Error(error.message);
      steps.push(c.existed ? "Linked to their existing Square customer" : "Created their Square customer");
    }
    if (input.start) {
      const nowMs = Date.now();
      const build = toCents(input.start.build ?? "");
      const monthly = toCents(input.start.monthly ?? "");
      if (build) {
        await sendInvoice({ customerId, description: "Website build", amount: build, daysUntilDue: input.start.days ?? 7, nowMs });
        steps.push(`Emailed the ${money(build)} build invoice`);
        await db.from("activity").insert({ client_id: input.client.id, area: "account", title: "Invoice sent: Website build" });
      }
      if (monthly) {
        await startMonthlyPlan({ customerId, name: input.start.planName || "SEO & website care", amount: monthly, nowMs });
        steps.push(`Started the ${money(monthly)}/mo plan`);
      }
    }
    return { linked: true, steps, error: null };
  } catch (e) {
    console.error("[onboard billing]", e);
    return { linked: Boolean(input.client.square_customer_id), steps, error: e instanceof Error ? e.message : "Square error" };
  }
}
