import { inferTradeAndCity, queriesFor } from "../seo-check";
import type { SiteContext } from "./site";

export type BriefInput = {
  client: { name: string; industry: string; city: string; websiteUrl: string; services: string[] };
  /** The owner's own words from the setup form: what to push, what to avoid. */
  notes: string;
  site: SiteContext | null;
  /** Search Console keywords, best position first. Empty until GSC is connected. */
  keywords: { keyword: string; position: number; url: string }[];
  existingPosts: { title: string; targetQuery: string | null }[];
  /** "Label: detail" lines from the nightly health check's warn/fail checks. */
  healthIssues: string[];
  cadence: string;
};

/**
 * Everything the writer needs for one post, as plain text. Nothing here is
 * invented: it is the client record, the live site, Search Console and the
 * health check, so the model has real material to be specific with.
 */
export function buildBrief(i: BriefInput): string {
  const inferred = i.site ? inferTradeAndCity(i.site.title, i.site.text) : null;
  const trade = i.client.industry || inferred?.trade.label || "contractor";
  const area = i.client.city || inferred?.city || "their service area";
  const lines: string[] = [
    "# Client",
    `Company: ${i.client.name}`,
    `Trade: ${trade}`,
    `Based in: ${area}`,
    `Website: ${i.client.websiteUrl || "unknown"}`,
  ];
  if (i.client.services.length) lines.push(`Services Unifictional provides them: ${i.client.services.join(", ")}`);
  if (i.notes.trim()) lines.push("", "# Owner's notes (follow these)", i.notes.trim());

  if (i.site) {
    lines.push("", "# What the website says today");
    if (i.site.title) lines.push(`Title tag: ${i.site.title}`);
    if (i.site.description) lines.push(`Meta description: ${i.site.description}`);
    if (i.site.text) lines.push(`Homepage text (excerpt): ${i.site.text.slice(0, 1500)}`);
    if (i.site.paths.length) lines.push(`Existing pages (link to these with relative URLs, never invent others): ${i.site.paths.slice(0, 40).join(", ")}`);
  }

  const seeds = i.site ? queriesFor(i.site.title, i.site.text) : [];
  if (seeds.length) lines.push("", "# Local searches homeowners type for this trade", ...seeds.map((q) => `- ${q}`));

  if (i.keywords.length) {
    lines.push("", "# Google Search Console: searches the site already shows up for (position = average rank)");
    for (const k of i.keywords.slice(0, 25)) lines.push(`- "${k.keyword}" — position ${k.position}${k.url ? ` — ${k.url}` : ""}`);
    lines.push("Searches sitting at positions 8-30 are the best blog targets: one strong post can move them to page one.");
  }

  if (i.existingPosts.length) {
    lines.push("", "# Already published or queued (do not repeat these topics or target searches)");
    for (const p of i.existingPosts.slice(0, 60)) lines.push(`- ${p.title}${p.targetQuery ? ` (for "${p.targetQuery}")` : ""}`);
  }

  if (i.healthIssues.length) lines.push("", "# Problems our nightly check found on the site", ...i.healthIssues.slice(0, 12).map((h) => `- ${h}`));

  lines.push("", "# Task", `Write the next post in a ${i.cadence} series for this company, and list the on-page fixes. Pick a target search that none of the pages or posts above already cover.`);
  return lines.join("\n");
}
