import type { Autopilot, PlanItem, PortalData, SeoDay, DayPoint, StudioAutopilotRow } from "./types";

// Deterministic pseudo-random so SSR and client agree and charts look organic.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const TODAY = new Date("2026-10-06T08:00:00-07:00");

function iso(daysAgo: number) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function series(days: number, base: number, growth: number, noise: number, seed: number, weekly = true): DayPoint[] {
  const r = rng(seed);
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const t = (days - 1 - i) / (days - 1);
    const dow = new Date(iso(i)).getDay();
    const weekend = weekly && (dow === 0 || dow === 6) ? 0.72 : 1;
    const v = (base + growth * t) * weekend * (1 + (r() - 0.5) * noise);
    out.push({ date: iso(i), value: Math.max(0, Math.round(v)) });
  }
  return out;
}

function seoSeries(): SeoDay[] {
  const clicks = series(90, 9, 14, 0.5, 11);
  const imps = series(90, 420, 610, 0.35, 23);
  return clicks.map((c, i) => {
    const impressions = imps[i].value;
    const ctr = impressions ? (c.value / impressions) * 100 : 0;
    const position = 14.8 - (i / 89) * 6.1 + (((i * 7) % 5) - 2) * 0.15;
    return { date: c.date, clicks: c.value, impressions, ctr: +ctr.toFixed(2), position: +position.toFixed(1) };
  });
}

const seoDaily = seoSeries();
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const clicks90 = sum(seoDaily.map((d) => d.clicks));
const imps90 = sum(seoDaily.map((d) => d.impressions));

const sessionsDaily = series(30, 48, 26, 0.4, 5);
const reachDaily = series(30, 420, 380, 0.6, 17, false);

