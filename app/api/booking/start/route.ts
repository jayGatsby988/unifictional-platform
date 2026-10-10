import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { bookingConfig, emailConfigured, isProd } from "@/lib/booking/config";
import { isSlotAvailable } from "@/lib/booking/check";
import { sendVerificationEmail } from "@/lib/booking/email";
import { rateLimited } from "@/lib/booking/runtime-guard";
import { generateCode, hashCode, isValidEmail, signToken } from "@/lib/booking/token";
import { CALENDAR_CHOICES, sanitizeClient, type CalendarChoice } from "@/lib/booking/types";

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TTL_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // If no email transport is configured in production, fail clearly instead of
  // claiming "we sent a code" the user can never receive.
  if (isProd() && !emailConfigured()) {
    return NextResponse.json(
      { error: "email_unavailable", message: "Booking is temporarily unavailable — please email us directly." },
      { status: 503 }
    );
  }

  const client = sanitizeClient(body);
  const slotStartISO = typeof body.slotStartISO === "string" ? body.slotStartISO : "";
  const calendarChoice = body.calendarChoice as CalendarChoice;

  // ---- validation -------------------------------------------------------
  if (!client.name) {
    return NextResponse.json({ error: "missing_name", message: "Please add your name." }, { status: 400 });
  }
  if (!isValidEmail(client.email)) {
    return NextResponse.json(
      { error: "invalid_email", message: "Please enter a valid email address." },
      { status: 400 }
    );
  }
  if (!client.phone) {
    return NextResponse.json(
      { error: "missing_phone", message: "Please add a phone number." },
      { status: 400 }
    );
  }
  if (!CALENDAR_CHOICES.includes(calendarChoice)) {
    return NextResponse.json(
      { error: "missing_calendar", message: "Please choose how you'll add this to your calendar." },
      { status: 400 }
    );
  }
  const start = new Date(slotStartISO);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "invalid_slot" }, { status: 400 });
  }

  // ---- abuse guard (best-effort, per warm instance) ---------------------
  const email = client.email.toLowerCase();
  if (
    rateLimited(`start:ip:${clientIp(req)}`, 10, 60_000) ||
    rateLimited(`start:email:${email}`, 5, 60 * 60_000)
  ) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many requests — please wait a moment and try again." },
      { status: 429 }
    );
  }

  // ---- slot still open? -------------------------------------------------
  let available = false;
  try {
    available = await isSlotAvailable(slotStartISO);
  } catch (err) {
    console.error("[booking] slot check failed:", err);
    return NextResponse.json({ error: "calendar_error", message: "Couldn't reach the calendar. Try again." }, { status: 503 });
  }
  if (!available) {
    return NextResponse.json(
      { error: "slot_taken", message: "That time was just taken. Please pick another." },
      { status: 409 }
    );
  }

  // ---- issue verification code -----------------------------------------
  const slotEndISO = new Date(start.getTime() + bookingConfig.durationMin * 60_000).toISOString();
  const code = generateCode();
  const bookingId = crypto.randomUUID();
  const token = signToken(
    {
      ...client,
      slotStartISO,
      slotEndISO,
      calendarChoice,
      bookingId,
      codeHash: hashCode(code),
      issuedAt: Date.now(),
    },
    TTL_MS
  );

  const emailResult = await sendVerificationEmail({ to: client.email, name: client.name, code });
  if (emailConfigured() && !emailResult.sent) {
    console.error("[booking] verification email failed:", emailResult.error);
    return NextResponse.json(
      { error: "email_failed", message: "We couldn't send your code. Please try again." },
      { status: 502 }
    );
  }

  const res: Record<string, unknown> = {
    ok: true,
    token,
    expiresInSec: TTL_MS / 1000,
    emailSent: emailResult.sent,
  };
  // Local/dev convenience: when no email provider is wired up, surface the code
  // so the flow is fully testable. Never happens in production.
  if (!emailConfigured() && !isProd()) res.devCode = code;

  return NextResponse.json(res);
}
