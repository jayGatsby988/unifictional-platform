import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError, readJson } from '../../_lib/http';
import { billingConfigured, claimUnlock, unlockCookie } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Back from Square: verify the payment through the portal and unlock this visitor (IP record + cookie). */
export async function POST(req: Request) {
  if (!billingConfigured()) return jsonError(503, 'not_configured', 'Unlocking is not switched on yet (PLATFORM_KEY).');
  let id: string;
  try {
    ({ id } = await readJson(req, z.object({ id: z.string().min(4).max(40) })));
  } catch {
    return jsonError(400, 'bad_request', 'Missing unlock id');
  }
  try {
    const r = await claimUnlock(req, id);
    const res = NextResponse.json(r, { headers: { 'cache-control': 'no-store' } });
    if (r.unlocked) {
      const c = unlockCookie();
      res.cookies.set(c.name, c.value, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: c.maxAge, secure: process.env.NODE_ENV === 'production' });
    }
    return res;
  } catch (err) {
    return jsonError(502, 'verify_failed', err instanceof Error ? err.message : 'Could not confirm the payment.');
  }
}
