// @ts-nocheck
// Each agent's own memory: what it learned on earlier sites, in its own
// words, kept at team/memory/<role>.json and read into its system prompt at
// the start of every build. The agent adds to it during a build with the
// `remember` tool and, at the end, is asked for the lessons worth keeping.
// Capped at 24 entries, newest first; the agent itself prunes.
import { readJson, saveJson } from "../build/storage";
import type { Role } from "./keys";

export interface MemoryEntry { text: string; from: string; date: string }
const MAX = 24;
const path = (role: Role) => `team/memory/${role}.json`;

export async function loadMemory(role: Role): Promise<MemoryEntry[]> {
  try { const m = await readJson<{ entries: MemoryEntry[] }>(path(role)); return Array.isArray(m?.entries) ? m.entries.slice(0, MAX) : []; } catch { return []; }
}
export async function saveMemory(role: Role, entries: MemoryEntry[]) {
  try { await saveJson(path(role), { role, entries: entries.slice(0, MAX), updatedAt: new Date().toISOString() }); } catch {}
}
export function memoryBlock(entries: MemoryEntry[]) {
  if (!entries.length) return "YOUR MEMORY: empty. This is your first site; what you learn today you can keep with the remember tool.";
  return `YOUR MEMORY (what you learned on earlier sites, newest first):\n${entries.map((e, i) => `${i + 1}. ${e.text} (${e.from}, ${e.date})`).join("\n")}`;
}
/** Merge new lessons in front of the old ones, dropping near-duplicates. */
export function mergeMemory(old: MemoryEntry[], add: MemoryEntry[]) {
  const seen = new Set();
  const out = [];
  for (const e of [...add, ...old]) {
    const k = String(e?.text || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 80);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(e);
    if (out.length >= MAX) break;
  }
  return out;
}
