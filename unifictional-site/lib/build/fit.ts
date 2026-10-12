// @ts-nocheck
// Effects in the right place. A designer picks a pack effect because the
// content asks for it; this table says which effect fits which content, and
// the gate rejects a plan that puts an effect where it does not belong (a
// photo wall with one photo, a counting stat with no number, a blinds story
// with nothing to tell). The planner is given the table in words.
import { byType } from "./components";

export type Role = "story" | "work" | "numbers" | "proof" | "services" | "process" | "cities" | "team" | "statement" | "faq" | "ask" | "contact" | "intro" | "brand";

/** What each pack effect is for, in the planner's language, and what it needs. */
export const FIT: Record<string, { roles: Role[]; needs: string; photos?: number; items?: number }> = {
  "story-blinds": { roles: ["story"], needs: "a three-part story (a project, a before-and-after, a day on site) with one strong photo per part", photos: 2 },
  "story-wipe": { roles: ["story"], needs: "a two-to-four-part story with a photo per part", photos: 2 },
  "wave-story": { roles: ["story"], needs: "a short narrative in steps, each with a photo", photos: 2 },
  "projects-wedge": { roles: ["work"], needs: "four to eight real project photos with titles", photos: 4 },
  "photo-wall": { roles: ["work"], needs: "six or more real photos", photos: 6 },
  "tiles-reveal": { roles: ["work", "story"], needs: "four to nine real photos with captions", photos: 4 },
  "wave-column": { roles: ["work"], needs: "five or more real photos", photos: 5 },
  "gallery": { roles: ["work"], needs: "three or more real photos", photos: 3 },
  "gallery-bend": { roles: ["work"], needs: "five or more real photos", photos: 5 },
  "gallery-pixel-wipe": { roles: ["work"], needs: "four or more real photos", photos: 4 },
  "gallery-edge-blur": { roles: ["work"], needs: "four or more real photos", photos: 4 },
  "gallery-collapse-4": { roles: ["work"], needs: "four or more real photos", photos: 4 },
  "pile": { roles: ["work"], needs: "five or more real photos", photos: 5 },
  "one-image": { roles: ["story", "work", "brand"], needs: "one hero-grade photo and a sentence", photos: 1 },
  "fold-planes": { roles: ["work", "story"], needs: "three to five photos", photos: 3 },
  "snap-panels": { roles: ["story", "services"], needs: "three to five panels each with a photo", photos: 3 },
  "strip-horizontal": { roles: ["work"], needs: "five or more photos", photos: 5 },
  "wall-stages": { roles: ["process", "story"], needs: "three to five stages with a photo each", photos: 3 },
  "portfolio-morph": { roles: ["work"], needs: "four or more project photos", photos: 4 },
  "cards-flip": { roles: ["services", "work"], needs: "four to eight cards with a photo each", photos: 4, items: 4 },
  "film-strip-15": { roles: ["work"], needs: "six or more photos", photos: 6 },
  "strip-preview-1": { roles: ["work", "services"], needs: "four or more items with photos", photos: 4 },
  "grid-zoom-16": { roles: ["work"], needs: "six or more photos", photos: 6 },
  "panels-curtain-24": { roles: ["story", "work"], needs: "three to five photos", photos: 3 },
  "ribbon-steps-33": { roles: ["process"], needs: "four to seven numbered steps", items: 4 },
  "pixel-steps-57": { roles: ["process"], needs: "three to six steps", items: 3 },
  "step-carousel-11": { roles: ["process", "services"], needs: "four or more steps or items", items: 4 },
  "wave-index-31": { roles: ["services", "work"], needs: "five or more items", items: 5 },
  "hover-list": { roles: ["services", "team", "cities"], needs: "four or more items with a photo each", items: 4, photos: 3 },
  "cards-letters": { roles: ["services", "team"], needs: "three to six cards", items: 3 },
  "card-stack": { roles: ["services", "proof"], needs: "three to six cards", items: 3 },
  "stack-flip-38": { roles: ["services", "proof"], needs: "three to six cards with photos", items: 3, photos: 2 },
  "fan-flip-44": { roles: ["work", "services"], needs: "four or more cards with photos", items: 4, photos: 4 },
  "tags-merge": { roles: ["services", "cities"], needs: "six or more short labels that resolve into one line", items: 6 },
  "marquee": { roles: ["cities", "brand"], needs: "a list of short words (cities, materials, brands)", items: 4 },
  "loop-wordmark-20": { roles: ["brand"], needs: "the company name only" },
  "brand-moment": { roles: ["brand"], needs: "the company name and one line" },
  "statement": { roles: ["statement"], needs: "one claim of 8 to 20 words with an eyebrow" },
  "statement-wave": { roles: ["statement"], needs: "one claim of 8 to 20 words" },
  "sentence": { roles: ["statement"], needs: "one sentence that earns a slow reveal" },
  "headline-echo": { roles: ["statement"], needs: "one short headline" },
  "headline-streak": { roles: ["statement"], needs: "one short headline" },
  "curve-text": { roles: ["statement", "brand"], needs: "one short line" },
  "falling-words": { roles: ["statement", "cities"], needs: "six to twelve short words" },
  "repel-text": { roles: ["statement"], needs: "one short headline" },
  "xray-reveal": { roles: ["statement", "story"], needs: "one headline, one short paragraph and one photo underneath", photos: 1 },
  "word-windows": { roles: ["brand", "story"], needs: "a few words each with a photo", photos: 3 },
  "glyph-wipe": { roles: ["brand"], needs: "the company name" },
  "shift-invert-25": { roles: ["statement", "services"], needs: "three to five short lines" },
  "rows-widen": { roles: ["services", "process"], needs: "four or more rows", items: 4 },
  "thumb-stream": { roles: ["work"], needs: "eight or more photos", photos: 8 },
  "drag-strip-10": { roles: ["work"], needs: "six or more photos", photos: 6 },
  "wheel-slides": { roles: ["work", "services"], needs: "five or more slides with photos", photos: 5 },
  "ring-carousel-9": { roles: ["work"], needs: "six or more photos", photos: 6 },
  "strip-bulge-7": { roles: ["work"], needs: "six or more photos", photos: 6 },
  "stats": { roles: ["numbers", "proof"], needs: "three to five numbers the research supports", items: 3 },
  "testimonials": { roles: ["proof"], needs: "named, verbatim reviews", items: 1 },
  "services": { roles: ["services"], needs: "three to nine services with a photo each", items: 3 },
  "process": { roles: ["process"], needs: "three to six steps", items: 3 },
  "faq": { roles: ["faq"], needs: "four or more real questions", items: 4 },
  "cta": { roles: ["ask"], needs: "the ask and its promise" },
  "contact": { roles: ["contact"], needs: "real contact details" },
  "text": { roles: ["intro", "story", "statement", "services", "team", "cities"], needs: "a headline, paragraphs and a real photo" },
  // the studio's own sections
  "manifesto": { roles: ["story", "numbers", "brand"], needs: "40-70 words in their voice and 3-4 real numbers", items: 3 },
  "service-rail": { roles: ["services"], needs: "4-8 services each with a one-line description and a real photo", items: 4 },
  "proof-feature": { roles: ["story", "proof", "work"], needs: "one real flagship project with its story and one photo", photos: 1 },
  "texture-loop": { roles: ["brand", "story"], needs: "a close-up of the material (or the generated texture clip) and a two-word headline", photos: 1 },
  "process-cards": { roles: ["process"], needs: "4-6 real steps, ideally one with a photo", items: 4 },
  "accent-marquee": { roles: ["cities", "brand", "services"], needs: "5-10 short promises or services", items: 5 },
  "areas-list": { roles: ["cities"], needs: "3-8 real places with a role each", items: 3 },
  "cta-review": { roles: ["ask", "proof"], needs: "one named review and the ask" },
  "split-intro": { roles: ["intro"], needs: "two real photos and the page's claim", photos: 2 },
};
export const STUDIO_TYPES = new Set(["manifesto", "service-rail", "proof-feature", "texture-loop", "process-cards", "accent-marquee", "areas-list", "cta-review", "split-intro"]);

