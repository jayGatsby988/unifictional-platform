"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** "I'm interested": sends a plan-upgrade request to the studio inbox; the studio follows up and quotes. */
export function ChoosePlan({ name, current, dark = false }: { name: string; current?: string; dark?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  async function send() {
    setState("busy");
    const res = await fetch("/api/requests", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "billing",
        title: `Interested in the ${name} plan`,
        body: `They tapped "I'm interested" on the ${name} plan${current ? ` (currently on ${current})` : ""}. Reach out to walk them through it and quote it.`,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setState("error"); setMsg(j.error ?? "Couldn't send. Try again."); return; }
    setState("done");
  }
  if (state === "done") {
    return <p className={cn("text-sm flex items-start gap-2", dark ? "text-bone" : "text-ink")}><Check className="h-4 w-4 mt-0.5 shrink-0" />Got it. We&apos;ll reach out within a day to walk you through it.</p>;
  }
  return (
    <div>
      <button type="button" onClick={send} disabled={state === "busy"} className={cn("btn w-full justify-center", dark ? "bg-bone text-ink hover:opacity-90" : "btn-ink")}>
        {state === "busy" ? "Sending…" : "I'm interested"}
      </button>
      {state === "error" && <p className="text-xs text-bad mt-2">{msg}</p>}
    </div>
  );
}
