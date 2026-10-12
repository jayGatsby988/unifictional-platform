export const CALENDAR_CHOICES = ["google", "apple", "outlook", "ics"] as const;
export type CalendarChoice = (typeof CALENDAR_CHOICES)[number];

export interface ClientInfo {
  name: string;
  email: string;
  phone: string;
  businessName: string;
  website: string;
  /** When they have no website yet: what the company does, where, for whom. */
  companyDetails: string;
  services: string[];
  message: string;
}

export interface PendingBooking extends ClientInfo {
  slotStartISO: string;
  slotEndISO: string;
  calendarChoice: CalendarChoice;
  bookingId: string;
  codeHash: string;
  /** When /start issued this token (ms) — pins the lead-time check at confirm. */
  issuedAt: number;
}

/**
 * Normalize a user-supplied website to a safe http(s) URL, or "" if it can't be.
 * Drops dangerous schemes (javascript:, data:, …) so they can never reach an
 * email href; bare hosts ("acme.com") are assumed https.
 */
function normalizeWebsite(raw: string): string {
  const w = raw.trim().slice(0, 300);
  if (!w) return "";
  if (/^https?:\/\//i.test(w)) return w;
  // Has some other scheme (foo:) → reject. No scheme → treat as a bare host.
  if (/^[a-z][a-z0-9+.-]*:/i.test(w)) return "";
  return `https://${w}`;
}

export function sanitizeClient(raw: Record<string, unknown>): ClientInfo {
  const str = (v: unknown, max = 500) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";
  const services = Array.isArray(raw.services)
    ? raw.services.filter((s): s is string => typeof s === "string").slice(0, 20).map((s) => s.slice(0, 80))
    : [];
  return {
    name: str(raw.name, 120),
    email: str(raw.email, 254),
    phone: str(raw.phone, 40),
    businessName: str(raw.businessName, 160),
    website: normalizeWebsite(typeof raw.website === "string" ? raw.website : ""),
    companyDetails: str(raw.companyDetails, 3000),
    services,
    message: str(raw.message, 2000),
  };
}
