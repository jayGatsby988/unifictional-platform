/**
 * GET /api/scan/:id — polls the provider, persists progress, and once the
 * task succeeds copies the GLB into our own storage (provider URLs expire).
 */
import { errorMessage, serverLog, serverWarn } from '@/lib/ai/log';
import { SCAN_PROVIDERS } from '@/lib/ai/providers';
import { getScanJob, saveScanJob } from '@/lib/jobs/store';
import type { ScanJob } from '@/lib/spec/types';
import { put } from '@/lib/storage/blob';
import { HttpError, assertId, guard, json } from '../../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_GLB_BYTES = 150 * 1024 * 1024;

async function copyModel(projectId: string, jobId: string, url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_GLB_BYTES) throw new Error(`model too large (${len} bytes)`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_GLB_BYTES) throw new Error(`model too large (${buffer.byteLength} bytes)`);
    const stored = await put(`scans/${projectId}/${jobId}.glb`, buffer, 'model/gltf-binary', { cacheSeconds: 60 * 60 * 24 * 365 });
    serverLog('scan', 'model copied to storage', { id: jobId, bytes: buffer.byteLength });
    return stored.url;
  } catch (err) {
    serverWarn('scan', 'could not copy model; using provider URL', { id: jobId, error: errorMessage(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard('scan.get', async () => {
    const { id } = await ctx.params;
    const rec = await getScanJob(assertId(id));
    if (!rec) throw new HttpError(404, 'not_found', 'Scan job not found (it may have expired)');
    if (rec.job.status === 'completed' || rec.job.status === 'failed') return json(rec.job);

    const provider = SCAN_PROVIDERS[rec.job.provider];
    if (!provider.isConfigured()) throw new HttpError(503, 'not_configured', `${provider.label} is no longer configured`);
    const status = await provider.get(rec.providerJobId);
    let job: ScanJob = { ...rec.job, status: status.status, progress: status.progress };
    if (status.error) job.error = status.error;
    let copied = rec.copied ?? false;
    if (status.status === 'completed' && status.resultUrl) {
      job.resultUrl = status.resultUrl;
      const own = await copyModel(rec.projectId, job.id, status.resultUrl);
      if (own) { job = { ...job, resultUrl: own }; copied = true; }
    }
    await saveScanJob({ projectId: rec.projectId, job, providerJobId: rec.providerJobId, copied });
    return json(job);
  });
}
