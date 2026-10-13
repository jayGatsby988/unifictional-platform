// @ts-nocheck
// GET /api/dev/film?industry=epoxy%20flooring&company=Integrity%20Garage%20Floors&city=Kent
// Development only (404 in production). Writes the hero film's shot list for a
// made-up company with one small model call, so the prompt shape can be checked
// before a build spends on Higgsfield. No video is generated.
import { NextResponse } from "next/server";

import { writePrompt } from "@/lib/build/video";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (process.env.VERCEL_ENV === "production") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const u = new URL(req.url);
  const industry = u.searchParams.get("industry") || "epoxy garage floors";
  const company = u.searchParams.get("company") || "Integrity Garage Floors";
  const city = u.searchParams.get("city") || "Kent, WA";
  const job = { id: "dev", lead: { businessName: company }, usage: null, dossier: { name: company, industry, city, services: [{ name: industry, materials: ["metallic epoxy", "polyaspartic top coat"] }], designDirection: { mood: "dark, expensive, calm" } }, hook: { hook: { claim: "One pour. Total transformation." }, flagship: { title: "Metallic epoxy garage floor", story: "A bare two-car slab ground, repaired and coated in one day." } } };
  const t0 = Date.now();
  const out = await writePrompt(job, "", { kind: "film", angle: u.searchParams.get("angle") || "wide" });
  return NextResponse.json({ seconds: Math.round((Date.now() - t0) / 1000), cost: job.usage?.cost, ...out });
}
