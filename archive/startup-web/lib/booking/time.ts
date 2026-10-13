import { bookingConfig } from "./config";

export interface Interval {
  start: number; // epoch ms
  end: number;
}

export interface Slot {
  startISO: string;
  endISO: string;
  label: string; // "7:00 AM"
}

export interface DayAvailability {
  date: string; // YYYY-MM-DD (in the owner timezone)
  weekday: string; // "Mon"
  dayLabel: string; // "Mon, Jun 23"
  slots: Slot[];
}

/** Offset (ms) between wall-clock time in `tz` and UTC, for the given instant. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const m: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = parseInt(p.value, 10);
  const asUTC = Date.UTC(m.year, m.month - 1, m.day, m.hour, m.minute, m.second);
  return asUTC - date.getTime();
}

/** Convert a wall-clock time in `tz` to a UTC instant (DST-aware). */
export function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  min: number,
  tz: string
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, min, 0);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let instant = guess - off1;
  const off2 = tzOffsetMs(new Date(instant), tz);
  if (off2 !== off1) instant = guess - off2;
  return new Date(instant);
}

export function formatTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDayLabel(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatFullDateTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/** Today's calendar date (YYYY-MM-DD) in the given timezone. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Add N days to a YYYY-MM-DD string (calendar math, DST-safe). */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

function overlaps(aStart: number, aEnd: number, busy: Interval[], bufferMs: number): boolean {
  for (const b of busy) {
    if (aStart < b.end + bufferMs && aEnd + bufferMs > b.start) return true;
  }
  return false;
}

/**
 * Build per-day availability for the next `days` days, excluding `busy`
 * intervals, past times, and anything inside the lead-time window.
 */
export function generateAvailability(
  fromDate: string, // YYYY-MM-DD (owner tz)
  days: number,
  busy: Interval[],
  now: Date = new Date()
): DayAvailability[] {
  const cfg = bookingConfig;
  const tz = cfg.timezone;
  const bufferMs = cfg.bufferMin * 60_000;
  const minBookable = now.getTime() + cfg.leadMinutes * 60_000;

  const [fy, fm, fd] = fromDate.split("-").map((n) => parseInt(n, 10));
  const dayCounter = Date.UTC(fy, fm - 1, fd);

  const out: DayAvailability[] = [];

  for (let i = 0; i < days; i++) {
    const dt = new Date(dayCounter + i * 86_400_000);
    const y = dt.getUTCFullYear();
    const mo = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();

    const slots: Slot[] = [];
    const seenISO = new Set<string>();
    const startMin = cfg.hoursStart * 60;
    const endMin = cfg.hoursEnd * 60 - cfg.durationMin;

    for (let min = startMin; min <= endMin; min += cfg.slotStepMin) {
      const startUtc = zonedToUtc(y, mo, d, Math.floor(min / 60), min % 60, tz);
      const startMs = startUtc.getTime();
      const endMs = startMs + cfg.durationMin * 60_000;

      if (startMs < minBookable) continue;
      if (overlaps(startMs, endMs, busy, bufferMs)) continue;

      // DST spring-forward maps a nonexistent wall-clock hour back onto a real
      // instant — dedupe so two grid buttons can't share one startISO.
      const iso = startUtc.toISOString();
      if (seenISO.has(iso)) continue;
      seenISO.add(iso);

      slots.push({
        startISO: iso,
        endISO: new Date(endMs).toISOString(),
        label: formatTime(startUtc, tz),
      });
    }

    // Representative date label uses noon to avoid DST/midnight edges.
    const labelInstant = zonedToUtc(y, mo, d, 12, 0, tz);
    out.push({
      date: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      weekday: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(
        labelInstant
      ),
      dayLabel: formatDayLabel(labelInstant, tz),
      slots,
    });
  }

  return out;
}
