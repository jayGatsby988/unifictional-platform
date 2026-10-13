/**
 * Higgsfield Cloud adapter — optional. Implements BOTH provider interfaces:
 *
 *   RenderProvider  → job type `nano_banana_pro`
 *       Image edit with up to 14 reference images. Input (per Higgsfield docs):
 *       { prompt, image_references: [{ type:'image_url', image_url }], resolution: '1k'|'2k'|'4k', aspect_ratio?: 'auto'|'1:1'|'3:2'|'2:3' }
 *       Output: one image URL.
 *
 *   ScanProvider    → job type `hunyuan3d_v3_image_to_3d`
 *       { image_references: [{ type:'image_url', image_url }], enable_pbr: boolean, face_count: number }
 *       Output: GLB URL (+ optional thumbnail).
 *
 * All HTTP details live in `createJob` / `getJob` below so endpoint paths,
 * auth headers and payload envelopes can be adjusted without touching the
 * rest of the app. Both throw 'Higgsfield provider not configured' when
 * HIGGSFIELD_API_KEY / HIGGSFIELD_API_SECRET are absent.
 *
 * NOTE: the exact request/response shapes below follow the Higgsfield Cloud
 * API conventions (POST /v1/<job-type>, GET /v1/requests/<id>/status) but have
 * not been exercised against a live account — parsing is deliberately
 * tolerant and every unexpected shape raises a descriptive ProviderError so
 * the render router falls back to OpenAI.
 */
import { fetchBytes } from '@/lib/storage/blob';
import { serverLog } from '@/lib/ai/log';
import {
  ProviderError, providerFetch, providerHttpError, sleep,
  type RenderProvider, type RenderRequest, type RenderResult, type ScanCreateRequest, type ScanProvider, type ScanStatus,
} from './types';

const ID = 'higgsfield';
export const HIGGSFIELD_API_BASE = () => (process.env.HIGGSFIELD_API_BASE ?? 'https://platform.higgsfield.ai').replace(/\/+$/, '');

export type HiggsfieldJobType = 'nano_banana_pro' | 'hunyuan3d_v3_image_to_3d';
export type HiggsfieldResolution = '1k' | '2k' | '4k';

export interface HiggsfieldImageReference { type: 'image_url'; image_url: string }

export interface NanoBananaProInput {
  prompt: string;
  /** up to 14 references; the first is the image being edited */
  image_references: HiggsfieldImageReference[];
  resolution: HiggsfieldResolution;
  aspect_ratio?: 'auto' | '1:1' | '3:2' | '2:3' | '16:9' | '9:16';
}

export interface Hunyuan3dInput {
  image_references: HiggsfieldImageReference[];
  enable_pbr: boolean;
  face_count: number;
}

export type HiggsfieldJobStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'nsfw';

export interface HiggsfieldJob {
  id: string;
  status: HiggsfieldJobStatus;
  /** 0..1 when the API reports it */
  progress?: number;
  /** every URL found in the result payload, tagged by best-guess kind */
  outputs: Array<{ kind: 'image' | 'model' | 'thumbnail' | 'unknown'; url: string }>;
  error?: string;
  raw: unknown;
}

export const isHiggsfieldConfigured = () => Boolean(process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_SECRET);

function credentials(): { key: string; secret: string } {
  const key = process.env.HIGGSFIELD_API_KEY;
  const secret = process.env.HIGGSFIELD_API_SECRET;
  if (!key || !secret) throw new ProviderError(ID, 'Higgsfield provider not configured', { code: 'not_configured', status: 503, retryable: false });
  return { key, secret };
}

function authHeaders(): Record<string, string> {
  const { key, secret } = credentials();
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    authorization: `Key ${key}:${secret}`,
    'hf-api-key': key,
    'hf-api-secret': secret,
  };
}