export const demoData: PortalData = {
  isDemo: true,
  status: {
    connected: { site: true, ga4: true, gsc: true, gbp: true, meta: true },
    has: { traffic: true, seo: true, gbp: true, social: true, scores: true, health: false },
    lastSyncAt: TODAY.toISOString(),
  },
  generatedAt: TODAY.toISOString(),
  client: {
    id: "demo-northline",
    slug: "northline-builders",
    name: "Northline Builders",
    industry: "General Contractor · Remodels & ADUs",
    city: "Everett, WA",
    websiteUrl: "https://northlinebuilders.com",
    launchedAt: "2026-06-12",
    services: ["Website", "Local SEO", "Google Business Profile", "Social & Content", "3D Modeling"],
    accountManager: { name: "Trishank", email: "unifictional@gmail.com" },
    billingCustomerId: "demo",
  },
  website: {
    status: "live",
    uptimePct: 99.98,
    lastCheckedAt: new Date(TODAY.getTime() - 4 * 60 * 1000).toISOString(),
    scores: { performance: 94, seo: 98, accessibility: 96, bestPractices: 100 },
    vitals: { lcpMs: 1380, cls: 0.01, inpMs: 92 },
    last30: { sessions: sum(sessionsDaily.map((d) => d.value)), users: 1510, pageviews: 4930, formSubmissions: 23, calls: 31 },
    prev30: { sessions: 1366, users: 1142, pageviews: 3710, formSubmissions: 16, calls: 24 },
    sessionsDaily,
    sources: [
      { name: "Organic search", sharePct: 58 },
      { name: "Direct", sharePct: 17 },
      { name: "Google Business Profile", sharePct: 14 },
      { name: "Social", sharePct: 8 },
      { name: "Referral", sharePct: 3 },
    ],
    topPages: [
      { path: "/", views: 1840, conversions: 14 },
      { path: "/services/adu-construction", views: 712, conversions: 9 },
      { path: "/services/kitchen-remodeling", views: 598, conversions: 7 },
      { path: "/projects", views: 540, conversions: 3 },
      { path: "/service-areas/lake-stevens", views: 322, conversions: 5 },
      { path: "/contact", views: 301, conversions: 16 },
    ],
    recentLeads: [
      { at: iso(0), type: "form", detail: "Detached ADU estimate — Mill Creek" },
      { at: iso(1), type: "call", detail: "4m 12s · from Google Business Profile" },
      { at: iso(1), type: "form", detail: "Kitchen remodel — Lake Stevens" },
      { at: iso(2), type: "call", detail: "2m 40s · from website" },
      { at: iso(3), type: "form", detail: "Basement finish — Everett" },
      { at: iso(4), type: "call", detail: "6m 03s · from Google Business Profile" },
    ],
    health: null,
    healthAt: null,
    responseMs: 212,
    checks: [],
  },
  seo: {
    daily: seoDaily,
    totals90: {
      clicks: clicks90,
      impressions: imps90,
      ctr: +((clicks90 / imps90) * 100).toFixed(2),
      position: +(sum(seoDaily.map((d) => d.position)) / seoDaily.length).toFixed(1),
    },
    prev90: { clicks: Math.round(clicks90 * 0.46), impressions: Math.round(imps90 * 0.58), ctr: 1.9, position: 18.4 },
    keywords: [
      { keyword: "general contractor everett wa", position: 3, prevPosition: 5, clicks: 86, impressions: 1240, url: "/" },
      { keyword: "adu builder everett", position: 2, prevPosition: 4, clicks: 71, impressions: 690, url: "/services/adu-construction" },
      { keyword: "kitchen remodel everett wa", position: 4, prevPosition: 9, clicks: 58, impressions: 1020, url: "/services/kitchen-remodeling" },
      { keyword: "detached adu snohomish county", position: 5, prevPosition: 11, clicks: 44, impressions: 870, url: "/services/adu-construction" },
      { keyword: "home remodeling contractor lake stevens", position: 6, prevPosition: 14, clicks: 31, impressions: 610, url: "/service-areas/lake-stevens" },
      { keyword: "basement finishing everett", position: 7, prevPosition: 8, clicks: 24, impressions: 480, url: "/services/basement-finishing" },
      { keyword: "northline builders", position: 1, prevPosition: 1, clicks: 112, impressions: 150, url: "/" },
      { keyword: "custom home builder snohomish", position: 9, prevPosition: 17, clicks: 19, impressions: 940, url: "/services/custom-homes" },
      { keyword: "remodel contractor mill creek wa", position: 11, prevPosition: null, clicks: 12, impressions: 520, url: "/service-areas/mill-creek" },
      { keyword: "adu cost washington", position: 12, prevPosition: 21, clicks: 27, impressions: 2100, url: "/guides/adu-cost" },
      { keyword: "garage conversion everett", position: 14, prevPosition: null, clicks: 8, impressions: 330, url: "/services/adu-construction" },
      { keyword: "bathroom remodel marysville", position: 16, prevPosition: 23, clicks: 6, impressions: 410, url: "/service-areas/marysville" },
    ],
    gbp: {
      views: 6210, searches: 2840, calls: 41, directions: 58, websiteClicks: 196,
      reviews: 47, rating: 4.9, newReviews30: 4,
      prev: { views: 4480, calls: 29, directions: 44, websiteClicks: 131 },
    },
    workLog: [
      { at: iso(2), title: "Published 2 service-area pages", detail: "Mill Creek and Marysville, each with local project photos and FAQ schema." },
      { at: iso(6), title: "ADU cost guide refreshed", detail: "2026 permit fees and Snohomish County timelines added; now ranks for 'adu cost washington'." },
      { at: iso(9), title: "12 citations corrected", detail: "NAP consistency fixed across Yelp, Houzz, BBB, Angi and 8 directories." },
      { at: iso(13), title: "Google Business Profile: 6 new photos + 2 posts", detail: "Whitaker ADU exterior and Lake Stevens kitchen reveal." },
      { at: iso(20), title: "Review responses", detail: "Replied to 4 new reviews within 24h." },
      { at: iso(27), title: "Internal linking pass", detail: "Service pages now cross-link to matching project pages." },
    ],
  },
  social: {
    accounts: [
      { platform: "instagram", handle: "@northlinebuilders", url: "https://instagram.com/northlinebuilders", followers: 1284, followersDelta30: 96, reach30: sum(reachDaily.map((d) => d.value)), profileVisits30: 412, posts30: 12, engagementRatePct: 5.8 },
      { platform: "facebook", handle: "Northline Builders", url: "https://facebook.com/northlinebuilders", followers: 860, followersDelta30: 31, reach30: 9120, profileVisits30: 148, posts30: 12, engagementRatePct: 3.1 },
    ],
    reachDaily,
    posts: [
      { id: "p1", platform: "instagram", kind: "reel", caption: "From slab to keys in 11 weeks — the Whitaker detached ADU, start to finish.", at: iso(1), status: "published", likes: 214, comments: 18, saves: 41, reach: 6820, tone: "from-neutral-800 to-neutral-600" },
      { id: "p2", platform: "instagram", kind: "carousel", caption: "Before / after: a 1978 kitchen in Lake Stevens opened up to the backyard.", at: iso(4), status: "published", likes: 162, comments: 11, saves: 57, reach: 4310, tone: "from-stone-700 to-stone-500" },
      { id: "p3", platform: "instagram", kind: "image", caption: "Site walk Monday. Rain or shine, we check every framing line ourselves.", at: iso(7), status: "published", likes: 88, comments: 4, saves: 6, reach: 1930, tone: "from-zinc-700 to-zinc-500" },
      { id: "p4", platform: "facebook", kind: "image", caption: "Now scheduling spring ADU builds in Snohomish County. Two slots left.", at: iso(9), status: "published", likes: 46, comments: 9, saves: 0, reach: 2210, tone: "from-neutral-700 to-neutral-500" },
      { id: "p5", platform: "instagram", kind: "reel", caption: "The 3 questions every homeowner asks about ADU permits — answered on site.", at: iso(12), status: "published", likes: 131, comments: 23, saves: 64, reach: 5140, tone: "from-slate-700 to-slate-500" },
      { id: "p6", platform: "instagram", kind: "reel", caption: "Deck + pergola in Mukilteo: the 3D model vs. the finished build.", at: iso(-2), status: "scheduled", likes: 0, comments: 0, saves: 0, reach: 0, tone: "from-neutral-900 to-neutral-700" },
      { id: "p7", platform: "facebook", kind: "image", caption: "Meet the crew: 14 years of framing between the three of them.", at: iso(-4), status: "scheduled", likes: 0, comments: 0, saves: 0, reach: 0, tone: "from-stone-800 to-stone-600" },
      { id: "p8", platform: "instagram", kind: "carousel", caption: "Basement finish in Everett — 5 photos, zero drywall seams showing.", at: iso(-6), status: "scheduled", likes: 0, comments: 0, saves: 0, reach: 0, tone: "from-zinc-800 to-zinc-600" },
    ],
  },
  estimator: {
    embedded: true,
    embedPath: "/get-a-quote",
    stats30: { sessions: 212, generated: 64, quotesSent: 41, leads: 19 },
    prev30: { sessions: 148, generated: 39, quotesSent: 25, leads: 11 },
    pricing: {
      projectTypes: [
        { id: "adu", name: "Detached ADU", unit: "sqft", baseRate: 385, minPrice: 180000, enabled: true },
        { id: "garage-adu", name: "Garage conversion", unit: "sqft", baseRate: 240, minPrice: 95000, enabled: true },
        { id: "kitchen", name: "Kitchen remodel", unit: "sqft", baseRate: 310, minPrice: 45000, enabled: true },
        { id: "bath", name: "Bathroom remodel", unit: "sqft", baseRate: 420, minPrice: 24000, enabled: true },
        { id: "basement", name: "Basement finish", unit: "sqft", baseRate: 95, minPrice: 38000, enabled: true },
        { id: "deck", name: "Deck", unit: "sqft", baseRate: 68, minPrice: 12000, enabled: true },
        { id: "addition", name: "Home addition", unit: "sqft", baseRate: 410, minPrice: 120000, enabled: false },
      ],
      options: [
        { id: "second-bath", name: "Second bathroom", appliesTo: ["adu", "garage-adu"], priceType: "flat", amount: 18500, enabled: true },
        { id: "covered-porch", name: "Covered porch", appliesTo: ["adu"], priceType: "flat", amount: 9800, enabled: true },
        { id: "solar-ready", name: "Solar-ready roof", appliesTo: ["adu", "addition"], priceType: "flat", amount: 3200, enabled: true },
        { id: "island", name: "Island with seating", appliesTo: ["kitchen"], priceType: "flat", amount: 7400, enabled: true },
        { id: "quartz", name: "Quartz counters", appliesTo: ["kitchen", "bath"], priceType: "percent", amount: 6, enabled: true },
        { id: "pergola", name: "Cedar pergola", appliesTo: ["deck"], priceType: "per_unit", amount: 42, enabled: true },
        { id: "composite", name: "Composite decking upgrade", appliesTo: ["deck"], priceType: "per_unit", amount: 19, enabled: true },
        { id: "egress", name: "Egress window", appliesTo: ["basement"], priceType: "flat", amount: 6900, enabled: true },
        { id: "permits", name: "Permit handling", appliesTo: [], priceType: "percent", amount: 4, enabled: true },
      ],
      markupPct: 0,
      rangePct: 8,
      depositPct: 10,
      disclaimer: "Instant estimates are a planning range based on your selections. A final quote follows a site visit.",
      updatedAt: iso(9),
    },
    generations: [
      { id: "g1", at: iso(0), projectTypeId: "adu", projectType: "Detached ADU", size: 768, unit: "sqft", options: ["Second bathroom", "Covered porch", "Permit handling"], quoteLow: 302000, quoteHigh: 355000, contact: { name: "Dana Whitaker", email: "dana.w@example.com", phone: "(425) 555-0142", address: "Mill Creek, WA" }, status: "new", sourcePage: "/get-a-quote" },
      { id: "g2", at: iso(0), projectTypeId: "deck", projectType: "Deck", size: 432, unit: "sqft", options: ["Cedar pergola", "Composite decking upgrade"], quoteLow: 49000, quoteHigh: 58000, contact: null, status: "new", sourcePage: "/services/decks" },
      { id: "g3", at: iso(1), projectTypeId: "kitchen", projectType: "Kitchen remodel", size: 336, unit: "sqft", options: ["Island with seating", "Quartz counters"], quoteLow: 109000, quoteHigh: 128000, contact: { name: "Priya Okafor", email: "priya.o@example.com", phone: "(425) 555-0177", address: "Lake Stevens, WA" }, status: "contacted", sourcePage: "/get-a-quote" },
      { id: "g4", at: iso(2), projectTypeId: "basement", projectType: "Basement finish", size: 900, unit: "sqft", options: ["Egress window", "Permit handling"], quoteLow: 90000, quoteHigh: 106000, contact: { name: "Marcus Hale", email: "m.hale@example.com", phone: "(206) 555-0109", address: "Everett, WA" }, status: "quoted", sourcePage: "/get-a-quote" },
      { id: "g5", at: iso(3), projectTypeId: "garage-adu", projectType: "Garage conversion", size: 480, unit: "sqft", options: ["Second bathroom"], quoteLow: 125000, quoteHigh: 147000, contact: null, status: "new", sourcePage: "/services/adu-construction" },
      { id: "g6", at: iso(4), projectTypeId: "bath", projectType: "Bathroom remodel", size: 72, unit: "sqft", options: ["Quartz counters"], quoteLow: 29000, quoteHigh: 34000, contact: { name: "Lena Torres", email: "lena.t@example.com", phone: "(425) 555-0133" }, status: "won", sourcePage: "/get-a-quote", notes: "Signed 10/2. Start date Nov 3." },
      { id: "g7", at: iso(6), projectTypeId: "adu", projectType: "Detached ADU", size: 640, unit: "sqft", options: ["Solar-ready roof"], quoteLow: 236000, quoteHigh: 277000, contact: { name: "Sam Reyes", email: "sam.reyes@example.com", phone: "(360) 555-0188", address: "Marysville, WA" }, status: "lost", sourcePage: "/get-a-quote", notes: "Went with a cheaper bid." },
      { id: "g8", at: iso(8), projectTypeId: "kitchen", projectType: "Kitchen remodel", size: 280, unit: "sqft", options: [], quoteLow: 82000, quoteHigh: 96000, contact: null, status: "new", sourcePage: "/services/kitchen-remodeling" },
    ],
  },
  requests: [
    { id: "r1", type: "website", title: "Add the Hale deck photos to the projects page", body: "Shot them Saturday, uploading to the shared drive tonight.", status: "in_progress", createdAt: iso(2) },
    { id: "r2", type: "estimator", title: "Add \"Home addition\" to the quote tool", body: "We want to start quoting additions again this spring.", status: "open", createdAt: iso(3) },
    { id: "r3", type: "social", title: "Post about the spring ADU slots", body: "We have two openings for April starts.", status: "done", createdAt: iso(11) },
  ],
  activity: [
    { at: iso(0), area: "website", title: "New form lead: Detached ADU estimate — Mill Creek" },
    { at: iso(1), area: "social", title: "Whitaker ADU reel published — 6.8K reach in 24h" },
    { at: iso(2), area: "seo", title: "2 service-area pages published (Mill Creek, Marysville)" },
    { at: iso(0), area: "estimator", title: "New quote lead: Detached ADU, 768 sq ft — Dana Whitaker" },
    { at: iso(4), area: "website", title: "Monthly uptime report: 99.98%" },
    { at: iso(6), area: "seo", title: "'adu cost washington' entered top 12" },
    { at: iso(9), area: "seo", title: "12 citations corrected" },
    { at: iso(9), area: "estimator", title: "Quote tool pricing updated (ADU rate $385/sq ft)" },
  ],
};

