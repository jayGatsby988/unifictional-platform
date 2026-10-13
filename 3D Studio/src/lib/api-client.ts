/**
 * Typed browser client for MANHATTAN's API routes. Safe to import from client
 * components (no server-only imports). Every function throws `ApiError`
 * carrying the server's `{ error, code }` shape.
 */
import { upload as blobClientUpload } from '@vercel/blob/client';
import { nanoid } from 'nanoid';
import { isSingleRoom } from '@/lib/spec/floorplan';
import type { BoxOpenCause, BoxOpenEdges, FinishObservation, Photo, Project, RenderJob, RoomSpec, RoomType, ScanJob, SolvedCamera } from '@/lib/spec/types';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type UploadMode = 'client' | 'server';
export interface UploadConfig { mode: UploadMode; maxBytes: number; accept: readonly string[]; maxFiles?: number }
export interface UploadProgress { loaded: number; total: number; percentage: number; fileIndex: number; fileCount: number }

export interface HealthInfo {
  ok: boolean;
  providers: { openai: boolean; google: boolean; higgsfield: boolean; meshy: boolean; blob: boolean };
  storage: 'blob' | 'local';
  uploads: UploadConfig;
  visionModel: string;
  imageModel: string;
  renderProvider: RenderJob['provider'];
  time: string;
}

export type AnalyzePhase = 'analyzing' | 'validating' | 'building' | 'done' | 'error';
export interface AnalyzeEvent {
  phase: AnalyzePhase;
  message: string;
  /** 0..1 */
  progress: number;
  spec?: RoomSpec;
  code?: string;
  heartbeat?: boolean;
  meta?: {
    model: string; elapsedMs: number; repaired: boolean; usedFallback: boolean; fixes: string[]; photoCount: number;
    /** the photos analysed, with the pixel size the server measured for the primary one (the inventory's frame) */
    photos?: Photo[];
    inventory?: { ok: boolean; count: number; aspect: number | null; elapsedMs: number; inPrompt: boolean; photoIndex: number };
  };
}

export interface AnalyzeInput { roomType: RoomType; photos: Photo[]; description?: string }

export interface StartRenderInput {
  projectId: string;
  spec: RoomSpec;
  selections: Record<string, string>;
  sourceUrl: string;
  sourceKind: 'photo' | 'viewport';
  provider?: RenderJob['provider'];
  /** slots that differ from the source photo; omit to render every slot */
  changedSlots?: string[];
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  quality?: 'low' | 'medium' | 'high';
}

export interface StartScanInput { projectId: string; imageUrl: string; provider?: ScanJob['provider'] }

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const EXT_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic' };
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic' };
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

