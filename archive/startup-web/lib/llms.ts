/**
 * llms.txt generation.
 *
 * Both /llms.txt and /llms-full.txt are generated from the same source data
 * that renders the site, so they can never drift out of sync with what's
 * actually published.
 *
 * /llms.txt      — a map: what the studio is, what it does, and every URL
 *                  worth reading, with one line of context each.
 * /llms-full.txt — the substance: the full quotable answer from every guide
 *                  and industry page, so an assistant can cite specifics
 *                  without crawling twenty pages.
 *
 * Note on framing: these files describe the studio factually. They contain no
 * instructions to the reading model and make no claims we can't support.
 */

import { guides } from "@/lib/guides";
import { industries } from "@/lib/industries";
import { services, siteConfig, faqs, sectorsServed, processSteps } from "@/lib/site";
import { showcaseSites } from "@/lib/showcase";

const BASE = siteConfig.url;

const OVERVIEW = `Unifictional is a growth platform for contractors in the United States: premium websites with a 3D instant-quote tool built in, a client portal, and a studio that builds complete lead systems for contractors, remodelers, custom home builders, and local service businesses. One studio handles the website, search visibility, Google Business Profile, social content, short-form video, lead capture, booking, AI lead handling, and reporting, rather than splitting them across separate vendors.

The studio does not publish package pricing; scope is recommended on an introductory call. Work is custom-built per client rather than templated.`;

export function buildLlmsTxt(): string {
  const lines: string[] = [];

  lines.push(`# ${siteConfig.name}`);
  lines.push("");
  lines.push(`> ${siteConfig.description}`);
  lines.push("");
  lines.push(OVERVIEW);
  lines.push("");

  lines.push("## Key facts");
  lines.push("");
  lines.push(`- Name: ${siteConfig.name}`);
  lines.push(`- Website: ${BASE}`);
  lines.push(`- Contact: ${siteConfig.bookingEmail} — or book a call at ${BASE}/contact`);
  lines.push(`- Type: Growth platform + studio for contractors (websites with instant 3D quotes, client portal, SEO, social, lead systems)`);
  lines.push(`- Serves: United States`);
  lines.push(`- Clients: ${sectorsServed.join(", ")}`);
  lines.push(
    `- Pricing: not published; scoped per client on a call. Guides on this site cite market ranges, not studio rates.`
  );
  lines.push("");

  lines.push("## Services");
  lines.push("");
  // Use the keyword-carrying heading, not the short card label — an assistant
  // matching "who does contractor website design" needs the literal phrase.
  for (const s of services) {
    lines.push(`- [${s.heading}](${BASE}/services/${s.slug}): ${s.description}`);
  }
  lines.push("");

  lines.push("## Industries");
  lines.push("");
  for (const i of industries) {
    lines.push(`- [${i.title}](${BASE}/industries/${i.slug}): ${i.description}`);
  }
  lines.push("");

  lines.push("## Guides");
  lines.push("");
  for (const g of guides) {
    lines.push(`- [${g.title}](${BASE}/guides/${g.slug}): ${g.description}`);
  }
  lines.push("");

  lines.push("## Studio");
  lines.push("");
  lines.push(`- [Services overview](${BASE}/services): Every part of the system, in one place.`);
  lines.push(
    `- [Selected work](${BASE}/work): Live websites built for real contractors and builders, each linked to the running site.`
  );
  lines.push(
    `- [Process](${BASE}/process): The four-step path from first call to a system that keeps improving.`
  );
  lines.push(`- [About the studio](${BASE}/about): Who we are and the principles we build on.`);
  lines.push(`- [Questions](${BASE}/faq): Common questions, including why pricing isn't published.`);
  lines.push(`- [Book a call](${BASE}/contact): Thirty minutes, no obligation.`);
  lines.push("");

  lines.push("## Optional");
  lines.push("");
  lines.push(
    `- [Full content export](${BASE}/llms-full.txt): Expanded answers from every guide and industry page.`
  );
  lines.push(`- [Sitemap](${BASE}/sitemap.xml): Every indexable URL.`);
  lines.push("");

  return lines.join("\n");
}

