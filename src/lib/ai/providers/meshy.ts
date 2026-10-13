/**
 * Meshy image-to-3D adapter ("AI scan" tier). Optional — needs MESHY_API_KEY.
 *
 *   POST https://api.meshy.ai/openapi/v1/image-to-3d
 *        { image_url, enable_pbr:true, should_texture:true, ai_model:'meshy-5' } → { result: taskId }
 *   GET  https://api.meshy.ai/openapi/v1/image-to-3d/{id}
 *        → { status:'PENDING'|'IN_PROGRESS'|'SUCCEEDED'|'FAILED'|'CANCELED', progress, model_urls:{glb}, thumbnail_url, task_error }
 */
import { fetchBytes } from '@/lib/storage/blob';
import { serverLog } from '@/lib/ai/log';
import { ProviderError, notConfigured, providerFetch, providerHttpError, type ScanCreateRequest, type ScanProvider, type ScanStatus } from './types';

const ID = 'meshy';
const BASE = 'https://api.meshy.ai/openapi/v1/image-to-3d';

export const isMeshyConfigured = () => Boolean(process.env.MESHY_API_KEY);
export const meshyModel = () => process.env.MESHY_MODEL ?? 'meshy-5';

interface MeshyTask {
  id?: string;
  status?: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | string;
  progress?: number;
  model_urls?: { glb?: string; fbx?: string; obj?: string; usdz?: string };
  thumbnail_url?: string;
  task_error?: { message?: string } | null;
}

function headers(): Record<string, string> {
  const key = process.env.MESHY_API_KEY;
  if (!key) throw notConfigured(ID, 'Meshy');
  return { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' };
}

async function imageUrlFor(req: ScanCreateRequest): Promise<string> {
  // Meshy accepts public URLs or data URIs; local dev files must be inlined.
  if (/^https?:\/\//i.test(req.imageUrl) && !/localhost|127\.0\.0\.1/.test(req.imageUrl)) return req.imageUrl;
  const src = req.imageBytes ?? (await fetchBytes(req.imageUrl));
  return `data:${src.contentType};base64,${src.buffer.toString('base64')}`;
}

export const meshyScanProvider: ScanProvider = {
  id: 'meshy',
  label: 'Meshy image-to-3D',
  model: meshyModel(),
  isConfigured: isMeshyConfigured,
  async create(req: ScanCreateRequest): Promise<{ jobId: string }> {
    const h = headers();
    const image_url = await imageUrlFor(req);
    const body = { image_url, enable_pbr: true, should_texture: true, ai_model: meshyModel() };
    const res = await providerFetch(ID, BASE, { method: 'POST', headers: h, body: JSON.stringify(body) }, 60_000);
    if (!res.ok) throw await providerHttpError(ID, res, 'Meshy image-to-3d create');
    const json = (await res.json().catch(() => null)) as { result?: string } | null;
    if (!json?.result) throw new ProviderError(ID, 'Meshy create returned no task id', { code: 'bad_response', retryable: false });
    serverLog('scan.meshy', 'task created', { taskId: json.result });
    return { jobId: json.result };
  },
  async get(jobId: string): Promise<ScanStatus> {
    const h = headers();
    const res = await providerFetch(ID, `${BASE}/${encodeURIComponent(jobId)}`, { method: 'GET', headers: h }, 30_000);
    if (res.status === 404) return { status: 'failed', progress: 0, error: 'Meshy task not found (it may have expired)' };
    if (!res.ok) throw await providerHttpError(ID, res, 'Meshy task status');
    const task = (await res.json().catch(() => null)) as MeshyTask | null;
    if (!task) throw new ProviderError(ID, 'Meshy status returned a non-JSON body', { code: 'bad_response' });
    const progress = Math.max(0, Math.min(1, (task.progress ?? 0) / 100));
    switch (task.status) {
      case 'SUCCEEDED': {
        const glb = task.model_urls?.glb;
        if (!glb) return { status: 'failed', progress: 1, error: 'Meshy task succeeded without a GLB URL' };
        return { status: 'completed', progress: 1, resultUrl: glb, thumbnailUrl: task.thumbnail_url };
      }
      case 'FAILED':
      case 'CANCELED':
        return { status: 'failed', progress, error: task.task_error?.message ?? `Meshy task ${task.status.toLowerCase()}` };
      case 'IN_PROGRESS':
        return { status: 'running', progress, thumbnailUrl: task.thumbnail_url };
      default:
        return { status: 'queued', progress };
    }
  },
};