// SEO Autopilot, as the demo client sees it: on for a few weeks, one post waiting for an OK.
const POST_ADU_COST = `Most detached ADUs in Everett land between $280,000 and $380,000 built, with the biggest swings coming from the foundation, utility runs and finish level. Here is where that money goes and what changes it.

## What's inside the number

- **Design and permits.** Everett's pre-approved ADU plans cut design time; a custom plan adds engineering. Permit and impact fees in Snohomish County vary with size, so we price them per project rather than quoting a flat figure.
- **Site work and foundation.** Sloped lots, poor drainage and long utility trenches are the usual surprises. A flat lot with services close to the house is the cheapest case.
- **The shell.** Framing, roofing, siding and windows. A simple gable roof costs less than a shed roof with clerestories, and both handle our rain fine when flashed properly.
- **Mechanical.** A heat pump with a mini-split head per room is the standard now. Electrical service is the item that most often forces a panel upgrade on older Everett homes.
- **Finishes.** Kitchen and bathroom choices move the total more than anything else after the foundation.

## Ways to keep it in range

1. Start with one of the city's pre-approved plans and adjust.
2. Keep the plumbing stacked on one wall.
3. Choose finishes early, before framing, so nothing gets re-ordered.

We build ADUs across Everett, Mill Creek and Lake Stevens, and we handle the permit set ourselves. Use our [instant quote tool](/get-a-quote) for a range on your lot, or see [what we've built](/projects).`;

