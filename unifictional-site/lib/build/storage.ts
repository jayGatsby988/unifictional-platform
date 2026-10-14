// Durable storage for AI builds: Vercel Blob (store "unifictional-builds",
// BLOB_READ_WRITE_TOKEN in the project env). Everything about one build lives
// under builds/<id>/; the lead record under leads/<id>.json.
import { list, put } from "@vercel/blob";

export const blobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

const SAFE_ID = /^[a-f0-9-]{8,64}$/i;
export const isBuildId = (id: string) => SAFE_ID.test(id);
export const isPageSlug = (s: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,2}$/.test(s);

async function putAny(path: string, body: string | Buffer, contentType: string) {
  if (!blobConfigured()) return null;
  // JSON, HTML and text are overwritten between steps, so they get the shortest cache the CDN allows; photos, frames and video keep the long default
  const shortLived = /^(application\/json|text\/|application\/zip)/i.test(contentType) || /\.(json|html|txt|md|css|js)$/i.test(path);
  const r = await put(path, body, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType, ...(shortLived ? { cacheControlMaxAge: 60 } : {}) });
  return r.url;
}
/**
 * The store is public (previews link straight into it), so a lead's email and
 * phone never go in: they stay in the booking emails and the calendar event.
 * Applies to the lead record itself and to any `lead` carried inside a job.
 */
function redactLead(path: string, data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const strip = (o: Record<string, unknown>) => ({ ...o, email: undefined, phone: undefined });
  const d = data as Record<string, unknown>;
  if (/^leads\//.test(path)) return strip(d);
  if (d.lead && typeof d.lead === "object") return { ...d, lead: strip(d.lead as Record<string, unknown>) };
  return data;
}
export const saveJson = (path: string, data: unknown) => putAny(path, JSON.stringify(redactLead(path, data)), "application/json; charset=utf-8");

/** How many builds were started in the last `ms` (one lead record per build), for the daily cap. */
export async function leadsSince(ms: number): Promise<number> {
  if (!blobConfigured()) return 0;
  const since = Date.now() - ms;
  const r = await list({ prefix: "leads/", limit: 200 });
  return r.blobs.filter((b) => /^leads\/[a-f0-9-]+\.json$/i.test(b.pathname) && new Date(b.uploadedAt).getTime() >= since).length;
}
export const saveHtml = (path: string, html: string) => putAny(path, html, "text/html; charset=utf-8");
export const saveBinary = (path: string, buf: Buffer, contentType: string) => putAny(path, buf, contentType);

async function urlFor(path: string): Promise<string | null> {
  if (!blobConfigured()) return null;
  const r = await list({ prefix: path, limit: 5 });
  const hit = r.blobs.find((b) => b.pathname === path);
  return hit ? hit.url : null;
}

export async function readText(path: string): Promise<string | null> {
  const url = await urlFor(path);
  if (!url) return null;
  // the Blob CDN caches public URLs for minutes after an overwrite; a unique query string always reaches the latest copy
  const fresh = url + (url.includes("?") ? "&" : "?") + "v=" + Date.now().toString(36);
  const res = await fetch(fresh, { cache: "no-store" });
  if (!res.ok) return null;
  return res.text();
}

export async function readJson<T = unknown>(path: string): Promise<T | null> {
  const t = await readText(path);
  if (!t) return null;
  try { return JSON.parse(t) as T; } catch { return null; }
}

/* -------------------------------- leads ---------------------------------- */
export type LeadStatus = "queued" | "research" | "research-b" | "plan" | "home" | "write" | "review" | "finish" | "debug" | "publish" | "done" | "failed" | "cancelled";

export interface LeadRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: LeadStatus | string;
  name: string;
  email: string;
  phone: string;
  businessName: string;
  website: string;
  companyDetails: string;
  services: string[];
  message: string;
  slotStartISO?: string;
  previewUrl?: string;
  publishedUrl?: string; // the live Vercel URL once the debugger has passed it and it is deployed
  publishNote?: string;  // why it is not live yet (no token, deploy error)
  debugNotes?: string[]; // what the debugger fixed
  pages?: string[];
  score?: number;
  error?: string;
  cost?: number;
  usage?: { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; searches: number };
  weight?: { images: { count: number; before: number; after: number; skipped: number }; html: { before: number; after: number } };
  hook?: { claim?: string; flagship?: string; ask?: string };
  video?: { mode?: string; count?: number; seconds?: number };
  hero?: string;   // home hero component chosen by the plan
  menu?: string;   // menu component chosen by the plan
  effects?: string[]; // pack effect ids used, so the next build is held to a different set
  pair?: string;      // type pair, so the next build gets a different one
  needsLook?: string[]; // delivered, but the gate still saw these (the owner checks before the call)
  qa?: {           // the quality gate's record (lib/build/pipeline.ts finishSite)
    rounds?: number; passed?: boolean; score?: number; verdict?: string; errors?: string[];
    issues?: { page: string; section?: number | null; severity: string; problem: string; action?: string; instruction?: string }[];
    shots?: { page: string; viewport: string; name: string; url: string }[];
    history?: { round: number; hardErrors: string[]; score?: number; pass?: boolean; verdict?: string; issues?: number; blocks?: number }[];
  };
  log: string[];
}

/** The hero and menu of the most recent builds (newest first), so the next build is offered different ones. */
export async function recentChoices(excludeId: string, n = 3): Promise<{ id: string; hero?: string; menu?: string; effects?: string[]; pair?: string }[]> {
  if (!blobConfigured()) return [];
  const r = await list({ prefix: "leads/", limit: 60 });
  const blobs = r.blobs.filter((b) => /^leads\/[a-f0-9-]+\.json$/i.test(b.pathname)).sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()).slice(0, 12);
  const out: { id: string; hero?: string; menu?: string; effects?: string[]; pair?: string }[] = [];
  for (const b of blobs) {
    if (out.length >= n) break;
    const rec = await readJson<LeadRecord>(b.pathname);
    if (!rec || rec.id === excludeId || (!rec.hero && !rec.menu)) continue;
    out.push({ id: rec.id, hero: rec.hero, menu: rec.menu, effects: rec.effects, pair: rec.pair });
  }
  return out;
}

export async function saveLead(lead: LeadRecord) {
  lead.updatedAt = new Date().toISOString();
  return saveJson(`leads/${lead.id}.json`, lead);
}

export const buildPath = (id: string, file: string) => `builds/${id}/${file}`;
export const pagePath = (id: string, slug: string) => `builds/${id}/pages/${slug === "index" ? "index" : slug}.html`;
