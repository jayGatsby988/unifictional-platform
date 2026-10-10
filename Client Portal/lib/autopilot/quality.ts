import type { PostQuality, QualityCheck } from "../data/types";

/**
 * The SEO checklist the studio would run by hand, as code, so every post ships
 * with a score and the writer gets one revision pass at anything it missed.
 * Deterministic and dependency-free: the same post always scores the same.
 */

const STOP = new Set(["a", "an", "the", "in", "of", "for", "to", "and", "or", "on", "at", "with", "near", "me", "wa", "is", "how", "what", "does", "do", "your", "my", "vs", "it"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
const countWords = (md: string) => md.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#*_`>]+/g, " ").split(/\s+/).filter(Boolean).length;

export type QualityInput = { title: string; metaDescription: string; bodyMd: string; targetQuery: string; area: string; faqCount: number };

export function scorePost(p: QualityInput, knownPaths: string[] = []): PostQuality {
  const checks: (QualityCheck & { weight: number })[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string, weight: number) => checks.push({ id, label, ok, detail, weight });

  const tl = p.title.trim().length;
  add("title", "Title is 45–65 characters", tl >= 45 && tl <= 65, `${tl} characters`, 10);
  const ml = p.metaDescription.trim().length;
  add("meta", "Meta description is 130–160 characters", ml >= 130 && ml <= 160, `${ml} characters`, 10);

  const q = words(p.targetQuery);
  const share = (text: string) => { const w = new Set(words(text)); return q.length ? q.filter((x) => w.has(x)).length / q.length : 1; };
  add("query_title", "Target search is in the title", share(p.title) >= 0.6, `“${p.targetQuery}”`, 10);
  add("query_intro", "Target search is in the opening", share(p.bodyMd.split(/\s+/).slice(0, 150).join(" ")) >= 0.6, "within the first 150 words", 10);

  const wc = countWords(p.bodyMd);
  add("length", "900–1,700 words", wc >= 900 && wc <= 1700, `${wc} words`, 15);
  const h2 = (p.bodyMd.match(/^##\s/gm) ?? []).length;
  add("headings", "At least 3 sections", h2 >= 3, `${h2} H2 headings`, 10);

  const links = [...new Set([...p.bodyMd.matchAll(/\]\((\/[^)\s#?]*)[^)]*\)/g)].map((m) => m[1].replace(/\/+$/, "") || "/"))];
  add("links", "Links to 2+ pages on the site", links.length >= 2, `${links.length} internal links`, 10);
  const known = new Set(knownPaths.map((x) => x.replace(/\/+$/, "") || "/"));
  const truncated = knownPaths.length >= 60;
  const unknown = known.size && !truncated ? links.filter((l) => !known.has(l)) : [];
  add("links_valid", "Every internal link points to a real page", unknown.length === 0,
    unknown.length ? `not found: ${unknown.slice(0, 3).join(", ")}` : known.size ? (truncated ? "large site, not checked" : "checked against the site's pages") : "site pages unknown, not checked", 10);

  add("faq", "3–5 questions homeowners ask", p.faqCount >= 3 && p.faqCount <= 5, `${p.faqCount} questions`, 10);
  const areaWord = words(p.area)[0];
  add("area", "Area named in the title or meta", !areaWord || new Set(words(`${p.title} ${p.metaDescription}`)).has(areaWord), areaWord ? `“${areaWord}”` : "no area on file", 5);

  const total = checks.reduce((a, c) => a + c.weight, 0);
  const got = checks.filter((c) => c.ok).reduce((a, c) => a + c.weight, 0);
  return { score: Math.round((got / total) * 100), checks: checks.map((c) => ({ id: c.id, label: c.label, ok: c.ok, detail: c.detail })) };
}

/** The failed checks as sentences the writer can act on. */
export function failedChecks(q: PostQuality): string[] {
  return q.checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.detail})`);
}
