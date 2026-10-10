"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { at: 0, text: "Reading your website" },
  { at: 6, text: "Pulling the searches people type near you" },
  { at: 12, text: "Checking your Google data and the content plan" },
  { at: 18, text: "Writing the post (this is the slow part, about a minute)" },
  { at: 70, text: "Running the SEO checklist and fixing what it missed" },
];

/** One click: the whole pipeline for this company, with the steps shown while it runs. */
export function WriteNow({ big = false, demo }: { big?: boolean; demo: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function run() {
    setBusy(true); setDone(null); setElapsed(0);
    timer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    const res = await fetch("/api/autopilot/write-now", { method: "POST" });
    const j = await res.json().catch(() => ({}));
    // Demo mode answers instantly; let the steps play for a moment so the flow is visible.
    if (j.demo) await new Promise((r) => setTimeout(r, 9000));
    if (timer.current) clearInterval(timer.current);
    setBusy(false);
    setDone(res.ok ? { ok: true, text: j.demo ? j.message : `Done — ${j.message}` } : { ok: false, text: j.error ?? j.message ?? "Something went wrong." });
    if (res.ok) router.refresh();
  }

  const current = STEPS.filter((s) => s.at <= elapsed).length - 1;
  return (
    <div className={cn(big && "panel p-5 sm:p-6")}>
      {big && <p className="label mb-2">Your first post</p>}
      {big && <p className="font-display text-2xl leading-tight mb-3">Don&apos;t wait for the schedule. Watch it write one now.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-ink" disabled={busy} onClick={run}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {busy ? `Writing… ${elapsed}s` : "Write a post now"}
        </button>
        {done && <p className={cn("text-sm", done.ok ? "text-ink-muted" : "text-bad")}>{done.text}</p>}
        {!busy && !done && demo && <p className="text-xs text-ink-muted">Demo mode: shows the steps, writes nothing.</p>}
      </div>
      {busy && (
        <ol className="mt-4 space-y-2">
          {STEPS.map((s, i) => (
            <li key={s.text} className={cn("flex items-center gap-2 text-sm transition", i < current ? "text-ink-muted" : i === current ? "text-ink" : "text-ink-muted/40")}>
              <span className={cn("h-5 w-5 rounded-full grid place-items-center shrink-0", i < current ? "bg-ink text-bone" : i === current ? "border border-ink" : "border border-line")}>
                {i < current ? <Check className="h-3 w-3" /> : i === current ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              </span>
              {s.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
