// @ts-nocheck
// The shared board for one build: notes the agents leave each other
// ("Writer: the about page needs a second paragraph on the 1983 start",
// "Reviewer → Art director: the service rail is cramped on the phone").
// Kept at builds/<id>/team/board.json so the dashboard and the journal can
// show the conversation.
import { buildPath, saveJson } from "../build/storage";
import type { Role } from "./keys";

export interface Note { round: number; from: Role | "foreman"; to: Role | "all"; text: string; at: string }

export class Board {
  notes: Note[] = [];
  constructor(public id: string) {}
  post(round: number, from: Note["from"], to: Note["to"], text: string) {
    this.notes.push({ round, from, to, text: String(text || "").slice(0, 1500), at: new Date().toISOString() });
  }
  /** Notes addressed to a role (or to all), most recent first, capped. */
  forRole(role: Role, limit = 30) {
    return this.notes.filter(n => n.to === role || n.to === "all" || n.from === role).slice(-limit);
  }
  render(role?: Role) {
    const list = role ? this.forRole(role) : this.notes.slice(-60);
    if (!list.length) return "BOARD: no notes yet.";
    return `BOARD (round · from → to: note):\n${list.map(n => `r${n.round} · ${n.from} → ${n.to}: ${n.text}`).join("\n")}`;
  }
  async save() { try { await saveJson(buildPath(this.id, "team/board.json"), { notes: this.notes }); } catch {} }
}
