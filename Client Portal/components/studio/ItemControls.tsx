"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const LEAD = [["new", "New"], ["contacted", "Contacted"], ["qualified", "Qualified"], ["won", "Won"], ["lost", "Lost"]];
const SUPPORT = [["open", "Open"], ["in_progress", "In progress"], ["done", "Done"]];

/** Status buttons + notes (leads) or a reply the client sees (support). */
export function ItemControls({ kind, id, status, text }: { kind: "inspection" | "signup" | "support"; id: string; status: string; text: string }) {
  const router = useRouter();
  const [s, setS] = useState(status);
  const [t, setT] = useState(text);
  const [msg, setMsg] = useState("");
  const isSupport = kind === "support";

  async function save(patch: Record<string, string>) {
    setMsg("Saving…");
    const res = await fetch("/api/studio/item", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, ...patch }) });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? (j.emailed ? "Saved and emailed to the client." : "Saved.") : j.error ?? "Could not save.");
    router.refresh();
  }

  return (
    <div className="panel p-5 space-y-4">
      <div>
        <p className="label mb-2">Status</p>
        <div className="flex flex-wrap gap-1.5">
          {(isSupport ? SUPPORT : LEAD).map(([v, l]) => (
            <button key={v} type="button" onClick={() => { setS(v); save({ status: v }); }}
              className={`rounded-full px-3 py-1.5 text-xs border transition ${s === v ? "bg-ink text-bone border-ink" : "border-line hover:border-ink"}`}>{l}</button>
          ))}
        </div>
      </div>
      <div>
        <p className="label mb-2">{isSupport ? "Reply (the client sees this on their Requests page)" : "Notes (studio only)"}</p>
        <textarea className="input min-h-28 text-sm" value={t} onChange={(e) => setT(e.target.value)} placeholder={isSupport ? "Done — the new photos are live on the projects page." : "Called Tue, wants a quote for a full rebuild. Follow up Friday."} />
        <div className="mt-2 flex items-center gap-3">
          <button type="button" className="btn btn-ink !py-2 !px-4 text-xs" onClick={() => save(isSupport ? { reply: t } : { notes: t })}>{isSupport ? "Send reply" : "Save notes"}</button>
          {msg && <span className="text-xs text-ink-muted">{msg}</span>}
        </div>
      </div>
    </div>
  );
}
