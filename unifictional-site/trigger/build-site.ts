// @ts-nocheck
// The AI build as Trigger.dev tasks. One parent run per lead; the three
// phases are child tasks so each is retried and timed independently and the
// dashboard shows exactly where a build is. Payload = the BuildJob (the
// dossier, plan and pages travel with it; the preview pages and lead record
// still go to Vercel Blob, and the owner still gets the emails).
import { task, logger } from "@trigger.dev/sdk";

import { teamResearch, teamBuild, teamFinish } from "@/lib/team/foreman";
import { researchA, researchB, lookThenHook, runHome, runRest, runPublish, publishStage, failBuild, gateAfterResearch, type BuildJob, type BuildLead, type Step } from "@/lib/build/pipeline";
import { runVideo, videoConfigured, chooseSourceImage } from "@/lib/build/video";
import { saveLead } from "@/lib/build/storage";

// Up to BUILD_CONCURRENCY leads build at once (default 20). A parent run
// waiting on a child is checkpointed and does not hold a slot, so the
// environment's run limit (200 on Pro) is nowhere near.
const BUILD_QUEUE = { name: "site-builds", concurrencyLimit: Number(process.env.BUILD_CONCURRENCY || 20) };

// Machine sizes. The Trigger.dev default is small-1x (0.5 vCPU, 0.5 GB), which
// is enough for the model-call phases but not for sharp/ffmpeg: finish re-encodes
// every company photo at five widths and video turns a 4K clip into frames.
// Both of those killed the process with TASK_PROCESS_OOM_KILLED on 2026-10-10,
// so they run on 4 GB and, if a run still overflows, retry once on 8 GB.
const MODEL_MACHINE = "small-2x" as const;      // 1 vCPU, 1 GB
const MEDIA_MACHINE = "medium-2x" as const;     // 2 vCPU, 4 GB
const OOM_FALLBACK = { outOfMemory: { machine: "large-1x" as const } }; // 4 vCPU, 8 GB

export const researchTask = task({
  id: "build-research",
  machine: MEDIA_MACHINE, // it looks at their site in a browser before deciding
  maxDuration: 1800,
  retry: { maxAttempts: 2, ...OOM_FALLBACK },
  run: async (job: BuildJob) => {
    const ok = await researchA(job);
    if (!ok) return { job, ok: false };
    await researchB(job);
    await lookThenHook(job);
    if (!(await gateAfterResearch(job))) return { job, ok: false };
    job.videoRequested = videoConfigured(); // the first screen is always the film of their work
    return { job, ok: true };
  },
});

export const homeTask = task({
  id: "build-home",
  machine: MEDIA_MACHINE, // renders, inspects in Chromium and judges the home page until it passes
  maxDuration: 3600,
  retry: { maxAttempts: 2, ...OOM_FALLBACK },
  run: async (job: BuildJob) => ({ job, ok: await runHome(job) }),
});

export const videoTask = task({
  id: "build-video",
  machine: MEDIA_MACHINE,
  maxDuration: 1800,
  retry: { maxAttempts: 2, ...OOM_FALLBACK },
  run: async (job: BuildJob) => {
    const m = await runVideo(job, (t) => logger.info(t));
    return { status: m.status, mode: m.mode, count: m.count };
  },
});

export const restTask = task({
  id: "build-site-rest",
  machine: MEDIA_MACHINE,
  // the inner pages, the review, the whole-site gate (home locked) and delivery
  maxDuration: 3600,
  retry: { maxAttempts: 2, ...OOM_FALLBACK },
  run: async (job: BuildJob) => ({ job, ok: await runRest(job) }),
});

export const publishTask = task({
  id: "build-publish",
  machine: MEDIA_MACHINE,
  // the debugger opens every page in Chromium and fixes what looks off; then the site goes live on Vercel
  maxDuration: 3600,
  retry: { maxAttempts: 1, ...OOM_FALLBACK },
  run: async (job: BuildJob) => ({ job, ok: await runPublish(job) }),
});

