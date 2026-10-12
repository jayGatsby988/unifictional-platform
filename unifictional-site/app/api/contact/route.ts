import { NextResponse } from "next/server";

/**
 * Booking / strategy-call request handler.
 *
 * Validates the payload and logs it server-side, then returns success. The lead
 * is genuinely received here — it is NOT yet forwarded anywhere.
 *
 * TODO: connect this to where your leads should land:
 *   • Email   — Resend / SendGrid / Nodemailer
 *   • CRM     — HubSpot / GoHighLevel, or a Zapier/Make webhook
 *   • Storage — Supabase / Postgres / Airtable
 */
export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { name, email, phone } = data ?? {};

    if (!name || !email || !phone) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields (name, email, phone)." },
        { status: 400 }
      );
    }

    // TODO: replace this log with your email/CRM/database integration.
    console.log("[Unifictional Studio] New call request:", data);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
}
