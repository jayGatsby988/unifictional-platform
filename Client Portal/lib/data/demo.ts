import type { PortalData, SeoDay, DayPoint } from "./types";

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
