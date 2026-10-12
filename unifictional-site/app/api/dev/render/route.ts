import { NextResponse } from "next/server";
import { renderSite } from "@/lib/build/renderer";
import { enforceBrandWord } from "@/lib/build/pipeline";
import { enhanceImages, minifyAssets } from "@/lib/build/optimize";
import { readJson, saveHtml, saveJson, pagePath, buildPath, isBuildId } from "@/lib/build/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Dev only: re-render a stored build with the current components (no model calls). GET /api/dev/render?id=<build id> */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse("Not found", { status: 404 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!isBuildId(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const spec: any = await readJson(buildPath(id, "spec.json"));
  if (!spec?.pages?.length) return NextResponse.json({ error: "no spec.json for that build" }, { status: 404 });
  const t0 = Date.now();
  enforceBrandWord(spec);
  const rendered: { slug: string; html: string }[] = renderSite(spec, { base: `/preview/${id}` });
  for (const r of rendered) r.html = await minifyAssets(enhanceImages(r.html, new Map()));
  await Promise.all(rendered.map(r => saveHtml(pagePath(id, r.slug), r.html)));
  await saveJson(buildPath(id, "spec.json"), spec);
  return NextResponse.json({ ok: true, pages: rendered.map(r => r.slug), seconds: Math.round((Date.now() - t0) / 1000), preview: `https://unifictional.com/preview/${id}` });
}
