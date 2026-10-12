"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Studio: write (and publish) the next post for one company right now, or,
 * without a slug, run the whole daily job for every company that's due.
 */
export function RunAutopilot({ slug, enabled = true, demo, label }: { slug?: string; enabled?: boolean; demo: boolean; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    setBusy(true);
    setMsg("");
    const url = slug ? `/api/autopilot/run?client=${encodeURIComponent(slug)}&force=1` : "/api/autopilot/run";
    const res = await fetch(url, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    const results = (j.results ?? {}) as Record<string, { ok: boolean; message: string }>;
    if (!res.ok) setMsg(j.error ?? "Run failed.");
    else if (slug) { const r = results[slug]; setMsg(!r ? "Autopilot is off for this company." : `${r.ok ? "" : "Failed: "}${r.message}`); }
    else setMsg(Object.entries(results).map(([k, r]) => `${k}: ${r.ok ? "" : "FAILED "}${r.message}`).join(" · ") || "Nothing due.");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1 items-stretch">
      <button type="button" className="btn btn-ink !py-2 !px-4 text-xs justify-center" disabled={busy || !enabled || demo} onClick={run}
        title={demo ? "Demo mode" : !enabled ? "The client hasn't switched it on" : slug ? "Write and publish the next post now" : "Publish approved posts and write every post that's due"}>
        {busy ? (slug ? "Writing… (about a minute)" : "Running…") : label ?? "Run now"}
      </button>
      {msg && <p className="text-[11px] text-ink-muted max-w-[22rem]">{msg}</p>}
    </div>
  );
}
