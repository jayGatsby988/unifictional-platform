// @ts-nocheck
// Ported from Unifictional Studio api/_lib/http.js (model half only).
// One Anthropic client, a structured-output request and a research request
// that may call the web_search server tool. Node runtime only.
import Anthropic from "@anthropic-ai/sdk";

// Default model for every agent, overridable per phase:
//   UNIF_MODEL (all), UNIF_MODEL_RESEARCH, UNIF_MODEL_PLAN, UNIF_MODEL_WRITE, UNIF_MODEL_REVIEW, UNIF_MODEL_SEO
export const MODEL = process.env.UNIF_MODEL || "claude-fable-5-1";
export function modelFor(phase: "research" | "plan" | "write" | "review" | "seo" | "debug") {
  return process.env[`UNIF_MODEL_${phase.toUpperCase()}`] || MODEL;
}
export const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client = null;
const keyed = new Map();
export function anthropic(apiKey = "") {
  if (apiKey) { if (!keyed.has(apiKey)) keyed.set(apiKey, new Anthropic({ apiKey, maxRetries: 6, timeout: 10 * 60 * 1000 })); return keyed.get(apiKey); }
  if (!client) client = new Anthropic({ maxRetries: 6, timeout: 10 * 60 * 1000 }); // 6 backoff retries ride out 429/529 bursts when twenty builds run at once
  return client;
}

// Strip code fences and parse the JSON the model returned.
export function parseJson(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a > -1 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}

// Turn an SDK error into a message a person can act on.
export function describeError(e) {
  if (e instanceof Anthropic.AuthenticationError) return "The ANTHROPIC_API_KEY on the server was rejected. Check the key in the Vercel project settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return "The API key does not have access to this model.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API.";
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API.";
  if (e instanceof Anthropic.APIError) return `API error ${e.status}: ${e.message}`;
  return e?.message || String(e);
}

// Structured-output request on the beta surface with server-side refusal
// fallbacks; retried on the stable surface if the beta is rejected. A schema
// enforces the output grammar; large schemas are rejected by the API
// ("compiled grammar is too large"), so the site spec is requested by prompt
// (schema: null) and parsed leniently.
/** Content for a user turn: a string, or blocks with empty text blocks removed (the API rejects them). */
function userContent(user) {
  if (!Array.isArray(user)) return user;
  const blocks = user.filter(b => b && (b.type !== "text" || (typeof b.text === "string" && b.text.trim().length)));
  return blocks.length ? blocks : "(no content)";
}

export async function structured({ system, user, schema = null, onText, maxTokens = 32000, effort = "medium", model = MODEL, apiKey = "" }) {
  const c = anthropic(apiKey);
  const base = {
    model, max_tokens: maxTokens, system,
    messages: [{ role: "user", content: userContent(user) }],
    output_config: schema ? { effort, format: { type: "json_schema", schema } } : { effort },
  };
  let stream;
  try {
    stream = c.beta.messages.stream({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    return await drain(stream, onText);
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError) {
      stream = c.messages.stream(base);
      return await drain(stream, onText);
    }
    throw e;
  }
}

async function drain(stream, onText) {
  let text = "";
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { text += ev.delta.text; onText && onText(ev.delta.text, text); }
  }
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The model declined this request" + (msg.stop_details?.explanation ? ": " + msg.stop_details.explanation : "."));
  if (msg.stop_reason === "max_tokens") throw new Error(`The response was cut off (max_tokens: ${msg.usage?.output_tokens} output tokens used, ${text.length} chars of text).`);
  return { text, usage: { ...msg.usage, model: msg.model }, model: msg.model };
}

// Research request: the model may call web_search (server tool) up to
// `maxSearches` times. Resumes on pause_turn; reports each search and every
// source it read. Returns the final text.
export async function research({ system, user, maxSearches = 8, effort = "high", maxTokens = 24000, onEvent, model = MODEL }) {
  const c = anthropic();
  const messages = [{ role: "user", content: user }];
  let toolType = "web_search_20260209";
  const searches = [], sources = [];
  let text = "", usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, turns = 0;
  while (turns++ < 6) {
    const req = () => c.beta.messages.stream({ model, max_tokens: maxTokens, system, messages, tools: [{ type: toolType, name: "web_search", max_uses: maxSearches }], output_config: { effort }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    let stream;
    try {
      stream = req();
      for await (const ev of stream) { if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") text += ev.delta.text; }
    } catch (e) {
      // a model that does not take the newer search tool, or the beta surface: fall back once
      if (e instanceof Anthropic.BadRequestError && toolType === "web_search_20260209") { toolType = "web_search_20250305"; text = ""; turns--; continue; }
      if (e instanceof Anthropic.BadRequestError) {
        stream = c.messages.stream({ model, max_tokens: maxTokens, system, messages, tools: [{ type: toolType, name: "web_search", max_uses: maxSearches }], output_config: { effort } });
        text = "";
        for await (const ev of stream) { if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") text += ev.delta.text; }
      } else throw e;
    }
    const msg = await stream.finalMessage();
    for (const k of Object.keys(usage)) usage[k] += msg.usage?.[k] || 0;
    for (const b of msg.content) {
      if (b.type === "server_tool_use" && b.name === "web_search") { const q = b.input?.query || ""; searches.push(q); onEvent && onEvent("search", { query: q }); }
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.type === "web_search_result") sources.push({ url: r.url, title: r.title });
    }
    if (msg.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: msg.content }); continue; }
    if (msg.stop_reason === "refusal") throw new Error("The model declined this research request.");
    if (msg.stop_reason === "max_tokens") throw new Error("The research answer was cut off (max_tokens).");
    break;
  }
  return { text, searches, sources: dedupe(sources), usage };
}
const dedupe = (arr) => { const seen = new Set(); return arr.filter(s => s.url && !seen.has(s.url) && seen.add(s.url)); };

// List prices in USD per million tokens (plus $0.01 per web search).
export const PRICES = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
const SEARCH_PRICE = 0.01;
const priceFor = (model) => PRICES[model] || PRICES["claude-fable-5-1"];
export function emptyUsage() { return { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0, cost: 0, models: {} }; }
// Cost is accumulated per call at that call's model price, so a mixed build adds up correctly.
export function addUsage(total, usage, searches = 0, model = MODEL) {
  if (!total) total = emptyUsage();
  const p = priceFor(usage?.model || model);
  const inp = usage?.input_tokens || 0, out = usage?.output_tokens || 0, cr = usage?.cache_read_input_tokens || 0, cw = usage?.cache_creation_input_tokens || 0;
  total.calls += 1; total.input += inp; total.output += out; total.cacheRead += cr; total.cacheWrite += cw; total.searches += searches;
  total.cost = (total.cost || 0) + (inp * p.input + out * p.output + cr * p.cacheRead + cw * p.cacheWrite) / 1e6 + searches * SEARCH_PRICE;
  total.models = total.models || {}; const m = usage?.model || model; total.models[m] = (total.models[m] || 0) + 1;
  return total;
}
export function costOf(u) {
  if (!u) return 0;
  if (typeof u.cost === "number") return u.cost;
  const p = priceFor(MODEL);
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6 + u.searches * SEARCH_PRICE;
}
