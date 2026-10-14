import { NextResponse } from "next/server";
import { dashboardAuthorized } from "@/lib/build/dashboard";
import { cancelBuild } from "@/lib/build/cancel";
import { isBuildId } from "@/lib/build/storage";

/** POST /api/build/cancel {id} — stop every live run of a build and mark it cancelled (dashboard key). */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!dashboardAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { id?: string } = {};
  try { body = await req.json(); } catch {}
  if (!body.id || !isBuildId(body.id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  try { return NextResponse.json({ ok: true, ...(await cancelBuild(body.id)) }); }
  catch (e) { return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 502 }); }
}