/** Kicks off a job. Returns the provider request id. */
export async function createJob(type: HiggsfieldJobType, input: NanoBananaProInput | Hunyuan3dInput, signal?: AbortSignal): Promise<{ id: string }> {
  const headers = authHeaders();
  const url = `${HIGGSFIELD_API_BASE()}/v1/${type}`;
  const res = await providerFetch(ID, url, { method: 'POST', headers, body: JSON.stringify({ params: input }) }, 60_000, signal);
  if (!res.ok) throw await providerHttpError(ID, res, `Higgsfield ${type} create`);
  const json = (await res.json().catch(() => null)) as { id?: string; request_id?: string; requestId?: string } | null;
  const id = json?.id ?? json?.request_id ?? json?.requestId;
  if (!id || typeof id !== 'string') throw new ProviderError(ID, `Higgsfield ${type} create returned no request id`, { code: 'bad_response', retryable: false });
  serverLog('higgsfield', 'job created', { type, id });
  return { id };
}

function collectUrls(node: unknown, out: HiggsfieldJob['outputs'], hintKey = ''): void {
  if (!node) return;
  if (typeof node === 'string') {
    if (/^https?:\/\//i.test(node)) {
      const lower = `${hintKey} ${node}`.toLowerCase();
      const kind = /\.glb|model|mesh/.test(lower) ? 'model' : /thumb|preview/.test(lower) ? 'thumbnail' : /\.(png|jpe?g|webp)|image|raw|min/.test(lower) ? 'image' : 'unknown';
      out.push({ kind, url: node });
    }
    return;
  }
  if (Array.isArray(node)) { node.forEach((n) => collectUrls(n, out, hintKey)); return; }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) collectUrls(v, out, `${hintKey} ${k}`);
  }
}

/** Reads the status of a job. */
export async function getJob(id: string, signal?: AbortSignal): Promise<HiggsfieldJob> {
  const headers = authHeaders();
  const url = `${HIGGSFIELD_API_BASE()}/v1/requests/${encodeURIComponent(id)}/status`;
  const res = await providerFetch(ID, url, { method: 'GET', headers }, 30_000, signal);
  if (!res.ok) throw await providerHttpError(ID, res, 'Higgsfield job status');
  const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw) throw new ProviderError(ID, 'Higgsfield status returned a non-JSON body', { code: 'bad_response' });
  const statusRaw = String(raw.status ?? raw.state ?? '').toLowerCase();
  const status: HiggsfieldJobStatus =
    /complete|succeed|done|finished/.test(statusRaw) ? 'completed'
      : /fail|error/.test(statusRaw) ? 'failed'
        : /cancel/.test(statusRaw) ? 'cancelled'
          : /nsfw|moderat/.test(statusRaw) ? 'nsfw'
            : /progress|running|processing/.test(statusRaw) ? 'in_progress'
              : 'queued';
  const outputs: HiggsfieldJob['outputs'] = [];
  collectUrls(raw.results ?? raw.result ?? raw.outputs ?? raw.output ?? raw.images ?? raw.data ?? null, outputs, 'result');
  const progressRaw = raw.progress;
  const progress = typeof progressRaw === 'number' ? (progressRaw > 1 ? progressRaw / 100 : progressRaw) : undefined;
  const errorRaw = raw.error ?? raw.message;
  const error = typeof errorRaw === 'string' ? errorRaw : errorRaw && typeof errorRaw === 'object' ? String((errorRaw as { message?: string }).message ?? JSON.stringify(errorRaw)) : undefined;
  return { id, status, progress, outputs, error: status === 'failed' || status === 'nsfw' ? error ?? `Higgsfield job ${status}` : undefined, raw };
}

