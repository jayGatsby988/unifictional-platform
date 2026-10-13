import { json, jsonError, requestOrigin } from '../../_lib/http';
import { billingConfigured, startUnlock } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "Unlock for $1": a Square checkout hosted by the Unifictional portal; the buyer comes back to /studio?unlock=<id>. */
export async function POST(req: Request) {
  if (!billingConfigured()) return jsonError(503, 'not_configured', 'Unlocking is not switched on yet (PLATFORM_KEY).');
  try {
    const r = await startUnlock(req, requestOrigin(req));
    return json({ url: r.url, id: r.id });
  } catch (err) {
    return jsonError(502, 'checkout_failed', err instanceof Error ? err.message : 'Could not start the checkout.');
  }
}
