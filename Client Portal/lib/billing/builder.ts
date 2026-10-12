import type { Session } from "@/lib/data/repo";
import { getPlans, type Plan } from "@/lib/data/plans";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { catalogFrom, type Catalog } from "./packages";
import { DEMO_RECOMMENDATION, loadRecommendation, recommendFor, type Recommendation } from "./recommend";

/** Everything the plan builder needs for the signed-in company: the catalog the studio publishes and our recommendation. */
export async function loadBuilder(session: Session): Promise<{ plans: Plan[]; catalog: Catalog | null; rec: Recommendation }> {
  const plans = await getPlans();
  const catalog = catalogFrom(plans);
  const c = session.client;
  const fallback = () => (c ? recommendFor({ company: c.name, industry: c.industry, city: c.city, website: c.websiteUrl, site: null }) : DEMO_RECOMMENDATION);
  const rec = session.isDemo || !c ? DEMO_RECOMMENDATION
    : adminConfigured ? await loadRecommendation(createAdminClient(), c).catch(fallback)
    : fallback();
  return { plans, catalog, rec };
}
