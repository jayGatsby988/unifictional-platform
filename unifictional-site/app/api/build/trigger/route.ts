import { NextResponse } from "next/server";

import { buildSecret, siteOrigin, type BuildLead } from "@/lib/build/pipeline";
import { startBuildAnywhere } from "@/lib/build/start";

/**
 * POST /api/build/trigger   { lead: {...}, id? }
 * Internal (bearer = build secret): start a build for a lead without a
 * booking, the same way the confirm route does. Goes to Trigger.dev when it
 * is configured, else to the Vercel step chain.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!buildSecret() || auth !== `Bearer ${buildSecret()}`) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { lead?: BuildLead; id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  if (!body.lead?.name || !body.lead?.email) return NextResponse.json({ error: "lead with name and email is required" }, { status: 400 });
  const id = body.id && /^[a-f0-9-]{8,64}$/i.test(body.id) ? body.id : crypto.randomUUID();
  const defaults: BuildLead = { name: "", email: "", phone: "", businessName: "", website: "", companyDetails: "", services: [], message: "" };
  const lead: BuildLead = Object.assign(defaults, body.lead);
  const started = await startBuildAnywhere({ id, origin: siteOrigin(req), lead });
  return NextResponse.json({ accepted: true, id, ...started }, { status: 202 });
}
