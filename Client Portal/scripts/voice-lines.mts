import { DEMOS } from "../lib/walkthroughs";
export function spoken(s: string) {
  return s
    .replace(/unifictional@gmail\.com/g, "unifictional at gmail dot com")
    .replace(/dana@northlinebuilders\.com/g, "dana at northline builders dot com")
    .replace(/search\.google\.com\/search-console/g, "search dot google dot com, slash search console")
    .replace(/analytics\.google\.com/g, "analytics dot google dot com")
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ").trim();
}
const out: { slug: string; i: number; text: string }[] = [];
for (const [slug, d] of Object.entries(DEMOS)) d.steps.forEach((s, i) => out.push({ slug, i, text: spoken(s.say ?? s.caption) }));
console.log(JSON.stringify(out));
