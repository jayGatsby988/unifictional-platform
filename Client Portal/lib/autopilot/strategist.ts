/* eslint-disable @typescript-eslint/no-explicit-any -- rows are untyped until `supabase gen types` runs against the live schema */
import { randomUUID } from "node:crypto";
import type { PlanItem, StrategistMessage } from "@/lib/data/types";
import { llmClient, llmConfigured } from "./generate";
import { moveToFront, setStatus, toPlanItems } from "./plan";
import type { SiteProfile } from "./profile";

/**
 * The SEO strategist the client talks to: "I want more kitchen jobs in
 * Lynnwood", "go deeper into gold-filled bangles", "how are we doing?". It
 * reads everything the autopilot knows (profile, plan, posts, Search Console,
 * fixes) and changes the plan through tools instead of telling the client to
 * click things. Pure helpers (`applyAction`) are separate from the model loop
 * so they can be tested.
 */

export const STRATEGIST_MODEL = "claude-sonnet-5-5";
export const MAX_CHAT = 40;
export const MAX_FOCUS = 20;

export type StrategistContext = {
  company: { name: string; industry: string; city: string; websiteUrl: string };
  profile: SiteProfile | null;
  settings: { notes: string; focusKeywords: string[]; cadence: string; mode: string; target: string; nextRunAt: string | null; plan: PlanItem[] };
  posts: { title: string; status: string; targetQuery: string; score: number | null; clicks: number | null; impressions: number | null; position: number | null; publishedAt: string | null }[];
  keywords: { keyword: string; position: number | null; clicks: number; impressions: number; url: string }[];
  fixes: { title: string; done: boolean }[];
};

/** Everything the strategist may use, as plain text. Nothing invented: these are the records. */
export function contextText(c: StrategistContext): string {
  const L: string[] = [];
  L.push(`# Company`, `Name: ${c.company.name}`, `Business: ${c.company.industry || c.profile?.industry || "unknown"}`, `Area: ${c.company.city || c.profile?.city || "unknown"}`, `Website: ${c.company.websiteUrl || "none"}`);
  if (c.profile) {
    L.push(`Who they sell to: ${c.profile.audience}`);
    if (c.profile.services.length) L.push(`What they offer: ${c.profile.services.join(", ")}`);
    if (c.profile.searchSeeds.length) L.push(`Searches their customers type: ${c.profile.searchSeeds.join("; ")}`);
  }
  L.push("", `# Autopilot settings`, `Cadence: ${c.settings.cadence} · review: ${c.settings.mode} · publishes to: ${c.settings.target}`, `Next post: ${c.settings.nextRunAt ?? "soon"}`);
  L.push(`Owner's direction (notes the writer follows): ${c.settings.notes.trim() || "(none yet)"}`);
  L.push(`Priority searches the owner asked for: ${c.settings.focusKeywords.length ? c.settings.focusKeywords.join("; ") : "(none yet)"}`);
  L.push("", `# Content plan (id · status · title · target search)`);
  for (const p of c.settings.plan.slice(0, 30)) L.push(`- ${p.id} · ${p.status} · ${p.title} · "${p.targetQuery}"`);
  if (!c.settings.plan.length) L.push("(empty: the next run drafts twelve topics from the notes and priority searches)");
  L.push("", `# Posts so far (newest first)`);
  for (const p of c.posts.slice(0, 15)) L.push(`- ${p.status} · ${p.title} · for "${p.targetQuery}"${p.score != null ? ` · SEO check ${p.score}/100` : ""}${p.clicks != null ? ` · Google: ${p.clicks} clicks, ${p.impressions ?? 0} impressions${p.position != null ? `, position ${p.position}` : ""}` : ""}${p.publishedAt ? ` · ${p.publishedAt.slice(0, 10)}` : ""}`);
  if (!c.posts.length) L.push("(none yet)");
  L.push("", `# Google Search Console (what the site already shows up for; position = average rank; empty until connected)`);
  for (const k of c.keywords.slice(0, 30)) L.push(`- "${k.keyword}" · position ${k.position ?? "?"} · ${k.clicks} clicks · ${k.impressions} impressions${k.url ? ` · ${k.url}` : ""}`);
  if (!c.keywords.length) L.push("(not connected yet: no ranking data)");
  L.push("", `# On-page fixes suggested`);
  for (const f of c.fixes.slice(0, 10)) L.push(`- [${f.done ? "done" : "open"}] ${f.title}`);
  if (!c.fixes.length) L.push("(none yet)");
  return L.join("\n");
}

