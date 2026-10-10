# Unifictional SEO — keyword map & what was built

**Research date:** 2026-08-09
**Method:** harvested Google Autocomplete (`suggestqueries.google.com`) across 38 seed
terms × 24 modifiers — 5,823 raw suggestions, 4,078 unique queries — then scored by a
demand proxy (how many distinct seeds surface a query × how high Google ranks it in the
suggestion list). Cost figures cross-checked against published 2026 pricing guides.

**Honest caveat:** autocomplete gives you real Google query data and reliable *relative*
demand, but not absolute monthly volume. For hard numbers you'd need Ahrefs/Semrush.
Nothing in this map is invented — every phrase below is a query Google itself suggested.

---

## Starting position (Semrush, Aug 2026)

| Metric | Before |
|---|---|
| Organic keywords | 2 |
| Authority Score | 2 |
| Backlinks / ref. domains | 25 / 18 |
| AI visibility (ChatGPT, AI Overview, AI Mode, Gemini) | 0 across the board |
| Indexable URLs | 16 |

The site ranked for nothing because it *was* nothing, structurally: nine service pages
and five brochure pages, all bottom-of-funnel. There was no page on the site that
answered a question anybody types before they're ready to hire an agency.

---

## Tier 1 — money keywords (mapped to existing pages)

| Target keyword | Page | Notes |
|---|---|---|
| contractor website design | `/services/website-design` | H1 + title rewritten from "Website Design & Build" |
| SEO for contractors | `/services/seo` | was "Search Visibility" — targeted nothing |
| Google Business Profile optimization | `/services/google-business-profile` | |
| social media marketing for contractors | `/services/social-media` | was "Social & Content" |
| short-form video for contractors | `/services/short-form-video` | |
| lead generation for contractors | `/services/lead-capture` | was "Lead Systems" |
| online booking for contractors | `/services/booking-system` | |
| AI receptionist for contractors / missed call text back | `/services/ai-receptionist` | |
| contractor marketing reporting | `/services/analytics` | was "Reporting" |
| contractor marketing agency | `/` and `/services` | |
| **contractor website examples** | `/work` | **highest-scoring term in the entire data set** |

`/work` was the single biggest miss on the old site: eight live client sites sitting
under the title "Selected Work", while "contractor website examples" was the most-
suggested query across the whole harvest. It's now the page's explicit target.

## Tier 2 — trade keywords (8 new pages under `/industries`)

Each of these is a distinct, separately-searched phrase that a combined services page
can't compete for:

`roofing marketing` · `remodeler marketing` · `home builder marketing` ·
`contractor marketing agency` · `kitchen and bath marketing` · `landscaping marketing` ·
`concrete contractor marketing` · `pool builder marketing`

## Tier 3 — question keywords (10 new guides under `/guides`)

These carry the most volume, the least competition from other agencies, and are what AI
assistants actually quote:

| Guide | Primary target |
|---|---|
| `/guides/contractor-website-examples` | contractor website examples |
| `/guides/contractor-website-cost` | how much does a contractor website cost |
| `/guides/seo-cost-for-contractors` | how much does SEO cost |
| `/guides/how-to-market-a-construction-company` | how to market a construction company |
| `/guides/construction-website-design-ideas` | construction website design ideas |
| `/guides/google-business-profile-for-contractors` | how to optimize google business page |
| `/guides/social-media-for-contractors` | social media marketing for construction companies |
| `/guides/how-to-get-more-leads-as-a-contractor` | how to get more leads as a contractor |
| `/guides/missed-call-text-back` | missed call text back |
| `/guides/how-to-choose-a-marketing-agency` | how to choose a marketing agency |

## Deliberately not targeted

`web design services`, `seo services`, `social media marketing agency` as bare head
terms. At Authority Score 2 with 18 referring domains, competing for those against
agencies with thousands of links is a waste of a year. The qualified versions above
reach the same buyers and are winnable. Revisit the head terms once authority is built.

Also skipped: everything in the harvest that was job-seeking (`construction marketing
salary`, `seo contractor jobs`), non-US (`seo services cost in hyderabad`), or
agency-to-agency (`how to start a social media marketing agency`).

---

## What was built

**New pages: 20** (10 guides + 8 industries + 2 hub pages). Sitemap went 16 → 36 URLs.

**On-page**
- Every service page got a keyword-carrying H1 (`heading`) separate from its short card
  label (`title`), plus a written meta title and description.
- 4 FAQs added per service page — rendered content, not schema-only.
- 12 meta titles trimmed so they don't truncate in search results.
- Homepage, `/services`, and `/work` metadata rewritten.
- Nav expanded to include Industries and Guides; footer rebuilt as a 4-column internal
  linking surface pushing crawl equity into the new pages.

**Structured data**
- Site-wide `@graph`: `WebSite` + `ProfessionalService`/`MarketingAgency` with
  `knowsAbout`, `makesOffer` (all 9 services), and `hasOfferCatalog` (all 8 industries).
- Per service page: `Service` (with `serviceType` = target keyword) + `FAQPage` +
  `BreadcrumbList`.
- Per guide: `Article` (with `abstract`) + `FAQPage` + `BreadcrumbList`.
- Per industry: `Service` + `BreadcrumbList`.
- `/work`, `/guides`, `/industries`: `CollectionPage` + `ItemList`.

**AI / LLM visibility**
- `/llms.txt` (~9.5KB) — the map: what the studio is, plus every URL with one line of
  context.
- `/llms-full.txt` (~55KB) — the substance: full quotable answer + FAQs from every
  guide, service, and industry page.
- Both generated from the same data that renders the site, so they cannot drift.
- Every guide and industry page opens with a **"The short answer"** block — a single
  self-contained, quotable paragraph. This is the format assistants lift verbatim.
- `robots.ts` now allows 18 AI crawlers/grounding agents explicitly, including
  `Google-Extended` and `Applebot-Extended` (the opt-in tokens for Gemini and Apple
  Intelligence — both default to allowed, but stating it prevents a future wildcard
  change from silently opting the site out).

**Bug fixed along the way:** a 12-track grid with 48px gaps laid out 528px of pure
column gap at mobile, forcing 201px of horizontal page scroll on guide pages. Grids on
guide, service, and industry pages now stack until `lg`. All 15 checked pages measure
0px horizontal overflow at 390px wide.

---

## Content rules for anything added later

1. **No invented results.** No client revenue figures, no fabricated testimonials, no
   made-up review counts. The schema deliberately carries no `aggregateRating`.
2. **Price ranges are market ranges**, cited as what the industry charges — never as
   Unifictional's rates. The studio's no-published-pricing position is intact; the
   guides answer the enormous "how much does X cost" demand without breaking it.
3. **Schema mirrors rendered content.** Every FAQ in structured data is visible on the
   page. Schema-only content is a manual-action risk.
4. **One page per keyword.** Don't add a keyword to `siteConfig.keywords` unless a page
   is actually built to answer it.

## What still needs the owner

- **Google Search Console** — submit `https://unifictional.com/sitemap.xml` after
  deploying. Nothing here gets discovered quickly without it.
- **Backlinks.** 18 referring domains is the real ceiling on all of this. The eight
  client sites are the obvious first move: a credit link from each is legitimate,
  relevant, and free.
- **Testimonials** — still outstanding from the earlier audit. Real reviews would let us
  add `Review` schema honestly.
- Realistically: guides take 3–6 months to rank. The AI-visibility work (llms.txt, the
  short-answer blocks, schema) can show up considerably faster, since assistants aren't
  waiting on crawl-and-rank cycles the way Google is.