async function parseError(res: Response): Promise<ApiError> {
  let body: { error?: string; code?: string; details?: unknown } = {};
  try { body = (await res.json()) as typeof body; } catch { /* not JSON */ }
  return new ApiError(res.status, body.code ?? `http_${res.status}`, body.error ?? `${res.status} ${res.statusText}`, body.details);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { accept: 'application/json', ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
  } catch (err) {
    if (init.signal?.aborted || (err as Error).name === 'AbortError') throw new ApiError(0, 'aborted', 'Request cancelled');
    throw new ApiError(0, 'network_error', (err as Error).message || 'Network error');
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export function getHealth(): Promise<HealthInfo> {
  return request<HealthInfo>('/api/health', { cache: 'no-store' });
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

let uploadConfigPromise: Promise<UploadConfig> | null = null;

/** Cached: asks the server whether direct-to-Blob client uploads are available. */
export function getUploadConfig(): Promise<UploadConfig> {
  if (!uploadConfigPromise) {
    uploadConfigPromise = request<UploadConfig>('/api/upload', { cache: 'no-store' }).catch((err) => {
      uploadConfigPromise = null;
      if (err instanceof ApiError && err.status === 0) throw err;
      return { mode: 'server' as UploadMode, maxBytes: MAX_UPLOAD_BYTES, accept: ALLOWED_TYPES };
    });
  }
  return uploadConfigPromise;
}

/** Cancel this caller's wait without cancelling a shared config request. */
function uploadWait<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new ApiError(0, 'aborted', 'Upload cancelled'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    pending.then(
      (value) => { signal.removeEventListener('abort', abort); if (signal.aborted) abort(); else resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

function mimeOf(file: File): string {
  if (file.type && ALLOWED_TYPES.includes(file.type.toLowerCase())) return file.type.toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? file.type ?? '';
}

function assertUploadable(file: File, kind: 'photos' | 'viewport', maxBytes: number): string {
  const mime = mimeOf(file);
  const ok = kind === 'viewport' ? ['image/jpeg', 'image/png', 'image/webp'].includes(mime) : ALLOWED_TYPES.includes(mime);
  if (!ok) throw new ApiError(415, 'unsupported_media_type', `${file.name || 'Image'} is not a JPEG, PNG, WebP or HEIC file`);
  if (file.size > maxBytes) throw new ApiError(413, 'payload_too_large', `${file.name || 'Image'} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
  if (file.size === 0) throw new ApiError(400, 'bad_request', `${file.name || 'Image'} is empty`);
  return mime;
}

/** Pixel size via the browser decoder (EXIF-aware); undefined for HEIC or on failure. */
async function readImageSize(file: Blob): Promise<{ width: number; height: number } | undefined> {
  if (typeof createImageBitmap !== 'function') return undefined;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return undefined;
  }
}

function xhrMultipart<T>(url: string, form: FormData, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) { reject(new ApiError(0, 'aborted', 'Upload cancelled')); return; }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener('abort', abort);
    try {
      xhr.open('POST', url);
      xhr.responseType = 'json';
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded, e.total); };
      xhr.onerror = () => reject(new ApiError(0, 'network_error', 'Upload failed (network)'));
      xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Upload cancelled'));
      xhr.onload = () => {
        const body = (xhr.response ?? {}) as { error?: string; code?: string };
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T);
        else reject(new ApiError(xhr.status, body.code ?? `http_${xhr.status}`, body.error ?? `Upload failed (${xhr.status})`));
      };
      xhr.send(form);
    } catch (error) {
      signal?.removeEventListener('abort', abort);
      reject(error);
    }
  });
}

async function uploadFiles(files: File[], projectId: string, kind: 'photos' | 'viewport', onProgress?: (p: UploadProgress) => void, signal?: AbortSignal): Promise<Photo[]> {
  signal?.throwIfAborted();
  if (!files.length) return [];
  const config = await uploadWait(getUploadConfig(), signal);
  signal?.throwIfAborted();
  const mimes = files.map((f) => assertUploadable(f, kind, config.maxBytes));
  const total = files.reduce((s, f) => s + f.size, 0);
  const report = (index: number, loadedInFile: number) => {
    if (signal?.aborted) return;
    const before = files.slice(0, index).reduce((s, f) => s + f.size, 0);
    const loaded = Math.min(total, before + loadedInFile);
    onProgress?.({ loaded, total, percentage: total ? Math.round((loaded / total) * 100) : 100, fileIndex: index, fileCount: files.length });
  };

  if (config.mode === 'client') {
    const photos: Photo[] = [];
    for (let i = 0; i < files.length; i++) {
      signal?.throwIfAborted();
      const file = files[i];
      const pathname = `${kind}/${projectId}/${nanoid(12)}.${MIME_EXT[mimes[i]] ?? 'jpg'}`;
      let result;
      try {
        result = await blobClientUpload(pathname, file, {
          access: 'public',
          handleUploadUrl: '/api/upload',
          contentType: mimes[i],
          clientPayload: JSON.stringify({ projectId, kind }),
          onUploadProgress: ({ loaded }) => report(i, loaded),
          abortSignal: signal,
        });
      } catch (err) {
        if (signal?.aborted || (err as Error).name === 'AbortError') throw new ApiError(0, 'aborted', 'Upload cancelled');
        throw new ApiError(502, 'upload_failed', `${file.name || 'Image'}: ${(err as Error).message || 'upload failed'}`);
      }
      const size = await uploadWait(readImageSize(file), signal);
      photos.push({ url: result.url, ...(size ?? {}) });
      report(i, file.size);
    }
    return photos;
  }

  // Server-side multipart (local dev / no Blob token). One request per file so progress and errors stay per-file.
  const photos: Photo[] = [];
  for (let i = 0; i < files.length; i++) {
    const form = new FormData();
    form.set('projectId', projectId);
    form.set('kind', kind);
    form.append('files', files[i], files[i].name || `image.${MIME_EXT[mimes[i]] ?? 'jpg'}`);
    const res = await xhrMultipart<{ photos: Array<{ url: string; width?: number; height?: number }> }>('/api/upload', form, (loaded) => report(i, loaded), signal);
    for (const p of res.photos) {
      const size = p.width && p.height ? { width: p.width, height: p.height } : await uploadWait(readImageSize(files[i]), signal);
      signal?.throwIfAborted();
      photos.push({ url: p.url, ...(size ?? {}) });
    }
    report(i, files[i].size);
  }
  return photos;
}

/** Uploads photos (direct to Blob when configured, else through the server) → Photo[] in input order. */
export function uploadPhotos(files: File[] | FileList, projectId: string, onProgress?: (p: UploadProgress) => void, signal?: AbortSignal): Promise<Photo[]> {
  return uploadFiles(Array.from(files), projectId, 'photos', onProgress, signal);
}

/** Uploads a viewport capture (JPEG/PNG/WebP blob from `captureViewport()`) → its URL. */
export async function uploadViewport(blob: Blob, projectId: string, signal?: AbortSignal): Promise<string> {
  const type = blob.type && blob.type !== 'application/octet-stream' ? blob.type : 'image/jpeg';
  const file = blob instanceof File ? blob : new File([blob], `viewport.${MIME_EXT[type] ?? 'jpg'}`, { type });
  const [photo] = await uploadFiles([file], projectId, 'viewport', undefined, signal);
  if (!photo) throw new ApiError(500, 'upload_failed', 'Viewport upload returned nothing');
  return photo.url;
}

// ---------------------------------------------------------------------------
// Analysis (NDJSON stream)
// ---------------------------------------------------------------------------

export async function analyzeRoom(input: AnalyzeInput, onEvent?: (e: AnalyzeEvent) => void, signal?: AbortSignal): Promise<RoomSpec> {
  let res: Response;
  try {
    res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify({ roomType: input.roomType, photos: input.photos, description: input.description ?? '' }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted || (err as Error).name === 'AbortError') throw new ApiError(0, 'aborted', 'Analysis cancelled');
    throw new ApiError(0, 'network_error', (err as Error).message || 'Network error');
  }
  if (!res.ok) throw await parseError(res);
  if (!res.body) throw new ApiError(500, 'stream_error', 'Empty response stream');

  const reader = res.body.getReader();
  const cancelReader = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', cancelReader, { once: true });
  if (signal?.aborted) cancelReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let spec: RoomSpec | null = null;
  let failure: ApiError | null = null;

  const handleLine = (line: string) => {
    signal?.throwIfAborted();
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: AnalyzeEvent;
    try { event = JSON.parse(trimmed) as AnalyzeEvent; } catch { return; }
    onEvent?.(event);
    if (event.phase === 'done' && event.spec) spec = event.spec;
    if (event.phase === 'error') failure = new ApiError(502, event.code ?? 'analysis_failed', event.message);
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
  } catch (err) {
    if (signal?.aborted || (err as Error).name === 'AbortError') throw new ApiError(0, 'aborted', 'Analysis cancelled');
    throw new ApiError(0, 'stream_error', (err as Error).message || 'Stream interrupted');
  } finally {
    signal?.removeEventListener('abort', cancelReader);
    // Also stop the response if the consumer's progress callback throws.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (failure) throw failure;
  if (!spec) throw new ApiError(502, 'stream_ended', 'The analysis stream ended before a result arrived');
  return spec;
}

// ---------------------------------------------------------------------------
// Renders / scans / projects
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Photo fit residuals — one element's gap between photo and twin, in words.
// Pure and dependency-free on purpose: the refine prompt (server) and the
// match report (browser) must describe the same gap in the same words.
// ---------------------------------------------------------------------------

/**
 * How far one matched element's photo box is from its twin box, in frame
 * units. `dx`/`dy` are photo centre − twin centre as a fraction of the frame
 * width / height (+x = the photo has it further RIGHT, +y = further DOWN the
 * frame). `dw`/`dh` are photo size ÷ twin size − 1 (+0.18 = the photo's is
 * 18% wider / taller than the twin's).
 */
export interface FitResidual {
  kind: string;
  wall: string | null;
  /** 0-based position among the twin's elements of this kind on this wall */
  index?: number;
  /** overlap of the two boxes, 0..1 */
  iou: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  /**
   * The pair's PROPORTION error, 0..1 (0 = the same size in the same place):
   * half the mean |log size ratio| over the two axes, half the centre shift
   * as a fraction of the photo box's own size. `1 − err` is the per-element
   * form of the report's "Proportions" number.
   */
  err?: number;
  /** the inventory's own words for the photo element, when it has them */
  label?: string | null;
  /**
   * Which edges of THIS pair's photo box were a cut, and why — carried on the
   * residual rather than looked up again by the reader. The match report used
   * to re-find the element by kind (+ label when there was one) and take the
   * first one with an open edge, which on a fixture with several elements per
   * kind (client-tan has 18 open boxes over 56 elements, with three
   * base-cabinet-runs and two pendants) put a "cut off" chip on a closed
   * sibling and told the contractor a residual had been forgiven when it had
   * not. Null / absent = nothing was cut.
   */
  open?: BoxOpenEdges | null;
  openCause?: BoxOpenCause | null;
}

/** A photo element the twin does not draw (or draws fewer of), and why. */
export interface FitHint {
  kind: string;
  wall: string | null;
  reason: string;
  label?: string | null;
}

/** Below this overlap an element counts as "off" — the prompt lists it and the report colours it. */
export const RESIDUAL_OFF_BELOW = 0.75;
/** Above this proportion error an element counts as "off" in the report's Proportions column. */
export const PROPORTION_OFF_ABOVE = 0.10;
/**
 * A counter item is a 1–3%-of-frame box the detector draws least repeatably;
 * holding it to a wall's 0.75 would paint the report red over a kettle.
 */
export const offBelowFor = (kind: string): number => (kind === 'item' ? 0.2 : RESIDUAL_OFF_BELOW);
/** Shifts under 2% of the frame and size differences under 5% are inside the boxes' own precision. */
const SHIFT_MIN = 0.02;
const SIZE_MIN = 0.05;

const KIND_WORDS: Record<string, string> = {
  'base-cabinet-run': 'base cabinets', 'upper-cabinet-run': 'upper cabinets', 'tall-cabinet': 'tall cabinet', 'wall-oven': 'wall oven',
  'towel-bar': 'towel bar', backsplash: 'backsplash', island: 'island', stool: 'stool', pendant: 'pendant', faucet: 'faucet',
  item: 'counter item',
};
const WALL_WORDS: Record<string, string> = { back: 'on the back wall', left: 'on the left wall', right: 'on the right wall', front: 'on the front wall', island: 'at the island' };
const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

/** "the fridge on the right wall", "the second window on the left wall", "the island" */
export function residualName(r: Pick<FitResidual, 'kind' | 'wall' | 'index'>): string {
  const kind = KIND_WORDS[r.kind] ?? r.kind.replace(/-/g, ' ');
  const nth = typeof r.index === 'number' && r.index > 0 ? `${ORDINAL[r.index] ?? `${r.index + 1}th`} ` : '';
  const where = r.wall && r.kind !== 'island' && WALL_WORDS[r.wall] ? ` ${WALL_WORDS[r.wall]}` : '';
  return `the ${nth}${kind}${where}`;
}

const pctOf = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;

/**
 * The gap as short phrases, e.g. ["9% of the frame further LEFT", "18% taller"].
 * Empty when the boxes agree to within the precision the inventory can draw.
 */
export function residualPhrases(r: Pick<FitResidual, 'dx' | 'dy' | 'dw' | 'dh'>): string[] {
  const out: string[] = [];
  if (Math.abs(r.dx) >= SHIFT_MIN) out.push(`${pctOf(r.dx)} of the frame further ${r.dx < 0 ? 'LEFT' : 'RIGHT'}`);
  if (Math.abs(r.dy) >= SHIFT_MIN) out.push(`${pctOf(r.dy)} of the frame ${r.dy < 0 ? 'HIGHER' : 'LOWER'}`);
  if (Math.abs(r.dw) >= SIZE_MIN) out.push(`${pctOf(r.dw)} ${r.dw > 0 ? 'wider' : 'narrower'}`);
  if (Math.abs(r.dh) >= SIZE_MIN) out.push(`${pctOf(r.dh)} ${r.dh > 0 ? 'taller' : 'shorter'}`);
  return out;
}

/** "In the photo the fridge on the right wall is 9% of the frame further LEFT and 18% taller than in the twin." */
export function residualSentence(r: FitResidual): string {
  const phrases = residualPhrases(r);
  const name = residualName(r);
  if (!phrases.length) return `${name[0].toUpperCase()}${name.slice(1)} lands on the photo (overlap ${Math.round(r.iou * 100)}%); the box shapes differ.`;
  const list = phrases.length === 1 ? phrases[0] : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
  return `In the photo ${name} is ${list} than in the twin.`;
}

/**
 * A residual from a matched pair of normalised boxes ([x0, y0, x1, y1], origin
 * top-left, 0..1). The fitter reports residuals itself; this is how they are
 * derived from its matched list when it does not.
 */
export function residualFromBoxes(m: { kind: string; wall: string | null; index?: number; iou: number; twin: readonly number[]; photo: readonly number[]; label?: string | null }): FitResidual {
  const [tx0, ty0, tx1, ty1] = m.twin;
  const [px0, py0, px1, py1] = m.photo;
  const tw = tx1 - tx0;
  const th = ty1 - ty0;
  const dx = (px0 + px1) / 2 - (tx0 + tx1) / 2;
  const dy = (py0 + py1) / 2 - (ty0 + ty1) / 2;
  // the same formula as the fitter's `proportionError`, written out again so
  // this file stays dependency-free — the two must agree to 1e-9
  const pw = Math.max(1e-4, px1 - px0), ph = Math.max(1e-4, py1 - py0);
  const twf = Math.max(1e-4, tw), thf = Math.max(1e-4, th);
  const eSize = 0.5 * (Math.abs(Math.log(twf / pw)) + Math.abs(Math.log(thf / ph)));
  const ePos = 0.5 * (Math.abs(dx) / pw + Math.abs(dy) / ph);
  return {
    kind: m.kind, wall: m.wall, index: m.index, iou: m.iou,
    dx,
    dy,
    dw: tw > 1e-4 ? (px1 - px0) / tw - 1 : 0,
    dh: th > 1e-4 ? (py1 - py0) / th - 1 : 0,
    err: Math.min(1, 0.5 * eSize + 0.5 * ePos),
    label: m.label ?? null,
  };
}

const isResidual = (v: unknown): v is FitResidual => {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.kind === 'string' && ['iou', 'dx', 'dy', 'dw', 'dh'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k] as number));
};

/**
 * The per-element gaps a fit or refine response carries: its own `residuals`
 * when the server reports them, else derived from the matched box pairs;
 * empty when it has neither.
 */
export function residualsOf(res: { residuals?: unknown; matched?: FitResponse['matched'] } | null | undefined, elements?: readonly { id: string; label?: string }[]): FitResidual[] {
  if (!res) return [];
  if (Array.isArray(res.residuals) && res.residuals.length && res.residuals.every(isResidual)) return res.residuals;
  const labels = new Map((elements ?? []).map((e) => [e.id, e.label ?? null]));
  return (res.matched ?? [])
    .filter((m) => Array.isArray(m.twin) && Array.isArray(m.photo) && m.twin.length === 4 && m.photo.length === 4)
    .map((m) => residualFromBoxes({ kind: m.kind, wall: m.wall, index: m.twinIndex, iou: m.iou, twin: m.twin!, photo: m.photo!, label: labels.get(m.photoId) ?? null }));
}

/** "a window on the left wall — the twin draws fewer of this kind" */
export function hintSentence(h: FitHint): string {
  const kind = KIND_WORDS[h.kind] ?? h.kind.replace(/-/g, ' ');
  const where = h.wall && WALL_WORDS[h.wall] ? ` ${WALL_WORDS[h.wall]}` : '';
  const label = h.label ? ` (${h.label})` : '';
  return `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}${where}${label} — ${h.reason}`;
}

/** Matched photo elements ÷ scored photo elements. Null when there is nothing to score. */
export function coverageOf(matched: number, unmatched: number): number | null {
  const total = matched + unmatched;
  return total > 0 ? matched / total : null;
}

// ---------------------------------------------------------------------------
// The match loop's stop rules. Pure: the driver does the screenshots and the
// network, this decides whether to go round again and whether a round's
// result may be kept. Lives here so a headless script can drive it with a
// fake fitter and the accuracy pass can drive it with the real one.
// ---------------------------------------------------------------------------

export interface MatchLoopOptions {
  /** most refine rounds; default 4 */
  maxRounds?: number;
  /** stop once the score reaches this; default 0.9 */
  target?: number;
  /** a round that gains less than this counts as a stall; default 0.02 */
  minGain?: number;
  /** stop after this many stalled rounds in a row; default 2 */
  stallRounds?: number;
  /**
   * How far below the ADOPTED twin's score a round may land and still be
   * kept; default 0 — the loop never adopts a worse twin. (It used to be
   * judged against the best score ever seen less 0.02, which let a round
   * two points under the best replace a better twin.)
   */
  maxDrop?: number;
}

export interface MatchRoundOutcome {
  /** the fit score the round measured after its edits; null when nothing could be measured */
  score: number | null;
  /** whether the round's corrections changed the spec (a re-fit alone is not a change) */
  changed?: boolean;
  /** the model's own 0..1 match estimate (only consulted when the score is unmeasurable) */
  match?: number;
  /** the round's re-fit refused its own edits (`spec_unchanged: 'gated'`): with no corrections applied there is nothing to adopt */
  gated?: boolean;
}

export interface MatchLoopDriver {
  /** false the moment the user edits or the project changes — the loop then stops without adopting anything more */
  alive: () => boolean;
  /** run round N against the current best spec; null when it was abandoned */
  round: (round: number) => Promise<MatchRoundOutcome | null>;
  /** keep round N's result as the new best; false when the store refused it */
  adopt: (round: number, outcome: MatchRoundOutcome) => boolean;
  /** round N's result was refused because it scored worse */
  reject?: (round: number, outcome: MatchRoundOutcome, best: number) => void;
}

export type MatchLoopStop = 'target' | 'stalled' | 'rounds' | 'aborted' | 'unmeasured';

export interface MatchLoopResult {
  rounds: number;
  adopted: number;
  rejected: number;
  /** the ADOPTED twin's score at the end (the start score when no round was kept) */
  score: number | null;
  stoppedBy: MatchLoopStop;
  history: Array<{ round: number; score: number | null; adopted: boolean }>;
}

/** Below this the model's own estimate is not good enough to stop an unmeasurable loop. */
const UNMEASURED_STOP_MATCH = 0.85;
/** Without a fit score to judge by, at most this many rounds run (as the pass always did). */
const UNMEASURED_MAX_ROUNDS = 2;

/**
 * fit → refine → fit → … until the twin lands on the photo (score ≥ target),
 * two rounds in a row stop paying (gain < minGain), or the round budget is
 * spent. Every round is judged against the score of the twin currently
 * ADOPTED (the start score until a round is kept): one that lands below it
 * (by more than `maxDrop`, 0 by default) is refused and the adopted twin
 * stays, so the loop never trades a better twin for a worse one; a round
 * whose corrections changed nothing and whose re-fit was gated has nothing
 * to adopt and counts as a stall. The driver's `alive` going false ends the
 * loop at once. With no inventory to score against the loop falls back to
 * the model's own estimate for at most two rounds.
 */
export async function runMatchLoop(startScore: number | null, driver: MatchLoopDriver, opts: MatchLoopOptions = {}): Promise<MatchLoopResult> {
  const maxRounds = Math.max(1, Math.round(opts.maxRounds ?? 4));
  const target = opts.target ?? 0.9;
  const minGain = opts.minGain ?? 0.02;
  const stallRounds = Math.max(1, Math.round(opts.stallRounds ?? 2));
  const maxDrop = Math.max(0, opts.maxDrop ?? 0);

  const history: MatchLoopResult['history'] = [];
  /** the score of the twin the store holds: the start's, then each adopted round's */
  let adoptedScore = startScore;
  let stalls = 0;
  let adopted = 0;
  let rejected = 0;
  const done = (stoppedBy: MatchLoopStop): MatchLoopResult => ({ rounds: history.length, adopted, rejected, score: adoptedScore, stoppedBy, history });

  if (adoptedScore !== null && adoptedScore >= target) return done('target');
  for (let round = 1; round <= maxRounds; round++) {
    if (!driver.alive()) return done('aborted');
    const outcome = await driver.round(round);
    if (!outcome || !driver.alive()) return done('aborted');
    const score = outcome.score;

    if (score === null) {
      // nothing to measure: keep what the model did, and stop unless it
      // changed something and still thinks the twin is off
      const kept = driver.adopt(round, outcome);
      if (kept) adopted++;
      history.push({ round, score: null, adopted: kept });
      if (adoptedScore !== null) { stalls++; if (stalls >= stallRounds) return done('stalled'); continue; }
      if (!kept || !outcome.changed || (outcome.match ?? 0) >= UNMEASURED_STOP_MATCH || round >= UNMEASURED_MAX_ROUNDS) return done('unmeasured');
      continue;
    }

    let gain: number;
    if (outcome.gated && outcome.changed === false) {
      // the model changed nothing and the re-fit kept the spec it was given:
      // the twin on screen is already this twin
      history.push({ round, score, adopted: false });
      gain = 0;
    } else if (adoptedScore !== null && score < adoptedScore - maxDrop) {
      rejected++;
      driver.reject?.(round, outcome, adoptedScore);
      history.push({ round, score, adopted: false });
      gain = 0;
    } else {
      const kept = driver.adopt(round, outcome);
      if (!kept) return done('aborted');
      adopted++;
      history.push({ round, score, adopted: true });
      gain = adoptedScore === null ? Number.POSITIVE_INFINITY : score - adoptedScore;
      adoptedScore = score;
    }

    if (adoptedScore !== null && adoptedScore >= target) return done('target');
    stalls = gain < minGain ? stalls + 1 : 0;
    if (stalls >= stallRounds) return done('stalled');
  }
  return done('rounds');
}

// ---------------------------------------------------------------------------
// Accuracy pass
// ---------------------------------------------------------------------------

export type RefinePass = 'geometry' | 'finishes';

export interface CorrectionRecord {
  op: 'set' | 'add' | 'remove';
  field: string;
  index: number | null;
  from: unknown;
  to: unknown;
  reason: string;
  confidence: number;
  applied: boolean;
  rejected?: string;
}

export interface RefineResponse {
  spec: RoomSpec;
  corrections: CorrectionRecord[];
  notes: string[];
  match: number;
  /** finish observations that were applied to `spec.materials` */
  finishes: FinishObservation[];
  rejectedFinishes: Array<{ slot: string; reason: string }>;
  model: string;
  elapsedMs: number;
  changed: boolean;
  /**
   * When the route re-fits after its corrections, the solved camera also lands
   * in `spec.detected.camera.solved`; these two are the same result surfaced
   * for callers that only want the number.
   */
  camera?: SolvedCamera | null;
  fitScore?: number | null;
  /** the re-fit's per-element gaps and unmatched-photo hints, for the next round and the match report */
  residuals?: FitResidual[];
  hints?: string[];
  unmatchedPhoto?: FitResponse['unmatchedPhoto'];
  /** matched photo elements ÷ scored photo elements, 0..1 */
  coverage?: number | null;
  /**
   * 'gated' when the re-fit refused its own edits and returned the corrected
   * spec as it was; 'partial' when it refused the aggregate but kept a size
   * the photo could not measure, which is a real spec change and adopted like
   * an ungated one (a route that reports these; older ones do not).
   */
  spec_unchanged?: string | null;
}

/**
 * Compare the twin against the client's photo and correct it. `viewportUrl`
 * must be a screenshot taken from the photo-matched camera at the photo's
 * aspect ratio, otherwise the model is comparing two different views and its
 * edits will be noise. `passes` defaults to geometry + finishes together.
 * `selections` is what is actually on screen (slot → material id) — it can
 * differ from `spec.materials` once the user has picked finishes by hand, and
 * the finishes pass must judge the screenshot it was given, not the spec.
 * `aspect` is the photo's width ÷ height for the re-fit that follows a
 * geometry pass (see fitTwin).
 */
export interface RefineInput {
  spec: RoomSpec;
  photoUrl: string;
  viewportUrl: string;
  minConfidence?: number;
  passes?: RefinePass[];
  selections?: Record<string, string>;
  aspect?: number;
  /**
   * The last fit's per-element gaps and its unmatched-photo hints. The route
   * turns these into the prompt's measured corrections; without them it
   * re-fits the spec itself to get them. Round is for the server log only.
   */
  residuals?: FitResidual[];
  hints?: string[];
  round?: number;
}

export function refineTwin(input: RefineInput, signal?: AbortSignal): Promise<RefineResponse> {
  return request<RefineResponse>('/api/refine', { method: 'POST', body: JSON.stringify(input), signal });
}

// ---------------------------------------------------------------------------
// Photo fit
// ---------------------------------------------------------------------------

export interface FitResponse {
  /** the spec with the fitted dimensions / placements and `detected.camera.solved` filled in */
  spec: RoomSpec;
  camera: SolvedCamera | null;
  /** mean IoU of the twin's projected elements against the photo's boxes, 0..1; null when nothing could be matched */
  score: number | null;
  /**
   * 1 − the weighted mean proportion error over the same pairs: how close the
   * twin's sizes and positions are, 1 = exact. NOT the score — it reads
   * 15–20 points higher for the same twin, so the two are always shown with
   * their own labels.
   */
  proportions?: number | null;
  /** photo element ↔ twin element pairs the fitter scored */
  matched?: Array<{ kind: string; wall: string | null; iou: number; photoId: string; twinIndex: number; twin?: number[]; photo?: number[]; weight?: number; err?: number }>;
  unmatchedPhoto?: Array<{ id: string; kind: string; reason: string }>;
  unmatchedTwin?: Array<{ kind: string; index: number }>;
  iterations?: number;
  evaluations?: number;
  ms?: number;
  /** what ended the search: 'evaluations' (the budget), 'converged', 'rounds', or 'time' (the safety net) */
  endedBy?: string;
  /** the original spec's score through the solved camera — what the plausibility gate compared against */
  originalScore?: number | null;
  /**
   * 'gated' when the fitter kept the original spec (camera solved, edits
   * discarded — adopt the camera alone, see `specToAdopt`). 'partial' when
   * the gate refused the aggregate but a size the photo could not measure
   * survived it (`fit.ts adoptUnmeasured`): the returned spec differs from
   * the gated one in that size alone, so it is ADOPTED like an ungated fit,
   * not treated as "unchanged".
   */
  spec_unchanged?: string | null;
  notes?: string[];
  /** per-element gaps between the photo's box and the twin's, one per matched pair (the fitter reports these; `residualsOf` derives them from `matched` for a server that does not) */
  residuals?: FitResidual[];
  /** plain-words hints about photo elements the twin does not draw */
  hints?: string[];
  /** matched photo elements ÷ scored photo elements, 0..1 */
  coverage?: number | null;
}

/** A fit response's camera, however the route surfaced it. */
function cameraOf(res: { camera?: SolvedCamera | null; spec?: RoomSpec | null } | null | undefined): SolvedCamera | null {
  if (!res) return null;
  if (res.camera && typeof res.camera === 'object') return res.camera;
  const spec = res.spec;
  // a solved photo camera only exists on a photographed room: an exterior
  // solves its own, and a floor plan has no camera to solve
  return isSingleRoom(spec) ? spec.detected?.camera?.solved ?? null : null;
}

/**
 * The spec a client should hold after a fit: the fitted spec with the
 * solved camera on it — unless the fit was GATED (`spec_unchanged:
 * 'gated'`: the fitter refused its own edits), in which case the spec the
 * client already holds is kept as it is and only the solved camera (and the
 * camera words that go with it) is attached, since the fitter's copy of
 * the original may have been re-reconciled into something that draws
 * differently. Never returns `current` itself when there is a camera to
 * attach (the store tells edits apart by reference).
 *
 * 'gated' is tested by identity, so 'partial' — the gate refused the
 * aggregate but a size the photo could not measure survived it — takes the
 * ordinary path and the returned spec IS adopted. That is deliberate: a
 * partial result really did change the spec, in the one field the photo could
 * not measure and in nothing else, and the client should draw it.
 */
export function specToAdopt(current: RoomSpec, res: Pick<FitResponse, 'spec' | 'camera' | 'spec_unchanged'>): RoomSpec {
  const camera = cameraOf(res);
  if (res.spec_unchanged === 'gated' || !res.spec || typeof res.spec !== 'object') {
    if (current.roomType === 'exterior' || !camera) return current;
    const words = isSingleRoom(res.spec) && res.spec.detected?.camera ? res.spec.detected.camera : null;
    return { ...current, detected: { ...current.detected, camera: { ...current.detected.camera, ...(words ?? {}), solved: camera } } };
  }
  const spec = res.spec;
  if (spec.roomType === 'exterior' || !camera) return spec;
  if (spec.detected?.camera?.solved) return spec;
  return { ...spec, detected: { ...spec.detected, camera: { ...spec.detected.camera, solved: camera } } };
}

/**
 * The residuals and hints a correction round may reuse from an earlier fit
 * report: only when the report was measured on the very spec object the
 * round is about to correct (a report keyed by project alone can belong to a
 * twin the user has since edited, and its gaps would then describe the
 * wrong twin). Undefined otherwise, so the route measures for itself.
 */
export function measuredGapsFor(report: { projectId: string | null; spec: RoomSpec | null; residuals: FitResidual[]; hints: string[] }, projectId: string, spec: RoomSpec): { residuals?: FitResidual[]; hints?: string[] } {
  if (report.projectId !== projectId || !report.spec || report.spec !== spec) return {};
  return { residuals: report.residuals.length ? report.residuals : undefined, hints: report.hints.length ? report.hints : undefined };
}

/**
 * Project the twin's elements through a camera and adjust camera + spec until
 * they land on the photo's inventory boxes (`spec.detected.elements`). Pure
 * arithmetic on the server — no model call — so it returns in well under a
 * second. `aspect` is the photo's width ÷ height: the boxes are normalised,
 * so without it the fitter has to assume a frame shape and the vertical lens
 * it solves is off by that guess. Never rejects a spec without elements — it
 * comes back unchanged with a null score.
 */
export function fitTwin(spec: RoomSpec, opts: { aspect?: number } = {}, signal?: AbortSignal): Promise<FitResponse> {
  const aspect = typeof opts.aspect === 'number' && Number.isFinite(opts.aspect) && opts.aspect > 0 ? opts.aspect : undefined;
  return request<FitResponse>('/api/fit', { method: 'POST', body: JSON.stringify({ spec, ...(aspect ? { aspect } : {}) }), signal });
}

/**
 * The fit's PROPORTIONS number, when the response carries one. Separate from
 * `fitScoreOf` on purpose: they answer different questions and must never be
 * shown under one label. Takes the same union of responses `fitScoreOf` does —
 * only /api/fit reports proportions, and a refine response correctly has none.
 */
export function fitProportionsOf(res: { proportions?: number | null; spec?: RoomSpec | null } | null | undefined): number | null {
  const v = res?.proportions;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
}

/** The fit score a response carries, wherever the route put it. */
export function fitScoreOf(res: { score?: number | null; fitScore?: number | null; camera?: SolvedCamera | null; spec?: RoomSpec | null } | null | undefined): number | null {
  if (!res) return null;
  const candidates = [res.score, res.fitScore, res.camera?.score, isSingleRoom(res.spec) ? res.spec.detected?.camera?.solved?.score : null];
  for (const c of candidates) if (typeof c === 'number' && Number.isFinite(c)) return Math.max(0, Math.min(1, c));
  return null;
}

export function startRender(input: StartRenderInput, signal?: AbortSignal): Promise<RenderJob> {
  return request<RenderJob>('/api/render', { method: 'POST', body: JSON.stringify(input), signal });
}

export function getRenderJob(id: string): Promise<RenderJob> {
  return request<RenderJob>(`/api/render/${encodeURIComponent(id)}`, { cache: 'no-store' });
}

export function startScan(input: StartScanInput): Promise<ScanJob> {
  return request<ScanJob>('/api/scan', { method: 'POST', body: JSON.stringify(input) });
}

export function getScanJob(id: string): Promise<ScanJob> {
  return request<ScanJob>(`/api/scan/${encodeURIComponent(id)}`, { cache: 'no-store' });
}

export function saveProject(project: Project, signal?: AbortSignal): Promise<{ id: string; url: string }> {
  return request<{ id: string; url: string }>(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'PUT', body: JSON.stringify(project), signal });
}

export function loadProject(id: string): Promise<Project> {
  return request<Project>(`/api/projects/${encodeURIComponent(id)}`, { cache: 'no-store' });
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

export interface PollOptions<T> {
  intervalMs?: number;
  timeoutMs?: number;
  onTick?: (value: T, attempt: number) => void;
  /** default: `value.status` is 'completed' or 'failed' */
  isDone?: (value: T) => boolean;
  signal?: AbortSignal;
}

const defaultIsDone = (v: unknown) => {
  const s = (v as { status?: string } | null)?.status;
  return s === 'completed' || s === 'failed';
};

/** Calls `fn` until `isDone` (default: job status terminal), honouring interval, timeout and abort. */
export async function pollUntilDone<T>(fn: () => Promise<T>, opts: PollOptions<T> = {}): Promise<T> {
  const intervalMs = opts.intervalMs ?? 2500;
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  const isDone = opts.isDone ?? defaultIsDone;
  const started = Date.now();
  let attempt = 0;
  let transientErrors = 0;
  for (;;) {
    if (opts.signal?.aborted) throw new ApiError(0, 'aborted', 'Polling cancelled');
    attempt++;
    let value: T;
    try {
      value = await fn();
      transientErrors = 0;
    } catch (err) {
      // tolerate a few network blips, but surface real API errors immediately
      if (err instanceof ApiError && (err.status === 0 || err.status >= 500) && ++transientErrors <= 3) {
        await wait(intervalMs, opts.signal);
        continue;
      }
      throw err;
    }
    opts.onTick?.(value, attempt);
    if (isDone(value)) return value;
    if (Date.now() - started > timeoutMs) throw new ApiError(504, 'timeout', `Timed out after ${Math.round(timeoutMs / 1000)}s`);
    await wait(intervalMs, opts.signal);
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ApiError(0, 'aborted', 'Polling cancelled'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new ApiError(0, 'aborted', 'Polling cancelled')); }, { once: true });
  });
}
