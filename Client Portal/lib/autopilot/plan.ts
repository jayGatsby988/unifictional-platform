import type { PlanItem } from "../data/types";

/**
 * The content plan: a queue of planned posts per company. The bot drafts twelve
 * at a time, writes the next one on each run, and the client can skip or pull
 * one forward. Pure helpers; the plan itself lives in seo_autopilot.plan.
 */

export type PlanTopic = { title: string; targetQuery: string; angle: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Append new topics, skipping any whose target search is already in the plan. */
export function toPlanItems(topics: PlanTopic[], existing: PlanItem[] = []): PlanItem[] {
  const seen = new Set(existing.map((p) => norm(p.targetQuery)));
  const stamp = Date.now().toString(36);
  const fresh: PlanItem[] = [];
  topics.forEach((t, i) => {
    const key = norm(t.targetQuery);
    if (!t.title?.trim() || !key || seen.has(key)) return;
    seen.add(key);
    fresh.push({ id: `${stamp}${i.toString(36)}`, title: t.title.trim(), targetQuery: t.targetQuery.trim(), angle: (t.angle ?? "").trim(), status: "planned" });
  });
  return [...existing, ...fresh];
}

/** The first planned topic that hasn't already been written about. */
export function nextPlanned(plan: PlanItem[], written: { title: string; targetQuery: string | null }[]): PlanItem | null {
  const used = new Set(written.flatMap((w) => [norm(w.title), norm(w.targetQuery ?? "")]).filter(Boolean));
  return plan.find((p) => p.status === "planned" && !used.has(norm(p.targetQuery)) && !used.has(norm(p.title))) ?? null;
}

export function setStatus(plan: PlanItem[], id: string, status: PlanItem["status"]): PlanItem[] {
  return plan.map((p) => (p.id === id ? { ...p, status } : p));
}

export function moveToFront(plan: PlanItem[], id: string): PlanItem[] {
  const i = plan.findIndex((p) => p.id === id);
  if (i <= 0) return plan;
  const copy = [...plan];
  const [item] = copy.splice(i, 1);
  return [item, ...copy];
}

export const upcoming = (plan: PlanItem[]) => plan.filter((p) => p.status === "planned");
