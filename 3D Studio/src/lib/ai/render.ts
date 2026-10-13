/**
 * Render router: picks a provider (request override → RENDER_PROVIDER env →
 * fallbacks), runs the edit, stores the image and persists the RenderJob.
 * Never throws for provider failures — returns a failed job with `error` so
 * the client can show it and keep the job in the project history.
 */
import { nanoid } from 'nanoid';
import type { RenderJob, RoomSpec } from '@/lib/spec/types';
import { MAX_UPLOAD_BYTES, fetchBytes, put } from '@/lib/storage/blob';
import { imageDimensions } from '@/lib/storage/image-meta';
import { getRenderJob, saveRenderJob } from '@/lib/jobs/store';
import { errorMessage, serverError, serverLog, serverWarn, startTimer } from './log';
import { buildRenderPrompt } from './prompt';
import { ProviderError, renderProviderOrder, type RenderProgress, type RenderProviderId, type RenderQuality, type RenderSize } from './providers';


/**
 * Quota circuit breaker.
 *
 * A provider whose project has no billing (or has hit a hard limit) fails in
 * about a second with a 429. Retrying it on every render is pure latency and
 * log noise, but permanently demoting it would mean the better model never
 * comes back once the account is topped up. So a quota failure parks that
 * provider for a few minutes and it re-enters the rotation by itself.
 * The last provider in the order is never skipped — something has to try.
 */
const QUOTA_COOLDOWN_MS = 5 * 60 * 1000;
const cooldownUntil = new Map<string, number>();

function isCoolingDown(id: string): boolean {
  const until = cooldownUntil.get(id);
  if (until === undefined) return false;
  if (Date.now() >= until) { cooldownUntil.delete(id); return false; }
  return true;
}

function noteFailure(id: string, err: unknown): void {
  const status = (err as { status?: number } | null)?.status;
  const text = errorMessage(err).toLowerCase();
  const isQuota = status === 429 || text.includes('quota') || text.includes('rate limit') || text.includes('billing');
  if (isQuota) {
    cooldownUntil.set(id, Date.now() + QUOTA_COOLDOWN_MS);
    serverWarn('render', `${id} hit a quota limit; skipping it for ${QUOTA_COOLDOWN_MS / 60000} minutes`);
  }
}

export interface RunRenderInput {
  projectId: string;
  spec: RoomSpec;
  selections: Record<string, string>;
  sourceUrl: string;
  sourceKind: 'photo' | 'viewport';
  provider?: RenderProviderId;
  /** slots that differ from the source photo — produces a surgical "change only" prompt */
  changedSlots?: string[];
  size?: RenderSize;
  quality?: RenderQuality;
  /** request origin (resolves root-relative source paths) */
  origin?: string;
  signal?: AbortSignal;
  onProgress?: (p: RenderProgress & { provider: RenderProviderId }) => void;
}

/** Output size closest to the source aspect ratio. */
export function pickRenderSize(dims: { width: number; height: number } | null): RenderSize {
  if (!dims || !dims.width || !dims.height) return '1536x1024';
  const aspect = dims.width / dims.height;
  if (aspect > 1.2) return '1536x1024';
  if (aspect < 0.83) return '1024x1536';
  return '1024x1024';
}

const extFor = (mime: string) => (mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png');

export async function runRender(input: RunRenderInput): Promise<RenderJob> {
  const elapsed = startTimer();
  const id = nanoid(12);
  const createdAt = new Date().toISOString();
  const mode = input.sourceKind === 'viewport' ? 'viewport' : 'photo';
  const prompt = buildRenderPrompt(input.spec, input.selections, input.changedSlots, mode);
  const providers = renderProviderOrder(input.provider);
  if (!providers.length) {
    throw new ProviderError('render', 'No render provider is configured — set OPENAI_API_KEY (or GOOGLE_API_KEY / Higgsfield keys).', { code: 'not_configured', status: 503, retryable: false });
  }
  if (input.provider && providers[0].id !== input.provider) {
    serverWarn('render', `requested provider ${input.provider} is not configured; using ${providers[0].id}`);
  }

  let job: RenderJob = {
    id,
    provider: providers[0].id,
    status: 'running',
    createdAt,
    selections: { ...input.selections },
    sourceUrl: input.sourceUrl,
    sourceKind: input.sourceKind,
    prompt,
  };
  await saveRenderJob(input.projectId, job);
  serverLog('render', 'job started', { id, projectId: input.projectId, provider: job.provider, sourceKind: input.sourceKind, promptChars: prompt.length });

  let sourceBytes: { buffer: Buffer; contentType: string };
  try {
    sourceBytes = await fetchBytes(input.sourceUrl, { origin: input.origin, maxBytes: MAX_UPLOAD_BYTES });
  } catch (err) {
    job = { ...job, status: 'failed', error: `Could not load the source image: ${errorMessage(err)}`, elapsedMs: elapsed() };
    await saveRenderJob(input.projectId, job);
    serverError('render', 'source fetch failed', err, { id });
    return job;
  }
  const size = input.size ?? pickRenderSize(imageDimensions(sourceBytes.buffer));

  const errors: string[] = [];
  const usable = providers.filter((p, i) => i === providers.length - 1 || !isCoolingDown(p.id));
  for (const provider of (usable.length ? usable : providers)) {
    if (input.signal?.aborted) break;
    if (job.provider !== provider.id) {
      job = { ...job, provider: provider.id };
      await saveRenderJob(input.projectId, job);
    }
    const attempt = startTimer();
    try {
      const result = await provider.render({
        sourceUrl: input.sourceUrl,
        sourceBytes,
        prompt,
        size,
        quality: input.quality,
        signal: input.signal,
        onProgress: (p) => input.onProgress?.({ ...p, provider: provider.id }),
      });
      const stored = await put(`renders/${input.projectId}/${id}.${extFor(result.mime)}`, result.imageBuffer, result.mime, { cacheSeconds: 60 * 60 * 24 * 365 });
      job = { ...job, status: 'completed', resultUrl: stored.url, elapsedMs: elapsed() };
      await saveRenderJob(input.projectId, job);
      serverLog('render', 'job completed', { id, provider: provider.id, model: result.model, size, providerMs: result.elapsedMs, totalMs: job.elapsedMs, bytes: result.imageBuffer.byteLength });
      return job;
    } catch (err) {
      const msg = errorMessage(err);
      errors.push(`${provider.label}: ${msg}`);
      noteFailure(provider.id, err);
      serverError('render', 'provider failed', err, { id, provider: provider.id, ms: attempt() });
      if (input.signal?.aborted) break;
    }
  }

  job = { ...job, status: 'failed', error: errors.length ? errors.join(' · ') : 'Render cancelled', elapsedMs: elapsed() };
  await saveRenderJob(input.projectId, job);
  return job;
}

export async function loadRenderJob(id: string): Promise<RenderJob | null> {
  const rec = await getRenderJob(id);
  return rec?.job ?? null;
}
