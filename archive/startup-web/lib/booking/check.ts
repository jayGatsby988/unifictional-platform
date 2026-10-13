import { bookingConfig, googleConfigured } from "./config";
import { getBusyIntervals } from "./google";
import { addDays, generateAvailability, todayInTz, zonedToUtc, type Interval } from "./time";

/**
 * Authoritative "is this slot still bookable right now" check — re-derives the
 * day's real availability (busy time + lead window + hours) and confirms the
 * exact slot is offered. Used at start + confirm so a stale UI can't double-book.
 *
 * `asOf` pins the lead-time window. At /start it's "now"; at /confirm it's the
 * token-issue time, so a user who spends a couple minutes entering their code
 * doesn't get a false "slot taken" on the earliest slot of the day.
 */
export async function isSlotAvailable(
  slotStartISO: string,
  asOf: Date = new Date()
): Promise<boolean> {
  const tz = bookingConfig.timezone;
  const start = new Date(slotStartISO);
  if (Number.isNaN(start.getTime())) return false;

  const dayStr = todayInTz(tz, start); // the slot's calendar date in owner tz

  // Enforce the bookable date window (lead-time blocks past *times*, but reject
  // past days and anything beyond maxDaysAhead so direct POSTs can't bypass it).
  const todayStr = todayInTz(tz, asOf);
  if (dayStr < todayStr || dayStr > addDays(todayStr, bookingConfig.maxDaysAhead)) return false;

  const [y, m, d] = dayStr.split("-").map((n) => parseInt(n, 10));

  let busy: Interval[] = [];
  if (googleConfigured()) {
    const dayStart = zonedToUtc(y, m, d, 0, 0, tz);
    const dayEnd = zonedToUtc(y, m, d + 1, 0, 0, tz);
    busy = await getBusyIntervals(dayStart.toISOString(), dayEnd.toISOString());
  }

  const [day] = generateAvailability(dayStr, 1, busy, asOf);
  return !!day && day.slots.some((s) => s.startISO === slotStartISO);
}
