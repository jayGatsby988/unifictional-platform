"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Studio: write (and publish) the next post for one company right now instead of waiting for the daily run. */
export function RunAutopilot({ slug, enabled, demo }: { slug: string; enabled: boolean; demo: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/autopilot/run?client=${encodeURIComponent(slug)}&force=1`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    const r = j.results?.[slug] as { ok: boolean; message: string } | undefined;
    setMsg(!res.ok ? j.error ?? "Run failed." : !r ? "Autopilot is off for this company." : `${r.ok ? "" : "Failed: "}${r.message}`);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1 items-stretch">
      <button type="button" className="btn btn-ink !py-2 !px-4 text-xs justify-center" disabled={busy || !enabled || demo} onClick={run}
        title={demo ? "Demo mode" : !enabled ? "The client hasn't switched it on" : "Write and publish the next post now"}>
        {busy ? "Writing… (about a minute)" : "Run now"}
      </button>
      {msg && <p className="text-[11px] text-ink-muted max-w-[16rem]">{msg}</p>}
    </div>
  );
}
