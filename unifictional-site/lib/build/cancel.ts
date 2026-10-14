// @ts-nocheck
// Cancel a build from the dashboard: every Trigger run that belongs to the
// build (the parent and its children) is cancelled through Trigger's API,
// and the lead record is marked cancelled so the board stops showing it as
// building. Works for the classic pipeline and the team run alike.
import { readJson, saveLead, type LeadRecord } from "./storage";

const API = "https://api.trigger.dev";
const TASKS = ["build-site", "build-team", "build-research", "build-video", "build-home", "build-site-rest", "build-publish"];
const DONE = new Set(["COMPLETED", "FAILED", "CANCELED", "CRASHED", "SYSTEM_FAILURE", "EXPIRED", "TIMED_OUT"]);

async function api(path, { method = "GET" } = {}) {
  const key = process.env.TRIGGER_SECRET_KEY;
  if (!key) throw new Error("TRIGGER_SECRET_KEY is not set");
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`Trigger ${method} ${path}: ${r.status}`);
  return r.json();
}

/** Cancel every live run of this build. Returns what was cancelled. */
export async function cancelBuildRuns(id: string): Promise<{ cancelled: { task: string; run: string }[]; checked: number }> {
  const cancelled = []; let checked = 0;
  for (const task of TASKS) {
    let runs = [];
    try { runs = (await api(`/api/v1/runs?filter[taskIdentifier]=${task}&page[size]=10`)).data || []; } catch { continue; }
    for (const r of runs) {
      if (DONE.has(r.status)) continue;
      checked++;
      let d; try { d = await api(`/api/v3/runs/${r.id}`); } catch { continue; }
      const p = d.payload || {};
      if (String(p.id || "") !== id) continue;
      try { await api(`/api/v2/runs/${r.id}/cancel`, { method: "POST" }); cancelled.push({ task, run: r.id }); } catch {}
    }
  }
  return { cancelled, checked };
}

/** Cancel the build and mark the record. */
export async function cancelBuild(id: string, by = "owner") {
  const runs = await cancelBuildRuns(id);
  const rec = await readJson<LeadRecord>(`leads/${id}.json`);
  // a finished build is never relabelled: only something still running (or stalled) becomes "cancelled"
  if (rec && !["done", "failed", "cancelled"].includes(String(rec.status))) {
    const line = `${new Date().toISOString().slice(11, 19)} cancelled by the ${by} from the dashboard${runs.cancelled.length ? ` (${runs.cancelled.map(c => c.task).join(", ")} stopped)` : " (no live run found)"}`;
    await saveLead({ ...rec, status: "cancelled", updatedAt: new Date().toISOString(), error: rec.error || "cancelled from the dashboard", log: [...(rec.log || []), line] });
  }
  return { ...runs, recorded: Boolean(rec) };
}