/** The table in words for the planner: effect → what it is for → what it needs. Only effects that exist in the registry. */
export function fitTable() {
  return Object.entries(FIT).filter(([t]) => byType[t]).map(([t, f]) => `- ${t} (${byType[t].id}): for ${f.roles.join(" / ")}; needs ${f.needs}`).join("\n");
}

/** Plan-time fit errors: the planned section cannot carry what the effect needs. */
export function fitErrors(plan, photosAvailable: number): string[] {
  const out = [];
  for (const p of plan.pages || []) (p.sections || []).forEach((s, i) => {
    const f = FIT[s.type]; if (!f) return;
    const photos = (s.photos || []).length;
    if (f.photos && photosAvailable < f.photos) out.push(`${p.slug} §${i + 1} ${s.type} needs ${f.photos}+ real photos and the company has ${photosAvailable}; use ${photosAvailable >= 1 ? "one-image or a text block with its image" : "a text block"} instead`);
    if (f.photos >= 4 && photos === 1) out.push(`${p.slug} §${i + 1} ${s.type} is planned around a single photo; it needs ${f.photos}+ (list them, or use one-image / a text block with its image)`);
    if (f.items && Array.isArray(s.items) && s.items.length && s.items.length < f.items) out.push(`${p.slug} §${i + 1} ${s.type} has ${s.items.length} items; it needs ${f.items}+`);
  });
  return out;
}

/** Write-time fit errors: the written section does not carry what the effect needs. */
export function fitErrorsWritten(pages): string[] {
  const out = [];
  for (const p of pages || []) (p.sections || []).forEach((s, i) => {
    const f = FIT[s.type]; if (!f) return;
    const photos = [s.image, ...(s.images || []), ...(s.items || []).map(it => it?.image || (it?.query ? { query: it.query } : null)), ...(s.slides || []).map(sl => sl?.image || (sl?.query ? { query: sl.query } : null))].filter(x => x && (x.url || x.query)).length;
    const items = Array.isArray(s.items) ? s.items.length : Array.isArray(s.slides) ? s.slides.length : Array.isArray(s.steps) ? s.steps.length : 0;
    if (f.photos && photos < Math.min(f.photos, 2)) out.push(`${p.slug} §${i + 1} ${s.type} was written with ${photos} photo${photos === 1 ? "" : "s"}; it needs ${f.photos}`);
    if (f.items && items && items < f.items) out.push(`${p.slug} §${i + 1} ${s.type} has ${items} items; it needs ${f.items}+`);
  });
  return out;
}
