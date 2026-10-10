"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink, FileText, Link2, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "" | "invoice" | "plan";

export function BillingActions({ slug, name, customerId, defaultEmail, dashboard, presets = [] }:
  { slug: string; name: string; customerId: string | null; defaultEmail: string; dashboard: string; presets?: { name: string; dollars: string }[] }) {
  const router = useRouter();
  const [email, setEmail] = useState(defaultEmail);
  const [mode, setMode] = useState<Mode>("");
  const [desc, setDesc] = useState("Website build");
  const [planName, setPlanName] = useState("SEO & website care");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(body: Record<string, unknown>, done: (j: Record<string, unknown>) => string) {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/studio/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, ...body }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Something went wrong." }); return; }
    setMsg({ ok: true, text: done(j) }); setMode(""); setAmount(""); router.refresh();
  }

  const dollars = amount ? `$${amount.replace(/^\$/, "")}` : "";

  if (!customerId) {
    return (
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); call({ action: "link", email }, (j) => (j.existed ? "Linked to their existing Square customer." : "Created a Square customer and linked it.")); }}>
        <input className="input !w-56 !py-1.5 text-xs" type="email" required placeholder="billing email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label={`Billing email for ${name}`} />
        <button className="btn btn-ink !py-1.5 !px-3 text-xs" disabled={busy}><Link2 className="h-3.5 w-3.5" />{busy ? "Linking…" : "Link to Square"}</button>
        {msg && <span className={cn("text-[11px]", msg.ok ? "text-good" : "text-bad")}>{msg.text}</span>}
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn("btn !py-1.5 !px-3 text-xs", mode === "invoice" ? "btn-ink" : "btn-ghost")} onClick={() => { setMode(mode === "invoice" ? "" : "invoice"); setAmount("2000"); }}><FileText className="h-3.5 w-3.5" />Send invoice</button>
        <button type="button" className={cn("btn !py-1.5 !px-3 text-xs", mode === "plan" ? "btn-ink" : "btn-ghost")} onClick={() => { setMode(mode === "plan" ? "" : "plan"); setPlanName(presets[0]?.name ?? "SEO & website care"); setAmount(presets[0]?.dollars ?? "1500"); }}><Repeat className="h-3.5 w-3.5" />Start monthly plan</button>
        <a className="btn btn-ghost !py-1.5 !px-3 text-xs" target="_blank" rel="noreferrer" href={`${dashboard}/customers/directory/customer/${customerId}`}>Square<ExternalLink className="h-3.5 w-3.5" /></a>
      </div>

      {mode === "plan" && presets.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p.name} type="button" className={cn("pill", planName === p.name ? "bg-ink text-bone" : "pill-neutral")} onClick={() => { setPlanName(p.name); setAmount(p.dollars); }}>{p.name} · ${p.dollars}</button>
          ))}
        </div>
      )}
      {mode && (
        <form className={cn("rounded-xl border border-line p-3 grid gap-2 items-end", mode === "invoice" ? "sm:grid-cols-[1fr_120px_110px_auto]" : "sm:grid-cols-[1fr_120px_auto]")} onSubmit={(e) => {
          e.preventDefault();
          const what = mode === "invoice" ? `Email ${name} a ${dollars} invoice for "${desc}", due in ${days} days?` : `Start a ${dollars}/month "${planName}" plan for ${name}? Square emails an invoice every month, starting today.`;
          if (!window.confirm(what)) return;
          if (mode === "invoice") call({ action: "invoice", description: desc, amount, days }, () => "Invoice emailed. It's also on their Billing page.");
          else call({ action: "plan", name: planName, amount }, () => "Monthly plan started. The first invoice is on its way.");
        }}>
          <label className="block"><span className="label !text-[9px] block mb-1">{mode === "invoice" ? "What it's for" : "Plan name"}</span>
            <input className="input !py-1.5 text-xs" required value={mode === "invoice" ? desc : planName} onChange={(e) => (mode === "invoice" ? setDesc(e.target.value) : setPlanName(e.target.value))} /></label>
          <label className="block"><span className="label !text-[9px] block mb-1">{mode === "invoice" ? "Amount ($)" : "Per month ($)"}</span>
            <input className="input !py-1.5 text-xs" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          {mode === "invoice" && <label className="block"><span className="label !text-[9px] block mb-1">Due in</span>
            <select className="input !py-1.5 text-xs" value={days} onChange={(e) => setDays(e.target.value)}>
              {["3", "7", "14", "30"].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select></label>}
          <button className="btn btn-ink !py-1.5 !px-3 text-xs" disabled={busy}>{busy ? "Sending…" : mode === "invoice" ? "Send" : "Start"}</button>
        </form>
      )}
      {msg && <p className={cn("text-[11px]", msg.ok ? "text-good" : "text-bad")}>{msg.text}</p>}
    </div>
  );
}
