/**
 * Free attempts + the $1 unlock, keyed by IP so closing the tab or switching
 * browsers doesn't reset the count. The record lives in Blob (one small JSON
 * per hashed IP) so it survives deploys; a signed cookie keeps a paying user
 * unlocked when their IP changes. Billing itself happens in the Unifictional
 * client portal (Square), which this app calls with a shared key.
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { list } from '@vercel/blob';
import { isBlobConfigured, putJson } from '@/lib/storage/blob';

export const FREE_ATTEMPTS = Math.max(0, Number(process.env.FREE_ATTEMPTS || 2));
export const UNLOCK_DAYS = Math.max(1, Number(process.env.UNLOCK_DAYS || 30));
export const UNLOCK_PRICE_LABEL = process.env.UNLOCK_PRICE_LABEL || '$1';
const COOKIE = 'mh_unlock';
const SECRET = process.env.MANHATTAN_SESSION_SECRET || 'dev-only-secret';
const PORTAL_URL = (process.env.PORTAL_URL || 'https://unifictional-client-portal.vercel.app').replace(/\/+$/, '');
const PLATFORM_KEY = process.env.PLATFORM_KEY || '';

export type LimitRecord = { used: number; paidUntil: string | null; orders: string[]; updatedAt: string };
type Pending = { id: string; key: string; orderId: string; createdAt: string; claimed?: boolean };

const memory = new Map<string, unknown>(); // local dev without Blob

async function readJson<T>(pathname: string): Promise<T | null> {
  if (!isBlobConfigured()) return (memory.get(pathname) as T) ?? null;
  const r = await list({ prefix: pathname, limit: 3 });
  const hit = r.blobs.find((b) => b.pathname === pathname);
  if (!hit) return null;
  // Blob's CDN caches public reads for at least 60 s; a unique query string makes every read fresh,
  // which the counter needs (two quick scans must count as two).
  const res = await fetch(`${hit.url}${hit.url.includes('?') ? '&' : '?'}cb=${Date.now()}`, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  return res.ok ? ((await res.json()) as T) : null;
}
async function writeJson(pathname: string, value: unknown): Promise<void> {
  if (!isBlobConfigured()) { memory.set(pathname, value); return; }
  await putJson(pathname, value);
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || req.headers.get('x-real-ip')?.trim() || 'unknown';
}
/** The IP never gets stored, only a salted hash of it. */
export const ipKey = (ip: string) => createHash('sha256').update(`${SECRET}\n${ip}`).digest('hex').slice(0, 32);

const recordPath = (key: string) => `limits/ip/${key}.json`;
const pendingPath = (id: string) => `limits/unlock/${id}.json`;

export async function getRecord(key: string): Promise<LimitRecord> {
  return (await readJson<LimitRecord>(recordPath(key))) ?? { used: 0, paidUntil: null, orders: [], updatedAt: new Date().toISOString() };
}
const isUnlocked = (r: LimitRecord) => Boolean(r.paidUntil && new Date(r.paidUntil).getTime() > Date.now());

// --- the signed cookie --------------------------------------------------------
const sign = (v: string) => createHmac('sha256', SECRET).update(v).digest('hex');
export function hasUnlockCookie(req: Request): boolean {
  const raw = req.headers.get('cookie') ?? '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = sign(exp);
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}
export function unlockCookie(): { name: string; value: string; maxAge: number } {
  const exp = String(Date.now() + UNLOCK_DAYS * 86_400_000);
  return { name: COOKIE, value: `${exp}.${sign(exp)}`, maxAge: UNLOCK_DAYS * 86_400 };
}

// --- the gate ------------------------------------------------------------------
export type Gate = { allowed: boolean; unlocked: boolean; used: number; free: number; remaining: number; key: string };

export async function checkAttempt(req: Request): Promise<Gate> {
  const key = ipKey(clientIp(req));
  const rec = await getRecord(key);
  const unlocked = hasUnlockCookie(req) || isUnlocked(rec);
  const remaining = Math.max(0, FREE_ATTEMPTS - rec.used);
  return { allowed: unlocked || remaining > 0, unlocked, used: rec.used, free: FREE_ATTEMPTS, remaining: unlocked ? Infinity : remaining, key };
}

/** Counts one scan against the free allowance. Call only when the gate allowed it and the visitor isn't unlocked. */
export async function consumeAttempt(key: string): Promise<void> {
  const rec = await getRecord(key);
  await writeJson(recordPath(key), { ...rec, used: rec.used + 1, updatedAt: new Date().toISOString() });
}

export async function markPaid(key: string, orderId: string): Promise<LimitRecord> {
  const rec = await getRecord(key);
  const next: LimitRecord = { ...rec, paidUntil: new Date(Date.now() + UNLOCK_DAYS * 86_400_000).toISOString(), orders: [...new Set([...rec.orders, orderId])], updatedAt: new Date().toISOString() };
  await writeJson(recordPath(key), next);
  return next;
}

// --- the portal (Square lives there) --------------------------------------------
export const billingConfigured = () => Boolean(PLATFORM_KEY);

async function portal<T>(path: string, body: unknown): Promise<T> {
  if (!PLATFORM_KEY) throw new Error('PLATFORM_KEY is not set');
  const res = await fetch(`${PORTAL_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-key': PLATFORM_KEY }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `Portal returned ${res.status}`);
  return json;
}

/** Starts a $1 checkout for this visitor; the pending record ties the Square order to their IP key. */
export async function startUnlock(req: Request, origin: string): Promise<{ url: string; id: string }> {
  const key = ipKey(clientIp(req));
  const id = `u_${createHash('sha256').update(`${key}${Date.now()}${Math.random()}`).digest('hex').slice(0, 20)}`;
  const r = await portal<{ url: string; orderId: string }>('/api/public/3d/checkout', { returnUrl: `${origin}/studio?unlock=${id}`, reference: id });
  await writeJson(pendingPath(id), { id, key, orderId: r.orderId, createdAt: new Date().toISOString() } satisfies Pending);
  return { url: r.url, id };
}

/** Back from Square: confirm the order was paid, then unlock the original IP, the current IP, and the browser (cookie). */
export async function claimUnlock(req: Request, id: string): Promise<{ unlocked: boolean }> {
  if (!/^u_[a-f0-9]{20}$/.test(id)) return { unlocked: false };
  const pending = await readJson<Pending>(pendingPath(id));
  if (!pending) return { unlocked: false };
  const v = await portal<{ paid: boolean }>('/api/public/3d/verify', { orderId: pending.orderId });
  if (!v.paid) return { unlocked: false };
  await markPaid(pending.key, pending.orderId);
  const current = ipKey(clientIp(req));
  if (current !== pending.key) await markPaid(current, pending.orderId);
  if (!pending.claimed) await writeJson(pendingPath(id), { ...pending, claimed: true });
  return { unlocked: true };
}
