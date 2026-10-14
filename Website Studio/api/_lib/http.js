// Small helpers shared by the api functions (Vercel Node runtime).
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.UNIF_MODEL || "claude-opus-5-5";
export const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client = null;
export function anthropic() {
  if (!client) client = new Anthropic({ maxRetries: 2, timeout: 10 * 60 * 1000 });
  return client;
}

export async function body(req) {
  if (req.body !== undefined) return typeof req.body === "string" ? safeJson(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return safeJson(Buffer.concat(chunks).toString("utf8"));
}
function safeJson(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }

export function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(obj));
}

export function sse(res) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-store, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  if (res.flushHeaders) res.flushHeaders();
  const send = (event, data) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); if (res.flush) res.flush(); };
  const ping = setInterval(() => res.write(": ping\n\n"), 12000);
  return { send, end: () => { clearInterval(ping); res.end(); } };
}

// Strip code fences and parse the JSON the model returned.
export function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a > -1 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}

// Turn an SDK error into a message a user can act on.
export function describeError(e) {
  if (e instanceof Anthropic.AuthenticationError) return "The ANTHROPIC_API_KEY on the server was rejected. Check the key in the Vercel project settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return "The API key does not have access to this model.";
  if (e instanceof Anthropic.RateLimitError) return "Rate limited by the API. Try again in a minute.";
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API.";
  if (e instanceof Anthropic.APIError) return `API error ${e.status}: ${e.message}`;
  return e?.message || String(e);
}

// Structured-output request on the beta surface with server-side refusal
// fallbacks; retried on the stable surface if the beta is rejected.
export async function structured({ system, user, schema, onText, maxTokens = 32000, effort = "medium" }) {
  const c = anthropic();
  // A schema enforces the output grammar; large schemas are rejected by the
  // API ("compiled grammar is too large"), so the big site spec is requested
  // by prompt instead (schema: null) and parsed leniently.
  const base = {
    model: MODEL, max_tokens: maxTokens, system,
    messages: [{ role: "user", content: user }],
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
  if (msg.stop_reason === "max_tokens") throw new Error("The response was cut off (max_tokens). Try a shorter brief.");
  return { text, usage: msg.usage, model: msg.model };
}

// Research request: the model may call web_search (server tool) as many times
// as `maxSearches`. Streams; resumes on pause_turn; reports each search and
// every source it read through `onEvent`. Returns the final text.
export async function research({ system, user, maxSearches = 8, effort = "high", maxTokens = 24000, onEvent, onText }) {
  const c = anthropic();
  const messages = [{ role: "user", content: user }];
  const tools = [{ type: "web_search_20260209", name: "web_search", max_uses: maxSearches }];
  const searches = [], sources = [];
  let text = "", usage = null, turns = 0;
  while (turns++ < 6) {
    const stream = c.messages.stream({ model: MODEL, max_tokens: maxTokens, system, messages, tools, output_config: { effort } });
    for await (const ev of stream) {
      if (ev.type === "content_block_start" && ev.content_block.type === "server_tool_use") onEvent && onEvent("searching", {});
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { text += ev.delta.text; onText && onText(ev.delta.text, text); }
    }
    const msg = await stream.finalMessage();
    usage = msg.usage;
    for (const b of msg.content) {
      if (b.type === "server_tool_use" && b.name === "web_search") { const q = b.input?.query || ""; searches.push(q); onEvent && onEvent("search", { query: q }); }
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.type === "web_search_result") { sources.push({ url: r.url, title: r.title }); }
    }
    if (msg.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: msg.content }); continue; }
    if (msg.stop_reason === "refusal") throw new Error("The model declined this research request.");
    if (msg.stop_reason === "max_tokens") throw new Error("The research answer was cut off (max_tokens).");
    break;
  }
  return { text, searches, sources: dedupe(sources), usage };
}
const dedupe = (arr) => { const seen = new Set(); return arr.filter(s => s.url && !seen.has(s.url) && seen.add(s.url)); };