export const SYSTEM = `You are the client's SEO strategist inside Unifictional's SEO Autopilot. The client is a business owner, not a marketer. You know their records (below) and you can change their plan with tools.

How to behave
- Answer the question first, in plain English, short (under 180 words unless they ask for a plan). Use the real numbers from the records; never invent rankings, clicks or results. If Search Console isn't connected, say progress will show once it is, and judge progress by posts published and the plan.
- When they say what they want more of (a service, a product line, a town, a type of customer), ACT: call set_focus with a tight one-or-two-sentence direction that keeps anything still true from the old direction, add_keywords with 3-8 exact searches customers would type, and add_topics with 3-5 concrete posts (titles 45-65 characters, one search each, one-line angle). Then tell them what you changed. Don't ask permission for these; they asked.
- To change course entirely, clear_plan after set_focus so the next run drafts twelve new topics.
- Skip or prioritise a specific topic only when they point at one.
- Posts are written on their schedule by the autopilot; you can't write one right now. "Write a post now" on their page does that.
- No emojis, no hype. One idea per sentence.`;

export type Action =
  | { type: "set_focus"; focus: string }
  | { type: "add_keywords"; keywords: string[] }
  | { type: "remove_keywords"; keywords: string[] }
  | { type: "add_topics"; topics: { title: string; targetQuery: string; angle: string }[] }
  | { type: "skip_topic"; id: string }
  | { type: "prioritize_topic"; id: string }
  | { type: "clear_plan" };

export const TOOLS = [
  { name: "set_focus", description: "Replace the owner's direction notes the writer follows (what to push, what to avoid). One or two sentences; keep what's still true from the old notes.", input_schema: { type: "object", properties: { focus: { type: "string" } }, required: ["focus"] } },
  { name: "add_keywords", description: "Add priority searches (exact phrases customers type) the posts should go after first.", input_schema: { type: "object", properties: { keywords: { type: "array", items: { type: "string" } } }, required: ["keywords"] } },
  { name: "remove_keywords", description: "Remove priority searches that no longer matter.", input_schema: { type: "object", properties: { keywords: { type: "array", items: { type: "string" } } }, required: ["keywords"] } },
  { name: "add_topics", description: "Add planned posts to the front of the content plan.", input_schema: { type: "object", properties: { topics: { type: "array", items: { type: "object", properties: { title: { type: "string" }, targetQuery: { type: "string" }, angle: { type: "string" } }, required: ["title", "targetQuery", "angle"] } } }, required: ["topics"] } },
  { name: "skip_topic", description: "Skip a planned topic by id.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "prioritize_topic", description: "Make a planned topic the next one written, by id.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "clear_plan", description: "Drop every remaining planned topic so the next run drafts a fresh twelve from the new direction.", input_schema: { type: "object", properties: {}, required: [] } },
] as const;

export type PlanState = { notes: string; focusKeywords: string[]; plan: PlanItem[] };

