/**
 * Keyword research without a paid API. Google's autocomplete endpoint returns
 * the searches people actually type for a seed phrase; a dozen seeds built from
 * the trade, the area and the services give the writer a realistic menu of
 * searches instead of guesses.
 */

const ENDPOINT = "https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=";
const UA = "Mozilla/5.0 (compatible; UnifictionalAutopilot/1.0)";

/** The endpoint answers `[seed, [suggestions...], ...]`. */
export function parseSuggest(body: string): string[] {
  try {
    const j = JSON.parse(body) as unknown;
    const list = Array.isArray(j) ? (j as unknown[])[1] : null;
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === "string").map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** "adu builder" + "Everett, WA" + services → the phrases a homeowner would start typing. */
export function seedQueries(trade: string, area: string, services: string[] = []): string[] {
  const t = trade.trim().toLowerCase();
  const a = area.trim().toLowerCase().replace(/,\s*[a-z]{2}$/, "");
  const core = t.replace(/\s+(builder|contractor|company|contractors)$/, "");
  const seeds = t ? [`${t} ${a}`, `${core} cost ${a}`, `how much does ${core} cost`, `${t} near me`, `best ${t} ${a}`, `${core} permit ${a}`] : [];
  for (const s of services.slice(0, 3)) {
    const v = s.trim().toLowerCase();
    if (v) seeds.push(`${v} ${a}`, `${v} cost`);
  }
  return [...new Set(seeds.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

/** Best effort and parallel: a blocked or slow endpoint just means fewer suggestions. */
export async function fetchSuggestions(seeds: string[], max = 30): Promise<string[]> {
  const out = new Set<string>();
  await Promise.all(seeds.map(async (seed) => {
    try {
      const res = await fetch(ENDPOINT + encodeURIComponent(seed), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(4_000) });
      if (!res.ok) return;
      for (const s of parseSuggest(await res.text())) out.add(s);
    } catch { /* best effort */ }
  }));
  return [...out].slice(0, max);
}
