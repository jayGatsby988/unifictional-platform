// POST /api/generate  { dossier, analysis?, prompt?, instruction? }   -> SSE stream
// events: status {text}, token {n}, spec {spec, usage}, error {message}
// Claude writes the site specification from the research dossier, against the
// schema in _lib/prompts.js. Without an API key it answers {mode:"local"}.
import { body, json, sse, hasKey, structured, parseJson, describeError, MODEL } from "./_lib/http.js";
import { SYSTEM_GENERATE, SITE_SCHEMA } from "./_lib/prompts.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  if (!hasKey()) return json(res, 200, { mode: "local", reason: "ANTHROPIC_API_KEY is not configured on the server" });
  const { dossier, analysis, prompt, instruction } = await body(req);
  if (!dossier && !analysis && !prompt) return json(res, 400, { error: "dossier, analysis or prompt is required" });

  const s = sse(res);
  s.send("status", { text: `Design engine: ${MODEL}` });
  const parts = [];
  if (dossier) parts.push(`RESEARCH DOSSIER (built by the research agent; cite its proof, use its phrasing):\n${JSON.stringify(dossier, null, 1)}`);
  if (analysis) parts.push(`SOURCE SITE FACTS (extracted from ${analysis.url}):\n${JSON.stringify({ title: analysis.title, description: analysis.description, headings: (analysis.headings || []).slice(0, 25), nav: analysis.nav, phone: analysis.phone, email: analysis.email, city: analysis.city, colors: analysis.colors, fonts: analysis.fonts, text: (analysis.text || "").slice(0, 3000) }, null, 1)}`);
  if (prompt) parts.push(`BRIEF FROM THE OWNER:\n${prompt}`);
  if (instruction) parts.push(`EXTRA DIRECTION FROM THE OWNER: ${instruction}`);
  parts.push(analysis ? "Rebuild this business's website as a complete site specification. Keep what is good about the brand (name, a real brand colour, real services, contact details, real reviews) and make everything else better and more specific." : "Create a complete site specification for this business. Infer industry, name and location from the dossier and brief; if no name is given, invent a credible one and say so in the rationale.");
  try {
    s.send("status", { text: "Designing from the dossier" });
    let last = 0;
    const { text, usage } = await structured({ system: SYSTEM_GENERATE(), user: parts.join("\n\n"), schema: null, effort: "high", onText: (_, acc) => { if (acc.length - last > 400) { last = acc.length; s.send("token", { n: acc.length }); } } });
    const spec = parseJson(text);
    if (!spec) throw new Error("The model returned something that was not a site specification.");
    s.send("spec", { spec, usage, model: MODEL });
  } catch (e) {
    s.send("error", { message: describeError(e) });
  }
  s.end();
}
