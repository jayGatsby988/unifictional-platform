"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Create a company (optionally from a lead) and give the lead's email portal access. */
export function CreateCompany({ initial, from, title = "Turn this lead into a client" }: {
  initial: { name?: string; website?: string; email?: string; industry?: string; city?: string };
  from?: { kind: "signup" | "inspection"; id: string };
  title?: string;
}) {
  const router = useRouter();
  const [f, setF] = useState({ name: initial.name ?? "", website: initial.website ?? "", email: initial.email ?? "", industry: initial.industry ?? "", city: initial.city ?? "" });
  const [bill, setBill] = useState({ start: false, build: "2000", monthly: "1500" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (bill.start) {
      if (!f.email) { setMsg("Add their email so Square knows where to send the invoice."); return; }
      const parts = [Number(bill.build) > 0 && `email a $${bill.build} build invoice`, Number(bill.monthly) > 0 && `start a $${bill.monthly}/month plan`].filter(Boolean).join(" and ");
      if (parts && !window.confirm(`Create ${f.name} and ${parts} to ${f.email} through Square?`)) return;
    }
    setBusy(true); setMsg("");
    const res = await fetch("/api/studio/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, from, billing: bill }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg(j.error ?? "Could not create the company."); return; }
    const base = j.linked ? `Created. ${f.email} can now sign in and see the dashboard.` : `Created.${f.email ? ` ${f.email} is connected automatically when they sign in. To send them a password now, use Create login on the Companies page.` : ""}`;
    const b = j.billing as { steps: string[]; error: string | null } | undefined;
    setMsg([base, b?.steps.length ? `${b.steps.join(". ")}.` : "", b?.error ? `Square: ${b.error}` : ""].filter(Boolean).join(" "));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="panel p-5 space-y-3">
      <p className="label">{title}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {([["name", "Company name"], ["website", "Website"], ["email", "Their email (portal login + Square invoices)"], ["industry", "Trade"], ["city", "City"]] as const).map(([k, l]) => (
          <label key={k} className={k === "email" ? "sm:col-span-2 block" : "block"}>
            <span className="label !text-[9px] block mb-1">{l}</span>
            <input className="input !py-2 text-sm" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required={k === "name"} />
          </label>
        ))}
      </div>
      <div className="rounded-xl border border-line p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-black" checked={bill.start} onChange={(e) => setBill({ ...bill, start: e.target.checked })} />
          Start billing in Square now
        </label>
        <p className="text-[11px] text-ink-muted">They&apos;re always linked to Square by email. Ticked, this also emails the build invoice and starts the monthly plan. Leave an amount empty to skip it.</p>
        {bill.start && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="label !text-[9px] block mb-1">Build invoice ($)</span><input className="input !py-2 text-sm" inputMode="decimal" value={bill.build} onChange={(e) => setBill({ ...bill, build: e.target.value })} /></label>
            <label className="block"><span className="label !text-[9px] block mb-1">Monthly plan ($/mo)</span><input className="input !py-2 text-sm" inputMode="decimal" value={bill.monthly} onChange={(e) => setBill({ ...bill, monthly: e.target.value })} /></label>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-ink !py-2 !px-4 text-xs" disabled={busy}>{busy ? "Creating…" : "Create company"}</button>
        {msg && <span className="text-xs text-ink-muted">{msg}</span>}
      </div>
    </form>
  );
}
