/**
 * Storage layer — Vercel Blob in production, `public/uploads/` on disk when
 * `BLOB_READ_WRITE_TOKEN` is absent (local dev only; Vercel's filesystem is
 * read-only, so the local fallback refuses to run there).
 *
 * Server-only: uses node:fs. Never import from client components.
 *
 * URL conventions
 *  - Blob mode:  https://<store>.public.blob.vercel-storage.com/<pathname>
 *  - Local mode: /uploads/<pathname>  (served by `next dev` from public/)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { put as blobPut, get as blobGet, head as blobHead, BlobNotFoundError } from '@vercel/blob';
import { extForMime, mimeForPath, sniffImageMime } from './image-meta';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const LOCAL_UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');
export const LOCAL_URL_PREFIX = '/uploads/';

export type StorageMode = 'blob' | 'local';

export class StorageError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = 'storage_error', status = 500) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.status = status;
  }
}

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function storageMode(): StorageMode {
  return isBlobConfigured() ? 'blob' : 'local';
}

const isVercel = () => Boolean(process.env.VERCEL);

// ---------------------------------------------------------------------------
// Pathnames
// ---------------------------------------------------------------------------

/**
 * A path segment. The FIRST character may be `_` or `-`, and that is not
 * cosmetic: nanoid's alphabet is `A-Za-z0-9_-`, so 2 ids in 64 (3.1%) begin
 * with one. `ID_RE` in api/_lib/http.ts accepts them, the store mints project
 * ids with `nanoid(10)` and the renderer mints job ids with `nanoid(12)`, so
 * an id starting with `_` passed validation everywhere and then died HERE,
 * with "Invalid storage pathname", at the moment the finished render was
 * about to be saved. A project whose id drew that short straw could never
 * render at all — both providers failed identically, which is what it looked
 * like from the outside — and the id is already persisted in the client's
 * browser, so tightening id generation alone would not have rescued it.
 * Traversal is still refused explicitly below; a leading dash is harmless in
 * a blob key and in a URL.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,120}$/;

/** Normalises and validates a storage pathname (no leading slash, no traversal). */
export function normalizePathname(pathname: string): string {
  const clean = pathname.replace(/^\/+/, '').replace(/\\/g, '/');
  const segments = clean.split('/');
  if (!clean || segments.length > 6) throw new StorageError(`Invalid storage pathname: ${pathname}`, 'bad_pathname', 400);
  for (const seg of segments) {
    if (!SAFE_SEGMENT.test(seg) || seg === '.' || seg === '..') throw new StorageError(`Invalid storage pathname: ${pathname}`, 'bad_pathname', 400);
  }
  return clean;
}

/** photos/<projectId>/<fileId>.<ext> | viewport/<projectId>/<fileId>.<ext> */
export const UPLOAD_PATH_RE = /^(photos|viewport)\/([A-Za-z0-9_-]{4,40})\/([A-Za-z0-9_-]{4,40})\.(jpg|jpeg|png|webp|heic)$/;

export function parseUploadPathname(pathname: string): { kind: 'photos' | 'viewport'; projectId: string; fileId: string; ext: string } | null {
  const m = UPLOAD_PATH_RE.exec(pathname.replace(/^\/+/, ''));
  if (!m) return null;
  return { kind: m[1] as 'photos' | 'viewport', projectId: m[2], fileId: m[3], ext: m[4] };
}

export function uploadPathname(kind: 'photos' | 'viewport', projectId: string, fileId: string, mime: string): string {
  const ext = extForMime(mime) ?? 'jpg';
  return `${kind}/${projectId}/${fileId}.${ext}`;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export type PutData = Buffer | Blob | ArrayBuffer | Uint8Array | string;

export interface PutResult {
  url: string;
  pathname: string;
  size: number;
  contentType: string;
}

async function toBuffer(data: PutData): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return Buffer.from(await data.arrayBuffer());
  throw new StorageError('Unsupported data type for storage.put', 'bad_request', 400);
}

/**
 * Stores bytes at `pathname` and returns its public URL. Overwrites silently
 * (deterministic pathnames are used for job/project JSON).
 */
export async function put(pathname: string, data: PutData, contentType: string, opts: { cacheSeconds?: number } = {}): Promise<PutResult> {
  const clean = normalizePathname(pathname);
  const buffer = await toBuffer(data);
  if (isBlobConfigured()) {
    const res = await blobPut(clean, buffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: opts.cacheSeconds ?? 60,
    });
    return { url: res.url, pathname: res.pathname, size: buffer.byteLength, contentType };
  }
  if (isVercel()) {
    throw new StorageError('BLOB_READ_WRITE_TOKEN is required on Vercel (the local filesystem is read-only). Add a Blob store to this project.', 'not_configured', 503);
  }
  const file = path.join(LOCAL_UPLOADS_DIR, clean);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buffer);
  return { url: `${LOCAL_URL_PREFIX}${clean}`, pathname: clean, size: buffer.byteLength, contentType };
}