const POST_PERMITS = `A kitchen remodel in unincorporated Snohomish County needs a building permit as soon as you touch plumbing, electrical, a load-bearing wall or the window and door openings. Cabinets, counters and flooring alone do not.

## Which permits apply

- **Building permit** for structural changes, new openings or moving walls.
- **Plumbing permit** for relocated sinks, dishwashers or gas lines.
- **Electrical permit** through Washington L&I, not the county, for new circuits.

## Timeline you can expect

Plan review for a kitchen runs two to four weeks when the drawings are complete. Inspections happen at rough-in and final; we schedule both so your contractor is not waiting on the county.

We pull every permit for the kitchens we build in [Lake Stevens](/service-areas/lake-stevens), [Mill Creek](/service-areas/mill-creek) and across the county. Ask us before you demo.`;

const POST_GARAGE = `If your Lake Stevens garage is already on a slab with a roof worth keeping, converting it is usually the lower-cost path to a rental or in-law suite. If it is detached, small or in rough shape, a new detached ADU often pays back better. Here is how we help homeowners decide.

## Garage conversion: what it costs and what you give up

A conversion keeps the shell and spends on insulation, a vapor barrier over the slab, windows, mechanical and a bathroom. You lose covered parking, which matters for resale on streets without driveways.

## Detached ADU: more money, more control

A new build lets you size the rooms, orient windows away from the neighbors and separate the utilities cleanly, which renters and appraisers both prefer. It costs more up front and takes longer because of the permit set.

## The questions that decide it

1. Is the garage slab level and dry in February?
2. Do you need the parking?
3. Will the unit be rented or used by family?

Either way, start with the city's ADU rules for your lot. We walk through both options on site and give you a number for each. See our [ADU construction](/services/adu-construction) page, or get a range from the [quote tool](/get-a-quote).`;

