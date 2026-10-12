// @ts-nocheck
// The debugger. The last pair of eyes before a site goes live: it opens every
// page in a browser at desktop and phone size, looks at the screenshots the
// way a person checking a finished site would (is anything off-centre,
// cramped, overlapping, clipped, mismatched, misspelt, awkward, the wrong
// photo for its caption), fixes what it finds (copy and photos through the
// section data, layout through a small CSS layer per page), looks again, and
// keeps a page only when the fix actually made it better. It runs with its
// own API key (DEBUG_ANTHROPIC_API_KEY) so its spend is separate from the
// build's.
import { structured, parseJson, addUsage } from "./claude";
import { THE_BRIEF } from "./prompts";
import { inspectSite } from "./inspect";
import { gateInspection } from "./gates";
import { byType } from "./components";
import { resolveImages } from "./images";
import { imageBlocks } from "./look";

export const DEBUG_MODEL = process.env.UNIF_MODEL_DEBUG || process.env.UNIF_MODEL || "claude-fable-5-1";
export const debugKey = () => process.env.DEBUG_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "";
const MAX_PAGES = Number(process.env.DEBUG_MAX_PAGES || 24);
const MAX_ROUNDS = Number(process.env.DEBUG_ROUNDS || 2);

const SYSTEM_DEBUG = () => `${THE_BRIEF()}

You are the debugger at Unifictional: the last person who looks at a finished website before it goes live. You get ONE page: its section data (in each component's field shape), screenshots of it on a desktop (the top of the page, then each section) and on a phone, and the browser's own measurements. You look at it exactly as a careful person would before handing a site to a client:

- Dead space: a two-column section where one column sits empty for most of the section's height (a heading that scrolled away, a list only on the left, a tall portrait photo alone in a column, a body capped at 60 characters on a wide screen). The browser's measurements name these as "half-empty". Fix with CSS on that section: make the heading column sticky ([data-sec="N"]>div:first-child{position:sticky;top:96px}), let the body use its column, give the photo aspect-ratio:3/2;object-fit:cover;width:100%;height:auto, or make the section single-column.
- Layout: anything off-centre, cramped, overlapping, clipped, floating, uneven gaps, a headline wrapping into an orphan word, a card taller than its neighbours, an element hanging off the edge on the phone, text over a busy part of a photo so it cannot be read.
- Photos: the wrong picture for its caption or heading (a patio under "garage floors"), a photo that is stretched, tiny, repeated right next to itself, or shows a logo/screenshot instead of work.
- Wording: typos, double spaces, wrong capitalisation, a sentence that does not finish, placeholder-sounding text, a claim that contradicts another section, the company name spelt two ways, "Lorem", an eyebrow that repeats the headline.
- Links and labels: a button that says nothing ("Click here"), a phone number formatted two ways, a missing call to action at the end of a service page.

Then fix it. Two kinds of fix:
1. "sections": the complete corrected section list for the page, in order, in the same field shapes. Change only what needs changing; keep every fact, every real photo URL and the section types (you may swap a photo for another REAL photo from the list when it fits the caption better; you may never invent a photo URL or a fact).
2. "css": a small set of CSS rules for layout nudges on this page only. Every section's root element carries data-sec="N" (N = 1-based position in the list), so write rules like \`[data-sec="4"] .cards{align-items:stretch}\` or \`[data-sec="2"] h2{text-wrap:balance}\`. Use it for alignment, spacing, text-wrap, max-width, object-position of a photo, font-size on the phone (wrap in @media (max-width:640px)). Keep it under 40 lines. Never hide a section, never change colours or fonts, never move the hero.

Be honest and specific. If the page is genuinely fine, say so and return it unchanged. Blank screenshots or a page that did not load are not design problems: report them as "page did not render" and change nothing.

Return ONLY JSON:
{"slug": "<page slug>", "verdict": "fine" | "fixed" | "did not render", "findings": [{"section": <N or 0>, "kind": "layout|photo|wording|link", "problem": "what is off, in one line", "fix": "what you changed"}], "sections": [ ...complete section list... ], "css": "..."}`;

const SYSTEM_VERIFY = () => `You check whether a web page's fixes landed. You get the list of fixes that were applied and two sets of screenshots: BEFORE and AFTER (desktop top, then sections, then the phone). Answer whether the page is better now, the same, or worse (something new is broken, overlapping, clipped, blank, or a fix made the layout uglier). Be strict about "worse": a page must never leave here worse than it came in.

Return ONLY JSON: {"result": "better" | "same" | "worse", "why": "one line"}`;

