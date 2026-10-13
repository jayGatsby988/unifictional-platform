/**
 * POST /api/render — { projectId, spec, selections, sourceUrl, sourceKind, provider?, changedSlots?, size?, quality? }
 * Runs the render synchronously and returns the RenderJob (completed, or
 * failed with `error`). 503 when no provider is configured.
 */
import { z } from 'zod';
import { runRender } from '@/lib/ai/render';
import { renderProviderOrder } from '@/lib/ai/providers';
import { RoomSpecZ } from '@/lib/spec/schema';
import { ensureSpecMaterials } from '@/lib/materials/match';
import { isAllowedRemoteUrl, isDataUrl, isHttpUrl, isRootRelative } from '@/lib/storage/blob';
import { HttpError, IdZ, guard, json, readJson, requestOrigin, zodMessage } from '../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BodyZ = z.object({
  projectId: IdZ,
  spec: z.unknown(),
  selections: z.record(z.string(), z.string()).default({}),
  sourceUrl: z.string().min(1).max(30_000_000),
  sourceKind: z.enum(['photo', 'viewport']).default('photo'),
  provider: z.enum(['openai', 'google', 'higgsfield']).optional(),
  changedSlots: z.array(z.string().max(40)).max(40).optional(),
  size: z.enum(['1024x1024', '1536x1024', '1024x1536']).optional(),
  quality: z.enum(['low', 'medium', 'high']).optional(),
});

export async function POST(req: Request) {
  return guard('render', async () => {
    const origin = requestOrigin(req);
    const body = await readJson(req, BodyZ, { maxBytes: 30 * 1024 * 1024 });
    const spec = RoomSpecZ.safeParse(body.spec);
    if (!spec.success) throw new HttpError(400, 'validation_error', `spec: ${zodMessage(spec.error)}`);
    // This process has never seen the client's photo-matched materials; the
    // prompt builder resolves selections by id, so they are rebuilt from the
    // spec's finish observations before the prompt is written.
    ensureSpecMaterials(spec.data);
    const ok = isDataUrl(body.sourceUrl) || isRootRelative(body.sourceUrl) || (isHttpUrl(body.sourceUrl) && isAllowedRemoteUrl(body.sourceUrl, origin));
    if (!ok) throw new HttpError(400, 'url_not_allowed', 'sourceUrl must be an uploaded photo, a viewport capture or a data URL');
    if (!renderProviderOrder(body.provider).length) {
      throw new HttpError(503, 'not_configured', 'No render provider is configured. Set OPENAI_API_KEY (or GOOGLE_API_KEY / Higgsfield keys).');
    }
    const job = await runRender({
      projectId: body.projectId,
      spec: spec.data,
      selections: body.selections,
      sourceUrl: body.sourceUrl,
      sourceKind: body.sourceKind,
      provider: body.provider,
      changedSlots: body.changedSlots,
      size: body.size,
      quality: body.quality,
      origin,
      signal: req.signal,
    });
    return json(job, { status: 200 });
  });
}
