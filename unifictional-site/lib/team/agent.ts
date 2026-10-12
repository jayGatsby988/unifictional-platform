// @ts-nocheck
// One agent, one brain. Runs a role's model on its own key in a loop: it
// reads, decides, calls a tool, sees the result (text or screenshots), and
// goes on until it says it is done, or runs out of steps, time or budget.
// Nothing here knows about the roles; the role prompt, its memory, the board
// and the tools it may use all come in from the foreman.
import { anthropic, addUsage, costOf, describeError } from "../build/claude";
import { teamModel, type Role } from "./keys";

export interface AgentRun {
  role: Role; model: string; apiKey: string; system: string; task: string;
  tools: { defs: any[]; call: (name: string, input: any) => Promise<any>; serverTools?: any[] };
  maxSteps?: number; maxMs?: number; maxCost?: number; stamp?: (s: string) => void; images?: any[];
}

/** Turn a tool's return value into tool_result content (strings, or objects with images). */
function toContent(result) {
  if (result == null) return "ok";
  if (typeof result === "string") return result.slice(0, 60_000);
  if (Array.isArray(result?.content)) return result.content;
  if (result?.images?.length) {
    return [{ type: "text", text: String(result.text || "").slice(0, 60_000) }, ...result.images.slice(0, 14).flatMap(im => [{ type: "text", text: `[${im.label}]` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: im.data } }])];
  }
  return JSON.stringify(result).slice(0, 60_000);
}

export async function runAgent(run: AgentRun) {
  const { role, system, task, tools, stamp = () => {} } = run;
  const model = run.model || teamModel(role);
  const maxSteps = run.maxSteps ?? 40, maxMs = run.maxMs ?? 25 * 60_000, maxCost = run.maxCost ?? 12;
  const client = anthropic(run.apiKey);
  const messages = [{ role: "user", content: run.images?.length ? [{ type: "text", text: task }, ...run.images] : task }];
  const toolDefs = [...(tools.serverTools || []), ...tools.defs];
  let usage = null, steps = 0, done = null, lastText = "", nudges = 0;
  const t0 = Date.now();
  while (steps < maxSteps && Date.now() - t0 < maxMs) {
    steps++;
    let res;
    try {
      res = await client.messages.create({ model, max_tokens: 32000, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages, tools: toolDefs, output_config: { effort: "medium" } });
    } catch (e) {
      const msg = describeError(e);
      // no credits on this role's account: say so plainly and stop (nothing to retry)
      if (/credit balance|billing|purchase credits/i.test(msg)) { stamp(`${role}: its API account has no credits (${msg.slice(0, 80)}); stopped`); return { done: { summary: "stopped: no API credits on this role's account" }, steps, seconds: Math.round((Date.now() - t0) / 1000), usage, cost: costOf(usage || {}), noCredits: true }; }
      // a transient API error: one more try after a pause, then give up on this agent for this round
      stamp(`${role}: API error (${msg}); retrying once`);
      await new Promise(r => setTimeout(r, 15_000));
      try { res = await client.messages.create({ model, max_tokens: 32000, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages, tools: toolDefs, output_config: { effort: "medium" } }); }
      catch (e2) { stamp(`${role}: stopped after an API error: ${describeError(e2)}`); break; }
    }
    usage = addUsage(usage, res.usage, 0, model);
    const content = res.content || [];
    for (const b of content) if (b.type === "text" && b.text) lastText = b.text;
    const calls = content.filter(b => b.type === "tool_use");
    messages.push({ role: "assistant", content });
    if (!calls.length) {
      // the agent ended its turn with words instead of work: nudge it back to its tools (twice at most)
      if (!done && nudges < 2 && steps < maxSteps) {
        nudges++;
        const cut = res.stop_reason === "max_tokens";
        stamp(`${role}: ${cut ? "answer cut off at the output limit" : "ended without finishing"}; nudged`);
        messages.push({ role: "user", content: cut ? "Your last message was cut off at the output limit. Work in smaller steps: one tool call at a time, and split big data across several calls (for example label photos in batches of 20, or write one page per call). Continue now; when you are really finished, call done." : "You ended your turn without calling done. Do the work with your tools now (write_page, set_dossier, set_hook, look, and so on); when you are really finished, call done with your summary." });
        continue;
      }
      break;
    }
    // every tool_use gets a tool_result, whatever the stop reason (a cut-off call is answered with an error so the agent retries smaller)
    const results = [];
    for (const c of calls) {
      if (c.name === "done") { done = c.input || {}; results.push({ type: "tool_result", tool_use_id: c.id, content: "noted" }); continue; }
      let out;
      if (res.stop_reason === "max_tokens" && c === calls[calls.length - 1]) { results.push({ type: "tool_result", tool_use_id: c.id, content: "error: this call was cut off at the output limit and was not applied; send it again in smaller pieces", is_error: true }); continue; }
      try { out = await tools.call(c.name, c.input || {}); }
      catch (e) { out = `error: ${describeError(e)}`; }
      results.push({ type: "tool_result", tool_use_id: c.id, content: toContent(out) });
    }
    if (res.stop_reason === "max_tokens") results.push({ type: "text", text: "Your message was cut off at the output limit. Split big data across several smaller tool calls (photos in batches of 20, one page per call) and continue." });
    messages.push({ role: "user", content: results });
    if (done) break;
    if (costOf(usage) > maxCost) { stamp(`${role}: budget reached ($${costOf(usage).toFixed(2)}); wrapping up`); messages.push({ role: "user", content: "Your budget for this round is used up. Call done now with a summary of what you changed and what you still wanted to do." }); const fin = await client.messages.create({ model, max_tokens: 2000, system, messages, tools: toolDefs }).catch(() => null); if (fin) { usage = addUsage(usage, fin.usage, 0, model); const d = (fin.content || []).find(b => b.type === "tool_use" && b.name === "done"); if (d) done = d.input; } break; }
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  return { done: done || { summary: lastText.slice(0, 1200) || "(no summary)" }, steps, seconds, usage, cost: costOf(usage || {}) };
}
