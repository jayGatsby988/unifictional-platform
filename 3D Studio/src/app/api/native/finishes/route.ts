import { z } from 'zod';
import { analyzeScanFinishes } from '@/lib/ai/scan-finishes';
import { ScanFinishAdmissionError, withScanFinishAdmission } from '@/lib/ai/scan-finish-admission';
import { isOpenAIConfigured } from '@/lib/ai/providers/openai';
import { BATHROOM_SLOTS, KITCHEN_SLOTS } from '@/lib/materials/catalog';
import { imageDimensions, sniffImageMime } from '@/lib/storage/image-meta';
import { HttpError, json, readJson, toErrorResponse } from '../../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;
const BodyZ = z.object({
  roomType: z.enum(['kitchen', 'bathroom']),
  slots: z.array(z.string().min(1).max(50)).min(1).max(20),
  photos: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/), url: z.string().max(1_400_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/) }).strict()).min(1).max(3),
}).strict();

export async function POST(req: Request) {
  try {
    const body = await readJson(req, BodyZ, { maxBytes: 4 * 1024 * 1024 });
    const allowed: readonly string[] = body.roomType === 'kitchen' ? KITCHEN_SLOTS : BATHROOM_SLOTS;
    if (new Set(body.slots).size !== body.slots.length || body.slots.some(slot => !allowed.includes(slot))) throw new HttpError(400, 'invalid_slots', 'Choose supported room surfaces.');
    if (new Set(body.photos.map(p => p.id)).size !== body.photos.length) throw new HttpError(400, 'invalid_photos', 'Photo IDs must be unique.');
    for (const photo of body.photos) {
      const encoded = photo.url.split(',')[1], bytes = Buffer.from(encoded, 'base64'), dims = imageDimensions(bytes);
      if (bytes.length > 1024 * 1024 || bytes.toString('base64') !== encoded || sniffImageMime(bytes) !== 'image/jpeg' || !dims || Math.max(dims.width, dims.height) > 2048 || Math.min(dims.width, dims.height) < 64) throw new HttpError(400, 'invalid_image', 'Use JPEG photos between 64 and 2048 pixels, up to 1 MB each.');
    }
    if (!isOpenAIConfigured()) throw new HttpError(503, 'not_configured', 'Photo finish matching is not configured on this deployment.');
    return json(await withScanFinishAdmission(req, () => analyzeScanFinishes({ ...body, signal: req.signal })));
  } catch (error) {
    if (error instanceof ScanFinishAdmissionError) return json({ error: error.message, code: error.code }, { status: error.status, headers: { 'retry-after': String(error.retryAfter) } });
    return toErrorResponse(error, 'native.finish-analysis');
  }
}
