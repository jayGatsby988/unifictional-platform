/**
 * Provider contracts. A RenderProvider turns (source image + edit prompt) into
 * a photoreal image; a ScanProvider turns a photo into a textured GLB. Each
 * adapter is stateless and reads its keys from env at call time so the health
 * endpoint and the router can ask `isConfigured()` cheaply.
 */
import type { JobStatus, RenderJob, ScanJob } from '@/lib/spec/types';

export type RenderProviderId = RenderJob['provider'];
export type ScanProviderId = ScanJob['provider'];

export type RenderSize = '1024x1024' | '1536x1024' | '1024x1536';
export type RenderQuality = 'low' | 'medium' | 'high';
export type RenderMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface RenderProgress {
  progress: number;
  message: string;
}

export interface RenderRequest {
  /** photo or viewport screenshot URL (Blob URL, /uploads/… or data:) */
  sourceUrl: string;
  /** pre-fetched bytes for `sourceUrl` — adapters use these when present to avoid a second fetch */
  sourceBytes?: { buffer: Buffer; contentType: string };
  prompt: string;
  size: RenderSize;
  quality?: RenderQuality;
  signal?: AbortSignal;
  onProgress?: (p: RenderProgress) => void;
}

export interface RenderResult {
  imageBuffer: Buffer;
  mime: RenderMime;
  elapsedMs: number;
  model: string;
}

export interface RenderProvider {
  id: RenderProviderId;
  label: string;
  isConfigured(): boolean;
  render(req: RenderRequest): Promise<RenderResult>;
}

export interface ScanCreateRequest {
  imageUrl: string;
  /** pre-fetched bytes when the image lives on local disk (providers need a public URL or data URI) */
  imageBytes?: { buffer: Buffer; contentType: string };
}

export interface ScanStatus {
  status: JobStatus;
  /** 0..1 */
  progress: number;
  resultUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface ScanProvider {
  id: ScanProviderId;
  label: string;
  model: string;
  isConfigured(): boolean;
  create(req: ScanCreateRequest): Promise<{ jobId: string }>;
  get(jobId: string): Promise<ScanStatus>;
}

export class ProviderError extends Error {
  provider: string;
  code: string;
  status: number;
  retryable: boolean;
  constructor(provider: string, message: string, opts: { code?: string; status?: number; retryable?: boolean; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'ProviderError';
    this.provider = provider;
    this.code = opts.code ?? 'provider_error';
    this.status = opts.status ?? 502;
    this.retryable = opts.retryable ?? true;
  }
}

export const notConfigured = (provider: string, hint: string) =>
  new ProviderError(provider, `${hint} provider not configured`, { code: 'not_configured', status: 503, retryable: false });

/** fetch with a hard timeout; rejects with ProviderError on timeout/network failure. */
export async function providerFetch(provider: string, url: string, init: RequestInit = {}, timeoutMs = 60_000, signal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ProviderError(provider, signal?.aborted ? 'Request cancelled' : `${provider} request timed out after ${Math.round(timeoutMs / 1000)}s`, { code: 'timeout', status: 504 });
    }
    throw new ProviderError(provider, `${provider} network error: ${(err as Error).message}`, { code: 'network', status: 502 });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Reads a JSON error body defensively and builds a ProviderError. */
export async function providerHttpError(provider: string, res: Response, context: string): Promise<ProviderError> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string; detail?: string };
      detail = (typeof j.error === 'object' && j.error?.message) || (typeof j.error === 'string' ? j.error : '') || j.message || j.detail || text;
    } catch {
      detail = text;
    }
  } catch { /* ignore */ }
  detail = detail.slice(0, 400);
  const retryable = res.status === 429 || res.status >= 500;
  return new ProviderError(provider, `${context} failed (${res.status})${detail ? `: ${detail}` : ''}`, { code: res.status === 429 ? 'rate_limited' : 'http_error', status: 502, retryable });
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });
