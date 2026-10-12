import { NextResponse } from "next/server";

import { buildSecret } from "@/lib/build/pipeline";
import { buildPath, isBuildId, readJson } from "@/lib/build/storage";

/**
 * GET /api/build/status?id=<buildId>[&file=dossier.json]
 * Internal (bearer = build secret): the lead record for a build, or one of
 * its stored JSON files (dossier-a, dossier, plan, pages, spec, seo, review).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!buildSecret() || auth !== `Bearer ${buildSecret()}`) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const file = (url.searchParams.get("file") || "").replace(/[^a-z0-9-]/gi, "");
  if (!isBuildId(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const data = file ? await readJson(buildPath(id, `${file}.json`)) : await readJson(`leads/${id}.json`);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
