import { NextResponse } from "next/server";

import { bookingConfig, googleConfigured } from "@/lib/booking/config";
import { getBusyIntervals } from "@/lib/booking/google";
import {
  addDays,
  generateAvailability,
  todayInTz,
  zonedToUtc,
  type Interval,
} from "@/lib/booking/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tz = bookingConfig.timezone;
  const today = todayInTz(tz);

  let from = url.searchParams.get("from") || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from < today) from = today;

  const reqDays = parseInt(url.searchParams.get("days") || "14", 10);
  const days = Math.min(Math.max(Number.isFinite(reqDays) ? reqDays : 14, 1), bookingConfig.maxDaysAhead);

  // Window to query busy time for (start of `from` → start of day after range).
  const [fy, fm, fd] = from.split("-").map((n) => parseInt(n, 10));
  const timeMin = zonedToUtc(fy, fm, fd, 0, 0, tz);
  const last = addDays(from, days);
  const [ly, lm, ld] = last.split("-").map((n) => parseInt(n, 10));
  const timeMax = zonedToUtc(ly, lm, ld, 0, 0, tz);

  let busy: Interval[] = [];
  let connected = false;
  if (googleConfigured()) {
    try {
      busy = await getBusyIntervals(timeMin.toISOString(), timeMax.toISOString());
      connected = true;
    } catch (err) {
      console.error("[booking] freebusy query failed:", err);
      // Fail safe: if we can't read the calendar, show nothing rather than
      // double-booking the owner.
      return NextResponse.json(
        { error: "availability_unavailable", connected: false, days: [] },
        { status: 503 }
      );
    }
  }

  const availability = generateAvailability(from, days, busy);

  return NextResponse.json({
    timezone: tz,
    durationMin: bookingConfig.durationMin,
    connected,
    from,
    days: availability,
  });
}