const DEMO_PLAN: PlanItem[] = [
  { id: "pl1", title: "What a Detached ADU Costs in Mill Creek, WA (2026)", targetQuery: "adu cost mill creek wa", angle: "Real Mill Creek permit fees and lot rules; the top results are statewide averages.", status: "planned" },
  { id: "pl2", title: "ADU Permits in Snohomish County: Steps and Timelines", targetQuery: "adu permit snohomish county", angle: "A week-by-week timeline from pre-application to final inspection.", status: "planned" },
  { id: "pl3", title: "Attached vs Detached ADU in Everett: Which Pays Off?", targetQuery: "attached vs detached adu everett", angle: "Resale and rental numbers for each, not just construction cost.", status: "planned" },
  { id: "pl4", title: "Kitchen Remodel Cost in Lake Stevens: What Drives It", targetQuery: "kitchen remodel cost lake stevens", angle: "Three real budget tiers with what each one buys.", status: "planned" },
  { id: "pl5", title: "Building an ADU on a Sloped Lot in Everett", targetQuery: "adu sloped lot everett", angle: "Foundation options and what they add; nobody local covers this.", status: "planned" },
  { id: "pl0", title: "Garage Conversion vs. Detached ADU in Lake Stevens: Which Pays Off?", targetQuery: "garage conversion lake stevens", angle: "", status: "written" },
];

