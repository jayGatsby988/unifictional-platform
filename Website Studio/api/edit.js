// POST /api/edit  { spec, dossier?, instruction } -> SSE { spec }
// Chat edits in Claude mode: the model returns the full updated spec.
import { body, json, sse, hasKey, structured, parseJson, describeError, MODEL } from "./_lib/http.js";
import { SYSTEM_EDIT, SITE_SCHEMA } from "./_lib/prompts.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  if (!hasKey()) return json(res, 200, { mode: "local" });
  const { spec, dossier, instruction } = await body(req);
  if (!spec || !instruction) return json(res, 400, { error: "spec and instruction are required" });
  const s = sse(res);
  try {
    s.send("status", { text: `Applying: ${instruction}` });
    const lean = structuredClone(spec);
    for (const sec of lean.sections || []) { if (sec.image) delete sec.image.url; if (sec.images) sec.images.forEach(i => delete i.url); if (sec.items) sec.items.forEach(i => { if (i.image) delete i.image; }); }
    if (lean.nav?.links) lean.nav.links.forEach(l => delete l.image);
    delete lean.seo?.schema; delete lean.seo?.alt;
    const d = dossier ? JSON.stringify({ positioning: dossier.positioning, differentiators: dossier.differentiators, proof: dossier.proof, voice: dossier.voice, copyBank: dossier.copyBank, sitePhotos: dossier.sitePhotos }) : "none";
    const { text, usage } = await structured({ system: SYSTEM_EDIT(), user: `CURRENT SPEC:\n${JSON.stringify(lean)}\n\nDOSSIER (excerpt):\n${d}\n\nINSTRUCTION: ${instruction}`, schema: null, effort: "medium" });
    const next = parseJson(text);
    if (!next) throw new Error("The model did not return a valid specification.");
    s.send("spec", { spec: next, usage, model: MODEL });
  } catch (e) {
    s.send("error", { message: describeError(e) });
  }
  s.end();
}
