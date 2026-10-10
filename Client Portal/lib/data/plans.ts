import { demoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type Plan = {
  id: string;
  name: string;
  tagline: string;
  priceCents: number | null;   // null = custom, quoted on a call
  interval: string;
  features: string[];
  highlight: boolean;
  published: boolean;
  sort: number;
};

const DEMO: Plan[] = [
  { id: "p1", name: "Website care", tagline: "Your site kept fast, safe and up to date.", priceCents: null, interval: "month", features: ["Hosting, uptime and speed monitoring", "Small edits each month", "Monthly health check"], highlight: false, published: true, sort: 10 },
  { id: "p2", name: "Local SEO", tagline: "Show up when homeowners near you search for what you do.", priceCents: null, interval: "month", features: ["Google Business Profile kept current", "Local keyword tracking", "Monthly fixes from your health check", "Monthly report in this portal"], highlight: true, published: true, sort: 20 },
  { id: "p4", name: "3D Quote Tool", tagline: "Homeowners design their project in 3D on your website and get a price range on the spot.", priceCents: null, interval: "month", features: ["Interactive 3D project builder on your website", "Instant price ranges from your own rates", "Every quote lands in this portal as a lead"], highlight: false, published: true, sort: 25 },
  { id: "p3", name: "SEO + Social", tagline: "Local SEO plus a steady social feed.", priceCents: null, interval: "month", features: ["Everything in Local SEO", "Weekly Facebook and Instagram posts", "Monthly social report"], highlight: false, published: true, sort: 30 },
];

type Row = { id: string; name: string; tagline: string | null; price_cents: number | null; interval: string; features: string[] | null; highlight: boolean; published: boolean; sort: number };
const map = (r: Row): Plan => ({ id: r.id, name: r.name, tagline: r.tagline ?? "", priceCents: r.price_cents, interval: r.interval, features: r.features ?? [], highlight: r.highlight, published: r.published, sort: r.sort });

/** Published plans for clients; `all` (studio) includes drafts. RLS enforces the same split. */
export async function getPlans(opts: { all?: boolean } = {}): Promise<Plan[]> {
  if (demoMode) return DEMO;
  const db = await createClient();
  let q = db.from("plans").select("*").order("sort").order("name");
  if (!opts.all) q = q.eq("published", true);
  const { data } = await q;
  return ((data ?? []) as Row[]).map(map);
}

/** Does a live billing plan name (e.g. "Local SEO · $1,500/mo") belong to this portal plan? */
export function isCurrentPlan(plan: Plan, billingPlanNames: string[]) {
  const n = plan.name.trim().toLowerCase();
  return billingPlanNames.some((b) => b.trim().toLowerCase() === n || b.trim().toLowerCase().startsWith(`${n} ·`));
}
