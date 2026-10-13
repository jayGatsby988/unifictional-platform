/**
 * Job persistence for async work (renders, 3D scans). Warm invocations hit the
 * in-memory map; cold starts fall back to the JSON copy in storage at
 * `jobs/<id>.json`, so polling survives function recycling on Vercel.
 */
import type { RenderJob, ScanJob } from '@/lib/spec/types';
import { getJson, putJson } from '@/lib/storage/blob';
import { serverWarn } from '@/lib/ai/log';

export const JOB_ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

export interface StoredRenderJob {
  kind: 'render';
  projectId: string;
  job: RenderJob;
  updatedAt: string;
}

export interface StoredScanJob {
  kind: 'scan';
  projectId: string;
  job: ScanJob;
  /** provider-side task id (Meshy task id, Higgsfield request id) */
  providerJobId: string;
  /** set once the GLB has been copied into our own storage */
  copied?: boolean;
  updatedAt: string;
}

export type StoredJob = StoredRenderJob | StoredScanJob;

const memory = new Map<string, StoredJob>();

function jobPath(id: string): string {
  if (!JOB_ID_RE.test(id)) throw new Error(`Invalid job id: ${id}`);
  return `jobs/${id}.json`;
}

async function persist(record: StoredJob): Promise<void> {
  memory.set(record.job.id, record);
  try {
    await putJson(jobPath(record.job.id), record);
  } catch (err) {
    // Memory still holds the job; a cold start would lose it, which the client
    // sees as 404 and can surface as "expired".
    serverWarn('jobs', 'Failed to persist job JSON', { id: record.job.id, error: (err as Error).message });
  }
}

async function load(id: string): Promise<StoredJob | null> {
  if (!JOB_ID_RE.test(id)) return null;
  const hit = memory.get(id);
  if (hit) return hit;
  const stored = await getJson<StoredJob>(jobPath(id));
  if (stored && stored.job && stored.job.id === id) {
    memory.set(id, stored);
    return stored;
  }
  return null;
}

export async function saveRenderJob(projectId: string, job: RenderJob): Promise<StoredRenderJob> {
  const record: StoredRenderJob = { kind: 'render', projectId, job, updatedAt: new Date().toISOString() };
  await persist(record);
  return record;
}

export async function getRenderJob(id: string): Promise<StoredRenderJob | null> {
  const rec = await load(id);
  return rec && rec.kind === 'render' ? rec : null;
}

export async function saveScanJob(record: Omit<StoredScanJob, 'kind' | 'updatedAt'>): Promise<StoredScanJob> {
  const full: StoredScanJob = { kind: 'scan', ...record, updatedAt: new Date().toISOString() };
  await persist(full);
  return full;
}

export async function getScanJob(id: string): Promise<StoredScanJob | null> {
  const rec = await load(id);
  return rec && rec.kind === 'scan' ? rec : null;
}
