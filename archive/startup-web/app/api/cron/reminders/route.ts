import { NextResponse } from "next/server";

import { bookingConfig, googleConfigured, isProd } from "@/lib/booking/config";
import { sendReminderEmail } from "@/lib/booking/email";
import { listUpcomingBookings, markReminderSent } from "@/lib/booking/google";
import { isValidEmail } from "@/lib/booking/token";
import { todayInTz } from "@/lib/booking/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: Request): boolean {
  const secret = bookingConfig.cronSecret;
  if (!secret) return !isProd(); // no secret set: allow only outside production
  // Header-only — never accept the secret in the URL (it would leak into access
  // logs / Referer). Vercel Cron sends it as `Authorization: Bearer`.
  const auth = req.headers.get("authorization");
  const headerSecret = req.headers.get("x-cron-secret");
  return auth === `Bearer ${secret}` || headerSecret === secret;
}

/** Calendar-day difference (slot date − today) in the owner timezone. */
function daysBetween(todayStr: string, slotStartISO: string): number {
  const tz = bookingConfig.timezone;
  const slotDateStr = todayInTz(tz, new Date(slotStartISO));
  const [ty, tm, td] = todayStr.split("-").map((n) => parseInt(n, 10));
  const [sy, sm, sd] = slotDateStr.split("-").map((n) => parseInt(n, 10));
  return Math.round((Date.UTC(sy, sm - 1, sd) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

async function run(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!googleConfigured()) {
    return NextResponse.json({ ok: true, skipped: "google_not_configured", sent: 0 });
  }

  const tz = bookingConfig.timezone;
  const today = todayInTz(tz);

  let bookings;
  try {
    bookings = await listUpcomingBookings(8);
  } catch (err) {
    console.error("[cron] failed to list bookings:", err);
    return NextResponse.json({ error: "calendar_error" }, { status: 503 });
  }

  let sent = 0;
  let skipped = 0;
  const results: { id: string; daysUntil: number; sent: boolean; reason?: string }[] = [];

  for (const b of bookings) {
    const daysUntil = daysBetween(today, b.startISO);

    // Reminder rules:
    //  - booked ≤7 days out → daily from booking until the meeting (threshold = daysUntilAtBooking)
    //  - booked >7 days out → daily starting when 5 days remain (threshold = 5)
    // The threshold was frozen at booking time; here we just fire daily once
    // we're inside it, at most once per day.
    const within = daysUntil >= 0 && daysUntil <= b.reminderThresholdDays;
    const alreadyToday = b.lastReminderDate === today;

    if (!within) {
      skipped++;
      results.push({ id: b.id, daysUntil, sent: false, reason: "outside_window" });
      continue;
    }
    if (alreadyToday) {
      skipped++;
      results.push({ id: b.id, daysUntil, sent: false, reason: "already_sent_today" });
      continue;
    }
    if (!isValidEmail(b.clientEmail)) {
      skipped++;
      results.push({ id: b.id, daysUntil, sent: false, reason: "no_email" });
      continue;
    }

    const result = await sendReminderEmail({
      to: b.clientEmail,
      name: b.clientName,
      startISO: b.startISO,
      daysUntil,
    });
    if (result.sent) {
      try {
        await markReminderSent(b.id, b.privateProps, today);
      } catch (err) {
        console.error("[cron] failed to mark reminder sent:", err);
      }
      sent++;
      results.push({ id: b.id, daysUntil, sent: true });
    } else {
      skipped++;
      results.push({ id: b.id, daysUntil, sent: false, reason: result.error || "send_failed" });
    }
  }

  return NextResponse.json({ ok: true, date: today, processed: bookings.length, sent, skipped, results });
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
