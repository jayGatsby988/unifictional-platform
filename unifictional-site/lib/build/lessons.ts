// @ts-nocheck
// Studio lessons: what the last builds taught, carried into the next one.
// After every build (pass or fail) the judge's findings are distilled into a
// short, dated list of rules kept in Blob at studio/lessons.json. The planner,
// the writers and the repair agent read it first, so a mistake made on one
// site is not made again on the next. Capped at twelve rules; the distiller
// prunes what is stale or already enforced in code.
import { readJson, saveJson } from "./storage";
import { structured, parseJson, addUsage, modelFor } from "./claude";

const PATH = "studio/lessons.json";
const MAX = 12;

export interface Lesson { rule: string; why: string; from: string; date: string; seen: number }

export async function loadLessons(): Promise<Lesson[]> {
  try { const l = await readJson<{ lessons: Lesson[] }>(PATH); return Array.isArray(l?.lessons) ? l.lessons.slice(0, MAX) : []; } catch { return []; }
}

/** The block every agent reads. Empty string when there are no lessons yet. */
export function lessonsBlock(lessons: Lesson[]) {
  if (!lessons.length) return "";
  return `STUDIO LESSONS (from the last builds; each one cost a round or a build, do not repeat them):\n${lessons.map((l, i) => `${i + 1}. ${l.rule} (${l.why}; ${l.from}, seen ${l.seen}×)`).join("\n")}`;
}

const SYSTEM_DISTILL = () => `You keep the studio's lessons file: a short list of rules that stop the same mistake happening on the next website build. You get the current lessons and what the quality judge found on the build that just finished (its verdicts, blocking issues and whether it passed).

Produce the new list, at most 12 rules, newest first. Each rule is one sentence a designer or writer can act on ("Never caption a photo as a named client's job unless the research ties them", "Service pages all open the same way"), with a one-line why. Merge a finding into an existing rule when it is the same lesson (increase its seen count); drop a rule that is now enforced by the pipeline's own checks (you are told which those are) or that has not been seen for several builds. Do not include taste that only applied to one company. Return ONLY JSON: {"lessons":[{"rule":"","why":"","from":"<business name, date>","date":"YYYY-MM-DD","seen":1}]}`;

/** Called at the end of every build. Never throws. */
export async function distillLessons(job, { enforced = [] as string[] } = {}) {
  try {
    const current = await loadLessons();
    const qa = job.qa || {};
    const findings = (qa.history || []).map(h => `round ${h.round}: score ${h.score}, pass ${h.pass}; ${h.verdict || ""}`).join("\n");
    const issues = (qa.issues || []).slice(0, 20).map(i => `- ${i.page}${i.section ? " §" + i.section : ""} (${i.severity}): ${i.problem}`).join("\n");
    const user = `CURRENT LESSONS:\n${JSON.stringify(current, null, 1)}\n\nBUILD JUST FINISHED: ${job.lead?.businessName || job.dossier?.name || "unknown"} on ${new Date().toISOString().slice(0, 10)}, passed: ${Boolean(qa.passed)}\nJUDGE HISTORY:\n${findings || "none"}\nLAST ISSUES:\n${issues || "none"}\n\nALREADY ENFORCED BY THE PIPELINE (do not keep rules for these):\n- ${enforced.join("\n- ") || "none"}`;
    const { text, usage } = await structured({ system: SYSTEM_DISTILL(), user, schema: null, effort: "low", maxTokens: 6000, model: modelFor("review") });
    job.usage = addUsage(job.usage, usage);
    const out = parseJson(text);
    const lessons = Array.isArray(out?.lessons) ? out.lessons.filter(l => l && l.rule).slice(0, MAX) : current;
    await saveJson(PATH, { lessons, updatedAt: new Date().toISOString(), lastBuild: job.id });
    return lessons;
  } catch (e) {
    console.error("[lessons] distill failed:", e?.message || e);
    return [];
  }
}

/** The checks the pipeline already enforces, so lessons do not duplicate them. */
export const ENFORCED = [
  "hero word is the brand word; their logo is used when found; accent colour set",
  "home page order: video hero, flagship showcase, proof stack; cta present",
  "no four text-only sections in a row; inner pages open with a photo; at least half of photo-capable sections carry a photo",
  "service pages all open the same way",
  "a pack effect appears at most twice per site; one heavy effect, home only; a different hero, menu and effect set from the previous build",
  "no horizontal overflow, clipped headlines, blank sections, broken images, script errors, missing h1 or logo (browser inspection)",
  "reviews without a real name are dropped; the same real photo is not reused on another page",
  "hero video is generated from a finished-work photo and never swapped for another hero",
  "frame drops and page weight are measured; every internal link is checked",
  "the home page mixes at least three studio sections with at least three pack effects; the type pair is never oswald and never the previous build's; effects in the right place (fit table)",
  "the hero clip is a before → after transformation when their photos allow it, two candidates are judged, a texture loop is made when a close-up exists",
];
