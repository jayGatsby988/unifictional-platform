export interface MeetingDetails {
  uid: string;
  title: string;
  description: string;
  location: string; // phone call, meeting link, etc.
  startISO: string;
  endISO: string;
  organizerName: string;
  organizerEmail: string;
  attendeeName: string;
  attendeeEmail: string;
}

/** 2026-06-23T14:00:00.000Z -> 20260623T140000Z */
function toICSDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function esc(s: string): string {
  return (s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** A valid VCALENDAR string — used for the .ics download + email attachment. */
export function buildICS(m: MeetingDetails, stampISO: string): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Unifictional//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${m.uid}`,
    `DTSTAMP:${toICSDate(stampISO)}`,
    `DTSTART:${toICSDate(m.startISO)}`,
    `DTEND:${toICSDate(m.endISO)}`,
    `SUMMARY:${esc(m.title)}`,
    `DESCRIPTION:${esc(m.description)}`,
    `LOCATION:${esc(m.location)}`,
    `ORGANIZER;CN=${esc(m.organizerName)}:mailto:${m.organizerEmail}`,
    `ATTENDEE;CN=${esc(m.attendeeName)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${m.attendeeEmail}`,
    "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export interface CalendarLinks {
  google: string;
  outlook: string;
  office365: string;
  yahoo: string;
}

/** Add-to-calendar deep links for Google / Outlook / Office 365 / Yahoo. */
export function calendarLinks(m: MeetingDetails): CalendarLinks {
  const start = toICSDate(m.startISO);
  const end = toICSDate(m.endISO);
  const text = encodeURIComponent(m.title);
  const details = encodeURIComponent(m.description);
  const location = encodeURIComponent(m.location);
  const startEnc = encodeURIComponent(m.startISO);
  const endEnc = encodeURIComponent(m.endISO);

  return {
    google: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${start}/${end}&details=${details}&location=${location}`,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${text}&body=${details}&location=${location}&startdt=${startEnc}&enddt=${endEnc}`,
    office365: `https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${text}&body=${details}&location=${location}&startdt=${startEnc}&enddt=${endEnc}`,
    yahoo: `https://calendar.yahoo.com/?v=60&title=${text}&st=${start}&et=${end}&desc=${details}&in_loc=${location}`,
  };
}
