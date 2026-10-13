/**
 * Route-handler plumbing: consistent `{ error, code }` JSON errors, zod body
 * parsing, id validation, timing logs. `_lib` is a private folder — Next
 * never routes it.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { StorageError } from '@/lib/storage/blob';
import { ProviderError } from '@/lib/ai/providers/types';
import { errorMessage, serverError, serverLog, startTimer } from '@/lib/ai/log';

export const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
export const IdZ = z.string().regex(ID_RE, 'must be 4–40 url-safe characters');

const NO_STORE = { 'cache-control': 'no-store' };

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function json<T>(data: T, init: ResponseInit = {}): NextResponse {
  return NextResponse.json(data, { ...init, headers: { ...NO_STORE, ...(init.headers ?? {}) } });
}

export function jsonError(status: number, code: string, message: string, details?: unknown): NextResponse {
  return NextResponse.json(details !== undefined ? { error: message, code, details } : { error: message, code }, { status, headers: NO_STORE });
}

export function zodMessage(err: z.ZodError): string {
  return err.issues.slice(0, 4).map((i) => `${i.path.length ? i.path.join('.') : '$'}: ${i.message}`).join('; ');
}

export function assertId(value: unknown, what = 'id'): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new HttpError(400, 'bad_request', `Invalid ${what}`);
  return value;
}

/** Parses bounded JSON, including chunked requests without a content-length. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S, opts: { maxBytes?: number } = {}): Promise<z.output<S>> {
  const max = opts.maxBytes ?? 2 * 1024 * 1024;
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len && len > max) throw new HttpError(413, 'payload_too_large', `Request body exceeds ${Math.round(max / 1024 / 1024)} MB`);
  let raw: unknown;
  try {
    if (!req.body) throw new HttpError(400, 'bad_request', 'Body must be valid JSON');
    const reader = req.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0, body = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
          await reader.cancel().catch(() => undefined);
          throw new HttpError(413, 'payload_too_large', `Request body exceeds ${Math.round(max / 1024 / 1024)} MB`);
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    raw = JSON.parse(body);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'bad_request', 'Body must be valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, 'validation_error', zodMessage(parsed.error));
  return parsed.data;
}

/** Public origin of the request (honours proxy headers on Vercel). */
export function requestOrigin(req: Request): string {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim();
  const host = req.headers.get('x-forwarded-host')?.split(',')[0].trim() ?? req.headers.get('host');
  if (host) return `${proto || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')}://${host}`;
  try {
    return new URL(req.url).origin;
  } catch {
    return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  }
}

/** Maps any thrown value to the JSON error shape. */
export function toErrorResponse(err: unknown, scope: string): NextResponse {
  if (err instanceof HttpError) {
    if (err.status >= 500) serverError(scope, err.message, err);
    return jsonError(err.status, err.code, err.message, err.details);
  }
  if (err instanceof StorageError) {
    if (err.status >= 500) serverError(scope, 'storage error', err);
    return jsonError(err.status, err.code, err.message);
  }
  if (err instanceof ProviderError) {
    serverError(scope, 'provider error', err, { provider: err.provider, code: err.code });
    return jsonError(err.status, err.code === 'not_configured' ? 'not_configured' : 'provider_error', err.message);
  }
  if (err instanceof z.ZodError) return jsonError(400, 'validation_error', zodMessage(err));
  if (err instanceof SyntaxError) return jsonError(400, 'bad_request', 'Malformed request body');
  serverError(scope, 'unhandled error', err);
  return jsonError(500, 'internal_error', errorMessage(err));
}

/** Wraps a handler body with timing logs + error mapping. */
export async function guard(scope: string, fn: () => Promise<Response>): Promise<Response> {
  const elapsed = startTimer();
  try {
    const res = await fn();
    serverLog(scope, 'ok', { status: res.status, ms: elapsed() });
    return res;
  } catch (err) {
    const res = toErrorResponse(err, scope);
    serverLog(scope, 'error', { status: res.status, ms: elapsed() });
    return res;
  }
}

export function errorCode(err: unknown): string {
  if (err instanceof HttpError || err instanceof StorageError) return err.code;
  if (err instanceof ProviderError) return err.code === 'not_configured' ? 'not_configured' : `provider_${err.code}`;
  return 'internal_error';
}