function shotsFor(report, slug, limit = 11) {
  const d = (report?.pages || []).find(p => p.slug === slug && p.viewport === "desktop");
  const m = (report?.pages || []).find(p => p.slug === slug && p.viewport === "phone");
  const out = [];
  for (const x of (d?.shots || []).filter(x => x.data).slice(0, limit)) out.push({ label: `${slug} · desktop · ${x.name}`, data: x.data });
  for (const x of (m?.shots || []).filter(x => x.data).slice(0, 2)) out.push({ label: `${slug} · phone · ${x.name}`, data: x.data });
  return out;
}
function factsFor(report, slug) {
  const lines = [];
  for (const p of (report?.pages || []).filter(p => p.slug === slug)) {
    for (const d of p.deadSpace || []) lines.push(`${p.viewport}: section ${d.index + 1} (${d.type}) is half-empty on the ${d.side} for ${d.pct}% of its ${d.screens} screens`);
    lines.push(`${p.viewport}: ${p.loadError ? "DID NOT LOAD: " + p.loadError : `${(p.sections || p.sectionCount || 0) && ""}overflow ${p.overflowPx || 0}px${p.overflowBy?.length ? " (" + p.overflowBy.slice(0, 3).join(", ") + ")" : ""}, clipped text ${(p.clippedText || []).length}, broken images ${(p.brokenImages || []).length}${p.brokenImages?.length ? " (" + p.brokenImages.slice(0, 3).join(", ") + ")" : ""}, blank sections ${(p.blankSections || []).length}, tiny text blocks ${p.tinyText || 0}, script errors ${(p.consoleErrors || []).length}`}`);
  }
  return lines.join("\n");
}
const fieldShape = (s) => { const c = byType[s.type]; return c ? `${s.type}: ${c.fields || ""}` : s.type; };

/**
 * Debug every page of a rendered site. `renderStore()` re-renders and stores
 * the pages from `spec`; `origin` is where the stored pages are served.
 * Mutates spec (sections and per-page `debugCss`). Returns notes for the owner.
 */
