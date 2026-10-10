import { createHmac, timingSafeEqual } from "node:crypto";

/** Signed, short-lived state for OAuth round-trips: carries the client slug. */
export function signState(payload: Record<string, string>): string {
  const secret = process.env.CRON_SECRET || process.env.OAUTH_STATE_SECRET;
  if (!secret) throw new Error("CRON_SECRET (used to sign OAuth state) is not set");
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60_000 })).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string | null): Record<string, string> | null {
  const secret = process.env.CRON_SECRET || process.env.OAUTH_STATE_SECRET;
  if (!state || !secret) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", secret).update(body).digest("base64url");
  if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, string> & { exp: number };
  if (data.exp < Date.now()) return null;
  return data;
}
