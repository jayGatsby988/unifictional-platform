"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, Plus, Star, Trash2 } from "lucide-react";
import type { Plan } from "@/lib/data/plans";
import { PLAN_ROLES } from "@/lib/data/plan-roles";
import { cn } from "@/lib/utils";

type Draft = { id?: string; name: string; tagline: string; price: string; features: string; highlight: boolean; published: boolean; sort: string; role: string; posts: string };
const toDraft = (p: Plan): Draft => ({ id: p.id, name: p.name, tagline: p.tagline, price: p.priceCents === null ? "" : String(p.priceCents / 100), features: p.features.join("\n"), highlight: p.highlight, published: p.published, sort: String(p.sort), role: p.role ?? "", posts: p.postsPerMonth ? String(p.postsPerMonth) : "" });

function PlanCard({ initial }: { initial: Draft }) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);

  async function save(next = d) {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/studio/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", plan: next }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: j.error ?? "Couldn't save." }); return; }
    setMsg({ ok: true, text: next.published ? "Saved. Clients see it on their Plans page." : "Saved as a draft. Clients don't see it yet." });
    router.refresh();
  }
  async function remove() {
    if (!d.id || !window.confirm(`Delete the ${d.name} plan? Clients already billed for it keep their billing in Square.`)) return;
    await fetch("/api/studio/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: d.id }) });
    router.refresh();
  }
  const field = "input !py-2 text-sm";
  return (
    <div className={cn("panel p-5 space-y-3", d.highlight && "border-ink")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("pill", d.published ? "pill-good" : "pill-neutral")}>{d.published ? "Published" : "Draft"}</span>
        {d.highlight && <span className="pill bg-ink text-bone">Most popular</span>}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" title={d.published ? "Hide from clients" : "Publish to clients"} className="btn btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setD({ ...d, published: !d.published })}>
            {d.published ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{d.published ? "Unpublish" : "Publish"}
          </button>
          <button type="button" title="Mark as most popular" className="btn btn-ghost !py-1.5 !px-2.5 text-xs" onClick={() => setD({ ...d, highlight: !d.highlight })}><Star className={cn("h-3.5 w-3.5", d.highlight && "fill-current")} /></button>
          {d.id && <button type="button" aria-label="Delete plan" className="btn btn-ghost !py-1.5 !px-2.5 text-xs hover:text-bad" onClick={remove}><Trash2 className="h-3.5 w-3.5" /></button>}
        </span>
      </div>
      <div className="grid sm:grid-cols-[1fr_140px_90px] gap-3">
        <label className="block"><span className="label !text-[9px] block mb-1">Plan name</span><input className={field} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
        <label className="block"><span className="label !text-[9px] block mb-1">$ / month</span><input className={field} inputMode="decimal" placeholder="blank = Custom" value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} /></label>
        <label className="block"><span className="label !text-[9px] block mb-1">Order</span><input className={field} inputMode="numeric" value={d.sort} onChange={(e) => setD({ ...d, sort: e.target.value })} /></label>
      </div>
      <div className="grid sm:grid-cols-[1fr_140px] gap-3">
        <label className="block">
          <span className="label !text-[9px] block mb-1">In the plan builder</span>
          <select className={field} value={d.role} onChange={(e) => setD({ ...d, role: e.target.value })}>
            <option value="">Not in it: shown with &quot;I&apos;m interested&quot;, quoted by you</option>
            {PLAN_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        {d.role === "posts" && <label className="block"><span className="label !text-[9px] block mb-1">Posts the price buys</span><input className={field} inputMode="numeric" placeholder="4" value={d.posts} onChange={(e) => setD({ ...d, posts: e.target.value })} /></label>}
      </div>
      {d.role === "posts" && <p className="text-[11px] text-ink-muted -mt-1">Clients pick 1, 2, 4 or 8 posts a month; each is priced at this rate divided by the posts it buys.</p>}
      <label className="block"><span className="label !text-[9px] block mb-1">One-line pitch</span><input className={field} value={d.tagline} onChange={(e) => setD({ ...d, tagline: e.target.value })} /></label>
      <label className="block"><span className="label !text-[9px] block mb-1">What&apos;s included (one per line)</span><textarea className={cn(field, "min-h-28")} value={d.features} onChange={(e) => setD({ ...d, features: e.target.value })} /></label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-ink !py-2 !px-4 text-xs" disabled={busy || (!dirty && Boolean(d.id))} onClick={() => save()}>{busy ? "Saving…" : d.id ? "Save" : "Add plan"}</button>
        {msg && <span className={cn("text-xs", msg.ok ? "text-ink-muted" : "text-bad")}>{msg.text}</span>}
      </div>
    </div>
  );
}

export function PlansEditor({ plans }: { plans: Plan[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      {plans.map((p) => <PlanCard key={`${p.id}-${p.sort}-${p.published}-${p.highlight}`} initial={toDraft(p)} />)}
      {adding ? (
        <PlanCard initial={{ name: "", tagline: "", price: "", features: "", highlight: false, published: false, sort: String((plans.at(-1)?.sort ?? 0) + 10), role: "", posts: "" }} />
      ) : (
        <button type="button" className="btn btn-ghost" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add a plan</button>
      )}
    </div>
  );
}
