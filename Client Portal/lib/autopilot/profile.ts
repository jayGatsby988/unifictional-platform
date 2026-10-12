/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import type { SupabaseClient } from "@supabase/supabase-js";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { cityWithState, inferTradeAndCity } from "../seo-check";
import type { SiteContext } from "./site";
import { llmClient, llmConfigured, unwrap } from "./generate";

/**
 * What the site scan learned about the business, so every post and plan is
 * about *their* industry. Contractor trades are recognised from a pattern
 * table (fast, free); anything else (a bakery, a jeweler, a dentist) is read
 * by Claude from the homepage. Cached on seo_autopilot for a week per URL.
 */
export type SiteProfile = {
  /** Short noun phrase a customer would use: "roofing contractor", "handcrafted jewelry maker". */
  industry: string;
  /** Who buys from them and why. */
  audience: string;
  city: string | null;
  /** Products or services they actually offer, from the site. */
  services: string[];
  /** Searches their customers type that the business could rank for. */
  searchSeeds: string[];
  summary: string;
  source: "trades" | "ai" | "fallback";
  url: string;
  at: string;
};

const PROFILE_MODEL = "claude-sonnet-5-5";
const FRESH_MS = 7 * 24 * 3600e3;

const Schema = z.object({
  industry: z.string().describe("What this business is, as a short noun phrase a customer would use: 'handcrafted jewelry maker', 'family dental practice', 'roofing contractor'"),
  audience: z.string().describe("Who buys from them and why, in one sentence"),
  city: z.string().nullable().describe("The city or area they serve or are based in, with the state if the site shows it; null if the site doesn't say"),
  services: z.array(z.string()).describe("3-8 products or services they actually offer, taken from the site, not guessed"),
  searchSeeds: z.array(z.string()).describe("8-12 searches their customers would type into Google that this business could rank for: lowercase, with the area where that makes sense, mixing buying-intent and questions"),
  summary: z.string().describe("One plain sentence: what the business does and for whom"),
});

const PROFILE_SYSTEM = `You read a small business's website and describe the business precisely, so an SEO writer can plan blog posts for it. Use only what the site says. Do not assume it is a contractor; a bakery is a bakery, a jeweler is a jeweler. Keep every field short and concrete.`;

/** Contractor trades, from the pattern table. null when nothing matched (the site is probably not a contractor). */
export function profileFromTrades(site: SiteContext, url: string): SiteProfile | null {
  const t = inferTradeAndCity(site.title, site.text);
  if (!t.matched) return null;
  const city = cityWithState(t.city, site.text) ?? t.city;
  return {
    industry: t.trade.label,
    audience: `Homeowners${city ? ` in and around ${city}` : ""} who need a ${t.trade.label}`,
    city, services: [],
    searchSeeds: t.trade.queries((city ?? "near me").toLowerCase()),
    summary: `${t.trade.label}${city ? ` in ${city}` : ""}`,
    source: "trades", url, at: new Date().toISOString(),
  };
}

/** Any other business: Claude reads the homepage. */
export async function profileWithClaude(site: SiteContext, url: string): Promise<SiteProfile> {
  const res = await llmClient().beta.messages.parse({
    model: PROFILE_MODEL,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: PROFILE_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `URL: ${url}\nTitle tag: ${site.title ?? ""}\nMeta description: ${site.description ?? ""}\nPages: ${site.paths.slice(0, 40).join(", ")}\n\nHomepage text:\n${site.text.slice(0, 6000)}` }],
    output_config: { effort: "low", format: betaZodOutputFormat(Schema) },
  });
  const p = unwrap(res, "site profile");
  return {
    industry: p.industry.trim(), audience: p.audience.trim(), city: p.city?.trim() || null,
    services: p.services.map((s) => s.trim()).filter(Boolean).slice(0, 8),
    searchSeeds: [...new Set(p.searchSeeds.map((s) => s.toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 12),
    summary: p.summary.trim(), source: "ai", url, at: new Date().toISOString(),
  };
}

/**
 * The profile for a company, cached a week per URL. When the client record has
 * no industry or city yet, the profile fills them in so the studio sees them.
 */
export async function loadSiteProfile(db: SupabaseClient, c: { client: any; settings: any }, site: SiteContext | null, url: string): Promise<SiteProfile> {
  const cached = c.settings?.site_profile as SiteProfile | null | undefined;
  if (cached?.industry && cached.url === url && cached.source !== "fallback" && Date.now() - new Date(cached.at).getTime() < FRESH_MS) return cached;

  let profile: SiteProfile | null = site ? profileFromTrades(site, url) : null;
  if (!profile && site && llmConfigured()) profile = await profileWithClaude(site, url).catch((e) => { console.error("[autopilot] site profile", e instanceof Error ? e.message : e); return null; });
  if (!profile) {
    return { industry: c.client.industry || "local business", audience: "their customers", city: c.client.city || null, services: c.client.services ?? [], searchSeeds: [], summary: "", source: "fallback", url, at: new Date().toISOString() };
  }
  await db.from("seo_autopilot").update({ site_profile: profile, updated_at: new Date().toISOString() }).eq("client_id", c.client.id);
  const patch: Record<string, string> = {};
  if (!c.client.industry) patch.industry = profile.industry;
  if (!c.client.city && profile.city) patch.city = profile.city;
  if (Object.keys(patch).length) await db.from("clients").update(patch).eq("id", c.client.id);
  return profile;
}
