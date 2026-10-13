/**
 * POST /api/analyze — { roomType, photos:[{url}], description }
 * Streams NDJSON progress events:
 *   { phase:'analyzing'|'validating'|'building', message, progress }
 *   { phase:'done', message, progress:1, spec, meta }   (meta.photos = the photos with any server-measured pixel size)
 *   { phase:'error', message, progress, code }
 * Keep-alive heartbeats (`heartbeat:true`) repeat the last event every 5 s.
 */
import { z } from 'zod';
import { analyzeRoomDetailed } from '@/lib/ai/analyze';
import { errorMessage } from '@/lib/ai/log';
import { isOpenAIConfigured } from '@/lib/ai/providers/openai';
import { isAllowedRemoteUrl, isDataUrl, isHttpUrl, isRootRelative } from '@/lib/storage/blob';
import { UNLOCK_PRICE_LABEL, checkAttempt, consumeAttempt } from '@/lib/limits';
import { HttpError, errorCode, jsonError, readJson, requestOrigin, toErrorResponse } from '../_lib/http';
import { ndjsonResponse } from '../_lib/ndjson';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PhotoZ = z.object({
  url: z.string().min(1).max(30_000_000),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  primary: z.boolean().optional(),
});

const BodyZ = z.object({
  roomType: z.enum(['kitchen', 'bathroom', 'exterior', 'floorplan']),
  photos: z.array(PhotoZ).min(1).max(8),
  description: z.string().max(4000).optional().default(''),
});

export async function POST(req: Request) {
  const origin = requestOrigin(req);
  let body: z.output<typeof BodyZ>;
  try {
    body = await readJson(req, BodyZ, { maxBytes: 40 * 1024 * 1024 });
    for (const p of body.photos) {
      const ok = isDataUrl(p.url) || isRootRelative(p.url) || (isHttpUrl(p.url) && isAllowedRemoteUrl(p.url, origin));
      if (!ok) throw new HttpError(400, 'url_not_allowed', `Photo URL not allowed: ${p.url.slice(0, 80)}`);
    }
    if (!isOpenAIConfigured()) throw new HttpError(503, 'not_configured', 'OPENAI_API_KEY is not set; the analyzer is unavailable.');
    // Two free scans per IP, then the $1 unlock (see lib/limits). Counted before the work starts so a closed tab still counts.
    const gate = await checkAttempt(req);
    if (!gate.allowed) throw new HttpError(402, 'limit_reached', `You've used your ${gate.free} free scans. Unlock unlimited scans for ${UNLOCK_PRICE_LABEL}.`, { used: gate.used, free: gate.free });
    if (!gate.unlocked) await consumeAttempt(gate.key);
  } catch (err) {
    return toErrorResponse(err, 'analyze');
  }

  return ndjsonResponse(
    async (emit, signal) => {
      emit({ phase: 'analyzing', message: 'Starting analysis', progress: 0.02 });
      const result = await analyzeRoomDetailed({ ...body, origin, signal }, (p) => emit({ ...p }));
      emit({
        phase: 'done',
        message: result.usedFallback ? 'Photos could not be reconstructed — showing a template you can edit' : 'Reconstruction ready',
        progress: 1,
        spec: result.spec,
        // `photos` carries the pixel size the server measured for the primary
        // photo, so the client can store it and fit at the inventory's frame
        meta: { model: result.model, elapsedMs: result.elapsedMs, repaired: result.repaired, usedFallback: result.usedFallback, fixes: result.fixes.slice(0, 40), photoCount: result.photoCount, inventory: result.inventory, photos: result.photos },
      });
    },
    { signal: req.signal, keepAliveMs: 5000, onError: (err) => ({ phase: 'error', message: errorMessage(err), progress: 0, code: errorCode(err) }) },
  );
}

export async function GET() {
  return jsonError(405, 'method_not_allowed', 'POST { roomType, photos, description }');
}
