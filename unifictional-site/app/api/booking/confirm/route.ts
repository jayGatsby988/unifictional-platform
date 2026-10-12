import { cleanWebsite } from "@/lib/build/url";
import { NextResponse, after } from "next/server";

import { bookingConfig, googleConfigured } from "@/lib/booking/config";
import { buildConfigured, siteOrigin } from "@/lib/build/pipeline";
import { startBuildAnywhere } from "@/lib/build/start";
import { isSlotAvailable } from "@/lib/booking/check";
import { sendClientConfirmation, sendOwnerNotification } from "@/lib/booking/email";
import { createCalendarEvent, findEventByBookingId } from "@/lib/booking/google";
import { buildICS, calendarLinks, type MeetingDetails } from "@/lib/booking/ics";
import { claimBooking, tooManyCodeAttempts } from "@/lib/booking/runtime-guard";
import { codeMatches, verifyToken } from "@/lib/booking/token";
import type { PendingBooking } from "@/lib/booking/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function buildMeeting(b: PendingBooking): MeetingDetails {
  const titleBiz = b.businessName ? ` (${b.businessName})` : "";
  const descLines = [
    `Discovery call with ${b.name}${b.businessName ? ` — ${b.businessName}` : ""}.`,
    "",
    `Name: ${b.name}`,
    `Email: ${b.email}`,
    `Phone: ${b.phone || "—"}`,
    b.businessName ? `Business: ${b.businessName}` : "",
    b.website ? `Website: ${b.website}` : "",
    b.services.length ? `Interested in: ${b.services.join(", ")}` : "",
    "",
    b.message ? `What they want more of:\n${b.message}` : "",
    "",
    "Booked via the Unifictional website.",
  ].filter((l) => l !== "");

  return {
    uid: `${b.bookingId}@unifictional`,
    title: `Discovery call — ${b.name}${titleBiz} × Unifictional`,
    description: descLines.join("\n"),
    location: bookingConfig.location,
    startISO: b.slotStartISO,
    endISO: b.slotEndISO,
    organizerName: bookingConfig.ownerName,
    organizerEmail: bookingConfig.ownerEmail,
    attendeeName: b.name,
    attendeeEmail: b.email,
  };
}

export async function POST(req: Request) {
  let body: { token?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const booking = verifyToken<PendingBooking>(body.token || "");
  if (!booking) {
    return NextResponse.json(
      { error: "expired", message: "Your session expired. Please start the booking again." },
      { status: 400 }
    );
  }
  if (!body.code || !codeMatches(body.code, booking.codeHash)) {
    if (tooManyCodeAttempts(booking.bookingId)) {
      return NextResponse.json(
        { error: "too_many_attempts", message: "Too many incorrect codes. Please start the booking again." },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: "bad_code", message: "That code doesn't match. Check your email and try again." },
      { status: 400 }
    );
  }

  const meeting = buildMeeting(booking);
  const stampISO = new Date().toISOString();

  // Idempotency: if we already booked this (double-submit), return success
  // without re-creating the event or re-emailing.
  let alreadyBooked = false;
  if (googleConfigured()) {
    try {
      const existing = await findEventByBookingId(booking.bookingId);
      alreadyBooked = !!existing;
    } catch (err) {
      console.error("[booking] idempotency check failed:", err);
    }
  }

  if (!alreadyBooked) {
    // Final guard against a race since the code was issued. Pin the lead-time
    // window to when the token was issued so a slow code entry isn't rejected.
    const issuedAt = booking.issuedAt ? new Date(booking.issuedAt) : new Date();
    try {
      const stillOpen = await isSlotAvailable(booking.slotStartISO, issuedAt);
      if (!stillOpen) {
        return NextResponse.json(
          { error: "slot_taken", message: "That time was just taken. Please pick another." },
          { status: 409 }
        );
      }
    } catch (err) {
      console.error("[booking] final availability check failed:", err);
      return NextResponse.json(
        { error: "calendar_error", message: "Couldn't reach the calendar. Please try again." },
        { status: 503 }
      );
    }

    const now = Date.now();
    const daysUntil = Math.ceil((new Date(booking.slotStartISO).getTime() - now) / 86_400_000);
    const reminderThresholdDays = daysUntil <= 7 ? Math.max(daysUntil, 0) : 5;

    if (googleConfigured()) {
      try {
        await createCalendarEvent({
          summary: meeting.title,
          description: meeting.description,
          location: meeting.location,
          startISO: meeting.startISO,
          endISO: meeting.endISO,
          attendeeEmail: booking.email,
          attendeeName: booking.name,
          bookingId: booking.bookingId,
          reminderThresholdDays,
          clientPhone: booking.phone,
        });
      } catch (err) {
        console.error("[booking] event insert failed:", err);
        return NextResponse.json(
          { error: "calendar_error", message: "We couldn't reserve that time. Please try again." },
          { status: 502 }
        );
      }
    }

    // Notifications (best-effort — a booking that's on the calendar shouldn't
    // fail just because an email bounced). Gated by a one-time claim, placed
    // AFTER the event write so a transient failure above stays retryable, so a
    // replayed {token,code} within the TTL can't re-send duplicate emails even
    // when the calendar (the durable idempotency source) is off.
    if (claimBooking(booking.bookingId)) {
      const ics = buildICS(meeting, stampISO);
      const icsBase64 = Buffer.from(ics, "utf8").toString("base64");

      // The AI build: research the business, write the site from the pack,
      // run the SEO agent, email the owner a preview. Runs after this response
      // is sent (each step is its own function invocation; see lib/build).
      const buildStarted = buildConfigured();
      if (buildStarted) {
        const origin = siteOrigin(req);
        const lead = {
          name: booking.name,
          email: booking.email,
          phone: booking.phone,
          businessName: booking.businessName,
          website: cleanWebsite(booking.website),
          companyDetails: booking.companyDetails || "",
          services: booking.services,
          message: booking.message,
          slotStartISO: booking.slotStartISO,
        };
        after(() =>
          startBuildAnywhere({ id: booking.bookingId, origin, lead })
            .then((r) => console.log(`[build] started via ${r.via}${r.runId ? " run " + r.runId : ""} for ${booking.bookingId}`))
            .catch((err) => console.error("[build] could not start:", err))
        );
      }

      await Promise.allSettled([
        sendOwnerNotification({
          startISO: booking.slotStartISO,
          client: {
            name: booking.name,
            email: booking.email,
            phone: booking.phone,
            businessName: booking.businessName,
            website: cleanWebsite(booking.website),
            companyDetails: booking.companyDetails,
            services: booking.services,
            message: booking.message,
          },
          buildStarted,
          // Until the calendar service account is configured, give the owner a
          // one-tap add-to-calendar; once it is, the booking is auto-synced and
          // these are suppressed.
          links: calendarLinks(meeting),
          icsBase64,
          autoSynced: googleConfigured(),
        }),
        sendClientConfirmation({
          to: booking.email,
          name: booking.name,
          startISO: booking.slotStartISO,
          links: calendarLinks(meeting),
          icsBase64,
        }),
      ]);
    }
  }

  const ics = buildICS(meeting, stampISO);
  return NextResponse.json({
    ok: true,
    alreadyBooked,
    connected: googleConfigured(),
    calendarChoice: booking.calendarChoice,
    meeting: {
      title: meeting.title,
      startISO: meeting.startISO,
      endISO: meeting.endISO,
      durationMin: bookingConfig.durationMin,
      timezone: bookingConfig.timezone,
      location: meeting.location,
    },
    links: calendarLinks(meeting),
    ics,
  });
}