export async function debugSite(job, spec, { cat, origin, previewBase, renderStore, stamp }) {
  const notes = [];
  const key = debugKey();
  if (!key) { stamp("debug: no DEBUG_ANTHROPIC_API_KEY; the debugger did not run"); return { notes: ["The debugger did not run (no API key set)."], changed: [] }; }
  const slugs = spec.pages.map(p => p.slug).slice(0, MAX_PAGES);
  const logoExpected = Boolean(spec.brand?.logo?.url);
  const photos = (job.dossier?.photos || []).slice(0, 60).map(p => `${p.url} · ${p.alt || ""}`).join("\n") || "none";
  const changedPages = [];
  let round = 0;
  let before = await inspectSite({ id: job.id, origin, slugs, logoExpected, round: 90, stamp, maxInner: MAX_PAGES, homeOnly: false, previewBase });
  stamp(`debug: looked at ${slugs.length} page${slugs.length === 1 ? "" : "s"} on desktop and phone (${before.shots} screenshots)`);
  while (round < MAX_ROUNDS) {
    round++;
    const fixes = {};
    // one look per page, three pages at a time
    const CONC = Number(process.env.DEBUG_CONCURRENCY || 3);
    const queue = [...slugs]; let qi = 0;
    const lookAt = async (slug) => {
      const page = spec.pages.find(p => p.slug === slug); if (!page) return;
      const shots = shotsFor(before, slug);
      if (!shots.length) { stamp(`debug: ${slug}: no screenshots; skipped`); return; }
      const user = [
        `PAGE: ${slug} (${page.title || ""}) · round ${round}`,
        `BROWSER MEASUREMENTS:\n${factsFor(before, slug)}`,
        `CURRENT SECTIONS:\n${JSON.stringify(page.sections.map(s => { const c = { ...s }; delete c.component; return c; }), null, 1)}`,
        `FIELD SHAPES:\n${page.sections.map(fieldShape).join("\n")}`,
        page.debugCss ? `CSS ALREADY APPLIED TO THIS PAGE:\n${page.debugCss}` : "",
        `REAL PHOTOS (url · what it shows):\n${photos}`,
        `BRAND: ${spec.brand?.name} · phone ${spec.brand?.phone || job.dossier?.phone || "-"} · ${spec.brand?.city || job.dossier?.city || ""}`,
      ].filter(Boolean).join("\n\n");
      try {
        const { text, usage } = await structured({ system: SYSTEM_DEBUG(), user: [{ type: "text", text: user }, { type: "text", text: "WHAT THE PAGE LOOKS LIKE NOW:" }, ...imageBlocks(shots)], schema: null, effort: "medium", maxTokens: 24000, model: DEBUG_MODEL, apiKey: key });
        job.debugUsage = addUsage(job.debugUsage, usage);
        const out = parseJson(text);
        if (!out) { stamp(`debug: ${slug}: unreadable answer; page kept`); return; }
        if (out.verdict === "did not render") { stamp(`debug: ${slug}: page did not render for the debugger; kept`); return; }
        const findings = Array.isArray(out.findings) ? out.findings.filter(f => f && f.problem) : [];
        if (out.verdict === "fine" || (!findings.length && !out.css)) { stamp(`debug: ${slug}: fine`); return; }
        const snapshot = { sections: JSON.parse(JSON.stringify(page.sections)), debugCss: page.debugCss || "" };
        let applied = 0;
        if (Array.isArray(out.sections) && out.sections.length && out.sections.every(s => s && byType[s.type])) {
          if (out.sections.length === page.sections.length) { page.sections = out.sections.map(s => ({ ...s, component: byType[s.type].id })); resolveImages(page, cat, job.dossier?.photos || []); applied++; }
          else stamp(`debug: ${slug}: the answer changed the number of sections (${page.sections.length} → ${out.sections.length}); copy changes ignored`);
        }
        const css = String(out.css || "").trim();
        if (css && css.length < 4000 && !/<\/?script|expression\(|@import|url\(/i.test(css) && /\[data-sec=|@media|\.|#/.test(css)) { page.debugCss = `${page.debugCss ? page.debugCss + "\n" : ""}${css}`; applied++; }
        if (!applied) { stamp(`debug: ${slug}: findings but nothing applicable; page kept`); return; }
        fixes[slug] = { snapshot, findings, shotsBefore: shots };
        stamp(`debug: ${slug}: ${findings.length} finding${findings.length === 1 ? "" : "s"}: ${findings.slice(0, 3).map(f => f.problem).join("; ")}`);
      } catch (e) { stamp(`debug: ${slug}: ${e?.message || e}; page kept`); }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, queue.length) }, async () => { while (qi < queue.length) { const slug = queue[qi++]; await lookAt(slug); } }));
    const touched = Object.keys(fixes);
    if (!touched.length) { stamp(`debug round ${round}: nothing to fix`); break; }
    // re-render, look again, keep only what got better
    await renderStore();
    const after = await inspectSite({ id: job.id, origin, slugs: touched, logoExpected, round: 90 + round, stamp, maxInner: MAX_PAGES, homeOnly: false, previewBase });
    let vi = 0;
    const verifyOne = async (slug) => {
      const page = spec.pages.find(p => p.slug === slug);
      const f = fixes[slug];
      const hard = gateInspection({ pages: (after.pages || []).filter(p => p.slug === slug) }).errors;
      let result = "better", why = "";
      if (hard.length) { result = "worse"; why = hard[0]; }
      else {
        try {
          const shotsAfter = shotsFor(after, slug);
          const { text, usage } = await structured({ system: SYSTEM_VERIFY(), user: [{ type: "text", text: `PAGE: ${slug}\nFIXES APPLIED:\n${f.findings.map(x => `- ${x.problem} → ${x.fix || ""}`).join("\n")}` }, { type: "text", text: "BEFORE:" }, ...imageBlocks(f.shotsBefore.slice(0, 6)), { type: "text", text: "AFTER:" }, ...imageBlocks(shotsAfter.slice(0, 6))], schema: null, effort: "low", maxTokens: 2000, model: DEBUG_MODEL, apiKey: key });
          job.debugUsage = addUsage(job.debugUsage, usage);
          const v = parseJson(text) || {}; result = v.result || "same"; why = v.why || "";
        } catch (e) { result = "same"; why = String(e?.message || e); }
      }
      if (result === "worse") { page.sections = f.snapshot.sections; page.debugCss = f.snapshot.debugCss; stamp(`debug: ${slug}: the fix made it worse (${why}); reverted`); }
      else { changedPages.push(slug); for (const x of f.findings) notes.push(`${slug}: ${x.problem}${x.fix ? " → " + x.fix : ""}`); stamp(`debug: ${slug}: ${result}${why ? " (" + why + ")" : ""}`); }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, touched.length) }, async () => { while (vi < touched.length) { const slug = touched[vi++]; await verifyOne(slug); } }));
    if (touched.some(s => !changedPages.includes(s))) await renderStore(); // reverted pages back on disk
    before = after;
    if (round >= MAX_ROUNDS) break;
    // the next round looks only at pages that changed (fresh screenshots) — the others were already fine
    slugs.splice(0, slugs.length, ...[...new Set(changedPages)]);
    if (!slugs.length) break;
  }
  return { notes, changed: [...new Set(changedPages)] };
}
