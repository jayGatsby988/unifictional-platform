import { modelInfo, providerHealth } from '@/lib/ai/providers';
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, isBlobConfigured, storageMode } from '@/lib/storage/blob';
import { guard, json } from '../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/health — which providers are configured (booleans only, never keys). */
export async function GET() {
  return guard('health', async () =>
    json({
      ok: true,
      providers: providerHealth(),
      storage: storageMode(),
      uploads: { mode: isBlobConfigured() ? 'client' : 'server', maxBytes: MAX_UPLOAD_BYTES, accept: ALLOWED_IMAGE_TYPES },
      ...modelInfo(),
      time: new Date().toISOString(),
    }),
  );
}
