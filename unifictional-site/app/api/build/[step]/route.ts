import { NextResponse, after } from "next/server";

import { RUNNERS, STEPS, buildSecret, type BuildJob, type Step } from "@/lib/build/pipeline";

/**
 * POST /api/build/{research|design|finish}
 *
 * One step of the AI build pipeline. Internal: the booking confirm route
 * starts the chain and each step calls the next, all with the build secret.
 * Answers 202 immediately and does the work in after(), so each step gets
 * its own maxDuration budget (research and design each take a few minutes).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(req: Request, ctx: { params: Promise<{ step: string }> }) {
  const { step } = await ctx.params;
  if (!STEPS.includes(step as Step)) return NextResponse.json({ error: "unknown_step" }, { status: 404 });

  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${buildSecret()}`) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let job: BuildJob;
  try {
    job = (await req.json()) as BuildJob;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!job?.id || !job.lead || !job.origin) return NextResponse.json({ error: "bad_job" }, { status: 400 });

  after(async () => {
    try {
      await RUNNERS[step as Step](job);
    } catch (err) {
      console.error(`[build] step ${step} crashed:`, err);
    }
  });

  return NextResponse.json({ accepted: true, step, id: job.id }, { status: 202 });
}
