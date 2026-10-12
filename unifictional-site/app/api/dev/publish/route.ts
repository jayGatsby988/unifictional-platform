import { NextResponse } from "next/server";
import { runPublish, type BuildJob } from "@/lib/build/pipeline";
import { readJson, isBuildId, type LeadRecord } from "@/lib/build/storage";

export const runtime = "nodejs";
export const maxDuration = 800;

/** Dev only: run the debug + publish stage on a stored build. GET /api/dev/publish?id=<build id> */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse("Not found", { status: 404 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!isBuildId(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const lead = await readJson<LeadRecord>(`leads/${id}.json`);
  if (!lead) return NextResponse.json({ error: "no lead record for that id" }, { status: 404 });
  const origin = process.env.PREVIEW_ORIGIN || "https://unifictional.com";
  const job: BuildJob = { id, createdAt: lead.createdAt, origin, lead: { name: lead.name, email: lead.email, phone: lead.phone, businessName: lead.businessName, website: lead.website, companyDetails: lead.companyDetails, services: lead.services, message: lead.message, slotStartISO: lead.slotStartISO } as any, log: [] } as any;
  const t0 = Date.now();
  const ok = await runPublish(job);
  return NextResponse.json({ ok, seconds: Math.round((Date.now() - t0) / 1000), publishedUrl: job.publishedUrl, publishNote: job.publishNote, debugNotes: job.debugNotes, log: job.log });
}
