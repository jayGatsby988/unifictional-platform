/**
 * POST /api/scan — { projectId, imageUrl, provider? } → ScanJob (202)
 * Creates an image-to-3D task (Meshy by default, Higgsfield when configured).
 * Poll GET /api/scan/:id for progress + the GLB URL.
 */
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { errorMessage, serverError, serverLog } from '@/lib/ai/log';
import { scanProviderOrder } from '@/lib/ai/providers';
import { saveScanJob } from '@/lib/jobs/store';
import type { ScanJob } from '@/lib/spec/types';
import { MAX_UPLOAD_BYTES, fetchBytes, isAllowedRemoteUrl, isDataUrl, isHttpUrl, isRootRelative } from '@/lib/storage/blob';
import { HttpError, IdZ, guard, json, readJson, requestOrigin } from '../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodyZ = z.object({
  projectId: IdZ,
  imageUrl: z.string().min(1).max(30_000_000),
  provider: z.enum(['meshy', 'higgsfield']).optional(),
});

export async function POST(req: Request) {
  return guard('scan.create', async () => {
    const origin = requestOrigin(req);
    const body = await readJson(req, BodyZ, { maxBytes: 30 * 1024 * 1024 });
    const ok = isDataUrl(body.imageUrl) || isRootRelative(body.imageUrl) || (isHttpUrl(body.imageUrl) && isAllowedRemoteUrl(body.imageUrl, origin));
    if (!ok) throw new HttpError(400, 'url_not_allowed', 'imageUrl must be an uploaded photo, a viewport capture or a data URL');
    const providers = scanProviderOrder(body.provider);
    if (!providers.length) throw new HttpError(503, 'not_configured', 'No 3D scan provider is configured. Set MESHY_API_KEY or the Higgsfield keys.');

    // Providers need a public URL or a data URI — inline anything that is not public https.
    const needsBytes = !isHttpUrl(body.imageUrl) || /localhost|127\.0\.0\.1/.test(body.imageUrl);
    const imageBytes = needsBytes ? await fetchBytes(body.imageUrl, { origin, maxBytes: MAX_UPLOAD_BYTES }) : undefined;

    const errors: string[] = [];
    for (const provider of providers) {
      try {
        const { jobId } = await provider.create({ imageUrl: body.imageUrl, imageBytes });
        const job: ScanJob = {
          id: nanoid(12),
          provider: provider.id,
          model: provider.model,
          status: 'queued',
          createdAt: new Date().toISOString(),
          sourceUrl: body.imageUrl,
          progress: 0,
        };
        await saveScanJob({ projectId: body.projectId, job, providerJobId: jobId });
        serverLog('scan', 'job created', { id: job.id, provider: provider.id, providerJobId: jobId, projectId: body.projectId });
        return json(job, { status: 202 });
      } catch (err) {
        errors.push(`${provider.label}: ${errorMessage(err)}`);
        serverError('scan', 'provider create failed', err, { provider: provider.id });
      }
    }
    throw new HttpError(502, 'provider_error', errors.join(' · '));
  });
}
