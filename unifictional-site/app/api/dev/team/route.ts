import { NextResponse } from "next/server";
import { teamResearch, teamBuild, teamFinish } from "@/lib/team/foreman";
import { readJson, isBuildId, type LeadRecord } from "@/lib/build/storage";
import type { BuildJob } from "@/lib/build/pipeline";

export const runtime = "nodejs";
export const maxDuration = 800;

/** Dev only: run the team on a lead. GET /api/dev/team?id=<lead id>&phase=research|build|finish|all (default all). Phases after research reuse builds/<id>/dossier.json and spec.json. */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse("Not found", { status: 404 });
  const u = new URL(req.url); const id = u.searchParams.get("id") || ""; const phase = u.searchParams.get("phase") || "all";
  if (!isBuildId(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const lead = await readJson<LeadRecord>(`leads/${id}.json`);
  if (!lead) return NextResponse.json({ error: "no lead record" }, { status: 404 });
  const origin = process.env.PREVIEW_ORIGIN || "https://unifictional.com";
  const job: BuildJob = { id, createdAt: lead.createdAt, origin, lead: { name: lead.name, email: lead.email, phone: lead.phone, businessName: lead.businessName, website: lead.website, companyDetails: lead.companyDetails, services: lead.services, message: lead.message, slotStartISO: lead.slotStartISO } as any, log: [] } as any;
  (job as any).teamOpts = { rounds: u.searchParams.get("rounds"), steps: u.searchParams.get("steps"), agentCost: u.searchParams.get("cost"), teamCost: u.searchParams.get("teamCost"), roles: u.searchParams.get("roles") };
  const t0 = Date.now(); const out: any = { phases: [] };
  if (phase === "research" || phase === "all") out.phases.push({ research: await teamResearch(job) });
  else { job.dossier = (await readJson(`builds/${id}/dossier.json`)) || {}; job.hook = (await readJson(`builds/${id}/hook.json`)) || {}; job.videoRequested = false; }
  if (phase === "build" || phase === "all") out.phases.push({ build: await teamBuild(job) });
  else if (phase === "finish") job.spec = await readJson(`builds/${id}/spec.json`);
  if (phase === "finish" || phase === "all") out.phases.push({ finish: await teamFinish(job) });
  return NextResponse.json({ ...out, seconds: Math.round((Date.now() - t0) / 1000), teamCost: job.teamCost, publishedUrl: job.publishedUrl, approved: job.teamApproved, log: job.log });
}
