/** Server-only paid-call admission. Redis is mandatory outside local development. */
import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

export const SCAN_FINISH_LIMITS = Object.freeze({ clientHourly: 6, clientDaily: 20, globalDaily: 100, clientConcurrent: 1, globalConcurrent: 3, leaseSeconds: 210 });
const UNAVAILABLE = 'Photo finish matching is temporarily unavailable. Please try again later.';
export class ScanFinishAdmissionError extends Error {
  constructor(public readonly status: 429 | 503, public readonly code: string, message: string, public readonly retryAfter: number) { super(message); this.name = 'ScanFinishAdmissionError'; }
}
const unavailable = () => new ScanFinishAdmissionError(503, 'finish_admission_unavailable', UNAVAILABLE, 60);
const limited = (seconds: number) => new ScanFinishAdmissionError(429, 'finish_analysis_limit', 'Photo analysis is at its request limit. Please try again later.', Math.max(1, Math.ceil(seconds)));
type Environment = Readonly<Record<string, string | undefined>>;
type Lease = { release: () => Promise<void> };

// Redis TIME gives all isolates the same window/lease clock. Every check and
// reservation runs in one EVAL; rejected calls never partially spend a budget.
// Fixed keys use a Redis hash tag so all five keys occupy one cluster slot.
export const SCAN_FINISH_ADMIT_LUA = `
local now = tonumber(redis.call('TIME')[1])
local windows = {86400, 86400, 3600}
local limits = {tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])}
local counts = {}
for i = 1, 3 do
  local bucket = math.floor(now / windows[i])
  local stored = redis.call('HMGET', KEYS[i], 'bucket', 'count')
  counts[i] = (tonumber(stored[1]) == bucket) and (tonumber(stored[2]) or 0) or 0
  if counts[i] >= limits[i] then return {0, windows[i] - (now % windows[i])} end
end
for i = 4, 5 do
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now)
  if redis.call('ZCARD', KEYS[i]) >= tonumber(ARGV[i + 1]) then
    local first = redis.call('ZRANGE', KEYS[i], 0, 0, 'WITHSCORES')
    return {0, math.max(1, tonumber(first[2]) - now)}
  end
end
for i = 1, 3 do
  redis.call('HSET', KEYS[i], 'bucket', math.floor(now / windows[i]), 'count', counts[i] + 1)
  redis.call('EXPIRE', KEYS[i], windows[i] * 2)
end
for i = 4, 5 do
  redis.call('ZADD', KEYS[i], now + tonumber(ARGV[7]), ARGV[1])
  redis.call('EXPIRE', KEYS[i], tonumber(ARGV[7]) + 1)
end
return {1, 0}
`;
export const SCAN_FINISH_RELEASE_LUA = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`;

function configuration(env: Environment) {
  const url = env.UPSTASH_REDIS_REST_URL?.trim(), token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url && !token) return null;
  if (!url || !token) throw unavailable();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw unavailable();
  } catch { throw unavailable(); }
  const namespace = env.SCAN_FINISH_ADMISSION_NAMESPACE?.trim() || 'manhattan-scan-finishes-v1';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(namespace)) throw unavailable();
  return { url, token, namespace };
}

function clientIdentity(req: Request, env: Environment): string {
  // Only Vercel's platform-owned header is trusted. A self-hosted deployment
  // conservatively shares one client bucket until it has a trusted IP adapter.
  const ip = env.VERCEL === '1' ? req.headers.get('x-vercel-forwarded-for')?.trim() : undefined;
  if (!ip || !isIP(ip)) return 'shared-unknown-client';
  // Canonicalize IPv6 spelling, then group its /64 to prevent cheap per-address
  // rotation within one normal client network. IPv4 is normalized by isIP.
  if (isIP(ip) === 6) {
    const compact = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const [left, right] = compact.split('::'), a = left ? left.split(':') : [], b = right ? right.split(':') : [];
    const groups = right !== undefined ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
    return `${groups.slice(0, 4).map(g => g.padStart(4, '0')).join(':')}::/64`;
  }
  return ip;
}

async function redisCommand(config: NonNullable<ReturnType<typeof configuration>>, command: (string | number)[], fetcher: typeof fetch): Promise<unknown> {
  // No automatic retry: an uncertain write may already have reserved a call.
  // A failed release leaves a short conservative lease, never an open budget.
  const response = await fetcher(config.url, { method: 'POST', headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' }, body: JSON.stringify(command), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(2500) });
  if (!response.ok || !response.body) throw unavailable();
  const reader = response.body.getReader(); let size = 0, text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024) { await reader.cancel().catch(() => undefined); throw unavailable(); }
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('result' in parsed) || 'error' in parsed) throw unavailable();
  return (parsed as { result: unknown }).result;
}

/** Factory keeps offline tests isolated; the route uses the single instance below. */
export function createScanFinishAdmission(options: { env?: () => Environment; fetch?: typeof fetch; now?: () => number } = {}) {
  const environment = options.env ?? (() => process.env), fetcher = options.fetch ?? ((...args) => fetch(...args)), now = options.now ?? Date.now;
  // Local development shares a single identity: bounded even when callers
  // forge forwarded headers. Only three counters + at most one lease are kept.
  const localCounts = [{ bucket: -1, count: 0 }, { bucket: -1, count: 0 }, { bucket: -1, count: 0 }];
  const localLeases = new Map<string, number>();
  return async function admit(req: Request): Promise<Lease> {
    if (req.signal.aborted) throw unavailable();
    const env = environment(), config = configuration(env), leaseId = randomUUID();
    let release: () => Promise<void>;
    if (!config) {
      const host = new URL(req.url).hostname;
      if (env.NODE_ENV === 'production' || env.VERCEL || !['localhost', '127.0.0.1', '[::1]'].includes(host)) throw unavailable();
      const seconds = Math.floor(now() / 1000), windows = [86400, 86400, 3600];
      const limits = [SCAN_FINISH_LIMITS.globalDaily, SCAN_FINISH_LIMITS.clientDaily, SCAN_FINISH_LIMITS.clientHourly];
      for (let i = 0; i < windows.length; i++) {
        if (localCounts[i].bucket !== Math.floor(seconds / windows[i])) localCounts[i] = { bucket: Math.floor(seconds / windows[i]), count: 0 };
        if (localCounts[i].count >= limits[i]) throw limited(windows[i] - seconds % windows[i]);
      }
      for (const [id, expiry] of localLeases) if (expiry <= seconds) localLeases.delete(id);
      if (localLeases.size >= SCAN_FINISH_LIMITS.clientConcurrent) throw limited(Math.min(...localLeases.values()) - seconds);
      for (const counter of localCounts) counter.count++;
      localLeases.set(leaseId, seconds + SCAN_FINISH_LIMITS.leaseSeconds);
      release = async () => { localLeases.delete(leaseId); };
    } else {
      const client = createHmac('sha256', config.token).update(clientIdentity(req, env)).digest('hex');
      const prefix = `{${config.namespace}}`, keys = [`${prefix}:day`, `${prefix}:${client}:day`, `${prefix}:${client}:hour`, `${prefix}:active`, `${prefix}:${client}:active`];
      let answer: unknown;
      try { answer = await redisCommand(config, ['EVAL', SCAN_FINISH_ADMIT_LUA, keys.length, ...keys, leaseId, SCAN_FINISH_LIMITS.globalDaily, SCAN_FINISH_LIMITS.clientDaily, SCAN_FINISH_LIMITS.clientHourly, SCAN_FINISH_LIMITS.globalConcurrent, SCAN_FINISH_LIMITS.clientConcurrent, SCAN_FINISH_LIMITS.leaseSeconds], fetcher); }
      catch { throw unavailable(); }
      if (!Array.isArray(answer) || answer.length !== 2 || !Number.isInteger(answer[0]) || !Number.isInteger(answer[1]) || answer[1] < 0 || answer[1] > 86400) throw unavailable();
      if (answer[0] === 0 && answer[1] > 0) throw limited(answer[1]);
      if (answer[0] !== 1 || answer[1] !== 0) throw unavailable();
      release = async () => { await redisCommand(config, ['EVAL', SCAN_FINISH_RELEASE_LUA, 2, keys[3], keys[4], leaseId], fetcher).catch(() => undefined); };
    }
    // Even a client disconnect during admission must release the accepted lease.
    if (req.signal.aborted) { await release(); throw unavailable(); }
    let released = false;
    return { release: async () => { if (released) return; released = true; await release(); } };
  };
}

export const admitScanFinishAnalysis = createScanFinishAdmission();

/** Provider failures/cancellations release concurrency but never refund usage. */
export async function withScanFinishAdmission<T>(req: Request, work: () => Promise<T>, admit = admitScanFinishAnalysis): Promise<T> {
  const lease = await admit(req);
  try { if (req.signal.aborted) throw unavailable(); return await work(); }
  finally { await lease.release(); }
}
