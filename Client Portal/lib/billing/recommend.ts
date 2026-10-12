/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SiteContext } from "@/lib/autopilot/site";
import { fetchSiteContext } from "@/lib/autopilot/site";
import type { AddonKey, PostsChoice } from "./packages";

/**
 * "What should I pick?" A recommendation from what we can read about the company:
 * how big the site is, whether it has a blog, how crowded the trade is where they
 * work. Deterministic and explainable: every number comes with the reason.
 */
export type Recommendation = {
  posts: PostsChoice;
  addons: AddonKey[];
  reasons: string[];
  basis: { readSite: boolean; pages: number; blogPosts: number; competitive: boolean; metro: boolean };
  at: string;
};

const COMPETITIVE = ["roof", "remodel", "kitchen", "bath", "siding", "hvac", "heating", "plumb", "electric", "landscap", "fence", "deck", "paint", "concrete", "construction", "contractor", "adu", "solar", "window", "floor", "pool", "garage", "builder"];
const METROS = ["seattle", "bellevue", "tacoma", "everett", "kirkland", "redmond", "lynnwood", "bothell", "renton", "kent", "portland", "los angeles", "san diego", "san jose", "san francisco", "sacramento", "phoenix", "denver", "dallas", "houston", "austin", "chicago", "atlanta", "miami", "new york", "boston", "las vegas", "spokane", "vancouver"];
const VISUAL = ["remodel", "kitchen", "bath", "landscap", "deck", "pool", "paint", "outdoor", "adu", "cabinet", "tile", "floor", "siding", "roof", "builder", "construction"];
const BLOG_PATH = /\/(blog|news|articles?|posts?|insights|resources|journal|guides?)\//i;

const has = (hay: string, words: string[]) => words.some((w) => hay.includes(w));

export function recommendFor(input: { company: string; industry: string; city: string; website: string; site: SiteContext | null }): Recommendation {
  const readSite = Boolean(input.site);
  const paths = input.site?.paths ?? [];
  const pages = readSite ? Math.max(1, paths.length) : 0;
  const blogPosts = paths.filter((p) => BLOG_PATH.test(p)).length;
  const hay = `${input.industry} ${input.site?.title ?? ""} ${input.site?.description ?? ""}`.toLowerCase();
  const trade = input.industry.trim() || "your trade";
  const where = input.city.trim();
  const competitive = has(hay, COMPETITIVE);
  const metro = has(`${where} ${hay}`.toLowerCase(), METROS);
  const reasons: string[] = [];
  const addons: AddonKey[] = [];

  let posts: PostsChoice = 4;
  if (!readSite) {
    reasons.push(input.website ? `We couldn't read ${input.website.replace(/^https?:\/\//, "")}, so we start at the pace Google rewards: a post a week.` : "There's no website on file yet, so we start at the pace Google rewards: a post a week.");
  } else if (blogPosts >= 20) {
    posts = 2;
    reasons.push(`Your site already has about ${blogPosts} posts. Two a month keeps it fresh without repeating yourself.`);
  } else if (blogPosts === 0 && competitive && metro) {
    posts = 8;
    reasons.push(`No blog yet, and ${trade} around ${where || "your area"} is crowded. Twice a week builds a base fast; drop to weekly once you're ranking.`);
  } else if (blogPosts === 0) {
    reasons.push("No blog yet. A post a week is the pace that gets a new blog ranking in three to four months.");
  } else {
    reasons.push(`Only ${blogPosts} post${blogPosts === 1 ? "" : "s"} so far. Weekly fills the gaps homeowners search for.`);
  }

  if (!readSite || pages < 6) {
    addons.push("website");
    reasons.push(readSite ? `Your site has ${pages} page${pages === 1 ? "" : "s"}. Thin sites rank poorly; service and area pages give every post somewhere to point.` : "A site that turns visitors into calls comes first; the posts send people there.");
  }
  if (competitive && where) {
    addons.push("gbp");
    reasons.push(`Searches in ${where} show the map pack before any website. A maintained Business Profile is how you get into it.`);
  }
  if (has(hay, VISUAL)) {
    addons.push("social");
    reasons.push(`${trade[0].toUpperCase() + trade.slice(1)} sells on before-and-after photos. A steady feed turns each post into social proof.`);
  }
  if (readSite && pages >= 6 && addons.length === 0) reasons.push(`Your site has ${pages} pages and a blog, so the posts alone will do the work.`);

  return { posts, addons, reasons, basis: { readSite, pages, blogPosts, competitive, metro }, at: new Date().toISOString() };
}

const FRESH_MS = 7 * 24 * 3600e3;

/**
 * The stored recommendation for a company, computed from their site the first
 * time (capped at a few seconds so the page stays quick) and kept for a week.
 * Needs the service-role client. A timed-out read isn't cached, so it retries next time.
 */
export async function loadRecommendation(admin: SupabaseClient, client: { id: string; name: string; industry: string; city: string; websiteUrl: string }): Promise<Recommendation> {
  const { data: row } = await admin.from("seo_autopilot").select("recommendation, recommended_at").eq("client_id", client.id).maybeSingle();
  const stored = (row as any)?.recommendation as Recommendation | null | undefined;
  if (stored?.posts && (row as any)?.recommended_at && Date.now() - new Date((row as any).recommended_at).getTime() < FRESH_MS) return stored;

  const TIMEOUT = Symbol("timeout");
  const site = client.websiteUrl
    ? await Promise.race([fetchSiteContext(client.websiteUrl).catch(() => null), new Promise<typeof TIMEOUT>((r) => setTimeout(() => r(TIMEOUT), 6000))])
    : null;
  const rec = recommendFor({ company: client.name, industry: client.industry, city: client.city, website: client.websiteUrl, site: site === TIMEOUT ? null : site });
  if (site !== TIMEOUT) {
    const now = new Date().toISOString();
    await admin.from("seo_autopilot").upsert({ client_id: client.id, recommendation: rec, recommended_at: now, updated_at: now }, { onConflict: "client_id" });
  }
  return rec;
}

export const DEMO_RECOMMENDATION: Recommendation = {
  posts: 4, addons: ["gbp", "social"],
  reasons: [
    "Only 3 posts so far. Weekly fills the gaps homeowners search for.",
    "Searches in Everett show the map pack before any website. A maintained Business Profile is how you get into it.",
    "Remodeling sells on before-and-after photos. A steady feed turns each post into social proof.",
  ],
  basis: { readSite: true, pages: 14, blogPosts: 3, competitive: true, metro: true }, at: "2026-10-01T00:00:00.000Z",
};
