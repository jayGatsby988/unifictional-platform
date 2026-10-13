import { createHash } from "node:crypto";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";

/**
 * Shared rate limit for the public forms, backed by the `rate_events` table so it holds
 * across every server instance (the old in-memory maps only covered one). Keys are hashed.
 * Fails open: if the table or service key is missing, nothing is blocked.
 */
export const hashKey = (kind: string, value: string) => `${kind}:${createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32)}`;

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
}

/** True when `key` has already been used `max` times in the last `windowMs`; otherwise records this use. */
export async function rateLimited(key: string, max: number, windowMs: number): Promise<boolean> {
  if (!adminConfigured) return false;
  try {
    const db = createAdminClient();
    const since = new Date(Date.now() - windowMs).toISOString();
    const { count, error } = await db.from("rate_events").select("id", { count: "exact", head: true }).eq("key", key).gte("at", since);
    if (error) return false;
    if ((count ?? 0) >= max) return true;
    await db.from("rate_events").insert({ key });
    if (Math.random() < 0.02) await db.from("rate_events").delete().lt("at", new Date(Date.now() - 3 * 86_400_000).toISOString());
    return false;
  } catch {
    return false;
  }
}
