import crypto from "node:crypto";

import { bookingConfig } from "./config";

/**
 * Stateless, tamper-proof tokens (HMAC-SHA256) — no database needed. We carry
 * the pending booking + a hash of the e-mailed verification code inside a
 * signed token; the client returns it on confirm.
 */
function hmac(data: string): string {
  return crypto.createHmac("sha256", bookingConfig.secret).update(data).digest("base64url");
}

export function signToken(payload: Record<string, unknown>, ttlMs: number): string {
  const body = { ...payload, exp: Date.now() + ttlMs };
  const data = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${data}.${hmac(data)}`;
}

export function verifyToken<T = Record<string, unknown>>(token: string): T | null {
  const [data, sig] = (token || "").split(".");
  if (!data || !sig) return null;
  const expected = hmac(data);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof body.exp !== "number" || Date.now() > body.exp) return null;
  return body as T;
}

export function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(code: string): string {
  return hmac(`code:${code.trim()}`);
}

export function codeMatches(code: string, hash: string): boolean {
  const candidate = hashCode(code);
  if (candidate.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test((email || "").trim()) && email.trim().length <= 254;
}
