/**
 * Best-effort in-process abuse guards: idempotency, code-attempt caps, and
 * simple rate limits. These live only within a warm serverless instance, so
 * they reliably stop the common cases — a double-clicked confirm, a retried
 * fetch, a naive burst against one instance — but are NOT durable across
 * instances. For hard guarantees add Upstash / Vercel KV (see BOOKING_SETUP.md).
 * Once Google Calendar is configured, findEventByBookingId also provides
 * durable booking idempotency.
 */

const consumed = new Map<string, number>(); // bookingId -> consumed-at (ms)
const attempts = new Map<string, number>(); // bookingId -> wrong-code count
const hits = new Map<string, number[]>(); // rate key -> recent timestamps (ms)

const CONSUMED_TTL_MS = 20 * 60_000; // a bit longer than the 15-min token TTL
const MAX_CODE_ATTEMPTS = 8;

function sweepConsumed(now: number) {
  if (consumed.size < 5000) return;
  for (const [k, t] of consumed) if (now - t > CONSUMED_TTL_MS) consumed.delete(k);
}

/** Claim a booking exactly once. Returns false on a replay (already claimed). */
export function claimBooking(bookingId: string): boolean {
  const now = Date.now();
  sweepConsumed(now);
  const at = consumed.get(bookingId);
  if (at !== undefined && now - at <= CONSUMED_TTL_MS) return false;
  consumed.set(bookingId, now);
  attempts.delete(bookingId);
  return true;
}

/** Count a wrong-code attempt; returns true once the per-booking cap is hit. */
export function tooManyCodeAttempts(bookingId: string): boolean {
  const n = (attempts.get(bookingId) ?? 0) + 1;
  attempts.set(bookingId, n);
  return n > MAX_CODE_ATTEMPTS;
}

/** Sliding-window rate check. Returns true when `key` exceeds `max` per window. */
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}
