"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Studio: include SEO Autopilot in this company's plan, or stop. */
export function CompToggle({ slug, comped, demo }: { slug: string; comped: boolean; demo: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function toggle() {
    setBusy(true); setMsg("");
    const res = await fetch("/api/studio/autopilot", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, comped: !comped }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg(j.error ?? "Couldn't save."); return; }
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-1 items-stretch">
      <button type="button" className="btn btn-ghost !py-2 !px-4 text-xs justify-center" disabled={busy || demo} onClick={toggle} title={demo ? "Demo mode" : comped ? "Stop including it in their plan" : "Include it in their plan, no subscription needed"}>
        {busy ? "Saving…" : comped ? "Included · remove" : "Include in their plan"}
      </button>
      {msg && <p className="text-[11px] text-ink-muted">{msg}</p>}
    </div>
  );
}
