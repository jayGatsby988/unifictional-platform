"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PlanItem } from "@/lib/data/types";

const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "");

/** The next topics in the content plan with their projected dates. The client can skip one or pull one forward. */
export function Upcoming({ plan, dates = {} }: { plan: PlanItem[]; dates?: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const items = plan.filter((p) => p.status === "planned").slice(0, 6);

  async function act(id: string, action: "skip" | "next") {
    setBusy(id + action); setMsg("");
    const res = await fetch("/api/autopilot/plan", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
    const j = await res.json().catch(() => ({}));
    setBusy("");
    setMsg(!res.ok ? j.error ?? "Couldn't save." : j.demo ? "Demo mode: not saved." : "");
    router.refresh();
  }

  return (
    <div className="panel divide-y divide-line">
      {items.map((p, i) => (
        <div key={p.id} className="p-4">
          <div className="flex items-start gap-3">
            <span className="font-mono text-xs text-ink-muted mt-0.5 w-12 shrink-0">{dates[p.id] ? when(dates[p.id]) : String(i + 1).padStart(2, "0")}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug">{p.title}</p>
              <p className="text-xs text-ink-muted mt-0.5">for <span className="text-ink">“{p.targetQuery}”</span></p>
              {p.angle && <p className="text-xs text-ink-muted mt-1">{p.angle}</p>}
              <div className="mt-2 flex gap-3">
                {i > 0 && <button type="button" className="text-xs underline" disabled={busy !== ""} onClick={() => act(p.id, "next")}>Write this next</button>}
                <button type="button" className="text-xs text-ink-muted underline" disabled={busy !== ""} onClick={() => act(p.id, "skip")}>Skip</button>
              </div>
            </div>
          </div>
        </div>
      ))}
      {items.length === 0 && <p className="p-4 text-sm text-ink-muted">The plan is drafted with your first post: twelve topics, biggest searches first.</p>}
      {msg && <p className="p-3 text-xs text-ink-muted">{msg}</p>}
    </div>
  );
}
