import { json } from '../../_lib/http';
import { UNLOCK_PRICE_LABEL, checkAttempt } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How many free scans this visitor has left, and whether they've unlocked. */
export async function GET(req: Request) {
  const g = await checkAttempt(req);
  return json({ used: g.used, free: g.free, remaining: g.unlocked ? null : g.remaining, unlocked: g.unlocked, price: UNLOCK_PRICE_LABEL });
}