/** The team mode: ten agents on their own keys, in rounds, one task (the film runs beside it). */
export const teamTask = task({
  id: "build-team",
  machine: MEDIA_MACHINE,
  maxDuration: 18000,
  retry: { maxAttempts: 1, ...OOM_FALLBACK },
  run: async (job: BuildJob) => {
    if (!(await teamResearch(job))) return { job, ok: false };
    if (job.videoRequested) await videoTask.trigger(job);
    if (!(await teamBuild(job))) return { job, ok: false };
    return { job, ok: await teamFinish(job) };
  },
});

/**
 * Parent: one run per lead. `queue.concurrencyLimit` is the knob that keeps
 * fifty sign-ups from hitting the Anthropic rate limit at once: the rest wait
 * in the queue and start as builds finish.
 */
export const buildSite = task({
  id: "build-site",
  queue: BUILD_QUEUE,
  machine: MODEL_MACHINE,
  maxDuration: 9000,
  retry: { maxAttempts: 1 },
  // the parent itself died (timeout, crash): the dashboard must not show "building" forever
  onFailure: async ({ payload, error }) => {
    const job: BuildJob = { id: payload.id, createdAt: new Date().toISOString(), origin: payload.origin, lead: payload.lead, log: [] };
    await failBuild(job, "finish", error instanceof Error ? error : new Error(String((error as any)?.message || error)));
  },
  run: async (payload: { id: string; origin: string; lead: BuildLead }) => {
    const job: BuildJob = { id: payload.id, createdAt: new Date().toISOString(), origin: payload.origin, lead: payload.lead, log: [`queued (trigger.dev) · ${payload.lead.website ? "rebuild " + payload.lead.website : "new site from the company details"}`] };
    logger.info("build queued", { id: job.id, business: job.lead.businessName });

    // A child that crashed (OOM, timeout, internal error) comes back with ok:false
    // and never ran its own failure path, so the parent records the failure:
    // lead status "failed" with the reason, and the failure email to the owner.
    const crashed = async (phase: Step, last: BuildJob, r: { ok: boolean; error?: unknown }) => {
      const msg = (r as any)?.error?.message || (typeof (r as any)?.error === "string" ? (r as any).error : "") || `${phase} task crashed`;
      logger.error("build phase crashed", { id: last.id, phase, message: msg });
      await failBuild(last, phase, new Error(msg));
      return { id: last.id, status: "failed", phase, error: msg };
    };

    if ((process.env.BUILD_MODE || "").toLowerCase() === "team" || (payload as any).mode === "team") {
      logger.info("team mode", { id: job.id });
      const t = await teamTask.triggerAndWait(job);
      if (!t.ok) return crashed("design", job, t);
      const done = t.output.job;
      return { id: done.id, status: t.output.ok ? "done" : "failed", mode: "team", pages: (done.spec?.pages || []).map((p) => p.slug), publishedUrl: done.publishedUrl, teamCost: done.teamCost };
    }
    const r = await researchTask.triggerAndWait(job);
    if (!r.ok) return crashed("research", job, r);
    if (!r.output.ok) return { id: job.id, status: "failed", phase: "research" };
    // the hero clip is generated while the home page is planned and written; the home gate waits for it
    if (r.output.job.videoRequested) await videoTask.trigger(r.output.job);
    const h = await homeTask.triggerAndWait(r.output.job);
    if (!h.ok) return crashed("design", r.output.job, h);
    if (!h.output.ok) return { id: job.id, status: "failed", phase: "home" };
    const f = await restTask.triggerAndWait(h.output.job);
    if (!f.ok) return crashed("finish", h.output.job, f);
    if (!f.output.ok) return { id: job.id, status: "failed", phase: "finish" };
    let done = f.output.job;
    // the debug + publish stage never fails a built site: a crash here leaves the preview standing
    if (publishStage()) {
      const p = await publishTask.triggerAndWait(done);
      if (p.ok) done = p.output.job; else logger.error("publish stage crashed", { id: done.id, error: (p as any)?.error?.message });
    }
    logger.info("build done", { id: done.id, pages: (done.pages || []).length, cost: done.usage, live: done.publishedUrl });
    return { id: done.id, status: "done", pages: (done.pages || []).map((p) => p.slug), usage: done.usage, publishedUrl: done.publishedUrl };
  },
});