const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Applies one action to the plan state. Pure. Returns the new state and a one-line label for the client. */
export function applyAction(state: PlanState, action: Action): { state: PlanState; label: string } {
  switch (action.type) {
    case "set_focus": {
      const focus = clean(action.focus, 2000);
      return { state: { ...state, notes: focus }, label: `Updated your direction: “${focus.slice(0, 90)}${focus.length > 90 ? "…" : ""}”` };
    }
    case "add_keywords": {
      const add = (action.keywords ?? []).map((k) => clean(k, 80).toLowerCase()).filter(Boolean);
      const next = [...new Set([...state.focusKeywords, ...add])].slice(0, MAX_FOCUS);
      const added = next.filter((k) => !state.focusKeywords.includes(k));
      return { state: { ...state, focusKeywords: next }, label: added.length ? `Added ${added.length} priority search${added.length === 1 ? "" : "es"}: ${added.join(", ")}` : "Those searches were already on the list" };
    }
    case "remove_keywords": {
      const drop = new Set((action.keywords ?? []).map((k) => clean(k, 80).toLowerCase()));
      const next = state.focusKeywords.filter((k) => !drop.has(k));
      return { state: { ...state, focusKeywords: next }, label: `Removed ${state.focusKeywords.length - next.length} priority search${state.focusKeywords.length - next.length === 1 ? "" : "es"}` };
    }
    case "add_topics": {
      const topics = (action.topics ?? []).slice(0, 5).map((t) => ({ title: clean(t.title, 120), targetQuery: clean(t.targetQuery, 120), angle: clean(t.angle, 300) })).filter((t) => t.title && t.targetQuery);
      const merged = toPlanItems(topics, state.plan);
      const fresh = merged.filter((p) => !state.plan.some((q) => q.id === p.id));
      // New topics go first: they're what the owner just asked for.
      const plan = [...fresh, ...merged.filter((p) => !fresh.includes(p))];
      return { state: { ...state, plan }, label: fresh.length ? `Added ${fresh.length} topic${fresh.length === 1 ? "" : "s"} to the front of the plan: ${fresh.map((p) => p.title).join(" · ")}` : "Those topics were already planned" };
    }
    case "skip_topic": {
      const t = state.plan.find((p) => p.id === action.id);
      return { state: { ...state, plan: setStatus(state.plan, action.id, "skipped") }, label: t ? `Skipped “${t.title}”` : "That topic wasn't in the plan" };
    }
    case "prioritize_topic": {
      const t = state.plan.find((p) => p.id === action.id);
      return { state: { ...state, plan: moveToFront(state.plan, action.id) }, label: t ? `“${t.title}” is next` : "That topic wasn't in the plan" };
    }
    case "clear_plan": {
      const n = state.plan.filter((p) => p.status === "planned").length;
      return { state: { ...state, plan: state.plan.map((p) => (p.status === "planned" ? { ...p, status: "skipped" as const } : p)) }, label: `Cleared ${n} planned topic${n === 1 ? "" : "s"}; the next run drafts a fresh plan from your new direction` };
    }
  }
}

/** Keeps the conversation to the last MAX_CHAT turns. */
export const trimChat = (chat: StrategistMessage[]) => chat.slice(-MAX_CHAT);

/**
 * One turn: the client's message in, the strategist's reply and the actions
 * it took out. State changes are written through `save` as they happen.
 */
export async function runStrategist(input: {
  context: StrategistContext;
  history: StrategistMessage[];
  message: string;
  state: PlanState;
  save: (state: PlanState) => Promise<void>;
}): Promise<{ reply: string; actions: string[]; state: PlanState }> {
  if (!llmConfigured()) throw new Error("ANTHROPIC_API_KEY is not set (Setup & keys).");
  const client = llmClient();
  let state = input.state;
  const actions: string[] = [];
  const history = input.history.slice(-12).map((m) => ({ role: m.role, content: m.content }));
  const messages: any[] = [...history, { role: "user", content: input.message }];
  const system = [{ type: "text" as const, text: `${SYSTEM}\n\n# Records\n${contextText({ ...input.context, settings: { ...input.context.settings, notes: state.notes, focusKeywords: state.focusKeywords, plan: state.plan } })}` }];
  let reply = "";
  for (let round = 0; round < 6; round++) {
    const res = await client.messages.create({ model: STRATEGIST_MODEL, max_tokens: 1500, system, tools: TOOLS as any, messages });
    const text = res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    if (text) reply = text;
    const uses = res.content.filter((b: any) => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) break;
    messages.push({ role: "assistant", content: res.content });
    const results: any[] = [];
    for (const u of uses as any[]) {
      const action = { type: u.name, ...(u.input ?? {}) } as Action;
      try {
        const r = applyAction(state, action);
        state = r.state;
        actions.push(r.label);
        await input.save(state);
        results.push({ type: "tool_result", tool_use_id: u.id, content: r.label });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: u.id, content: `Could not apply: ${e instanceof Error ? e.message : String(e)}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  if (!reply) reply = actions.length ? "Done. Here's what changed:\n" + actions.map((a) => `- ${a}`).join("\n") : "I didn't catch that. Tell me what you'd like more of, or ask how things are going.";
  return { reply, actions, state };
}

export const newId = () => randomUUID();
