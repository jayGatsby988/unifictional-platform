// One entry point to start a build: Trigger.dev when it is configured
// (TRIGGER_SECRET_KEY set), otherwise the HTTP step chain on Vercel.
import type { BuildLead } from "./pipeline";
import { startBuild } from "./pipeline";

export const triggerConfigured = () => Boolean(process.env.TRIGGER_SECRET_KEY);

export async function startBuildAnywhere(p: { id: string; origin: string; lead: BuildLead }): Promise<{ via: "trigger" | "vercel"; runId?: string }> {
  if (triggerConfigured()) {
    const { tasks } = await import("@trigger.dev/sdk");
    const handle = await tasks.trigger("build-site", p);
    return { via: "trigger", runId: handle.id };
  }
  await startBuild(p);
  return { via: "vercel" };
}
