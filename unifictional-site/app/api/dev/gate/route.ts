// @ts-nocheck
// GET /api/dev/gate?id=<build id>
// Development only (404 in production). Runs the hard gates (lib/build/gates.ts)
// against a stored build's dossier, hook, plan and pages, with no model calls,
// so a rule change can be checked against real builds for free.
import { NextResponse } from "next/server";

import { gateResearch, gatePlan, gatePages, canShowPhoto } from "@/lib/build/gates";
import { readJson, buildPath, isBuildId } from "@/lib/build/storage";
import { byType } from "@/lib/build/components";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (id === "types") return NextResponse.json({ photoCapable: Object.keys(byType).filter(canShowPhoto), textOnly: Object.keys(byType).filter(t => !canShowPhoto(t) && byType[t].kind === "section") });
  if (!isBuildId(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const [dossier, hook, plan, pages, lead] = await Promise.all([readJson(buildPath(id, "dossier.json")), readJson(buildPath(id, "hook.json")), readJson(buildPath(id, "plan.json")), readJson(buildPath(id, "pages.json")), readJson(`leads/${id}.json`)]);
  const job = { id, lead: { name: lead?.name, email: lead?.email, phone: lead?.phone, businessName: lead?.businessName, website: lead?.website }, dossier, hook, plan, pages, analysis: { logo: dossier?.logo || (lead?.log || []).some(l => /logo (img|svg)/.test(l)) ? { url: "found" } : null }, videoRequested: Boolean(plan?.pages?.[0]?.sections?.[0]?.type === "hero-video-scrub") };
  return NextResponse.json({
    research: gateResearch(job),
    plan: plan ? gatePlan(job, []) : { errors: ["no plan stored"], warnings: [] },
    pages: pages ? gatePages(job) : { errors: ["no pages stored"], warnings: [] },
    home: plan?.pages?.find(p => p.slug === "index")?.sections?.map(s => s.type),
  });
}
