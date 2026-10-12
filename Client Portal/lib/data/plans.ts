import { demoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

import { PLAN_ROLES, type PlanRole } from "./plan-roles";

export { PLAN_ROLES, type PlanRole };

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
  role: PlanRole | null;
  postsPerMonth: number | null; // role "posts": how many posts the price buys
};

const DEMO: Plan[] = [
  { id: "p0", name: "SEO Autopilot", tagline: "A blog post a week, written for the searches homeowners near you type, published and checked for you.", priceCents: 19900, interval: "month", features: ["SEO posts published to your site or ready to paste", "Reviewed by a 10-point SEO checklist before they go live", "A 12-topic content plan you can shape", "On-page fixes for your site, as a checklist", "Google clicks per post once Search Console is connected"], highlight: true, published: true, sort: 5, role: "posts", postsPerMonth: 4 },
  { id: "p1", name: "Website care", tagline: "A site built to turn visitors into calls, hosted and cared for.", priceCents: 14900, interval: "month", features: ["A new site built for your trade, or we take over yours", "Hosting, speed and uptime, handled", "Edits and photo swaps every month", "Security updates and a monthly health check"], highlight: false, published: true, sort: 10, role: "website", postsPerMonth: null },
  { id: "p5", name: "Social posts", tagline: "A steady, professional feed without you touching it.", priceCents: 19900, interval: "month", features: ["Facebook and Instagram posts every week", "Before-and-after highlights from your photos", "Each blog post turned into a social post"], highlight: false, published: true, sort: 12, role: "social", postsPerMonth: null },
  { id: "p6", name: "Google Business Profile", tagline: "Get into the map pack homeowners see first.", priceCents: 7900, interval: "month", features: ["Profile kept complete and current", "A Business Profile post every week", "Review replies drafted for you"], highlight: false, published: true, sort: 14, role: "gbp", postsPerMonth: null },
  { id: "p2", name: "Local SEO", tagline: "Show up when homeowners near you search for what you do.", priceCents: null, interval: "month", features: ["Google Business Profile kept current", "Local keyword tracking", "Monthly fixes from your health check", "Monthly report in this portal"], highlight: false, published: true, sort: 20, role: null, postsPerMonth: null },
  { id: "p4", name: "3D Quote Tool", tagline: "Homeowners design their project in 3D on your website and get a price range on the spot.", priceCents: null, interval: "month", features: ["Interactive 3D project builder on your website", "Instant price ranges from your own rates", "Every quote lands in this portal as a lead"], highlight: false, published: true, sort: 25, role: null, postsPerMonth: null },
];

type Row = { id: string; name: string; tagline: string | null; price_cents: number | null; interval: string; features: string[] | null; highlight: boolean; published: boolean; sort: number; role?: string | null; posts_per_month?: number | null };
const ROLE = new Set<string>(PLAN_ROLES.map((r) => r.key));
const map = (r: Row): Plan => ({
  id: r.id, name: r.name, tagline: r.tagline ?? "", priceCents: r.price_cents, interval: r.interval, features: r.features ?? [], highlight: r.highlight, published: r.published, sort: r.sort,
  role: r.role && ROLE.has(r.role) ? (r.role as PlanRole) : null,
  postsPerMonth: typeof r.posts_per_month === "number" && r.posts_per_month > 0 ? r.posts_per_month : null,
});

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
