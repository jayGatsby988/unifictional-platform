// POST /api/seo  { spec, dossier?, audit } -> { seo: {title, description, keywords, plan, altText, notes} }
// The SEO agent's model half. The rule-based scoring lives in public/assets/js/seo.js.
import { body, json, hasKey, structured, parseJson, describeError, MODEL } from "./_lib/http.js";
import { SYSTEM_SEO, SEO_SCHEMA } from "./_lib/prompts.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  if (!hasKey()) return json(res, 200, { mode: "local" });
  const { spec, dossier, audit } = await body(req);
  if (!spec) return json(res, 400, { error: "spec is required" });
  try {
    const queries = [];
    for (const s of spec.sections || []) { if (s.image?.query) queries.push(s.image.query); (s.images || []).forEach(i => i.query && queries.push(i.query)); if (s.type === "gallery") (s.items || []).forEach(i => queries.push(i.query || i.title)); }
    const lean = { brand: spec.brand, seo: { title: spec.seo?.title, description: spec.seo?.description, keywords: spec.seo?.keywords }, sections: (spec.sections || []).map(s => ({ type: s.type, headline: s.headline, text: s.text, title: s.title, items: (s.items || []).map(i => i.title || i.q || i.quote).slice(0, 8) })) };
    const d = dossier ? JSON.stringify({ serviceArea: dossier.serviceArea, audience: dossier.audience, competitors: dossier.competitors, keywords: dossier.keywords, gaps: dossier.gaps }) : "none";
    const user = `SITE SPEC:\n${JSON.stringify(lean)}\n\nDOSSIER (excerpt):\n${d}\n\nIMAGE QUERIES NEEDING ALT TEXT:\n${JSON.stringify([...new Set(queries)])}\n\nRULE AUDIT OF THE RENDERED PAGE:\n${JSON.stringify(audit || {})}`;
    const { text, usage } = await structured({ system: SYSTEM_SEO(), user, schema: SEO_SCHEMA, effort: "medium", maxTokens: 8000 });
    const seo = parseJson(text);
    if (!seo) throw new Error("The model did not return a valid SEO plan.");
    return json(res, 200, { ok: true, seo, usage, model: MODEL });
  } catch (e) {
    return json(res, 502, { error: describeError(e) });
  }
}