export async function putJson(pathname: string, value: unknown): Promise<PutResult> {
  return put(pathname, JSON.stringify(value), 'application/json', { cacheSeconds: 60 });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u);
}
export function isDataUrl(u: string): boolean {
  return /^data:/i.test(u);
}
export function isLocalUploadUrl(u: string): boolean {
  return u.startsWith(LOCAL_URL_PREFIX);
}
/** Root-relative path into public/ (e.g. /demo/kitchen-before.jpg, /uploads/…). */
export function isRootRelative(u: string): boolean {
  return u.startsWith('/') && !u.startsWith('//');
}

/** Absolute filesystem path for a root-relative public URL, or null when it escapes public/. */
export function localPathForPublicUrl(u: string): string | null {
  const rel = decodeURIComponent(u.split(/[?#]/)[0]).replace(/^\/+/, '');
  const abs = path.resolve(process.cwd(), 'public', rel);
  const root = path.resolve(process.cwd(), 'public') + path.sep;
  return abs.startsWith(root) ? abs : null;
}

function blobHostAllowed(host: string): boolean {
  return host.endsWith('.vercel-storage.com');
}

/**
 * SSRF guard for server-side fetches of user-supplied URLs. Allows Vercel Blob,
 * the app's own origin, hosts in ALLOWED_IMAGE_HOSTS (comma-separated), and
 * localhost when not on Vercel.
 */
export function isAllowedRemoteUrl(u: string, origin?: string): boolean {
  let parsed: URL;
  try { parsed = new URL(u); } catch { return false; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  if (blobHostAllowed(host)) return true;
  if (origin) {
    try { if (new URL(origin).hostname.toLowerCase() === host) return true; } catch { /* ignore */ }
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try { if (new URL(appUrl).hostname.toLowerCase() === host) return true; } catch { /* ignore */ }
  }
  const extra = (process.env.ALLOWED_IMAGE_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (extra.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  if (!isVercel() && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) return true;
  return false;
}

export interface FetchedBytes {
  buffer: Buffer;
  contentType: string;
}

async function readLocal(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function contentTypeFor(buffer: Buffer, hint: string | null | undefined, pathname: string): string {
  const sniffed = sniffImageMime(buffer);
  if (sniffed) return sniffed;
  const h = hint?.split(';')[0].trim();
  if (h && h !== 'application/octet-stream') return h;
  return mimeForPath(pathname) ?? 'application/octet-stream';
}

async function fetchRemote(url: string, maxBytes: number, timeoutMs: number): Promise<FetchedBytes> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', redirect: 'follow' });
    if (!res.ok) throw new StorageError(`Fetch failed (${res.status}) for ${url}`, res.status === 404 ? 'not_found' : 'fetch_failed', res.status === 404 ? 404 : 502);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len && len > maxBytes) throw new StorageError(`Remote file is too large (${len} bytes)`, 'payload_too_large', 413);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new StorageError(`Remote file is too large (${buffer.byteLength} bytes)`, 'payload_too_large', 413);
    return { buffer, contentType: contentTypeFor(buffer, res.headers.get('content-type'), url) };
  } catch (err) {
    if (err instanceof StorageError) throw err;
    if ((err as Error).name === 'AbortError') throw new StorageError(`Timed out fetching ${url}`, 'fetch_timeout', 504);
    throw new StorageError(`Could not fetch ${url}: ${(err as Error).message}`, 'fetch_failed', 502);
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchBytesOptions {
  /** request origin, used to resolve root-relative paths when the file is not on disk */
  origin?: string;
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * Loads the bytes behind any URL the app hands around: data: URLs, local
 * `/uploads/...` or other root-relative public paths, Blob URLs, or a bare
 * storage pathname.
 */
export async function fetchBytes(urlOrPathname: string, opts: FetchBytesOptions = {}): Promise<FetchedBytes> {
  const maxBytes = opts.maxBytes ?? 60 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const u = urlOrPathname.trim();
  if (!u) throw new StorageError('Empty URL', 'bad_request', 400);

  if (isDataUrl(u)) {
    const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(u);
    if (!m) throw new StorageError('Malformed data URL', 'bad_request', 400);
    const buffer = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
    if (buffer.byteLength > maxBytes) throw new StorageError('Inline image is too large', 'payload_too_large', 413);
    return { buffer, contentType: contentTypeFor(buffer, m[1], '') };
  }

  if (isRootRelative(u)) {
    const file = localPathForPublicUrl(u);
    if (!file) throw new StorageError(`Path not allowed: ${u}`, 'url_not_allowed', 400);
    const local = await readLocal(file);
    if (local) {
      if (local.byteLength > maxBytes) throw new StorageError('File is too large', 'payload_too_large', 413);
      return { buffer: local, contentType: contentTypeFor(local, mimeForPath(u), u) };
    }
    if (opts.origin) return fetchRemote(new URL(u, opts.origin).toString(), maxBytes, timeoutMs);
    throw new StorageError(`File not found: ${u}`, 'not_found', 404);
  }

  if (isHttpUrl(u)) {
    if (!isAllowedRemoteUrl(u, opts.origin)) throw new StorageError(`Remote host not allowed: ${new URL(u).hostname}`, 'url_not_allowed', 400);
    return fetchRemote(u, maxBytes, timeoutMs);
  }

  // Bare storage pathname.
  const clean = normalizePathname(u);
  if (isBlobConfigured()) {
    const res = await blobGet(clean, { access: 'public', useCache: false }).catch((err: unknown) => {
      if (err instanceof BlobNotFoundError) return null;
      throw err;
    });
    if (!res || res.statusCode !== 200 || !res.stream) throw new StorageError(`Not found: ${clean}`, 'not_found', 404);
    const buffer = Buffer.from(await new Response(res.stream).arrayBuffer());
    return { buffer, contentType: contentTypeFor(buffer, res.blob.contentType, clean) };
  }
  const local = await readLocal(path.join(LOCAL_UPLOADS_DIR, clean));
  if (!local) throw new StorageError(`Not found: ${clean}`, 'not_found', 404);
  return { buffer: local, contentType: contentTypeFor(local, mimeForPath(clean), clean) };
}

/** Reads and parses JSON stored at a URL or pathname. Returns null when missing. */
export async function getJson<T = unknown>(urlOrPathname: string, opts: FetchBytesOptions = {}): Promise<T | null> {
  try {
    const { buffer } = await fetchBytes(urlOrPathname, { ...opts, maxBytes: opts.maxBytes ?? 8 * 1024 * 1024 });
    return JSON.parse(buffer.toString('utf8')) as T;
  } catch (err) {
    if (err instanceof StorageError && err.code === 'not_found') return null;
    throw err;
  }
}

/** True when a stored object exists (cheap HEAD in Blob mode, stat locally). */
export async function exists(pathname: string): Promise<boolean> {
  const clean = normalizePathname(pathname);
  if (isBlobConfigured()) {
    try {
      await blobHead(clean);
      return true;
    } catch (err) {
      if (err instanceof BlobNotFoundError) return false;
      throw err;
    }
  }
  try {
    await fs.stat(path.join(LOCAL_UPLOADS_DIR, clean));
    return true;
  } catch {
    return false;
  }
}

/**
 * Converts any app image URL into something a hosted vision model can open:
 * public https URLs pass through; local/relative files become data URLs.
 */
export async function toModelImageUrl(url: string, opts: FetchBytesOptions = {}): Promise<{ url: string; contentType: string; bytes: number }> {
  if (isHttpUrl(url) && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url)) {
    return { url, contentType: mimeForPath(url) ?? 'image/jpeg', bytes: 0 };
  }
  const { buffer, contentType } = await fetchBytes(url, { ...opts, maxBytes: opts.maxBytes ?? MAX_UPLOAD_BYTES });
  return { url: `data:${contentType};base64,${buffer.toString('base64')}`, contentType, bytes: buffer.byteLength };
}

// ---------------------------------------------------------------------------
// Client-upload token helper (Vercel Blob handshake)
// ---------------------------------------------------------------------------

export interface ClientUploadTokenOptions {
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
  addRandomSuffix: boolean;
  allowOverwrite: boolean;
  validUntil: number;
  tokenPayload: string;
}

/**
 * Builds the `onBeforeGenerateToken` result for `handleUpload`. Throws a
 * StorageError (400) when the client asked for a pathname outside the
 * photos/<projectId>/… | viewport/<projectId>/… convention.
 */
export function clientUploadTokenOptions(pathname: string, clientPayload: string | null): ClientUploadTokenOptions {
  const parsed = parseUploadPathname(pathname);
  if (!parsed) throw new StorageError('Upload pathname must look like photos/<projectId>/<id>.<jpg|png|webp|heic>', 'bad_pathname', 400);
  let payload: Record<string, unknown> = {};
  if (clientPayload) {
    try { payload = JSON.parse(clientPayload) as Record<string, unknown>; } catch { payload = {}; }
  }
  if (typeof payload.projectId === 'string' && payload.projectId !== parsed.projectId) {
    throw new StorageError('Upload pathname does not match projectId', 'bad_pathname', 400);
  }
  return {
    allowedContentTypes: [...ALLOWED_IMAGE_TYPES, 'image/heif'],
    maximumSizeInBytes: MAX_UPLOAD_BYTES,
    addRandomSuffix: false,
    allowOverwrite: false,
    validUntil: Date.now() + 10 * 60 * 1000,
    tokenPayload: JSON.stringify({ projectId: parsed.projectId, kind: parsed.kind, fileId: parsed.fileId }),
  };
}
