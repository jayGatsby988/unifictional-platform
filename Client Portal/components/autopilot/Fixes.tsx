"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";
import type { AutopilotFix } from "@/lib/data/types";
import { cn } from "@/lib/utils";

const IMPACT = { high: "pill-bad", medium: "pill-warn", low: "pill-neutral" } as const;

/** The suggested on-page fixes from one run, as a checklist with progress. */
export function Fixes({ runId, fixes, when }: { runId: string; fixes: AutopilotFix[]; when: string }) {
  const router = useRouter();
  const [items, setItems] = useState(fixes);
  const [msg, setMsg] = useState("");
  const done = items.filter((f) => f.done).length;

  async function toggle(index: number) {
    const next = !items[index].done;
    setItems(items.map((f, i) => (i === index ? { ...f, done: next } : f)));
    const res = await fetch("/api/autopilot/fixes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, index, done: next }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setItems(items); setMsg(j.error ?? "Couldn't save."); return; }
    setMsg(j.demo ? "Demo mode: not saved." : "");
    router.refresh();
  }

  return (
    <div className="panel">
      <div className="p-4 border-b border-line">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-sm font-medium">{done} of {items.length} done</p>
          <span className="text-sm text-ink-muted">suggested {when}</span>
        </div>
        <div className="h-1.5 rounded-full bg-sand overflow-hidden"><div className="h-full bg-ink rounded-full transition-all" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} /></div>
      </div>
      <ul className="divide-y divide-line">
        {items.map((f, i) => (
          <li key={i} className={cn("p-4 flex gap-3", f.done && "opacity-60")}>
            <button type="button" aria-pressed={Boolean(f.done)} aria-label={f.done ? "Mark not done" : "Mark done"} onClick={() => toggle(i)}
              className={cn("mt-0.5 h-6 w-6 rounded-full grid place-items-center shrink-0 border transition", f.done ? "bg-ink border-ink text-bone" : "border-line hover:border-ink")}>
              {f.done && <Check className="h-3.5 w-3.5" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2 mb-1"><p className={cn("text-sm font-medium", f.done && "line-through decoration-1")}>{f.title}</p><span className={cn("pill", IMPACT[f.impact])}>{f.impact}</span></div>
              <p className="text-xs text-ink-muted font-mono mb-1">{f.where}</p>
              <p className="text-xs text-ink-muted">{f.why}</p>
              <p className="text-xs mt-1">{f.how}</p>
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="p-4 text-sm text-ink-muted">The first list of fixes arrives with your first post.</li>}
      </ul>
      {msg && <p className="px-4 pb-3 text-xs text-ink-muted">{msg}</p>}
    </div>
  );
}
