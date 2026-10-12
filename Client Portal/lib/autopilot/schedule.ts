import type { AutopilotCadence, PlanItem } from "../data/types";

/** How often the bot publishes. "weekly" is the default: four posts a month. */
export const CADENCES: { key: AutopilotCadence; label: string; hours: number; perMonth: string }[] = [
  { key: "weekly", label: "Every week", hours: 24 * 7, perMonth: "4 posts a month" },
  { key: "twice_weekly", label: "Twice a week", hours: 24 * 3.5, perMonth: "8 posts a month" },
  { key: "biweekly", label: "Every two weeks", hours: 24 * 14, perMonth: "2 posts a month" },
  { key: "monthly", label: "Once a month", hours: 24 * 30, perMonth: "1 post a month" },
];

export function isCadence(v: unknown): v is AutopilotCadence {
  return CADENCES.some((c) => c.key === v);
}

export function cadenceLabel(key: AutopilotCadence): string {
  const c = CADENCES.find((x) => x.key === key) ?? CADENCES[0];
  return `${c.label} · ${c.perMonth}`;
}

/** When the next post is due after a run at `from`. */
export function nextRunAt(cadence: AutopilotCadence, from = new Date()): string {
  const c = CADENCES.find((x) => x.key === cadence) ?? CADENCES[0];
  return new Date(from.getTime() + c.hours * 3600e3).toISOString();
}

/** A failed run tries again tomorrow instead of waiting a whole cycle. */
export function retryAt(from = new Date()): string {
  return new Date(from.getTime() + 24 * 3600e3).toISOString();
}

export function isDue(next: string | null, now = new Date()): boolean {
  return !next || new Date(next).getTime() <= now.getTime();
}

/**
 * Projected dates for the planned posts: the first one at the next run, then
 * one per cadence step. For the calendar; the real run can land a day later
 * (the cron is daily) and the plan can change, so these are "about".
 */
export function projectSchedule(plan: PlanItem[], nextRunAt: string | null, cadence: AutopilotCadence): { id: string; date: string }[] {
  const c = CADENCES.find((x) => x.key === cadence) ?? CADENCES[0];
  const start = nextRunAt ? new Date(nextRunAt) : new Date();
  return plan.filter((p) => p.status === "planned").map((p, i) => ({ id: p.id, date: new Date(start.getTime() + i * c.hours * 3600e3).toISOString() }));
}
