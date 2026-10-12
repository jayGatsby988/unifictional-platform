// The builds dashboard's data and access.
import { list } from "@vercel/blob";

import { readJson, type LeadRecord } from "./storage";

export const dashboardKey = () => process.env.BUILDS_DASHBOARD_KEY || process.env.BOOKING_SECRET || "";
export const COOKIE = "unif_builds";

/** True when the request carries the dashboard key as a cookie or a bearer token. */
export function dashboardAuthorized(req: Request): boolean {
  const key = dashboardKey();
  if (!key) return false;
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${key}`) return true;
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return Boolean(m && decodeURIComponent(m[1]) === key);
}

export const ACTIVE = ["queued", "research", "research-b", "plan", "home", "write", "review", "finish", "debug", "publish"];
const STALE_MS = 25 * 60 * 1000;

export interface BuildRow extends LeadRecord {
  stage: "building" | "done" | "failed" | "stalled";
  minutes: number;
}

/** The most recent builds (newest first), with a derived stage. */
export async function listBuilds(limit = 100): Promise<BuildRow[]> {
  const blobs: { pathname: string; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const r = await list({ prefix: "leads/", limit: 1000, cursor });
    blobs.push(...r.blobs.map((b) => ({ pathname: b.pathname, uploadedAt: new Date(b.uploadedAt) })));
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  blobs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  const picked = blobs.filter((b) => /^leads\/[a-f0-9-]+\.json$/i.test(b.pathname)).slice(0, limit);
  const rows = await Promise.all(picked.map((b) => readJson<LeadRecord>(b.pathname)));
  const now = Date.now();
  return rows.filter(Boolean).map((r) => {
    const updated = new Date(r!.updatedAt || r!.createdAt).getTime();
    const created = new Date(r!.createdAt).getTime();
    const active = ACTIVE.includes(r!.status);
    const stage = r!.status === "done" ? "done" : r!.status === "failed" ? "failed" : active && now - updated > STALE_MS ? "stalled" : "building";
    return { ...(r as LeadRecord), stage, minutes: Math.round(((stage === "building" ? now : updated) - created) / 60000) } as BuildRow;
  });
}