export const demoAutopilot: Autopilot = {
  settings: { enabled: true, cadence: "weekly", mode: "auto", target: "hosted", wpConnected: false, notes: "Push ADU and garage conversions in Mill Creek and Lake Stevens. Don't mention roofing.", nextRunAt: iso(-3), lastRunAt: iso(1), plan: DEMO_PLAN, comped: true, subscription: null, package: null, site: { platform: "", access: null, loginOnFile: false, inviteSentAt: null }, access: true },
  posts: [
    { id: "sp1", createdAt: iso(1), title: "Garage Conversion vs. Detached ADU in Lake Stevens: Which Pays Off?", slug: "garage-conversion-vs-detached-adu-lake-stevens", targetQuery: "garage conversion lake stevens", metaDescription: "Comparing a garage conversion with a new detached ADU for Lake Stevens homeowners: costs, parking, permits and which one renters and appraisers prefer.", excerpt: "A garage conversion or a new detached ADU? How Lake Stevens homeowners decide.", bodyMd: POST_GARAGE, wordCount: 290, status: "awaiting_approval", publishedUrl: null, publishedAt: null, error: null, rationale: "'garage conversion lake stevens' shows up in Search Console at position 14 with no page about it, and your notes asked for more garage-conversion work in Lake Stevens.", quality: { score: 78, checks: [{ id: "title", label: "Title is 45–65 characters", ok: false, detail: "72 characters" }, { id: "meta", label: "Meta description is 130–160 characters", ok: true, detail: "152 characters" }, { id: "query_title", label: "Target search is in the title", ok: true, detail: "“garage conversion lake stevens”" }, { id: "query_intro", label: "Target search is in the opening", ok: true, detail: "within the first 150 words" }, { id: "length", label: "900–1,700 words", ok: true, detail: "1,210 words" }, { id: "headings", label: "At least 3 sections", ok: true, detail: "5 H2 headings" }, { id: "links", label: "Links to 2+ pages on the site", ok: false, detail: "1 internal link" }, { id: "links_valid", label: "Every internal link points to a real page", ok: true, detail: "checked against the site's pages" }, { id: "faq", label: "3–5 questions homeowners ask", ok: true, detail: "4 questions" }, { id: "area", label: "Area named in the title or meta", ok: false, detail: "“everett”" }] }, performance: null },
    { id: "sp2", createdAt: iso(8), title: "How Much Does a Detached ADU Cost in Everett, WA? (2026 Ranges)", slug: "detached-adu-cost-everett-wa", targetQuery: "adu cost everett wa", metaDescription: "What a detached ADU costs to build in Everett, WA in 2026: realistic ranges, what drives the price up or down, and three ways to keep it in budget.", excerpt: "Realistic 2026 ranges for a detached ADU in Everett and what moves the number.", bodyMd: POST_ADU_COST, wordCount: 310, status: "published", publishedUrl: "https://northlinebuilders.com/blog/detached-adu-cost-everett-wa", publishedAt: iso(7), error: null, rationale: "'adu cost everett wa' is the biggest money search in your area and the site had no page answering it directly.", quality: { score: 100, checks: [{ id: "title", label: "Title is 45–65 characters", ok: true, detail: "58 characters" }, { id: "meta", label: "Meta description is 130–160 characters", ok: true, detail: "149 characters" }, { id: "query_title", label: "Target search is in the title", ok: true, detail: "“adu cost everett wa”" }, { id: "query_intro", label: "Target search is in the opening", ok: true, detail: "within the first 150 words" }, { id: "length", label: "900–1,700 words", ok: true, detail: "1,340 words" }, { id: "headings", label: "At least 3 sections", ok: true, detail: "6 H2 headings" }, { id: "links", label: "Links to 2+ pages on the site", ok: true, detail: "4 internal links" }, { id: "links_valid", label: "Every internal link points to a real page", ok: true, detail: "checked against the site's pages" }, { id: "faq", label: "3–5 questions homeowners ask", ok: true, detail: "4 questions" }, { id: "area", label: "Area named in the title or meta", ok: true, detail: "“everett”" }] }, performance: { clicks: 38, impressions: 1120, position: 7.8, keywords: 6 } },
    { id: "sp3", createdAt: iso(15), title: "Kitchen Remodel Permits in Snohomish County: What You Actually Need", slug: "kitchen-remodel-permits-snohomish-county", targetQuery: "kitchen remodel permit snohomish county", metaDescription: "Which permits a kitchen remodel needs in Snohomish County, which it doesn't, how long plan review takes and who pulls them when Northline builds your kitchen.", excerpt: "The permits a Snohomish County kitchen remodel needs, and the ones it doesn't.", bodyMd: POST_PERMITS, wordCount: 240, status: "published", publishedUrl: "https://northlinebuilders.com/blog/kitchen-remodel-permits-snohomish-county", publishedAt: iso(14), error: null, rationale: "", quality: null, performance: null },
    { id: "sp4", createdAt: iso(22), title: "Basement Finishing Costs in Mill Creek: A Room-by-Room Guide", slug: "basement-finishing-costs-mill-creek", targetQuery: "basement finishing mill creek", metaDescription: "Room-by-room basement finishing costs for Mill Creek homes, including egress windows, moisture control and what a permit-ready plan looks like.", excerpt: "What finishing a Mill Creek basement costs, room by room.", bodyMd: POST_PERMITS, wordCount: 230, status: "skipped", publishedUrl: null, publishedAt: null, error: null, rationale: "", quality: null, performance: null },
  ],
  runs: [
    { id: "sr1", ranAt: iso(1), ok: true, summary: 'Wrote "Garage Conversion vs. Detached ADU in Lake Stevens: Which Pays Off?" for "garage conversion lake stevens" · 4 fixes suggested', postId: "sp1", fixes: [
      { title: "Add a Lake Stevens FAQ block", where: "/service-areas/lake-stevens", why: "The page ranks #6 for 'home remodeling contractor lake stevens' with no question-style content; the top three results all answer cost and timeline questions.", how: "Add three Q&As (typical remodel cost, permit timeline, who pulls permits) with FAQ schema under the project photos.", impact: "high" },
      { title: "Fix the ADU page title tag", where: "/services/adu-construction", why: "The title is 'ADU Construction | Northline' and does not name a city; the query 'adu builder everett' is at #2 and 'detached adu snohomish county' at #5.", how: "Change the title to 'Detached ADU Builder in Everett & Snohomish County | Northline Builders' (62 characters).", impact: "high" },
      { title: "Link the cost guide from the ADU page", where: "/services/adu-construction", why: "'adu cost washington' sits at #12 on the guide; an internal link from the service page passes authority to it.", how: "Add a sentence under the intro: 'See what an ADU costs in 2026' linking to /guides/adu-cost.", impact: "medium" },
      { title: "Compress the hero image", where: "/", why: "The nightly check flags LCP at 2.9s on mobile, mostly the 1.8 MB hero.", how: "Export the hero as WebP at 1600px wide, under 250 KB, and keep the same alt text.", impact: "medium" },
    ] },
    { id: "sr2", ranAt: iso(8), ok: true, summary: 'Wrote "How Much Does a Detached ADU Cost in Everett, WA? (2026 Ranges)" for "adu cost everett wa" · 3 fixes suggested', postId: "sp2", fixes: [
      { title: "Add alt text to project photos", where: "/projects", why: "9 of 24 images have no alt text; the health check marks it a fail and Google can't connect the photos to 'adu' or the city.", how: "Describe each photo with the project type and city, e.g. 'Detached ADU exterior, Mill Creek WA'.", impact: "medium", done: true },
      { title: "Name the city in the homepage H1", where: "/", why: "The H1 is 'Built to last.'; 'general contractor everett wa' is at #3 and the H1 is the strongest on-page signal left to use.", how: "Change the H1 to 'Everett's general contractor for remodels and ADUs' and keep the tagline as a subhead.", impact: "high" },
      { title: "Add a Marysville service-area link in the nav", where: "site-wide", why: "/service-areas/marysville is only reachable from the footer; it was published 9 days ago and has no internal links from above the fold.", how: "Add it to the Service areas dropdown in the header.", impact: "low", done: true },
    ] },
    { id: "sr3", ranAt: iso(15), ok: true, summary: 'Wrote "Kitchen Remodel Permits in Snohomish County: What You Actually Need" for "kitchen remodel permit snohomish county" · 2 fixes suggested', postId: "sp3", fixes: [
      { title: "Add LocalBusiness schema", where: "site-wide", why: "No structured data on the site; competitors in the map pack have it.", how: "Add LocalBusiness JSON-LD with the Everett address, phone, hours and service areas to the layout.", impact: "medium" },
      { title: "Shorten the contact page meta description", where: "/contact", why: "It is 212 characters and gets cut off in results.", how: "Rewrite it to under 155 characters, ending with the phone number.", impact: "low" },
    ] },
  ],
};

export const demoStudioAutopilot: StudioAutopilotRow[] = [
  { slug: "northline-builders", name: "Northline Builders", website: "https://northlinebuilders.com", settings: demoAutopilot.settings, publishing: { ready: true, note: "GitHub · unifictional/northline-builders" }, awaiting: 1, published: 2, upcoming: 5, fixesDone: 2, fixesTotal: 9, siteLogin: null, lastRun: { at: iso(1), ok: true, summary: demoAutopilot.runs[0].summary } },
  { slug: "cascade-poolworks", name: "Cascade Poolworks", website: "https://cascadepoolworks.com", settings: { enabled: false, cadence: "weekly", mode: "approve", target: "hosted", wpConnected: false, notes: "", nextRunAt: null, lastRunAt: null, plan: [], comped: false, subscription: null, package: null, site: { platform: "", access: null, loginOnFile: false, inviteSentAt: null }, access: false }, publishing: { ready: false, note: "Add the repo or revalidate URL on Data connections" }, awaiting: 0, published: 0, upcoming: 0, fixesDone: 0, fixesTotal: 0, siteLogin: null, lastRun: null },
];
