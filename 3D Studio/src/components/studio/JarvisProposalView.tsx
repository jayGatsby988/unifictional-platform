'use client';
/* eslint-disable @next/next/no-img-element -- Immutable client render URLs are already optimized by the render service. */
import { ArrowUpRight, Printer } from 'lucide-react';
import type { DesignOption, JarvisProposal } from '@/lib/jarvis/types';
import { fmtUSD, fmtRange } from '@/lib/units';
import { CATALOG_BY_ID, SLOT_META } from '@/lib/materials/catalog';
import { REGION_BY_ID } from '@/lib/estimate/pricebook';
import { activeSlotsFor, materialName, slotLabel } from './projectUtils';
import { jarvisGeometrySummary, jarvisOptionUnpriced } from './JarvisOptionCard';
import { UnpricedScanWork } from './UnpricedScanWork';
import { isScannedProject, publicImageUrl } from '@/lib/sharing/project';
import { designFingerprint } from '@/lib/jarvis/types';

/** Client scope is derived from the priced snapshot, never archival model prose. */
export function jarvisProposalScope(option: DesignOption): string {
  const { spec, selections, baseline } = option.snapshot;
  const geometry = baseline ? jarvisGeometrySummary(baseline.spec, spec) : [];
  const finishes = activeSlotsFor(spec, spec.roomType)
    .filter((slot) => selections[slot] && (!baseline || selections[slot] !== baseline.selections[slot]))
    .map((slot) => `${slotLabel(slot)}: ${materialName(selections[slot])}`);
  return [...geometry, ...finishes].join(' · ') || (baseline ? 'Existing layout and finishes retained.' : 'Current layout and selected finishes.');
}

