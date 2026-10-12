// @ts-nocheck
// GET /api/dev/qa?id=<build id>[&pages=index,about][&round=0]
// Development only (404 in production). Runs the quality gate's browser
// inspection (lib/build/inspect.ts) against an existing build's preview and
// returns the report with the hard-gate errors, without the judge and
// without touching the lead record. Needs Playwright's Chromium locally:
// npx playwright install chromium
import { NextResponse } from "next/server";

import { inspectSite, leanReport } from "@/lib/build/inspect";
import { gateInspection } from "@/lib/build/gates";
import { readJson, isBuildId } from "@/lib/build/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (process.env.VERCEL_ENV === "production") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (!isBuildId(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const lead = await readJson<any>(`leads/${id}.json`);
  const slugs = (url.searchParams.get("pages") || "").split(",").filter(Boolean).length ? url.searchParams.get("pages").split(",") : (lead?.pages || ["index"]);
  const log: string[] = [];
  const t0 = Date.now();
  try {
    const report = await inspectSite({ id, origin: lead?.previewUrl ? new URL(lead.previewUrl).origin : url.origin, slugs, logoExpected: Boolean(url.searchParams.get("logo")), round: Number(url.searchParams.get("round") || 0), stamp: (t) => log.push(t), maxInner: Number(url.searchParams.get("inner") || 2) });
    const gate = gateInspection(report);
    return NextResponse.json({ ok: true, seconds: Math.round((Date.now() - t0) / 1000), gate, log, report: leanReport(report) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || String(e), log }, { status: 500 });
  }
}
