import { NextResponse } from "next/server";
import { createAdminClient, adminConfigured } from "@/lib/supabase/admin";
import { getSession } from "@/lib/data/repo";
import { sendMonthlyReports } from "@/lib/reports/monthly";

export const maxDuration = 300;

/**
 * Monthly client update. Runs from the nightly sync on the 1st (no extra cron), or by hand:
 * Bearer CRON_SECRET or a studio admin. ?client=slug for one company, ?dry=1 to preview
 * without sending, ?force=1 to send even if one went out this month.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!bearer) {
    const session = await getSession().catch(() => null);
    if (!session?.isAdmin || session.isDemo) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!adminConfigured) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY isn't set." }, { status: 503 });
  const url = new URL(request.url);
  const results = await sendMonthlyReports(createAdminClient(), { clientSlug: url.searchParams.get("client") ?? undefined, dryRun: url.searchParams.get("dry") === "1", force: url.searchParams.get("force") === "1" });
  return NextResponse.json({ ok: true, results });
}
