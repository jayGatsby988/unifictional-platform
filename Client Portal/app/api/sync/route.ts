import { NextResponse, after } from "next/server";
import { createWriterClient } from "@/lib/supabase/admin";
import { parseSources, syncAll } from "@/lib/integrations/sync";
import { getSession } from "@/lib/data/repo";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { sendMonthlyReports } from "@/lib/reports/monthly";

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
  // The full nightly run on the 1st also sends the monthly client update, with this month's fresh numbers.
  if (!url.searchParams.get("client") && !url.searchParams.get("sources") && new Date().getUTCDate() === 1 && adminConfigured) {
    after(() => sendMonthlyReports(createAdminClient()).then((r) => console.log("[monthly]", JSON.stringify(r))).catch((e) => console.error("[monthly]", e)));
  }
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), results });
}

export const GET = handle;
export const POST = handle;
