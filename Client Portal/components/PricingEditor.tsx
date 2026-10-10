"use client";

import { useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import type { PriceOption, PricingConfig, ProjectType } from "@/lib/data/types";
import { quote } from "@/lib/quote";
import { DEFAULT_DISCLAIMER, PRICING_TEMPLATES, TYPICAL_SIZE, suggestTemplate } from "@/lib/pricing-templates";
import { cn, fmt } from "@/lib/utils";

const UNIT_LABEL = { sqft: "sq ft", lf: "linear ft", each: "each" } as const;

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label !text-[9px] block mb-1">{label}</span>
      {children}
    </label>
  );
}

export function PricingEditor({ initial, industry = "" }: { initial: PricingConfig; industry?: string }) {
  const [cfg, setCfg] = useState<PricingConfig>(initial);
  const [saved, setSaved] = useState<PricingConfig>(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState("");
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);

  // Live preview: first enabled type at a typical size with its first two options.
  const [pickedType, setPreviewType] = useState(initial.projectTypes.find((p) => p.enabled)?.id ?? "");
  const enabledTypes = cfg.projectTypes.filter((p) => p.enabled);
  // Fall back to the first live type so the preview never goes blank after edits.
  const previewType = enabledTypes.some((p) => p.id === pickedType) ? pickedType : (enabledTypes[0]?.id ?? "");
  const [templateKey, setTemplateKey] = useState(() => suggestTemplate(industry).key);
  function applyTemplate() {
    const tpl = PRICING_TEMPLATES.find((p) => p.key === templateKey) ?? PRICING_TEMPLATES[0];
    setCfg({ ...cfg, projectTypes: tpl.projectTypes, options: tpl.options, disclaimer: cfg.disclaimer || DEFAULT_DISCLAIMER });
    setPreviewType(tpl.projectTypes[0].id);
    setPreviewSize(TYPICAL_SIZE[tpl.projectTypes[0].id] ?? 600);
    setMsg("Starter prices loaded. Change them to your real numbers, then publish.");
    setState("idle");
  }
  const [previewSize, setPreviewSize] = useState(600);
  const [previewOpts, setPreviewOpts] = useState<string[]>([]);
  const preview = quote(cfg, previewType, previewSize, previewOpts);
  const previewOptions = cfg.options.filter((o) => o.enabled && (!o.appliesTo.length || o.appliesTo.includes(previewType)));

  const setType = (i: number, patch: Partial<ProjectType>) =>
    setCfg({ ...cfg, projectTypes: cfg.projectTypes.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setOpt = (i: number, patch: Partial<PriceOption>) =>
    setCfg({ ...cfg, options: cfg.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  async function save() {
    setState("saving");
    const res = await fetch("/api/estimator/pricing", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setState("error"); setMsg(json.error ?? "Could not save."); return; }
    setSaved(json.config ?? cfg);
    setCfg(json.config ?? cfg);
    setState("saved");
    setMsg(json.demo ? "Demo mode: changes apply to this preview only." : "Saved. Your website picks this up within a minute.");
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        {cfg.projectTypes.length === 0 && (
          <div className="panel p-5 border-ink">
            <div className="flex items-start gap-3">
              <span className="grid place-items-center h-9 w-9 rounded-full bg-sand shrink-0"><Sparkles className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-xl uppercase leading-tight">Start with a price list for your trade</h2>
                <p className="text-sm text-ink-muted mt-1">We fill in common jobs and add-ons with rough starting prices. You change them to your real numbers before anything goes live.</p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <select aria-label="Trade" className="input !py-2 !w-auto" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
                    {PRICING_TEMPLATES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                  <button className="btn btn-ink" onClick={applyTemplate}>Fill in starter prices</button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="label !text-ink-soft">Project types &amp; base rates</h2>
            <button className="btn btn-ghost !py-1.5 !px-3 text-xs" onClick={() => setCfg({ ...cfg, projectTypes: [...cfg.projectTypes, { id: `pt-${Date.now()}`, name: "", unit: "sqft", baseRate: 0, minPrice: 0, enabled: true }] })}>
              <Plus className="h-3.5 w-3.5" /> Add type
            </button>
          </div>
          <div className="divide-y divide-line">
            {cfg.projectTypes.map((p, i) => (
              <div key={p.id} className={cn("py-3 space-y-2", !p.enabled && "opacity-50")}>
                <div className="flex items-center gap-2">
                  <input className="input !py-2 min-w-0 flex-1" value={p.name} placeholder="e.g. Detached ADU" onChange={(e) => setType(i, { name: e.target.value })} />
                  <label className="flex items-center gap-1.5 text-xs text-ink-muted shrink-0"><input type="checkbox" className="h-4 w-4 accent-black" checked={p.enabled} onChange={(e) => setType(i, { enabled: e.target.checked })} />Live</label>
                  <button aria-label="Remove" className="text-ink-muted hover:text-bad shrink-0" onClick={() => setCfg({ ...cfg, projectTypes: cfg.projectTypes.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Priced per">
                    <select className="input !py-2 min-w-0" value={p.unit} onChange={(e) => setType(i, { unit: e.target.value as ProjectType["unit"] })}>
                      {Object.entries(UNIT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Field>
                  <Field label="Rate / unit"><div className="relative"><span className="absolute left-3 top-2 text-sm text-ink-muted">$</span><input type="number" min={0} className="input !py-2 !pl-6 min-w-0" value={p.baseRate} onChange={(e) => setType(i, { baseRate: +e.target.value })} /></div></Field>
                  <Field label="Minimum quote"><div className="relative"><span className="absolute left-3 top-2 text-sm text-ink-muted">$</span><input type="number" min={0} step={500} className="input !py-2 !pl-6 min-w-0" value={p.minPrice} onChange={(e) => setType(i, { minPrice: +e.target.value })} /></div></Field>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="label !text-ink-soft">Options homeowners can add</h2>
            <button className="btn btn-ghost !py-1.5 !px-3 text-xs" onClick={() => setCfg({ ...cfg, options: [...cfg.options, { id: `opt-${Date.now()}`, name: "", appliesTo: [], priceType: "flat", amount: 0, enabled: true }] })}>
              <Plus className="h-3.5 w-3.5" /> Add option
            </button>
          </div>
          <div className="divide-y divide-line">
            {cfg.options.map((o, i) => (
              <div key={o.id} className={cn("py-3 space-y-2", !o.enabled && "opacity-50")}>
                <div className="flex items-center gap-2">
                  <input className="input !py-2 min-w-0 flex-1" value={o.name} placeholder="e.g. Second bathroom" onChange={(e) => setOpt(i, { name: e.target.value })} />
                  <label className="flex items-center gap-1.5 text-xs text-ink-muted shrink-0"><input type="checkbox" className="h-4 w-4 accent-black" checked={o.enabled} onChange={(e) => setOpt(i, { enabled: e.target.checked })} />Live</label>
                  <button aria-label="Remove" className="text-ink-muted hover:text-bad shrink-0" onClick={() => setCfg({ ...cfg, options: cfg.options.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Charged as">
                    <select className="input !py-2 min-w-0" value={o.priceType} onChange={(e) => setOpt(i, { priceType: e.target.value as PriceOption["priceType"] })}>
                      <option value="flat">Flat amount</option>
                      <option value="per_unit">Per unit of size</option>
                      <option value="percent">% of base price</option>
                    </select>
                  </Field>
                  <Field label="Amount"><div className="relative"><span className="absolute left-3 top-2 text-sm text-ink-muted">{o.priceType === "percent" ? "%" : "$"}</span><input type="number" min={0} className="input !py-2 !pl-6 min-w-0" value={o.amount} onChange={(e) => setOpt(i, { amount: +e.target.value })} /></div></Field>
                </div>
                <div>
                  <span className="label !text-[9px] block mb-1">Offered on</span>
                  <div className="flex flex-wrap gap-1.5">
                    {cfg.projectTypes.map((p) => {
                      const on = o.appliesTo.includes(p.id);
                      return (
                        <button key={p.id} type="button" onClick={() => setOpt(i, { appliesTo: on ? o.appliesTo.filter((x) => x !== p.id) : [...o.appliesTo, p.id] })}
                          className={cn("pill", on ? "bg-ink text-bone" : "pill-neutral")}>{p.name || "untitled"}</button>
                      );
                    })}
                    {o.appliesTo.length === 0 && <span className="text-[10px] text-ink-muted self-center">none selected = every type</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-5 grid sm:grid-cols-3 gap-4">
          <Field label="Markup on top (%)"><input type="number" min={0} max={100} className="input !py-2" value={cfg.markupPct} onChange={(e) => setCfg({ ...cfg, markupPct: +e.target.value })} /></Field>
          <Field label="Show as a range (± %)"><input type="number" min={0} max={50} className="input !py-2" value={cfg.rangePct} onChange={(e) => setCfg({ ...cfg, rangePct: +e.target.value })} /></Field>
          <Field label="Deposit to book (%)"><input type="number" min={0} max={100} className="input !py-2" value={cfg.depositPct} onChange={(e) => setCfg({ ...cfg, depositPct: +e.target.value })} /></Field>
          <Field label="Fine print shown under every estimate" className="sm:col-span-3"><textarea className="input !py-2 min-h-16" value={cfg.disclaimer} onChange={(e) => setCfg({ ...cfg, disclaimer: e.target.value })} /></Field>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <button className="btn btn-ink" disabled={!dirty || state === "saving"} onClick={save}>{state === "saving" ? "Saving…" : "Publish pricing"}</button>
          {dirty && <button className="btn btn-ghost" onClick={() => setCfg(saved)}>Discard</button>}
          {msg && <p className={cn("text-sm", state === "error" ? "text-bad" : "text-ink-muted")}>{msg}</p>}
          {!dirty && !msg && <p className="text-xs text-ink-muted">Last published {fmt.dateLong(saved.updatedAt)}</p>}
        </div>
      </div>

      <aside className="panel p-5 h-fit lg:sticky lg:top-24">
        <h2 className="label !text-ink-soft mb-1">What a homeowner sees</h2>
        <p className="text-xs text-ink-muted mb-4">Live preview with the numbers above, before you publish.</p>
        <div className="space-y-3">
          <Field label="Project">
            <select className="input !py-2" value={previewType} onChange={(e) => { setPreviewType(e.target.value); setPreviewOpts([]); if (TYPICAL_SIZE[e.target.value]) setPreviewSize(TYPICAL_SIZE[e.target.value]); }}>
              {enabledTypes.length === 0 && <option value="">Add a project type first</option>}
              {enabledTypes.map((p) => <option key={p.id} value={p.id}>{p.name || "untitled"}</option>)}
            </select>
          </Field>
          <Field label={`Size (${UNIT_LABEL[cfg.projectTypes.find((p) => p.id === previewType)?.unit ?? "sqft"]})`}>
            <input type="number" min={1} className="input !py-2" value={previewSize} onChange={(e) => setPreviewSize(+e.target.value)} />
          </Field>
          {previewOptions.length > 0 && (
            <div>
              <span className="label !text-[9px] block mb-1">Options</span>
              <div className="flex flex-wrap gap-1.5">
                {previewOptions.map((o) => {
                  const on = previewOpts.includes(o.id);
                  return <button key={o.id} type="button" className={cn("pill", on ? "bg-ink text-bone" : "pill-neutral")} onClick={() => setPreviewOpts(on ? previewOpts.filter((x) => x !== o.id) : [...previewOpts, o.id])}>{o.name}</button>;
                })}
              </div>
            </div>
          )}
        </div>
        {preview ? (
          <div className="mt-5 rounded-xl bg-ink text-bone p-4">
            <p className="label !text-bone/60 mb-1">Instant estimate</p>
            <p className="font-display text-3xl leading-none">${fmt.int(preview.low)} – ${fmt.int(preview.high)}</p>
            <ul className="mt-3 space-y-1 text-xs text-bone/70">
              {preview.lines.map((l, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate">{l.name}</span><span className="font-mono shrink-0">${fmt.int(l.amount)}</span></li>)}
            </ul>
            <p className="mt-3 text-xs text-bone/70">Deposit to book: <span className="font-mono text-bone">${fmt.int(preview.deposit)}</span></p>
            {cfg.disclaimer && <p className="mt-3 text-[11px] text-bone/50 leading-snug">{cfg.disclaimer}</p>}
          </div>
        ) : (
          <p className="mt-5 text-sm text-ink-muted">Enable at least one project type to preview.</p>
        )}
      </aside>
    </div>
  );
}
