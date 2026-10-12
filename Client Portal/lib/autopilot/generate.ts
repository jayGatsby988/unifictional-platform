import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { PlanTopic } from "./plan";

export const MODEL = "claude-opus-5-5";

const PostSchema = z.object({
  title: z.string().describe("Post title, 45-65 characters, naming the city or service area naturally"),
  slug: z.string().describe("URL slug: lowercase words joined by hyphens, no stop words, at most 6 words"),
  targetQuery: z.string().describe("The one search this post is written to rank for, exactly as one of this business's customers would type it"),
  rationale: z.string().describe("One plain sentence for the business owner on why this search, right now (what in the brief pointed to it)"),
  metaDescription: z.string().describe("Meta description, 140-160 characters, one plain sentence that includes the area"),
  excerpt: z.string().describe("One sentence summary for the blog index"),
  bodyMarkdown: z.string().describe("The full post in Markdown: ## and ### headings, short paragraphs, lists where they help, 900-1400 words. No H1 (the title is the H1), no front matter, no FAQ (that is separate)."),
  faq: z.array(z.object({ q: z.string(), a: z.string() })).describe("3-5 questions this business's customers actually ask about the topic, each with a 1-3 sentence answer"),
  optimizations: z.array(z.object({
    title: z.string().describe("The fix in five words or fewer"),
    where: z.string().describe("Page path, or 'site-wide'"),
    why: z.string().describe("Why it matters for the searches this company wants"),
    how: z.string().describe("Exactly what to change, specific enough to do without asking"),
    impact: z.enum(["high", "medium", "low"]),
  })).describe("Up to 5 concrete on-page fixes for the existing site, most valuable first"),
});
export type GeneratedPost = z.infer<typeof PostSchema>;

const PlanSchema = z.object({
  topics: z.array(z.object({
    title: z.string().describe("Working title, 45-65 characters, with the area"),
    targetQuery: z.string().describe("The search it targets, as a customer would type it"),
    angle: z.string().describe("One sentence: what the post will say that the current top results don't"),
  })).describe("Twelve posts, in the order they should be written: the biggest buying-intent searches first, then questions, comparisons, local/nearby-area topics and seasonal topics"),
});

const SYSTEM = `You are the SEO writer for Unifictional, a growth studio for contractors and local businesses. Each run you write one blog post that can rank for a search the client's customers actually type, and you list on-page fixes for the client's existing website. The brief says what the business is and who it sells to: a contractor writes for homeowners in its service area; a shop, maker or studio writes for the people who buy what it makes. Stay inside that business's world.

How to choose the target search
- One specific search with intent: a service or product + city/area, or a question those customers ask (cost, how to choose, care, materials, comparisons, permits and timelines for trades, seasons and gifting for shops).
- When the brief names a planned topic, write that one unless the site already covers it. Prefer searches the site's pages and earlier posts do not already cover, and when Search Console data is present, prefer searches at positions 8-30. The "real searches people type" list shows exact phrasing: use it.

How to write
- Write as the company, first person plural ("we"), to the customer described in the brief, in plain English. Specific to the business and the area: for trades, climate, local codes and permit offices, neighborhoods, realistic price ranges and timelines where you can state them honestly; for shops and makers, materials, process, care, sizing, pricing logic and local pickup or shipping where the site says so.
- Never invent awards, review counts, statistics, named past projects or clients. If the brief gives no number, say what the answer depends on instead of making one up.
- Open with two sentences that answer the search directly and contain the target search. Then ## sections (### where useful), short paragraphs, lists for steps and options, and one clear call to action at the end naming the company and the city.
- Link naturally to 2-4 of the site's existing pages using the exact relative paths from the brief. Do not link anywhere else.
- Title 45-65 characters and meta description 140-160 characters, both containing the area and the target search. No clickbait, no "ultimate guide", no emojis, no filler openers like "In today's world".

On-page fixes
- From the health-check problems and keyword data in the brief, list up to five concrete fixes for the existing site, most valuable first: what to change, on which page, why it matters for the target searches, and exactly how. Skip generic advice that isn't grounded in the brief.`;

const PLAN_SYSTEM = `You are the SEO strategist for Unifictional, a growth studio for contractors and local businesses. From the brief, plan the next twelve blog posts for this company. The brief says what the business is and who it sells to; every topic must belong to that business (a bracelet maker gets posts about bracelets, gifting, materials and care, never contractor topics, and vice versa).

- Each post targets one search its customers would type: buying-intent searches first (cost, price, how much, best X for Y), then how-to-choose and comparison topics (material vs material, this vs that), questions they ask (care, sizing, permits and timelines for trades), local and nearby-area topics, and seasonal or gifting topics.
- Use the exact phrasing from the real-searches list and the Search Console data when present; never repeat a topic the site or earlier posts already cover.
- Working titles 45-65 characters with the area in them; one sentence per topic on the angle: what this post will say that the current top results don't.`;

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function llmClient() {
  if (!llmConfigured()) throw new Error("ANTHROPIC_API_KEY is not set (Setup & keys).");
  return new Anthropic();
}

type Parsed<T> = { stop_reason: string | null; stop_details?: { explanation?: string | null } | null; parsed_output: T | null };
export function unwrap<T>(res: Parsed<T>, what: string): T {
  if (res.stop_reason === "refusal") throw new Error(`The writer declined this brief${res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : "."}`);
  if (res.stop_reason === "max_tokens") throw new Error(`The ${what} ran past the output limit; it will be retried.`);
  if (!res.parsed_output) throw new Error(`The ${what} could not be parsed.`);
  return res.parsed_output;
}

/** One structured call: the post plus the fixes. The system prompt is cached across clients. */
export async function generatePost(brief: string): Promise<GeneratedPost> {
  const res = await llmClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: brief }],
    output_config: { effort: "high", format: betaZodOutputFormat(PostSchema) },
  });
  return unwrap(res, "post");
}

/** Second pass when the quality gate finds problems: same brief, the draft, and exactly what to fix. */
export async function revisePost(brief: string, draft: GeneratedPost, issues: string[]): Promise<GeneratedPost> {
  const res = await llmClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: `${brief}\n\n# Your draft\n${JSON.stringify(draft)}\n\n# Checks the draft failed\n${issues.map((i) => `- ${i}`).join("\n")}\n\nFix every failed check without changing the topic, the target search or the facts, and return the complete corrected post.`,
    }],
    output_config: { effort: "medium", format: betaZodOutputFormat(PostSchema) },
  });
  return unwrap(res, "revision");
}

/** Twelve planned posts for a company, from the same brief the writer gets. */
export async function generatePlan(brief: string): Promise<PlanTopic[]> {
  const res = await llmClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: PLAN_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `${brief}\n\n# Task\nPlan the next twelve posts.` }],
    output_config: { effort: "medium", format: betaZodOutputFormat(PlanSchema) },
  });
  return unwrap(res, "plan").topics;
}
