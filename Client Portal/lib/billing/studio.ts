import type { Session } from "@/lib/data/repo";
import { createClient } from "@/lib/supabase/server";
import { squareConfigured, squareDashboard, squareSandbox, studioBilling } from "./square";
import type { StudioBillingRow } from "./types";

export type StudioBillingCompany = {
  id: string; slug: string; name: string; logins: string[];
  customerId: string | null;
  billing: StudioBillingRow | null;
};

export type StudioBillingData = {
  configured: boolean;
  testMode: boolean;
  dashboard: string;
  error: string | null;
  companies: StudioBillingCompany[];
  totals: { monthly: number; open: number; overdue: number; linked: number };
};

export async function getStudioBilling(session: Session): Promise<StudioBillingData> {
  const empty = { monthly: 0, open: 0, overdue: 0, linked: 0 };
  if (session.isDemo || !session.isAdmin) return { configured: false, testMode: false, dashboard: squareDashboard, error: null, companies: [], totals: empty };
  const db = await createClient();
  const [clients, logins] = await Promise.all([
    db.from("clients").select("id, slug, name, square_customer_id").order("name"),
    db.rpc("admin_client_logins"),
  ]);
  const companies: StudioBillingCompany[] = ((clients.data ?? []) as { id: string; slug: string; name: string; square_customer_id: string | null }[]).map((c) => ({
    id: c.id, slug: c.slug, name: c.name, customerId: c.square_customer_id,
    logins: ((logins.data ?? []) as { client_id: string; email: string }[]).filter((l) => l.client_id === c.id).map((l) => l.email),
    billing: null,
  }));
  if (!squareConfigured) return { configured: false, testMode: false, dashboard: squareDashboard, error: null, companies, totals: empty };

  const ids = companies.map((c) => c.customerId).filter((x): x is string => Boolean(x));
  let error: string | null = null;
  if (ids.length) {
    try {
      const rows = await studioBilling(ids, Date.now());
      for (const c of companies) if (c.customerId) c.billing = rows[c.customerId] ?? null;
    } catch (e) {
      console.error("[studio billing]", e);
      error = e instanceof Error ? e.message : "Square didn't respond.";
    }
  }
  const totals = companies.reduce((t, c) => ({
    monthly: t.monthly + (c.billing?.monthly ?? 0), open: t.open + (c.billing?.open ?? 0),
    overdue: t.overdue + (c.billing?.overdue ?? 0), linked: t.linked + (c.customerId ? 1 : 0),
  }), empty);
  return { configured: true, testMode: squareSandbox, dashboard: squareDashboard, error, companies, totals };
}
