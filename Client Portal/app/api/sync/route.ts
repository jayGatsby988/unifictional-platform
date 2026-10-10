import { NextResponse } from "next/server";
import { createWriterClient } from "@/lib/supabase/admin";
import { parseSources, syncAll } from "@/lib/integrations/sync";
import { getSession } from "@/lib/data/repo";

export const maxDuration = 300;

/**
 * Daily sync. Called by Vercel Cron (Authorization: Bearer CRON_SECRET) or by
 * an admin from the portal ("Run sync now"). ?client=slug and ?sources=ga4,meta
 * narrow the run.
 */
async function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return true;
  const session = await getSession().catch(() => null);
  return Boolean(session?.isAdmin && !session.isDemo);
}

async function handle(request: Request) {
  if (!(await authorized(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const db = await createWriterClient();
  const results = await syncAll(db, { clientSlug: url.searchParams.get("client") ?? undefined, sources: parseSources(url.searchParams.get("sources")) });
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), results });
}

export const GET = handle;
export const POST = handle;