async function referenceFor(url: string, bytes?: { buffer: Buffer; contentType: string }): Promise<HiggsfieldImageReference> {
  // Public URLs are passed through; local files are inlined as data URIs.
  if (/^https?:\/\//i.test(url) && !/localhost|127\.0\.0\.1/.test(url)) return { type: 'image_url', image_url: url };
  const src = bytes ?? (await fetchBytes(url));
  return { type: 'image_url', image_url: `data:${src.contentType};base64,${src.buffer.toString('base64')}` };
}

function mapScanStatus(job: HiggsfieldJob): ScanStatus {
  const model = job.outputs.find((o) => o.kind === 'model') ?? job.outputs.find((o) => /\.glb(\?|$)/i.test(o.url));
  const thumb = job.outputs.find((o) => o.kind === 'thumbnail' || o.kind === 'image');
  switch (job.status) {
    case 'completed':
      if (!model) return { status: 'failed', progress: 1, error: 'Higgsfield job completed without a GLB URL' };
      return { status: 'completed', progress: 1, resultUrl: model.url, thumbnailUrl: thumb?.url };
    case 'failed':
    case 'cancelled':
    case 'nsfw':
      return { status: 'failed', progress: job.progress ?? 0, error: job.error ?? `Higgsfield job ${job.status}` };
    case 'in_progress':
      return { status: 'running', progress: job.progress ?? 0.3 };
    default:
      return { status: 'queued', progress: job.progress ?? 0.05 };
  }
}

export const higgsfieldRenderProvider: RenderProvider = {
  id: 'higgsfield',
  label: 'Higgsfield Nano Banana Pro',
  isConfigured: isHiggsfieldConfigured,
  async render(req: RenderRequest): Promise<RenderResult> {
    credentials();
    const started = Date.now();
    req.onProgress?.({ progress: 0.05, message: 'Submitting to Higgsfield' });
    const reference = await referenceFor(req.sourceUrl, req.sourceBytes);
    const resolution: HiggsfieldResolution = req.quality === 'high' ? '2k' : '1k';
    const aspect_ratio = req.size === '1536x1024' ? '3:2' : req.size === '1024x1536' ? '2:3' : '1:1';
    const { id } = await createJob('nano_banana_pro', { prompt: req.prompt, image_references: [reference], resolution, aspect_ratio }, req.signal);
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      await sleep(4_000, req.signal);
      const job = await getJob(id, req.signal);
      req.onProgress?.({ progress: 0.15 + 0.7 * (job.progress ?? 0.3), message: `Higgsfield ${job.status.replace('_', ' ')}` });
      if (job.status === 'completed') {
        const image = job.outputs.find((o) => o.kind === 'image') ?? job.outputs[0];
        if (!image) throw new ProviderError(ID, 'Higgsfield job completed without an image URL', { code: 'bad_response', retryable: false });
        const res = await providerFetch(ID, image.url, { method: 'GET' }, 60_000, req.signal);
        if (!res.ok) throw await providerHttpError(ID, res, 'Higgsfield result download');
        const buffer = Buffer.from(await res.arrayBuffer());
        const ct = (res.headers.get('content-type') ?? '').toLowerCase();
        const mime = ct.includes('jpeg') || ct.includes('jpg') ? 'image/jpeg' : ct.includes('webp') ? 'image/webp' : 'image/png';
        return { imageBuffer: buffer, mime, elapsedMs: Date.now() - started, model: 'nano_banana_pro' };
      }
      if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'nsfw') {
        throw new ProviderError(ID, job.error ?? `Higgsfield job ${job.status}`, { code: job.status, retryable: false });
      }
    }
    throw new ProviderError(ID, 'Higgsfield render timed out', { code: 'timeout', status: 504, retryable: true });
  },
};

export const higgsfieldScanProvider: ScanProvider = {
  id: 'higgsfield',
  label: 'Higgsfield Hunyuan3D v3',
  model: 'hunyuan3d_v3_image_to_3d',
  isConfigured: isHiggsfieldConfigured,
  async create(req: ScanCreateRequest): Promise<{ jobId: string }> {
    credentials();
    const reference = await referenceFor(req.imageUrl, req.imageBytes);
    const faceCount = Number(process.env.HIGGSFIELD_FACE_COUNT ?? 120_000);
    const { id } = await createJob('hunyuan3d_v3_image_to_3d', { image_references: [reference], enable_pbr: true, face_count: Number.isFinite(faceCount) ? faceCount : 120_000 });
    return { jobId: id };
  },
  async get(jobId: string): Promise<ScanStatus> {
    return mapScanStatus(await getJob(jobId));
  },
};
