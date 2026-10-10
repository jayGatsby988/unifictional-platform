import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const MODEL = "claude-opus-5-5";

const PostSchema = z.object({
  title: z.string().describe("Post title, 45-65 characters, naming the city or service area naturally"),
  slug: z.string().describe("URL slug: lowercase words joined by hyphens, no stop words, at most 6 words"),
  targetQuery: z.string().describe("The one local search this post is written to rank for, exactly as a homeowner would type it"),
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

const SYSTEM = `You are the SEO writer for Unifictional, a growth studio for contractors and local service businesses. Each run you write one blog post that can rank for a local search homeowners type, and you list on-page fixes for the client's existing website.

How to choose the target search
- One specific local search: a service + city/area, or a question homeowners there ask (cost, permits, timelines, materials, comparisons, seasons).
- Prefer searches the site's pages and earlier posts do not already cover. When Search Console data is in the brief, prefer searches at positions 8-30.

How to write
- Write as the company, first person plural ("we"), to a homeowner, in plain English. Specific to the trade and the area: climate, local codes and permit offices, neighborhoods, realistic price ranges and timelines where you can state them honestly.
- Never invent awards, review counts, statistics, named past projects or clients. If the brief gives no number, say what the answer depends on instead of making one up.
- Open with two sentences that answer the search directly. Then ## sections (### where useful), short paragraphs, lists for steps and options, and one clear call to action at the end naming the company and the city.
- Link naturally to 2-4 of the site's existing pages using the exact relative paths from the brief. Do not link anywhere else.
- Title 45-65 characters and meta description 140-160 characters, both containing the area. No clickbait, no "ultimate guide", no emojis, no filler openers like "In today's world".

On-page fixes
- From the health-check problems and keyword data in the brief, list up to five concrete fixes for the existing site, most valuable first: what to change, on which page, why it matters for the target searches, and exactly how. Skip generic advice that isn't grounded in the brief.`;

export function llmConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** One structured call: the post plus the fixes. The system prompt is cached across clients. */
export async function generatePost(brief: string): Promise<GeneratedPost> {
  if (!llmConfigured()) throw new Error("ANTHROPIC_API_KEY is not set (Setup & keys).");
  const client = new Anthropic();
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: brief }],
    output_config: { effort: "high", format: betaZodOutputFormat(PostSchema) },
  });
  if (res.stop_reason === "refusal") throw new Error(`The writer declined this brief${res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : "."}`);
  if (res.stop_reason === "max_tokens") throw new Error("The post ran past the output limit; it will be retried.");
  const post = res.parsed_output;
  if (!post) throw new Error("The writer's answer could not be parsed.");
  return post;
}
