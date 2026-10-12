/**
 * Booking configuration — everything is env-driven so you set hours, timezone,
 * meeting length, calendar, and provider keys without touching code.
 * See .env.local.example for the full list + setup notes.
 */
function int(v: string | undefined, fallback: number): number {
  const n = parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

export const bookingConfig = {
  /** IANA timezone the working hours below are expressed in (e.g. America/New_York). */
  timezone: process.env.BOOKING_TIMEZONE || "America/New_York",
  /** Bookable window, local to `timezone`. Default 7:00 → 23:00 (7am–11pm). */
  hoursStart: int(process.env.BOOKING_HOURS_START, 7),
  hoursEnd: int(process.env.BOOKING_HOURS_END, 23),
  /** Meeting length + slot granularity (minutes). */
  durationMin: int(process.env.BOOKING_DURATION_MIN, 30),
  slotStepMin: int(process.env.BOOKING_SLOT_STEP_MIN, 30),
  /** Gap to keep around existing events (minutes). */
  bufferMin: int(process.env.BOOKING_BUFFER_MIN, 0),
  /** Minimum notice before a slot can be booked (minutes). Default 12h. */
  leadMinutes: int(process.env.BOOKING_LEAD_MIN, 720),
  /** How far ahead bookings are allowed (days). */
  maxDaysAhead: int(process.env.BOOKING_MAX_DAYS, 60),

  ownerName: process.env.OWNER_NAME || "Unifictional",
  ownerEmail: process.env.OWNER_EMAIL || "Unifictional@gmail.com",
  brand: process.env.BRAND_NAME || "Unifictional",
  /** Calendar to read availability from + write events to. */
  calendarId:
    process.env.GOOGLE_CALENDAR_ID || process.env.OWNER_EMAIL || "Unifictional@gmail.com",

  /** Where the meeting happens — shown on the invite/emails. */
  location: process.env.BOOKING_LOCATION || "Phone call — we'll call you at the number you provide",
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:4760").replace(/\/$/, ""),
  /** Verified sender, e.g. "Unifictional <hello@yourdomain.com>" (Resend path). */
  emailFrom: process.env.EMAIL_FROM || "Unifictional <onboarding@resend.dev>",

  /** Gmail SMTP (App Password) — sends genuinely *from* this address. */
  gmailUser: (process.env.GMAIL_USER || "").trim(),
  // Google shows App Passwords as "abcd efgh ijkl mnop" — strip the spaces.
  gmailAppPassword: (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, ""),

  /**
   * Add the client as a calendar *attendee* (so Google emails them an invite).
   * A service account on a personal Gmail can't do this — Google rejects it
   * without Workspace domain-wide delegation — so it's off by default. The
   * client still gets the .ics + add-to-calendar links in their confirmation
   * email. Turn on only with a Workspace account + delegation.
   */
  inviteAttendees: process.env.GOOGLE_INVITE_ATTENDEES === "true",

  /** HMAC secret for the stateless verification tokens. */
  secret: process.env.BOOKING_SECRET || (process.env.NODE_ENV === "production" ? "" : "dev-insecure-secret-change-me"),
  /** Shared secret protecting the reminder cron endpoint. */
  cronSecret: process.env.CRON_SECRET || "",
};

export function googleConfigured(): boolean {
  return (
    (!!process.env.GOOGLE_CLIENT_EMAIL && !!process.env.GOOGLE_PRIVATE_KEY) ||
    !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  );
}

/** Gmail SMTP is usable when both the address and an App Password are present. */
export function gmailConfigured(): boolean {
  return !!bookingConfig.gmailUser && !!bookingConfig.gmailAppPassword;
}

export function resendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/** Any working email transport — Gmail SMTP is preferred over Resend. */
export function emailConfigured(): boolean {
  return gmailConfigured() || resendConfigured();
}

export function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}
