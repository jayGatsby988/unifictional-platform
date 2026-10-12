"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** "Cancel my plan": one confirmation, then Square ends the subscription at the end of the paid period. */
export function CancelPlan({ plan, demo }: { plan: string; demo: boolean }) {
  const router = useRouter();
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function cancel() {
    setBusy(true); setMsg("");
    const res = await fetch("/api/autopilot/subscription", { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg(j.error ?? "Couldn't cancel. Try again or ask us."); return; }
    setArm(false);
    setMsg(j.demo ? "Demo mode: this is where the plan would be cancelled." : `Cancelled. Posts keep coming until ${j.endsOn ? new Date(j.endsOn + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : "the end of the paid period"}, then stop. Come back any time.`);
    router.refresh();
  }

  return (
    <div className="mt-6 pt-5 border-t border-line text-sm">
      <p className="text-ink-muted">You&apos;re on <span className="text-ink">{plan}</span>.</p>
      {!arm ? (
        <button type="button" className="mt-2 text-xs underline text-ink-muted hover:text-ink" onClick={() => setArm(true)}>Cancel my plan</button>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs">End it at the end of the paid period? Posts already written stay live.</span>
          <button type="button" className="btn btn-ink !py-1.5 !px-3 text-xs" disabled={busy || demo} onClick={cancel}>{busy ? "Cancelling…" : "Yes, cancel"}</button>
          <button type="button" className="btn btn-ghost !py-1.5 !px-3 text-xs" disabled={busy} onClick={() => setArm(false)}>Keep it</button>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-ink-muted">{msg}</p>}
    </div>
  );
}
