import { safeFetch } from "@/lib/safe-fetch";

/**
 * SEO deep-dive for the free inspection: infer the trade and city from the
 * page, test whether the domain shows up on page one for the local searches a
 * homeowner types, and list the on-page reasons it doesn't.
 */

export type RankCheck = { query: string; position: number | null; checked: boolean };
export type SeoIssue = { label: string; detail: string; severity: "fail" | "warn" };
export type SeoReport = {
  provider: SearchProvider | null;
  domain: string;
  trade: string;
  city: string | null;
  inferred: boolean;
  rankings: RankCheck[];
  rankingsChecked: boolean;
  pageOneCount: number;
  issues: SeoIssue[];
  score: number;              // 0–100
  verdict: string;
  facts: { titleLength: number; descriptionLength: number; sitemapPages: number | null; robots: boolean; servicePages: number; altMissingPct: number; hasAddress: boolean; hasMapsLink: boolean };
};

const TRADES: { key: string; label: string; patterns: RegExp; queries: (city: string) => string[] }[] = [
  { key: "adu", label: "ADU builder", patterns: /\b(adu|accessory dwelling|dadu|backyard cottage|garage conversion)\b/i, queries: (c) => [`adu builder ${c}`, `adu contractor ${c}`, `backyard cottage builder ${c}`, `detached adu ${c}`, `garage conversion ${c}`] },
  { key: "remodel", label: "remodeling contractor", patterns: /\b(remodel|renovat|kitchen|bathroom|bath remodel)\w*/i, queries: (c) => [`remodeling contractor ${c}`, `kitchen remodel ${c}`, `bathroom remodel ${c}`, `home remodeling ${c}`, `best remodeler ${c}`] },
  { key: "roofing", label: "roofing contractor", patterns: /\b(roof|roofing|roofer)\w*/i, queries: (c) => [`roofing contractor ${c}`, `roofer ${c}`, `roof replacement ${c}`, `roof repair ${c}`, `best roofing company ${c}`] },
  { key: "siding", label: "siding contractor", patterns: /\b(siding|exteriors?)\b/i, queries: (c) => [`siding contractor ${c}`, `siding replacement ${c}`, `james hardie siding ${c}`, `exterior contractor ${c}`, `siding company ${c}`] },
  { key: "pool", label: "pool builder", patterns: /\b(pool|pools|spa|hot tub)\b/i, queries: (c) => [`pool builder ${c}`, `pool contractor ${c}`, `inground pool ${c}`, `custom pool ${c}`, `pool construction ${c}`] },
  { key: "excavation", label: "excavation contractor", patterns: /\b(excavat|grading|site prep|land clearing|septic)\w*/i, queries: (c) => [`excavation contractor ${c}`, `excavation company ${c}`, `land clearing ${c}`, `site prep ${c}`, `grading contractor ${c}`] },
  { key: "concrete", label: "concrete contractor", patterns: /\b(concrete|foundation|flatwork|driveway)\w*/i, queries: (c) => [`concrete contractor ${c}`, `concrete driveway ${c}`, `foundation contractor ${c}`, `concrete patio ${c}`, `concrete company ${c}`] },
  { key: "landscape", label: "landscaping company", patterns: /\b(landscap|hardscap|paver|retaining wall|lawn)\w*/i, queries: (c) => [`landscaping company ${c}`, `landscaper ${c}`, `hardscape contractor ${c}`, `retaining wall contractor ${c}`, `landscape design ${c}`] },
  { key: "deck", label: "deck builder", patterns: /\b(deck|decks|pergola|patio cover)\b/i, queries: (c) => [`deck builder ${c}`, `deck contractor ${c}`, `composite deck ${c}`, `deck installation ${c}`, `pergola builder ${c}`] },
  { key: "painting", label: "painting contractor", patterns: /\b(paint|painter|painting)\w*/i, queries: (c) => [`painting contractor ${c}`, `house painter ${c}`, `exterior painting ${c}`, `interior painters ${c}`, `painting company ${c}`] },
  { key: "plumbing", label: "plumber", patterns: /\b(plumb)\w*/i, queries: (c) => [`plumber ${c}`, `plumbing company ${c}`, `emergency plumber ${c}`, `water heater installation ${c}`, `drain cleaning ${c}`] },
  { key: "electric", label: "electrician", patterns: /\b(electric)\w*/i, queries: (c) => [`electrician ${c}`, `electrical contractor ${c}`, `panel upgrade ${c}`, `ev charger installation ${c}`, `electrical company ${c}`] },
  { key: "hvac", label: "HVAC contractor", patterns: /\b(hvac|heating|furnace|heat pump|air conditioning)\b/i, queries: (c) => [`hvac ${c}`, `heat pump installation ${c}`, `furnace repair ${c}`, `air conditioning installation ${c}`, `hvac contractor ${c}`] },
  { key: "builder", label: "custom home builder", patterns: /\b(custom home|home builder|new construction|build(er)?s?)\b/i, queries: (c) => [`custom home builder ${c}`, `home builder ${c}`, `new construction ${c}`, `custom homes ${c}`, `best home builder ${c}`] },
  { key: "gc", label: "general contractor", patterns: /\b(general contractor|contractor|construction)\b/i, queries: (c) => [`general contractor ${c}`, `contractor ${c}`, `construction company ${c}`, `home addition contractor ${c}`, `licensed contractor ${c}`] },
];

