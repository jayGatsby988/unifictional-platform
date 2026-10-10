import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { PlanTopic } from "./plan";

export const MODEL = "claude-opus-5-5";

const PostSchema = z.object({
  title: z.string().describe("Post title, 45-65 characters, naming the city or service area naturally"),
  slug: z.string().describe("URL slug: lowercase words joined by hyphens, no stop words, at most 6 words"),
  targetQuery: z.string().describe("The one local search this post is written to rank for, exactly as a homeowner would type it"),
  rationale: z.string().describe("One plain sentence for the business owner on why this search, right now (what in the brief pointed to it)"),
  metaDescription: z.string().describe("Meta description, 140-160 characters, one plain sentence that includes the area"),
  excerpt: z.string().describe("One sentence summary for the blog index"),
  bodyMarkdown: z.string().describe("The full post in Markdown: ## and ### headings, short paragraphs, lists where they help, 900-1400 words. No H1 (the title is the H1), no front matter, no FAQ (that is separate)."),
  faq: z.array(z.object({ q: z.string(), a: z.string() })).describe("3-5 questions homeowners in this area actually ask, each with a 1-3 sentence answer"),
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
    targetQuery: z.string().describe("The local search it targets, as typed"),
    angle: z.string().describe("One sentence: what the post will say that the current top results don't"),
  })).describe("Twelve posts, in the order they should be written: the biggest money searches first, then questions, comparisons, neighbourhoods and seasonal topics"),
});

const SYSTEM = `You are the SEO writer for Unifictional, a growth studio for contractors and local service businesses. Each run you write one blog post that can rank for a local search homeowners type, and you list on-page fixes for the client's existing website.

How to choose the target search
- One specific local search: a service + city/area, or a question homeowners there ask (cost, permits, timelines, materials, comparisons, seasons).
- When the brief names a planned topic, write that one unless the site already covers it. Prefer searches the site's pages and earlier posts do not already cover, and when Search Console data is present, prefer searches at positions 8-30. The "real searches people type" list shows exact phrasing: use it.

How to write
- Write as the company, first person plural ("we"), to a homeowner, in plain English. Specific to the trade and the area: climate, local codes and permit offices, neighborhoods, realistic price ranges and timelines where you can state them honestly.
- Never invent awards, review counts, statistics, named past projects or clients. If the brief gives no number, say what the answer depends on instead of making one up.
- Open with two sentences that answer the search directly and contain the target search. Then ## sections (### where useful), short paragraphs, lists for steps and options, and one clear call to action at the end naming the company and the city.
- Link naturally to 2-4 of the site's existing pages using the exact relative paths from the brief. Do not link anywhere else.
- Title 45-65 characters and meta description 140-160 characters, both containing the area and the target search. No clickbait, no "ultimate guide", no emojis, no filler openers like "In today's world".

On-page fixes
- From the health-check problems and keyword data in the brief, list up to five concrete fixes for the existing site, most valuable first: what to change, on which page, why it matters for the target searches, and exactly how. Skip generic advice that isn't grounded in the brief.`;

const PLAN_SYSTEM = `You are the SEO strategist for Unifictional, a growth studio for contractors and local service businesses. From the brief, plan the next twelve blog posts for this company.

- Each post targets one local search a homeowner in the area would type: money searches first (cost, price, how much), then permits and timelines, comparisons (material vs material, this vs that), neighbourhood and nearby-town pages, and seasonal topics.
- Use the exact phrasing from the real-searches list and the Search Console data when present; never repeat a topic the site or earlier posts already cover.
- Working titles 45-65 characters with the area in them; one sentence per topic on the angle: what this post will say that the current top results don't.`;

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function client() {
  if (!llmConfigured()) throw new Error("ANTHROPIC_API_KEY is not set (Setup & keys).");
  return new Anthropic();
}

type Parsed<T> = { stop_reason: string | null; stop_details?: { explanation?: string | null } | null; parsed_output: T | null };
function unwrap<T>(res: Parsed<T>, what: string): T {
  if (res.stop_reason === "refusal") throw new Error(`The writer declined this brief${res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : "."}`);
  if (res.stop_reason === "max_tokens") throw new Error(`The ${what} ran past the output limit; it will be retried.`);
  if (!res.parsed_output) throw new Error(`The ${what} could not be parsed.`);
  return res.parsed_output;
}

/** One structured call: the post plus the fixes. The system prompt is cached across clients. */
export async function generatePost(brief: string): Promise<GeneratedPost> {
  const res = await client().beta.messages.parse({
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
  const res = await client().beta.messages.parse({
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
  const res = await client().beta.messages.parse({
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
