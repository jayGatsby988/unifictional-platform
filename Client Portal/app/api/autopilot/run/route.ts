import { NextResponse } from "next/server";
import { createWriterClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/data/repo";
import { runAutopilot } from "@/lib/autopilot/run";

export const maxDuration = 300;

/**
 * SEO Autopilot's daily run. Called by Vercel Cron (Authorization: Bearer
 * CRON_SECRET) or by the studio ("Run now"). ?client=slug narrows it to one
 * company; &force=1 writes a post even if the next one isn't due yet.
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
  const results = await runAutopilot(db, { clientSlug: url.searchParams.get("client") ?? undefined, force: url.searchParams.get("force") === "1" });
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), results });
}

export const GET = handle;
export const POST = handle;
