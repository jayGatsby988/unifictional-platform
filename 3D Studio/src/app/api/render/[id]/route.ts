/** GET /api/render/:id — job status (in-memory map, Blob-backed jobs/<id>.json on cold start). */
import { loadRenderJob } from '@/lib/ai/render';
import { HttpError, assertId, guard, json } from '../../_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard('render.get', async () => {
    const { id } = await ctx.params;
    const job = await loadRenderJob(assertId(id));
    if (!job) throw new HttpError(404, 'not_found', 'Render job not found (it may have expired)');
    return json(job);
  });
}