export function JarvisProposalView({ proposal: p }: { proposal: JarvisProposal }) {
  const scopeById = new Map(p.options.map((option) => [option.id, jarvisProposalScope(option)]));
  return <main className="min-h-dvh shrink-0 bg-[#f6f4ef] px-5 py-8 text-[#24251f] sm:px-10 print:bg-white print:p-0">
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-col items-start justify-between gap-5 border-b sm:flex-row sm:gap-6 border-[#bebebe] pb-8">
        <div><p className="text-xs uppercase tracking-[.18em] text-[#767064]">{p.branding?.company || 'MANHATTAN'} · Design proposal</p><h1 className="mt-3 font-display text-4xl sm:text-5xl">{p.title}</h1><p className="mt-3 text-sm text-[#6d6d6d]">{p.projectName}{p.client?.name ? ` · Prepared for ${p.client.name}` : ''} · {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</p>{p.client?.address && <p className="mt-1 text-sm text-[#6d6d6d]">{p.client.address}</p>}</div>
        <button type="button" className="flex shrink-0 items-center gap-2 rounded-full border border-[#c9c3b6] px-4 py-2 text-sm print:hidden" onClick={() => window.print()}><Printer size={15} /> Print / PDF</button>
      </header>
      <div className="my-6 flex flex-wrap gap-3 text-sm">{p.constraints.budgetMax !== null && <span className="rounded-full bg-white px-4 py-2">Budget ceiling {fmtUSD(p.constraints.budgetMax)}</span>}{p.constraints.keepAppliances && <span className="rounded-full bg-white px-4 py-2">Existing appliances retained</span>}<span className="rounded-full bg-white px-4 py-2">USD · Preliminary estimate</span></div>
      <div className="grid gap-4 md:grid-cols-3 print:grid-cols-3">{p.options.map((o) => <a key={o.id} href={`#${o.id}`} className="rounded-2xl border border-[#bebebe] bg-white p-5"><div className="text-xs uppercase tracking-wider text-[#9d9d9d]">{o.name}</div><div className="mt-3 font-display text-4xl">{jarvisOptionUnpriced(o).length && o.estimate.mid === 0 ? 'Pricing needed' : fmtUSD(o.estimate.mid)}</div><div className="mt-1 text-sm text-[#6d6d6d]">{fmtRange(o.estimate.totalLow, o.estimate.totalHigh)}</div><p className="mt-3 text-xs text-[#9d9d9d]">Design scope</p><p className="mt-1 text-sm">{scopeById.get(o.id)}</p><div className={`mt-3 text-xs ${o.budget.status === 'over' || jarvisOptionUnpriced(o).length ? 'text-[#a0472d]' : 'text-[#53674d]'}`}>{jarvisOptionUnpriced(o).length ? 'Pricing incomplete · budget unverified' : o.budget.status === 'over' ? 'Estimated range exceeds budget' : o.budget.status === 'within' ? 'Full estimated range within budget' : 'No budget ceiling set'}</div></a>)}</div>
      {p.options.map((o) => {
        const e = o.estimate;
        const unpriced = jarvisOptionUnpriced(o);
        const lines = e.lines.filter((l) => e.mode !== 'changes' || l.scope !== 'unchanged');
        const scanned = isScannedProject(o.snapshot);
        const renders = p.renders.filter((r) => r.optionId === o.id && r.status === 'completed' && publicImageUrl(r.resultUrl) && r.designFingerprint === designFingerprint(o.snapshot) && (!scanned || typeof r.scanAppearanceToken === 'string'));
        return <section id={o.id} key={o.id} className="mt-12 scroll-mt-8 border-t border-[#bebebe] pt-8 print:break-before-page">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-display text-3xl">{o.name}</h2><p className="mt-3 text-xs text-[#9d9d9d]">Design scope</p><p className="mt-1 max-w-3xl text-sm leading-relaxed text-[#6d6d6d]">{scopeById.get(o.id)}</p><p className="mt-2 text-xs text-[#9d9d9d]">{REGION_BY_ID[o.snapshot.estimateSettings.region]?.name ?? o.snapshot.estimateSettings.region} · {o.snapshot.estimateSettings.scope.replaceAll('-', ' ')} · {e.mode === 'changes' ? 'Changes from existing room' : 'Full project scope'}{e.timelineWeeksHigh > 0 ? ` · ${e.timelineWeeksLow}–${e.timelineWeeksHigh} weeks` : ''}</p></div><a href={p.projectLinks[o.id]} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-full border border-[#c9c3b6] px-4 py-2 text-sm print:hidden">{scanned ? 'View option details' : 'Explore this 3D design'} <ArrowUpRight size={15} /></a></div>
          {scanned && <p className="mt-3 text-xs leading-relaxed text-[#6d6d6d]">The original 3D scan remains on the contractor’s device. Shared option pages contain project details and any completed visualizations included here.</p>}
          <UnpricedScanWork items={unpriced} />
          {renders.length > 0 && <div className="mt-5 grid gap-3 sm:grid-cols-2">{renders.map((r) => <figure key={r.id} className="overflow-hidden rounded-xl border border-[#bebebe]"><img src={r.resultUrl} alt={`${o.name} — AI-generated design visualization`} className="w-full" /><figcaption className="bg-white px-3 py-2 text-xs text-[#6d6d6d]">AI-generated visualization from this option’s saved view. Shapes and details may differ; this image does not verify dimensions.</figcaption></figure>)}</div>}
          {o.validation.issues.length > 0 && <div className="mt-5 rounded-xl border border-[#ded3b9] bg-[#fff9e9] p-4 text-sm"><p className="font-medium">Design review</p><ul className="mt-2 list-disc space-y-1 pl-4">{o.validation.issues.map((i, n) => <li key={`${i.code}-${n}`}>{i.message}</li>)}</ul></div>}
          <h3 className="mb-3 mt-7 text-xs font-semibold uppercase tracking-wider">{scanned ? 'Proposed finish choices' : 'Materials & finishes'}</h3>{scanned && <p className="mb-3 text-xs text-[#9d9d9d]">Only changed or explicitly chosen finishes are listed. Unreviewed starting palette IDs do not describe the captured room.</p>}<div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">{Object.entries(o.snapshot.selections).filter(([slot, id]) => activeSlotsFor(o.snapshot.spec, o.snapshot.spec.roomType, scanned).some((active) => active === slot) && (!scanned || id !== o.snapshot.baseline?.selections[slot] || o.finishChoices?.[slot] === id)).map(([slot, id]) => <div key={slot}><span className="text-[#9d9d9d]">{SLOT_META[slot as keyof typeof SLOT_META]?.label ?? slot.replaceAll('_', ' ')}: </span>{CATALOG_BY_ID[id]?.name ?? o.snapshot.spec.detected.finishes?.find((f) => f.slot === slot)?.description ?? id.replaceAll('-', ' ')}</div>)}</div>
          <div className="mt-7 overflow-x-auto print:overflow-visible"><table className="w-full min-w-[650px] text-left text-sm print:min-w-0 print:text-[10px]"><thead className="border-y border-[#bebebe] text-xs uppercase text-[#9d9d9d]"><tr><th className="py-3 pr-4">Scope & quantity</th><th className="py-3 pr-4 text-right">Material</th><th className="py-3 pr-4 text-right">Labor</th><th className="py-3 text-right">Total</th></tr></thead><tbody>{lines.map((l) => <tr key={l.id} className="border-b border-[#e4e0d7]"><td className="py-3 pr-4 print:break-words"><div>{l.label}</div><div className="mt-1 text-xs text-[#9d9d9d]">{l.qty.toLocaleString('en-US')} {l.unit} · {l.reason ?? l.note ?? l.category}</div></td><td className="whitespace-nowrap py-3 pr-4 text-right">{fmtRange(l.materialLow, l.materialHigh)}</td><td className="whitespace-nowrap py-3 pr-4 text-right">{fmtRange(l.laborLow, l.laborHigh)}</td><td className="whitespace-nowrap py-3 text-right">{fmtRange(l.totalLow, l.totalHigh)}</td></tr>)}</tbody></table></div>
          <div className="ml-auto mt-5 max-w-sm space-y-2 text-sm">{[['Subtotal', e.subtotalLow, e.subtotalHigh], ['Contingency', e.contingencyLow, e.contingencyHigh], ['Contractor overhead & profit', e.markupLow, e.markupHigh], ['Sales tax', e.taxLow, e.taxHigh]].map(([label, lo, hi]) => <div key={label} className="flex justify-between gap-5 text-[#6d6d6d]"><span>{label}</span><span>{fmtRange(Number(lo), Number(hi))}</span></div>)}<div className="flex justify-between border-t border-[#bebebe] pt-3 font-semibold"><span>{unpriced.length ? 'Priced subtotal · excludes unpriced work' : 'Estimated total'}</span><span>{fmtRange(e.totalLow, e.totalHigh)}</span></div></div>
        </section>;
      })}
      <footer className="mt-12 border-t border-[#bebebe] pt-6 text-xs leading-relaxed text-[#9d9d9d]"><p>Estimates use model quantities, the selected regional price book, ordering waste, labor allowances, contingency, overhead and tax. Photo-derived dimensions require on-site confirmation. This proposal is a preliminary budget, not a signed construction contract. Design visualizations illustrate finishes and do not establish measured dimensions.</p>{(p.branding?.phone || p.branding?.email) && <p className="mt-3">{p.branding.company} · {[p.branding.phone, p.branding.email].filter(Boolean).join(' · ')}</p>}</footer>
    </div>
  </main>;
}
