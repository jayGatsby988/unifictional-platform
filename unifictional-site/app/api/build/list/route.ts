import { NextResponse } from "next/server";

import { dashboardAuthorized, listBuilds } from "@/lib/build/dashboard";

/** GET /api/build/list — every build for the dashboard (cookie or bearer = dashboard key). */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!dashboardAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const builds = await listBuilds(150);
    const today = new Date().toISOString().slice(0, 10);
    const summary = {
      building: builds.filter((b) => b.stage === "building").length,
      stalled: builds.filter((b) => b.stage === "stalled").length,
      doneToday: builds.filter((b) => b.stage === "done" && (b.updatedAt || "").slice(0, 10) === today).length,
      failed: builds.filter((b) => b.stage === "failed").length,
      total: builds.length,
      spend: Math.round(builds.reduce((s, b) => s + (Number((b as { cost?: number }).cost) || 0), 0) * 100) / 100,
      spendToday: Math.round(builds.filter((b) => (b.createdAt || "").slice(0, 10) === today).reduce((s, b) => s + (Number((b as { cost?: number }).cost) || 0), 0) * 100) / 100,
    };
    return NextResponse.json({ ok: true, at: new Date().toISOString(), summary, builds }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