const CITIES = ["Everett", "Seattle", "Bellevue", "Tacoma", "Lynnwood", "Marysville", "Mill Creek", "Bothell", "Kirkland", "Redmond", "Lake Stevens", "Snohomish", "Mukilteo", "Edmonds", "Shoreline", "Arlington", "Monroe", "Issaquah", "Sammamish", "Renton", "Kent", "Federal Way", "Auburn", "Puyallup", "Olympia", "Bellingham", "Spokane", "Vancouver", "Woodinville", "Mountlake Terrace", "Stanwood", "Camano Island", "Whidbey Island", "Mercer Island", "Burien", "Lacey", "Portland", "Boise", "Denver", "Phoenix", "Austin", "Dallas", "Houston", "San Diego", "Los Angeles", "Sacramento", "Las Vegas", "Salt Lake City"];

/** `matched` is false when no trade pattern hit at all and "general contractor" is only the fallback: the site is probably not a contractor. */
export function inferTradeAndCity(title: string | null, text: string): { trade: (typeof TRADES)[number]; city: string | null; inferred: boolean; matched: boolean } {
  const head = `${title ?? ""} ${text.slice(0, 1500)}`;
  const hit = TRADES.find((t) => t.patterns.test(title ?? "")) ?? TRADES.find((t) => t.patterns.test(head)) ?? null;
  const matched = Boolean(hit);
  let trade = hit ?? TRADES[TRADES.length - 1];
  // "contractor" matches almost everything; prefer a more specific trade from the body when the title is generic.
  if (trade.key === "gc" || trade.key === "builder") {
    const specific = TRADES.slice(0, 13).find((t) => (text.match(t.patterns) ?? []).length > 0 && (text.match(new RegExp(t.patterns.source, "gi")) ?? []).length >= 3);
    if (specific) trade = specific;
  }
  const inHead = CITIES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(head));
  const inBody = inHead ?? CITIES.map((c) => ({ c, n: (text.match(new RegExp(`\\b${c}\\b`, "gi")) ?? []).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0]?.c ?? null;
  const stateMatch = text.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?),\s*(WA|OR|CA|ID|TX|AZ|CO|NV|UT|FL|NY|NJ|PA|IL|GA|NC|SC|VA|MA|MI|OH|MN|WI|TN|MO|IN|KY|AL|LA|OK|KS|NE|IA|AR|MS|MD|CT|RI|NH|VT|ME|DE|WV|NM|MT|WY|ND|SD|AK|HI)\b/);
  const city = inBody ?? (stateMatch ? stateMatch[1] : null);
  return { trade, city, inferred: !inHead, matched };
}

export function cityWithState(city: string | null, text: string): string | null {
  if (!city) return null;
  const m = text.match(new RegExp(`${city},?\\s*(WA|OR|CA|ID|TX|AZ|CO|NV|UT|FL)\\b`, "i"));
  return m ? `${city} ${m[1].toUpperCase()}` : city;
}

/** Parse DuckDuckGo's HTML results into ordered result hostnames. */
export function parseDdgHosts(html: string): string[] {
  const hosts: string[] = [];
  for (const m of html.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)) {
    let href = m[1].replace(/&amp;/g, "&");
    const udd = href.match(/[?&]uddg=([^&]+)/);
    if (udd) href = decodeURIComponent(udd[1]);
    try { hosts.push(new URL(href).hostname.replace(/^www\./, "")); } catch { /* skip */ }
  }
  return hosts;
}

export function positionOf(hosts: string[], domain: string): number | null {
  const d = domain.replace(/^www\./, "");
  const i = hosts.findIndex((h) => h === d || h.endsWith(`.${d}`));
  return i === -1 ? null : i + 1;
}

async function ddg(query: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", Accept: "text/html" },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const hosts = parseDdgHosts(await res.text());
    return hosts.length ? hosts : null;
  } catch {
    return null;
  }
}

