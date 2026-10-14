'use client';
/* eslint-disable @next/next/no-img-element -- Shared evidence is an immutable uploaded image URL. */
import type { Project } from '@/lib/spec/types';
import { calculateEstimate, groupLines } from '@/lib/estimate/estimator';
import { fmtRange, fmtUSD } from '@/lib/units';
import { scanShareRenders, sharedScanPresentation } from '@/lib/sharing/project';
import { scanSlotShowsDesign } from '@/lib/native/scan-finishes';
import { slotLabel, materialName } from './projectUtils';
import { UnpricedScanWork } from './UnpricedScanWork';

/** A native JSON share has no mesh or camera packet. Never mount a procedural
 * replacement viewer here or describe a generated image as measured evidence. */
export function SharedScanProjectView({ project }: { project: Project }) {
  const presentation = sharedScanPresentation(project), estimate = calculateEstimate(project.spec, project.selections, project.estimateSettings, project.baseline);
  const renders = scanShareRenders(project), unpriced = estimate.unpriced ?? [];
  const changes = Object.entries(project.selections).filter(([slot, id]) => id !== project.baseline?.selections[slot] || scanSlotShowsDesign(project, slot));
  const groups = groupLines(estimate.lines, { hideUnchanged: estimate.mode === 'changes' });
  return <main className="min-h-dvh bg-bg px-5 py-8 text-ink sm:px-8">
    <div className="mx-auto max-w-5xl">
      <header className="border-b border-border pb-5">
        <p className="eyebrow">{project.branding?.company || 'Unifictional 3D Studio'} · Shared scan view</p>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">{project.name}</h1>
        {project.client?.name && <p className="mt-2 text-sm text-muted">Prepared for {project.client.name}</p>}
        <p className="mt-2 text-xs text-dim">Saved {new Date(project.updatedAt).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'long' })}</p>
      </header>
      <section aria-label="Shared scan image" className="mt-6">
        <h2 className="font-display text-2xl">{presentation.caption}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{presentation.detail}</p>
        {presentation.imageUrl ? <figure className="mt-4 overflow-hidden rounded-2xl border border-border bg-bg-elev">
          <img src={presentation.imageUrl} alt={presentation.caption} className="max-h-[75dvh] w-full object-contain" />
          <figcaption className="border-t border-border px-4 py-3 text-xs text-muted">{presentation.kind === 'snapshot' ? 'A saved image of the displayed scan. Uncaptured surfaces, sensor gaps and reconstruction limits remain visible; dimensions require on-site confirmation.' : 'AI-generated visualization. It may alter shapes, appearance and details; use the original scan and on-site measurements for verification.'}</figcaption>
        </figure> : <div className="mt-4 rounded-2xl border border-dashed border-border bg-bg-elev p-8 text-sm text-muted">Ask the contractor to share a saved image from the original scan.</div>}
      </section>
      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_340px]">
        <section>
          <h2 className="font-display text-2xl">Proposed finish choices</h2>
          <p className="mt-2 text-xs text-muted">These selections describe design intent. They are not measurements of the room’s original materials.</p>
          {changes.length ? <dl className="mt-4 space-y-3">{changes.map(([slot, id]) => <div key={slot} className="border-b border-border pb-2 text-sm"><dt className="text-muted">{slotLabel(slot)}</dt><dd className="mt-1">{materialName(id)}</dd></div>)}</dl> : <p className="mt-4 text-sm text-muted">No changed material selections are included.</p>}
          {renders.length > 0 && <div className="mt-8"><h2 className="font-display text-2xl">Generated visualizations</h2><p className="mt-2 text-xs text-muted">These completed images belong to this saved design. Image generation can alter geometry and details.</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{renders.map(render => <figure key={render.id} className="overflow-hidden rounded-xl border border-border"><img src={render.resultUrl} alt="AI-generated design visualization" className="w-full" loading="lazy" /><figcaption className="p-3 text-xs text-muted">Generated visualization · not a measured reconstruction</figcaption></figure>)}</div></div>}
        </section>
        <aside className="panel-strong self-start p-5">
          <h2 className="eyebrow">{unpriced.length ? 'Priced subtotal' : 'Preliminary estimate'}</h2>
          <p className="mt-2 font-display text-4xl">{unpriced.length && estimate.mid === 0 ? 'Pricing needed' : fmtUSD(estimate.mid)}</p>
          <p className="mt-2 text-sm text-muted">{fmtRange(estimate.totalLow, estimate.totalHigh)}</p>
          <UnpricedScanWork items={unpriced} />
          <div className="mt-4 space-y-2 text-sm">{groups.map(group => <div key={group.category} className="flex justify-between gap-3"><span className="text-muted">{group.category}</span><span>{fmtRange(group.low, group.high)}</span></div>)}</div>
          <p className="mt-4 text-xs leading-relaxed text-muted">{unpriced.length ? 'This subtotal excludes unpriced scan work and cannot confirm the total project budget.' : 'Pricing uses the chosen design scope and regional allowances. Confirm quantities and construction pricing on site.'}</p>
          {!unpriced.length && !!estimate.fullUnpriced?.length && <UnpricedScanWork items={estimate.fullUnpriced} comparisonOnly />}
        </aside>
      </div>
      <footer className="mt-10 border-t border-border pt-5 text-sm text-muted">
        <p>Contact the contractor for the original scan, measurements and final scope.</p>
        <div className="mt-3 flex flex-wrap gap-4">{project.branding?.email && <a className="text-brass" href={`mailto:${project.branding.email}`}>{project.branding.email}</a>}{project.branding?.phone && <a className="text-brass" href={`tel:${project.branding.phone.replace(/[^\d+]/g, '')}`}>{project.branding.phone}</a>}</div>
      </footer>
    </div>
  </main>;
}
