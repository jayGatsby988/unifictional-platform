'use client';
/**
 * Read-only client viewer for /p/[id]: branding header, 3D twin and photo comparison,
 * materials, estimate summary, renders with compare slider, contact CTA.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Images, Mail, Phone, Sparkles } from 'lucide-react';
import { useProjectStore } from '@/lib/store/project-store';
import { calculateEstimate, groupLines } from '@/lib/estimate/estimator';
import { REGION_BY_ID } from '@/lib/estimate/pricebook';
import type { Project } from '@/lib/spec/types';
import { fmtRange, fmtUSD } from '@/lib/units';
import { Viewport } from './Viewport';
import { SlotList } from './SlotRail';
import { RenderCard, RenderLightbox } from './RendersPanel';
import { ToastProvider } from './Toast';
import { Segmented } from './controls';
import { summaryFor } from './SceneRouter';
import { roomTypeLabel, selectionsSummary, slotsForRoom } from './projectUtils';
import { SHARED_STORAGE_KEY, STUDIO_STORAGE_KEY, cx } from './hooks';
import { isScannedProject } from '@/lib/sharing/project';
import { SharedScanProjectView } from './SharedScanProjectView';

export default function SharedProjectView({ project }: { project: Project }) {
  return (
    <ToastProvider>
      {isScannedProject(project) ? <SharedScanProjectView project={project} /> : <SharedInner project={project} />}
    </ToastProvider>
  );
}

function SharedInner({ project }: { project: Project }) {
  const [loaded, setLoaded] = useState(false);
  const liveProject = useProjectStore((s) => s.project);
  const activeRenderId = useProjectStore((s) => s.ui.activeRenderId);
  const showPhoto = useProjectStore((s) => s.ui.showOriginalPhoto);
  const setUI = useProjectStore((s) => s.setUI);

  // Load the shared project into the store under a separate storage key so
  // the visitor's own studio project is left untouched; restore on unmount.
  useEffect(() => {
    const persist = useProjectStore.persist;
    const previousKey = persist.getOptions().name ?? STUDIO_STORAGE_KEY;
    persist.setOptions({ name: SHARED_STORAGE_KEY });
    useProjectStore.getState().loadProject(project);
    const t = window.setTimeout(() => setLoaded(true), 0);
    return () => {
      window.clearTimeout(t);
      persist.setOptions({ name: previousKey });
      void persist.rehydrate();
    };
  }, [project]);

  const spec = loaded ? liveProject.spec : null;
  // Read-only: the client sees whichever number the contractor saved with the
  // share. In changes mode only the categories the work touches are listed —
  // a proposal that lines up with the studio the contractor priced it in.
  const est = useMemo(() => (spec ? calculateEstimate(spec, liveProject.selections, liveProject.estimateSettings, liveProject.baseline) : null), [spec, liveProject.selections, liveProject.estimateSettings, liveProject.baseline]);
  const changes = est?.mode === 'changes';
  const groups = useMemo(() => (est ? groupLines(est.lines, { hideUnchanged: est.mode === 'changes' }) : []), [est]);
  const chips = useMemo(() => (spec ? summaryFor(spec, project.selections) : []), [spec, project.selections]);
  const slots = useMemo(() => slotsForRoom(project.roomType), [project.roomType]);
  const renders = useMemo(() => project.renders.filter((r) => r.status === 'completed' && r.resultUrl), [project.renders]);
  const active = renders.find((r) => r.id === activeRenderId);
  const branding = project.branding;
  const region = REGION_BY_ID[project.estimateSettings.region] ?? REGION_BY_ID.national;
  const accentStyle = branding?.accent ? ({ ['--brass' as string]: branding.accent, ['--brass-2' as string]: branding.accent } as CSSProperties) : undefined;
  const prepared = new Date(project.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="min-h-dvh bg-bg text-ink" style={accentStyle}>
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {branding?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logoUrl} alt={branding.company || 'Logo'} className="h-9 w-auto max-w-[140px] object-contain" />
            )}
            <div className="min-w-0">
              <div className="truncate text-[15px] text-ink">{branding?.company || 'Remodel proposal'}</div>
              <div className="truncate text-[11.5px] text-muted">Prepared {prepared}{project.client?.name ? ` for ${project.client.name}` : ''}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {branding?.phone && <a className="btn btn-sm" href={`tel:${branding.phone.replace(/[^\d+]/g, '')}`}><Phone size={13} /> <span className="hidden sm:inline">{branding.phone}</span></a>}
            {branding?.email && <a className="btn btn-sm btn-primary" href={`mailto:${branding.email}?subject=${encodeURIComponent(`Re: ${project.name}`)}`}><Mail size={13} /> <span className="hidden sm:inline">Get in touch</span></a>}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 pb-20 pt-8">
        <div className="eyebrow">{roomTypeLabel(project.roomType)} · 3D twin</div>
        <h1 className="mt-2 font-display text-[36px] leading-[1.05] text-ink sm:text-[48px]">{project.name}</h1>
        {project.client?.address && <div className="mt-1 text-[13px] text-muted">{project.client.address}</div>}
        {chips.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{chips.map((c) => <span key={c} className="chip capitalize">{c}</span>)}</div>}
        {spec?.detected.summary && <p className="mt-4 max-w-3xl text-[14px] leading-relaxed text-muted"><span className="text-dim">Original space: </span>{spec.detected.summary}</p>}

        <section className="mt-6">
          <div className="relative h-[58vh] min-h-[360px] overflow-hidden rounded-[var(--radius)] border border-border bg-bg-elev">
            {loaded && spec ? <Viewport readOnly /> : <div className="shimmer absolute inset-0" />}
            {project.photos.length > 0 && (
              <div className="absolute right-3 top-3 z-20">
                <Segmented<'twin' | 'photo'> size="sm" value={showPhoto ? 'photo' : 'twin'} options={[{ value: 'twin', label: '3D' }, { value: 'photo', label: 'Photo + 3D' }]} onChange={(v) => setUI({ showOriginalPhoto: v === 'photo', cameraMode: v === 'photo' ? 'photo' : 'orbit', overlayVisible: false })} className="bg-black/60" />
              </div>
            )}
          </div>
          <div className="mt-2 text-[11.5px] text-dim">Drag to orbit · scroll to zoom · hover a surface to see its material</div>
        </section>

        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_360px]">
          <div>
            <section>
              <div className="eyebrow mb-3">Materials & finishes</div>
              {loaded && spec ? <SlotList variant="cards" readOnly /> : null}
            </section>

            <section className="mt-10">
              <div className="mb-3 flex items-center justify-between">
                <div className="eyebrow">Photoreal renders · {renders.length}</div>
              </div>
              {renders.length === 0 ? (
                <div className="flex items-center gap-2 rounded-[var(--radius)] border border-dashed border-border px-4 py-6 text-[13px] text-muted"><Images size={16} /> No renders were shared with this proposal.</div>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {renders.map((r) => <RenderCard key={r.id} job={r} onOpen={() => setUI({ activeRenderId: r.id })} slotsSummary={selectionsSummary(r.selections ?? {}, slots, 2)} />)}
                </div>
              )}
            </section>
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="panel-strong p-5">
              <div className="eyebrow">{changes ? 'Your changes' : 'Estimated budget'}</div>
              {est ? (
                <>
                  <div className="num mt-1 font-display text-[38px] leading-none text-ink">{fmtUSD(est.mid)}</div>
                  <div className="num mt-1.5 text-[13px] text-muted">{fmtRange(est.totalLow, est.totalHigh)}</div>
                  {changes && <div className="num mt-1 text-[12px] text-dim">Full remodel {fmtUSD(est.full.mid)} · {fmtRange(est.full.totalLow, est.full.totalHigh)}</div>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {est.timelineWeeksHigh > 0 && <span className="chip">{est.timelineWeeksLow}–{est.timelineWeeksHigh} weeks</span>}
                    <span className="chip capitalize">{project.estimateSettings.scope.replace(/-/g, ' ')}</span>
                    <span className="chip">{region.name}</span>
                  </div>
                  <div className="num mt-4 space-y-1.5 text-[12.5px]">
                    {changes && est.changedCount === 0
                      ? <div className="text-muted">No changes from the room as found.</div>
                      : groups.map((g) => (
                        <div key={g.category} className="flex justify-between gap-3 text-muted"><span>{g.category}</span><span className="text-ink/90">{fmtRange(g.low, g.high)}</span></div>
                      ))}
                    <div className="divider my-2" />
                    <div className="flex justify-between gap-3 text-muted"><span>Contingency & overhead</span><span className="text-ink/90">{fmtRange(est.contingencyLow + est.markupLow + (est.taxLow ?? 0), est.contingencyHigh + est.markupHigh + (est.taxHigh ?? 0))}</span></div>
                    <div className="flex justify-between gap-3 text-ink"><span>Total</span><span>{fmtRange(est.totalLow, est.totalHigh)}</span></div>
                  </div>
                  <p className="mt-4 text-[11px] leading-relaxed text-dim">Preliminary budget derived from a photo-reconstructed model and regional price book. Final pricing follows an on-site measure.</p>
                </>
              ) : (
                <div className="shimmer mt-3 h-24 rounded" />
              )}
            </div>

            {(branding?.email || branding?.phone) && (
              <div className="mt-4 rounded-[var(--radius)] border border-brass/30 bg-brass-soft p-5">
                <div className="font-display text-[22px] leading-tight text-ink">Like what you see?</div>
                <p className="mt-1 text-[12.5px] text-muted">Reach {branding.company || 'us'} to schedule an on-site measure and lock in this design.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {branding.email && <a className="btn btn-primary btn-sm" href={`mailto:${branding.email}?subject=${encodeURIComponent(`Re: ${project.name}`)}`}><Mail size={13} /> Email</a>}
                  {branding.phone && <a className="btn btn-sm" href={`tel:${branding.phone.replace(/[^\d+]/g, '')}`}><Phone size={13} /> Call</a>}
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-3 px-5 py-6 text-[12px] text-dim sm:flex-row sm:items-center">
          <span>Built with <span className={cx('font-mono tracking-[0.18em] text-muted')}>MANHATTAN</span> · photo → 3D remodel studio</span>
          <a className="btn btn-sm" href="/studio"><Sparkles size={12} /> Build your own twin</a>
        </div>
      </footer>

      <AnimatePresence>
        {active && <RenderLightbox key={active.id} job={active} onClose={() => setUI({ activeRenderId: null })} slotsSummary={selectionsSummary(active.selections ?? {}, slots, 3)} />}
      </AnimatePresence>
    </div>
  );
}
