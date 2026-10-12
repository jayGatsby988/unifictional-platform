import { NextResponse } from "next/server";

import { dashboardAuthorized } from "@/lib/build/dashboard";
import { siteOrigin, type BuildLead } from "@/lib/build/pipeline";
import { startBuildAnywhere } from "@/lib/build/start";
import { isBuildId, readJson, type LeadRecord } from "@/lib/build/storage";

/** POST /api/build/retry {id} — start a fresh build for the same lead (dashboard key). */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!dashboardAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { id?: string } = {};
  try { body = await req.json(); } catch {}
  if (!body.id || !isBuildId(body.id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const rec = await readJson<LeadRecord>(`leads/${body.id}.json`);
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const lead: BuildLead = { name: rec.name, email: rec.email, phone: rec.phone, businessName: rec.businessName, website: rec.website, companyDetails: rec.companyDetails, services: rec.services || [], message: rec.message, slotStartISO: rec.slotStartISO };
  const id = crypto.randomUUID();
  const started = await startBuildAnywhere({ id, origin: siteOrigin(req), lead });
  return NextResponse.json({ ok: true, id, ...started }, { status: 202 });
}
