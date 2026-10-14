// POST /api/research  { analysis } | { prompt }   -> SSE
// events: status {text}, search {query}, page {url, words}, dossier {dossier, searches, sources, usage}, error {message}
// The research agent: crawls the company's own pages (no model), then lets
// Claude search the web for reviews, competitors, local market language and
// proof, and writes a dossier the design model builds from.
import { body, json, sse, hasKey, research, parseJson, describeError, MODEL } from "./_lib/http.js";
import { SYSTEM_RESEARCH } from "./_lib/prompts.js";
import { fetchPage, pageText } from "./analyze.js";

const WANT = /about|service|work|project|portfolio|gallery|review|testimonial|process|team|menu|pricing|faq|contact|area/i;

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  if (!hasKey()) return json(res, 200, { mode: "local", reason: "ANTHROPIC_API_KEY is not configured on the server" });
  const { analysis, prompt } = await body(req);
  if (!analysis && !prompt) return json(res, 400, { error: "analysis or prompt is required" });
  const s = sse(res);
  try {
    /* 1. crawl the company's own pages */
    const pages = [];
    if (analysis?.links?.length) {
      const picks = analysis.links.filter(l => WANT.test(l.text + " " + l.href)).slice(0, 6);
      s.send("status", { text: `Reading ${picks.length} more pages on ${analysis.domain}` });
      const results = await Promise.allSettled(picks.map(async (l) => {
        const html = await fetchPage(l.href, 8000);
        const t = pageText(html).slice(0, 3500);
        return { url: l.href, title: l.text, words: t.split(/\s+/).length, text: t };
      }));
      for (const r of results) if (r.status === "fulfilled" && r.value.words > 40) { pages.push(r.value); s.send("page", { url: r.value.url, words: r.value.words }); }
    }

    /* 2. the model researches */
    s.send("status", { text: "Researching the company on the web" });
    const subject = analysis
      ? `COMPANY SITE: ${analysis.url}\nTITLE: ${analysis.title}\nDESCRIPTION: ${analysis.description}\nHEADINGS: ${(analysis.headings || []).slice(0, 25).join(" | ")}\nNAV: ${(analysis.nav || []).join(" | ")}\nPHONE: ${analysis.phone || "-"}  EMAIL: ${analysis.email || "-"}  CITY GUESS: ${analysis.city || "-"}\nBRAND COLOURS: ${(analysis.colors || []).join(" ")}  FONTS: ${(analysis.fonts || []).join(", ")}\nEXISTING SCHEMA: ${JSON.stringify(analysis.schema || []).slice(0, 800)}\nHOME PAGE TEXT:\n${(analysis.text || "").slice(0, 5000)}\n\nOTHER PAGES:\n${pages.map(p => `--- ${p.title} (${p.url})\n${p.text.slice(0, 2500)}`).join("\n")}\n\nPHOTOS ON THE SITE (usable in the new site if they are real photos): ${(analysis.images || []).slice(0, 12).join(" ")}`
      : `BRIEF FROM THE OWNER (no website yet):\n${prompt}`;
    let last = 0;
    const { text, searches, sources, usage } = await research({
      system: SYSTEM_RESEARCH(), user: subject, maxSearches: 8, effort: "high",
      onEvent: (ev, d) => { if (ev === "search") s.send("search", d); },
      onText: (_, acc) => { if (acc.length - last > 600) { last = acc.length; s.send("status", { text: `Writing the dossier… ${(acc.length / 1024).toFixed(1)} KB` }); } },
    });
    const dossier = parseJson(text);
    if (!dossier) throw new Error("The research agent did not return a readable dossier.");
    dossier.sources = [...(dossier.sources || []), ...sources.map(x => x.url)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 20);
    dossier.pagesRead = pages.map(p => p.url);
    dossier.searches = searches;
    dossier.sitePhotos = (analysis?.images || []).filter(u => /\.(jpe?g|png|webp|avif)(\?|$)/i.test(u) && !/logo|icon|favicon|sprite|badge|avatar/i.test(u)).slice(0, 12);
    s.send("dossier", { dossier, searches, sources, usage, model: MODEL });
  } catch (e) {
    s.send("error", { message: describeError(e) });
  }
  s.end();
}
