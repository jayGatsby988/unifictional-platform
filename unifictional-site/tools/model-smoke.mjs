// A two-call sanity check of the Fable request shapes (a few cents), not a build.
import Anthropic from "@anthropic-ai/sdk";
const c = new Anthropic();
const model = "claude-fable-5-1";
try {
  const s = c.beta.messages.stream({ model, max_tokens: 400, system: "Answer in five words.", messages: [{ role: "user", content: "What does a deck builder do?" }], output_config: { effort: "low" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  const m = await s.finalMessage();
  console.log("structured ok:", m.model, m.stop_reason, JSON.stringify(m.usage));
} catch (e) { console.log("structured FAILED:", e.status, e.message?.slice(0, 300)); }
try {
  const s = c.beta.messages.stream({ model, max_tokens: 600, system: "Use web_search once, then answer in one sentence.", messages: [{ role: "user", content: "What city is Blue Lake Construction LLC (contractor, Washington state) based in?" }], tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 1 }], output_config: { effort: "low" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  const m = await s.finalMessage();
  const searched = m.content.filter(b => b.type === "server_tool_use").length;
  console.log("research ok:", m.model, m.stop_reason, "searches", searched, JSON.stringify(m.usage).slice(0, 200));
} catch (e) { console.log("research FAILED:", e.status, e.message?.slice(0, 300)); }
