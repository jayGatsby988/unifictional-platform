import { google } from "googleapis";

import { bookingConfig } from "./config";
import { todayInTz, zonedToUtc, type Interval } from "./time";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

function getAuth() {
  let clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const json = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    clientEmail = json.client_email;
    privateKey = json.private_key;
  }
  if (!clientEmail || !privateKey) {
    throw new Error("Google service account is not configured");
  }
  // Env vars often store the PEM with literal \n — normalize to real newlines.
  privateKey = privateKey.replace(/\\n/g, "\n");

  return new google.auth.JWT({ email: clientEmail, key: privateKey, scopes: SCOPES });
}

function calendarClient() {
  return google.calendar({ version: "v3", auth: getAuth() });
}

/** Busy intervals on the owner calendar between two instants. */
export async function getBusyIntervals(
  timeMinISO: string,
  timeMaxISO: string
): Promise<Interval[]> {
  const cal = calendarClient();
  const res = await cal.freebusy.query({
    requestBody: {
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      timeZone: "UTC",
      items: [{ id: bookingConfig.calendarId }],
    },
  });
  const entry = res.data.calendars?.[bookingConfig.calendarId];
  // Fail CLOSED: if the calendar wasn't reachable (e.g. not shared with the
  // service account), freebusy returns per-calendar `errors` and no `busy`.
  // Treating that as "all free" would silently double-book — so throw instead.
  if (!entry || entry.errors?.length) {
    throw new Error(
      `freebusy unavailable for ${bookingConfig.calendarId}: ${JSON.stringify(entry?.errors ?? "calendar missing from response")}`
    );
  }
  const busy = entry.busy ?? [];
  return busy
    .filter((b) => b.start && b.end)
    .map((b) => ({ start: new Date(b.start!).getTime(), end: new Date(b.end!).getTime() }));
}

export interface CreateEventInput {
  summary: string;
  description: string;
  location: string;
  startISO: string;
  endISO: string;
  attendeeEmail: string;
  attendeeName: string;
  bookingId: string;
  reminderThresholdDays: number;
  clientPhone: string;
}

/** Insert the booking onto the owner's Google Calendar. */
export async function createCalendarEvent(input: CreateEventInput) {
  const cal = calendarClient();
  // A service account on a personal Gmail can't invite attendees (Google 403s
  // without Workspace domain-wide delegation), so only attach the client as an
  // attendee when explicitly enabled. Otherwise the event still lands on the
  // owner's calendar and the client gets their invite via the confirmation email.
  const withAttendees = bookingConfig.inviteAttendees;
  const res = await cal.events.insert({
    calendarId: bookingConfig.calendarId,
    sendUpdates: withAttendees ? "all" : "none",
    requestBody: {
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: { dateTime: input.startISO, timeZone: bookingConfig.timezone },
      end: { dateTime: input.endISO, timeZone: bookingConfig.timezone },
      ...(withAttendees
        ? { attendees: [{ email: input.attendeeEmail, displayName: input.attendeeName }] }
        : {}),
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 24 * 60 },
          { method: "popup", minutes: 30 },
        ],
      },
      extendedProperties: {
        private: {
          unifictionalBooking: "1",
          bookingId: input.bookingId,
          clientEmail: input.attendeeEmail,
          clientName: input.attendeeName,
          clientPhone: input.clientPhone,
          reminderThresholdDays: String(input.reminderThresholdDays),
          lastReminderDate: "",
        },
      },
    },
  });
  return res.data;
}

/** Guard against a double-confirm creating two events for one booking. */
export async function findEventByBookingId(bookingId: string) {
  const cal = calendarClient();
  const res = await cal.events.list({
    calendarId: bookingConfig.calendarId,
    privateExtendedProperty: [`bookingId=${bookingId}`],
    singleEvents: true,
    maxResults: 1,
  });
  return res.data.items?.[0] ?? null;
}

export interface UpcomingBooking {
  id: string;
  startISO: string;
  endISO: string;
  summary: string;
  clientEmail: string;
  clientName: string;
  reminderThresholdDays: number;
  lastReminderDate: string;
  privateProps: Record<string, string>;
}

/** All future Unifictional bookings within `daysAhead` (for the reminder cron). */
export async function listUpcomingBookings(daysAhead: number): Promise<UpcomingBooking[]> {
  const cal = calendarClient();
  // Anchor to the START of today in the owner tz, not "now" — otherwise an
  // early-morning meeting whose end is before the cron run time is filtered out
  // and never gets its day-of reminder.
  const tz = bookingConfig.timezone;
  const [ty, tm, td] = todayInTz(tz).split("-").map((n) => parseInt(n, 10));
  const timeMin = zonedToUtc(ty, tm, td, 0, 0, tz);
  const timeMax = new Date(Date.now() + daysAhead * 86_400_000);
  const res = await cal.events.list({
    calendarId: bookingConfig.calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    privateExtendedProperty: ["unifictionalBooking=1"],
    maxResults: 250,
  });
  return (res.data.items ?? [])
    .filter((e) => e.start?.dateTime)
    .map((e) => {
      const p = (e.extendedProperties?.private ?? {}) as Record<string, string>;
      return {
        id: e.id!,
        startISO: e.start!.dateTime!,
        endISO: e.end?.dateTime ?? e.start!.dateTime!,
        summary: e.summary ?? "",
        clientEmail: p.clientEmail ?? "",
        clientName: p.clientName ?? "",
        reminderThresholdDays: parseInt(p.reminderThresholdDays ?? "5", 10),
        lastReminderDate: p.lastReminderDate ?? "",
        privateProps: p,
      };
    });
}

/** Record the date we last sent a reminder, preserving the other props. */
export async function markReminderSent(
  eventId: string,
  privateProps: Record<string, string>,
  dateStr: string
) {
  const cal = calendarClient();
  await cal.events.patch({
    calendarId: bookingConfig.calendarId,
    eventId,
    requestBody: {
      extendedProperties: { private: { ...privateProps, lastReminderDate: dateStr } },
    },
  });
}
