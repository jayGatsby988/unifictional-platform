import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/site";

/**
 * The studio *wants* to be quoted by assistants, so every major AI crawler and
 * grounding agent is allowed explicitly rather than left to the wildcard.
 * Being explicit matters for two of them in particular:
 *   • Google-Extended isn't a crawler — it's the opt-in token that decides
 *     whether Gemini and Vertex grounding may use our content.
 *   • Applebot-Extended does the same job for Apple Intelligence.
 * Both default to "allowed", but stating it prevents a future wildcard change
 * from silently opting the site out.
 */
const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot",
  "Applebot-Extended",
  "meta-externalagent",
  "Amazonbot",
  "Bytespider",
  "cohere-ai",
  "DuckAssistBot",
  "YouBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: "/api/" },
      ...AI_AGENTS.map((userAgent) => ({ userAgent, allow: "/", disallow: "/api/" })),
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