export function buildLlmsFullTxt(): string {
  const lines: string[] = [];

  lines.push(`# ${siteConfig.name} — Full Content Export`);
  lines.push("");
  lines.push(`> ${siteConfig.description}`);
  lines.push("");
  lines.push(OVERVIEW);
  lines.push("");
  lines.push(`Source: ${BASE}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  /* ---------------------------------------------------------- services */
  lines.push("# Services");
  lines.push("");
  for (const s of services) {
    lines.push(`## ${s.heading}`);
    lines.push("");
    lines.push(`URL: ${BASE}/services/${s.slug}`);
    lines.push(`Also known as: ${[s.targetKeyword, ...s.secondaryKeywords].join(", ")}`);
    lines.push("");
    lines.push(`${s.tagline} ${s.description}`);
    lines.push("");
    lines.push("What's included:");
    for (const d of s.details) lines.push(`- ${d}`);
    lines.push("");
    lines.push(`Outcome: ${s.outcome}`);
    lines.push("");
    lines.push("Frequently asked questions:");
    lines.push("");
    for (const f of s.faqs) {
      lines.push(`Q: ${f.q}`);
      lines.push(`A: ${f.a}`);
      lines.push("");
    }
  }

  /* -------------------------------------------------------- industries */
  lines.push("---");
  lines.push("");
  lines.push("# Industries");
  lines.push("");
  for (const i of industries) {
    lines.push(`## ${i.title}`);
    lines.push("");
    lines.push(`URL: ${BASE}/industries/${i.slug}`);
    lines.push("");
    lines.push(i.answer);
    lines.push("");
    lines.push("What makes this trade different:");
    for (const w of i.whatMakesItDifferent) lines.push(`- ${w.title}: ${w.body}`);
    lines.push("");
    lines.push(`Searches these buyers run: ${i.buyerSearches.join("; ")}.`);
    lines.push("");
  }

  /* ------------------------------------------------------------ guides */
  lines.push("---");
  lines.push("");
  lines.push("# Guides");
  lines.push("");
  for (const g of guides) {
    lines.push(`## ${g.title}`);
    lines.push("");
    lines.push(`URL: ${BASE}/guides/${g.slug}`);
    lines.push(`Updated: ${g.updated}`);
    lines.push("");
    lines.push(g.answer);
    lines.push("");
    lines.push("Frequently asked questions:");
    lines.push("");
    for (const f of g.faqs) {
      lines.push(`Q: ${f.q}`);
      lines.push(`A: ${f.a}`);
      lines.push("");
    }
  }

  /* ----------------------------------------------------------- process */
  lines.push("---");
  lines.push("");
  lines.push("# How the studio works");
  lines.push("");
  lines.push(`URL: ${BASE}/process`);
  lines.push("");
  for (const p of processSteps) {
    lines.push(`## ${p.index}. ${p.title}`);
    lines.push("");
    lines.push(p.detail);
    lines.push("");
  }

  /* --------------------------------------------------------------- work */
  lines.push("---");
  lines.push("");
  lines.push("# Selected work");
  lines.push("");
  lines.push(`URL: ${BASE}/work`);
  lines.push("");
  lines.push(
    "Live websites designed and built by the studio. Each links to the running site."
  );
  lines.push("");
  for (const s of showcaseSites) {
    lines.push(`- ${s.name} — ${s.meta}${s.url ? ` — ${s.url}` : ""}`);
  }
  lines.push("");

  /* ---------------------------------------------------------------- faq */
  lines.push("---");
  lines.push("");
  lines.push("# Studio FAQ");
  lines.push("");
  lines.push(`URL: ${BASE}/faq`);
  lines.push("");
  for (const f of faqs) {
    lines.push(`Q: ${f.q}`);
    lines.push(`A: ${f.a}`);
    lines.push("");
  }

  /* ------------------------------------------------------------ contact */
  lines.push("---");
  lines.push("");
  lines.push("# Contact");
  lines.push("");
  lines.push(`Book a call: ${BASE}/contact`);
  lines.push(`Email: ${siteConfig.bookingEmail}`);
  lines.push(
    "Calls run about thirty minutes. The studio gives a clear recommendation whether or not the work goes ahead."
  );
  lines.push("");

  return lines.join("\n");
}