/** Google Programmable Search (Custom Search JSON API): real Google results, 100 free queries/day. */
async function googleCse(query: string): Promise<string[] | null> {
  const key = process.env.GOOGLE_CSE_KEY, cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) return null;
  try {
    const res = await fetch(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&num=10&gl=us&q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { items?: { link: string }[] };
    const hosts = (j.items ?? []).map((i) => { try { return new URL(i.link).hostname.replace(/^www\./, ""); } catch { return ""; } }).filter(Boolean);
    return hosts.length ? hosts : null;
  } catch { return null; }
}

/** Brave Search API: independent index, free tier. */
async function brave(query: string): Promise<string[] | null> {
  const key = process.env.BRAVE_SEARCH_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?count=10&country=us&q=${encodeURIComponent(query)}`, { headers: { "X-Subscription-Token": key, Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { web?: { results?: { url: string }[] } };
    const hosts = (j.web?.results ?? []).map((r) => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; } }).filter(Boolean);
    return hosts.length ? hosts : null;
  } catch { return null; }
}

export type SearchProvider = "google" | "brave" | "duckduckgo";
export function searchProvider(): SearchProvider | null {
  if (process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX) return "google";
  if (process.env.BRAVE_SEARCH_KEY) return "brave";
  return process.env.VERCEL ? null : "duckduckgo"; // DDG blocks datacenter traffic; only useful locally
}

export async function checkRankings(domain: string, queries: string[]): Promise<RankCheck[]> {
  const provider = searchProvider();
  if (!provider) return queries.map((query) => ({ query, position: null, checked: false }));
  const search = provider === "google" ? googleCse : provider === "brave" ? brave : ddg;
  return Promise.all(queries.map(async (query) => {
    const hosts = await search(query);
    if (!hosts) return { query, position: null, checked: false };
    return { query, position: positionOf(hosts.slice(0, 10), domain), checked: true };
  }));
}

export async function fetchSitemapCount(origin: string): Promise<number | null> {
  try {
    const res = await safeFetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const xml = await res.text();
    const locs = (xml.match(/<loc>/g) ?? []).length;
    return locs;
  } catch { return null; }
}

export async function fetchRobots(origin: string): Promise<boolean> {
  try {
    const res = await safeFetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(6000) });
    return res.ok && /user-agent/i.test(await res.text());
  } catch { return false; }
}

export function onPageSeo(html: string, title: string | null, description: string | null, trade: string, city: string | null) {
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const altMissing = imgs.filter((t) => !/\salt=["'][^"']+["']/i.test(t)).length;
  const altMissingPct = imgs.length ? Math.round((altMissing / imgs.length) * 100) : 0;
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/gi)].map((m) => m[1]);
  const servicePages = new Set(links.filter((h) => /\/(services?|what-we-do|remodel|adu|roof|siding|kitchen|bath|deck|pool|concrete|landscap|excavat|paint|plumb|electric|hvac)/i.test(h))).size;
  const hasAddress = /\b\d{2,5}\s+[A-Za-z0-9.\s]{2,40}(street|st|avenue|ave|road|rd|way|blvd|boulevard|drive|dr|lane|ln|court|ct|pl|place|highway|hwy)\b/i.test(html) || /\b[A-Z]{2}\s+\d{5}\b/.test(html);
  const hasMapsLink = /(google\.com\/maps|g\.page\/|maps\.app\.goo\.gl|business\.google\.com)/i.test(html);
  const tradeWord = trade.split(" ")[0];
  const titleHasTrade = title ? new RegExp(tradeWord.slice(0, 5), "i").test(title) : false;
  const titleHasCity = title && city ? new RegExp(city.split(" ")[0], "i").test(title) : false;
  return { titleLength: (title ?? "").length, descriptionLength: (description ?? "").length, servicePages, altMissingPct, hasAddress, hasMapsLink, titleHasTrade, titleHasCity };
}

export function buildSeoReport(input: {
  domain: string; html: string; text: string; title: string | null; description: string | null; wordCount: number;
  rankings: RankCheck[]; sitemapPages: number | null; robots: boolean;
}): SeoReport {
  const { trade, city, inferred } = inferTradeAndCity(input.title, input.text);
  const cityLabel = cityWithState(city, input.text);
  const on = onPageSeo(input.html, input.title, input.description, trade.label, city);
  const checked = input.rankings.filter((r) => r.checked);
  const pageOne = checked.filter((r) => r.position !== null && r.position <= 10).length;
  const issues: SeoIssue[] = [];

  if (checked.length && pageOne === 0) issues.push({ severity: "fail", label: `Not on page one for any of the ${checked.length} searches we tested`, detail: `Homeowners searching “${checked[0].query}” find your competitors, not you.` });
  else if (checked.length && pageOne < checked.length) issues.push({ severity: "warn", label: `On page one for ${pageOne} of ${checked.length} local searches`, detail: `Missing: ${checked.filter((r) => r.position === null || r.position > 10).map((r) => `“${r.query}”`).join(", ")}.` });
  if (!on.titleHasTrade || !on.titleHasCity) issues.push({ severity: on.titleHasTrade ? "warn" : "fail", label: "Page title doesn't say what you do and where", detail: `Google reads the title first. It should read like “${trade.label.replace(/^\w/, (c) => c.toUpperCase())} in ${cityLabel ?? "your city"} | Your Company”, not “${(input.title ?? "Home").slice(0, 60)}”.` });
  if (on.titleLength > 65) issues.push({ severity: "warn", label: "Page title is too long", detail: `${on.titleLength} characters; Google cuts it off around 60.` });
  if (on.descriptionLength === 0) issues.push({ severity: "fail", label: "No meta description", detail: "Google writes its own snippet for you, usually the footer or a menu." });
  else if (on.descriptionLength < 70 || on.descriptionLength > 165) issues.push({ severity: "warn", label: "Meta description is the wrong length", detail: `${on.descriptionLength} characters; aim for 120–160 with the trade, the city and a reason to click.` });
  if (!city) issues.push({ severity: "fail", label: "No city or service area on the page", detail: "Google can't rank you for local searches if the page never says where you work." });
  if (on.servicePages < 3) issues.push({ severity: on.servicePages === 0 ? "fail" : "warn", label: on.servicePages === 0 ? "No dedicated service pages" : `Only ${on.servicePages} service page${on.servicePages === 1 ? "" : "s"} linked`, detail: "Each service you sell needs its own page to rank for it. One page can't rank for everything." });
  if (input.sitemapPages !== null && input.sitemapPages < 8) issues.push({ severity: "warn", label: `Thin site: ${input.sitemapPages} page${input.sitemapPages === 1 ? "" : "s"} in the sitemap`, detail: "Ranking sites in this trade typically have 20–60 pages: services, service areas, projects, guides." });
  if (input.sitemapPages === null) issues.push({ severity: "warn", label: "No sitemap.xml", detail: "A sitemap tells Google which pages exist. Without it, new pages can take weeks to be found." });
  if (!input.robots) issues.push({ severity: "warn", label: "No robots.txt", detail: "Minor, but it's the first file Google asks for." });
  if (input.wordCount < 300) issues.push({ severity: "fail", label: `Only ${input.wordCount} words on the homepage`, detail: "There isn't enough text for Google to understand what you do." });
  if (on.altMissingPct > 40) issues.push({ severity: "warn", label: `${on.altMissingPct}% of images have no alt text`, detail: "Project photos are invisible to Google without it, and Google Images is a real source of remodel leads." });
  if (!on.hasAddress) issues.push({ severity: "warn", label: "No business address on the page", detail: "Local rankings lean on a consistent name, address and phone across the site and Google Business Profile." });
  if (!on.hasMapsLink) issues.push({ severity: "warn", label: "No link to your Google Business Profile", detail: "Linking the site and the listing both ways strengthens the map-pack ranking." });

  const fails = issues.filter((i) => i.severity === "fail").length, warns = issues.filter((i) => i.severity === "warn").length;
  const rankPart = checked.length ? (pageOne / checked.length) * 50 : 25;
  const issuePart = Math.max(0, 50 - fails * 12 - warns * 5);
  const score = Math.round(rankPart + issuePart);
  const verdict = checked.length
    ? pageOne === 0 ? `Invisible on Google for ${trade.label} searches${cityLabel ? ` in ${cityLabel}` : ""}.`
      : pageOne < checked.length ? `Found for ${pageOne} of ${checked.length} searches. The rest go to competitors.` : "Showing up for the searches that matter. Protect it."
    : fails >= 2 ? "Your SEO foundation has holes a competitor can drive through." : fails === 1 ? "One serious SEO problem is holding the site back." : "The SEO basics are in place. Growth now comes from content and reviews.";

  return {
    provider: searchProvider(), domain: input.domain, trade: trade.label, city: cityLabel, inferred, rankings: input.rankings, rankingsChecked: checked.length > 0, pageOneCount: pageOne, issues, score, verdict,
    facts: { titleLength: on.titleLength, descriptionLength: on.descriptionLength, sitemapPages: input.sitemapPages, robots: input.robots, servicePages: on.servicePages, altMissingPct: on.altMissingPct, hasAddress: on.hasAddress, hasMapsLink: on.hasMapsLink },
  };
}

export function queriesFor(title: string | null, text: string): string[] {
  const { trade, city } = inferTradeAndCity(title, text);
  const c = cityWithState(city, text) ?? city ?? "near me";
  return trade.queries(c.toLowerCase());
}
