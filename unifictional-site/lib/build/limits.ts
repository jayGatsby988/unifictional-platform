// One free site per person. A build is recorded against the booker's email
// and their network address the moment it starts (cancelled builds count:
// the point is that nobody can keep starting them). Both keys are stored as
// hashes, since the store is public. The call itself is always bookable;
// only the second build is refused, and the booker is told why.
import { createHash } from "node:crypto";
import { blobConfigured, readJson, saveJson } from "./storage";

const SALT = () => process.env.BUILD_LIMIT_SALT || process.env.BOOKING_SECRET || "unifictional";
const h = (s: string) => createHash("sha256").update(SALT() + "|" + s).digest("hex").slice(0, 32);
const normEmail = (e: string) => String(e || "").trim().toLowerCase();
const normIp = (ip: string) => String(ip || "").trim().split(",")[0].trim();

export interface LimitRecord { at: string; bookingId: string; by: "email" | "ip" }

export const limitPaths = (email: string, ip: string) => ({
  email: normEmail(email) ? `limits/email-${h(normEmail(email))}.json` : "",
  ip: normIp(ip) && !/^(127\.|::1$|unknown$)/.test(normIp(ip)) ? `limits/ip-${h(normIp(ip))}.json` : "",
});

/** The client address as Vercel reports it. */
export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for") || "";
  return normIp(xf) || req.headers.get("x-real-ip") || "";
}

/** Has this email or this address already started a build? */
export async function alreadyBuilt(email: string, ip: string): Promise<{ blocked: boolean; by?: "email" | "ip"; since?: string; bookingId?: string }> {
  if (!blobConfigured() || process.env.BUILD_ONE_PER_PERSON === "0") return { blocked: false };
  const allow = (process.env.BUILD_LIMIT_ALLOW || "").split(",").map(normEmail).filter(Boolean);
  if (allow.includes(normEmail(email))) return { blocked: false };
  const p = limitPaths(email, ip);
  const [byEmail, byIp] = await Promise.all([p.email ? readJson<LimitRecord>(p.email) : null, p.ip ? readJson<LimitRecord>(p.ip) : null]);
  if (byEmail) return { blocked: true, by: "email", since: byEmail.at, bookingId: byEmail.bookingId };
  if (byIp) return { blocked: true, by: "ip", since: byIp.at, bookingId: byIp.bookingId };
  return { blocked: false };
}

/** Record that a build started for this email and address. */
export async function recordBuild(email: string, ip: string, bookingId: string) {
  if (!blobConfigured()) return;
  const p = limitPaths(email, ip); const at = new Date().toISOString();
  await Promise.all([
    p.email ? saveJson(p.email, { at, bookingId, by: "email" } as LimitRecord) : null,
    p.ip ? saveJson(p.ip, { at, bookingId, by: "ip" } as LimitRecord) : null,
  ]);
}

/** Clear a person's record (owner's tool, for tests and for a client the owner wants to build for again). */
export async function clearLimit(email: string, ip: string) {
  if (!blobConfigured()) return { cleared: [] as string[] };
  const { del } = await import("@vercel/blob");
  const p = limitPaths(email, ip); const cleared: string[] = [];
  for (const path of [p.email, p.ip].filter(Boolean)) { try { await del(path); cleared.push(path); } catch {} }
  return { cleared };
}
