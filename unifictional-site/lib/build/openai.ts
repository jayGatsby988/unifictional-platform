// @ts-nocheck
// The OpenAI half of the model layer, so any pipeline stage can run on an
// OpenAI model (gpt-6-astra and friends) by naming it in UNIF_MODEL_<STAGE>.
// Mirrors the two calls lib/build/claude.ts exposes, with the same inputs and
// the same return shapes, so the pipeline never knows which provider ran.
// Team mode (lib/team/agent.ts) drives Anthropic's tool loop directly and
// stays on Claude for now.
import OpenAI from "openai";

/** Model ids that belong to OpenAI. Everything else is Anthropic. */
export const isOpenAIModel = (model) => /^(gpt-|o\d|chatgpt-)/i.test(String(model || ""));
export const hasOpenAIKey = () => Boolean(process.env.OPENAI_API_KEY);

let client = null;
const keyed = new Map();
export function openai(apiKey = "") {
  // A per-role key from team mode may be an Anthropic key; only use it here when it isn't.
  const own = apiKey && !/^sk-ant-/.test(apiKey) ? apiKey : "";
  if (own) { if (!keyed.has(own)) keyed.set(own, new OpenAI({ apiKey: own, maxRetries: 4, timeout: 10 * 60 * 1000 })); return keyed.get(own); }
  if (!client) client = new OpenAI({ maxRetries: 4, timeout: 10 * 60 * 1000 });
  return client;
}

export function describeOpenAIError(e) {
  if (e instanceof OpenAI.AuthenticationError) return "The OPENAI_API_KEY on the server was rejected. Check the key in the Vercel and Trigger project settings.";
  if (e instanceof OpenAI.PermissionDeniedError) return "The OpenAI key does not have access to this model.";
  if (e instanceof OpenAI.RateLimitError) return "Rate limited by the OpenAI API.";
  if (e instanceof OpenAI.APIConnectionError) return "Could not reach the OpenAI API.";
  if (e instanceof OpenAI.APIError) return `OpenAI API error ${e.status}: ${e.message}`;
  return e?.message || String(e);
}

/** Anthropic-style user content (string or text/image blocks) → Responses API input. */
function toInput(user) {
  if (!Array.isArray(user)) return [{ role: "user", content: [{ type: "input_text", text: String(user ?? "") || "(no content)" }] }];
  const content = [];
  for (const b of user) {
    if (!b) continue;
    if (b.type === "text") { if (typeof b.text === "string" && b.text.trim()) content.push({ type: "input_text", text: b.text }); }
    else if (b.type === "image" && b.source?.type === "base64") content.push({ type: "input_image", image_url: `data:${b.source.media_type || "image/jpeg"};base64,${b.source.data}`, detail: "high" });
    else if (b.type === "image" && b.source?.type === "url") content.push({ type: "input_image", image_url: b.source.url, detail: "high" });
  }
  return [{ role: "user", content: content.length ? content : [{ type: "input_text", text: "(no content)" }] }];
}

/** Responses usage → the Anthropic-shaped usage the cost accounting reads. */
function toUsage(res) {
  const u = res?.usage || {};
  return {
    input_tokens: u.input_tokens || 0,
    output_tokens: u.output_tokens || 0,
    cache_read_input_tokens: u.input_tokens_details?.cached_tokens || 0,
    cache_creation_input_tokens: 0,
    model: res?.model || "",
  };
}

const EFFORT = { low: "low", medium: "medium", high: "high" };

function finished(res, what) {
  if (res.status === "incomplete") {
    const why = res.incomplete_details?.reason || "unknown reason";
    if (why === "max_output_tokens") throw new Error(`The ${what} was cut off (max_output_tokens: ${res.usage?.output_tokens} output tokens used).`);
    throw new Error(`The ${what} did not finish (${why}).`);
  }
  const refusal = (res.output || []).flatMap(o => o.content || []).find(c => c.type === "refusal");
  if (refusal) throw new Error("The model declined this request" + (refusal.refusal ? ": " + refusal.refusal : "."));
}

/**
 * Same contract as claude.structured: { text, usage, model }. A JSON schema is
 * sent strict first; a schema the API rejects falls back to non-strict, then
 * to prompt-only JSON, parsed leniently by the caller as it already is.
 */
/** A system prompt may arrive as Anthropic-style blocks (with cache_control); the Responses API wants one string. */
const systemText = (system) => typeof system === "string" ? system : Array.isArray(system) ? system.map((b) => (typeof b === "string" ? b : b?.text || "")).filter(Boolean).join("\n\n") : String(system ?? "");

export async function structuredOpenAI({ system, user, schema = null, onText, maxTokens = 32000, effort = "medium", model, apiKey = "" }) {
  const c = openai(apiKey);
  const base = { model, instructions: systemText(system), input: toInput(user), reasoning: { effort: EFFORT[effort] || "medium" }, max_output_tokens: maxTokens, store: false };
  const attempts = schema
    ? [{ text: { format: { type: "json_schema", name: "result", strict: true, schema } } }, { text: { format: { type: "json_schema", name: "result", strict: false, schema } } }, {}]
    : [{}];
  let res, lastErr;
  for (const extra of attempts) {
    try { res = await c.responses.create({ ...base, ...extra }); lastErr = null; break; }
    catch (e) {
      lastErr = e;
      // a schema the grammar compiler rejects → try the next, looser attempt; anything else is real
      if (!(e instanceof OpenAI.BadRequestError) || attempts.indexOf(extra) === attempts.length - 1) throw e;
    }
  }
  if (lastErr) throw lastErr;
  finished(res, "response");
  const text = res.output_text || "";
  if (!text.trim()) throw new Error("The model returned an empty response.");
  if (onText) onText(text, text);
  return { text, usage: toUsage(res), model: res.model };
}

/**
 * Same contract as claude.research: { text, searches, sources, usage }, using
 * the Responses API's web_search tool. max_tool_calls caps the searches where
 * the model supports it.
 */
export async function researchOpenAI({ system, user, maxSearches = 8, effort = "high", maxTokens = 24000, onEvent, model, apiKey = "" }) {
  const c = openai(apiKey);
  const base = { model, instructions: systemText(system), input: toInput(user), tools: [{ type: "web_search" }], reasoning: { effort: EFFORT[effort] || "medium" }, max_output_tokens: maxTokens, store: false, include: ["web_search_call.action.sources"] };
  let res;
  try { res = await c.responses.create({ ...base, max_tool_calls: maxSearches }); }
  catch (e) {
    if (!(e instanceof OpenAI.BadRequestError)) throw e;
    // older shapes: no max_tool_calls / no sources include
    const plain = { ...base };
    delete plain.include;
    res = await c.responses.create(plain);
  }
  finished(res, "research answer");
  const searches = [], sources = [];
  for (const item of res.output || []) {
    if (item.type === "web_search_call") {
      const q = item.action?.query || item.action?.queries?.[0] || "";
      if (q) { searches.push(q); if (onEvent) onEvent("search", { query: q }); }
      for (const s of item.action?.sources || []) if (s?.url) sources.push({ url: s.url, title: s.title || "" });
    }
    if (item.type === "message") for (const part of item.content || []) for (const a of part.annotations || []) if (a.type === "url_citation" && a.url) sources.push({ url: a.url, title: a.title || "" });
  }
  const seen = new Set();
  return { text: res.output_text || "", searches, sources: sources.filter(s => !seen.has(s.url) && seen.add(s.url)), usage: toUsage(res) };
}
